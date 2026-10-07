import { fail, httpUrl, now } from './core.mjs';
export const canadianSources = [
  { id: 'drivebc', name: 'DriveBC', dataURL: 'https://www.drivebc.ca/api/webcams/', url: 'https://catalogue.data.gov.bc.ca/dataset/bc-highwaycams', license: 'Open Government Licence – British Columbia', licenseURL: 'https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc', attribution: 'Contains information licensed under the Open Government Licence – British Columbia.' },
  { id: 'quebec511', name: 'Québec 511', dataURL: 'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson', url: 'https://www.donneesquebec.ca/recherche/dataset/camera-de-circulation', license: 'CC BY 4.0', licenseURL: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Ministère des Transports et de la Mobilité durable, Caméra de circulation, Données Québec. Metadata adapted for this map.' },
  { id: 'toronto', name: 'Toronto Traffic Cameras', dataURL: 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json', url: 'https://open.toronto.ca/dataset/traffic-cameras/', license: 'Open Government Licence – Toronto', licenseURL: 'https://open.toronto.ca/open-data-license/', attribution: 'Contains information licensed under the Open Government Licence – Toronto. Source: City of Toronto.' },
  { id: 'calgary', name: 'Calgary Traffic Cameras', dataURL: 'https://data.calgary.ca/resource/k7p9-kppz.json?$limit=5000', url: 'https://data.calgary.ca/Transportation-Transit/Traffic-Cameras/k7p9-kppz', license: 'Open Calgary Terms of Use', licenseURL: 'https://data.calgary.ca/d/Open-Data-Terms/u45n-7awa', attribution: 'Source: The City of Calgary, Mobility. Open Calgary traffic camera data.' },
  { id: 'ottawa', name: 'Ottawa Traffic Cameras', dataURL: 'https://traffic.ottawa.ca/map/service/camera', url: 'https://traffic.ottawa.ca/en/opendata', license: 'Open Government Licence – City of Ottawa', licenseURL: 'https://ottawa.ca/en/city-hall/open-transparent-and-accountable-government/open-data/open-data-licence-version-20', attribution: 'Camera metadata contains information licensed under the Open Government Licence – City of Ottawa. Images are supplied by the camera operator identified below.' }
];
const text = value => String(value || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const numeric = value => ['string', 'number'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value));
function position(lon, lat) { return numeric(lat) && numeric(lon) && Number(lat) >= 41 && Number(lat) <= 84 && Number(lon) >= -142 && Number(lon) <= -50 ? { lat: Number(lat), lon: Number(lon) } : null; }
function safe(value) { try { return httpUrl(value); } catch { return undefined; } }
export function quebecSnapshotMetadata(cameraNumber) {
  // These four image directories are published by the official mobile camera pages.
  // The code comes from the WFS NumeroCamera field, not the numeric map feature ID.
  const match = String(cameraNumber || '').match(/^([QMTG])(\d+)$/);
  const folders = { Q: 'Quebec', M: 'Montreal', T: 'TroisRivieres', G: 'Gatineau' };
  if (!match) return {};
  return { cameraNumber, thumbnail: `https://www.quebec511.info/Images/Cameras/${folders[match[1]]}/cam/${match[2]}.jpg`, mediaType: 'snapshot', previewNote: undefined };
}
export function parseCameraFeed(id, body) {
  if (id !== 'toronto') return JSON.parse(body);
  // The documented city feed uses JSONP. Parse its JSON without executing code.
  const match = body.match(/^\s*jsonTMCEarthCamerasCallback\((\{[\s\S]*\})\);?\s*$/);
  if (!match) fail('Toronto returned an unsupported camera feed.', 502);
  return JSON.parse(match[1]);
}
export function normalizeCanadianCameras(id, data, retrievedAt = now()) {
  const source = canadianSources.find(s => s.id === id); if (!source) fail('Unknown camera feed.');
  const common = { source: source.name, provider: source.name, sourceURL: source.url, country: 'Canada', kind: 'page', coordinateType: 'provider', coordinateSource: source.dataURL, license: source.license, licenseURL: source.licenseURL, attribution: source.attribution, retrievedAt };
  let rows;
  if (id === 'drivebc') rows = Array.isArray(data) ? data.flatMap(c => {
    const coords = c.location?.type === 'Point' && c.location.coordinates, p = coords && position(coords[0], coords[1]);
    if (!p || !c.is_on || !c.should_appear || !/^\d+$/.test(String(c.id))) return [];
    let image; try { image = new URL(c.links?.imageDisplay, 'https://www.drivebc.ca/'); } catch { return []; }
    if (image.hostname !== 'www.drivebc.ca' || image.protocol !== 'https:' || !image.pathname.startsWith('/images/')) return [];
    const url = new URL(image); url.search = '';
    return [{ ...common, ...p, id: `drivebc:${c.id}`, name: text(c.name_override || c.name), location: `${text(c.region_name)}, Canada`, description: text(c.caption_override || c.caption), url: url.href, thumbnail: image.href, mediaType: 'snapshot', operatorCredit: text(c.credit), imageUpdatedAt: c.last_update_modified || undefined, imageStale: !!c.marked_stale || !!c.marked_delayed }];
  }) : [];
  if (id === 'quebec511') rows = data?.type === 'FeatureCollection' && Array.isArray(data.features) ? data.features.flatMap(f => {
    const c = f.properties || {}, coords = f.geometry?.type === 'Point' && f.geometry.coordinates, p = coords && position(coords[0], coords[1]), url = safe(c.URL_FLUX_DONNEE);
    if (!p || !url || !/^\d+$/.test(String(c.IDEcamera))) return [];
    return [{ ...common, ...p, id: `quebec511:${c.IDEcamera}`, name: text(c.DescriptionLocalisationEn || c.DescriptionLocalisationFr), location: `${text(c.NomRegionDiffusion)}, Québec, Canada`, description: text(c.DescriptionLocalisationFr), url, viewingPage: url, mediaType: 'provider', previewNote: 'Open the official camera page to view this source.', ...quebecSnapshotMetadata(c.NumeroCamera) }];
  }) : [];
  if (id === 'toronto') rows = Array.isArray(data?.Data) ? data.Data.flatMap(c => {
    const p = position(c.Longitude, c.Latitude); if (!p || !/^\d+$/.test(String(c.Number))) return [];
    const url = `https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc${c.Number}.jpg`;
    return [{ ...common, ...p, id: `toronto:${c.Number}`, name: text(c.Name), location: 'Toronto, Ontario, Canada', description: text(c.Group), url, thumbnail: url, mediaType: 'snapshot' }];
  }) : [];
  if (id === 'calgary') rows = Array.isArray(data) ? data.flatMap(c => {
    const coords = c.point?.type === 'Point' && c.point.coordinates, p = coords && position(coords[0], coords[1]), value = safe(c.camera_url?.url);
    if (!p || !value) return []; const url = new URL(value);
    if (url.hostname !== 'trafficcam.calgary.ca' || !/^\/loc\d+\.jpg$/i.test(url.pathname)) return [];
    url.protocol = 'https:';
    return [{ ...common, ...p, id: `calgary:${url.pathname.match(/\d+/)[0]}`, name: text(c.camera_location), location: `Calgary ${text(c.quadrant)}, Alberta, Canada`, url: url.href, thumbnail: url.href, mediaType: 'snapshot' }];
  }) : [];
  if (id === 'ottawa') rows = Array.isArray(data?.cameras) ? data.cameras.flatMap(c => {
    const p = position(c.longitude, c.latitude);
    if (!p || !/^\d+$/.test(String(c.id)) || !/^\d+$/.test(String(c.camera_number)) || !['CITY', 'MTO'].includes(c.cameraOwner)) return [];
    const url = `https://traffic.ottawa.ca/map/cameraWindow?id=${c.id}`;
    // The public camera page resolves the feature ID to camera_number for its image.
    // This is the public map's image route; the separate open-data image API requires a certificate.
    const thumbnail = `https://traffic.ottawa.ca/camera?id=${c.camera_number}`;
    return [{ ...common, ...p, id: `ottawa:${c.id}`, cameraNumber: c.camera_number, name: text(c.name), location: 'Ottawa, Ontario, Canada', description: text(c.name_french), url, viewingPage: url, thumbnail, mediaType: 'snapshot', operatorCredit: c.cameraOwner === 'MTO' ? 'Ontario Ministry of Transportation, via the City of Ottawa public traffic map.' : 'City of Ottawa, Traffic Services.', coordinateNote: 'The published map position identifies the intersection or roadway location, not the precise camera pole.' }];
  }) : [];
  const unique = [...new Map((rows || []).filter(c => c.name).map(c => [c.url, c])).values()];
  if (!unique.length) fail(`${source.name} returned no usable camera locations.`, 502);
  return unique;
}
export async function fetchCanadianCameras(source) {
  const response = await fetch(source.dataURL, { redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'NorthstarWorkbench/0.2 public-camera-metadata' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(`${source.name} returned HTTP ${response.status}.`, 502);
  const reader = response.body.getReader(), parts = []; let bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 5e6) { await reader.cancel(); fail(`${source.name} feed is too large.`, 502); } parts.push(part.value); } } finally { reader.releaseLock(); }
  const retrievedAt = now(); return { cameras: normalizeCanadianCameras(source.id, parseCameraFeed(source.id, Buffer.concat(parts).toString()), retrievedAt), retrievedAt };
}
