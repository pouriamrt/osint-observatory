import { useState, useId, type ReactNode, type FormEvent } from 'react';
import Papa from 'papaparse';
import { AlertCircle, ArrowUpRight, BookmarkPlus, Check, Download, FileUp, LoaderCircle, Search, X } from 'lucide-react';
import { api, download, safeUrl, time, useMemoryState, type Row } from '../lib/api';

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'error' | 'warning' }) { return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><AlertCircle size={16} /><span>{children}</span></div>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><Search size={26} /><h3>{title}</h3><p>{children}</p></div>; }
export function Busy({ label = 'Loading data' }: { label?: string }) { return <span className="busy" role="status"><LoaderCircle className="spin" size={16} />{label}…</span>; }
export function PageTitle({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) { return <div className="page-title"><div><h1>{title}</h1><p>{description}</p></div><div className="actions">{actions}</div></div>; }
export function External({ href, children }: { href?: string; children: ReactNode }) { const url = safeUrl(href); return url ? <a href={url} target="_blank" rel="noreferrer" className="external">{children}<ArrowUpRight size={14} /></a> : <span>{children}</span>; }
export function Source({ name, retrievedAt, url }: { name: string; retrievedAt?: string; url?: string }) { return <div className="source"><External href={url}>{name}</External><span>{time(retrievedAt)}</span></div>; }
export function JsonView({ value }: { value: unknown }) { return <pre className="json">{JSON.stringify(value, null, 2)}</pre>; }
export function ExportButton({ filename, value }: { filename: string; value: unknown }) { return <button className="button small" onClick={() => download(filename, value)}><Download size={14} />Export</button>; }
export function SaveButton({ module, title, source, payload, onSave }: { module: string; title: string; source: string; payload: unknown; onSave: () => void }) {
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <><button className="button small" disabled={busy || saved} onClick={async () => { setBusy(true); setError(''); try { await api('/evidence', { module, title, source, payload }); setSaved(true); onSave(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{saved ? <Check size={15} /> : <BookmarkPlus size={15} />}{saved ? 'Saved' : busy ? 'Saving…' : 'Save evidence'}</button>{error && <Notice tone="error">{error}</Notice>}</>;
}
export const templates: Record<string, string[]> = {
  camera: ['name', 'lat', 'lon', 'url', 'source', 'kind', 'country'],
  crypto: ['chain', 'hash', 'from', 'to', 'amount', 'asset', 'timestamp', 'source', 'url'],
  skywave: ['frequency_hz', 'dbm', 'timestamp', 'source'],
  watchtower: ['title', 'lat', 'lon', 'category', 'source', 'url', 'timestamp', 'magnitude'],
  registry: ['name', 'jurisdiction', 'category', 'url', 'access'],
  catalogue: ['title', 'identifier', 'source', 'url', 'jurisdiction', 'timestamp']
};
export function Importer({ module, onImport, label = 'Import data' }: { module: string; onImport: () => void; label?: string }) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<Row[]>([]), [fileName, setFileName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState('');
  async function read(file?: File) {
    if (!file) return; setError(''); setResult(''); setRows([]); setFileName(file.name);
    try {
      if (file.size > 18e6) throw new Error('Use a file smaller than 18 MB. Split larger datasets into multiple files.');
      const text = await file.text(); let parsed: Row[];
      if (file.name.endsWith('.json') || file.name.endsWith('.geojson')) {
        const json = JSON.parse(text); parsed = Array.isArray(json) ? json : json.rows;
        if (json.type === 'FeatureCollection' && module === 'watchtower') parsed = json.features.map((f: Row) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
      } else { const data = Papa.parse<Row>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim() }); if (data.errors.length) throw new Error(data.errors[0].message); parsed = data.data; }
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('The file must contain rows, not just column headers.');
      setRows(parsed.map(row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ''))));
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="import-wrap"><button className="button" onClick={() => setOpen(!open)} aria-expanded={open}><FileUp size={16} />{label}</button>{open && <div className="import-panel"><div className="row between"><h3>Import {module === 'registry' ? 'registry sources' : 'records'}</h3><button className="icon-button" aria-label="Close import" onClick={() => setOpen(false)}><X size={16} /></button></div><p>CSV or JSON array. Each record keeps its source. Dates use ISO 8601, coordinates use decimal degrees.</p><code>{templates[module].join(', ')}</code><button className="text-button" onClick={() => download(`${module}-template.csv`, templates[module].join(',') + '\r\n', true)}><Download size={14} />Download CSV template</button><label className="upload-label"><FileUp size={20} /><span>{fileName || 'Choose a CSV or JSON file'}</span><input aria-label={`Import ${module} file`} type="file" accept=".csv,.json,.geojson" onChange={e => void read(e.target.files?.[0])} /></label>{rows.length > 0 && <p>{rows.length.toLocaleString()} rows ready for validation. Duplicate rows are skipped.</p>}{error && <Notice tone="error">{error}</Notice>}{result && <Notice>{result}</Notice>}<button className="button primary" disabled={!rows.length || busy} onClick={async () => { setBusy(true); setError(''); try { const data = await api(`/import/${module}`, { rows }); setResult(`${data.inserted} added, ${data.duplicates} duplicates skipped.`); setRows([]); onImport(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Importing…' : 'Validate and import'}</button></div>}</div>;
}
export function SearchForm({ label, placeholder, busy, button = 'Search', onSubmit, children, initial = '', cacheKey }: { label: string; placeholder: string; busy?: boolean; button?: string; onSubmit: (value: string) => void; children?: ReactNode; initial?: string; cacheKey?: string }) {
  const localKey = useId(); const [value, setValue] = useMemoryState(cacheKey || `form:${localKey}`, initial);
  function submit(e: FormEvent) { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }
  return <form className="search-form" onSubmit={submit}><label className="search-input"><Search size={17} /><span className="sr-only">{label}</span><input placeholder={placeholder} value={value} onChange={e => setValue(e.target.value)} required /></label>{children}<button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{busy ? 'Searching…' : button}</button></form>;
}
