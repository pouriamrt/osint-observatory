import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles } from './map-test-fixtures.mjs';
import { createApp } from '../server/index.mjs';
import { openStore, now } from '../server/core.mjs';

// Real catalogue, isolated workspace, controlled image/network failures.
const store = openStore(':memory:');
const canadian = JSON.parse(readFileSync(new URL('../server/sources/canadian-cameras.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../server/sources/camera-catalog.json', import.meta.url)));
for (const source of canadian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source.cameras), now());
store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('camera-earthcam', JSON.stringify(catalog.earthcam), now());
store.importRows('camera', [{ name: 'Camera page without an image', lat: 45.4, lon: -75.7, url: 'https://example.org/camera-page', source: 'Synthetic browser-test fixture', country: 'Canada', kind: 'page' }]);
const { app } = createApp({ store }), server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const directory = await (await fetch(`${base}/api/cameras`)).json();
const ottawa = directory.cameras.filter(c => c.provider === 'Ottawa Traffic Cameras').sort((a, b) => a.name.localeCompare(b.name));
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await mockStreetTiles(page);
const report = { ottawaCount: ottawa.length, checks: [], errors: [] }, imageRequests = [];
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
let imageMode = 'normal', releaseImages, releaseDirectory;
page.on('pageerror', error => report.errors.push(error.message));
await page.route(/^(http:\/\/127\.0\.0\.1:\d+\/api\/cameras\/ottawa-snapshot\?|https:\/\/(traffic\.ottawa\.ca\/camera\?|opendata\.toronto\.ca\/.*CameraImages\/|trafficcam\.calgary\.ca\/loc|www\.drivebc\.ca\/images\/|www\.quebec511\.info\/Images\/Cameras\/))/,  async route => {
  imageRequests.push(route.request().url());
  if (imageMode === 'hold') await new Promise(resolve => { (releaseImages ||= []).push(resolve); });
  if (imageMode === 'fail' || route.request().url().includes('quebec511.info')) return route.fulfill({ status: 403, body: 'Provider image rejected' });
  return route.fulfill({ contentType: 'image/png', body: pixel });
});
const selectedImage = page.locator('.camera-preview-image img');
async function loaded() {
  await page.waitForFunction(() => {
    const image = document.querySelector('.camera-preview-image img');
    return image?.complete && image.naturalWidth > 0 && document.querySelector('.snapshot-status')?.textContent.includes('Image fetched at');
  });
}
async function pause() {
  const button = page.getByRole('button', { name: 'Pause updates', exact: true });
  if (await button.count()) await button.click();
}
async function imageLoadedInList() {
  await page.waitForFunction(() => document.querySelector('.camera-list-select[aria-current="true"] img')?.naturalWidth > 0);
}
async function noOverflow(width) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px horizontal overflow`);
  assert(await page.getByLabel('Select camera', { exact: true }).isVisible());
  assert(await page.getByLabel('Next camera', { exact: true }).isVisible());
  assert(await page.locator('.camera-browser .camera-list').isVisible());
}
mkdirSync('artifacts', { recursive: true });
try {
  assert.equal(ottawa.length, 428);
  await page.goto(`${base}/#camera?country=Canada&place=Ottawa`);
  await page.locator('.camera-list-select').first().waitFor();
  assert.equal(await page.locator('.feed-indicator strong').textContent(), '428 camera locations');
  assert.deepEqual(await page.locator('#camera-selection option:not([value=""])').evaluateAll(options => options.map(option => option.value)), ottawa.map(c => c.id));
  await page.getByLabel('Select camera', { exact: true }).selectOption(ottawa[0].id);
  await loaded(); await pause();
  const previewBox = await page.locator('.camera-preview-image').boundingBox(), workspaceBox = await page.locator('.camera-workspace').boundingBox(), mapBox = await page.locator('.camera-workspace .globe-canvas').boundingBox();
  assert(previewBox.width >= 600 && previewBox.width >= workspaceBox.width * .6, 'Camera Globe gives the selected view most of the lower workspace');
  assert(mapBox.width >= workspaceBox.width - 2 && mapBox.height >= 520, 'The map spans the full workspace at the same scale as Satellite views');
  assert.equal(await selectedImage.evaluate(image => getComputedStyle(image).objectFit), 'contain', 'The complete camera frame stays visible');
  await page.getByRole('button', { name: 'Expand camera view', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('camera-preview-panel'));
  const expandedBox = await selectedImage.boundingBox(), viewport = page.viewportSize();
  assert(expandedBox.width >= viewport.width - 2 && expandedBox.height >= viewport.height * .6, 'Expanded camera frames fill the viewing area');
  assert(await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).isVisible());
  assert(await page.getByRole('button', { name: 'Resume updates', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Exit expanded camera view', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement === null);
  assert(Math.abs((await page.locator('.camera-preview-image').boundingBox()).width - previewBox.width) < 2);
  report.checks.push('Camera Globe uses a full-width map and wide camera frame by default; Expand view fills the screen, retains refresh/pause controls, and restores the normal layout on exit');
  assert.equal(await page.locator('.camera-list-select').count(), 60);
  assert(await page.getByLabel('Previous camera', { exact: true }).isDisabled());
  await page.getByLabel('Next camera', { exact: true }).click(); await loaded();
  assert.equal(await page.getByLabel('Select camera', { exact: true }).inputValue(), ottawa[1].id);
  await page.getByLabel('Previous camera', { exact: true }).click(); await loaded();
  assert.equal(await page.getByLabel('Select camera', { exact: true }).inputValue(), ottawa[0].id);
  await page.getByLabel('Select camera', { exact: true }).selectOption(ottawa.at(-1).id); await loaded(); await pause();
  assert.equal(await page.locator('.camera-list-select').count(), 428);
  assert(await page.getByLabel('Next camera', { exact: true }).isDisabled());
  assert.equal(await page.locator('.camera-list-select[aria-current="true"] strong').textContent(), ottawa.at(-1).name);
  assert(await page.locator('.camera-list').evaluate(list => list.scrollTop > 0));
  await page.locator('.camera-list-select').filter({ hasText: ottawa[5].name }).click(); await loaded(); await pause();
  assert.equal(await page.getByLabel('Select camera', { exact: true }).inputValue(), ottawa[5].id);
  report.checks.push('All 428 Ottawa entries remain selectable with details open, including beyond the first 60; previous/next, direct selection, list selection, highlights, and boundary controls work');

  await page.getByRole('button', { name: 'World map', exact: true }).click();
  assert(Number((await page.locator('.flat-map').getAttribute('viewBox')).split(' ')[2]) < 5, 'Ottawa browsing starts at a city scale');
  const cluster = page.getByRole('button', { name: /^Zoom to \d+ locations$/ }).first();
  await cluster.waitFor(); await cluster.dispatchEvent('click');
  await page.getByRole('button', { name: 'Show all matching cameras', exact: true }).waitFor();
  const groupCount = await page.locator('#camera-selection option:not([value=""])').count();
  assert(groupCount > 1 && groupCount <= 428);
  assert.equal(await page.locator('.feed-indicator strong').textContent(), '428 camera locations');
  assert.equal(await page.getByRole('heading', { name: 'Selected camera', exact: true }).count(), 1);
  await page.getByLabel('Next camera', { exact: true }).click(); await loaded();
  await page.getByRole('button', { name: 'Show all matching cameras', exact: true }).click();
  assert.equal(await page.locator('#camera-selection option:not([value=""])').count(), 428);
  report.checks.push('Crowded map markers expose a switchable group; all filtered map locations and the full results list stay available');

  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  const canvas = page.locator('.globe-canvas canvas'); await canvas.waitFor();
  // The globe's documented focus transition lasts 700ms.
  await page.waitForTimeout(800);
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Show all matching cameras', exact: true }).waitFor();
  assert(await page.locator('#camera-selection option:not([value=""])').count() > 1);
  await page.getByRole('button', { name: 'Show all matching cameras', exact: true }).click();
  report.checks.push('A crowded 3D globe hit offers nearby cameras instead of trapping selection on one overlapping marker');

  await pause(); await imageLoadedInList();
  const before = await selectedImage.getAttribute('data-source-url');
  const thumbnail = page.locator('.camera-list-select[aria-current="true"] img');
  const beforeThumbnail = await thumbnail.getAttribute('data-source-url');
  await page.route('**/api/cameras?refresh=1', async route => {
    await new Promise(resolve => { releaseDirectory = resolve; });
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Directory refresh fixture unavailable' }) });
  });
  imageMode = 'hold';
  await page.getByLabel('Refresh camera directory and images', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera-preview-image')?.getAttribute('aria-busy') === 'true');
  assert.equal(await selectedImage.getAttribute('data-source-url'), before);
  assert.equal(await thumbnail.getAttribute('data-source-url'), beforeThumbnail);
  assert.equal(await selectedImage.evaluate(image => getComputedStyle(image).opacity), '1');
  for (let attempt = 0; attempt < 1000 && (!releaseImages?.length || !releaseDirectory); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert(releaseImages?.length && releaseDirectory, 'Refresh sends image and metadata requests independently');
  imageMode = 'normal'; releaseImages.forEach(resolve => resolve()); releaseImages = undefined;
  await loaded(); await imageLoadedInList();
  assert.notEqual(await selectedImage.getAttribute('data-source-url'), before);
  assert(imageRequests.includes(await selectedImage.getAttribute('data-source-url')));
  assert.notEqual(await thumbnail.getAttribute('data-source-url'), beforeThumbnail);
  assert.equal(await page.getByRole('button', { name: 'Resume updates', exact: true }).count(), 1);
  assert(await page.getByLabel('Refresh camera directory and images', { exact: true }).isDisabled());
  releaseDirectory(); releaseDirectory = undefined;
  await page.getByText('Directory refresh fixture unavailable', { exact: true }).waitFor();
  await page.unroute('**/api/cameras?refresh=1');
  report.checks.push('Toolbar refresh reloads the selected Ottawa image and thumbnails before slow metadata completes, preserves frames while pending, respects pause, and works despite metadata failure');

  imageMode = 'fail';
  const lastGood = await selectedImage.getAttribute('data-source-url');
  await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await page.locator('.snapshot-error').waitFor();
  assert.equal(await selectedImage.getAttribute('data-source-url'), lastGood);
  assert((await page.locator('.snapshot-error').textContent()).includes('Showing the last loaded image'));
  imageMode = 'normal'; await page.getByRole('button', { name: 'Retry snapshot', exact: true }).click(); await loaded();
  assert.notEqual(await selectedImage.getAttribute('data-source-url'), lastGood);
  report.checks.push('A rejected refresh retains the last successful frame and explicit retry recovers');

  for (const width of [1440, 1024, 768, 390, 320]) {
    await noOverflow(width);
    const frame = await page.locator('.camera-preview-image').boundingBox();
    assert(frame.width >= Math.min(600, width - 65), `Camera frame remains wide at ${width}px`);
  }
  await page.screenshot({ path: 'artifacts/camera-browsing-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/camera-browsing-desktop.png', fullPage: true, animations: 'disabled' });
  report.checks.push('Desktop, tablet, and mobile keep the preview, switching controls, and scrollable results accessible without horizontal overflow');

  for (const provider of ['Toronto Traffic Cameras', 'Calgary Traffic Cameras', 'DriveBC']) {
    await page.getByLabel('Search cameras', { exact: true }).fill('');
    await page.getByLabel('Camera source', { exact: true }).selectOption(provider);
    await page.locator('.camera-list-select').first().click(); await loaded(); await pause();
    const before = await selectedImage.getAttribute('data-source-url');
    await page.route('**/api/cameras?refresh=1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(directory) }));
    await page.getByLabel('Refresh camera directory and images', { exact: true }).click(); await loaded();
    assert.notEqual(await selectedImage.getAttribute('data-source-url'), before);
    assert((await selectedImage.getAttribute('data-source-url')).includes('northstar_refresh='));
    await page.unroute('**/api/cameras?refresh=1');
  }
  report.checks.push('Toolbar refresh sends new Canadian snapshot requests for Toronto, Calgary, and DriveBC');
  await page.getByLabel('Camera source', { exact: true }).selectOption('Québec 511');
  await page.getByLabel('Search cameras', { exact: true }).fill('Murdochville');
  await page.locator('.camera-list-select').first().click(); await page.locator('.snapshot-error').waitFor(); await pause();
  const beforeRequests = imageRequests.length;
  await page.getByRole('button', { name: 'Retry snapshot', exact: true }).click();
  await page.locator('.snapshot-error').waitFor();
  assert(imageRequests.length > beforeRequests);
  assert.equal(await page.getByRole('link', { name: 'Open camera page', exact: true }).getAttribute('href'), 'https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=3857');
  report.checks.push('Québec provider rejection stays distinct from refresh behavior; retry requests the published image and the official viewing page remains available');
  await page.getByLabel('Camera source', { exact: true }).selectOption('My cameras');
  await page.getByLabel('Search cameras', { exact: true }).fill('Camera page without an image');
  await page.locator('.camera-list-select').click();
  await page.getByText('This source provides a camera page without an inline image.', { exact: true }).waitFor();
  await page.route('**/api/cameras?refresh=1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(directory) }));
  await page.getByLabel('Refresh camera directory and images', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh camera directory and images"]')?.disabled);
  assert.equal(await page.locator('.camera-preview-image').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('.camera-image-loading').count(), 0);
  report.checks.push('Refreshing a page-only camera without an image preserves its unavailable state without a stuck loader');
  assert.deepEqual(report.errors, []);
  writeFileSync('artifacts/camera-browsing-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  releaseImages?.forEach(resolve => resolve()); releaseDirectory?.();
  await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close();
}
