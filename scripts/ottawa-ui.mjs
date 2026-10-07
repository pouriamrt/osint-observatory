import assert from 'node:assert/strict';
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
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await mockStreetTiles(page);
const report = { checks: [], errors: [] }; page.on('pageerror', error => report.errors.push(error.message));
const cameras = canadian.sources.find(source => source.id === 'ottawa').cameras, camera = cameras.find(camera => camera.cameraNumber === 16);
async function count() { await page.waitForFunction(expected => document.querySelector('.feed-indicator strong')?.textContent === `${expected.toLocaleString()} camera locations`, cameras.length); }
async function loaded() { await page.waitForFunction(() => { const image = document.querySelector('.camera-preview-image img'); return image?.complete && image.naturalWidth > 0 && document.querySelector('.snapshot-status')?.textContent.includes('Image fetched at'); }); }
try {
  await page.goto(`${base}/#camera?country=Canada&place=Ottawa`); await count();
  assert.equal(await page.getByLabel('Camera country').inputValue(), 'Canada'); assert.equal(await page.getByLabel('Search cameras').inputValue(), 'Ottawa');
  await page.reload(); await count();
  report.checks.push('Direct Ottawa link selects Canada and Ottawa, shows all 428 locations, and survives reload');
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  const labels = await page.locator('.map-point title').allTextContents();
  for (const camera of cameras) assert(labels.some(label => label.includes(camera.name)), `Camera is mapped: ${camera.name}`);
  report.checks.push('Every Ottawa camera is represented by a map pin or cluster');
  await page.getByLabel('Camera source').selectOption('SkylineWebcams');
  await page.getByRole('button', { name: 'Ottawa', exact: true }).click(); await count();
  assert.equal(await page.getByLabel('Camera source').inputValue(), 'All sources');
  await page.getByRole('button', { name: 'Close camera details', exact: true }).click();
  await page.getByLabel('Camera source').selectOption('Ottawa Traffic Cameras'); await page.getByLabel('Search cameras').fill(camera.name);
  await page.locator('.camera-list-select').filter({ hasText: camera.name }).first().click(); await loaded();
  const image = page.locator('.camera-preview-image img'), before = await image.getAttribute('data-source-url');
  assert(new URL(before).searchParams.get('id') === '16');
  assert.equal(await page.getByRole('link', { name: 'Open camera page', exact: true }).getAttribute('href'), camera.url);
  await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click(); await loaded(); assert.notEqual(await image.getAttribute('data-source-url'), before);
  assert(new URL(await image.getAttribute('data-source-url')).searchParams.has('timems'));
  report.checks.push('Ottawa shortcut clears conflicting filters; the real Bank & Hunt Club image loads and refreshes using its camera number');
  await page.getByText('Source attribution & licence', { exact: true }).click();
  await page.getByRole('link', { name: 'Open Government Licence – City of Ottawa', exact: true }).first().waitFor();
  await page.getByText(camera.coordinateNote, { exact: true }).waitFor();
  await page.getByText(camera.operatorCredit, { exact: true }).waitFor();
  report.checks.push('Inspector retains city licence, operator credit, and the intersection-coordinate caveat');
  await page.getByLabel('Search cameras').fill('Ottawa'); await count();
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.camera-inspector').scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/ottawa-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: 'artifacts/ottawa-mobile.png', fullPage: true, animations: 'disabled' });
  report.checks.push('Ottawa preview and map fit mobile without horizontal overflow');
  assert.deepEqual(report.errors, []); writeFileSync('artifacts/ottawa-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
