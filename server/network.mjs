import * as dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { SocksClient } from 'socks';
import { allowedHost, expandCIDR, normalizeTarget, validateOnion, fail, now } from './core.mjs';
import { fetchJSON } from './providers.mjs';

export async function passiveDNS(raw) {
  const host = normalizeTarget(raw);
  if (host.endsWith('.onion')) return { host, records: {}, source: 'Tor hidden services have no public DNS records', retrievedAt: now() };
  if (net.isIP(host)) {
    const names = await dns.reverse(host).catch(() => []);
    return { host, records: { PTR: { status: names.length ? 'found' : 'absent_or_unavailable', values: names } }, source: 'System DNS resolver', retrievedAt: now() };
  }
  const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
  const recordTypes = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CAA', 'SOA'];
  const records = Object.fromEntries(await Promise.all(recordTypes.map(async type => {
    try { return [type, { status: 'found', values: await resolver.resolve(host, type) }]; }
    catch (e) { return [type, { status: ['ENODATA', 'ENOTFOUND'].includes(e.code) ? 'absent' : 'unavailable', reason: e.code, values: [] }]; }
  })));
  return { host, records, source: 'System DNS resolver', retrievedAt: now() };
}
export async function certificateNames(raw) {
  const host = normalizeTarget(raw);
  if (net.isIP(host) || host.endsWith('.onion')) fail('Certificate transparency lookup needs a public domain.');
  const source = `https://crt.sh/?q=${encodeURIComponent(`%.${host}`)}&output=json`;
  const rows = await fetchJSON(source);
  const names = [...new Set(rows.flatMap(r => String(r.name_value).split('\n')).map(n => n.toLowerCase()).filter(n => n === host || n.endsWith(`.${host}`)))].slice(0, 500);
  return { host, names, source, retrievedAt: now(), caveat: 'Certificate names are historical leads; they do not prove a host is currently reachable.' };
}
function tcpProbe(host, port, onion, options) {
  return new Promise(resolve => {
    const started = Date.now(); let finished = false; let socket;
    const finish = (state, detail) => { if (finished) return; finished = true; clearTimeout(timer); socket?.destroy(); resolve({ host, port, state, detail, elapsedMs: Date.now() - started }); };
    const timer = setTimeout(() => finish('timeout', 'No response within 1.5 seconds; state is unknown.'), 1500);
    if (onion) {
      SocksClient.createConnection({ proxy: { host: options.torHost, port: options.torPort, type: 5 }, command: 'connect', destination: { host, port }, timeout: 1500 }).then(info => { socket = info.socket; if (finished) socket.destroy(); else finish('open', 'Tor SOCKS connection accepted.'); }).catch(e => finish('unavailable', e.message));
    } else {
      socket = net.createConnection({ host, port });
      socket.once('connect', () => finish('open', 'TCP connection accepted.'));
      socket.once('error', e => finish(e.code === 'ECONNREFUSED' ? 'closed' : 'unavailable', e.code));
    }
  });
}
async function certificate(host, ip) {
  return new Promise(resolve => {
    let socket; const finish = value => { clearTimeout(timer); socket?.destroy(); resolve(value); };
    const timer = setTimeout(() => finish({ status: 'unavailable', reason: 'TLS handshake timed out.' }), 3000);
    socket = tls.connect({ host: ip, port: 443, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false });
    socket.once('secureConnect', () => { const cert = socket.getPeerCertificate(); finish({ status: 'found', trusted: socket.authorized, trustError: socket.authorizationError, subject: cert.subject, issuer: cert.issuer, validFrom: cert.valid_from, validTo: cert.valid_to, subjectAltName: cert.subjectaltname, fingerprint256: cert.fingerprint256 }); });
    socket.once('error', e => finish({ status: 'unavailable', reason: e.code }));
  });
}
export async function scanNetwork(input, options) {
  if (input.authorized !== true) fail('Confirm authorization for the configured target.');
  const raw = String(input.target || '').trim();
  const targets = raw.includes('/') && !raw.includes('://') ? expandCIDR(raw) : [normalizeTarget(raw)];
  const ports = [...new Set(String(input.ports || '80,443').split(',').map(s => Number(s.trim())))];
  if (!ports.length || ports.length > 32 || ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535)) fail('Provide 1–32 comma-separated ports between 1 and 65535.');
  const addresses = [];
  for (const target of targets) {
    if (!allowedHost(target, options.scopes)) fail(`Target ${target} is outside SCAN_ALLOWLIST. Add your authorized scope to .env and restart.`, 403);
    if (target.endsWith('.onion')) {
      if (!validateOnion(target)) fail('Invalid Tor v3 address checksum.');
      addresses.push({ original: target, ip: target, onion: true });
    } else {
      const ips = net.isIP(target) ? [{ address: target }] : await dns.lookup(target, { all: true });
      for (const { address } of ips.slice(0, 4)) {
        if (!allowedHost(address, options.scopes)) {
          const restricted = address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
          if (restricted) fail(`Resolved address ${address} needs an explicit allowed IP or CIDR.`, 403);
        }
        addresses.push({ original: target, ip: address, onion: false });
      }
    }
  }
  const jobs = addresses.flatMap(a => ports.map(port => ({ ...a, port }))); const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (cursor < jobs.length) { const job = jobs[cursor++]; const result = await tcpProbe(job.ip, job.port, job.onion, options); if (job.port === 443 && result.state === 'open' && !job.onion) result.certificate = await certificate(job.original, job.ip); results.push(result); }
  }));
  return { target: raw, results: results.sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port), source: 'Local TCP / Tor SOCKS probes', retrievedAt: now(), caveat: 'Port numbers do not identify services. Timeout is unknown, not closed. No exploit or vulnerability checks run.' };
}
