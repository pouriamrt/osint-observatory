import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore, now } from '../server/core.mjs';
import { canadianSources, normalizeCanadianCameras, parseCameraFeed, quebecSnapshotMetadata } from '../server/camera-feeds.mjs';
import { normalizeEarthCam, cameraDirectory, resolveCameraPage } from '../server/cameras.mjs';
import { iranianSources } from '../server/iranian-cameras.mjs';
const snapshot = JSON.parse(readFileSync(new URL('../server/sources/camera-catalog.json', import.meta.url), 'utf8'));
const canadian = JSON.parse(readFileSync(new URL('../server/sources/canadian-cameras.json', import.meta.url), 'utf8'));
const iranian = JSON.parse(readFileSync(new URL('../server/sources/iranian-cameras.json', import.meta.url), 'utf8'));
function seed(store) { store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run('camera-earthcam', JSON.stringify(snapshot.earthcam), now()); for (const source of canadian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source.cameras), now()); for (const source of iranian.sources) store.db.prepare('INSERT INTO feed_cache VALUES (?,?,?)').run(`camera-${source.id}`, JSON.stringify(source), now()); }
test('EarthCam normalization keeps provider positions and rejects missing, invalid, or unsafe records', () => {
  const camera = { id: 'fixture', name: 'Fixture &amp; camera', posn: ['43.6', '-79.4'], url: 'https://www.earthcam.com/fixture/', thumbnail: 'https://www.earthcam.com/fixture.jpg', country: 'Canada' };
  const invalid = [null, false, '', '  ', 91, 'not-a-number'];
  const rows = normalizeEarthCam({ data: [{ places: [camera, camera, ...invalid.map(lat => ({ ...camera, posn: [lat, -79] })), { ...camera, posn: [43] }, { ...camera, url: 'javascript:alert(1)' }] }] });
  assert.equal(rows.length, 1); assert.equal(rows[0].lat, 43.6); assert.equal(rows[0].name, 'Fixture & camera'); assert.equal(rows[0].coordinateType, 'provider');
  assert.throws(() => normalizeEarthCam({ data: [] }));
  assert.throws(() => normalizeEarthCam({ data: [{ places: [{ ...camera, posn: [null, null] }] }] }));
});
test('public directory includes both providers, attributes approximate Skyline locations, and preserves user overrides', async () => {
  const store = openStore(':memory:'); seed(store);
  try {
    const view = snapshot.skyline[0], earthcam = snapshot.earthcam[0];
    store.importRows('camera', [{ name: 'My chosen view', lat: 10, lon: 20, url: earthcam.url, source: 'User location' }]);
    const data = await cameraDirectory(store);
    assert(data.cameras.some(c => c.provider === 'EarthCam')); assert(data.cameras.some(c => c.provider === 'SkylineWebcams'));
    const mapped = data.cameras.find(c => c.id === view.id); assert.equal(mapped.coordinateType, 'view'); assert(mapped.coordinateSource.startsWith('https://en.wikipedia.org/'));
    assert.equal(data.cameras.find(c => c.url === earthcam.url).name, 'My chosen view');
    assert.equal(data.cameras.filter(c => c.url === earthcam.url).length, 1);
    const resolved = await resolveCameraPage(store, view.url); assert.equal(resolved.known, true); assert.equal(resolved.lat, view.lat);
  } finally { store.db.close(); }
});
test('camera lookup rejects arbitrary hosts and ports and a failed refresh retains the usable directory', async () => {
  const store = openStore(':memory:'); seed(store); const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Fixture provider unavailable'); };
  try {
    for (const url of ['http://www.earthcam.com/', 'https://127.0.0.1/', 'https://www.earthcam.com.evil.test/', 'https://www.earthcam.com:8787/', 'https://user:secret@www.earthcam.com/']) await assert.rejects(resolveCameraPage(store, url));
    assert.equal(requests, 0);
    const data = await cameraDirectory(store, true); assert.equal(requests, 1 + canadianSources.length + iranianSources.length); assert.equal(data.sources[0].status, 'cached'); assert.equal(data.sources[0].count, snapshot.earthcam.length); assert(data.cameras.length > 2000); for (const source of canadian.sources) { const status = data.sources.find(s => s.name === source.name); assert.equal(status.status, 'cached'); assert.equal(status.count, source.cameras.length); }
    assert.equal(data.cameras.filter(c => c.country === 'Iran').length, 6); assert.equal(data.sources.find(s => s.name === 'Iran 141').status, 'unavailable');
  } finally { globalThis.fetch = original; store.db.close(); }
});

