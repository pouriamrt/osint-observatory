import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { openStore, allowedHost, expandCIDR, normalizeTarget, validateOnion, httpUrl } from '../server/core.mjs';
import { bitcoinTransfers, decimalUnits } from '../server/providers.mjs';
import { scanNetwork } from '../server/network.mjs';
import { bearing, distance, triangulate } from '../src/lib/geometry.ts';

test('structured imports validate atomically, retain attribution, and skip exact duplicates', () => {
  const store = openStore(':memory:');
  const camera = { name: 'Test owned camera', lat: 43, lon: -79, url: 'https://example.org/camera', source: 'Test fixture', kind: 'page' };
  assert.throws(() => store.importRows('camera', [camera, { ...camera, lat: 91 }]));
  assert.equal(store.list('camera').length, 0);
  assert.equal(store.importRows('camera', [camera, camera]).inserted, 1);
  assert.equal(store.importRows('camera', [camera]).duplicates, 1);
  assert.equal(store.list('camera')[0].source, 'Test fixture');
  assert.throws(() => store.importRows('camera', [{ ...camera, url: 'javascript:alert(1)' }]));
  assert.throws(() => store.importRows('camera', [{ ...camera, lat: null }]));
  assert.throws(() => store.importRows('camera', [{ ...camera, lon: false }]));
  store.db.close();
});
test('scan allowlist matches exact hosts and CIDR boundaries', () => {
  assert.equal(allowedHost('127.0.0.1', ['127.0.0.0/8']), true);
  assert.equal(allowedHost('128.0.0.1', ['127.0.0.0/8']), false);
  assert.equal(allowedHost('example.org.evil.test', ['example.org']), false);
  assert.equal(allowedHost('::1', ['::1']), true);
  assert.equal(expandCIDR('192.168.1.7/30').join(','), '192.168.1.4,192.168.1.5,192.168.1.6,192.168.1.7');
  assert.throws(() => expandCIDR('192.168.1.0/24'));
  assert.throws(() => expandCIDR('192.168.1.0/no'));
  assert.equal(normalizeTarget('https://EXAMPLE.org/path'), 'example.org');
  assert.throws(() => normalizeTarget('example.org;whoami'));
  assert.throws(() => httpUrl('https://user:secret@example.org'));
});
test('Tor v3 addresses require a matching SHA3 checksum and version', () => {
  const key = Buffer.alloc(32, 1), version = Buffer.from([3]);
  const checksum = createHash('sha3-256').update(Buffer.concat([Buffer.from('.onion checksum'), key, version])).digest().subarray(0, 2);
  const bytes = Buffer.concat([key, checksum, version]); const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let output = '', bits = 0, value = 0;
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; output += alphabet[(value >>> bits) & 31]; } }
  const host = `${output}.onion`;
  assert.equal(validateOnion(host), true);
  assert.equal(validateOnion('b' + host.slice(1)), false);
  assert.equal(validateOnion('invalid.onion'), false);
});
test('bounded scan observes an owned listener and rejects out-of-scope targets before connecting', async () => {
  const server = net.createServer(socket => socket.end()); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await scanNetwork({ target: '127.0.0.1', ports: String(server.address().port), authorized: true }, { scopes: ['127.0.0.1'] });
    assert.equal(result.results[0].state, 'open');
    await assert.rejects(scanNetwork({ target: '192.0.2.1', ports: '80', authorized: true }, { scopes: ['127.0.0.1'] }), /outside SCAN_ALLOWLIST/);
    await assert.rejects(scanNetwork({ target: '127.0.0.1', ports: '80', authorized: false }, { scopes: ['127.0.0.1'] }), /Confirm authorization/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('Bitcoin graph retains transaction nodes rather than asserting which input funded an output', () => {
  const txs = [{ txid: 'fixture', status: { confirmed: true, block_time: 1700000000 }, vin: [{ prevout: { scriptpubkey_address: 'wallet', value: 5000 } }, { prevout: { scriptpubkey_address: 'other', value: 6000 } }], vout: [{ scriptpubkey_address: 'recipient', value: 9000 }, { scriptpubkey_address: 'wallet', value: 1000 }] }];
  const edges = bitcoinTransfers('wallet', txs);
  assert.equal(edges.length, 3);
  assert(edges.every(e => e.from === 'tx:fixture' || e.to === 'tx:fixture'));
  assert.equal(edges[0].amount, '0.00005000');
  assert.equal(decimalUnits('1234567890123456789', 18), '1.234567890123456789');
});
test('geometry reconstructs an independent three-landmark location and rejects degeneracy', () => {
  const camera = { lat: 43.6532, lon: -79.3832 };
  const landmarks = [{ name: 'A', lat: 43.66, lon: -79.38 }, { name: 'B', lat: 43.65, lon: -79.37 }, { name: 'C', lat: 43.64, lon: -79.39 }].map(l => ({ ...l, bearing: bearing(camera, l) }));
  const result = triangulate(landmarks);
  assert(distance(result.candidate, camera) < 2);
  assert(result.rmsDegrees < .05);
  assert.throws(() => triangulate(landmarks.map(l => ({ ...l, bearing: 90 }))), /parallel/);
  assert.throws(() => triangulate([{ ...landmarks[0], lat: NaN }, landmarks[1]]), /valid coordinates/);
});
