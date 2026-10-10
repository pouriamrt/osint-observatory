import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles, streetTileFixture } from './map-test-fixtures.mjs';

const base = process.env.CAMERA_APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const cameras = [
  { id: 'fixture:a', name: 'Synthetic Toronto camera A', lat: 43.6532, lon: -79.3832 },
  { id: 'fixture:b', name: 'Synthetic Toronto camera B', lat: 43.65322, lon: -79.38322 }
].map(camera => ({ ...camera, provider: 'Synthetic camera fixture', source: 'Synthetic marker test', kind: 'page', country: 'Canada', url: 'https://example.org/camera' }));
await page.route('**/api/cameras', route => route.fulfill({ json: { cameras, sources: [] } }));
await page.route('**/api/live-views*', route => route.fulfill({ json: { cameras: [], orbit: [], clips: [], stale: false } }));
await mockStreetTiles(page);
await page.route('https://services.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
const report = { checks: [], errors: [] }; page.on('pageerror', error => report.errors.push(error.message));
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#camera?lat=43.65320&lon=-79.38320&radius=50`);
  const marker = page.locator('.map-point').first(); await marker.waitFor();
  await marker.scrollIntoViewIfNeeded();
  const target = await marker.boundingBox(); await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.mouse.down();
  await page.locator('.globe-canvas').screenshot({ path: 'artifacts/map-marker-pointer-down.png', animations: 'disabled' });
  const pointerOutline = await marker.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
  assert.equal(pointerOutline.style, 'none', 'Pointer-down must not paint a native SVG focus outline over the map');
  await page.mouse.up();
  await page.getByRole('button', { name: 'Close nearby cameras', exact: true }).click();
  await page.keyboard.press('Tab'); await marker.focus();
  await page.locator('.globe-canvas').screenshot({ path: 'artifacts/map-marker-focused.png', animations: 'disabled' });
  const style = await marker.evaluate(element => {
    const computed = getComputedStyle(element), scale = element.getScreenCTM(), circle = element.querySelectorAll('circle')[1];
    return { outline: computed.outlineStyle, outlineWidth: computed.outlineWidth, scale: Math.hypot(scale.a, scale.b), radius: circle.r.baseVal.value * Math.hypot(scale.a, scale.b) };
  });
  assert.equal(style.outline, 'none', 'SVG camera focus must not paint a native outline in magnified map units');
  assert(style.radius <= 10.1, 'The visible marker stays compact at a city scale');
  await marker.press('Enter'); await page.getByRole('dialog', { name: 'Cameras at this location', exact: true }).waitFor();
  await page.locator('.map-camera-choice').first().click();
  await page.getByRole('button', { name: 'Close nearby cameras', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    // ResizeObserver updates zoom and cluster keys; focus the resulting marker after layout settles.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const current = page.locator('.map-point').first(); await page.keyboard.press('Tab'); await current.focus();
    const focusState = await (await page.waitForFunction(() => {
      const marker = document.querySelector('.map-point');
      if (!marker) return false;
      // A changed viewport can replace cluster nodes; focus the final node with keyboard modality active.
      if (document.activeElement !== marker) marker.focus();
      const ring = marker.querySelector('.map-focus-ring');
      if (!ring || !marker.matches(':focus-visible') || getComputedStyle(ring).visibility !== 'visible') return false;
      const box = ring.getBoundingClientRect(); return { outline: getComputedStyle(marker).outlineStyle, width: box.width, height: box.height };
    })).jsonValue();
    assert.equal(focusState.outline, 'none');
    assert(focusState.width <= 34 && focusState.height <= 34, `Focus ring stays small at ${width}px`);
  }
  await page.getByRole('button', { name: 'Satellite map', exact: true }).click();
  const satelliteMarker = page.locator('.map-point').first(); await satelliteMarker.focus();
  assert.equal(await satelliteMarker.evaluate(element => getComputedStyle(element).outlineStyle), 'none');
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  const clicking = page.locator('.map-point').first(); await clicking.scrollIntoViewIfNeeded();
  const box = await clicking.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  assert.equal(await clicking.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'Pointer-down never paints the giant outline before click');
  await page.mouse.up();
  report.checks.push('Keyboard focus, pointer-down, cluster selection, mobile widths, and satellite/street modes keep camera markers and focus rings compact');
  assert.deepEqual(report.errors, []); writeFileSync('artifacts/map-marker-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
