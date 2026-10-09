import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';
import { liveViewFixture } from './live-view-fixtures.mjs';
import { parseSatelliteCapabilities } from '../server/satellite.mjs';
import { mockStreetTiles, streetTileFixture } from './map-test-fixtures.mjs';

// Isolated workspace; all imagery/video traffic uses controlled fixtures.
const store = openStore(':memory:'), { app } = createApp({ store }), server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const xml = readFileSync(new URL('../tests/fixtures/satellite-capabilities.xml', import.meta.url), 'utf8');
let failMetadata = true, failTiles = false, metadataRequests = 0, tiles = [], frame = '2026-10-09T19:00:00Z';
const report = { checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
await page.route('**/api/live-views*', route => route.fulfill({ json: liveViewFixture }));
await page.route('**/api/cameras', route => route.fulfill({ json: { cameras: [], sources: [] } }));
await mockStreetTiles(page);
await page.route('https://services.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
await page.route('**/api/satellite*', route => {
  metadataRequests++;
  return route.fulfill(failMetadata ? { status: 502, json: { error: 'Satellite metadata is unavailable. Retry to reconnect to NASA.' } } : { json: { layers: parseSatelliteCapabilities(xml.replace('2026-10-09T19:00:00Z', frame)), retrievedAt: '2026-10-09T20:00:00Z', stale: false } });
});
await page.route('https://gibs.earthdata.nasa.gov/**', route => {
  tiles.push({ url: route.request().url(), referer: route.request().headers().referer });
  return route.fulfill(failTiles ? { status: 503, body: 'Fixture outage' } : { contentType: 'image/svg+xml', body: streetTileFixture.replace('#e4eadb', '#24453e').replace('Test street', 'Test satellite') });
});
await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Controlled video fixture</title><p>NASA player fixture: provider controls live/recorded status</p>' }));
async function loaded() {
  await page.waitForFunction(() => { const images = [...document.querySelectorAll('.satellite-tile')]; return images.length > 0 && images.every(image => image.complete && image.naturalWidth === 256 && image.style.visibility !== 'hidden'); });
}
async function noOverflow(width) {
  await page.setViewportSize({ width, height: 1000 });
  await loaded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px has no horizontal overflow`);
  for (const name of ['Satellite source', 'Satellite imagery date']) {
    const box = await page.getByLabel(name, { exact: true }).boundingBox(), host = await page.locator('.globe-canvas').boundingBox();
    assert(box.x >= host.x && box.x + box.width <= host.x + host.width + 1, `${name} stays within ${width}px map`);
    assert(box.width >= (name === 'Satellite source' ? 120 : 110), `${name} remains readable at ${width}px`);
  }
}
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#satellite`);
  await page.getByRole('heading', { name: 'Satellite views', exact: true }).waitFor();
  await page.getByLabel('Satellite source', { exact: true }).selectOption('viirs');
  await page.getByText('Satellite metadata is unavailable. Retry to reconnect to NASA.', { exact: false }).waitFor();
  assert.equal(await page.locator('.satellite-tile').count(), 0);
  failMetadata = false; await page.getByRole('button', { name: 'Retry NASA connection', exact: true }).click();
  await loaded();
  assert(tiles.length > 0 && tiles.length <= 24);
  assert(tiles.every(tile => tile.referer === `${base}/`), 'Only the app origin is sent to NASA');
  report.checks.push('Initial NASA outages show a recoverable state; successful imagery carries dates and origin-only referrers');

  await page.getByLabel('Satellite imagery date', { exact: true }).fill('2026-10-08'); await loaded();
  assert(tiles.some(tile => tile.url.includes('/2026-10-08/')));
  await page.getByText('Historical date selected', { exact: true }).waitFor();
  await page.clock.install();
  let count = metadataRequests; await page.clock.fastForward(300100); assert.equal(metadataRequests, count, 'Historical date does not follow latest observations');
  await page.getByRole('button', { name: 'Follow latest imagery', exact: true }).click();
  await page.getByRole('button', { name: 'Pause satellite updates', exact: true }).click();
  await page.clock.fastForward(300100); assert.equal(metadataRequests, count, 'Paused imagery does not poll');
  await page.getByRole('button', { name: 'Resume satellite updates', exact: true }).click();
  await page.clock.fastForward(300100);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh satellite imagery"]').disabled);
  assert(metadataRequests > count, 'Resume polls for updated provider times');
  report.checks.push('Historical UTC dates, follow-latest, pause, and resumed automatic updates work');

  await page.getByLabel('Satellite source', { exact: true }).selectOption('goes-east');
  await page.getByText('Observation: 2026-10-09 19:00:00 UTC', { exact: true }).waitFor();
  await page.clock.runFor(300); await loaded();
  frame = '2026-10-09T19:10:00Z';
  await page.getByRole('button', { name: 'Refresh satellite imagery', exact: true }).click();
  await page.getByText('Observation: 2026-10-09 19:10:00 UTC', { exact: true }).waitFor();
  await page.clock.runFor(300); await loaded();
  assert(tiles.some(tile => decodeURIComponent(tile.url).includes(frame)), 'Updated observation time reaches the tile URL');
  failTiles = true;
  await page.getByRole('button', { name: 'Refresh satellite imagery', exact: true }).click();
  await page.getByText('Satellite tiles could not load. Any retained images are from the previous fetch.', { exact: true }).waitFor();
  assert(await page.locator('.satellite-tile').evaluateAll(images => images.every(image => image.naturalWidth === 256)), 'Last loaded tiles remain visible during refresh failures');
  failTiles = false; await page.getByRole('button', { name: 'Retry satellite imagery', exact: true }).click();
  await page.locator('.street-map-error').waitFor({ state: 'detached' });
  report.checks.push('GOES observation times advance; failed tile refreshes retain the previous frame and retry recovers');

  await page.getByLabel('Satellite source', { exact: true }).selectOption('viirs'); await page.clock.runFor(300); await loaded();
  for (const width of [1024, 768, 390, 320]) { await page.clock.runFor(300); await noOverflow(width); }
  await page.screenshot({ path: 'artifacts/satellite-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement); await page.clock.runFor(300); await loaded();
  assert(await page.getByLabel('Satellite source', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  report.checks.push('Satellite controls and imagery remain usable at 320px, mobile, tablet, desktop, and fullscreen');

  assert.equal(await page.locator('.iss-video iframe').count(), 0);
  await page.getByRole('button', { name: 'Load ISS live video', exact: true }).click();
  let player = page.locator('.iss-video iframe');
  assert((await player.getAttribute('src')).includes('/awQzjn72bI0?'));
  assert.equal(await player.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
  await page.getByLabel('ISS camera', { exact: true }).selectOption('station');
  assert((await player.getAttribute('src')).includes('/M3HKLzjvKPc?'));
  await page.getByRole('button', { name: 'Reload video', exact: true }).click();
  await page.getByRole('button', { name: 'Stop video', exact: true }).click(); assert.equal(await player.count(), 0);
  assert(await page.getByRole('link', { name: 'NASA’s current station streams', exact: true }).isVisible());
  report.checks.push('Both official NASA video players load, switch, reconnect, stop, and expose current-stream fallback links');

  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.locator('.satellite-settings').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Satellite map', exact: true }).click(); await page.clock.runFor(300); await loaded();
  await page.screenshot({ path: 'artifacts/satellite-desktop.png', fullPage: true, animations: 'disabled' });

  await page.route('**/api/cameras', route => route.fulfill({ json: { cameras: [{ id: 'fixture:1', name: 'Ottawa satellite marker fixture', lat: 45.4, lon: -75.7, country: 'Canada', source: 'Synthetic browser-test fixture', provider: 'Fixture cameras', url: 'https://example.org/camera-page', kind: 'page' }], sources: [] } }));
  await page.goto(`${base}/#camera?country=Canada&place=Ottawa`);
  await page.getByLabel('Select camera', { exact: true }).selectOption('fixture:1');
  const position = await page.locator('.map-point').getAttribute('transform');
  await page.getByRole('button', { name: 'Satellite map', exact: true }).click();
  await page.getByLabel('Satellite source', { exact: true }).waitFor(); await page.clock.runFor(300); await loaded();
  assert.equal(await page.locator('.map-point').getAttribute('transform'), position, 'Camera pins keep the same Mercator coordinates in satellite mode');
  assert.equal(await page.getByLabel('Select camera', { exact: true }).inputValue(), 'fixture:1');
  await page.getByRole('heading', { name: 'Ottawa satellite marker fixture', exact: true }).waitFor();
  report.checks.push('Camera Globe keeps the selected camera and marker coordinates when switching to satellite imagery');
  assert.deepEqual(report.errors, []);
  writeFileSync('artifacts/satellite-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: 'artifacts/satellite-failure.png', fullPage: true, animations: 'disabled' });
  console.error(JSON.stringify({ checks: report.checks, tiles: tiles.slice(-5), status: await page.locator('.satellite-settings').textContent(), tileState: await page.locator('.street-tile').evaluateAll(images => images.map(image => ({ src: image.src, complete: image.complete, width: image.naturalWidth, visibility: image.style.visibility }))) }));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
