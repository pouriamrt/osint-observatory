import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles } from './map-test-fixtures.mjs';
import { createApp } from '../server/index.mjs';
import { openStore, now } from '../server/core.mjs';
import { bearing } from '../src/lib/geometry.ts';

mkdirSync('artifacts', { recursive: true });
const store = openStore(':memory:');
const fixtureSource = 'Synthetic browser-test fixture';
const events = [{ id: 'fixture-event', title: 'Synthetic earthquake test location', category: 'Earthquake', magnitude: 3.2, lat: 43.65, lon: -79.38, timestamp: now(), source: fixtureSource, url: 'https://example.org/' }];
store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('USGS', JSON.stringify(events), now());
store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('NASA EONET', '[]', now());
store.importRows('skywave', Array.from({ length: 60 }, (_, i) => ({ frequency_hz: 10000000 + i * 1000, dbm: -110 + 60 * Math.exp(-(((i - 26) / 5) ** 2)), timestamp: '2026-01-01T00:00:00Z', source: fixtureSource })));
store.importRows('crypto', [{ chain: 'ethereum', hash: 'fixture-hash', from: '0x1111111111111111111111111111111111111111', to: '0x2222222222222222222222222222222222222222', amount: '1.25', asset: 'ETH', timestamp: '2026-01-01T00:00:00Z', source: fixtureSource }]);
const { app } = createApp({ store }); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await mockStreetTiles(context);
const page = await context.newPage(), errors = [], report = { moduleChecks: [], functionalChecks: [], screenshots: [], errors };
page.on('pageerror', e => errors.push(e.message));
try {
  // Actual local application, real public data, desktop and mobile inspected in one round.
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Watchtower', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.inspector .busy'), { timeout: 35000 });
  await page.screenshot({ path: 'artifacts/watchtower-desktop.png', fullPage: true, animations: 'disabled' }); report.screenshots.push('watchtower-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/watchtower-mobile.png', fullPage: true, animations: 'disabled' }); report.screenshots.push('watchtower-mobile.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Mobile page overflow');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Research modules' }).getByRole('button', { name: 'Camera Globe', exact: true }).click();
  await page.getByRole('heading', { name: 'Camera Globe', exact: true }).waitFor();
  report.functionalChecks.push('Mobile navigation opens and closes');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.camera-list-select').first().waitFor();
  await page.getByLabel('Camera source', { exact: true }).selectOption('SkylineWebcams');
  await page.locator('.camera-list-select').first().waitFor();
  assert((await page.locator('.camera-list-select').count()) > 20);
  await page.locator('.camera-list-select').first().click();
  await page.getByText('Approximate view location, not the physical camera position.', { exact: false }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.camera-preview-image img'); return !image || image.complete; });
  await page.screenshot({ path: 'artifacts/camera-desktop.png', fullPage: true, animations: 'disabled' }); report.screenshots.push('camera-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/camera-mobile.png', fullPage: true, animations: 'disabled' }); report.screenshots.push('camera-mobile.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Camera mobile overflow');
  await page.getByRole('button', { name: 'Close camera details', exact: true }).click();
  await page.getByLabel('Camera source', { exact: true }).selectOption('EarthCam');
  await page.getByLabel('Search cameras', { exact: true }).fill('Times Square');
  await page.locator('.camera-list-select').first().waitFor();
  await page.locator('.camera-list-select').first().click();
  await page.getByRole('link', { name: /Open live camera/ }).waitFor();
  assert((await page.getByRole('link', { name: /Open live camera/ }).getAttribute('href')).includes('earthcam.com'));
  report.functionalChecks.push('EarthCam and Skyline locations, native preview inspector, and source playback links');


  // Isolated, in-memory browser fixtures never enter the real workspace.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const routes = [['watchtower', 'Watchtower'], ['camera', 'Camera Globe'], ['username', 'Username OSINT'], ['crypto', 'Crypto Tracing'], ['netscan', 'NetScan'], ['hawk', 'Hawk'], ['skywave', 'Skywave'], ['fisherman', 'Fisherman'], ['catalogue', 'Catalogue'], ['evidence', 'Evidence notebook'], ['settings', 'Sources & settings']];
  for (const [route, title] of routes) {
    await page.goto(`${base}/#${route}`); await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${route} desktop overflow`);
    report.moduleChecks.push(`${route}: desktop renders`);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${route} mobile overflow`);
    report.moduleChecks.push(`${route}: mobile renders`);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto(`${base}/#camera`); await page.getByRole('button', { name: 'Import cameras', exact: true }).click();
  await page.getByLabel('Import camera file').setInputFiles({ name: 'camera-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ name: 'Synthetic browser camera', lat: 43.65, lon: -79.38, url: 'https://example.org/', source: fixtureSource, kind: 'page' }])) });
  await page.getByRole('button', { name: 'Validate and import', exact: true }).click();
  await page.getByText('1 added, 0 duplicates skipped.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close import', exact: true }).click();
  await page.getByLabel('Search cameras', { exact: true }).fill('Synthetic browser camera');
  await page.locator('.camera-list-select').filter({ hasText: 'Synthetic browser camera' }).click();
  await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Saved', exact: true }).waitFor(); report.functionalChecks.push('Camera file import, selection, and evidence save');
  await page.getByRole('button', { name: 'Favorite Synthetic browser camera', exact: true }).click();
  await page.getByRole('button', { name: 'Unfavorite Synthetic browser camera', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close camera details', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  assert.equal(await page.locator('.camera-list-select').count(), 1);
  await page.evaluate(() => { location.hash = 'username'; }); await page.getByRole('heading', { name: 'Username OSINT', exact: true }).waitFor();
  await page.evaluate(() => { location.hash = 'camera'; }); await page.getByRole('heading', { name: 'Camera Globe', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Search cameras').inputValue(), 'Synthetic browser camera');
  await page.locator('.camera-list-select').first().waitFor();
  report.functionalChecks.push('Camera favorites persist and module navigation preserves filters');

  await page.getByRole('button', { name: 'World map', exact: true }).click(); assert.equal(await page.getByRole('img', { name: 'World map with research locations' }).count(), 1); report.functionalChecks.push('World-map fallback renders');
  await page.goto(`${base}/#netscan`); await page.getByRole('button', { name: 'Active scan', exact: true }).click();
  await page.getByLabel('Target', { exact: true }).fill('127.0.0.1'); await page.getByLabel('TCP ports').fill(String(server.address().port));
  await page.getByLabel('I have permission to test the configured target.').check();
  await page.getByRole('button', { name: 'Run bounded scan', exact: true }).click(); await page.getByText('TCP connection accepted.', { exact: true }).waitFor(); report.functionalChecks.push('Authorized TCP scan reaches owned test service');
  await page.goto(`${base}/#hawk`); await page.getByLabel('Image for provenance analysis').setInputFiles({ name: 'synthetic-pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
  await page.getByText('synthetic-pixel.png', { exact: true }).waitFor(); assert.equal((await page.locator('.hash').textContent()).length, 64); report.functionalChecks.push('Local image SHA-256 inspection');
  await page.getByRole('button', { name: 'Add landmark', exact: true }).click();
  const camera = { lat: 43.6532, lon: -79.3832 }, landmarks = [{ name: 'A', lat: 43.66, lon: -79.38 }, { name: 'B', lat: 43.65, lon: -79.37 }, { name: 'C', lat: 43.64, lon: -79.39 }];
  const landmarkRows = page.locator('.landmark-row');
  for (let i = 0; i < 3; i++) { const row = landmarkRows.nth(i), l = landmarks[i]; await row.getByLabel('Landmark name').fill(l.name); await row.getByLabel('Latitude').fill(String(l.lat)); await row.getByLabel('Longitude').fill(String(l.lon)); await row.getByLabel('Bearing °').fill(String(bearing(camera, l))); }
  await page.getByRole('button', { name: 'Calculate intersection', exact: true }).click(); await page.getByRole('heading', { name: /Candidate:/ }).waitFor(); report.functionalChecks.push('Three-landmark geometric calculation');
  await page.getByRole('link', { name: 'Explore candidate area', exact: true }).click();
  await page.getByLabel('Nearby camera radius').waitFor();
  assert.equal(await page.getByLabel('Nearby camera radius').inputValue(), '50');
  await page.evaluate(() => { location.hash = 'hawk'; }); await page.getByRole('heading', { name: /Candidate:/ }).waitFor();
  assert.equal(await page.getByText('synthetic-pixel.png', { exact: true }).count(), 1);
  report.functionalChecks.push('Hawk location opens nearby-camera map and preserves image analysis on return');

  await page.goto(`${base}/#skywave`); await page.getByText(/Peak sample:/).waitFor(); assert.equal(await page.locator('canvas.waterfall').count(), 1); report.functionalChecks.push('Imported spectrum plot and waterfall');
  await page.goto(`${base}/#crypto`); await page.getByLabel('Blockchain').selectOption('ethereum'); await page.getByRole('heading', { name: 'Transfer ledger' }).waitFor(); assert.equal(await page.getByRole('button', { name: /Inspect wallet/ }).count(), 2); await page.getByRole('button', { name: /Inspect wallet/ }).first().click(); await page.getByRole('button', { name: 'Filter to connections', exact: true }).click(); await page.getByLabel('Filter transfer ledger').fill('ETH'); report.functionalChecks.push('Imported transfer graph, connection inspection, and searchable ledger');
  await page.goto(`${base}/#fisherman`); await page.getByLabel('Visible link title').fill('Synthetic consent test'); await page.getByLabel('Destination URL').fill('https://example.org/research'); await page.getByRole('button', { name: 'Create consent link', exact: true }).click(); await page.getByRole('link', { name: 'Open consent page', exact: true }).waitFor();
  const consentUrl = await page.getByRole('link', { name: 'Open consent page', exact: true }).getAttribute('href');
  const visitor = await context.newPage(); await visitor.goto(consentUrl); await visitor.getByRole('button', { name: 'Agree and share visit', exact: true }).click(); await visitor.getByRole('button', { name: 'Visit shared', exact: true }).waitFor(); await visitor.close();
  await page.getByRole('button', { name: 'Refresh visits', exact: true }).click(); await page.getByText(/1 stored visits/).waitFor(); report.functionalChecks.push('Research link creation, consent page, optional-GPS-off visit persistence');
  await page.goto(`${base}/#evidence`); await page.getByText('Synthetic browser camera', { exact: true }).waitFor(); await page.getByText('Evidence and notes', { exact: true }).click(); await page.getByLabel('Research notes').fill('Synthetic browser verification note.'); await page.getByRole('button', { name: 'Save notes', exact: true }).click(); await page.getByText('Notes saved', { exact: true }).waitFor(); report.functionalChecks.push('Evidence notebook note persistence');
  await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'Search workspace' }).waitFor();
  await page.getByLabel('Find modules or saved evidence').fill('Synthetic browser camera');
  await page.locator('.command-results button').filter({ hasText: 'Synthetic browser camera' }).waitFor();
  await page.keyboard.press('Enter'); await page.locator('.evidence-entry.highlight').waitFor();
  await page.keyboard.press('Control+k'); await page.getByLabel('Find modules or saved evidence').fill('Skywave');
  await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'Skywave', exact: true }).waitFor();
  report.functionalChecks.push('Keyboard workspace search opens modules and highlights saved evidence');
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  writeFileSync('artifacts/browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
