import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { openStore, now, fail, httpUrl, chains, registries, modules, importSchemas } from './core.mjs';
import { hazardFeeds, usernames, breachLookup, cryptoTrace, catalogueSearch, fetchJSON } from './providers.mjs';
import { passiveDNS, certificateNames, scanNetwork } from './network.mjs';
import { cameraDirectory, resolveCameraPage } from './cameras.mjs';
import { ottawaSnapshot } from './camera-images.mjs';
import { createSatelliteProvider } from './satellite.mjs';
import { findPlaces } from './places.mjs';
import { createLiveViewsProvider } from './live-views.mjs';
import { createRadioAnalysis } from './radio-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function createApp({ store = openStore(process.env.DB_PATH || resolve(root, 'data/workbench.sqlite')), scopes = String(process.env.SCAN_ALLOWLIST || '127.0.0.1,::1,localhost').split(',').map(s => s.trim().toLowerCase()).filter(Boolean), radioAnalysis = createRadioAnalysis() } = {}) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', false);
  const satelliteCatalogue = createSatelliteProvider();
  const liveViews = createLiveViewsProvider();
  app.use((req, res, next) => {
    const hostname = req.hostname;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) return res.status(403).json({ error: 'This workspace accepts localhost requests only.' });
    const origin = req.get('origin');
    if (origin) { try { const u = new URL(origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return res.status(403).json({ error: 'Cross-origin access is disabled.' }); } catch { return res.status(403).json({ error: 'Invalid origin.' }); } }
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '20mb' }));
  const limited = new Map();
  app.use('/api', (req, res, next) => {
    if (!['/username', '/breaches', '/crypto', '/netscan', '/dns', '/certificates', '/catalogue', '/cameras/resolve', '/places', '/live-views'].some(p => req.path === p)) return next();
    const key = req.path, recent = (limited.get(key) || []).filter(t => Date.now() - t < 60000);
    if (recent.length >= 15) return res.status(429).json({ error: 'Please wait a minute before running more lookups.' });
    limited.set(key, [...recent, Date.now()]); next();
  });
  app.get('/api/health', (req, res) => res.json({ status: 'ready', retrievedAt: now() }));
  app.get('/api/radio/analysis-status', (req, res) => res.json(radioAnalysis.status()));
  let radioActive = 0;
  const radioRequests = [];
  for (const [path, method] of [['transcribe', 'transcribe'], ['summarize', 'summarize']]) {
    app.post(`/api/radio/${path}`, async (req, res) => {
      const time = Date.now(); while (radioRequests.length && radioRequests[0] < time - 60000) radioRequests.shift();
      if (radioRequests.length >= 12 || radioActive >= 2) return res.status(429).json({ error: 'Audio analysis is busy. Wait for the current request before retrying.' });
      radioRequests.push(time); radioActive++;
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', cancel);
      try { const result = await radioAnalysis[method](req.body, controller.signal); if (!controller.signal.aborted) res.json(result); }
      catch (error) { if (!controller.signal.aborted) throw error; }
      finally { radioActive--; res.off('close', cancel); }
    });
  }
  app.get('/api/satellite', async (req, res) => res.json(await satelliteCatalogue(req.query.refresh === '1')));
  app.get('/api/live-views', async (req, res) => res.json(await liveViews(req.query.refresh === '1')));
  app.get('/api/places', async (req, res) => res.json(await findPlaces(z.string().trim().min(2).max(200).parse(req.query.query))));
  app.get('/api/config', (req, res) => res.json({ chains, registries: [...registries, ...store.list('registry')], scopes, providers: { github: !!process.env.GITHUB_TOKEN, hibp: !!process.env.HIBP_API_KEY, blockscout: !!process.env.BLOCKSCOUT_API_KEY }, counts: Object.fromEntries(Object.keys(importSchemas).map(m => [m, store.db.prepare('SELECT COUNT(*) AS count FROM records WHERE module=?').get(m).count])), evidenceCount: store.evidence().length }));
  app.get('/api/records/:module', (req, res) => { if (!importSchemas[req.params.module]) fail('Unknown record type.', 404); res.json(store.list(req.params.module)); });
  app.get('/api/cameras', async (req, res) => res.json(await cameraDirectory(store, req.query.refresh === '1')));
  app.get('/api/cameras/ottawa-snapshot', async (req, res) => {
    const number = z.string().regex(/^\d{1,7}$/).parse(req.query.id);
    const version = req.query.timems === undefined ? Date.now() : z.string().regex(/^\d{1,16}$/).parse(req.query.timems);
    const image = await ottawaSnapshot(number, version);
    if (image.status === 'offline') return res.status(503).json({ cameraStatus: 'offline', error: 'Ottawa reports no live feed for this camera.' });
    res.type(image.type).send(image.bytes);
  });
  app.post('/api/cameras/resolve', async (req, res) => res.json(await resolveCameraPage(store, z.string().max(2048).parse(req.body.url))));
  app.get('/api/favorites', (req, res) => res.json(store.db.prepare('SELECT * FROM favorites ORDER BY created DESC').all()));
  app.post('/api/favorites', (req, res) => { const value = z.object({ module: z.enum(modules), key: z.string().min(1).max(2048), title: z.string().min(1).max(1000), selected: z.boolean() }).parse(req.body); if (value.selected) store.db.prepare('INSERT OR REPLACE INTO favorites VALUES (?,?,?,?)').run(value.module, value.key, value.title, now()); else store.db.prepare('DELETE FROM favorites WHERE module=? AND key=?').run(value.module, value.key); res.json({ saved: value.selected }); });
  app.post('/api/import/:module', (req, res) => res.json(store.importRows(req.params.module, req.body.rows)));
  app.delete('/api/records/:module/:id', (req, res) => { res.json({ deleted: Number(store.db.prepare('DELETE FROM records WHERE module=? AND id=?').run(req.params.module, req.params.id).changes) }); });
  app.get('/api/watchtower', async (req, res) => res.json(await hazardFeeds(store, req.query.refresh === '1')));
  app.get('/api/space-weather', async (req, res) => { const source = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'; res.json({ readings: (await fetchJSON(source)).slice(-12), source, retrievedAt: now() }); });
  app.post('/api/username', async (req, res) => res.json(await usernames(String(req.body.handle || ''))));
  app.post('/api/breaches', async (req, res) => res.json(await breachLookup(req.body.email, req.body.authorized)));
  app.post('/api/crypto', async (req, res) => res.json(await cryptoTrace(req.body.chain, req.body.wallet)));
  app.post('/api/dns', async (req, res) => res.json(await passiveDNS(req.body.target)));
  app.post('/api/certificates', async (req, res) => res.json(await certificateNames(req.body.target)));
  app.post('/api/netscan', async (req, res) => res.json(await scanNetwork(req.body, { scopes, torHost: process.env.TOR_HOST || '127.0.0.1', torPort: Number(process.env.TOR_PORT || 9050) })));
  app.post('/api/catalogue', async (req, res) => res.json(await catalogueSearch(String(req.body.query || ''))));
  app.get('/api/evidence', (req, res) => res.json(store.evidence()));
  app.post('/api/evidence', (req, res) => res.status(201).json(store.saveEvidence(req.body)));
  app.patch('/api/evidence/:id', (req, res) => { const notes = z.string().max(10000).parse(req.body.notes); res.json({ updated: Number(store.db.prepare('UPDATE evidence SET notes=? WHERE id=?').run(notes, req.params.id).changes) }); });
  app.delete('/api/evidence/:id', (req, res) => res.json({ deleted: Number(store.db.prepare('DELETE FROM evidence WHERE id=?').run(req.params.id).changes) }));
  app.get('/api/export', (req, res) => res.attachment('northstar-workspace.json').json({ format: 'northstar-workspace', version: 1, exportedAt: now(), favorites: store.db.prepare('SELECT * FROM favorites ORDER BY created DESC').all(), evidence: store.evidence(), imports: Object.fromEntries(Object.keys(importSchemas).map(m => [m, store.list(m)])), links: store.db.prepare('SELECT * FROM links').all().map(link => ({ ...link, visits: store.db.prepare('SELECT * FROM visits WHERE link_id=? ORDER BY created DESC').all(link.id).map(v => ({ ...v, payload: JSON.parse(v.payload) })) })) }));
  app.get('/api/links', (req, res) => res.json(store.db.prepare('SELECT * FROM links ORDER BY created DESC').all().map(link => ({ ...link, visits: store.db.prepare('SELECT * FROM visits WHERE link_id=? ORDER BY created DESC LIMIT 200').all(link.id).map(v => ({ ...v, payload: JSON.parse(v.payload) })) }))));
  app.post('/api/links', (req, res) => {
    const value = z.object({ title: z.string().trim().min(1).max(120), destination: z.string().transform(httpUrl), days: z.coerce.number().int().min(1).max(30).default(7) }).parse(req.body);
    const id = randomUUID(), created = now(), expires = new Date(Date.now() + value.days * 86400000).toISOString();
    store.db.prepare('INSERT INTO links VALUES (?,?,?,?,?)').run(id, value.title, value.destination, created, expires);
    res.status(201).json({ id, ...value, created, expires, path: `/v/${id}` });
  });
  app.delete('/api/links/:id', (req, res) => res.json({ deleted: Number(store.db.prepare('DELETE FROM links WHERE id=?').run(req.params.id).changes) }));
  app.get('/v/:id', (req, res) => {
    const link = store.db.prepare('SELECT * FROM links WHERE id=?').get(req.params.id);
    if (!link || Date.parse(link.expires) < Date.now()) return res.status(410).send('This research link is unavailable or has expired.');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(link.title)} · Research link</title><link rel="stylesheet" href="/visitor.css"></head><body><main><span class="brand">NORTHSTAR / RESEARCH LINK</span><h1>${escape(link.title)}</h1><p>This link belongs to a local research workspace. Sharing is optional. If you agree, the researcher will receive your IP address, browser details, language, screen dimensions, and visit time. Opening this page does not save a visit.</p><p>Destination: <a href="${escape(link.destination)}" rel="noreferrer">${escape(link.destination)}</a></p><label><input id="gps" type="checkbox"> Also share browser location (coordinates and reported accuracy)</label><button id="share" data-link="${escape(link.id)}">Agree and share visit</button><p id="status" role="status"></p><a href="${escape(link.destination)}" rel="noreferrer">Continue without sharing</a><p class="small">Your browser may ask for location permission. Location accuracy depends on your device. The researcher can delete this information from their workspace.</p></main><script src="/visitor.js" defer></script></body></html>`);
  });
  app.post('/api/visits/:id', (req, res) => {
    const link = store.db.prepare('SELECT * FROM links WHERE id=?').get(req.params.id);
    if (!link || Date.parse(link.expires) < Date.now()) fail('This research link has expired.', 410);
    const schema = z.object({ consent: z.literal(true), language: z.string().max(100), screen: z.string().max(100), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().finite().nonnegative(), timestamp: z.number().finite() }).optional() });
    const input = schema.parse(req.body);
    const payload = { ...input, ip: req.socket.remoteAddress, browser: String(req.get('user-agent') || '').slice(0, 2000), consentVersion: '1', notice: 'Voluntary research-link telemetry' };
    store.db.prepare('INSERT INTO visits (id,link_id,payload,created) VALUES (?,?,?,?)').run(randomUUID(), link.id, JSON.stringify(payload), now());
    res.status(201).json({ saved: true, destination: link.destination });
  });
  app.use(express.static(resolve(root, 'public')));
  if (existsSync(resolve(root, 'dist/index.html'))) { app.use(express.static(resolve(root, 'dist'))); app.get('/{*path}', (req, res) => res.sendFile(resolve(root, 'dist/index.html'))); }
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((err, req, res, next) => { const status = err instanceof ZodError || err instanceof TypeError || err instanceof SyntaxError ? 400 : err.status || 500; res.status(status).json({ error: err instanceof ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : status === 500 ? 'Request failed. Check the local server log.' : err.message }); if (status === 500) console.error(err.message); });
  return { app, store };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = createApp();
  const port = Number(process.env.PORT || 8787);
  app.listen(port, '127.0.0.1', () => console.log(`Northstar API listening at http://127.0.0.1:${port}`));
}
