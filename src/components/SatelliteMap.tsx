import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw, Info } from 'lucide-react';
import { api } from '../lib/api';
import { DETAIL_TILE_URL, STREET_LABEL_TILE_URL, BOUNDARY_LABEL_TILE_URL, satelliteTileUrl, satelliteTime, type SatelliteCatalogue } from '../lib/satellite';
import type { MapBounds, MapViewport } from '../lib/map-projection';
import StreetMapTiles, { type TileSource } from './StreetMapTiles';

export function useSatelliteImagery(enabled: boolean) {
  const [catalogue, setCatalogue] = useState<SatelliteCatalogue | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('detail'), [date, setDate] = useState(''), [paused, setPaused] = useState(false), [version, setVersion] = useState(0), [labels, setLabels] = useState(true);
  const [boundaries, setBoundaries] = useState(true);
  const detailed = selected === 'detail';
  useEffect(() => {
    if (!enabled || detailed) { setBusy(false); return; }
    const controller = new AbortController(); setBusy(true); setError('');
    api<SatelliteCatalogue>(`/satellite${version ? '?refresh=1' : ''}`, undefined, 'GET', controller.signal)
      .then(data => { if (!controller.signal.aborted) setCatalogue(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [enabled, detailed, version]);
  useEffect(() => {
    if (!enabled || detailed || paused || date) return;
    const timer = window.setInterval(() => { if (!document.hidden) setVersion(value => value + 1); }, 300000);
    return () => window.clearInterval(timer);
  }, [enabled, detailed, paused, date]);
  const layer = catalogue?.layers.find(item => item.id === selected);
  const imageryTime = layer ? selected === 'viirs' && date ? date : layer.time : '';
  const source = useMemo<TileSource | null>(() => detailed ? {
    key: 'detail', url: DETAIL_TILE_URL, label: 'Satellite imagery', maxZoom: 19, refresh: version,
    attribution: `Esri, Vantor, Earthstar Geographics, GIS community${labels || boundaries ? ' · Map labels: Esri, HERE, Garmin, © OSM' : ''}`,
    attributionUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
  } : layer ? { key: `${selected}:${imageryTime}`, url: satelliteTileUrl(layer, date), label: 'Satellite imagery', attribution: 'NASA GIBS · NOAA', attributionUrl: 'https://nasa-gibs.github.io/gibs-api-docs/', maxZoom: layer.maxZoom, limits: layer.limits, refresh: version } : null, [detailed, layer, selected, imageryTime, date, version, labels, boundaries]);
  return { catalogue, error, busy, selected, setSelected, date, setDate, paused, setPaused, setVersion, labels, setLabels, boundaries, setBoundaries, detailed, layer, imageryTime, source };
}
type Imagery = ReturnType<typeof useSatelliteImagery>;

export function SatelliteControls({ imagery, atMaxZoom, loading }: { imagery: Imagery; atMaxZoom: boolean; loading: boolean }) {
  const { catalogue, error, busy, selected, setSelected, date, setDate, paused, setPaused, setVersion, labels, setLabels, boundaries, setBoundaries, detailed, layer, imageryTime } = imagery;
  return <section className="satellite-settings" aria-label="Satellite imagery controls">
    <div className="satellite-settings-row">
      <label className="satellite-source-label"><span>Map view</span><select aria-label="Satellite source" value={selected} onChange={e => { setSelected(e.target.value); setDate(''); }}>
        <option value="detail">Streets &amp; buildings</option><option value="viirs">Recent global imagery</option><option value="goes-east">Weather · Americas</option><option value="goes-west">Weather · Pacific</option>
      </select></label>
      {detailed && <label className="satellite-label-toggle"><input aria-label="Street names" type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} /><span>Street names</span></label>}
      {detailed && <label className="satellite-label-toggle"><input aria-label="Borders & city names" type="checkbox" checked={boundaries} onChange={e => setBoundaries(e.target.checked)} /><span>Borders &amp; city names</span></label>}
      {selected === 'viirs' && <label className="satellite-date-label"><span>Image date</span><input aria-label="Satellite imagery date" type="date" value={date || layer?.time || ''} min={layer?.minDate} max={layer?.maxDate} disabled={!layer} onChange={e => { if (!e.target.value) setDate(''); else if (layer && e.target.value >= layer.minDate && e.target.value <= layer.maxDate) setDate(e.target.value); }} /></label>}
      <div className="satellite-update-actions"><button className="button small" aria-label="Refresh satellite imagery" disabled={busy} onClick={() => setVersion(value => value + 1)}><RefreshCw size={14} className={busy ? 'spin' : ''} />Refresh</button>
        {!detailed && <button className="button small" aria-label={paused ? 'Resume satellite updates' : 'Pause satellite updates'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button>}
      </div>
      <details className="satellite-help"><summary><Info size={14} />About imagery</summary><div><p>{detailed ? 'Satellite and aerial photographs show roads, buildings, and terrain. Capture dates and resolution vary by location; this view is not live video.' : layer?.description || 'NASA imagery shows weather and regional surface conditions.'}</p>{detailed && <p>Borders &amp; city names shows country and province/state borders, including Canadian provinces and territories. City labels appear as you zoom in; they are not municipal boundary outlines. <a href="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer" target="_blank" rel="noreferrer">Boundary source ↗</a></p>}{catalogue && !detailed && <p>Source checked: {satelliteTime(catalogue.retrievedAt.replace(/\.\d+Z$/, 'Z'))}</p>}<a href={detailed ? 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' : 'https://nasa-gibs.github.io/gibs-api-docs/'} target="_blank" rel="noreferrer">Source details ↗</a></div></details>
    </div>
    <div className="satellite-imagery-status" role="status">
      {detailed ? <><span className="satellite-kind">Detailed imagery</span><span>Capture dates vary by location</span>{loading && <span>Loading imagery…</span>}</> : layer ? <><strong>{selected === 'viirs' ? 'Imagery day' : 'Observation'}: {satelliteTime(imageryTime)}</strong><span>{paused ? 'Updates paused' : date ? 'Historical date selected' : 'Checks for updates every 5 min'}{busy ? ' · Checking NASA…' : ''}</span>{date && <button className="text-button" onClick={() => setDate('')}>Follow latest imagery</button>}</> : <span>{busy ? 'Connecting to NASA imagery…' : 'Satellite imagery unavailable'}</span>}
      {!detailed && atMaxZoom && <span className="satellite-zoom-limit">Regional zoom limit. Choose Streets &amp; buildings for a closer view.</span>}
    </div>
    {!detailed && (error || catalogue?.stale) && <div className="satellite-metadata-error" role="status">{error || catalogue?.error} <button className="text-button" disabled={busy} onClick={() => setVersion(value => value + 1)}>Retry NASA connection</button></div>}
  </section>;
}

const labelSource: TileSource = { key: 'labels', url: STREET_LABEL_TILE_URL, label: 'Street names', attribution: '', attributionUrl: '', maxZoom: 19 };
const boundarySource: TileSource = { key: 'boundaries', url: BOUNDARY_LABEL_TILE_URL, label: 'Borders & city names', attribution: '', attributionUrl: '', maxZoom: 19 };
export default function SatelliteMap({ bounds, viewport, imagery, onLoading }: { bounds: MapBounds; viewport: MapViewport; imagery: Imagery; onLoading: (loading: boolean) => void }) {
  return <>{imagery.source && <StreetMapTiles key={imagery.source.key} bounds={bounds} viewport={viewport} source={imagery.source} onLoading={onLoading} />}
    {imagery.detailed && imagery.labels && <StreetMapTiles bounds={bounds} viewport={viewport} source={labelSource} overlay />}
    {imagery.detailed && imagery.boundaries && <StreetMapTiles bounds={bounds} viewport={viewport} source={boundarySource} overlay />}
  </>;
}
