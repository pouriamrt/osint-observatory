import type { MapTileLimit } from './map-projection';

export type SatelliteLayer = {
  id: string; layer: string; name: string; cadence: string; description: string;
  time: string; minDate: string; maxDate: string; maxZoom: number; limits: MapTileLimit[]; tileUrl: string;
};
export type SatelliteCatalogue = { layers: SatelliteLayer[]; source: string; retrievedAt: string; stale: boolean; error?: string };
export type MapPlace = { id: string; name: string; lat: number; lon: number; span: { lat: number; lon: number }; key?: string };
export const SATELLITE_CAMERA_RADII = [10, 25, 50, 100, 250, 500];

export function nearbySatelliteRoute(lat: number, lon: number, radius = 25, name = '') {
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: String(radius), place: name.slice(0, 300), cameras: '1' });
  return `#satellite?${params}`;
}

export function satelliteLocationFromRoute(hash: string) {
  const [route, query] = hash.replace(/^#/, '').split('?');
  if (route !== 'satellite') return null;
  const params = new URLSearchParams(query);
  if (!params.get('lat')?.trim() || !params.get('lon')?.trim()) return null;
  const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85.051129 || Math.abs(lon) > 180) return null;
  const requestedRadius = Number(params.get('radius')), radius = SATELLITE_CAMERA_RADII.includes(requestedRadius) ? requestedRadius : 25;
  const place: MapPlace = { id: 'linked-location', name: params.get('place')?.trim().slice(0, 300) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon, span: { lat: radius * 2 / 111, lon: Math.min(360, radius * 2 / (111 * Math.max(.1, Math.cos(lat * Math.PI / 180)))) } };
  return { place, radius, showCameras: params.get('cameras') === '1' };
}

export const DETAIL_TILE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const STREET_LABEL_TILE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
export const BOUNDARY_LABEL_TILE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_PLACES: MapPlace[] = [
  { id: 'ottawa', name: 'Ottawa', lat: 45.4215, lon: -75.6972, span: { lat: .012, lon: .016 } },
  { id: 'toronto', name: 'Toronto', lat: 43.6532, lon: -79.3832, span: { lat: .012, lon: .016 } },
  { id: 'tehran', name: 'Tehran', lat: 35.6892, lon: 51.3890, span: { lat: .012, lon: .016 } }
];

export function satelliteTileUrl(layer: SatelliteLayer, date = '') {
  return layer.tileUrl.replace('{time}', encodeURIComponent(layer.id === 'viirs' && date ? date : layer.time));
}

export function satelliteTime(value: string) {
  return value.includes('T') ? value.replace('T', ' ').replace('Z', ' UTC') : `${value} · UTC day`;
}

export const NASA_ISS_PLAYLIST = 'https://www.youtube.com/playlist?list=PL2aBZuCeDwlQMf6xMgQAUAY_nbHAgW5jz';
