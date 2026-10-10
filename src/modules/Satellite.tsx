import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Play, RefreshCw, Square, Search, MapPin, X } from 'lucide-react';
import Globe from '../components/Globe';
import { External, PageTitle } from '../components/common';
import { api } from '../lib/api';
import { NASA_ISS_PLAYLIST, SATELLITE_PLACES, satelliteLocationFromRoute, type MapPlace } from '../lib/satellite';
import { distance } from '../lib/geometry';
import SatelliteCameras, { CameraMapControls, useMapCameras } from '../components/SatelliteCameras';
import { useLiveViews, type MapCamera } from '../lib/live-views';

export default function Satellite() {
  const [initialLocation] = useState(() => satelliteLocationFromRoute(window.location.hash));
  const arrival = useRef({ pending: initialLocation?.showCameras || false, pinned: !!initialLocation });
  const [streamId, setStreamId] = useState('earth'), [playing, setPlaying] = useState(false), [reload, setReload] = useState(0);
  const [place, setPlace] = useState<MapPlace>(initialLocation?.place || SATELLITE_PLACES[0]), [query, setQuery] = useState(''), [results, setResults] = useState<MapPlace[]>([]), [busy, setBusy] = useState(false), [searchError, setSearchError] = useState(''), [searched, setSearched] = useState(false);
  const searchRequest = useRef<AbortController | null>(null), focusVersion = useRef(0);
  const liveViews = useLiveViews(), cameras = useMapCameras(place, liveViews.data.cameras, initialLocation?.radius);
  const [clipPlaying, setClipPlaying] = useState(false);
  useEffect(() => () => searchRequest.current?.abort(), []);
  useEffect(() => {
    const read = () => {
      const next = satelliteLocationFromRoute(window.location.hash); if (!next) return;
      choosePlace(next.place); arrival.current = { pending: next.showCameras, pinned: true };
      cameras.setRadius(next.radius); cameras.setEnabled(true); cameras.setFilter('all'); cameras.setQuery('');
    };
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => {
    if (!arrival.current.pending || cameras.inventory.busy) return;
    arrival.current.pending = false;
    const closest = cameras.nearby.find(camera => camera.availability !== 'offline' && camera.status !== 'unavailable') || cameras.nearby[0];
    cameras.select(closest?.id || '');
    const frame = requestAnimationFrame(() => document.getElementById('satellite-cameras')?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [place.key, cameras.inventory.busy, cameras.nearby, cameras.select]);
  function choosePlace(next: MapPlace) {
    arrival.current = { pending: false, pinned: false };
    searchRequest.current?.abort(); setBusy(false); setResults([]); setSearched(false); setSearchError('');
    cameras.select('');
    setPlace({ ...next, key: String(++focusVersion.current) });
  }
  function chooseCamera(camera: MapCamera) {
    if (arrival.current.pinned && distance(place, camera) <= cameras.radius * 1000) { cameras.select(camera.id); return; }
    choosePlace({ id: camera.id, name: camera.name, lat: camera.lat, lon: camera.lon, span: { lat: .012, lon: .016 } });
    cameras.select(camera.id);
  }
  async function findPlace(event: FormEvent) {
    event.preventDefault(); const value = query.trim(); if (value.length < 2) return;
    searchRequest.current?.abort(); setResults([]); setSearchError(''); setSearched(false);
    const coordinateMatch = value.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]), lon = Number(coordinateMatch[2]);
      if (Math.abs(lat) > 85.051129 || Math.abs(lon) > 180) { setSearchError('Use latitude between −85 and 85, and longitude between −180 and 180.'); return; }
      choosePlace({ id: 'coordinates', name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon, span: { lat: .005, lon: .005 } }); return;
    }
    const controller = new AbortController(); searchRequest.current = controller; setBusy(true);
    try { const data = await api<{ results: MapPlace[] }>(`/places?query=${encodeURIComponent(value)}`, undefined, 'GET', controller.signal); if (!controller.signal.aborted) { setResults(data.results); setSearched(true); } }
    catch (error) { if (!controller.signal.aborted) setSearchError((error as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const stream = liveViews.data.orbit.find(item => item.id === streamId);
  const clip = liveViews.data.clips[0];
  return <>
    <PageTitle title="Satellite views" description="Explore from above, watch live street cameras, and follow views from orbit." actions={<><button className="button" onClick={() => document.getElementById('satellite-cameras')?.scrollIntoView({ behavior: 'smooth' })}><Camera size={15} />Street cameras</button><button className="button" onClick={() => document.getElementById('iss-live-video')?.scrollIntoView({ behavior: 'smooth' })}><Play size={15} />Watch ISS</button></>} />
    <section className="satellite-workspace" aria-label="Earth satellite imagery">
      <div className="satellite-place-search">
        <form className="satellite-search-form" onSubmit={findPlace}><div className="search-input"><Search size={18} /><input aria-label="Find a place or address" placeholder="Search a city, street, address, or latitude, longitude…" value={query} maxLength={200} onChange={e => { searchRequest.current?.abort(); setBusy(false); setQuery(e.target.value); setResults([]); setSearched(false); setSearchError(''); }} />{query && <button type="button" className="icon-button" aria-label="Clear place search" onClick={() => { searchRequest.current?.abort(); setBusy(false); setQuery(''); setResults([]); setSearched(false); setSearchError(''); }}><X size={15} /></button>}</div><button className="button primary" aria-label="Find place" disabled={busy || query.trim().length < 2}><Search size={15} />{busy ? 'Searching…' : 'Find place'}</button></form>
        <div className="satellite-place-strip"><span className="satellite-selected-place"><MapPin size={14} /><strong>{place.name}</strong></span><div className="satellite-quick-places"><span>Quick places</span>{SATELLITE_PLACES.map(item => <button key={item.id} onClick={() => choosePlace(item)}>{item.name}</button>)}</div></div>
        {results.length > 0 && <div className="satellite-search-results" role="region" aria-label="Place search results"><strong>Choose a location</strong>{results.map(result => <button key={result.id} onClick={() => choosePlace(result)}><MapPin size={15} /><span>{result.name}</span></button>)}<small>Place search by Esri World Geocoding</small></div>}
        {searchError && <p className="satellite-search-error" role="alert">{searchError}</p>}
        {searched && !results.length && <p className="satellite-search-empty" role="status">No places found. Try adding a city or country, or use coordinates.</p>}
      </div>
      <CameraMapControls views={cameras} />
      <Globe points={cameras.points} selected={cameras.enabled ? cameras.selected : undefined} onSelect={id => { const camera = cameras.cameras.find(item => item.id === id); if (camera) chooseCamera(camera); }} focus={place} initialView="satellite" />
      <div className="map-bottom"><span>Zoom to explore · Select a camera pin to watch</span><span>Photographs on the map · Video in the camera player</span></div>
      <SatelliteCameras views={cameras} place={place} onChoose={chooseCamera} refreshing={liveViews.busy} onRefresh={() => void liveViews.refresh(true)} error={liveViews.error} />
    </section>
    <section id="iss-live-video" className="iss-workspace" aria-label="International Space Station video">
      <div className="iss-heading"><div><h2>ISS live video</h2><p>Official NASA broadcasts from orbit</p></div><label><span className="sr-only">ISS camera</span><select aria-label="ISS camera" value={streamId} onChange={e => { setStreamId(e.target.value); setReload(0); }}>{liveViews.data.orbit.length ? liveViews.data.orbit.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="earth">{liveViews.busy ? 'Checking NASA streams…' : 'NASA streams unavailable'}</option>}</select></label>
        <button className="icon-button" aria-label="Check NASA broadcasts" disabled={liveViews.busy} onClick={() => void liveViews.refresh(true)}><RefreshCw size={15} className={liveViews.busy ? 'spin' : ''} /></button>
        {playing && <><button className="button small" onClick={() => setReload(value => value + 1)}><RefreshCw size={14} />Reload video</button><button className="button small" onClick={() => setPlaying(false)}><Square size={14} />Stop video</button></>}
      </div>
      <div className="iss-content">
        <div className="iss-video">
          {playing && stream?.videoId ? <iframe key={`${stream.videoId}:${reload}`} title={`NASA ISS live video — ${stream.name}`} src={`https://www.youtube-nocookie.com/embed/${stream.videoId}?autoplay=0&rel=0`} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : <div className="iss-video-placeholder"><Play size={30} /><strong>Earth from orbit</strong><p>{stream?.status === 'unavailable' ? 'This NASA broadcast is currently off air. Check again or open NASA’s current station streams.' : 'Watch NASA’s camera aboard the space station.'}</p><button className="button primary" disabled={!stream?.videoId} onClick={() => setPlaying(true)}><Play size={16} />Load ISS live video</button><small>Video plays through YouTube. Press play in the player to begin.</small></div>}
        </div>
        <aside className="iss-source-note"><span className={`view-status ${stream?.status === 'live' ? 'is-live' : ''}`}>{stream?.status === 'live' ? 'Live broadcast at last check' : stream?.status === 'unavailable' ? 'Currently off air' : 'Live status unverified'}</span><h3>{stream?.name || 'NASA · International Space Station'}</h3><p>{stream?.note}</p>{stream?.checkedAt && <small>Broadcast checked {new Date(stream.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>}{(stream?.error || liveViews.error) && <p role="status">{stream?.error || liveViews.error}</p>}<p>The player reports live or recorded footage. Dark views can occur on the night side of Earth. This camera follows the station’s orbit; it cannot be aimed at a chosen map location.</p>{stream?.videoId && <External href={`https://www.youtube.com/watch?v=${stream.videoId}`}>Open this stream on YouTube</External>}<External href={NASA_ISS_PLAYLIST}>NASA’s current station streams</External><p className="preview-note">If playback is blocked or a stream has moved, use NASA’s current station streams.</p></aside>
      </div>
    </section>
    <section className="iss-workspace satellite-clips-workspace" aria-label="Recorded satellite video">
      <div className="iss-heading"><div><h2>Satellite video clips</h2><p>Motion captured from space · recorded footage</p></div><span className="view-status">Recorded · not live</span></div>
      <div className="iss-content"><div className="iss-video">{clipPlaying && clip ? <iframe title={`Recorded satellite video — ${clip.name}`} src={`https://www.youtube-nocookie.com/embed/${clip.videoId}?autoplay=0&rel=0`} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : <div className="iss-video-placeholder"><Play size={30} /><strong>Watch motion from a satellite</strong><p>Planet’s SkySat video of Dubai airport.</p><button className="button primary" disabled={!clip} onClick={() => setClipPlaying(true)}><Play size={16} />Load recorded satellite clip</button></div>}</div><aside className="iss-source-note"><h3>{clip?.name || 'Dubai airport · SkySat'}</h3><p>{clip?.note || 'Recorded satellite video published by Planet in 2017. Capture date is not specified in the public source.'}</p><p>Continuous live satellite video of a chosen street is not available from these public sources. Commercial satellite video requires provider access and captures short clips during a satellite pass.</p><External href={clip?.sourceURL || 'https://www.planet.com/pulse/hi-res-skysat-imagery-available-via-planet-api/'}>Planet’s satellite video source</External><External href="https://docs.planet.com/data/imagery/skysat/">SkySat video capabilities & access</External>{clipPlaying && <button className="button small" onClick={() => setClipPlaying(false)}><Square size={14} />Stop satellite clip</button>}</aside></div>
    </section>
  </>;
}
