import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const modules = ['camera', 'username', 'crypto', 'netscan', 'hawk', 'skywave', 'fisherman', 'catalogue', 'watchtower'];
export const now = () => new Date().toISOString();
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function httpUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) fail('Use an HTTP or HTTPS URL without embedded credentials.');
  return u.href;
}
const url = z.string().max(2048).transform(httpUrl);
const finite = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number().finite());
const latitude = finite.pipe(z.number().min(-90).max(90)), longitude = finite.pipe(z.number().min(-180).max(180));
const text = z.string().trim().min(1).max(1000);
const date = z.string().datetime({ offset: true });
export const cameraSchema = z.object({ name: text, lat: latitude, lon: longitude, url, source: text, kind: z.enum(['image', 'video', 'hls', 'page']).default('page'), country: z.string().max(100).default(''), timestamp: date.optional(), thumbnail: url.optional(), location: text.optional(), coordinateType: z.enum(['provider', 'view', 'user']).default('user'), coordinateSource: url.optional(), coordinateNote: z.string().max(1000).optional() });
export const eventSchema = z.object({ title: text, lat: latitude, lon: longitude, category: text, source: text, url: url.optional(), timestamp: date, magnitude: finite.optional() });
export const transferSchema = z.object({ chain: text, hash: text, from: text, to: text, amount: z.union([z.string(), z.number()]).transform(String).refine(v => /^\d+(\.\d+)?$/.test(v), 'Amount must be a nonnegative decimal.'), asset: text, timestamp: date, source: text, url: url.optional() });
export const spectrumSchema = z.object({ frequency_hz: finite.pipe(z.number().positive().max(1e14)), dbm: finite.pipe(z.number().min(-300).max(200)), timestamp: date, source: text });
export const registrySchema = z.object({ name: text, jurisdiction: text, category: text, url, access: z.enum(['manual', 'api']).default('manual') });
export const recordSchema = z.object({ title: text, identifier: text, source: text, url: url.optional(), jurisdiction: text.optional(), timestamp: date.optional(), details: z.record(z.string(), z.unknown()).optional() });
export const importSchemas = { camera: cameraSchema, watchtower: eventSchema, crypto: transferSchema, skywave: spectrumSchema, registry: registrySchema, catalogue: recordSchema };

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, module TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_module ON records(module);
    CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, module TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, title TEXT NOT NULL, destination TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, link_id TEXT REFERENCES links(id) ON DELETE CASCADE, payload TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feed_cache (name TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites (module TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(module,key));
  `);
  const list = (module) => db.prepare('SELECT * FROM records WHERE module=? ORDER BY created DESC').all(module).map(r => ({ ...JSON.parse(r.payload), id: r.id, importedAt: r.created }));
  function importRows(module, rows) {
    const schema = importSchemas[module];
    if (!schema) fail('This module does not accept structured imports.');
    if (!Array.isArray(rows) || !rows.length || rows.length > 50000) fail('Import between 1 and 50,000 rows per file.');
    const valid = rows.map((row, index) => {
      const result = schema.safeParse(row);
      if (!result.success) fail(`Row ${index + 1}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return result.data;
    });
    let inserted = 0;
    const statement = db.prepare('INSERT OR IGNORE INTO records VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
      for (const row of valid) {
        const key = createHash('sha256').update(module + JSON.stringify(row)).digest('hex');
        inserted += Number(statement.run(key, module, JSON.stringify(row), now()).changes);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { inserted, duplicates: valid.length - inserted, total: list(module).length };
  }
  function saveEvidence(input) {
    const value = z.object({ module: z.enum(modules), title: text, source: text, payload: z.unknown(), notes: z.string().max(10000).default('') }).parse(input);
    const existing = db.prepare('SELECT id FROM evidence WHERE module=? AND title=? AND source=? AND payload=?').get(value.module, value.title, value.source, JSON.stringify(value.payload));
    if (existing) return { id: existing.id, existing: true };
    const id = randomUUID();
    db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?)').run(id, value.module, value.title, value.source, JSON.stringify(value.payload), value.notes, now());
    return { id };
  }
  const evidence = () => db.prepare('SELECT * FROM evidence ORDER BY created DESC').all().map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  return { db, list, importRows, saveEvidence, evidence };
}