test('Canadian feeds validate coordinates, keep credits, and distinguish snapshots from viewing pages', () => {
  const bc = { id: 12, name: 'Fixture highway', location: { type: 'Point', coordinates: [-123, 49] }, is_on: true, should_appear: true, links: { imageDisplay: '/images/12.jpg?t=123' }, region_name: 'Fixture region', credit: '<b>Fixture partner</b>' };
  const rows = normalizeCanadianCameras('drivebc', [bc, { ...bc, id: 13, is_on: false }, { ...bc, id: 14, location: { type: 'Point', coordinates: [-123, null] } }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].operatorCredit, 'Fixture partner'); assert.equal(rows[0].coordinateType, 'provider'); assert.equal(rows[0].mediaType, 'snapshot'); assert.equal(rows[0].url, 'https://www.drivebc.ca/images/12.jpg');
  const qc = normalizeCanadianCameras('quebec511', { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [-73, 46] }, properties: { IDEcamera: '21', URL_FLUX_DONNEE: 'https://www.quebec511.info/fixture?id=21', DescriptionLocalisationEn: 'Fixture road' } }] });
  assert.equal(qc[0].mediaType, 'provider'); assert.equal(qc[0].thumbnail, undefined); assert.equal(qc[0].license, 'CC BY 4.0');
  const tor = normalizeCanadianCameras('toronto', { Data: [{ Number: '8001', Name: 'Fixture Toronto road', Latitude: '43.6', Longitude: '-79.4' }] });
  assert.equal(tor[0].url, 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc8001.jpg');
  const cal = normalizeCanadianCameras('calgary', [{ camera_url: { url: 'http://trafficcam.calgary.ca/loc12.jpg' }, camera_location: 'Fixture Calgary road', point: { type: 'Point', coordinates: [-114, 51] } }]);
  assert.equal(cal[0].thumbnail, 'https://trafficcam.calgary.ca/loc12.jpg');
  assert.throws(() => normalizeCanadianCameras('drivebc', [{ ...bc, location: { type: 'Point', coordinates: [false, 49] } }]));
  assert.throws(() => normalizeCanadianCameras('quebec511', { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [-73, 46] }, properties: { IDEcamera: '21', URL_FLUX_DONNEE: 'javascript:alert(1)', DescriptionLocalisationEn: 'Fixture' } }] }));
});
test('Toronto JSONP is parsed as data and never evaluated', () => {
  assert.deepEqual(parseCameraFeed('toronto', 'jsonTMCEarthCamerasCallback({"Data":[]});'), { Data: [] });
  assert.throws(() => parseCameraFeed('toronto', 'evilCallback({"Data":[]});'));
  assert.throws(() => parseCameraFeed('toronto', 'jsonTMCEarthCamerasCallback({"Data":[]});process.exit()'));
});

