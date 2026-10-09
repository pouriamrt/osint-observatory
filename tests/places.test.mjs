import test from 'node:test';
import assert from 'node:assert/strict';
import { findPlaces, normalizePlaceCandidates } from '../server/places.mjs';
const candidate = { address: 'Bank St, Ottawa, Ontario', location: { x: -75.7013, y: 45.4211 }, extent: { xmin: -75.7023, ymin: 45.4201, xmax: -75.7003, ymax: 45.4221 } };

test('place navigation preserves provider coordinates and rejects malformed positions', () => {
  const results = normalizePlaceCandidates({ candidates: [candidate, { ...candidate, location: { x: 190, y: 45 } }, { ...candidate, location: { x: 0, y: 90 } }, { ...candidate, address: '' }] });
  assert.equal(results.length, 1); assert.equal(results[0].lat, 45.4211); assert.equal(results[0].lon, -75.7013);
  assert(results[0].span.lat >= .002 && results[0].span.lat < .003);
  assert.throws(() => normalizePlaceCandidates({}), /unreadable response/);
});

test('address lookups use the fixed Esri endpoint for temporary navigation and report outages', async () => {
  const result = await findPlaces('Bank St, Ottawa', async url => {
    assert.equal(url.hostname, 'geocode.arcgis.com'); assert.equal(url.searchParams.get('SingleLine'), 'Bank St, Ottawa');
    assert.equal(url.searchParams.get('forStorage'), 'false'); assert.equal(url.searchParams.get('outSR'), '4326');
    return Response.json({ candidates: [candidate] });
  });
  assert.equal(result.results.length, 1); assert.equal(result.source, 'Esri World Geocoding');
  await assert.rejects(findPlaces('Ottawa', async () => Response.json({ error: { code: 499 } })), error => error.status === 502);
});
