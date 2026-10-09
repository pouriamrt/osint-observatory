import { useEffect, useMemo, useState } from 'react';
import { visibleMapTiles } from '../lib/map-projection';
import type { MapBounds, MapViewport } from '../lib/map-projection';
import type { MapTileLimit } from '../lib/map-projection';

const tileUrl = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const attribution = import.meta.env.VITE_MAP_ATTRIBUTION_TEXT || '© OpenStreetMap contributors';
const attributionUrl = import.meta.env.VITE_MAP_ATTRIBUTION_URL || 'https://www.openstreetmap.org/copyright';

export type TileSource = { key: string; url: string; label: string; attribution: string; attributionUrl: string; maxZoom: number; limits?: MapTileLimit[]; refresh?: number };
const streetSource: TileSource = { key: 'street', url: tileUrl, label: 'Street map', attribution, attributionUrl, maxZoom: 19 };

export default function StreetMapTiles({ bounds, viewport, source = streetSource, overlay = false, onLoading }: { bounds: MapBounds; viewport: MapViewport; source?: TileSource; overlay?: boolean; onLoading?: (loading: boolean) => void }) {
  // Keep the previous tiles during gestures; request only the settled viewport.
  const [requested, setRequested] = useState<ReturnType<typeof visibleMapTiles>>([]);
  const [status, setStatus] = useState<Record<string, 'loaded' | 'error'>>({});
  const [retry, setRetry] = useState(0);
  const tiles = useMemo(() => visibleMapTiles(bounds, viewport.width, source.maxZoom, source.limits), [bounds.x, bounds.y, bounds.width, bounds.height, viewport.width, source]);
  const tileKey = tiles.map(tile => tile.id).join(',');
  useEffect(() => {
    const timer = window.setTimeout(() => { setRequested(tiles); setStatus(old => Object.fromEntries(tiles.filter(tile => old[tile.id]).map(tile => [tile.id, old[tile.id]]))); }, 250);
    return () => window.clearTimeout(timer);
  }, [tileKey]);
  const failed = requested.filter(tile => status[tile.id] === 'error').length;
  const satellite = source.key !== 'street';
  const boundaries = overlay && source.key === 'boundaries';
  useEffect(() => { setStatus({}); }, [retry, source.refresh]);
  useEffect(() => { onLoading?.(!requested.length || requested.some(tile => !status[tile.id])); }, [requested, status, onLoading]);
  return <>
    <div className={boundaries ? 'satellite-boundary-tiles' : overlay ? 'satellite-label-tiles' : 'street-tiles'} aria-hidden="true">
      {requested.map(tile => <MapTileImage key={tile.id} satellite={satellite} overlay={overlay} boundaries={boundaries}
        // Override the app's no-referrer policy for tiles only; send the origin,
        // never camera searches or other workspace paths. Browser caching applies.
        src={source.url.replace('{z}', String(tile.zoom)).replace('{x}', String(tile.column)).replace('{y}', String(tile.row)) + (satellite && (source.refresh || retry) ? `?refresh=${source.refresh || 0}-${retry}` : '')}
        retry={retry}
        style={{ left: (tile.x - bounds.x) / bounds.width * viewport.width, top: (tile.y - bounds.y) / bounds.height * viewport.height, width: tile.size / bounds.width * viewport.width, height: tile.size / bounds.height * viewport.height }}
        onStatus={state => setStatus(old => old[tile.id] === state ? old : ({ ...old, [tile.id]: state }))} />)}
    </div>
    {failed > 0 && <div className={`street-map-error ${overlay ? 'street-label-error' : ''} ${boundaries ? 'boundary-map-error' : ''}`} role="status"><span>{boundaries ? 'Borders and city names could not load. Satellite imagery is still available.' : overlay ? 'Street names could not load. Satellite imagery is still available.' : satellite ? 'Satellite tiles could not load. Any retained images are from the previous fetch.' : failed === requested.length ? 'Street map unavailable. Camera pins still work.' : 'Some street tiles could not load.'}</span><button onClick={() => { setStatus({}); setRetry(value => value + 1); }}>Retry {boundaries ? 'borders & city names' : overlay ? 'street names' : satellite ? 'satellite imagery' : 'street map'}</button></div>}
    {satellite && !overlay && !tiles.length && <div className="street-map-error" role="status">This region is outside this satellite’s coverage. Choose Global VIIRS or pan to the Americas.</div>}
    {!overlay && <a className="map-attribution" href={source.attributionUrl} target="_blank" rel="noreferrer">{source.attribution}</a>}
  </>;
}

function MapTileImage({ src, retry, satellite, overlay, boundaries, style, onStatus }: { src: string; retry: number; satellite: boolean; overlay: boolean; boundaries: boolean; style: React.CSSProperties; onStatus: (state: 'loaded' | 'error') => void }) {
  const [displayed, setDisplayed] = useState(src), [loaded, setLoaded] = useState(false);
  // Stage refreshed imagery behind the last loaded frame. A date/source change
  // remounts the tile layer so imagery from two observation times is never mixed.
  return <>
    <img key={`${displayed}:${satellite ? 0 : retry}`} className={`street-tile ${boundaries ? 'satellite-boundary-tile' : overlay ? 'satellite-label-tile' : satellite ? 'satellite-tile' : ''}`} alt="" draggable={false} referrerPolicy="strict-origin-when-cross-origin"
      src={displayed} style={{ ...style, visibility: loaded ? undefined : 'hidden' }}
      onLoad={() => { setLoaded(true); if (displayed === src) onStatus('loaded'); }} onError={() => onStatus('error')} />
    {displayed !== src && <img key={src} className="map-tile-pending" alt="" draggable={false} referrerPolicy="strict-origin-when-cross-origin" src={src}
      onLoad={() => { setDisplayed(src); setLoaded(true); onStatus('loaded'); }} onError={() => onStatus('error')} />}
  </>;
}
