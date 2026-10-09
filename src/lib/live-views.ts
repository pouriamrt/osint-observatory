import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Row } from './api';

export type LiveView = {
  id: string; name: string; provider: string; sourceURL: string; videoId?: string;
  status: 'live' | 'recorded' | 'unavailable' | 'unknown'; checkedAt?: string; stale?: boolean; error?: string; note?: string;
  lat?: number; lon?: number; country?: string;
};
export type LiveCatalogue = { cameras: LiveView[]; orbit: LiveView[]; clips: LiveView[]; stale: boolean };
export type MapCamera = Row & { id: string; name: string; lat: number; lon: number; kind: string };
export function cameraViewKind(camera: MapCamera) {
  if (camera.kind === 'youtube' || camera.kind === 'hls') return 'stream';
  if (camera.mediaType === 'snapshot' || camera.kind === 'image') return 'snapshot';
  if (camera.kind === 'video') return 'recorded';
  return 'page';
}
export function cameraViewLabel(camera: MapCamera) {
  if (camera.kind === 'youtube') return camera.status === 'live' ? 'Live at last check' : camera.status === 'unavailable' ? 'Off air' : 'Status unverified';
  return { stream: 'Video stream · unverified', snapshot: 'Refreshing snapshot', recorded: 'Recorded video', page: 'Provider page' }[cameraViewKind(camera)];
}
export function useLiveViews() {
  const [data, setData] = useState<LiveCatalogue>({ cameras: [], orbit: [], clips: [], stale: false });
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async (force = false) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const next = await api<LiveCatalogue>(`/live-views${force ? '?refresh=1' : ''}`, undefined, 'GET', controller.signal);
      if (!controller.signal.aborted) setData(next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError((cause as Error).message);
        setData(old => ({ ...old, stale: true, cameras: old.cameras.map(view => ({ ...view, status: 'unknown', stale: true })), orbit: old.orbit.map(view => ({ ...view, status: 'unknown', stale: true })) }));
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 300000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [refresh]);
  return { data, busy, error, refresh };
}
