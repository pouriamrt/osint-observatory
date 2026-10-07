import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ottawaImageStatus } from '../server/camera-images.mjs';
import { canadianSources, fetchCanadianCameras } from '../server/camera-feeds.mjs';

const { cameras } = await fetchCanadianCameras(canadianSources.find(source => source.id === 'ottawa'));
const results = []; let cursor = 0;
mkdirSync('artifacts', { recursive: true });
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < cameras.length) {
    const camera = cameras[cursor++];
    try {
      const url = new URL(camera.thumbnail); url.searchParams.set('timems', String(Date.now()));
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      const bytes = Buffer.from(await response.arrayBuffer()), hash = createHash('sha256').update(bytes).digest('hex');
      results.push({ id: camera.id, number: camera.cameraNumber, name: camera.name, httpStatus: response.status, contentType: response.headers.get('content-type'), bytes: bytes.length, hash, knownOutage: ottawaImageStatus(bytes) === 'offline' });
      if (bytes.length < 22000) writeFileSync(`artifacts/ottawa-small-${hash}.jpg`, bytes);
    } catch (error) { results.push({ id: camera.id, number: camera.cameraNumber, name: camera.name, error: error.message }); }
    if (results.length % 100 === 0) console.log(`Checked ${results.length}/${cameras.length} Ottawa images`);
  }
}));
const hashes = Object.entries(Object.groupBy(results.filter(row => row.hash), row => row.hash)).map(([hash, rows]) => ({ hash, count: rows.length, sample: rows[0].name, bytes: rows[0].bytes })).sort((a, b) => b.count - a.count);
const report = { checkedAt: new Date().toISOString(), count: results.length, knownOutages: results.filter(row => row.knownOutage).length, requestErrors: results.filter(row => row.error || row.httpStatus !== 200).length, repeatedImages: hashes.filter(row => row.count > 1), cameras: results };
writeFileSync('artifacts/ottawa-availability.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, cameras: undefined }));
