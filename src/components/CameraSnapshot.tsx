import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play, RefreshCw } from 'lucide-react';
import PreviewImage, { type PreviewState } from './PreviewImage';
import { type Row } from '../lib/api';
import { cameraImageUrl } from '../lib/camera-images';

export default function CameraSnapshot({ item, refreshVersion = 0, onTryAnother, onStatusChange }: { item: Row; refreshVersion?: number; onTryAnother?: () => void; onStatusChange?: (id: string, status: PreviewState['status']) => void }) {
  const snapshot = item.mediaType === 'snapshot';
  const ottawa = item.provider === 'Ottawa Traffic Cameras';
  const intervalSeconds = ottawa ? 5 : 60;
  const [version, setVersion] = useState(() => snapshot ? Date.now() : 0);
  const [automatic, setAutomatic] = useState(snapshot);
  const [visible, setVisible] = useState(!document.hidden);
  const [state, setState] = useState<PreviewState>({ status: item.thumbnail ? 'loading' : 'unavailable' });
  const seenRefresh = useRef(refreshVersion);
  const panel = useRef<HTMLDivElement>(null), [expanded, setExpanded] = useState(false), [expandError, setExpandError] = useState('');
  const imageUrl = cameraImageUrl(item, version);
  useEffect(() => {
    const changed = () => setExpanded(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function expand() {
    setExpandError('');
    try { if (document.fullscreenElement === panel.current) await document.exitFullscreen(); else await panel.current?.requestFullscreen(); }
    catch { setExpandError('The browser could not expand this view. Try again or open the camera provider.'); }
  }
  function refresh() { if (!cameraImageUrl(item, 0)) return; setState(old => ({ ...old, status: 'loading' })); setVersion(previous => Math.max(Date.now(), previous + 1)); }
  useEffect(() => {
    if (seenRefresh.current === refreshVersion) return;
    seenRefresh.current = refreshVersion;
    refresh();
  }, [refreshVersion]);
  const loading = state.status === 'loading';
  const offline = state.status === 'offline';
  const failed = state.status === 'error' || offline;
  useEffect(() => { onStatusChange?.(item.id, state.status); }, [item.id, state.status, onStatusChange]);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!imageUrl || !snapshot || !automatic || !visible || loading) return;
    const timer = setTimeout(refresh, intervalSeconds * 1000);
    return () => clearTimeout(timer);
  }, [snapshot, automatic, visible, loading, intervalSeconds, version, imageUrl]);
  return <div className="camera-preview-panel" ref={panel}>
    {imageUrl && <div className="camera-view-toolbar"><span>{item.name}</span><button className="button small" aria-label={expanded ? 'Exit expanded camera view' : 'Expand camera view'} onClick={() => void expand()}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{expanded ? 'Exit full screen' : 'Expand view'}</button></div>}
    <div className={`camera-preview-image ${state.hasImage ? 'has-frame' : ''}`} aria-busy={loading}>
      <PreviewImage src={imageUrl} alt={`${item.name} · provider preview`} eager retainPrevious onStateChange={setState} />
      {loading && <span className={state.hasImage ? 'camera-image-updating' : 'camera-image-loading'}><RefreshCw size={state.hasImage ? 13 : 20} className="spin" /><span>{state.hasImage ? 'Updating…' : 'Loading preview…'}</span></span>}
      {state.status === 'loaded' && <span className="preview-credit">{snapshot ? 'Snapshot' : 'Preview'} from {item.source}</span>}
    </div>
    {expandError && <p className="camera-expand-error" role="alert">{expandError}</p>}
    {(snapshot || failed || state.status === 'unavailable') && <div className="camera-snapshot-controls">
      {offline && <div className="camera-offline-notice"><strong>Camera currently offline</strong>{onTryAnother && <button className="button small" onClick={onTryAnother}>Try a nearby camera</button>}</div>}
      {item.thumbnail && <div className="snapshot-actions"><button className="button small" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? 'Loading snapshot…' : failed ? 'Retry snapshot' : 'Refresh snapshot'}</button>{snapshot && <button className="button small" aria-pressed={automatic} onClick={() => setAutomatic(value => !value)}>{automatic ? <Pause size={14} /> : <Play size={14} />}{automatic ? 'Pause updates' : 'Resume updates'}</button>}</div>}
      {snapshot && <p className="snapshot-update-mode">{automatic ? visible ? `Auto-refresh every ${intervalSeconds} seconds` : 'Updates paused while this tab is hidden' : 'Automatic updates paused'}{ottawa && ' · Ottawa frames may stay the same for 5–15 seconds.'}</p>}
      <p className={`snapshot-status ${failed ? 'snapshot-error' : ''}`} role="status">
        {offline ? `Ottawa reports no live feed for this camera.${state.hasImage ? ' Showing the last available frame.' : ''} Retry or choose another camera.` : failed ? state.hasImage ? 'Refresh failed. Showing the last loaded image; retry or open the camera page.' : 'The provider image could not be loaded here. Open the camera page or retry.' : state.status === 'unavailable' ? 'This source provides a camera page without an inline image.' : loading ? 'Requesting the latest available provider image…' : state.loadedAt ? `Image fetched at ${new Date(state.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. This is the fetch time, not the capture time.` : ''}
      </p>
    </div>}
  </div>;
}
