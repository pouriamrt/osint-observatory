import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSatelliteProvider, parseSatelliteCapabilities } from '../server/satellite.mjs';
import { visibleMapTiles } from '../src/lib/map-projection.ts';
import { satelliteTileUrl } from '../src/lib/satellite.ts';

const xml = readFileSync(new URL('./fixtures/satellite-capabilities.xml', import.meta.url), 'utf8');
test('NASA capabilities preserve real observation times and supported regional matrices', () => {
  const [global, east, west] = parseSatelliteCapabilities(xml);
  assert.equal(global.time, '2026-10-09'); assert.equal(global.minDate, '2018-01-05'); assert.equal(global.maxZoom, 9);
  assert.equal(east.time, '2026-10-09T19:00:00Z'); assert.equal(east.maxZoom, 6, 'GOES layer limits stop before its matrix-set maximum');
  const fullWorld = { x: 0, y: 0, width: 360, height: 360 };
  const tiles = visibleMapTiles(fullWorld, 256 * 2 ** 6, west.maxZoom, west.limits);
  assert.equal(tiles.length, 28 * 37, 'Only supported columns in the 64-column Mercator matrix are requested');
  assert(tiles.every(tile => tile.column <= 27));
  assert.equal(visibleMapTiles({ x: 170, y: 180, width: 1, height: 1 }, 256, west.maxZoom, west.limits).length, 0, 'No requests outside GOES coverage');
  assert(west.limits.some(limit => limit.minColumn === 71), 'Disjoint provider ranges survive parsing');
  assert(satelliteTileUrl(global, '2026-10-08').includes('/2026-10-08/GoogleMapsCompatible_Level9/'));
  assert(satelliteTileUrl(east, '2026-10-08').includes(encodeURIComponent(east.time)), 'GOES uses observation time, not the daily picker');
  assert.throws(() => parseSatelliteCapabilities('<Capabilities/>'), /metadata is unavailable/);
  assert.throws(() => parseSatelliteCapabilities(xml.replace('GoogleMapsCompatible_Level9', 'UnsupportedGrid')), /metadata is unavailable/);
});

test('metadata refresh is shared, cached, and retains dated data during outages', async () => {
  let requests = 0, currentTime = Date.parse('2026-10-09T20:00:00Z'), fail = false, release;
  const provider = createSatelliteProvider(async () => {
    requests++; if (requests === 1) await new Promise(resolve => { release = resolve; });
    return new Response(fail ? 'Outage' : xml, { status: fail ? 503 : 200 });
  }, () => currentTime);
  const first = provider(), concurrent = provider(true); release();
  const catalogue = await first; assert.deepEqual(await concurrent, catalogue); assert.equal(requests, 1);
  await provider(); assert.equal(requests, 1);
  fail = true; currentTime += 300001;
  const stale = await provider(); assert.equal(stale.stale, true); assert.equal(stale.retrievedAt, catalogue.retrievedAt); assert.deepEqual(stale.layers, catalogue.layers);
  await provider(); assert.equal(requests, 2, 'Retry cooldown prevents repeated background requests during outages');
  fail = false; const restored = await provider(true); assert.equal(restored.stale, false); assert.notEqual(restored.retrievedAt, catalogue.retrievedAt);
});

test('a first connection failure reports unavailability instead of invented timestamps', async () => {
  const provider = createSatelliteProvider(async () => { throw new Error('Network failure'); });
  await assert.rejects(provider(), error => error.status === 502 && /unavailable/.test(error.message));
});
