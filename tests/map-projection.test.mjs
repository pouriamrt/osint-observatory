import test from 'node:test';
import assert from 'node:assert/strict';
import { mapY, mapLatitude, mapBounds, visibleMapTiles, MAX_MAP_LATITUDE, mapZoomAtTileLevel } from '../src/lib/map-projection.ts';

test('street projection agrees with the published OSM Hachiko tile and round-trips Canadian latitudes', () => {
  // Reference example: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
  const count = 2 ** 18;
  assert.equal(Math.floor((139.7006793 + 180) / 360 * count), 232798);
  assert.equal(Math.floor(mapY(35.6590699) / 360 * count), 103246);
  for (const latitude of [-MAX_MAP_LATITUDE, -45, 0, 45.353713, 70, MAX_MAP_LATITUDE]) {
    assert(Math.abs(mapLatitude(mapY(latitude)) - latitude) < 1e-9);
  }
  assert.equal(mapY(90), mapY(MAX_MAP_LATITUDE));
  assert.equal(mapY(-90), mapY(-MAX_MAP_LATITUDE));
});

test('street detail reaches native imagery while weather zoom stops at its regional resolution on every viewport', () => {
  for (const viewport of [{ width: 1140, height: 530 }, { width: 358, height: 390 }, { width: 1920, height: 1080 }]) {
    for (const level of [6, 9, 19]) {
      const bounds = mapBounds({ lat: 45.4215, lon: -75.6972 }, mapZoomAtTileLevel(level, viewport), viewport);
      const tiles = visibleMapTiles(bounds, viewport.width, level);
      assert(tiles.length > 0 && tiles.every(tile => tile.zoom === level));
      assert(Math.abs(tiles[0].size / bounds.width * viewport.width - 256) < 1e-6, 'The zoom limit shows native pixels rather than one enlarged flat pixel');
    }
  }
});

test('street requests cover only the visible tile matrix at bounded native zoom', () => {
  for (const viewport of [{ width: 980, height: 450 }, { width: 358, height: 300 }, { width: 1920, height: 1080 }]) {
    for (const zoom of [1, 1024, 65536]) {
      const bounds = mapBounds({ lat: 45.353713, lon: -75.647382 }, zoom, viewport);
      const tiles = visibleMapTiles(bounds, viewport.width);
      assert(tiles.length > 0 && tiles.length <= 96, 'No offscreen tile prefetch');
      for (const tile of tiles) {
        assert(tile.zoom >= 0 && tile.zoom <= 19);
        assert(tile.column >= 0 && tile.column < 2 ** tile.zoom);
        assert(tile.row >= 0 && tile.row < 2 ** tile.zoom);
        assert(tile.x < bounds.x + bounds.width && tile.x + tile.size > bounds.x);
        assert(tile.y < bounds.y + bounds.height && tile.y + tile.size > bounds.y);
      }
      const cornerBounds = mapBounds({ lat: 90, lon: 180 }, zoom, viewport);
      assert(cornerBounds.x >= 0 && cornerBounds.x + cornerBounds.width <= 360);
      assert(cornerBounds.y >= 0 && cornerBounds.y + cornerBounds.height <= 360);
    }
  }
});
