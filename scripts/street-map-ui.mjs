import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { streetTileFixture } from './map-test-fixtures.mjs';

const base = process.env.CAMERA_APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { checks: [], errors: [] }, requests = [];
let failTiles = false;
page.on('pageerror', error => report.errors.push(error.message));
await page.route('https://tile.openstreetmap.org/**', route => {
  requests.push({ url: route.request().url(), referer: route.request().headers().referer });
  return route.fulfill(failTiles ? { status: 503, body: 'Fixture tile outage' } : { contentType: 'image/svg+xml', body: streetTileFixture });
});
// Only the street provider is exercised here; camera images use controlled fixtures.
await page.route('**/api/cameras/ottawa-snapshot?*', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
async function tilesLoaded() {
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.street-tile')];
    return tiles.length > 0 && tiles.every(tile => tile.complete && tile.naturalWidth === 256);
  });
}
async function bounds() { return (await page.locator('.flat-map').getAttribute('viewBox')).split(' ').map(Number); }
async function alignment() {
  const result = await (await page.waitForFunction(() => {
    const svg = document.querySelector('.flat-map'), rect = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
    const tile = document.querySelector('.street-tile'), tileRect = tile.getBoundingClientRect();
    const [, z, x, y] = new URL(tile.src).pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png/).map(Number);
    const size = 360 / 2 ** z;
    const result = {
      errorX: tileRect.left - (rect.left + (x * size - view.x) / view.width * rect.width),
      errorY: tileRect.top - (rect.top + (y * size - view.y) / view.height * rect.height),
      widthError: tileRect.width - size / view.width * rect.width,
      credit: document.querySelector('.map-attribution').getBoundingClientRect().toJSON(),
      map: document.querySelector('.globe-canvas').getBoundingClientRect().toJSON()
    };
    return Math.abs(result.errorX) < 1 && Math.abs(result.errorY) < 1 && Math.abs(result.widthError) < 1 ? result : false;
  })).jsonValue();
  for (const key of ['errorX', 'errorY', 'widthError']) assert(Math.abs(result[key]) < 1, `${key}: tiles and camera SVG share the same screen coordinates`);
  assert(result.credit.left >= result.map.left && result.credit.right <= result.map.right + 1 && result.credit.bottom <= result.map.bottom + 1, 'Attribution stays on the map');
}
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#camera?country=Canada&place=Ottawa`);
  await tilesLoaded(); await alignment();
  assert.equal(await page.locator('#camera-selection option:not([value=""])').count(), 428);
  assert(requests.length > 0 && requests.length <= 24);
  assert(requests.every(request => request.referer === `${new URL(base).origin}/`), 'Tiles receive only the app origin as Referer');
  report.checks.push('Ottawa starts on street tiles, all 428 cameras remain selectable, and tile requests preserve origin attribution without search paths');

  const cluster = page.getByRole('button', { name: /^Zoom to \d+ locations$/ }).first();
  await cluster.dispatchEvent('click');
  await page.getByRole('dialog', { name: 'Cameras at this location', exact: true }).waitFor();
  await page.locator('.map-camera-choice').first().click();
  await page.getByRole('heading', { name: 'Selected camera', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close nearby cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Show all matching cameras', exact: true }).click();
  await page.getByLabel('Select camera', { exact: true }).selectOption('ottawa:50');
  await page.getByLabel('Search cameras', { exact: true }).fill('Bank & Hunt Club');
  await page.getByRole('heading', { name: 'Bank & Hunt Club', exact: true }).waitFor();
  await tilesLoaded(); await alignment();
  const pinError = await page.evaluate(() => {
    const svg = document.querySelector('.flat-map'), view = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
    const pin = [...svg.querySelectorAll('.map-point')].find(pin => pin.querySelector('title').textContent === 'Bank & Hunt Club');
    const actual = new DOMPoint(0, 0).matrixTransform(pin.getScreenCTM());
    // Published Ottawa coordinates, projected independently of the application helper.
    const longitude = -75.647382, latitude = 45.353713 * Math.PI / 180;
    const northing = 180 * (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI);
    return Math.hypot(actual.x - (rect.left + (longitude + 180 - view.x) / view.width * rect.width), actual.y - (rect.top + (northing - view.y) / view.height * rect.height));
  });
  assert(pinError < 1, 'Bank & Hunt Club is plotted at the actual Mercator street position');
  const beforeWheel = await bounds(), box = await page.locator('.flat-map').boundingBox();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .3);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -200);
  await page.waitForFunction(width => document.querySelector('.flat-map').viewBox.baseVal.width < width, beforeWheel[2]);
  const afterWheel = await bounds();
  assert(Math.abs(beforeWheel[0] + .75 * beforeWheel[2] - afterWheel[0] - .75 * afterWheel[2]) < beforeWheel[2] / box.width, 'Wheel zoom preserves the cursor position within one screen pixel');
  assert(Math.abs(beforeWheel[1] + .3 * beforeWheel[3] - afterWheel[1] - .3 * afterWheel[3]) < beforeWheel[3] / box.height, 'Wheel zoom preserves the cursor latitude within one screen pixel');
  assert.equal(await page.evaluate(() => scrollY), scroll);
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .7); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6 + 70, box.y + box.height * .7 + 25, { steps: 5 }); await page.mouse.up();
  const afterPan = await bounds(); assert(afterPan[0] < afterWheel[0] && afterPan[1] < afterWheel[1]);
  await tilesLoaded(); await alignment();
  report.checks.push('Crowded camera choices, accurate road/pin alignment, cursor-centered wheel zoom, and dragging work');

  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await tilesLoaded(); await alignment();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert(await page.getByLabel('Select camera', { exact: true }).isVisible());
  }
  await page.screenshot({ path: 'artifacts/street-map-fixture-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement); await tilesLoaded(); await alignment();
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  report.checks.push('Street tiles and readable attribution stay aligned on desktop, tablet, mobile, and fullscreen');

  failTiles = true; await page.reload();
  await page.getByText('Street map unavailable. Camera pins still work.', { exact: true }).waitFor();
  assert(await page.locator('.map-point').count() > 0);
  await page.getByLabel('Select camera', { exact: true }).selectOption('ottawa:50');
  await page.getByRole('heading', { name: 'Bank & Hunt Club', exact: true }).waitFor();
  failTiles = false; await page.getByRole('button', { name: 'Retry street map', exact: true }).click();
  await tilesLoaded(); await page.locator('.street-map-error').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await page.locator('.globe-canvas canvas').waitFor(); assert.equal(await page.locator('.street-tile').count(), 0);
  await page.getByRole('button', { name: 'World map', exact: true }).click(); await tilesLoaded();
  assert.deepEqual(report.errors, []);
  report.checks.push('Tile-provider outages show a retry state while camera selection and globe/map switching continue working');
  writeFileSync('artifacts/street-map-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
