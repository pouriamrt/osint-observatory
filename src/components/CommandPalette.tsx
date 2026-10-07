import { useEffect, useRef, useState } from 'react';
import { Search, ArrowUpRight, NotebookPen, X } from 'lucide-react';
import { useData, type Row } from '../lib/api';
export default function CommandPalette({ sectors, onClose, onNavigate }: { sectors: Array<{ id: string; title: string; detail: string }>; onClose: () => void; onNavigate: (id: string) => void }) {
  const [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const evidence = useData<Row[]>('/evidence', []);
  const q = query.trim().toLowerCase();
  const items = [
    ...sectors.map(s => ({ ...s, key: s.id, saved: false })),
    { id: 'evidence', key: 'evidence', title: 'Evidence notebook', detail: 'Saved findings and research notes', saved: false },
    { id: 'settings', key: 'settings', title: 'Sources & settings', detail: 'Provider connections and local configuration', saved: false },
    ...evidence.data.map(e => ({ id: `evidence?entry=${e.id}`, key: e.id, title: e.title, detail: `${e.module} · ${e.source}`, saved: true }))
  ].filter(item => `${item.title} ${item.detail}`.toLowerCase().includes(q)).slice(0, 20);
  useEffect(() => { const previous = document.activeElement as HTMLElement; input.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => setActive(0), [query]);
  const go = (id: string) => { onNavigate(id); onClose(); };
  return <div className="command-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={panel} className="command-dialog" role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Tab') { const controls = [...panel.current!.querySelectorAll<HTMLElement>('input,button')]; const first = controls[0], last = controls.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }}><div className="command-search"><Search size={20} /><input ref={input} aria-label="Find modules or saved evidence" placeholder="Find a module or saved finding…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(i => items.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0); } if (e.key === 'Enter' && items[active]) { e.preventDefault(); go(items[active].id); } }} /><button className="icon-button" aria-label="Close workspace search" onClick={onClose}><X size={17} /></button></div><div className="command-results">{items.map((item, i) => <button className={i === active ? 'active' : ''} key={item.key} onMouseEnter={() => setActive(i)} onClick={() => go(item.id)}>{item.saved ? <NotebookPen size={18} /> : <ArrowUpRight size={18} />}<span><strong>{item.title}</strong><small>{item.detail}</small></span><span className="tag">{item.saved ? 'Saved finding' : 'Module'}</span></button>)}{!items.length && <p>No modules or saved findings match “{query}”.</p>}</div><div className="command-footer"><span>↑ ↓ to explore · Enter to open</span><span>Esc to close</span></div></div></div>;
}
