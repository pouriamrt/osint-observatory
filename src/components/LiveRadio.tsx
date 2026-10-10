import { useEffect, useRef, useState, type FormEvent } from 'react';
import { External } from './common';
import { Headphones, Play, Radio, RefreshCw, Square } from 'lucide-react';
import { OTTAWA_RADIO_FEEDS, parseAudioSource, type AudioSource } from '../lib/radio-audio';
import RadioVoiceAnalysis from './RadioVoiceAnalysis';

function AudioPlayer({ source, onStop, onReconnect }: { source: AudioSource; onStop: () => void; onReconnect: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState('Connecting'), [error, setError] = useState('');
  useEffect(() => {
    const audio = ref.current; if (!audio) return;
    let disposed = false, destroy: (() => void) | undefined;
    audio.volume = .7;
    const failed = (message: string) => { if (!disposed) { setStatus('Unavailable'); setError(message); } };
    const play = () => { void audio.play().catch(cause => {
      if (disposed) return;
      if (cause.name === 'NotAllowedError') { setStatus('Ready'); setError('Press Play in the audio controls to start listening.'); }
      else if (cause.name !== 'AbortError') failed('The audio could not play. Reconnect or open the source below.');
    }); };
    if (source.kind === 'hls' && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js').then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) { failed('This browser cannot play this stream. Open the source below.'); return; }
        const player = new Hls(); destroy = () => player.destroy(); player.attachMedia(audio); player.loadSource(source.url);
        player.on(Hls.Events.MANIFEST_PARSED, play);
        player.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { failed('The audio stream could not load. Reconnect or open the source below.'); player.destroy(); } });
      }).catch(() => failed('The audio player could not load. Try reconnecting.'));
    } else { audio.src = source.url; play(); }
    return () => { disposed = true; destroy?.(); audio.pause(); audio.removeAttribute('src'); audio.load(); };
  }, [source]);
  return <section className="radio-audio-player" aria-label="Direct audio player">
    <div className="row between wrap"><div><span className={`radio-audio-status ${status === 'Playing' ? 'playing' : ''}`} role="status">{status}</span><h3>{source.name}</h3></div><div className="row wrap"><button className="button small" onClick={onReconnect}><RefreshCw size={14} />Reconnect audio</button><button className="button small" onClick={onStop}><Square size={14} />Stop audio</button></div></div>
    <audio ref={ref} controls preload="none" aria-label={`Audio player for ${source.name}`} onPlaying={() => { setStatus('Playing'); setError(''); }} onPause={() => setStatus(previous => previous === 'Unavailable' ? previous : 'Paused')} onWaiting={() => setStatus(previous => previous === 'Unavailable' ? previous : 'Buffering')} onEnded={() => setStatus('Ended')} onError={() => { setStatus('Unavailable'); setError('The audio stream is unavailable or this browser cannot play it. Reconnect or open the source below.'); }} />
    {error && <p className="radio-inline-error" role="alert">{error}</p>}
    <div className="radio-audio-note"><External href={source.url}>Open audio source</External><p>Streams can be quiet between transmissions. Playback alone does not verify that an audio file is live. Switching modules or stopping releases this player.</p></div>
  </section>;
}
export default function LiveRadio({ onSave }: { onSave: () => void }) {
  const [selected, setSelected] = useState(OTTAWA_RADIO_FEEDS[0].id);
  const [url, setUrl] = useState(''), [name, setName] = useState(''), [format, setFormat] = useState('auto'), [error, setError] = useState('');
  const [source, setSource] = useState<AudioSource | null>(null), [version, setVersion] = useState(0);
  const feed = OTTAWA_RADIO_FEEDS.find(item => item.id === selected)!;
  function connect(event: FormEvent) {
    event.preventDefault();
    try { const next = parseAudioSource(url, name, format); setError(''); setSource(next); setVersion(value => value + 1); }
    catch (cause) { setError((cause as Error).message); }
  }
  return <div className="radio-live-workspace">
    <section className="radio-ottawa-workspace" aria-label="Ottawa public radio">
      <div className="radio-ottawa-heading"><Radio size={22} /><div><h2>Listen in Ottawa</h2><p>Ottawa, Ontario, Canada · Public radio feeds</p></div><span className="tag">Provider audio</span></div>
      <div className="radio-ottawa-content"><div className="radio-feed-choices" role="group" aria-label="Ottawa radio feeds">{OTTAWA_RADIO_FEEDS.map(item => <button key={item.id} aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}><Headphones size={17} /><span><strong>{item.name}</strong><small>{item.category}</small></span></button>)}</div>
        <article className="radio-feed-detail"><span className="radio-category">{feed.category}</span><h3>{feed.name}</h3><p>{feed.description}</p><a className="button primary" aria-label={`Listen to ${feed.name} on Broadcastify`} href={feed.url} target="_blank" rel="noopener noreferrer" onClick={() => setSource(null)}><Play size={16} />Listen on Broadcastify ↗</a><p className="radio-provider-note">Opens the provider's live player in a new tab. Sign in with a free Broadcastify account, then press Play there. The provider shows current availability, controls any ads, and determines broadcast delay.</p><External href="https://www.broadcastify.com/listen/ctid/4311">Browse Ottawa's current feeds</External><External href="https://www.broadcastify.com/listen/stid/109">Browse Ontario feeds</External></article>
      </div>
    </section>
    <RadioVoiceAnalysis onSave={onSave} />
    <section className="radio-direct-workspace" aria-label="Connect an audio stream"><div className="row"><Headphones size={20} /><div><h2>Play a direct audio stream here</h2><p>Have a public MP3, AAC, Ogg, or HLS audio URL? Connect it to Skywave.</p></div></div>
      <form className="radio-audio-form" onSubmit={connect}><label className="radio-stream-url">Audio stream URL<input aria-label="Radio audio stream URL" type="text" inputMode="url" value={url} maxLength={2048} placeholder="https://your-radio-source.example/live.mp3" onChange={event => { setUrl(event.target.value); setError(''); }} /></label><label>Stream name <span className="muted">(optional)</span><input aria-label="Radio stream name" value={name} maxLength={100} placeholder="My radio feed" onChange={event => setName(event.target.value)} /></label><label>Audio type<select aria-label="Radio audio type" value={format} onChange={event => setFormat(event.target.value)}><option value="auto">Auto-detect</option><option value="audio">MP3 / AAC / Ogg</option><option value="hls">HLS</option></select></label><button className="button" disabled={!url.trim()}><Play size={15} />Connect & listen</button></form>
      {error && <p className="radio-inline-error" role="alert">{error}</p>}
      <p className="radio-provider-note">Broadcastify feeds use the Listen button above. Its provider player cannot be replaced by this direct-audio form.</p>
      {source ? <AudioPlayer key={version} source={source} onStop={() => setSource(null)} onReconnect={() => setVersion(value => value + 1)} /> : <div className="radio-audio-idle" role="status"><Radio size={18} /><span>No direct stream connected. Select an Ottawa feed above, or paste an audio URL.</span></div>}
    </section>
  </div>;
}
