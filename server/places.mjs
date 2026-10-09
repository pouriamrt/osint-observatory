const endpoint = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';

export function normalizePlaceCandidates(data) {
  if (!Array.isArray(data?.candidates)) throw new Error('Place search returned an unreadable response.');
  return data.candidates.slice(0, 5).flatMap((candidate, index) => {
    const lat = candidate.location?.y, lon = candidate.location?.x, name = candidate.address;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85.051129 || Math.abs(lon) > 180 || typeof name !== 'string' || !name.trim()) return [];
    const extent = candidate.extent, latSpan = extent?.ymax - extent?.ymin, lonSpan = extent?.xmax - extent?.xmin;
    return [{ id: `place:${index}`, name: name.slice(0, 300), lat, lon, span: { lat: Number.isFinite(latSpan) && latSpan > 0 ? Math.min(180, Math.max(.002, latSpan)) : .008, lon: Number.isFinite(lonSpan) && lonSpan > 0 ? Math.min(360, Math.max(.002, lonSpan)) : .01 } }];
  });
}

export async function findPlaces(query, fetcher = fetch) {
  const url = new URL(endpoint);
  // Temporary map navigation only; search results are never written to SQLite.
  url.search = new URLSearchParams({ SingleLine: query, f: 'json', outSR: '4326', maxLocations: '5', forStorage: 'false' }).toString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Northstar-Workbench/0.1 (+https://github.com/pouriamrt/osint-observatory)' } });
    if (!response.ok) throw new Error('Search unavailable');
    const data = await response.json();
    if (data.error) throw new Error('Search unavailable');
    return { results: normalizePlaceCandidates(data), source: 'Esri World Geocoding', sourceUrl: 'https://developers.arcgis.com/rest/geocode/find-address-candidates/' };
  } catch { const error = new Error('Place search is unavailable. Try again, use a city shortcut, or enter latitude, longitude.'); error.status = 502; throw error; }
}
