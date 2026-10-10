import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';
import { streetTileFixture } from './map-test-fixtures.mjs';
import { liveViewFixture } from './live-view-fixtures.mjs';

const store = openStore(':memory:'), { app } = createApp({ store }), server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const report = { checks: [], errors: [] }, players = [], images = []; let failStreams = false, rotateStream = false;
page.on('pageerror', error => report.errors.push(error.message));
await page.clock.install({ time: new Date('2026-10-09T22:00:00Z') });
await page.route('**/api/live-views*', route => {
  const data = structuredClone(liveViewFixture);
  if (rotateStream) data.cameras[0].videoId = 'replacement';
  return route.fulfill(failStreams ? { status: 503, json: { error: 'Fixture live listing outage' } } : { json: data });
});
await page.route('**/api/cameras', route => route.fulfill({ json: { sources: [], cameras: [
  { id: 'fixture:snapshot', name: 'Fixture Ottawa road snapshot', lat: 45.4215, lon: -75.6972, country: 'Canada', source: 'Fixture Canadian road cameras', provider: 'Fixture Canadian road cameras', kind: 'page', mediaType: 'snapshot', thumbnail: 'https://example.org/road.jpg', url: 'https://example.org/road-camera', attribution: 'Controlled browser-test camera fixture' },
  { id: 'fixture:page', name: 'Fixture Ottawa provider player', lat: 45.4385, lon: -75.716, country: 'Canada', source: 'Fixture provider', provider: 'Fixture provider', kind: 'page', url: 'https://example.org/camera-page' },
  { id: 'fixture:hls', name: 'Fixture Ottawa HLS stream', lat: 45.4115, lon: -75.6872, country: 'Canada', source: 'My camera', provider: 'My cameras', kind: 'hls', url: 'https://example.org/feed.m3u8' }
] } }));
await page.route('https://example.org/road.jpg*', route => { images.push(route.request().url()); return route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }); });
await page.route('https://example.org/feed.m3u8', route => route.fulfill({ contentType: 'application/vnd.apple.mpegurl', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Controlled invalid-manifest fixture' }));
await page.route('https://services.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
await page.route('https://www.youtube-nocookie.com/**', route => { players.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Controlled provider video player fixture</p>' }); });
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#satellite`);
  await page.getByRole('button', { name: 'Watch Times Square North', exact: true }).waitFor();
  await page.getByText('Browse & watch cameras', { exact: true }).click();
  assert(page.url().endsWith('#satellite'), 'Browsing the camera panel must preserve the satellite route');
  await page.getByRole('button', { name: 'Select Fixture Ottawa road snapshot', exact: true }).locator('circle').first().click();
  const selected = page.getByLabel('Selected street camera', { exact: true });
  await selected.getByText('Refreshing snapshot', { exact: true }).waitFor();
  await selected.locator('.camera-preview-image>img').waitFor();
  await page.waitForFunction(() => document.querySelector('.camera-preview-image>img')?.naturalWidth > 0);
  assert((await selected.getByRole('link', { name: 'Open camera provider', exact: true }).getAttribute('href')).includes('/road-camera'));
  const firstCount = images.length;
  await page.clock.runFor(61000); await page.waitForFunction(() => document.querySelector('.camera-preview-image>img')?.complete);
  assert(images.length > firstCount, 'Snapshots request another frame on their timer');
  await selected.getByRole('button', { name: 'Pause updates', exact: true }).click();
  const pausedCount = images.length; await page.clock.runFor(61000); assert.equal(images.length, pausedCount);
  await selected.getByRole('button', { name: 'Expand camera view', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('camera-preview-panel'));
  assert.equal(await selected.locator('.camera-preview-image img').evaluate(image => getComputedStyle(image).objectFit), 'contain');
  assert(await selected.getByRole('button', { name: 'Resume updates', exact: true }).isVisible());
  await selected.getByRole('button', { name: 'Exit expanded camera view', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement === null);
  report.checks.push('Satellite camera pins open nearby Canadian snapshots; frame refresh and pause work with honest source labels');
  report.checks.push('Satellite camera previews share the fullscreen expand/exit control and retain snapshot controls and the full source frame');

  await page.getByLabel('Camera pins', { exact: false }).uncheck();
  assert.equal(await page.locator('.map-point').count(), 0);
  await page.getByLabel('Camera pins', { exact: false }).check();
  await page.getByLabel('Choose nearby satellite camera', { exact: true }).selectOption('fixture:page');
  await selected.getByText('Watch on the camera’s website', { exact: true }).waitFor();
  assert.equal(await selected.getByRole('link', { name: 'Open camera provider', exact: true }).getAttribute('href'), 'https://example.org/camera-page');
  await page.getByLabel('Search nearby satellite cameras', { exact: true }).fill('no matching camera');
  await page.getByText(/No matching cameras within/).waitFor();
  await page.getByLabel('Search nearby satellite cameras', { exact: true }).fill('');
  report.checks.push('Pins can be hidden; nearby search, directory selection, and provider-only views work without false live-video labels');

  for (const [name, videoId] of [['Times Square North', 'JQ_jwk_7OVE'], ['Abbey Road crossing', 'zMCea32gpmg'], ['Bourbon Street', 'xqdukYhcGEU']]) {
    await page.getByRole('button', { name: `Watch ${name}`, exact: true }).click();
    const player = selected.locator('iframe'); await player.waitFor();
    assert((await player.getAttribute('src')).includes(`/embed/${videoId}?autoplay=0`));
    assert.equal(await player.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
    assert.equal(await selected.locator('.view-status.is-live').count(), 1);
    await selected.getByRole('button', { name: 'Reload camera video', exact: true }).click();
    await selected.getByRole('button', { name: 'Stop camera video', exact: true }).click(); assert.equal(await player.count(), 0);
    await selected.getByRole('button', { name: 'Load camera video', exact: true }).click(); await player.waitFor();
  }
  assert(players.length >= 3);
  report.checks.push('Three public camera streams load, switch, reload, stop, and move the map to their locations');
  await page.getByRole('button', { name: 'Watch Times Square North', exact: true }).click();
  rotateStream = true;
  await page.getByRole('button', { name: 'Check live camera broadcasts', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.satellite-camera-player iframe')?.src.includes('/replacement?'));
  failStreams = true;
  await page.getByRole('button', { name: 'Check live camera broadcasts', exact: true }).click();
  await selected.getByText('Status unverified', { exact: true }).waitFor();
  assert.equal(await selected.locator('.is-live').count(), 0);
  assert.equal(await selected.getByRole('link', { name: 'Open camera provider', exact: true }).count(), 1);
  failStreams = false;
  await page.getByRole('button', { name: 'Retry camera sources', exact: true }).click();
  await selected.getByText('Live at last check', { exact: true }).waitFor();
  report.checks.push('Replacement stream IDs reach the player; metadata outages remove live badges, retain provider links, and recover on retry');

  await page.getByRole('button', { name: 'Load ISS live video', exact: true }).click();
  assert((await page.locator('#iss-live-video iframe').getAttribute('src')).includes('/awQzjn72bI0?'));
  await page.getByLabel('ISS camera', { exact: true }).selectOption('station');
  assert((await page.locator('#iss-live-video iframe').getAttribute('src')).includes('/M3HKLzjvKPc?'));
  await page.getByRole('button', { name: 'Stop video', exact: true }).click();
  await page.getByRole('button', { name: 'Load recorded satellite clip', exact: true }).click();
  const clips = page.getByLabel('Recorded satellite video', { exact: true });
  assert((await clips.locator('iframe').getAttribute('src')).includes('/2ES8qg5OdC4?'));
  assert.equal(await clips.locator('.is-live').count(), 0);
  await clips.getByText('Recorded · not live', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop satellite clip', exact: true }).click(); assert.equal(await clips.locator('iframe').count(), 0);
  report.checks.push('Current official ISS streams play separately from the clearly labeled recorded SkySat satellite clip');

  await page.getByRole('button', { name: 'Ottawa', exact: true }).click();
  await page.getByLabel('Choose nearby satellite camera', { exact: true }).selectOption('fixture:hls');
  await selected.getByText('Video stream · unverified', { exact: true }).waitFor();
  await selected.locator('video').evaluate(video => { void video.play().catch(() => {}); });
  await selected.getByText(/(?:The video stream could not load|Video playback failed)\. Retry or open the provider below\./).waitFor();
  await selected.getByRole('button', { name: 'Stop camera video', exact: true }).click();
  assert.equal(await selected.locator('video').count(), 0);
  report.checks.push('Imported HLS streams use browser playback with an actionable outage state and release their player when stopped');
  await page.getByRole('button', { name: 'Watch Times Square North', exact: true }).click();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.clock.runFor(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px has no horizontal overflow`);
    const playerBox = await selected.locator('iframe').boundingBox(); assert(playerBox.width >= Math.min(220, width - 60), `${width}px player remains usable`);
  }
  await page.screenshot({ path: 'artifacts/live-views-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.clock.runFor(300);
  await page.screenshot({ path: 'artifacts/live-views-desktop.png', fullPage: true, animations: 'disabled' });
  assert.deepEqual(report.errors, []); report.checks.push('Camera browser and all video sections stay usable from 320px through desktop with no application errors');
  writeFileSync('artifacts/live-views-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
