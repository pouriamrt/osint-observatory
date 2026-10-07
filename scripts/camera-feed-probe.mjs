import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canadianSources, fetchCanadianCameras } from '../server/camera-feeds.mjs';

const catalog = JSON.parse(readFileSync(new URL('../server/sources/canadian-cameras.json', import.meta.url)));
await Promise.all(canadianSources.map(async source => {
  try {
    const latest = await fetchCanadianCameras(source);
    const saved = catalog.sources.find(s => s.id === source.id);
    const c = latest.cameras.find(c => c.cameraNumber === 16) || latest.cameras.find(c => c.thumbnail);
    console.log(JSON.stringify({ source: source.id, published: latest.cameras.length, bundled: saved.cameras.length, sample: c?.id, image: c?.thumbnail }));
    if (!c?.thumbnail) return;
    const url = new URL(c.thumbnail); url.searchParams.set(source.id === 'ottawa' ? 'timems' : 'northstar_refresh', String(Date.now()));
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    console.log(JSON.stringify({ source: source.id, status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), modified: response.headers.get('last-modified'), bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex').slice(0,16) }));
  } catch (e) { console.log(JSON.stringify({ source: source.id, error: e.message })); }
}));
