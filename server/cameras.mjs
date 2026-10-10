import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { now, fail, httpUrl } from './core.mjs';
import { canadianSources, fetchCanadianCameras, quebecSnapshotMetadata } from './camera-feeds.mjs';
import { iranianSources, fetchIranianCameras } from './iranian-cameras.mjs';
const catalog = JSON.parse(readFileSync(new URL('./sources/camera-catalog.json', import.meta.url), 'utf8'));
const canadianCatalog = JSON.parse(readFileSync(new URL('./sources/canadian-cameras.json', import.meta.url), 'utf8'));
const iranianCatalog = JSON.parse(readFileSync(new URL('./sources/iranian-cameras.json', import.meta.url), 'utf8'));
const quebecNumbers = new Map(canadianCatalog.sources.find(source => source.id === 'quebec511').cameras.map(camera => [camera.id, camera.cameraNumber]));
const directoryURL = catalog.sources.earthcam;
const trustedHosts = new Set(['www.earthcam.com', 'earthcam.com', 'myearthcam.com', 'www.skylinewebcams.com']);
let pending;
const canadianPending = new Map();
const iranianPending = new Map();
const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
function optionalUrl(value) { try { return httpUrl(value); } catch { return undefined; } }
export function normalizeEarthCam(data, retrievedAt = now()) {
  const rows = Array.isArray(data?.data) ? data.data.flatMap(group => group.places || []) : [];
  if (!rows.length) fail('EarthCam did not return camera map records.', 502);
  const result = rows.flatMap(p => {
    const lat = Number(p.posn?.[0]), lon = Number(p.posn?.[1]); const url = optionalUrl(p.url);
    if (!url || !p.name || !Array.isArray(p.posn) || p.posn.length !== 2 || p.posn.some(v => !['number', 'string'].includes(typeof v) || String(v).trim() === '') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{ id: `earthcam:${p.id || createHash('sha256').update(url).digest('hex').slice(0,20)}`, name: clean(p.name), lat, lon, url, thumbnail: optionalUrl(p.thumbnail), source: 'EarthCam', provider: 'EarthCam', country: clean(p.country), location: clean(p.location), kind: 'page', coordinateType: 'provider', coordinateSource: directoryURL, retrievedAt }];
  });
  if (!result.length) fail('EarthCam returned no valid camera positions.', 502);
  return [...new Map(result.map(row => [row.url, row])).values()];
}
async function readProvider(url) {
  const u = new URL(url); if (u.protocol !== 'https:' || !trustedHosts.has(u.hostname) || u.port || u.username || u.password) fail('Use a public EarthCam or SkylineWebcams page.');
  const response = await fetch(url, { redirect: 'error', headers: { 'User-Agent': 'NorthstarWorkbench/0.2 public-camera-metadata', Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(`Camera provider returned HTTP ${response.status}.`, 502);
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5e6) { await reader.cancel(); fail('Camera provider response is too large.', 502); } parts.push(value); } } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString();
}
async function canadianDirectory(store, refresh) {
  return Promise.all(canadianSources.map(async source => {
    const snapshot = canadianCatalog.sources.find(s => s.id === source.id), cacheName = `camera-${source.id}`;
    const cache = store.db.prepare('SELECT * FROM feed_cache WHERE name=?').get(cacheName);
    let cameras = cache ? JSON.parse(cache.payload) : snapshot?.cameras || [], retrievedAt = cache?.fetched || snapshot?.retrievedAt, status = cache ? 'ready' : 'snapshot', error;
    if (refresh || !cameras.length || Date.now() - Date.parse(retrievedAt) > 86400000) {
      try {
        if (!canadianPending.has(source.id)) canadianPending.set(source.id, fetchCanadianCameras(source).finally(() => canadianPending.delete(source.id)));
        const latest = await canadianPending.get(source.id); cameras = latest.cameras; retrievedAt = latest.retrievedAt; status = 'ready';
        store.db.prepare('INSERT OR REPLACE INTO feed_cache VALUES (?,?,?)').run(cacheName, JSON.stringify(cameras), retrievedAt);
      } catch (e) { status = 'cached'; error = e.message; }
    }
    // Enrich previously cached metadata immediately without waiting for the next daily refresh.
    if (source.id === 'quebec511') cameras = cameras.map(camera => ({ ...camera, viewingPage: camera.url, ...quebecSnapshotMetadata(camera.cameraNumber || quebecNumbers.get(camera.id)) }));
    return { cameras, source: { name: source.name, status, count: cameras.length, retrievedAt, url: source.url, license: source.license, licenseURL: source.licenseURL, attribution: source.attribution, error } };
  }));
}
async function iranianDirectory(store, refresh) {
  return Promise.all(iranianSources.map(async source => {
    const snapshot = iranianCatalog.sources.find(saved => saved.id === source.id), cacheName = `camera-${source.id}`;
    const cache = store.db.prepare('SELECT * FROM feed_cache WHERE name=?').get(cacheName);
    let data = cache ? JSON.parse(cache.payload) : snapshot;
    let retrievedAt = cache?.fetched || snapshot.retrievedAt, status = data.status === 'unavailable' || data.status === 'provider' ? data.status : cache ? 'ready' : 'snapshot', error;
    if (refresh || Date.now() - Date.parse(retrievedAt) > 86400000) {
      try {
        if (!iranianPending.has(source.id)) iranianPending.set(source.id, fetchIranianCameras(source.id).finally(() => iranianPending.delete(source.id)));
        data = await iranianPending.get(source.id); retrievedAt = data.retrievedAt; status = data.status;
        store.db.prepare('INSERT OR REPLACE INTO feed_cache VALUES (?,?,?)').run(cacheName, JSON.stringify(data), retrievedAt);
      } catch (e) { status = data.cameras.length ? 'cached' : 'unavailable'; error = e.message; }
    }
    return { cameras: data.cameras, source: { ...source, status, count: data.cameras.length, retrievedAt, note: data.note, error } };
  }));
}
export async function cameraDirectory(store, refresh = false) {
  const canadianRequest = canadianDirectory(store, refresh);
  const iranianRequest = iranianDirectory(store, refresh);
  let cache = store.db.prepare('SELECT * FROM feed_cache WHERE name=?').get('camera-earthcam');
  let earthcam = cache ? JSON.parse(cache.payload) : catalog.earthcam;
  let status = cache ? 'ready' : 'snapshot', retrievedAt = cache?.fetched || catalog.retrievedAt, error;
  if (refresh || (!cache && Date.now() - Date.parse(catalog.retrievedAt) > 86400000) || (cache && Date.now() - Date.parse(cache.fetched) > 86400000)) {
    try {
      pending ||= readProvider(directoryURL).then(body => ({ rows: normalizeEarthCam(JSON.parse(body)), retrievedAt: now() })).finally(() => { pending = null; });
      const next = await pending; earthcam = next.rows; retrievedAt = next.retrievedAt; status = 'ready';
      store.db.prepare('INSERT OR REPLACE INTO feed_cache VALUES (?,?,?)').run('camera-earthcam', JSON.stringify(earthcam), retrievedAt);
    } catch (e) { status = 'cached'; error = e.message; }
  }
  const imported = store.list('camera').map(c => ({ ...c, provider: 'My cameras', coordinateType: c.coordinateType || 'user', retrievedAt: c.importedAt }));
  const canadian = await canadianRequest;
  const iranian = await iranianRequest;
  const cameras = [...imported, ...catalog.skyline, ...earthcam, ...canadian.flatMap(result => result.cameras), ...iranian.flatMap(result => result.cameras)];
  const byURL = new Map(); for (const c of cameras) if (!byURL.has(c.url)) byURL.set(c.url, c);
  const unique = [...byURL.values()];
  return { cameras: unique, sources: [{ name: 'EarthCam', status, count: earthcam.length, retrievedAt, url: 'https://www.earthcam.com/mapsearch/', error }, { name: 'SkylineWebcams', status: 'snapshot', count: catalog.skyline.length, retrievedAt: catalog.retrievedAt, url: catalog.sources.skyline, note: 'Featured public views; coordinates identify the depicted place and are approximate.' }, ...canadian.map(result => result.source), ...iranian.map(result => result.source), { name: 'My cameras', status: 'local', count: imported.length }], retrievedAt: now() };
}
export async function resolveCameraPage(store, url) {
  const normalized = httpUrl(url); const u = new URL(normalized);
  // Iranian sources can be filled from the verified catalogue only. This does
  // not allow arbitrary server-side requests to additional domains.
  const iranianKnown = iranianCatalog.sources.some(source => source.cameras.some(camera => camera.url === normalized || camera.viewingPage === normalized));
  if ((!trustedHosts.has(u.hostname) && !iranianKnown) || u.protocol !== 'https:' || u.port) fail('Use an HTTPS EarthCam or SkylineWebcams page, or a listed Iranian camera URL.');
  const directory = await cameraDirectory(store);
  const known = directory.cameras.find(c => c.url === normalized || (iranianKnown && c.viewingPage === normalized));
  if (known) return { ...known, known: true };
  if (iranianKnown) fail('This camera is no longer in the current public directory.', 404);
  const html = await readProvider(normalized);
  const meta = name => { const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]); const tag = tags.find(t => new RegExp(`(?:property|name)=["']${name.replace('.', '\\.')}["']`, 'i').test(t)); return clean(tag?.match(/content=["']([^"']+)["']/i)?.[1]); };
  const thumbnail = optionalUrl(meta('og:image'));
  return { name: meta('og:title') || clean(html.match(/<title>(.*?)<\/title>/is)?.[1]) || 'Public camera', url: normalized, thumbnail, source: u.hostname.includes('skylinewebcams') ? 'SkylineWebcams' : 'EarthCam', kind: 'page', country: '', coordinateType: 'user', retrievedAt: now(), note: 'This page has no verified map position in the directory. Enter coordinates for the depicted view before saving.' };
}
