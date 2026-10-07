import { createHash } from 'node:crypto';
import { fail } from './core.mjs';

// Verified public Ottawa outage cards, fetched 2026-10-07. HTTP 200 alone
// cannot distinguish these cards from an available camera image.
const outageCards = new Set([
  'e608c39b77e5480ce13682b571638e4246ff519dd6c79402c393db5e273aab19',
  '2b39b51302536783b9de79196f98b1542844e26255e43480f66f03b5a4f0f170'
]);
export function ottawaImageStatus(bytes) {
  return outageCards.has(createHash('sha256').update(bytes).digest('hex')) ? 'offline' : 'available';
}
export async function ottawaSnapshot(number, version = Date.now()) {
  if (!/^\d{1,7}$/.test(String(number))) fail('Invalid Ottawa camera number.');
  const url = new URL('https://traffic.ottawa.ca/camera');
  url.searchParams.set('id', String(number)); url.searchParams.set('timems', String(Number(version) || Date.now()));
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) fail(`Ottawa image service returned HTTP ${response.status}.`, 502);
  const type = response.headers.get('content-type') || '';
  if (!/^image\/jpe?g\b/i.test(type)) fail('Ottawa did not return a camera image.', 502);
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.length; if (size > 2e6) fail('Ottawa image exceeds the size limit.', 502);
    parts.push(part);
  }
  const bytes = Buffer.concat(parts);
  return { bytes, type, status: ottawaImageStatus(bytes) };
}
