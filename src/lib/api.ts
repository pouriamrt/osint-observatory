import { useEffect, useState, useCallback, useId, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
export type Row = Record<string, any>;
export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({ error: 'Server returned an unreadable response.' }));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
export function useData<T>(path: string, initial: T) {
  const [data, setData] = useState<T>(initial), [busy, setBusy] = useState(true), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError('');
    api<T>(path, undefined, 'GET', controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [path, version]);
  return { data, busy, error, refresh, setData };
}
const memory = new Map<string, unknown>(), memoryListeners = new Map<string, Set<() => void>>();
export function useMemoryState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  if (!memory.has(key)) memory.set(key, initial);
  const subscribe = useCallback((listener: () => void) => { if (!memoryListeners.has(key)) memoryListeners.set(key, new Set()); memoryListeners.get(key)!.add(listener); return () => { memoryListeners.get(key)?.delete(listener); }; }, [key]);
  const value = useSyncExternalStore(subscribe, () => memory.get(key) as T);
  const set: Dispatch<SetStateAction<T>> = useCallback(next => { const old = memory.get(key) as T, result = typeof next === 'function' ? (next as (old: T) => T)(old) : next; memory.set(key, result); memoryListeners.get(key)?.forEach(listener => listener()); }, [key]);
  return [value, set];
}
type TaskState = { data: any; busy: boolean; error: string };
const tasks = new Map<string, TaskState>(), listeners = new Map<string, Set<() => void>>(), taskTokens = new Map<string, symbol>();
const readTask = (key: string) => { if (!tasks.has(key)) tasks.set(key, { data: null, busy: false, error: '' }); return tasks.get(key)!; };
const changeTask = (key: string, patch: Partial<TaskState>) => { tasks.set(key, { ...readTask(key), ...patch }); listeners.get(key)?.forEach(listener => listener()); };
export function useTask<T = Row>(cacheKey?: string) {
  const localKey = useId(), key = cacheKey || localKey;
  const subscribe = useCallback((listener: () => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(listener); return () => { listeners.get(key)?.delete(listener); }; }, [key]);
  const state = useSyncExternalStore(subscribe, () => readTask(key));
  const setData = (data: T | null) => { taskTokens.delete(key); changeTask(key, { data, busy: false, error: '' }); };
  async function run(work: () => Promise<T>) {
    const token = Symbol(); taskTokens.set(key, token); changeTask(key, { busy: true, error: '', data: null });
    try { const data = await work(); if (taskTokens.get(key) === token) { changeTask(key, { data, busy: false }); return data; } }
    catch (e) { if (taskTokens.get(key) === token) changeTask(key, { busy: false, error: e instanceof Error ? e.message : 'The request failed.' }); }
  }
  return { data: state.data as T | null, busy: state.busy, error: state.error, setData, run };
}
export const short = (s: string, n = 8) => s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
export const time = (s?: string) => s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not retrieved';
export function download(filename: string, data: unknown, plain = false) {
  const blob = new Blob([plain ? String(data) : JSON.stringify(data, null, 2)], { type: plain ? 'text/csv;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function safeUrl(value?: string) { try { const u = new URL(value || ''); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } }
export function nearbyCameraRoute(lat: number, lon: number, radius = 50) { return `#camera?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&radius=${radius}`; }
