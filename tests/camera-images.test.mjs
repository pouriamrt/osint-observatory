import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ottawaImageStatus, ottawaSnapshot } from '../server/camera-images.mjs';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';

const outage = readFileSync(new URL('./fixtures/ottawa-offline.jpg', import.meta.url));
const cityOutage = readFileSync(new URL('./fixtures/ottawa-city-offline.jpg', import.meta.url));
test('Ottawa HTTP-200 municipal and MTO outage cards are classified separately from camera frames', () => {
  assert.equal(ottawaImageStatus(outage), 'offline');
  assert.equal(ottawaImageStatus(cityOutage), 'offline');
  assert.equal(ottawaImageStatus(Buffer.from('Different image bytes')), 'available');
});
test('Ottawa image route reports provider outage, validates numbers, and only requests the fixed public image host', async () => {
  const original = globalThis.fetch, store = openStore(':memory:'), { app } = createApp({ store });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname !== 'traffic.ottawa.ca') return original(input, options);
    calls++; assert.equal(url.protocol, 'https:'); assert.equal(url.pathname, '/camera');
    assert.equal(url.searchParams.get('id'), '2025'); assert.equal(url.searchParams.get('timems'), '123');
    assert.equal(options.redirect, 'error');
    return new Response(outage, { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const response = await fetch(`${base}/api/cameras/ottawa-snapshot?id=2025&timems=123`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).cameraStatus, 'offline');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (const number of ['https://127.0.0.1', '../2025', '16.5', '-1', '12345678']) {
      assert.equal((await fetch(`${base}/api/cameras/ottawa-snapshot?id=${encodeURIComponent(number)}`)).status, 400);
    }
    assert.equal(calls, 1);
    await assert.rejects(ottawaSnapshot('bad-id'));
  } finally { globalThis.fetch = original; await new Promise(resolve => server.close(resolve)); store.db.close(); }
});
test('Ottawa snapshots reject non-image responses and oversized bodies', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Provider error</html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(ottawaSnapshot(16), /did not return a camera image/);
    globalThis.fetch = async () => new Response(Buffer.alloc(2e6 + 1), { headers: { 'content-type': 'image/jpeg' } });
    await assert.rejects(ottawaSnapshot(16), /size limit/);
  } finally { globalThis.fetch = original; }
});
