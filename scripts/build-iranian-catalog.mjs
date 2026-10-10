// Refresh only publisher metadata and public page links; no video is downloaded.
import { writeFileSync } from 'node:fs';
import { iranianSources, fetchIranianCameras } from '../server/iranian-cameras.mjs';

const sources = await Promise.all(iranianSources.map(async source => ({ ...source, ...await fetchIranianCameras(source.id) })));
writeFileSync(new URL('../server/sources/iranian-cameras.json', import.meta.url), JSON.stringify({ retrievedAt: new Date().toISOString(), sources }, null, 2) + '\n');
console.log(JSON.stringify({ sources: sources.map(source => ({ name: source.name, count: source.cameras.length, status: source.status })), total: sources.reduce((count, source) => count + source.cameras.length, 0) }));
