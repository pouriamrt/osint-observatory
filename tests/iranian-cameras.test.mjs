import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIranianCameras, fetchIranianCameras } from '../server/iranian-cameras.mjs';

const checkedAt = '2026-10-07T12:00:00.000Z';
const tehran = `<meta property="og:title" content="Webcam Tehran: Several Views"><meta property="og:url" content="https://www.webcamgalore.com/webcam/Iran/Tehran/37931.html"><meta property="og:latitude" content="35.7219009"><meta property="og:longitude" content="51.3347015"><div>This webcam is currently offline!</div>`;
const view = { id: 6, attributes: { title: 'پخش زنده صحن انقلاب اسلامی', url: 'https://newlive.nasimrezvan.com/hls/Enghelab-Sahn/index.m3u8', image: { data: { attributes: { url: 'https://cdnfile.razavi.ir/haram-pub/fixture.jpg' } } } } };
const livePage = rows => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { livesJson: { data: rows } } } })}</script>`;

test('Tehran public listing retains a dated outage without exposing an old image as a live camera', () => {
  const { cameras, note } = parseIranianCameras('iran-tehran', tehran, checkedAt), camera = cameras[0];
  assert.equal(camera.country, 'Iran'); assert.equal(camera.lat, 35.7219009); assert.equal(camera.coordinateType, 'view');
  assert.equal(camera.availability, 'offline'); assert.equal(camera.availabilityCheckedAt, checkedAt); assert.equal(camera.thumbnail, undefined); assert.match(note, /offline/);
  assert.equal(parseIranianCameras('iran-tehran', tehran.replace('This webcam is currently offline!', '')).cameras[0].availability, 'unknown', 'Absence of an outage message does not verify a live broadcast');
  for (const html of [tehran.replace('35.7219009', ''), tehran.replace('35.7219009', 'NaN'), tehran.replace('35.7219009', '46.5'), tehran.replaceAll('/Iran/Tehran/', '/Switzerland/Airolo/'), tehran.replace('Webcam Tehran:', 'Webcam Airolo:')]) assert.throws(() => parseIranianCameras('iran-tehran', html));
});

test('Official shrine views are distinct HLS records with optional programme thumbnails and approximate coordinates', () => {
  const { cameras } = parseIranianCameras('iran-razavi', livePage([view, view]), checkedAt), camera = cameras[0];
  assert.equal(cameras.length, 1); assert.equal(camera.name, 'Mashhad — Imam Reza Enghelab Courtyard'); assert.equal(camera.kind, 'hls');
  assert.equal(camera.coordinateType, 'view'); assert.equal(camera.viewingPage, 'https://haram.razavi.ir/live'); assert.match(camera.previewNote, /not a current camera frame/);
  assert.equal(camera.availability, undefined); assert.match(camera.attribution, /publisher/); assert.equal(camera.retrievedAt, checkedAt);
  const foreignImage = structuredClone(view); foreignImage.attributes.image.data.attributes.url = 'https://cdnfile.razavi.ir.evil.test/preview.jpg';
  assert.equal(parseIranianCameras('iran-razavi', livePage([foreignImage])).cameras[0].thumbnail, undefined);
  for (const url of ['https://127.0.0.1/index.m3u8', 'https://newlive.nasimrezvan.com.evil.test/hls/Enghelab-Sahn/index.m3u8', 'https://user:secret@newlive.nasimrezvan.com/hls/Enghelab-Sahn/index.m3u8', 'javascript:alert(1)']) {
    assert.throws(() => parseIranianCameras('iran-razavi', livePage([{ ...view, attributes: { ...view.attributes, url } }])));
  }
  assert.throws(() => parseIranianCameras('iran-razavi', '<script>window.data={}</script>'));
});

test('Empty or unsupported Iran 141 coverage never produces guessed Tehran camera pins', () => {
  const result = parseIranianCameras('iran141', '[]'); assert.deepEqual(result.cameras, []); assert.equal(result.status, 'unavailable'); assert.match(result.note, /Tehran/);
  assert.throws(() => parseIranianCameras('iran141', '{"cameras":[]}'));
  const changed = parseIranianCameras('iran141', '[{"unknown":"format"}]'); assert.deepEqual(changed.cameras, []); assert.equal(changed.status, 'provider');
});

test('Iranian metadata requests use fixed public endpoints and fail on provider errors or oversized responses', async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async (url, options) => { requests++; assert.equal(url, 'https://www.webcamgalore.com/webcam/Iran/Tehran/37931.html'); assert.equal(options.redirect, 'error'); return new Response(tehran); };
  try {
    const data = await fetchIranianCameras('iran-tehran'); assert.equal(data.cameras[0].availability, 'offline'); assert(data.retrievedAt);
    await assert.rejects(fetchIranianCameras('https://127.0.0.1/')); assert.equal(requests, 1);
    globalThis.fetch = async () => new Response('Provider unavailable', { status: 503 }); await assert.rejects(fetchIranianCameras('iran-razavi'), /HTTP 503/);
    globalThis.fetch = async () => new Response('x'.repeat(5000001)); await assert.rejects(fetchIranianCameras('iran-razavi'), /too large/);
  } finally { globalThis.fetch = original; }
});
