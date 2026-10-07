import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles } from './map-test-fixtures.mjs';
import { createApp } from '../server/index.mjs';
import { openStore, now } from '../server/core.mjs';

const store = openStore(':memory:');
const catalog = JSON.parse(readFileSync(new URL('../server/sources/camera-catalog.json', import.meta.url)));
const canadian = JSON.parse(readFileSync(new URL('../server/sources/canadian-cameras.json', import.meta.url)));
for (const source of canadian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source.cameras), now());
store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('camera-earthcam', JSON.stringify(catalog.earthcam), now());
const { app } = createApp({ store }), server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await mockStreetTiles(page);
const frames = new Map(), bodies = new Set(), requests = [], report = { checks: [], errors: [] };
let mode = 'normal', release;
const isFrame = url => { const value = new URL(url); return value.pathname === '/api/cameras/ottawa-snapshot' && value.searchParams.get('id') === '16' && value.searchParams.has('timems'); };
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (isFrame(request.url())) requests.push(request.url()); });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const response = await originalFetch(input, options);
  const url = new URL(input);
  if (url.hostname === 'traffic.ottawa.ca' && url.pathname === '/camera' && url.searchParams.get('id') === '16' && response.status === 200) {
    const body = response.clone().arrayBuffer().then(bytes => frames.set(url.href, createHash('sha256').update(Buffer.from(bytes)).digest('hex')));
    bodies.add(body); body.finally(() => bodies.delete(body));
  }
  return response;
};
await page.route('**/api/cameras/ottawa-snapshot?*', async route => {
  if (!isFrame(route.request().url())) return route.continue();
  if (mode === 'fail') { mode = 'normal'; return route.abort('failed'); }
  if (mode === 'hold') { mode = 'normal'; await new Promise(resolve => { release = resolve; }); }
  return route.continue();
});
const image = page.locator('.camera-preview-image img');
async function loaded() { await page.waitForFunction(() => { const image = document.querySelector('.camera-preview-image img'); return image?.complete && image.naturalWidth > 0 && document.querySelector('.snapshot-status')?.textContent.includes('Image fetched at'); }); }
async function nextFrame(before) { await page.waitForFunction(url => { const image = document.querySelector('.camera-preview-image img'); return image && image.dataset.sourceUrl !== url && image.complete && image.naturalWidth > 0; }, before, { timeout: 12000 }); await loaded(); await Promise.all([...bodies]); }
try {
  const sample = canadian.sources.find(s => s.id === 'ottawa').cameras.find(c => c.cameraNumber === 16);
  await page.goto(`http://127.0.0.1:${server.address().port}/#camera?country=Canada&place=Ottawa`);
  await page.getByLabel('Camera source').selectOption('Ottawa Traffic Cameras'); await page.getByLabel('Search cameras').fill(sample.name);
  await page.locator('.camera-list-select').first().click(); await loaded();
  await page.getByText('Auto-refresh every 5 seconds', { exact: false }).waitFor();
  for (let attempt = 0; attempt < 5 && new Set(frames.values()).size < 2; attempt++) await nextFrame(await image.getAttribute('data-source-url'));
  assert(new Set(frames.values()).size >= 2, 'Automatic updates display different actual provider image bytes, not just different request URLs');
  report.checks.push('Ottawa automatically requests timems frames every five seconds and displays changing actual provider image content');
  await page.getByRole('button', { name: 'Pause updates', exact: true }).click(); await loaded();
  const pausedCount = requests.length; await page.waitForTimeout(5600); assert.equal(requests.length, pausedCount);
  report.checks.push('Pause stops automatic image requests');
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = await (await fetch(`${base}/api/cameras`)).json();
  await page.route('**/api/cameras?refresh=1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(directory) }));
  const beforeToolbar = await image.getAttribute('data-source-url');
  await page.getByRole('button', { name: 'Refresh camera directory and images', exact: true }).click(); await loaded();
  assert.notEqual(await image.getAttribute('data-source-url'), beforeToolbar);
  await page.waitForFunction(() => {
    const thumbnail = document.querySelector('.camera-list-select[aria-current="true"] img');
    return thumbnail?.dataset.sourceUrl?.includes('timems=') && thumbnail.complete && thumbnail.naturalWidth > 0;
  });
  assert.equal(await page.getByRole('button', { name: 'Resume updates', exact: true }).count(), 1);
  await page.unroute('**/api/cameras?refresh=1');
  report.checks.push('Toolbar refresh reloads the actual selected Ottawa image and its thumbnail using timems while retaining the paused state');
  mode = 'hold'; const previous = await image.getAttribute('data-source-url'); await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await page.getByText('Updating…', { exact: true }).waitFor();
  assert.equal(await image.getAttribute('data-source-url'), previous); assert.equal(await image.evaluate(image => getComputedStyle(image).opacity), '1');
  for (let attempt = 0; !release && attempt < 100; attempt++) await page.waitForTimeout(20);
  assert(release); release(); release = undefined; await loaded(); assert.notEqual(await image.getAttribute('data-source-url'), previous);
  report.checks.push('The previous decoded frame remains visible until the replacement loads, without a blank loading flash');
  mode = 'fail'; const lastGood = await image.getAttribute('data-source-url'); await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await page.getByText('Refresh failed. Showing the last loaded image; retry or open the camera page.', { exact: true }).waitFor(); assert.equal(await image.getAttribute('data-source-url'), lastGood);
  await page.getByRole('button', { name: 'Retry snapshot', exact: true }).click(); await loaded();
  report.checks.push('Failed refresh retains the last good image and retry recovers');
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.camera-inspector').scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/ottawa-live-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: 'artifacts/ottawa-live-mobile.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByRole('button', { name: 'Resume updates', exact: true }).click();
  const hiddenCount = requests.length; await page.waitForTimeout(5600); assert.equal(requests.length, hiddenCount);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await nextFrame(await image.getAttribute('data-source-url'));
  report.checks.push('Hidden tabs stop polling, and visible tabs resume automatically');
  await page.getByRole('button', { name: 'Close camera details', exact: true }).click(); const closedCount = requests.length;
  await page.waitForTimeout(5600); assert.equal(requests.length, closedCount);
  report.checks.push('Closing camera details stops polling; controls fit desktop and mobile');
  assert.deepEqual(report.errors, []); report.distinctProviderFrames = new Set(frames.values()).size;
  writeFileSync('artifacts/ottawa-live-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { globalThis.fetch = originalFetch; release?.(); await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
