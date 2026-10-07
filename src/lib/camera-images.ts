import { safeUrl, type Row } from './api';

// Use the same cache-busting parameter for snapshots and their list thumbnails.
export function cameraImageUrl(item: Row, version: number) {
  const value = safeUrl(item.thumbnail);
  if (!value) return value;
  if (item.provider === 'Ottawa Traffic Cameras') {
    const number = item.cameraNumber ?? new URL(value).searchParams.get('id');
    const url = new URL('/api/cameras/ottawa-snapshot', location.origin);
    url.searchParams.set('id', String(number));
    url.searchParams.set('timems', String(version));
    return url.href;
  }
  if (!version) return value;
  const url = new URL(value);
  url.searchParams.set(item.provider === 'Ottawa Traffic Cameras' ? 'timems' : 'northstar_refresh', String(version));
  return url.href;
}