export function normalizeTarget(raw) {
  let host = String(raw || '').trim().toLowerCase();
  if (host.includes('://')) { const u = new URL(host); if (!['http:', 'https:'].includes(u.protocol)) fail('Use a domain, IP, CIDR, or HTTP URL.'); host = u.hostname; }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host.length > 253 || (!isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host))) fail('Enter a valid domain or literal IP address.');
  if (host.split('.').some(part => part.length > 63 || part.startsWith('-') || part.endsWith('-')) && !isIP(host)) fail('Invalid domain label.');
  return host;
}
const ipv4Int = ip => ip.split('.').reduce((a, n) => (a * 256 + Number(n)) >>> 0, 0);
export function inCIDR(ip, scope) {
  const [base, bits] = scope.split('/');
  if (isIP(ip) !== 4 || isIP(base) !== 4 || !/^\d+$/.test(bits || '') || Number(bits) > 32) return false;
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (ipv4Int(ip) & mask) === (ipv4Int(base) & mask);
}
export function allowedHost(host, scopes) { return scopes.some(scope => scope === host || (scope.includes('/') && inCIDR(host, scope))); }
export function expandCIDR(raw) {
  const [base, bitsRaw] = raw.split('/'); const bits = Number(bitsRaw);
  if (isIP(base) !== 4 || !/^\d+$/.test(bitsRaw || '') || bits < 28 || bits > 32) fail('Use an IPv4 range from /28 to /32 (at most 16 addresses).');
  const count = 2 ** (32 - bits), start = Math.floor(ipv4Int(base) / count) * count;
  return Array.from({ length: count }, (_, i) => [24, 16, 8, 0].map(shift => ((start + i) >>> shift) & 255).join('.'));
}
export function validateOnion(host) {
  if (!/^[a-z2-7]{56}\.onion$/.test(host)) return false;
  let bits = 0, value = 0; const bytes = [];
  for (const c of host.slice(0, 56)) {
    value = (value << 5) | 'abcdefghijklmnopqrstuvwxyz234567'.indexOf(c); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  const raw = Buffer.from(bytes);
  const checksum = createHash('sha3-256').update(Buffer.concat([Buffer.from('.onion checksum'), raw.subarray(0, 32), raw.subarray(34, 35)])).digest().subarray(0, 2);
  return raw[34] === 3 && raw.subarray(32, 34).equals(checksum);
}

export const chains = [
  ['bitcoin', 'Bitcoin', 'BTC', null], ['ethereum', 'Ethereum', 'ETH', 1], ['base', 'Base', 'ETH', 8453], ['arbitrum', 'Arbitrum', 'ETH', 42161],
  ['optimism', 'Optimism', 'ETH', 10], ['polygon', 'Polygon', 'POL', 137], ['gnosis', 'Gnosis', 'xDAI', 100], ['celo', 'Celo', 'CELO', 42220],
  ['avalanche', 'Avalanche', 'AVAX', 43114], ['bsc', 'BNB Chain', 'BNB', 56], ['scroll', 'Scroll', 'ETH', 534352], ['zksync', 'ZKsync', 'ETH', 324],
  ['linea', 'Linea', 'ETH', 59144], ['zora', 'Zora', 'ETH', 7777777], ['polygon-zkevm', 'Polygon zkEVM', 'ETH', 1101],
  ['mantle', 'Mantle', 'MNT', 5000], ['mode', 'Mode', 'ETH', 34443], ['blast', 'Blast', 'ETH', 81457],
  ['solana', 'Solana', 'SOL', null], ['tron', 'Tron', 'TRX', null], ['xrp', 'XRP Ledger', 'XRP', null], ['cardano', 'Cardano', 'ADA', null],
  ['litecoin', 'Litecoin', 'LTC', null], ['dogecoin', 'Dogecoin', 'DOGE', null]
].map(([id, name, asset, chainId]) => ({ id, name, asset, chainId, access: id === 'bitcoin' ? 'public' : chainId ? 'provider' : 'import' }));

export const registries = [
  ['Companies House', 'United Kingdom', 'Companies', 'https://find-and-update.company-information.service.gov.uk/search?q={q}'],
  ['SEC EDGAR', 'United States', 'Companies', 'https://www.sec.gov/edgar/search/#/q={q}'],
  ['Corporations Canada', 'Canada', 'Companies', 'https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html'],
  ['Ontario Business Registry', 'Canada', 'Companies', 'https://www.ontario.ca/page/ontario-business-registry'],
  ['ABN Lookup', 'Australia', 'Companies', 'https://abr.business.gov.au/Search/ResultsActive?SearchText={q}'],
  ['New Zealand Companies Register', 'New Zealand', 'Companies', 'https://companies-register.companiesoffice.govt.nz/'],
  ['INPI Data', 'France', 'Companies', 'https://data.inpi.fr/'],
  ['Handelsregister', 'Germany', 'Companies', 'https://www.handelsregister.de/'],
  ['Zefix', 'Switzerland', 'Companies', 'https://www.zefix.ch/'],
  ['ACRA Bizfile', 'Singapore', 'Companies', 'https://www.bizfile.gov.sg/'],
  ['European e-Justice Business Registers', 'European Union', 'Companies', 'https://e-justice.europa.eu/topics/registers-business-insolvency-land/business-registers-search-company-eu_en'],
  ['OFAC Sanctions List Search', 'United States', 'Sanctions', 'https://sanctionssearch.ofac.treas.gov/'],
  ['UK Sanctions List', 'United Kingdom', 'Sanctions', 'https://www.gov.uk/government/publications/the-uk-sanctions-list'],
  ['UN Security Council Consolidated List', 'United Nations', 'Sanctions', 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list'],
  ['EU Sanctions Map', 'European Union', 'Sanctions', 'https://www.sanctionsmap.eu/'],
  ['Canadian Sanctions', 'Canada', 'Sanctions', 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng'],
  ['PACER', 'United States', 'Courts', 'https://pacer.uscourts.gov/'],
  ['Find Case Law', 'United Kingdom', 'Courts', 'https://caselaw.nationalarchives.gov.uk/search?query={q}'],
  ['Supreme Court of Canada', 'Canada', 'Courts', 'https://decisions.scc-csc.ca/'],
  ['European Court of Human Rights', 'Europe', 'Courts', 'https://hudoc.echr.coe.int/'],
  ['NPI Registry', 'United States', 'Licensing', 'https://npiregistry.cms.hhs.gov/'],
  ['FINRA BrokerCheck', 'United States', 'Licensing', 'https://brokercheck.finra.org/'],
  ['General Medical Council', 'United Kingdom', 'Licensing', 'https://www.gmc-uk.org/registration-and-licensing/the-medical-register'],
  ['USPTO Patent Search', 'United States', 'Patents', 'https://ppubs.uspto.gov/pubwebapp/'],
  ['WIPO PATENTSCOPE', 'International', 'Patents', 'https://patentscope.wipo.int/'],
  ['HM Land Registry', 'United Kingdom', 'Property', 'https://www.gov.uk/search-property-information-land-registry'],
  ['GLEIF LEI Search', 'International', 'Companies', 'https://search.gleif.org/']
].map(([name, jurisdiction, category, url]) => ({ name, jurisdiction, category, url, access: name.startsWith('GLEIF') ? 'api' : 'manual' }));
