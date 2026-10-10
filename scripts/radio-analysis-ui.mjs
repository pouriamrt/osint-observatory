import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';
import { inspectRadioWav } from '../server/radio-analysis.mjs';
import { checkRadioCameras, radioCameraFixtures } from './radio-camera-ui-checks.mjs';

// Controlled transcripts and synthesized tones: no real radio traffic, user credentials, or API charges.
function wav() {
  const bytes = Buffer.alloc(32044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32000, 40);
  for (let i = 0; i < 16000; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 500 / 16000) * 4000), 44 + i * 2);
  return bytes;
}
const store = openStore(':memory:'), calls = [], requestsAborted = []; let failTranscription = false, hold = false;
const text = 'Synthetic test only. Unit seven, respond to Example Street for a simulated assistance call.';
const radioAnalysis = {
  status: () => ({ configured: true, provider: 'Controlled fixture', transcribeModel: 'Synthetic ASR fixture', summaryModel: 'Synthetic analysis fixture', maxClipSeconds: 60 }),
  transcribe: async (body, signal) => {
    const metrics = inspectRadioWav(Buffer.from(body.audio, 'base64')); calls.push({ source: body.source, metrics });
    if (hold) await new Promise(resolve => { signal.addEventListener('abort', () => { requestsAborted.push(true); resolve(); }, { once: true }); });
    if (failTranscription) throw Object.assign(new Error('Controlled AI outage: reconnect when available.'), { status: 502 });
    return { text, segments: [{ text, speaker: 'A', start: 0, end: metrics.duration }], metrics, skipped: false, source: body.source, startedAt: body.startedAt, model: 'Synthetic ASR fixture' };
  },
  summarize: async body => ({ summary: 'This is a simulated assistance call for a synthetic test, not an actual emergency.', mentions: [{ kind: 'unit', text: 'Unit seven', quote: 'Unit seven', entryId: body.entries[0].id }, { kind: 'location', text: 'Example Street', quote: 'respond to Example Street', entryId: body.entries[0].id }], uncertainties: ['Synthetic fixture; no real incident.'], model: 'Synthetic analysis fixture', entryIds: body.entries.map(entry => entry.id), generatedAt: new Date().toISOString(), basis: 'Unverified machine transcript' })
};
const { app } = createApp({ store, radioAnalysis }), server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
const report = { checks: [], errors: [] }; page.on('pageerror', error => report.errors.push(error.message));
context.on('page', opened => { if (opened !== page) opened.on('pageerror', error => report.errors.push(error.message)); });
const cameraFixtures = await radioCameraFixtures(context);
await page.addInitScript(() => {
  window.captureMode = 'tone'; window.captureTracks = []; window.captureRequests = 0;
  Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
    window.captureRequests++;
    if (window.captureMode === 'denied') throw new DOMException('Fixture picker cancelled', 'NotAllowedError');
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; canvas.getContext('2d').fillRect(0, 0, 4, 4); const video = canvas.captureStream(1).getVideoTracks()[0];
    const audioContext = new AudioContext(), oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), destination = audioContext.createMediaStreamDestination();
    oscillator.frequency.value = 500; gain.gain.value = window.captureMode === 'quiet' ? 0 : .15; oscillator.connect(gain); gain.connect(destination); oscillator.start(); await audioContext.resume();
    const audio = destination.stream.getAudioTracks()[0], stop = audio.stop.bind(audio); audio.stop = () => { stop(); if (audioContext.state !== 'closed') void audioContext.close().catch(() => undefined); };
    window.captureTracks.push(audio, video);
    if (window.captureMode === 'no-audio') { audio.stop(); return new MediaStream([video]); }
    return new MediaStream([audio, video]);
  } });
});
mkdirSync('artifacts', { recursive: true });
try {
  await page.goto(`${base}/#skywave`); const panel = page.getByLabel('Radio voice and AI analysis', { exact: true });
  await panel.getByRole('button', { name: 'Start tab capture', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.radio-capture-actions button').disabled);
  assert.equal(calls.length, 0); assert.equal(await page.evaluate(() => window.captureRequests), 0); assert.equal(store.evidence().length, 0);
  await panel.getByLabel('Audio file for radio analysis', { exact: true }).setInputFiles({ name: 'synthetic-test.wav', mimeType: 'audio/wav', buffer: wav() });
  await panel.getByRole('status').getByText('Clip complete', { exact: true }).waitFor();
  await panel.getByLabel('Radio transcript keywords', { exact: true }).fill('unit seven, not in this clip');
  assert.equal(await panel.getByText('Matched: unit seven', { exact: true }).count(), 1);
  assert.equal(await panel.getByText('Matched: not in this clip', { exact: true }).count(), 0);
  const audio = panel.getByLabel('Replay captured audio clip', { exact: true }); await audio.evaluate(element => element.play());
  assert(await audio.evaluate(element => element.readyState >= 2 && !element.paused)); await audio.evaluate(element => element.pause());
  await panel.getByRole('button', { name: 'Analyze transcript', exact: true }).click();
  await panel.getByText('This is a simulated assistance call for a synthetic test, not an actual emergency.', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Show supporting clip', exact: true }).count(), 2);
  await checkRadioCameras(page, panel, cameraFixtures, report);
  assert.equal(store.evidence().length, 0, 'Analysis does not persist audio or evidence automatically');
  await panel.locator('.radio-transcript-entry').getByRole('button', { name: 'Save evidence', exact: true }).click();
  await panel.getByRole('button', { name: 'Saved', exact: true }).waitFor(); assert.equal(store.evidence().length, 1); assert(!JSON.stringify(store.evidence()).includes('blob:'));
  const downloading = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Export transcript', exact: true }).click(); const exported = await downloading; assert.equal(exported.suggestedFilename(), 'skywave-transcript.json');
  report.checks.push('Uploaded audio decodes, produces timestamped speaker turns, replays, matches keywords, supports AI questions/citations, exports, and saves only on an explicit action');

  await panel.getByLabel('Captured audio source label', { exact: true }).fill('Synthetic tab audio fixture');
  await panel.getByLabel('Radio transcript update interval', { exact: true }).selectOption('10');
  await panel.getByLabel('Radio capture time limit', { exact: true }).selectOption('1');
  await panel.getByRole('button', { name: 'Start tab capture', exact: true }).click();
  await panel.getByRole('status').getByText('Capturing · waiting for audio', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.radio-transcript-entry').length >= 2, null, { timeout: 20000 });
  assert(calls.some(call => call.source === 'Synthetic tab audio fixture' && call.metrics.duration >= 9.99 && call.metrics.duration <= 10.01), 'The real AudioWorklet path yields a complete 10-second WAV');
  const cameraPopup = page.waitForEvent('popup'); await panel.locator('.radio-camera-match').first().click(); const liveCameraTab = await cameraPopup;
  await liveCameraTab.getByLabel('Selected street camera', { exact: true }).waitFor();
  assert(await page.evaluate(() => window.captureTracks.some(track => track.readyState === 'live')), 'Opening cameras keeps the radio capture running');
  assert.equal(await panel.getByRole('button', { name: 'Stop capture', exact: true }).isDisabled(), false); await liveCameraTab.close();
  await panel.getByRole('button', { name: 'Stop capture', exact: true }).click();
  assert(await page.evaluate(() => window.captureTracks.every(track => track.readyState === 'ended')));
  report.checks.push('Live tab capture uses real WebAudio/AudioWorklet PCM chunks; Stop releases every track');
  await panel.getByRole('button', { name: 'Analyze transcript', exact: true }).click(); await panel.getByText(/AI interpretation · 2 clips/).waitFor();
  assert.equal(await panel.locator('.radio-camera-match').count(), 0, 'A fresh AI analysis resets prior place matches');
  await panel.getByRole('button', { name: 'Cameras nearby', exact: true }).click(); await panel.locator('.radio-camera-match').first().waitFor();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Audio analysis fits ${width}px`);
    assert(await panel.getByRole('button', { name: 'Start tab capture', exact: true }).isVisible());
  }
  await panel.screenshot({ path: 'artifacts/radio-analysis-mobile.png', animations: 'disabled' }); await page.setViewportSize({ width: 1440, height: 1000 }); await panel.screenshot({ path: 'artifacts/radio-analysis-desktop.png', animations: 'disabled' });

  const beforeQuiet = calls.length; await page.evaluate(() => { window.captureMode = 'quiet'; });
  await panel.getByRole('button', { name: 'Start tab capture', exact: true }).click();
  await panel.getByRole('status').getByText('Capturing · quiet audio skipped', { exact: true }).waitFor({ timeout: 20000 }); assert.equal(calls.length, beforeQuiet);
  await panel.getByRole('button', { name: 'Stop capture', exact: true }).click();
  await page.evaluate(() => { window.captureMode = 'no-audio'; }); await panel.getByRole('button', { name: 'Start tab capture', exact: true }).click(); await panel.getByRole('alert').getByText(/Share tab audio/).waitFor();
  assert(await page.evaluate(() => window.captureTracks.every(track => track.readyState === 'ended')));
  await page.evaluate(() => { window.captureMode = 'denied'; }); await panel.getByRole('button', { name: 'Start tab capture', exact: true }).click(); await panel.getByRole('alert').getByText(/sharing was cancelled/).waitFor();
  report.checks.push('Quiet audio avoids AI requests, missing shared audio gives useful instructions, and picker cancellation leaves no active capture');

  hold = true; await panel.getByLabel('Audio file for radio analysis', { exact: true }).setInputFiles({ name: 'held-test.wav', mimeType: 'audio/wav', buffer: wav() });
  await panel.getByRole('status').getByText('Transcribing clip', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Nearby frequencies', exact: true }).click(); await page.getByRole('heading', { name: 'Frequencies around Ottawa', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.radio-voice-workspace').length === 0);
  for (let i = 0; i < 30 && !requestsAborted.length; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert(requestsAborted.length);
  hold = false; await page.getByRole('button', { name: 'Live audio', exact: true }).click();
  failTranscription = true; await panel.getByLabel('Audio file for radio analysis', { exact: true }).setInputFiles({ name: 'outage-test.wav', mimeType: 'audio/wav', buffer: wav() }); await panel.getByRole('alert').getByText(/Controlled AI outage/).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Stop capture', exact: true }).isDisabled(), true);
  failTranscription = false; await panel.getByLabel('Audio file for radio analysis', { exact: true }).setInputFiles({ name: 'recovery-test.wav', mimeType: 'audio/wav', buffer: wav() }); await panel.getByRole('status').getByText('Clip complete', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Clear session', exact: true }).click(); assert.equal(await panel.getByLabel('Replay captured audio clip', { exact: true }).count(), 0);
  assert.deepEqual(report.errors, []); report.checks.push('Leaving analysis cancels in-flight AI requests; outages stop processing, retry recovers, and clearing releases clips without page errors');
  writeFileSync('artifacts/radio-analysis-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { cameraFixtures.release(); await browser.close(); await new Promise(resolve => server.close(resolve)); store.db.close(); }
