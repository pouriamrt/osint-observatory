import { writeFileSync, renameSync } from 'node:fs';
import { canadianSources, fetchCanadianCameras } from '../server/camera-feeds.mjs';
const results = await Promise.allSettled(canadianSources.map(async source => ({ ...source, ...await fetchCanadianCameras(source) })));
const failed = results.filter(result => result.status === 'rejected');
if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Canadian camera snapshot was not changed because a source failed.');
const sources = results.map(result => result.value), retrievedAt = new Date().toISOString();
const path = new URL('../server/sources/canadian-cameras.json', import.meta.url), temporary = new URL('../server/sources/canadian-cameras.tmp', import.meta.url);
writeFileSync(temporary, JSON.stringify({ retrievedAt, sources }, null, 2)); renameSync(temporary, path);
console.log(JSON.stringify({ sources: sources.map(source => ({ name: source.name, count: source.cameras.length })), total: sources.reduce((count, source) => count + source.cameras.length, 0) }));
