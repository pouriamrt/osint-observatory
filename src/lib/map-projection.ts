// Web Mercator in a 360 × 360 square, shared by roads, pins, and map gestures.
export const MAX_MAP_LATITUDE = Math.atan(Math.sinh(Math.PI)) * 180 / Math.PI;
export type MapBounds = { x: number; y: number; width: number; height: number };
export type MapViewport = { width: number; height: number };

export function mapY(lat: number) {
  const radians = Math.max(-MAX_MAP_LATITUDE, Math.min(MAX_MAP_LATITUDE, lat)) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) * 180;
}

export function mapLatitude(y: number) {
  return Math.atan(Math.sinh(Math.PI * (1 - Math.max(0, Math.min(360, y)) / 180))) * 180 / Math.PI;
}

export function mapBounds(center: { lon: number; lat: number }, zoom: number, viewport: MapViewport): MapBounds {
  const width = Math.min(360, 360 * viewport.width / viewport.height) / zoom;
  const height = width * viewport.height / viewport.width;
  return {
    x: Math.max(0, Math.min(360 - width, center.lon + 180 - width / 2)),
    y: Math.max(0, Math.min(360 - height, mapY(center.lat) - height / 2)),
    width, height
  };
}

export function visibleMapTiles(bounds: MapBounds, viewportWidth: number) {
  const zoom = Math.max(0, Math.min(19, Math.round(Math.log2(360 / bounds.width * viewportWidth / 256))));
  const count = 2 ** zoom, size = 360 / count;
  const firstX = Math.max(0, Math.floor(bounds.x / size)), lastX = Math.min(count - 1, Math.ceil((bounds.x + bounds.width) / size) - 1);
  const firstY = Math.max(0, Math.floor(bounds.y / size)), lastY = Math.min(count - 1, Math.ceil((bounds.y + bounds.height) / size) - 1);
  const tiles: { id: string; zoom: number; column: number; row: number; x: number; y: number; size: number }[] = [];
  for (let row = firstY; row <= lastY; row++) for (let column = firstX; column <= lastX; column++) {
    tiles.push({ id: `${zoom}/${column}/${row}`, zoom, column, row, x: column * size, y: row * size, size });
  }
  return tiles;
}
