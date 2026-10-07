import { now, fail, chains } from './core.mjs';

const hosts = new Set(['earthquake.usgs.gov', 'eonet.gsfc.nasa.gov', 'services.swpc.noaa.gov', 'api.github.com', 'gitlab.com', 'hacker-news.firebaseio.com', 'haveibeenpwned.com', 'mempool.space', 'api.blockscout.com', 'api.gleif.org', 'crt.sh']);
export async function fetchJSON(url, headers = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.has(u.hostname)) fail('Provider URL is not configured.');
  const response = await fetch(u, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'NorthstarWorkbench/0.1 local-public-research', ...headers } });
  if (!response.ok) throw Object.assign(new Error(`Provider returned HTTP ${response.status}.`), { status: 502, providerStatus: response.status });
  if (Number(response.headers.get('content-length')) > 12e6) fail('Provider response is too large.', 502);
  const reader = response.body.getReader(); const parts = []; let length = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 12e6) { await reader.cancel(); fail('Provider response is too large.', 502); } parts.push(value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString());
}
export async function hazardFeeds(store, force = false) {
  const specs = [
    { name: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', map: data => data.features.map(f => ({ id: `usgs-${f.id}`, title: f.properties.place, category: 'Earthquake', magnitude: f.properties.mag, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], timestamp: new Date(f.properties.time).toISOString(), source: 'USGS', url: f.properties.url })) },
    { name: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=100', map: data => data.events.flatMap(e => { const g = e.geometry.filter(g => g.type === 'Point').at(-1); return g ? [{ id: `eonet-${e.id}`, title: e.title, category: e.categories[0]?.title || 'Natural event', lat: g.coordinates[1], lon: g.coordinates[0], timestamp: g.date, source: 'NASA EONET', url: e.sources[0]?.url || e.link }] : []; }) }
  ];
  const feeds = await Promise.all(specs.map(async spec => {
    const cache = store.db.prepare('SELECT * FROM feed_cache WHERE name=?').get(spec.name);
    if (!force && cache && Date.now() - Date.parse(cache.fetched) < 300000) return { name: spec.name, url: spec.url, status: 'ready', retrievedAt: cache.fetched, events: JSON.parse(cache.payload) };
    try {
      const events = spec.map(await fetchJSON(spec.url)), retrievedAt = now();
      store.db.prepare('INSERT OR REPLACE INTO feed_cache VALUES (?,?,?)').run(spec.name, JSON.stringify(events), retrievedAt);
      return { name: spec.name, url: spec.url, status: 'ready', retrievedAt, events };
    } catch (e) { return { name: spec.name, url: spec.url, status: cache ? 'stale' : 'unavailable', error: e.message, retrievedAt: cache?.fetched, events: cache ? JSON.parse(cache.payload) : [] }; }
  }));
  return { feeds, events: [...feeds.flatMap(f => f.events.map(e => ({ ...e, retrievedAt: f.retrievedAt, stale: f.status === 'stale' }))), ...store.list('watchtower')], retrievedAt: now() };
}
export async function usernames(handle) {
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(handle)) fail('Use 1–64 letters, numbers, dots, underscores, or hyphens.');
  const q = encodeURIComponent(handle);
  const specs = [
    { name: 'GitHub', url: `https://api.github.com/users/${q}`, link: `https://github.com/${q}`, headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}, normalize: d => ({ id: d.id, name: d.name || d.login, bio: d.bio, location: d.location, website: d.blog, followers: d.followers, created: d.created_at }) },
    { name: 'GitLab', url: `https://gitlab.com/api/v4/users?username=${q}`, link: `https://gitlab.com/${q}`, normalize: d => d.length ? { id: d[0].id, name: d[0].name, profile: d[0].web_url } : null },
    { name: 'Hacker News', url: `https://hacker-news.firebaseio.com/v0/user/${q}.json`, link: `https://news.ycombinator.com/user?id=${q}`, normalize: d => d ? { id: d.id, name: d.id, karma: d.karma, created: new Date(d.created * 1000).toISOString(), bio: d.about } : null }
  ];
  const results = await Promise.all(specs.map(async s => {
    try { const profile = s.normalize(await fetchJSON(s.url, s.headers)); return { platform: s.name, status: profile ? 'found' : 'not_found', profile, url: s.link, source: s.url, retrievedAt: now() }; }
    catch (e) { return { platform: s.name, status: e.providerStatus === 404 ? 'not_found' : 'unavailable', error: e.message, url: s.link, source: s.url, retrievedAt: now() }; }
  }));
  for (const [platform, base] of [['Instagram', 'https://www.instagram.com/'], ['Reddit', 'https://www.reddit.com/user/'], ['TikTok', 'https://www.tiktok.com/@'], ['YouTube', 'https://www.youtube.com/@'], ['X', 'https://x.com/']]) results.push({ platform, status: 'not_searched', url: base + q, source: base, error: 'Manual review required; profile URL is a lead, not an account match.' });
  return { handle, results, retrievedAt: now(), caveat: 'Matching handles do not prove the accounts belong to the same person.' };
}
export async function breachLookup(email, authorized) {
  if (!authorized) fail('Confirm that this is your account or an authorized account audit.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) fail('Enter a valid email address.');
  if (!process.env.HIBP_API_KEY) fail('Set HIBP_API_KEY in .env to enable licensed account-breach lookups.', 503);
  const source = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  try { return { email, breaches: await fetchJSON(source, { 'hibp-api-key': process.env.HIBP_API_KEY }), source: 'Have I Been Pwned', retrievedAt: now() }; }
  catch (e) { if (e.providerStatus === 404) return { email, breaches: [], source: 'Have I Been Pwned', retrievedAt: now() }; throw e; }
}
export function bitcoinTransfers(wallet, txs) {
  // Bitcoin has multiple inputs and outputs. Edges below are UTXOs, not asserted input-output attribution.
  return txs.flatMap(tx => {
    const timestamp = tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : now();
    const common = { chain: 'bitcoin', hash: tx.txid, asset: 'BTC', timestamp, source: 'mempool.space', url: `https://mempool.space/tx/${tx.txid}`, confirmed: tx.status.confirmed };
    const inputs = tx.vin.filter(v => v.prevout?.scriptpubkey_address === wallet).map((v, i) => ({ ...common, id: `${tx.txid}-in-${i}`, from: wallet, to: `tx:${tx.txid}`, amount: (v.prevout.value / 1e8).toFixed(8), edgeType: 'input UTXO' }));
    const spends = tx.vin.some(v => v.prevout?.scriptpubkey_address === wallet);
    const outputs = tx.vout.flatMap((v, i) => v.scriptpubkey_address && (spends || v.scriptpubkey_address === wallet) ? [{ ...common, id: `${tx.txid}-out-${i}`, from: `tx:${tx.txid}`, to: v.scriptpubkey_address, amount: (v.value / 1e8).toFixed(8), edgeType: 'output UTXO' }] : []);
    return [...inputs, ...outputs];
  });
}
export async function cryptoTrace(chain, wallet) {
  const config = chains.find(c => c.id === chain); if (!config) fail('Select a configured chain.');
  const normalizedWallet = String(wallet || '').trim();
  if (chain === 'bitcoin') {
    if (!/^(bc1[a-zA-Z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(normalizedWallet)) fail('Enter a Bitcoin mainnet address.');
    const base = `https://mempool.space/api/address/${encodeURIComponent(normalizedWallet)}`;
    const [summary, txs] = await Promise.all([fetchJSON(base), fetchJSON(`${base}/txs`)]);
    return { wallet: normalizedWallet, chain, summary, transfers: bitcoinTransfers(normalizedWallet, txs), source: base, retrievedAt: now(), caveat: 'Latest provider page only. Transaction nodes retain UTXO ambiguity; no ownership or direct input-output attribution is inferred.' };
  }
  if (!config.chainId) fail('This chain supports imported transfers. Import an explorer export to trace its flows.', 503);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)) fail('Enter a 0x-prefixed EVM wallet address.');
  if (!process.env.BLOCKSCOUT_API_KEY) fail('Set BLOCKSCOUT_API_KEY to enable EVM lookups, or import transfers.', 503);
  const base = `https://api.blockscout.com/v2/api?chain_id=${config.chainId}&module=account&action=txlist&address=${normalizedWallet}&page=1&offset=50&sort=desc`;
  const data = await fetchJSON(`${base}&apikey=${encodeURIComponent(process.env.BLOCKSCOUT_API_KEY)}`);
  if (data.status !== '1' && !Array.isArray(data.result)) fail('Blockscout could not return transfers for this chain. Check provider support and your key.', 502);
  const transfers = (Array.isArray(data.result) ? data.result : []).filter(t => t.from && t.to && t.isError !== '1').map(t => ({ chain, hash: t.hash, from: t.from, to: t.to, amount: decimalUnits(t.value || '0', 18), asset: config.asset, timestamp: new Date(Number(t.timeStamp) * 1000).toISOString(), source: 'Blockscout', status: 'successful' }));
  return { wallet: normalizedWallet, chain, transfers, source: base, retrievedAt: now(), caveat: 'Latest page of native transactions. Token transfers, internal calls, bridges, labels, and complete history are not included.' };
}
export function decimalUnits(raw, decimals) { const s = String(raw).padStart(decimals + 1, '0'); return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`; }
export async function catalogueSearch(query) {
  if (!query || query.length > 150) fail('Enter a name up to 150 characters.');
  const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(query)}&page[size]=25`;
  try {
    const data = await fetchJSON(url);
    return { status: 'ready', source: 'GLEIF', sourceUrl: url, retrievedAt: now(), records: data.data.map(r => ({ title: r.attributes.entity.legalName.name, identifier: r.id, jurisdiction: r.attributes.entity.jurisdiction, source: 'GLEIF', url: `https://search.gleif.org/#/record/${r.id}`, details: r.attributes })), total: data.meta?.pagination?.total, caveat: 'Up to 25 LEI entity records. Names alone do not establish an identity match.' };
  } catch (e) { return { status: 'unavailable', source: 'GLEIF', error: e.message, records: [], retrievedAt: now() }; }
}
