import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles } from './map-test-fixtures.mjs';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';
const store = openStore(':memory:'), { app } = createApp({ store });
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await mockStreetTiles(page);
const directory = await (await fetch(`${base}/api/cameras`)).json();
const canadianCameras = directory.cameras.filter(c => c.country === 'Canada');
const expectedCount = canadianCameras.length;
const report = { count: expectedCount, checks: [], errors: [] }; page.on('pageerror', e => report.errors.push(e.message));
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#camera`); await page.locator('.camera-list-select').first().waitFor();
  await page.getByLabel('Camera source').selectOption('SkylineWebcams');
  await page.locator('.camera-list-select').first().waitFor(); await page.locator('.camera-list-select').first().click();
  await page.getByRole('heading', { name: 'Selected camera', exact: true }).waitFor();
  await page.getByLabel('Camera country').selectOption('Canada');
  await page.getByRole('button', { name: 'Show all cameras in Canada', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Selected camera', exact: true }).count(), 0);
  report.checks.push('Incompatible filters explain that Canadian cameras are available, and unrelated details close');
  await page.getByRole('button', { name: 'Show all cameras in Canada', exact: true }).click();
  await page.waitForFunction(count => document.querySelector('.feed-indicator strong')?.textContent === `${count.toLocaleString()} camera locations`, expectedCount);
  assert.equal(await page.getByLabel('Camera source').inputValue(), 'All sources');
  assert.equal(await page.getByLabel('Camera country').inputValue(), 'Canada');
  const names = canadianCameras.map(c => c.name);
  assert(names.includes('CN Tower Cam - East View')); assert(names.includes('CN Tower Cam - West View'));
  assert(names.includes('Niagara Falls - The Falls Cam')); assert(names.includes('Niagara Falls Cam - Panorama View'));
  assert(names.includes('Kingston Peninsula Princess Ferry'));
  report.checks.push(`Country recovery shows ${expectedCount.toLocaleString()} Canadian entries across EarthCam and the official traffic camera feeds`);
  await page.waitForTimeout(850); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/canada-globe-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('img', { name: 'World map with research locations' }).waitFor();
  const viewBox = (await page.locator('.flat-map').getAttribute('viewBox')).split(' ').map(Number);
  assert(viewBox[0] < 100 && viewBox[0] + viewBox[2] > 115, 'Canadian longitudes lie inside the focused map');
  const markers = await page.locator('.map-point title').allTextContents();
  for (const name of names) assert(markers.some(label => label.includes(name)), `${name} is plotted`);
  report.checks.push('Country selection focuses the map and every Canadian camera is represented by a marker or cluster');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.waitForFunction(() => [...document.querySelectorAll('.map-point circle:last-of-type')].every(circle => { const box = circle.getBoundingClientRect(); return Math.min(box.width, box.height) >= 9; }));
  const markerSizes = await page.locator('.map-point').evaluateAll(groups => groups.map(g => { const box = g.querySelector('circle:last-of-type').getBoundingClientRect(); return Math.min(box.width, box.height); }));
  assert(markerSizes.length > 0 && markerSizes.every(size => size >= 9), `Map pins remain visible on mobile: ${JSON.stringify(markerSizes)}`);
  report.checks.push('Mobile map pins have readable cluster counts and stable visible sizes');
  await page.screenshot({ path: 'artifacts/canada-map-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Search cameras').fill('CN Tower Cam - East View'); await page.locator('.camera-list-select').filter({ hasText: 'CN Tower Cam - East View' }).click();
  await page.getByRole('heading', { name: 'CN Tower Cam - East View', exact: true }).waitFor();
  const source = await page.getByRole('link', { name: /Open live camera/ }).getAttribute('href');
  assert(source.includes('/world/canada/toronto/'));
  await page.getByLabel('Camera country').selectOption('United States');
  await page.getByRole('heading', { name: 'Explore cameras', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Canada', exact: true }).click();
  await page.waitForFunction(count => document.querySelector('.feed-indicator strong')?.textContent === `${count.toLocaleString()} camera locations`, expectedCount);
  await page.reload(); await page.waitForFunction(count => document.querySelector('.feed-indicator strong')?.textContent === `${count.toLocaleString()} camera locations`, expectedCount);
  report.checks.push('Canadian source opens correctly, the Canada shortcut resets filters, and the country link survives reload');
  for (const provider of ['Toronto Traffic Cameras', 'Calgary Traffic Cameras', 'DriveBC', 'Québec 511']) {
    await page.getByLabel('Camera source').selectOption(provider);
    await page.locator('.camera-list-select').first().waitFor();
    await page.locator('.camera-list-select').first().click();
    if (provider === 'Québec 511') {
      await page.waitForFunction(() => document.querySelector('.snapshot-status')?.textContent.includes('Image fetched at') || document.querySelector('.snapshot-error'));
      const link = await page.getByRole('link', { name: /Open camera page/ }).getAttribute('href'); assert(link.includes('quebec511.info'));
      assert(await page.getByRole('button', { name: /(?:Refresh|Retry) snapshot/ }).isEnabled());
    } else {
      await page.waitForFunction(() => { const image = document.querySelector('.camera-preview-image img'); return image && image.complete && image.naturalWidth > 0; });
      await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
      await page.waitForFunction(() => { const image = document.querySelector('.camera-preview-image img'); return image && image.src.includes('northstar_refresh=') && image.complete && image.naturalWidth > 0; });
    }
    const details = page.locator('.camera-attribution'); await details.getByText('Source attribution & licence', { exact: true }).click();
    await details.getByRole('link').waitFor();
    report.checks.push(`${provider}: source filtering, correct image/page behavior, and source attribution`);
    if (provider === 'Toronto Traffic Cameras') {
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/canada-toronto-desktop.png', fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: 'artifacts/canada-toronto-mobile.png', fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole('button', { name: 'Close camera details', exact: true }).click();
    if (provider === 'Toronto Traffic Cameras') {
      await page.getByRole('button', { name: 'World map', exact: true }).click();
      for (let step = 0; step < 4; step++) {
        const clusters = page.getByRole('button', { name: /^Zoom to \d+ locations$/ }); if (!await clusters.count()) break;
        const width = Number((await page.locator('.flat-map').getAttribute('viewBox')).split(' ')[2]);
        if (width <= 360 / 65536) break; // City searches now start close to the city; stop at the map's zoom limit.
        await clusters.first().dispatchEvent('click');
        await page.waitForFunction(before => Number(document.querySelector('.flat-map').getAttribute('viewBox').split(' ')[2]) < before, width);
      }
      assert(Number((await page.locator('.flat-map').getAttribute('viewBox')).split(' ')[2]) < 15, 'Dense city clusters can be explored beyond the previous zoom limit');
      assert(await page.getByLabel('Select camera', { exact: true }).isVisible(), 'Overlapping cameras remain directly selectable at the zoom limit');
      report.checks.push('Dense Canadian city clusters zoom correctly and reveal smaller groups');
      await page.getByRole('button', { name: 'Show all matching cameras', exact: true }).click();
    }
  }
  assert.deepEqual(report.errors, []);
  writeFileSync('artifacts/canada-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
