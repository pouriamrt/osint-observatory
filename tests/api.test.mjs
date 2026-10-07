import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';

test('API persists evidence and imports, gates visitors by consent, and protects local scope', async () => {
  const store = openStore(':memory:'); const { app } = createApp({ store });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, method = body ? 'POST' : 'GET') { const response = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; }
  try {
    assert.equal((await request('/api/config')).data.chains.length, 24);
    const blocked = await fetch(base + '/api/config', { headers: { Origin: 'https://evil.example' } }); assert.equal(blocked.status, 403);
    const camera = { name: 'Fixture camera', lat: 0, lon: 0, url: 'https://example.org/feed', source: 'Test fixture' };
    assert.equal((await request('/api/import/camera', { rows: [camera] })).data.inserted, 1);
    const bad = await request('/api/import/camera', { rows: [{ ...camera, lat: 100 }] }); assert.equal(bad.status, 400);
    assert.equal((await request('/api/records/camera')).data.length, 1);
    const finding = await request('/api/evidence', { module: 'camera', title: 'Fixture finding', source: 'Fixture', payload: camera }); assert.equal(finding.status, 201);
    await request(`/api/evidence/${finding.data.id}`, { notes: 'Unverified test evidence' }, 'PATCH');
    assert.equal((await request('/api/evidence')).data[0].notes, 'Unverified test evidence');
    const repeated = await request('/api/evidence', { module: 'camera', title: 'Fixture finding', source: 'Fixture', payload: camera });
    assert.equal(repeated.data.id, finding.data.id); assert.equal(repeated.data.existing, true);
    assert.equal((await request('/api/evidence')).data[0].notes, 'Unverified test evidence');
    const favorite = { module: 'camera', key: camera.url, title: camera.name, selected: true };
    assert.equal((await request('/api/favorites', favorite)).data.saved, true);
    assert.equal((await request('/api/favorites', favorite)).data.saved, true);
    assert.equal((await request('/api/favorites')).data.length, 1);
    assert.equal((await request('/api/cameras/resolve', { url: 'https://127.0.0.1/internal' })).status, 400);
    assert.equal((await request('/api/links', { title: 'Bad link', destination: 'javascript:alert(1)' })).status, 400);
    const link = await request('/api/links', { title: '<script>fixture</script>', destination: 'https://example.org/research', days: 1 }); assert.equal(link.status, 201);
    const page = await fetch(base + link.data.path); const html = await page.text(); assert(html.includes('&lt;script&gt;fixture&lt;/script&gt;')); assert(!html.includes('<script>fixture'));
    assert.equal((await request('/api/links')).data[0].visits.length, 0);
    assert.equal((await request(`/api/visits/${link.data.id}`, { consent: false, language: 'en', screen: '100x100' })).status, 400);
    assert.equal((await request(`/api/visits/${link.data.id}`, { consent: true, language: 'en', screen: '100x100', location: { latitude: 43, longitude: -79, accuracy: 12, timestamp: Date.now() } })).status, 201);
    const visits = (await request('/api/links')).data[0].visits; assert.equal(visits.length, 1); assert.equal(visits[0].payload.location.accuracy, 12);
    const exportData = (await request('/api/export')).data; assert.equal(exportData.imports.camera.length, 1); assert.equal(exportData.evidence.length, 1); assert.equal(exportData.links[0].visits.length, 1);
    assert.equal(exportData.favorites[0].key, camera.url);
    await request('/api/favorites', { ...favorite, selected: false }); assert.equal((await request('/api/favorites')).data.length, 0);
    assert.equal((await request('/api/netscan', { target: '192.0.2.1', ports: '80', authorized: true })).status, 403);
    assert.equal((await request('/api/netscan', { target: '127.0.0.1', ports: '80', authorized: false })).status, 400);
    await request(`/api/links/${link.data.id}`, undefined, 'DELETE'); assert.equal(store.db.prepare('SELECT COUNT(*) n FROM visits').get().n, 0);
    await request(`/api/evidence/${finding.data.id}`, undefined, 'DELETE'); assert.equal((await request('/api/evidence')).data.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); store.db.close(); }
});
