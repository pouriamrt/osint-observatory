import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadioAnalysis, inspectRadioWav } from '../server/radio-analysis.mjs';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/core.mjs';

function wav(amplitude = .15, seconds = 1) {
  const bytes = Buffer.alloc(44 + seconds * 32000);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < seconds * 16000; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * amplitude * 32767), 44 + i * 2);
  return bytes;
}
const clip = { audio: wav().toString('base64'), source: 'Synthetic radio test', startedAt: '2026-10-10T02:00:00Z', authorized: true };

test('radio WAV parsing enforces duration/encoding, measures audio level, and rejects truncated clips', () => {
  const metrics = inspectRadioWav(wav()); assert.equal(metrics.duration, 1); assert(metrics.rmsDbfs < -18 && metrics.rmsDbfs > -22); assert.equal(metrics.clippedPercent, 0);
  assert.throws(() => inspectRadioWav(Buffer.from('not audio')), /PCM WAV/);
  assert.throws(() => inspectRadioWav(wav().subarray(0, 50)), /truncated/);
  const stereo = wav(); stereo.writeUInt16LE(2, 22); assert.throws(() => inspectRadioWav(stereo), /mono/);
  assert.throws(() => inspectRadioWav(wav(.1, 61)), /60 seconds/);
});

test('transcription skips silence and sends only validated authorized audio to the fixed API endpoint', async () => {
  const requests = [];
  const provider = createRadioAnalysis({ apiKey: 'synthetic-api-key', fetchImpl: async (url, options) => {
    requests.push({ url, options }); assert.equal(options.body.get('model'), 'gpt-4o-transcribe-diarize'); assert.equal(options.body.get('response_format'), 'diarized_json');
    assert.equal(options.body.get('file').type, 'audio/wav');
    return Response.json({ text: 'Synthetic unit seven, test only.', segments: [{ text: 'Synthetic unit seven, test only.', start: 0, end: 1, speaker: 'A' }, { text: 'Invalid timestamp', start: -4, end: 8, speaker: 'B' }] });
  } });
  assert.deepEqual(Object.keys(provider.status()).sort(), ['configured', 'maxClipSeconds', 'provider', 'summaryModel', 'transcribeModel'].sort(), 'Configuration never exposes credentials');
  await assert.rejects(provider.transcribe({ ...clip, authorized: false })); assert.equal(requests.length, 0);
  await assert.rejects(provider.transcribe({ ...clip, audio: 'https://www.broadcastify.com/private-audio' })); assert.equal(requests.length, 0, 'No arbitrary URL fetch');
  assert((await provider.transcribe({ ...clip, audio: wav(0).toString('base64') })).skipped); assert.equal(requests.length, 0);
  const result = await provider.transcribe(clip); assert.equal(result.text, 'Synthetic unit seven, test only.'); assert.equal(result.segments.length, 1); assert.equal(requests[0].url, 'https://api.openai.com/v1/audio/transcriptions'); assert.equal(result.source, clip.source);
  const unavailable = createRadioAnalysis({ apiKey: '', fetchImpl: () => { throw Error('Must not call a provider without a key'); } }); await assert.rejects(unavailable.transcribe(clip), /not configured/);
});

test('AI summaries validate exact transcript citations and never expose upstream errors or store responses', async () => {
  const provider = createRadioAnalysis({ apiKey: 'synthetic-api-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.match(body.instructions, /untrusted quoted data/);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ summary: 'A simulated response was requested.', mentions: [{ kind: 'unit', text: 'Unit seven', quote: 'Unit seven', entryId: 'fixture:1' }, { kind: 'location', text: 'Invented address', quote: 'Never said this', entryId: 'fixture:1' }], uncertainties: [] }) }] }] });
  } });
  const input = { entries: [{ id: 'fixture:1', text: 'Unit seven, this is a synthetic test.', startedAt: clip.startedAt, duration: 1 }], authorized: true };
  const result = await provider.summarize(input); assert.equal(result.mentions.length, 1); assert.match(result.uncertainties[0], /could not be matched/); assert.deepEqual(result.entryIds, ['fixture:1']);
  const failure = createRadioAnalysis({ apiKey: 'synthetic-api-key', fetchImpl: async () => Response.json({ error: { message: 'Private upstream payload and credential detail' } }, { status: 401 }) });
  await assert.rejects(failure.transcribe(clip), error => /permissions/.test(error.message) && !/Private|credential detail/.test(error.message));
});

test('radio endpoints preserve local access controls, abort provider requests on disconnect, and never create evidence automatically', async () => {
  const store = openStore(':memory:'); let aborted = false;
  const radioAnalysis = { status: () => ({ configured: true }), transcribe: (body, signal) => new Promise(resolve => { signal.addEventListener('abort', () => { aborted = true; resolve({ cancelled: true }); }, { once: true }); }), summarize: async () => ({ summary: 'Synthetic API result' }) };
  const { app } = createApp({ store, radioAnalysis }), server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/radio/analysis-status')).status, 200);
    assert.equal((await fetch(base + '/api/radio/analysis-status', { headers: { Origin: 'https://external.example' } })).status, 403);
    const controller = new AbortController(); const request = fetch(base + '/api/radio/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clip), signal: controller.signal }).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 50)); controller.abort(); await request;
    for (let i = 0; i < 20 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert(aborted); assert.equal(store.evidence().length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); store.db.close(); }
});
