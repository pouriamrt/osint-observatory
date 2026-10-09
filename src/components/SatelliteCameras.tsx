import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, MapPin, Play, RefreshCw, Search, Square } from 'lucide-react';
import { External } from './common';
import CameraSnapshot from './CameraSnapshot';
import { nearbyCameraRoute, safeUrl, useData, type Row } from '../lib/api';
import { distance } from '../lib/geometry';
import { cameraViewKind, cameraViewLabel, type LiveView, type MapCamera } from '../lib/live-views';
import type { MapPlace } from '../lib/satellite';

export function useMapCameras(place: MapPlace, live: LiveView[]) {
  const inventory = useData<{ cameras: MapCamera[]; sources: Row[] }>('/cameras', { cameras: [], sources: [] });
  const [enabled, setEnabled] = useState(true), [radius, setRadius] = useState(25), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [selected, select] = useState('');
  const featured = useMemo(() => live.filter(view => typeof view.lat === 'number' && typeof view.lon === 'number').map(view => ({ ...view, lat: view.lat!, lon: view.lon!, kind: 'youtube', source: view.provider, url: view.sourceURL })), [live]);
  const cameras = useMemo(() => [...featured, ...inventory.data.cameras.filter(camera => Number.isFinite(camera.lat) && Number.isFinite(camera.lon) && !featured.some(view => view.sourceURL === camera.url))], [featured, inventory.data.cameras]);
  const nearby = useMemo(() => cameras.filter(camera => distance(place, camera) <= radius * 1000 && (filter === 'all' || cameraViewKind(camera) === filter) && `${camera.name} ${camera.country || ''} ${camera.provider || ''}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => distance(place, a) - distance(place, b)), [cameras, place, radius, filter, query]);
  const item = cameras.find(camera => camera.id === selected);
  const points = useMemo(() => enabled ? [...new Map([...featured.filter(camera => filter === 'all' || cameraViewKind(camera) === filter), ...nearby, ...(item ? [item] : [])].map(camera => [camera.id, camera])).values()] : [], [enabled, featured, nearby, item, filter]);
  return { inventory, enabled, setEnabled, radius, setRadius, filter, setFilter, query, setQuery, featured, nearby, cameras, item, selected, select, points };
}
type CameraViews = ReturnType<typeof useMapCameras>;
export function CameraMapControls({ views }: { views: CameraViews }) {
  return <div className="satellite-camera-controls">
    <label><input type="checkbox" checked={views.enabled} onChange={event => views.setEnabled(event.target.checked)} /> <Camera size={15} />Camera pins</label>
    <label>Nearby radius<select aria-label="Nearby satellite cameras radius" value={views.radius} onChange={event => views.setRadius(Number(event.target.value))}>{[10, 25, 100].map(radius => <option key={radius} value={radius}>{radius} km</option>)}</select></label>
    <span>{views.inventory.busy ? 'Loading camera directory…' : `${views.nearby.length} matching cameras near this place`}</span>
    <button className="text-button" onClick={() => document.getElementById('satellite-cameras')?.scrollIntoView({ behavior: 'smooth' })}>Browse & watch cameras</button>
  </div>;
}
function DirectCameraVideo({ item }: { item: MapCamera }) {
  const ref = useRef<HTMLVideoElement>(null), [error, setError] = useState('');
  const url = safeUrl(item.url);
  useEffect(() => {
    if (item.kind !== 'hls' || !url || !ref.current) return;
    const video = ref.current; let cancelled = false, destroy: (() => void) | undefined;
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; return () => { video.removeAttribute('src'); video.load(); }; }
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) { setError('This browser cannot play this stream. Open the provider below.'); return; }
      const player = new Hls(); destroy = () => player.destroy(); player.loadSource(url); player.attachMedia(video);
      player.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setError('The video stream could not load. Retry or open the provider below.'); });
    }).catch(() => { if (!cancelled) setError('The video player could not load. Retry or open the provider below.'); });
    return () => { cancelled = true; destroy?.(); };
  }, [item.kind, url]);
  return <><div className="street-video"><video ref={ref} src={item.kind === 'video' ? url : undefined} controls playsInline muted preload="none" aria-label={`Camera video — ${item.name}`} onError={() => setError('Video playback failed. Retry or open the provider below.')} /></div>{error && <p className="satellite-search-error" role="alert">{error}</p>}</>;
}
function CameraView({ item }: { item: MapCamera }) {
  const [playing, setPlaying] = useState(true), [reload, setReload] = useState(0);
  const kind = cameraViewKind(item), video = kind === 'stream' || kind === 'recorded';
  return <article className="satellite-camera-player" aria-label="Selected street camera">
    <div className="street-camera-heading"><div><span className={`view-status ${item.status === 'live' ? 'is-live' : ''}`}>{cameraViewLabel(item)}</span><h3>{item.name}</h3><p>{item.provider || item.source} · {item.country || 'Public camera'}</p></div>
      {video && playing && <div className="row wrap"><button className="button small" aria-label="Reload camera video" onClick={() => setReload(value => value + 1)}><RefreshCw size={14} />Reload</button><button className="button small" aria-label="Stop camera video" onClick={() => setPlaying(false)}><Square size={14} />Stop</button></div>}
    </div>
    {kind === 'snapshot' ? <CameraSnapshot key={item.id} item={{ ...item, thumbnail: item.thumbnail || (item.kind === 'image' ? item.url : undefined), mediaType: 'snapshot' }} /> : video ? playing && (item.kind !== 'youtube' || item.videoId) ? item.kind === 'youtube' ? <div className="street-video"><iframe key={`${item.videoId}:${reload}`} title={`Street camera — ${item.name}`} src={`https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=0&rel=0`} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div> : <DirectCameraVideo key={`${item.id}:${reload}`} item={item} /> : <div className="street-camera-placeholder"><Camera size={28} /><strong>{item.status === 'unavailable' ? 'This camera is off air' : 'Camera video stopped'}</strong>{item.status !== 'unavailable' && <button className="button primary" onClick={() => setPlaying(true)}><Play size={15} />Load camera video</button>}</div> : <div className="street-camera-placeholder"><Camera size={28} /><strong>Watch on the camera’s website</strong><p>This provider offers its own player. Open the source below to watch.</p></div>}
    <div className="street-camera-source"><External href={item.viewingPage || (video ? item.sourceURL || item.url : item.url) || item.sourceURL}>Open camera provider</External>{item.kind === 'youtube' && item.videoId && <External href={`https://www.youtube.com/watch?v=${item.videoId}`}>Watch on YouTube</External>}
      <p>{item.kind === 'youtube' ? `${item.checkedAt ? `Broadcast status checked ${new Date(item.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. ` : ''}${item.error || 'Press play in the player. Streaming delays and interruptions depend on the provider.'}` : kind === 'stream' ? 'The source supplies this video feed; its live status is not independently verified.' : kind === 'recorded' ? 'This is a video file, not a verified live broadcast.' : 'Snapshots refresh periodically and do not provide continuous moving video.'}</p>
      {item.attribution && <small>{item.attribution}</small>}
    </div>
  </article>;
}
export default function SatelliteCameras({ views, place, onChoose, refreshing, onRefresh, error }: { views: CameraViews; place: MapPlace; onChoose: (camera: MapCamera) => void; refreshing: boolean; onRefresh: () => void; error: string }) {
  const [limit, setLimit] = useState(8);
  useEffect(() => setLimit(8), [place.id, place.key, views.radius, views.query, views.filter]);
  return <section id="satellite-cameras" className="satellite-camera-workspace" aria-label="Street cameras on the satellite map">
    <aside className="satellite-camera-browser"><div className="row between"><h2>Street cameras</h2><button className="icon-button" aria-label="Check live camera broadcasts" disabled={refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /></button></div><p>Choose a pin or a camera to watch its view.</p>
      <h3>Featured live streets</h3><div className="featured-live-cameras">{views.featured.map(camera => <button key={camera.id} aria-label={`Watch ${camera.name}`} aria-pressed={views.selected === camera.id} onClick={() => onChoose(camera)}><Play size={14} /><span><strong>{camera.name}</strong><small>{cameraViewLabel(camera)}</small></span></button>)}</div>
      {(error || views.inventory.error) && <p role="alert" className="satellite-search-error">{error || views.inventory.error} <button className="text-button" onClick={() => { onRefresh(); views.inventory.refresh(); }}>Retry camera sources</button></p>}
      <h3>Near {place.name}</h3><div className="satellite-camera-filters"><div className="search-input"><Search size={15} /><input aria-label="Search nearby satellite cameras" placeholder="Filter nearby cameras…" value={views.query} onChange={event => views.setQuery(event.target.value)} /></div><select aria-label="Camera view type" value={views.filter} onChange={event => views.setFilter(event.target.value)}><option value="all">All view types</option><option value="stream">Video streams</option><option value="snapshot">Refreshing snapshots</option><option value="page">Provider pages</option><option value="recorded">Recorded videos</option></select></div>
      {views.inventory.busy ? <p role="status">Loading nearby cameras…</p> : views.nearby.length ? <><label className="satellite-camera-select">Choose nearby camera<select aria-label="Choose nearby satellite camera" value={views.nearby.some(camera => camera.id === views.selected) ? views.selected : ''} onChange={event => { const camera = views.cameras.find(item => item.id === event.target.value); if (camera) onChoose(camera); }}><option value="">{views.nearby.length} matching cameras…</option>{views.nearby.map(camera => <option key={camera.id} value={camera.id}>{camera.name} · {cameraViewLabel(camera)}</option>)}</select></label><div className="satellite-nearby-cameras">{views.nearby.slice(0, limit).map(camera => <button key={camera.id} aria-label={`View camera ${camera.name}`} aria-pressed={views.selected === camera.id} onClick={() => onChoose(camera)}><MapPin size={14} /><span><strong>{camera.name}</strong><small>{cameraViewLabel(camera)} · {(distance(place, camera) / 1000).toFixed(1)} km</small></span></button>)}</div>{limit < views.nearby.length && <button className="text-button" onClick={() => setLimit(value => value + 12)}>Show more cameras</button>}</> : <p className="satellite-camera-empty">No matching cameras within {views.radius} km. Increase the radius, choose another view type, or try a featured live street.</p>}
      <a className="external" href={nearbyCameraRoute(place.lat, place.lon, views.radius)}>Open full Camera Globe directory ↗</a>
    </aside>
    {views.item ? <CameraView key={views.item.id} item={views.item} /> : <div className="street-camera-placeholder"><Camera size={32} /><strong>See the street in motion</strong><p>Try Times Square, Abbey Road, or Bourbon Street for streaming video. Many Canadian traffic cameras provide refreshed snapshots.</p></div>}
  </section>;
}
