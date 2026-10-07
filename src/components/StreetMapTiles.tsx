import { useEffect, useMemo, useState } from 'react';
import { visibleMapTiles } from '../lib/map-projection';
import type { MapBounds, MapViewport } from '../lib/map-projection';

const tileUrl = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const attribution = import.meta.env.VITE_MAP_ATTRIBUTION_TEXT || '© OpenStreetMap contributors';
const attributionUrl = import.meta.env.VITE_MAP_ATTRIBUTION_URL || 'https://www.openstreetmap.org/copyright';

export default function StreetMapTiles({ bounds, viewport }: { bounds: MapBounds; viewport: MapViewport }) {
  // Keep the previous tiles during gestures; request only the settled viewport.
  const [requested, setRequested] = useState<ReturnType<typeof visibleMapTiles>>([]);
  const [status, setStatus] = useState<Record<string, 'loaded' | 'error'>>({});
  const [retry, setRetry] = useState(0);
  const tiles = useMemo(() => visibleMapTiles(bounds, viewport.width), [bounds.x, bounds.y, bounds.width, bounds.height, viewport.width]);
  const tileKey = tiles.map(tile => tile.id).join(',');
  useEffect(() => {
    const timer = window.setTimeout(() => { setRequested(tiles); setStatus(old => Object.fromEntries(tiles.filter(tile => old[tile.id]).map(tile => [tile.id, old[tile.id]]))); }, 250);
    return () => window.clearTimeout(timer);
  }, [tileKey]);
  const failed = requested.filter(tile => status[tile.id] === 'error').length;
  return <>
    <div className="street-tiles" aria-hidden="true">
      {requested.map(tile => <img key={`${tile.id}:${retry}`} className="street-tile" alt="" draggable={false}
        // Override the app's no-referrer policy for tiles only; send the origin,
        // never camera searches or other workspace paths. Browser caching applies.
        referrerPolicy="strict-origin-when-cross-origin"
        src={tileUrl.replace('{z}', String(tile.zoom)).replace('{x}', String(tile.column)).replace('{y}', String(tile.row))}
        style={{ left: (tile.x - bounds.x) / bounds.width * viewport.width, top: (tile.y - bounds.y) / bounds.height * viewport.height, width: tile.size / bounds.width * viewport.width, height: tile.size / bounds.height * viewport.height, visibility: status[tile.id] === 'error' ? 'hidden' : undefined }}
        onLoad={() => setStatus(old => ({ ...old, [tile.id]: 'loaded' }))}
        onError={() => setStatus(old => ({ ...old, [tile.id]: 'error' }))} />)}
    </div>
    {failed > 0 && <div className="street-map-error" role="status"><span>{failed === requested.length ? 'Street map unavailable. Camera pins still work.' : 'Some street tiles could not load.'}</span><button onClick={() => { setStatus({}); setRetry(value => value + 1); }}>Retry street map</button></div>}
    <a className="map-attribution" href={attributionUrl} target="_blank" rel="noreferrer">{attribution}</a>
  </>;
}
