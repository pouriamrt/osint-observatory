import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mockStreetTiles } from './map-test-fixtures.mjs';
import { createApp } from '../server/index.mjs';
import { openStore, now } from '../server/core.mjs';

const store = openStore(':memory:');
const canadian = JSON.parse(readFileSync(new URL('../server/sources/canadian-cameras.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../server/sources/camera-catalog.json', import.meta.url)));
for (const source of canadian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source.cameras), now());
store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('camera-earthcam', JSON.stringify(catalog.earthcam), now());
const { app } = createApp({ store }), server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await mockStreetTiles(page);
const report = { checks: [], errors: [], requests: [] };
let mode = 'normal', release;
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (/[?&](northstar_refresh|timems)=/.test(request.url())) report.requests.push(request.url()); });
await page.route('https://opendata.toronto.ca/**/CameraImages/*.jpg*', async route => {
  if (!route.request().url().includes('northstar_refresh=')) return route.continue();
  if (mode === 'fail') { mode = 'normal'; return route.abort('failed'); }
  if (mode === 'hold') { mode = 'normal'; await new Promise(resolve => { release = resolve; }); }
  return route.continue();
});
const image = page.locator('.camera-preview-image img');
async function loaded() {
  await page.waitForFunction(() => { const img = document.querySelector('.camera-preview-image img'); return img?.complete && img.naturalWidth > 0 && document.querySelector('.snapshot-status')?.textContent.includes('Image fetched at'); });
}
async function select(provider, query = '') {
  const close = page.getByRole('button', { name: 'Close camera details', exact: true }); if (await close.count()) await close.click();
  await page.getByLabel('Camera source').selectOption(provider); await page.getByLabel('Search cameras').fill(query);
  await page.locator('.camera-list-select').first().click();
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#camera?country=Canada`);
  await page.locator('.camera-list-select').first().waitFor();
  for (const provider of ['Toronto Traffic Cameras', 'Calgary Traffic Cameras', 'DriveBC', 'Ottawa Traffic Cameras']) {
    await select(provider, provider === 'Ottawa Traffic Cameras' ? 'Bank & Hunt Club' : ''); await loaded(); const before = await image.getAttribute('data-source-url');
    await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click(); await loaded(); const after = await image.getAttribute('data-source-url');
    assert.notEqual(before, after); assert(report.requests.includes(after));
    assert(after.includes(provider === 'Ottawa Traffic Cameras' ? 'timems=' : 'northstar_refresh='));
    assert.equal(await page.locator('.camera-preview-image').getAttribute('aria-busy'), 'false');
    report.checks.push(`${provider}: actual provider image loads again with a distinct request URL and confirmed completion`);
  }
  await select('Toronto Traffic Cameras'); await loaded();
  mode = 'hold'; const before = await image.getAttribute('data-source-url');
  await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera-preview-image')?.getAttribute('aria-busy') === 'true');
  assert(await page.getByRole('button', { name: 'Loading snapshot…', exact: true }).isDisabled());
  assert.equal(await page.locator('.preview-credit').count(), 0);
  while (!release) await page.waitForTimeout(20);
  assert.equal(await image.getAttribute('data-source-url'), before);
  assert.equal(await image.evaluate(element => getComputedStyle(element).opacity), '1');
  release(); release = undefined; await loaded(); assert.notEqual(before, await image.getAttribute('data-source-url'));
  report.checks.push('Pending refresh shows loading, disables duplicate clicks, and reports completion only after image load');
  const lastSuccessful = await image.getAttribute('data-source-url');
  mode = 'fail'; await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await page.locator('.snapshot-error').waitFor();
  assert(await page.getByRole('button', { name: 'Retry snapshot', exact: true }).isEnabled());
  assert.equal(await page.locator('.preview-credit').count(), 0);
  assert((await page.locator('.camera-preview-image').boundingBox()).height > 150);
  assert.equal(await image.getAttribute('data-source-url'), lastSuccessful);
  await page.getByRole('button', { name: 'Retry snapshot', exact: true }).click(); await loaded();
  report.checks.push('Failed refresh keeps a full-size fallback, reports failure, and retry recovers with the actual provider image');
  await select('Québec 511', 'Murdochville');
  await page.waitForFunction(() => document.querySelector('.snapshot-error') || document.querySelector('.snapshot-status')?.textContent.includes('Image fetched at'));
  assert.equal(await page.getByRole('link', { name: 'Open camera page', exact: true }).getAttribute('href'), 'https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=3857');
  assert(report.requests.some(url => url.includes('/Quebec/cam/19802.jpg?')));
  assert((await page.locator('.camera-preview-image').boundingBox()).height > 150);
  if (await page.locator('.snapshot-error').count()) {
    const beforeRequests = report.requests.length;
    await page.getByRole('button', { name: 'Retry snapshot', exact: true }).click(); await page.locator('.snapshot-error').waitFor();
    assert.equal(report.requests.length, beforeRequests + 1);
    report.checks.push('Murdochville uses its published image code; provider rejection is explicit and retry sends another request');
  } else report.checks.push('Murdochville uses its published image code and loads successfully');
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/camera-preview-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: 'artifacts/camera-preview-mobile.png', fullPage: true, animations: 'disabled' });
  report.checks.push('Desktop and mobile retain a properly sized preview and accessible controls without horizontal overflow');
  assert.deepEqual(report.errors, []); writeFileSync('artifacts/camera-preview-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { release?.(); await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
