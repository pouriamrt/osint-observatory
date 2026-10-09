export const SATELLITE_CAPABILITIES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml';
const sources = [
  { id: 'viirs', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', name: 'Global · NOAA-20 VIIRS', cadence: 'daily', description: 'Daily daylight imagery. New observations arrive within hours; clouds, night, and gaps can obscure the surface.' },
  { id: 'goes-east', layer: 'GOES-East_ABI_GeoColor', name: 'Americas · GOES-East', cadence: '10 minutes', description: 'Weather imagery over the Americas and Atlantic. Frames are about 10 minutes apart, with a processing delay.' },
  { id: 'goes-west', layer: 'GOES-West_ABI_GeoColor', name: 'Pacific · GOES-West', cadence: '10 minutes', description: 'Weather imagery over the Americas and Pacific. Frames are about 10 minutes apart, with a processing delay.' }
];

// Read only the three known NASA layers; respect per-layer matrix limits,
// including the disjoint column ranges in GOES-West's dateline coverage.
export function parseSatelliteCapabilities(xml) {
  const blocks = [...xml.matchAll(/<Layer>([\s\S]*?)<\/Layer>/g)].map(match => match[1]);
  return sources.map(source => {
    const block = blocks.find(value => value.includes(`<ows:Identifier>${source.layer}</ows:Identifier>`));
    const time = block?.match(/<Default>([^<]+)<\/Default>/)?.[1];
    const matrix = block?.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/)?.[1];
    const format = block?.match(/<Format>([^<]+)<\/Format>/)?.[1];
    if (!time || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/.test(time) || !matrix?.match(/^GoogleMapsCompatible_Level\d+$/) || !['image/jpeg', 'image/png'].includes(format)) {
      throw new Error(`NASA metadata is unavailable for ${source.name}.`);
    }
    const limits = [...block.matchAll(/<TileMatrixLimits>([\s\S]*?)<\/TileMatrixLimits>/g)].map(match => {
      const number = tag => Number(match[1].match(new RegExp(`<${tag}>(\\d+)</${tag}>`))?.[1]);
      return { zoom: number('TileMatrix'), minRow: number('MinTileRow'), maxRow: number('MaxTileRow'), minColumn: number('MinTileCol'), maxColumn: number('MaxTileCol') };
    });
    if (limits.some(limit => Object.values(limit).some(value => !Number.isInteger(value)))) throw new Error('NASA tile limits could not be read.');
    const maxZoom = limits.length ? Math.max(...limits.map(limit => limit.zoom)) : Number(matrix.match(/\d+$/)[0]);
    const dates = [...block.matchAll(/<Value>([^<]+)<\/Value>/g)].map(match => match[1]);
    return { ...source, time, minDate: dates[0]?.slice(0, 10) || time.slice(0, 10), maxDate: time.slice(0, 10), maxZoom, limits,
      tileUrl: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${source.layer}/default/{time}/${matrix}/{z}/{y}/{x}.${format === 'image/png' ? 'png' : 'jpeg'}` };
  });
}

export function createSatelliteProvider(fetcher = fetch, clock = Date.now) {
  let cached, pending, lastAttempt = -Infinity;
  return async function satelliteCatalogue(refresh = false) {
    if (pending) return pending;
    if (cached && !refresh && clock() - lastAttempt < (cached.stale ? 60000 : 300000)) return cached;
    lastAttempt = clock();
    pending = (async () => {
      try {
        const response = await fetcher(SATELLITE_CAPABILITIES, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`NASA metadata returned HTTP ${response.status}.`);
        const layers = parseSatelliteCapabilities(await response.text());
        cached = { layers, source: SATELLITE_CAPABILITIES, retrievedAt: new Date(clock()).toISOString(), stale: false };
      } catch (error) {
        if (!cached) { const unavailable = new Error('Satellite metadata is unavailable. Retry to reconnect to NASA.'); unavailable.status = 502; throw unavailable; }
        cached = { ...cached, stale: true, error: 'NASA metadata refresh failed. Showing the last retrieved imagery times.' };
      }
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
