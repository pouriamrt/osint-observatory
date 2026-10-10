import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, Download, FileAudio, Mic, Square, Trash2 } from 'lucide-react';
import { External, SaveButton } from './common';
import RadioLocationCameras from './RadioLocationCameras';
import { api, download, useData } from '../lib/api';
import { audioBase64, captureRadioTab, encodeRadioWav, keywordMatches, type RadioSummary, type RadioTranscript, type TranscriptEntry } from '../lib/radio-capture';

type Chunk = { blob: Blob; startedAt: string; source: string };
type Capture = { stream?: MediaStream; cleanup?: () => void; timeout?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval>; queue: Chunk[]; busy: boolean; controller?: AbortController; cancelled: boolean };
type Status = { configured: boolean; provider: string; transcribeModel: string; summaryModel: string; maxClipSeconds: number };

function ClipAudio({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { const audio = ref.current; return () => { audio?.pause(); audio?.removeAttribute('src'); audio?.load(); }; }, [url]);
  return <audio ref={ref} src={url} controls preload="none" aria-label="Replay captured audio clip" />;
}

export default function RadioVoiceAnalysis({ onSave }: { onSave: () => void }) {
  const { data: configuration, error: configError } = useData<Status>('/radio/analysis-status', { configured: false, provider: 'OpenAI', transcribeModel: '', summaryModel: '', maxClipSeconds: 60 });
  const [source, setSource] = useState('EMS & OPP (Ottawa & Region)'), [seconds, setSeconds] = useState(15), [minutes, setMinutes] = useState(5);
  const [status, setStatus] = useState('Ready'), [error, setError] = useState(''), [active, setActive] = useState(false), [elapsed, setElapsed] = useState(0), [level, setLevel] = useState(-120), [pending, setPending] = useState(0), [skipped, setSkipped] = useState(0), [dropped, setDropped] = useState(0);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]), [keywords, setKeywords] = useState(''), [question, setQuestion] = useState('Summarize what was said and list the locations, units, and incidents mentioned.'), [summary, setSummary] = useState<RadioSummary | null>(null), [summaryBusy, setSummaryBusy] = useState(false), [summaryError, setSummaryError] = useState('');
  const session = useRef<Capture | null>(null), mounted = useRef(true), urls = useRef(new Set<string>()), summaryRequest = useRef<AbortController | null>(null), entrySnapshot = useRef<TranscriptEntry[]>([]);
  entrySnapshot.current = entries;

  function stop(update = true) {
    const current = session.current; session.current = null;
    if (current) { current.cancelled = true; current.controller?.abort(); current.queue = []; clearTimeout(current.timeout); clearInterval(current.interval); if (current.cleanup) current.cleanup(); else current.stream?.getTracks().forEach(track => track.stop()); }
    if (update && mounted.current) { setActive(false); setPending(0); setLevel(-120); setStatus('Stopped'); }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(false); summaryRequest.current?.abort(); for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }; }, []);

  async function drain(current: Capture) {
    if (current.busy || current.cancelled) return;
    current.busy = true;
    while (!current.cancelled && current.queue.length) {
      const chunk = current.queue.shift()!; setPending(current.queue.length + 1); current.controller = new AbortController(); setStatus(current.stream ? 'Capturing · transcribing' : 'Transcribing clip');
      try {
        const result = await api<RadioTranscript>('/radio/transcribe', { audio: await audioBase64(chunk.blob), source: chunk.source, startedAt: chunk.startedAt, authorized: true }, 'POST', current.controller.signal);
        if (current.cancelled || !mounted.current) break;
        if (result.skipped) setSkipped(value => value + 1);
        else if (result.text) {
          const audioUrl = URL.createObjectURL(chunk.blob); urls.current.add(audioUrl);
          const entry = { ...result, id: crypto.randomUUID(), audioUrl };
          setEntries(previous => { const next = [...previous, entry]; const removed = next.slice(0, Math.max(0, next.length - 40)); for (const old of removed) { URL.revokeObjectURL(old.audioUrl); urls.current.delete(old.audioUrl); } return next.slice(-40); });
        }
      } catch (cause) {
        if (!current.cancelled && mounted.current) { stop(); setError((cause as Error).message); setStatus('Stopped · request failed'); }
        break;
      }
    }
    current.busy = false;
    if (!current.cancelled && mounted.current) { setPending(0); setStatus(current.stream ? 'Capturing · waiting for audio' : 'Clip complete'); if (!current.stream) { session.current = null; setActive(false); } }
  }

  async function startCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) { setError('Tab audio capture is unavailable in this browser. Use desktop Chrome or Edge, or analyze an audio file.'); return; }
    stop(false); setError(''); setSkipped(0); setDropped(0); setElapsed(0); setActive(true); setStatus('Choose the audio tab');
    const current: Capture = { queue: [], busy: false, cancelled: false }; session.current = current;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: { ideal: 1 } }, audio: true, systemAudio: 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude' } as DisplayMediaStreamOptions);
      if (current.cancelled || !mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      current.stream = stream;
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
      if (!stream.getAudioTracks().length || surface && surface !== 'browser') throw new Error('Select the feed’s browser tab and enable Share tab audio in the browser picker.');
      const label = source.trim() || 'Selected radio tab'; let updatedAt = 0;
      current.cleanup = await captureRadioTab(stream, seconds, (blob, startedAt, rms) => {
        if (current.cancelled) return;
        if (rms < .001) { setSkipped(value => value + 1); if (!current.busy) setStatus('Capturing · quiet audio skipped'); return; }
        if (current.queue.length >= 3) { setDropped(value => value + 1); return; }
        current.queue.push({ blob, startedAt, source: label }); setPending(current.queue.length + (current.busy ? 1 : 0)); void drain(current);
      }, rms => { if (!current.cancelled && Date.now() - updatedAt > 200) { updatedAt = Date.now(); setLevel(Math.max(-120, 20 * Math.log10(rms || 1e-6))); } });
      if (current.cancelled) { current.cleanup(); return; }
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (!current.cancelled) stop(); }, { once: true }));
      const started = Date.now(); current.interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
      current.timeout = setTimeout(() => { stop(); setStatus('Stopped · session time limit reached'); }, minutes * 60000);
      setStatus('Capturing · waiting for audio');
    } catch (cause) { if (!current.cancelled && mounted.current) { stop(); setError((cause as Error).name === 'NotAllowedError' ? 'Tab sharing was cancelled. Start capture again when ready.' : (cause as Error).message); } }
  }

  async function analyzeFile(file?: File) {
    if (!file) return;
    stop(false); setError(''); setActive(true); setStatus('Reading audio clip');
    const current: Capture = { queue: [], busy: false, cancelled: false }; session.current = current;
    let context: AudioContext | undefined;
    try {
      if (file.size > 8e6) throw new Error('Choose an audio file smaller than 8 MB and no longer than 60 seconds.');
      context = new AudioContext(); const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (current.cancelled || !mounted.current) return;
      if (decoded.duration > 60 || decoded.duration < .5) throw new Error('Choose a clip between 0.5 and 60 seconds long.');
      const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) { const samples = decoded.getChannelData(channel); for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / decoded.numberOfChannels; }
      current.queue.push({ blob: encodeRadioWav(mono, decoded.sampleRate), startedAt: new Date().toISOString(), source: `Uploaded clip: ${file.name.slice(0, 150)}` }); void drain(current);
    } catch (cause) { if (!current.cancelled && mounted.current) { stop(); setError((cause as Error).message || 'This audio format could not be decoded. Try WAV or MP3.'); } }
    finally { await context?.close(); }
  }

  function clear() { stop(); summaryRequest.current?.abort(); summaryRequest.current = null; for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); setEntries([]); setSummary(null); setSummaryBusy(false); setSummaryError(''); setError(''); }
  const exportEntries = () => entrySnapshot.current.map(({ audioUrl, ...entry }) => entry);
  async function summarize() {
    const selected: TranscriptEntry[] = []; let length = 0;
    for (const entry of [...entrySnapshot.current].reverse()) { if (length + entry.text.length > 30000) break; selected.unshift(entry); length += entry.text.length; }
    if (!selected.length) return;
    summaryRequest.current?.abort(); const controller = new AbortController(); summaryRequest.current = controller; setSummaryBusy(true); setSummaryError('');
    try {
      const result = await api<RadioSummary>('/radio/summarize', { entries: selected.map(entry => ({ id: entry.id, text: entry.text, startedAt: entry.startedAt, duration: entry.metrics.duration })), question, authorized: true }, 'POST', controller.signal);
      if (!controller.signal.aborted && mounted.current) setSummary(result);
    } catch (cause) { if (!controller.signal.aborted && mounted.current) setSummaryError((cause as Error).message); }
    finally { if (!controller.signal.aborted && mounted.current) setSummaryBusy(false); }
  }

  return <section className="radio-voice-workspace" aria-label="Radio voice and AI analysis">
    <div className="radio-voice-heading"><BrainCircuit size={23} /><div><h2>Live transcript & AI analysis</h2><p>Capture audio from a tab you choose, then review what was said.</p></div><span className="tag">{configuration.configured ? 'OpenAI configured' : 'Checking AI access'}</span></div>
    <div className="radio-voice-body">
      <div className="radio-capture-guide"><strong>For EMS & OPP: play the feed, then capture its tab.</strong><p>Click Start tab capture, select the Broadcastify tab, enable <strong>Share tab audio</strong>, and press Share. Audio clips are sent to OpenAI using your configured API key; API usage charges apply. Use audio authorized for capture and AI processing.</p><External href="https://www.broadcastify.com/listen/feed/37900">Open EMS & OPP player</External></div>
      <div className="radio-capture-fields"><label>Source label <span>(set by you)</span><input aria-label="Captured audio source label" value={source} maxLength={200} disabled={active} onChange={event => setSource(event.target.value)} /></label><label>Transcript updates<select aria-label="Radio transcript update interval" value={seconds} disabled={active} onChange={event => setSeconds(Number(event.target.value))}><option value={10}>Every 10 seconds</option><option value={15}>Every 15 seconds</option><option value={30}>Every 30 seconds</option></select></label><label>Stop after<select aria-label="Radio capture time limit" value={minutes} disabled={active} onChange={event => setMinutes(Number(event.target.value))}><option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option></select></label></div>
      <div className="radio-capture-actions"><button className="button primary" disabled={active || !configuration.configured} onClick={() => void startCapture()}><Mic size={16} />Start tab capture</button><button className="button" disabled={!active} onClick={() => stop()}><Square size={15} />Stop capture</button><label className={`button radio-file-button ${active || !configuration.configured ? 'disabled' : ''}`}><FileAudio size={16} />Analyze audio file<input aria-label="Audio file for radio analysis" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" disabled={active || !configuration.configured} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void analyzeFile(file); }} /></label></div>
      <div className="radio-capture-status"><span role="status">{status}</span><span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} captured</span><span>{pending} queued / processing</span><span>{skipped} quiet clips skipped</span>{dropped > 0 && <span>{dropped} clips dropped while AI was busy</span>}<div className="radio-level" aria-label={`Audio level ${Math.round(level)} dBFS`}><span style={{ width: `${Math.max(0, Math.min(100, (level + 60) / 60 * 100))}%` }} /></div></div>
      {(error || configError) && <p className="radio-inline-error" role="alert">{error || configError}</p>}
      {!configuration.configured && !configError && <p className="radio-provider-note">An OpenAI API key must be configured on the local server before analysis starts.</p>}
      <p className="radio-provider-note">Desktop Chrome or Edge supports tab audio sharing. Only audio is processed; video is discarded. Quiet clips are skipped by audio level, not a speech detector. Stop discards unfinished clips and queued requests. Capture also stops when you leave this view.</p>
      <div className="radio-transcript-heading"><h3>Transcript <span>{entries.length} clips</span></h3><div className="row wrap"><button className="button small" disabled={!entries.length} onClick={() => download('skywave-transcript.json', { source, entries: exportEntries(), summary, status: 'Unverified AI transcript', exportedAt: new Date().toISOString() })}><Download size={14} />Export transcript</button><button className="button small" disabled={!entries.length && !active} onClick={clear}><Trash2 size={14} />Clear session</button></div></div>
      <label className="radio-keywords">Highlight keywords <span>(comma-separated)</span><input aria-label="Radio transcript keywords" value={keywords} maxLength={300} placeholder="collision, ambulance, highway" onChange={event => setKeywords(event.target.value)} /></label>
      <div className="radio-transcript-list">{entries.length ? entries.map((entry, index) => <article id={`transcript-${entry.id}`} key={entry.id} className="radio-transcript-entry"><div className="row between wrap"><strong>Clip {index + 1} · {new Date(entry.startedAt).toLocaleTimeString()}</strong><span>{entry.metrics.duration.toFixed(1)}s · {entry.metrics.rmsDbfs.toFixed(1)} dBFS{entry.metrics.clippedPercent > 1 ? ' · possible clipping' : ''}</span></div><p className="radio-transcript-source">{entry.source}</p><p>{entry.text}</p>{keywordMatches(entry.text, keywords).length > 0 && <div className="row wrap">{keywordMatches(entry.text, keywords).map(word => <span className="tag radio-keyword-match" key={word}>Matched: {word}</span>)}</div>}{entry.segments.length > 0 && <details><summary>Speaker turns & clip timestamps</summary>{entry.segments.map((segment, i) => <p className="radio-speaker-turn" key={i}><span>{segment.start.toFixed(1)}–{segment.end.toFixed(1)}s · Speaker {segment.speaker}</span>{segment.text}</p>)}<small>Speaker labels apply to this clip only; they do not identify a person across clips.</small></details>}<ClipAudio url={entry.audioUrl} /><SaveButton module="skywave" title={`Radio transcript · ${entry.source} · ${entry.startedAt}`} source={`${entry.source} · OpenAI ${entry.model}`} payload={{ ...(({ audioUrl, ...value }) => value)(entry), review: 'Unverified AI transcript; compare with source audio' }} onSave={onSave} /></article>) : <div className="radio-transcript-empty"><FileAudio size={25} /><strong>No audio analyzed yet</strong><p>Start tab capture or choose a short audio file. Text appears after a clip has finished processing.</p></div>}</div>
      <div className="radio-summary-panel"><div className="row"><BrainCircuit size={20} /><h3>Ask AI about the transcript</h3></div><p>AI uses the latest available transcript clips. Check its interpretation against the captured audio.</p><label>Question<input aria-label="Question about radio transcript" value={question} maxLength={500} placeholder="Which locations and units were mentioned?" onChange={event => setQuestion(event.target.value)} /></label><button className="button" disabled={!entries.length || summaryBusy || !question.trim()} onClick={() => void summarize()}><BrainCircuit size={15} />{summaryBusy ? 'Analyzing transcript…' : 'Analyze transcript'}</button>{summaryError && <p className="radio-inline-error" role="alert">{summaryError}</p>}{summary && <div className="radio-summary-result"><span className="radio-category">AI interpretation · {summary.entryIds.length} clips · {new Date(summary.generatedAt).toLocaleTimeString()}</span><p>{summary.summary}</p>{summary.mentions.map((mention, index) => <div className="radio-summary-mention" key={`${summary.generatedAt}:${index}:${mention.entryId}:${mention.text}`}><strong>{mention.kind}: {mention.text}</strong><blockquote>{mention.quote}</blockquote><button className="text-button" onClick={() => document.getElementById(`transcript-${mention.entryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Show supporting clip</button>{mention.kind === 'location' && <RadioLocationCameras location={mention.text} />}</div>)}{summary.uncertainties.length > 0 && <div className="radio-summary-uncertainty"><strong>Unclear or missing context</strong>{summary.uncertainties.map((item, i) => <p key={i}>{item}</p>)}</div>}<SaveButton module="skywave" key={summary.generatedAt} title={`AI radio analysis · ${summary.generatedAt}`} source={`OpenAI ${summary.model} · machine transcripts`} payload={{ ...summary, entries: exportEntries().filter(entry => summary.entryIds.includes(entry.id)) }} onSave={onSave} /></div>}</div>
      <p className="radio-provider-note">Radio static, overlapping calls, names and numbers can be misheard. dBFS measures recorded audio, not radio signal strength. This view retains up to 40 clips in memory; export or save results before leaving. Raw audio is not saved to the workspace database.</p>
    </div>
  </section>;
}
