import { now, fail } from './core.mjs';

export const iranianSources = [
  { id: 'iran-tehran', name: 'Webcam Galore · Tehran', url: 'https://www.webcamgalore.com/webcam/Iran/Tehran/37931.html', places: ['Tehran'], country: 'Iran' },
  { id: 'iran-razavi', name: 'Haram Razavi', url: 'https://haram.razavi.ir/live', places: ['Mashhad'], country: 'Iran' },
  { id: 'iran141', name: 'Iran 141', url: 'https://141.ir/cameras', dataURL: 'https://api.141.ir/map_services/cameras', places: ['Tehran'], country: 'Iran' }
];
const shrine = { lat: 36.288, lon: 59.6157, coordinateType: 'view', coordinateSource: 'https://en.wikipedia.org/wiki/Imam_Reza_Shrine', coordinateNote: 'Approximate location of the Imam Reza shrine complex. Individual camera positions and courtyard positions are not published.' };
const views = new Map([
  [2, ['Shrine broadcast', 'Haramrazavi']],
  [1, ['Sanctuary', 'Rawzeh-ye-Monavvareh']],
  [6, ['Enghelab Courtyard', 'Enghelab-Sahn']],
  [4, ['Azadi Courtyard', 'Azadi-Sahn']],
  [9, ['Goharshad Courtyard', 'Goharshad-Sahn']]
]);
const clean = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
function meta(html, property) {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].find(([tag]) => tag.includes(`"${property}"`) || tag.includes(`'${property}'`))?.[0];
  return clean(tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1]);
}
function sourceFor(id) { const source = iranianSources.find(source => source.id === id); if (!source) fail('Unknown Iranian camera source.'); return source; }
export function parseIranianCameras(id, body, retrievedAt = now()) {
  const source = sourceFor(id);
  const common = { source: source.name, provider: source.name, sourceURL: source.url, country: 'Iran', retrievedAt };
  if (id === 'iran141') {
    const data = JSON.parse(body);
    if (!Array.isArray(data)) fail('Iran 141 returned an unsupported public map format.', 502);
    // The official service currently publishes an empty array. No camera names,
    // locations, or image URLs can be verified from it; never invent map pins.
    return { cameras: [], status: data.length ? 'provider' : 'unavailable', note: data.length ? 'Open the official 141 service for road cameras. This feed needs verified camera metadata before locations can be mapped.' : 'The official 141 public map currently returns no camera locations, including around Tehran. Check the camera service for availability.' };
  }
  if (id === 'iran-tehran') {
    const latText = meta(body, 'og:latitude'), lonText = meta(body, 'og:longitude');
    const lat = Number(latText), lon = Number(lonText);
    if (!meta(body, 'og:url').includes('/webcam/Iran/Tehran/37931.html') || !/Tehran/i.test(meta(body, 'og:title')) || !latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 35 || lat > 36.5 || lon < 50 || lon > 52.5) fail('The Tehran directory page no longer has a verified Tehran listing.', 502);
    const offline = /This webcam is currently offline!/i.test(body);
    const note = offline ? 'The Tehran city-view listing was marked offline at the last source check. Open the provider page to check for a new broadcast.' : 'A public listing for several Tehran views. Live availability and the individual camera locations have not been independently verified.';
    return { cameras: [{ ...common, id: 'iran-tehran:37931', name: 'Tehran — Several Views', description: 'تهران · Public city-view broadcast listing. Multiple views may share this listing.', location: 'Tehran, Iran', lat, lon, url: source.url, viewingPage: source.url, kind: 'page', mediaType: 'provider', availability: offline ? 'offline' : 'unknown', availabilityCheckedAt: retrievedAt, previewNote: note, coordinateType: 'view', coordinateSource: source.url, coordinateNote: 'Approximate location supplied by the public directory for the depicted city views. It does not identify individual camera positions.', operatorCredit: 'Broadcast operator listed by Webcam Galore: Intel Cams.', attribution: 'Tehran listing and approximate map location: Webcam Galore. Broadcast rights remain with the operator.' }], status: 'ready', note };
  }
  const script = body.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) fail('Haram Razavi did not publish live-view metadata.', 502);
  const data = JSON.parse(script), rows = data?.props?.pageProps?.livesJson?.data;
  if (!Array.isArray(rows)) fail('Haram Razavi returned an unsupported live-view format.', 502);
  const cameras = rows.flatMap(row => {
    const view = views.get(row.id), attributes = row.attributes;
    if (!view || !attributes || attributes.url !== `https://newlive.nasimrezvan.com/hls/${view[1]}/index.m3u8`) return [];
    const image = attributes.image?.data?.attributes?.url;
    let thumbnail;
    try { const url = new URL(image); if (url.protocol === 'https:' && url.hostname === 'cdnfile.razavi.ir' && !url.port && !url.username && !url.password) thumbnail = url.href; } catch { /* A preview is optional. */ }
    return [{ ...common, ...shrine, id: `iran-razavi:${row.id}`, name: `Mashhad — Imam Reza ${view[0]}`, description: clean(attributes.title), location: 'Mashhad, Razavi Khorasan, Iran', url: attributes.url, viewingPage: source.url, kind: 'hls', mediaType: 'stream', thumbnail, previewNote: 'Official live broadcast; playback is available below. The thumbnail is a programme image, not a current camera frame.', operatorCredit: 'Haram Razavi / Astan Quds Razavi.', attribution: 'Public live-view metadata and programme images: Haram Razavi. All rights remain with the publisher. Approximate shrine-complex coordinates: Wikipedia GeoData.' }];
  });
  const unique = [...new Map(cameras.map(camera => [camera.url, camera])).values()];
  if (!unique.length) fail('Haram Razavi returned no recognized public live views.', 502);
  return { cameras: unique, status: 'ready', note: 'Official Mashhad shrine broadcasts. Programme thumbnails and approximate shrine locations are identified in each view; stream availability depends on the publisher.' };
}
export async function fetchIranianCameras(id) {
  const source = sourceFor(id);
  const response = await fetch(source.dataURL || source.url, { redirect: 'error', headers: { Accept: 'text/html,application/json', 'User-Agent': 'NorthstarWorkbench/0.2 public-camera-metadata' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(`${source.name} returned HTTP ${response.status}.`, 502);
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5e6) { await reader.cancel(); fail('Iranian camera metadata response is too large.', 502); } parts.push(value); } } finally { reader.releaseLock(); }
  const retrievedAt = now();
  return { ...parseIranianCameras(id, Buffer.concat(parts).toString(), retrievedAt), retrievedAt };
}
