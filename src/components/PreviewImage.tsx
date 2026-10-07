import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { safeUrl } from '../lib/api';
export type PreviewState = { status: 'loading' | 'loaded' | 'error' | 'offline' | 'unavailable'; loadedAt?: number; hasImage?: boolean };
export default function PreviewImage({ src, alt, className = '', eager = false, retainPrevious = false, onStateChange }: { src?: string; alt: string; className?: string; eager?: boolean; retainPrevious?: boolean; onStateChange?: (state: PreviewState) => void }) {
  const url = safeUrl(src);
  const [result, setResult] = useState<PreviewState & { url?: string }>({ url, status: url ? 'loading' : 'unavailable' });
  const [previousUrl, setPreviousUrl] = useState<string>();
  const [displaySource, setDisplaySource] = useState<string>();
  const previousBlob = useRef<string | undefined>(undefined);
  const host = useRef<HTMLImageElement | HTMLSpanElement>(null);
  const [visible, setVisible] = useState(eager || typeof IntersectionObserver === 'undefined');
  const status = result.url === url ? result.status : url ? 'loading' : 'unavailable';
  const loadedAt = result.url === url ? result.loadedAt : undefined;
  const hasImage = retainPrevious ? !!previousUrl : status === 'loaded';
  useEffect(() => { onStateChange?.({ status, loadedAt, hasImage }); }, [status, loadedAt, hasImage, onStateChange]);
  useEffect(() => {
    if (!retainPrevious || visible || !host.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '150px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [retainPrevious, visible]);
  useEffect(() => {
    if (!retainPrevious || !url || (!eager && !visible)) return;
    let cancelled = false;
    const controller = new AbortController(); let blobUrl: string | undefined;
    const next = new Image(); next.referrerPolicy = 'no-referrer';
    next.onload = async () => {
      try { await next.decode(); } catch { /* Some providers do not support decode after load. */ }
      if (cancelled) return;
      if (!next.naturalWidth) { setResult({ url, status: 'error' }); return; }
      if (previousBlob.current) URL.revokeObjectURL(previousBlob.current);
      previousBlob.current = blobUrl;
      setPreviousUrl(blobUrl || url); setDisplaySource(url); setResult({ url, status: 'loaded', loadedAt: Date.now() });
    };
    next.onerror = () => { if (!cancelled) setResult({ url, status: 'error' }); };
    async function load() {
      const address = new URL(url!);
      if (address.origin === location.origin && address.pathname === '/api/cameras/ottawa-snapshot') {
        const response = await fetch(url!, { signal: controller.signal });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (!cancelled) setResult({ url, status: data.cameraStatus === 'offline' ? 'offline' : 'error' });
          return;
        }
        const blob = await response.blob(); if (cancelled) return;
        blobUrl = URL.createObjectURL(blob); next.src = blobUrl;
      } else next.src = url!;
    }
    void load().catch(() => { if (!cancelled) setResult({ url, status: 'error' }); });
    return () => { cancelled = true; controller.abort(); next.onload = null; next.onerror = null; next.removeAttribute('src'); if (blobUrl && blobUrl !== previousBlob.current) URL.revokeObjectURL(blobUrl); };
  }, [url, retainPrevious, eager, visible]);
  useEffect(() => () => { if (previousBlob.current) URL.revokeObjectURL(previousBlob.current); }, []);
  useEffect(() => {
    if (!eager || !url || status !== 'loading') return;
    const timer = setTimeout(() => setResult({ url, status: 'error' }), 20000);
    return () => clearTimeout(timer);
  }, [url, status, eager]);
  if (retainPrevious && previousUrl) return <img ref={element => { host.current = element; }} src={previousUrl} data-source-url={displaySource} alt={alt} decoding="async" referrerPolicy="no-referrer" className={className} />;
  return !retainPrevious && url && (status === 'loading' || status === 'loaded')
    ? <img key={url} src={url} data-source-url={url} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" className={className} onLoad={e => setResult({ url, status: e.currentTarget.naturalWidth ? 'loaded' : 'error', loadedAt: Date.now() })} onError={() => setResult({ url, status: 'error' })} />
    : <span ref={host} className={`preview-unavailable ${className}`} role="img" aria-label={status === 'offline' ? 'Camera currently offline' : 'Camera preview unavailable'}><Camera size={22} /><span>{status === 'offline' ? 'Camera offline' : 'Preview unavailable'}</span></span>;
}
