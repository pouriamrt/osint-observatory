import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { streetTileFixture } from './map-test-fixtures.mjs';
import { parseSatelliteCapabilities } from '../server/satellite.mjs';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';
import { liveViewFixture } from './live-view-fixtures.mjs';

let server, store;
if (!process.env.CAMERA_APP_URL) {
  store = openStore(':memory:'); const { app } = createApp({ store }); server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
}
const base = process.env.CAMERA_APP_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const tileRequests = [], errors = []; let failBoundaries = true;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/live-views*', route => route.fulfill({ json: liveViewFixture }));
await page.route('**/api/cameras', route => route.fulfill({ json: { cameras: [], sources: [] } }));
await page.route('https://services.arcgisonline.com/**', route => {
  tileRequests.push(route.request().url());
  if (failBoundaries && route.request().url().includes('World_Boundaries_and_Places')) return route.fulfill({ status: 503, body: 'Fixture boundary outage' });
  return route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture });
});
await page.route('**/api/places?*', route => route.fulfill({ json: { results: [{ id: 'fixture-ottawa', name: 'Bank Street, Ottawa, Canada', lat: 45.4, lon: -75.7, span: { lat: .003, lon: .003 } }], source: 'Esri World Geocoding' } }));
const xml = readFileSync(new URL('../tests/fixtures/satellite-capabilities.xml', import.meta.url), 'utf8');
await page.route('**/api/satellite*', route => route.fulfill({ json: { layers: parseSatelliteCapabilities(xml), retrievedAt: '2026-10-09T21:00:00Z', stale: false } }));
await page.route('https://gibs.earthdata.nasa.gov/**', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#satellite`);
  await page.getByLabel('Satellite source', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Satellite source', { exact: true }).inputValue(), 'detail', 'The default satellite view must request imagery detailed enough for streets and buildings');
  assert(await page.getByLabel('Borders & city names', { exact: true }).isChecked(), 'Canadian province borders and place names are enabled by default');
  await page.getByText('Borders and city names could not load. Satellite imagery is still available.', { exact: true }).waitFor();
  await page.waitForFunction(() => { const images = [...document.querySelectorAll('.satellite-tile')]; return images.length > 0 && images.every(image => image.complete && image.naturalWidth === 256); });
  failBoundaries = false; await page.getByRole('button', { name: 'Retry borders & city names', exact: true }).click();
  await page.locator('.boundary-map-error').waitFor({ state: 'detached' });
  await page.waitForFunction(() => [...document.querySelectorAll('.satellite-boundary-tile')].some(image => image.complete && image.naturalWidth === 256));
  assert(tileRequests.some(url => url.includes('Reference/World_Boundaries_and_Places/MapServer/tile/')), 'Boundary tiles use the worldwide administrative-boundary source');
  await page.getByLabel('Borders & city names', { exact: true }).uncheck();
  await page.locator('.satellite-boundary-tiles').waitFor({ state: 'detached' });
  assert(await page.getByLabel('Street names', { exact: true }).isChecked(), 'Borders toggle is independent of street names');
  await page.getByLabel('Borders & city names', { exact: true }).check();
  await page.locator('.satellite-boundary-tiles').waitFor();
  await page.getByRole('button', { name: 'Ottawa', exact: true }).click();
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.satellite-tile')].some(image => /\/tile\/(1[7-9]|20)\//.test(image.src) && image.complete && image.naturalWidth === 256));
  assert(tileRequests.some(url => /World_Imagery\/MapServer\/tile\/(1[7-9]|20)\//.test(url)), 'Close zoom requests native detailed imagery instead of magnifying a weather pixel');
  await page.getByLabel('Find a place or address', { exact: true }).fill('Bank Street Ottawa');
  await page.getByRole('button', { name: 'Find place', exact: true }).click();
  await page.getByRole('button', { name: 'Bank Street, Ottawa, Canada', exact: true }).click();
  await page.getByText('Bank Street, Ottawa, Canada', { exact: true }).waitFor();
  await page.getByLabel('Street names', { exact: true }).uncheck();
  await page.locator('.satellite-label-tiles').waitFor({ state: 'detached' });
  await page.getByLabel('Street names', { exact: true }).check();
  await page.locator('.satellite-label-tiles').waitFor();
  await page.getByLabel('Satellite source', { exact: true }).selectOption('viirs');
  await page.getByText('Regional zoom limit. Choose Streets & buildings for a closer view.', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Zoom in', exact: true }).isDisabled(), 'Weather zoom stops at native resolution instead of becoming a flat pixel');
  await page.getByLabel('Satellite source', { exact: true }).selectOption('detail');
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert(await page.getByLabel('Find a place or address', { exact: true }).isVisible());
    assert(await page.getByLabel('Satellite source', { exact: true }).isVisible());
  }
  await page.screenshot({ path: 'artifacts/satellite-detail-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/satellite-detail-desktop.png', fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  const report = { checks: ['Default detailed imagery reaches native street zoom', 'Province borders and city names load by default and toggle independently of roads', 'Boundary outages retain imagery and retry recovers', 'Place and address search focus the map', 'Street labels can be toggled', 'Weather zoom stops at native resolution', 'Desktop, tablet, and mobile controls remain usable'], errors };
  writeFileSync('artifacts/satellite-detail-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); store?.db.close(); }
