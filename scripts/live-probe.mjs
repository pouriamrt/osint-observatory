const base = 'http://127.0.0.1:8787';
const probes = [
  ['Watchtower', '/watchtower', null],
  ['Username public APIs', '/username', { handle: 'octocat' }],
  ['GLEIF', '/catalogue', { query: 'Apple' }],
  ['Bitcoin', '/crypto', { chain: 'bitcoin', wallet: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }]
];
await Promise.all(probes.map(async ([name, path, body]) => {
  try {
    const r = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(35000) });
    const d = await r.json();
    console.log(JSON.stringify({ name, status: r.status, feeds: d.feeds?.map(f => ({ name: f.name, status: f.status, events: f.events.length, error: f.error })), profiles: d.results?.map(f => ({ platform: f.platform, status: f.status })), records: d.records?.length, transfers: d.transfers?.length, providerStatus: d.status, error: d.error }));
  } catch (e) { console.log(JSON.stringify({ name, error: e.message })); }
}));
