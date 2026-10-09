import type { MapTileLimit } from './map-projection';

export type SatelliteLayer = {
  id: string; layer: string; name: string; cadence: string; description: string;
  time: string; minDate: string; maxDate: string; maxZoom: number; limits: MapTileLimit[]; tileUrl: string;
};
export type SatelliteCatalogue = { layers: SatelliteLayer[]; source: string; retrievedAt: string; stale: boolean; error?: string };
export type MapPlace = { id: string; name: string; lat: number; lon: number; span: { lat: number; lon: number }; key?: string };
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
