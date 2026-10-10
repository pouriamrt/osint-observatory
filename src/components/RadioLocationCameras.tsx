import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Camera, MapPin, Search, X } from 'lucide-react';
import { api, nearbyCameraRoute } from '../lib/api';
import { nearbySatelliteRoute, type MapPlace } from '../lib/satellite';
import { External } from './common';

type Places = { results: MapPlace[]; source: string; sourceUrl: string };

export default function RadioLocationCameras({ location }: { location: string }) {
  const id = useId(), request = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(`${location}, Ottawa, Ontario, Canada`.slice(0, 200));
  const [radius, setRadius] = useState(10), [busy, setBusy] = useState(false), [error, setError] = useState(''), [places, setPlaces] = useState<Places | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function search() {
    if (query.trim().length < 2) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setPlaces(null);
    try {
      const result = await api<Places>(`/places?query=${encodeURIComponent(query.trim())}`, undefined, 'GET', controller.signal);
      if (!controller.signal.aborted) setPlaces(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function close() { request.current?.abort(); setBusy(false); setOpen(false); }

  return <div className="radio-location-cameras">
    <button className="button small" aria-expanded={open} aria-controls={id} onClick={() => { if (open) close(); else { setOpen(true); void search(); } }}><Camera size={15} />Cameras nearby</button>
    {open && <section id={id} className="radio-camera-search" aria-label={`Camera search for ${location}`}>
      <div className="row between"><strong><MapPin size={15} />Find the location</strong><button className="icon-button" aria-label="Close camera search" onClick={close}><X size={15} /></button></div>
      <p>Choose the place that matches the radio quote. Ottawa is a search hint; edit the address for another region.</p>
      <form onSubmit={event => { event.preventDefault(); void search(); }}>
        <label>Place or intersection<input aria-label="Radio location search" value={query} minLength={2} maxLength={200} required onChange={event => { request.current?.abort(); setBusy(false); setQuery(event.target.value); setPlaces(null); setError(''); }} /></label>
        <button className="button small" type="submit" disabled={busy || query.trim().length < 2}><Search size={15} />{busy ? 'Finding place…' : 'Find place'}</button>
        <label>Camera radius<select aria-label="Radio nearby camera radius" value={radius} onChange={event => setRadius(Number(event.target.value))}>{[10, 25, 50, 100].map(value => <option key={value} value={value}>{value} km</option>)}</select></label>
      </form>
      {busy && <p role="status">Looking for matching places…</p>}
      {error && <p className="radio-inline-error" role="alert">{error}</p>}
      {places && <div className="radio-camera-matches">
        <p role="status">{places.results.length ? `Choose a match to see cameras within ${radius} km. Opens in a new tab so radio analysis stays here.` : 'No places found. Try a street number, intersection, or city.'}</p>
        {places.results.map(place => <div className="radio-camera-place" key={place.id}><a className="radio-camera-match" href={nearbySatelliteRoute(place.lat, place.lon, radius, place.name)} target="_blank" rel="noopener noreferrer" aria-label={`View satellite and cameras near ${place.name} (opens in a new tab)`}><MapPin size={17} /><span><strong>{place.name}</strong><small>Open Satellite views & nearby cameras · {radius} km</small></span><ArrowUpRight size={17} /></a><a className="radio-camera-directory-link external" href={nearbyCameraRoute(place.lat, place.lon, radius)} target="_blank" rel="noopener noreferrer" aria-label={`Open Camera Globe near ${place.name} (opens in a new tab)`}>Open Camera Globe directory<ArrowUpRight size={13} /></a></div>)}
        <small className="radio-camera-attribution"><External href={places.sourceUrl}>{places.source}</External></small>
      </div>}
    </section>}
  </div>;
}
