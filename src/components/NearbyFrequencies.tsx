import { Radio, Search } from 'lucide-react';
import { Empty, External } from './common';
import { useMemoryState } from '../lib/api';
import { filterRadioFrequencies, OTTAWA_FREQUENCIES } from '../lib/radio-frequencies';

export default function NearbyFrequencies() {
  const [query, setQuery] = useMemoryState('skywave:frequency-query', '');
  const [category, setCategory] = useMemoryState('skywave:frequency-category', 'all');
  const [availability, setAvailability] = useMemoryState('skywave:frequency-availability', 'online');
  const rows = filterRadioFrequencies(OTTAWA_FREQUENCIES, query, category, availability);
  const reset = () => { setQuery(''); setCategory('all'); setAvailability('online'); };
  return <section className="radio-frequency-workspace" aria-label="Ottawa nearby frequencies">
    <div className="radio-frequency-heading"><Radio size={22} /><div><h2>Frequencies around Ottawa</h2><p>Ottawa, Ontario and the National Capital Region</p></div><span className="tag">Online listening</span></div>
    <div className="radio-frequency-intro"><p>Start with an online feed: no radio receiver needed. To receive other frequencies near you, you need a scanner or SDR and antenna.</p><p>These are published local frequencies, not detected signals. A feed may include several channels. Its provider controls availability and delay.</p></div>
    <div className="radio-frequency-filters">
      <label className="search-input"><Search size={17} /><span className="sr-only">Search Ottawa frequencies</span><input aria-label="Search Ottawa frequencies" type="search" placeholder="Search a frequency, airport or callsign" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Service<select aria-label="Frequency service" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All services</option><option value="Aviation">Aviation</option><option value="Amateur radio">Amateur radio</option><option value="FM radio">FM radio</option></select></label>
      <label>Audio access<select aria-label="Frequency audio access" value={availability} onChange={event => setAvailability(event.target.value)}><option value="online">Has online audio</option><option value="all">All listed frequencies</option></select></label>
      <button className="text-button" onClick={reset}>Reset filters</button>
    </div>
    <div className="radio-frequency-results" aria-live="polite">{rows.length} {rows.length === 1 ? 'frequency' : 'frequencies'} shown · Sources checked October 9, 2026</div>
    <div className="radio-frequency-list">{rows.map(row => <article className="radio-frequency-row" key={row.id} aria-label={`${row.name}, ${row.mhz.toFixed(3)} MHz`}>
      <div className="radio-frequency-value"><strong>{row.mhz.toFixed(3)}</strong><span>MHz · {row.mode}</span></div>
      <div className="radio-frequency-description"><span className="radio-category">{row.category} · {row.area}</span><h3>{row.name}</h3><p>{row.note}</p><div className="radio-frequency-source"><External href={row.source.url}>Source: {row.source.name}</External></div></div>
      <div className="radio-frequency-access">{row.listening ? <><span className="radio-audio-status playing">Online audio link</span><a className="button small" href={row.listening.url} target="_blank" rel="noopener noreferrer" aria-label={`Listen to ${row.name} on ${row.listening.provider}`}><Radio size={14} />Listen on {row.listening.provider} ↗</a><p>{row.listening.coverage}</p>{row.listening.provider === 'Broadcastify' && <small>Free account sign-in, then Play.</small>}</> : <><span className="radio-audio-status">Receiver needed</span><p>No verified browser audio link. The Source link lists receiver details.</p></>}</div>
    </article>)}</div>
    {!rows.length && <><Empty title="No matching frequencies">Try another frequency or service, or show all listed frequencies.</Empty><button className="button radio-frequency-reset" onClick={reset}>Reset frequency filters</button></>}
    <div className="radio-frequency-footer"><p>For OPP and EMS, use <strong>Live audio</strong>. That shared regional feed is not an individually tunable frequency or a verified Ottawa Police Service dispatch feed.</p><p>This directory covers the Ottawa area. It does not use your GPS location or show a live signal scan.</p></div>
  </section>;
}
