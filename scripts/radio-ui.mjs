import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';

// Synthetic audio and RF samples; nothing is imported into the user's real database.
function audioFixture() {
  const rate = 8000, seconds = 20, frames = rate * seconds, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(Math.round(Math.sin(frame * Math.PI * 2 * 440 / rate) * 1000), 44 + frame * 2);
  return bytes;
}
const store = openStore(':memory:'), { app } = createApp({ store }), server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
const report = { checks: [], errors: [] }, requests = []; let failAudio = false;
page.on('pageerror', error => report.errors.push(error.message));
const bytes = audioFixture();
await context.route('https://www.broadcastify.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Controlled official-provider destination fixture</title><p>Ottawa provider player fixture</p>' }));
await context.route('https://www.ckcufm.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Controlled station destination fixture</title><p>CKCU live-player fixture</p>' }));
await page.route('https://radio.example/live.wav*', route => { requests.push(route.request().url()); return route.fulfill(failAudio ? { status: 503, body: 'Fixture audio outage' } : { contentType: 'audio/wav', body: bytes, headers: { 'Access-Control-Allow-Origin': '*' } }); });
await page.route('https://radio.example/bad.m3u8', route => route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: 'Fixture invalid HLS playlist', headers: { 'Access-Control-Allow-Origin': '*' } }));
await page.route('**/api/records/skywave', route => route.fulfill({ json: [
  { id: 'rf:1', frequency_hz: 150000000, dbm: -80, timestamp: '2026-10-09T21:00:00Z', source: 'Synthetic calibrated RF fixture' },
  { id: 'rf:2', frequency_hz: 155000000, dbm: -50, timestamp: '2026-10-09T21:00:00Z', source: 'Synthetic calibrated RF fixture' },
  { id: 'rf:3', frequency_hz: 150000000, dbm: -60, timestamp: '2026-10-09T21:01:00Z', source: 'Synthetic calibrated RF fixture' },
  { id: 'rf:4', frequency_hz: 155000000, dbm: -90, timestamp: '2026-10-09T21:01:00Z', source: 'Synthetic calibrated RF fixture' }
] }));
mkdirSync('artifacts', { recursive: true });
async function connect(url = 'https://radio.example/live.wav') {
  await page.getByLabel('Radio audio stream URL', { exact: true }).fill(url);
  await page.getByLabel('Radio stream name', { exact: true }).fill('Synthetic test audio');
  await page.getByRole('button', { name: 'Connect & listen', exact: true }).click();
}
try {
  await page.goto(`${base}/#skywave`);
  assert.equal(await page.getByRole('button', { name: 'Live audio', exact: true }).getAttribute('aria-pressed'), 'true');
  const feeds = page.getByLabel('Ottawa public radio', { exact: true });
  await feeds.getByText('Ottawa, Ontario, Canada · Public radio feeds', { exact: true }).waitFor();
  await feeds.getByText(/does not advertise Ottawa Police Service dispatch/).waitFor();
  await feeds.getByText(/Sign in with a free Broadcastify account/).waitFor();
  assert.equal(await page.locator('audio').count(), 0); assert.equal(requests.length, 0, 'Opening Skywave does not start listening or fetch stream bytes');
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Listen to EMS & OPP (Ottawa & Region) on Broadcastify', exact: true }).click();
  const popup = await popupPromise; await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://www.broadcastify.com/listen/feed/37900');
  await popup.close(); assert(page.url().endsWith('#skywave'));
  await feeds.getByRole('button', { name: /VE3OCE/ }).click();
  assert((await feeds.getByRole('link', { name: /Listen to VE3OCE/ }).getAttribute('href')).endsWith('/47504'));
  await feeds.getByRole('button', { name: /Arnprior, Carp and Rockcliffe/ }).click();
  assert((await feeds.getByRole('link', { name: /Listen to Arnprior/ }).getAttribute('href')).endsWith('/47740'));
  report.checks.push('Skywave defaults to Ottawa live-audio links, opens the correct official public-safety player, and distinguishes OPP/EMS, amateur, and aviation feeds');

  await page.getByRole('button', { name: 'Nearby frequencies', exact: true }).click();
  const frequencies = page.getByLabel('Ottawa nearby frequencies', { exact: true });
  await frequencies.getByText('6 frequencies shown', { exact: false }).waitFor();
  assert.equal(await frequencies.getByRole('article').count(), 6);
  await frequencies.getByLabel('Search Ottawa frequencies', { exact: true }).fill('122.800');
  assert.equal(await frequencies.getByRole('article').count(), 1);
  const carp = frequencies.getByRole('article', { name: 'Carp airport traffic, 122.800 MHz', exact: true });
  await carp.getByText(/individual channels cannot be selected/).waitFor();
  const frequencyPopupPromise = context.waitForEvent('page');
  await carp.getByRole('link', { name: 'Listen to Carp airport traffic on Broadcastify', exact: true }).click();
  const frequencyPopup = await frequencyPopupPromise; await frequencyPopup.waitForLoadState();
  assert.equal(frequencyPopup.url(), 'https://www.broadcastify.com/listen/feed/47740'); await frequencyPopup.close();
  await frequencies.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await frequencies.getByLabel('Frequency service', { exact: true }).selectOption('Amateur radio');
  assert.equal(await frequencies.getByRole('article').count(), 2);
  await frequencies.getByLabel('Frequency audio access', { exact: true }).selectOption('all');
  assert.equal(await frequencies.getByRole('article').count(), 4);
  const localOnly = frequencies.getByRole('article', { name: 'VE2CRA VHF repeater, 146.940 MHz', exact: true });
  assert(await localOnly.getByText('Receiver needed', { exact: true }).isVisible());
  assert.equal(await localOnly.getByRole('link', { name: /Listen to/ }).count(), 0);
  await frequencies.getByLabel('Search Ottawa frequencies', { exact: true }).fill('no such frequency');
  await frequencies.getByRole('heading', { name: 'No matching frequencies', exact: true }).waitFor();
  await frequencies.getByRole('button', { name: 'Reset frequency filters', exact: true }).click();
  await frequencies.getByLabel('Frequency service', { exact: true }).selectOption('FM radio');
  const stationPopupPromise = context.waitForEvent('page');
  await frequencies.getByRole('link', { name: 'Listen to CKCU community radio on CKCU', exact: true }).click();
  const stationPopup = await stationPopupPromise; await stationPopup.waitForLoadState();
  assert.equal(stationPopup.url(), 'https://www.ckcufm.com/'); await stationPopup.close();
  await frequencies.getByRole('button', { name: 'Reset filters', exact: true }).click();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Frequency directory fits ${width}px`);
    assert(await frequencies.getByLabel('Search Ottawa frequencies', { exact: true }).isVisible());
  }
  await page.screenshot({ path: 'artifacts/radio-frequencies-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/radio-frequencies-desktop.png', fullPage: true, animations: 'disabled' });
  assert.equal(await page.locator('audio').count(), 0); assert.equal(requests.length, 0);
  report.checks.push('Ottawa frequencies search by MHz, callsign and service, distinguish shared feeds from receiver-only entries, open the correct providers, and fit desktop/mobile without starting audio');
  await page.getByRole('button', { name: 'Live audio', exact: true }).click();

  await connect('javascript:alert(1)'); await page.getByRole('alert').getByText(/HTTP or HTTPS/).waitFor(); assert.equal(await page.locator('audio').count(), 0);
  await connect('https://www.broadcastify.com/listen/feed/37900'); await page.getByRole('alert').getByText(/Listen on Broadcastify/).waitFor();
  await connect();
  const player = page.getByLabel('Direct audio player', { exact: true });
  await player.getByRole('status').getByText('Playing', { exact: true }).waitFor();
  assert(await player.locator('audio').evaluate(audio => audio.readyState >= 2 && !audio.paused));
  await player.locator('audio').evaluate(audio => audio.pause()); await player.getByRole('status').getByText('Paused', { exact: true }).waitFor();
  await player.locator('audio').evaluate(audio => audio.play()); await player.getByRole('status').getByText('Playing', { exact: true }).waitFor();
  const oldAudio = await player.locator('audio').elementHandle();
  await player.getByRole('button', { name: 'Stop audio', exact: true }).click();
  assert.equal(await page.locator('audio').count(), 0); assert(await oldAudio.evaluate(audio => audio.paused && !audio.getAttribute('src')));
  report.checks.push('Direct audio starts after a user action, decodes synthetic audio, pauses/resumes, rejects provider pages and unsafe URLs, and releases playback on Stop');

  await connect(); await player.getByRole('status').getByText('Playing', { exact: true }).waitFor();
  const directoryAudio = await player.locator('audio').elementHandle();
  await page.getByRole('button', { name: 'Nearby frequencies', exact: true }).click();
  await frequencies.getByRole('heading', { name: 'Frequencies around Ottawa', exact: true }).waitFor();
  assert(await directoryAudio.evaluate(audio => audio.paused && !audio.getAttribute('src')));
  assert.equal(await page.locator('audio').count(), 0);
  report.checks.push('Opening the frequency directory releases a direct stream instead of leaving hidden audio playing');
  await page.getByRole('button', { name: 'Live audio', exact: true }).click();

  failAudio = true; await connect('https://radio.example/live.wav?outage=1');
  await player.getByRole('status').getByText('Unavailable', { exact: true }).waitFor(); assert(await player.getByRole('link', { name: 'Open audio source', exact: true }).isVisible());
  failAudio = false; await player.getByRole('button', { name: 'Reconnect audio', exact: true }).click();
  await player.getByRole('status').getByText('Playing', { exact: true }).waitFor();
  const hlsAudio = await player.locator('audio').elementHandle(); await connect('https://radio.example/bad.m3u8');
  await player.getByRole('status').getByText('Unavailable', { exact: true }).waitFor();
  assert(await hlsAudio.evaluate(audio => audio.paused && !audio.getAttribute('src')));
  report.checks.push('Provider outages and invalid HLS produce actionable errors; reconnect recovers and switching sources releases the old connection');

  await connect(); await player.getByRole('status').getByText('Playing', { exact: true }).waitFor();
  const leavingAudio = await player.locator('audio').elementHandle();
  await page.getByRole('button', { name: 'Spectrum captures', exact: true }).click();
  assert(await leavingAudio.evaluate(audio => audio.paused && !audio.getAttribute('src'))); assert.equal(await page.locator('audio').count(), 0);
  await page.getByRole('heading', { name: 'Spectrum analyzer', exact: true }).waitFor();
  await page.getByText('150.000000 MHz · -60 dBm', { exact: true }).waitFor();
  await page.getByLabel('Spectrum sample slider', { exact: true }).press('Home');
  await page.getByText('155.000000 MHz · -50 dBm', { exact: true }).waitFor();
  assert.equal(await page.locator('.waterfall').count(), 1);
  assert(await page.getByRole('button', { name: 'Import spectrum', exact: true }).isVisible());
  report.checks.push('Switching to spectrum analysis stops audio; the existing frequency plot, sample scrubbing, waterfall, and importer remain usable');

  await page.getByRole('button', { name: 'Live audio', exact: true }).click(); await connect(); await player.getByRole('status').getByText('Playing', { exact: true }).waitFor();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px has no horizontal overflow`);
    const audioBox = await player.locator('audio').boundingBox(); assert(audioBox.width >= Math.min(210, width - 90));
    assert(await page.getByRole('button', { name: 'Stop audio', exact: true }).isVisible());
  }
  await page.screenshot({ path: 'artifacts/radio-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: 'artifacts/radio-desktop.png', fullPage: true, animations: 'disabled' });
  const navigatingAudio = await player.locator('audio').elementHandle();
  await page.getByRole('button', { name: 'Sources & settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Sources & settings', exact: true }).waitFor();
  assert(await navigatingAudio.evaluate(audio => audio.paused && !audio.getAttribute('src')));
  assert.deepEqual(report.errors, []); report.checks.push('Desktop/mobile controls fit down to 320px; navigating away releases audio without application errors');
  writeFileSync('artifacts/radio-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
