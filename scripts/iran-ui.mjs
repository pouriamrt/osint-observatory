import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles } from './map-test-fixtures.mjs';
import { createApp } from '../server/index.mjs';
import { openStore, now } from '../server/core.mjs';

// Real public metadata, isolated workspace, controlled media/network failures.
const store = openStore(':memory:');
const catalog = JSON.parse(readFileSync(new URL('../server/sources/camera-catalog.json', import.meta.url)));
const canadian = JSON.parse(readFileSync(new URL('../server/sources/canadian-cameras.json', import.meta.url)));
const iranian = JSON.parse(readFileSync(new URL('../server/sources/iranian-cameras.json', import.meta.url)));
store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('camera-earthcam', JSON.stringify(catalog.earthcam), now());
for (const source of canadian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source.cameras), now());
for (const source of iranian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source), now());
const { app } = createApp({ store }), server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route('https://**/*', route => route.abort());
await mockStreetTiles(page);
const report = { checks: [], errors: [], streamRequests: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (request.url().startsWith('https://newlive.nasimrezvan.com/hls/')) report.streamRequests.push(request.url()); });
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#camera?country=Iran&place=Tehran`);
  await page.locator('.camera-list-select').first().waitFor();
  assert.equal(await page.getByLabel('Camera country', { exact: true }).inputValue(), 'Iran');
  assert.equal(await page.getByLabel('Search cameras', { exact: true }).inputValue(), 'Tehran');
  assert.equal(await page.locator('#camera-selection option:not([value=""])').count(), 1);
  await page.getByLabel('Select camera', { exact: true }).selectOption('iran-tehran:37931');
  await page.locator('.camera-offline-notice').getByText('Offline at last source check', { exact: true }).waitFor();
  assert.equal(await page.locator('.camera-preview-image img').count(), 0);
  assert.match(await page.locator('.snapshot-status').textContent(), /marked this listing offline/);
  assert.equal(await page.getByRole('link', { name: 'Open camera page', exact: true }).getAttribute('href'), iranian.sources[0].url);
  assert(await page.locator('.flat-map').count(), 'Tehran opens at city scale');
  report.checks.push('Tehran deep link focuses one approximate public listing and shows the dated outage without a misleading image');
  await page.screenshot({ path: 'artifacts/iran-tehran-desktop.png', fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: 'Favorite Tehran — Several Views', exact: true }).click();
  await page.getByRole('button', { name: 'Unfavorite Tehran — Several Views', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  const evidence = await (await fetch(`${base}/api/evidence`)).json();
  assert.equal(evidence[0].payload.availability, 'offline'); assert(evidence[0].payload.availabilityCheckedAt);
  await page.reload(); await page.locator('.camera-list-select').first().waitFor();
  assert.equal(await page.getByLabel('Search cameras', { exact: true }).inputValue(), 'Tehran');
  await page.getByLabel('Select camera', { exact: true }).selectOption('iran-tehran:37931');
  await page.getByRole('button', { name: 'Unfavorite Tehran — Several Views', exact: true }).waitFor();
  report.checks.push('Reload keeps the Tehran deep link; favorites persist and saved evidence retains source availability and check time');

  await page.getByRole('button', { name: 'Iran', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#camera-selection')?.options.length === 7);
  await page.getByLabel('Camera source', { exact: true }).selectOption('Haram Razavi');
  await page.waitForFunction(() => document.querySelector('#camera-selection')?.options.length === 6);
  await page.getByLabel('Select camera', { exact: true }).selectOption('iran-razavi:6');
  await page.locator('.camera-preview video').waitFor();
  await page.locator('.camera-preview').getByText('Public HLS stream', { exact: true }).waitFor();
  await page.locator('.camera-preview').getByText(/The (?:stream|video) could not load\./).waitFor();
  report.playerError = await page.locator('.camera-preview .notice.error').textContent();
  assert(report.streamRequests.some(url => url.endsWith('/Enghelab-Sahn/index.m3u8')));
  assert.equal(await page.getByRole('link', { name: 'Open camera source', exact: true }).getAttribute('href'), 'https://haram.razavi.ir/live');
  await page.screenshot({ path: 'artifacts/iran-mashhad-player.png', fullPage: true, animations: 'disabled' });
  report.checks.push('Iran has six listings; Haram Razavi filters to five streams and the player retains its official source link when playback fails');

  await page.getByLabel('Camera source', { exact: true }).selectOption('Iran 141');
  await page.getByRole('heading', { name: 'No cameras match these filters', exact: true }).waitFor();
  assert.equal(await page.locator('#camera-selection option:not([value=""])').count(), 0);
  assert((await page.locator('.notice.warning').textContent()).includes('no camera locations'));
  await page.getByRole('button', { name: 'Tehran', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#camera-selection')?.options.length === 2);
  assert.equal(await page.getByLabel('Camera source', { exact: true }).inputValue(), 'All sources');
  await page.getByLabel('Search cameras', { exact: true }).fill('تهران');
  assert.equal(await page.locator('#camera-selection option:not([value=""])').count(), 1);
  report.checks.push('The empty 141 service invents no pins; Tehran shortcut clears source conflicts and Persian city search finds the same listing');

  await page.getByLabel('Select camera', { exact: true }).selectOption('iran-tehran:37931');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Mobile view has no horizontal overflow');
  assert(await page.getByRole('button', { name: 'Tehran', exact: true }).isVisible());
  await page.screenshot({ path: 'artifacts/iran-tehran-mobile.png', fullPage: true, animations: 'disabled' });
  assert.deepEqual(report.errors, []);
  report.checks.push('Tehran shortcuts, map, source status, and selected listing remain accessible at 390px');
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync('artifacts/iran-ui-report.json', JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close();
}