test('Iranian coverage keeps Tehran availability separate from playable Mashhad streams and supports known-page lookup', async () => {
  const store = openStore(':memory:'); seed(store); const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('This check must use verified cached metadata only'); };
  try {
    const data = await cameraDirectory(store), iran = data.cameras.filter(camera => camera.country === 'Iran');
    assert.equal(iran.length, 6);
    const tehran = iran.filter(camera => camera.location === 'Tehran, Iran'); assert.equal(tehran.length, 1);
    assert.equal(tehran[0].availability, 'offline'); assert.equal(tehran[0].thumbnail, undefined); assert.equal(tehran[0].kind, 'page'); assert.equal(tehran[0].coordinateType, 'view');
    assert.equal(iran.filter(camera => camera.kind === 'hls' && camera.location.startsWith('Mashhad')).length, 5);
    assert.equal(data.sources.find(source => source.name === 'Iran 141').count, 0);
    assert.equal((await resolveCameraPage(store, tehran[0].url)).known, true);
    const live = await resolveCameraPage(store, 'https://haram.razavi.ir/live'); assert.equal(live.kind, 'hls'); assert.equal(live.country, 'Iran');
    for (const url of ['https://haram.razavi.ir/admin', 'https://www.webcamgalore.com/unknown', 'https://newlive.nasimrezvan.com/hls/unknown/index.m3u8', `${tehran[0].url}?target=127.0.0.1`]) await assert.rejects(resolveCameraPage(store, url));
    store.importRows('camera', [{ name: 'My Tehran view', country: 'Iran', lat: 35.7, lon: 51.4, url: tehran[0].url, source: 'User location' }]);
    const updated = await cameraDirectory(store); assert.equal(updated.cameras.filter(camera => camera.url === tehran[0].url).length, 1); assert.equal(updated.cameras.find(camera => camera.url === tehran[0].url).name, 'My Tehran view');
  } finally { globalThis.fetch = original; store.db.close(); }
});
test('Ottawa maps feature IDs to the correct image camera numbers and retains operator attribution', () => {
  const city = { id: 33, camera_number: 49, cameraOwner: 'CITY', name: 'Booth & Wellington', name_french: 'Booth et Wellington', latitude: 45.416354, longitude: -75.714726 };
  const mto = { ...city, id: 34, camera_number: 2002, cameraOwner: 'MTO', name: 'Highway fixture' };
  const invalid = [null, false, '', ' ', 'NaN', 95].map(latitude => ({ ...city, id: 35, latitude }));
  const rows = normalizeCanadianCameras('ottawa', { cameras: [city, city, mto, ...invalid, { ...city, id: '../33' }, { ...city, camera_number: '49?secret' }, { ...city, cameraOwner: 'unknown' }] });
  assert.equal(rows.length, 2); assert.equal(rows[0].id, 'ottawa:33'); assert.equal(rows[0].url, 'https://traffic.ottawa.ca/map/cameraWindow?id=33'); assert.equal(rows[0].thumbnail, 'https://traffic.ottawa.ca/camera?id=49'); assert.equal(rows[0].viewingPage, rows[0].url);
  assert.equal(rows[0].mediaType, 'snapshot'); assert.equal(rows[0].country, 'Canada'); assert(rows[0].coordinateNote.includes('intersection')); assert(rows[0].operatorCredit.includes('City of Ottawa')); assert(rows[1].operatorCredit.includes('Ontario Ministry of Transportation')); assert(rows[0].license.includes('City of Ottawa'));
  assert.throws(() => normalizeCanadianCameras('ottawa', { cameras: [] }));
});
test('Québec image links use published camera codes and upgrade older caches', async () => {
  for (const [number, path] of [['Q19802', 'Quebec/cam/19802.jpg'], ['M1330004', 'Montreal/cam/1330004.jpg'], ['T2410101', 'TroisRivieres/cam/2410101.jpg'], ['G117622', 'Gatineau/cam/117622.jpg']]) {
    const meta = quebecSnapshotMetadata(number); assert.equal(meta.thumbnail, `https://www.quebec511.info/Images/Cameras/${path}`); assert.equal(meta.mediaType, 'snapshot');
  }
  for (const value of [undefined, '3857', 'Q../bad', 'Q19802?token=secret', 'X19802']) assert.deepEqual(quebecSnapshotMetadata(value), {});
  const store = openStore(':memory:'); seed(store);
  try {
    const old = canadian.sources.find(s => s.id === 'quebec511').cameras.map(({ thumbnail, cameraNumber, ...camera }) => ({ ...camera, mediaType: 'provider', previewNote: 'Old missing preview note' }));
    store.db.prepare('UPDATE feed_cache SET payload=? WHERE name=?').run(JSON.stringify(old), 'camera-quebec511');
    const data = await cameraDirectory(store), camera = data.cameras.find(c => c.id === 'quebec511:3857');
    assert.equal(camera.thumbnail, 'https://www.quebec511.info/Images/Cameras/Quebec/cam/19802.jpg'); assert.equal(camera.mediaType, 'snapshot'); assert.equal(camera.previewNote, undefined); assert.equal(camera.viewingPage, camera.url);
    assert.equal(data.cameras.filter(c => c.provider === 'Québec 511' && c.thumbnail).length, 680);
  } finally { store.db.close(); }
});
test('Canadian catalogue keeps distinct published camera locations and original EarthCam views', async () => {
  const store = openStore(':memory:'); seed(store);
  try {
    const data = await cameraDirectory(store), canada = data.cameras.filter(c => c.country === 'Canada');
    assert(canada.length > 2000); assert(new Set(canada.map(c => `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`)).size > 1000);
    for (const source of canadian.sources) assert.equal(canada.filter(c => c.provider === source.name).length, source.cameras.length);
    assert(canada.some(c => c.name === 'CN Tower Cam - East View'));
  } finally { store.db.close(); }
});
