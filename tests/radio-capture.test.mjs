import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRadioWav, keywordMatches, audioBase64 } from '../src/lib/radio-capture.ts';
import { inspectRadioWav } from '../server/radio-analysis.mjs';

test('captured PCM is resampled into independently playable 16 kHz clips and keywords match quoted text', async () => {
  const samples = Float32Array.from({ length: 48000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 500 / 48000));
  const blob = encodeRadioWav(samples, 48000), bytes = Buffer.from(await audioBase64(blob), 'base64');
  assert.equal(blob.type, 'audio/wav'); assert.equal(inspectRadioWav(bytes).duration, 1); assert.equal(bytes.length, 32044);
  assert.deepEqual(keywordMatches('Ambulance seven near Highway 417.', ' ambulance, HIGHWAY 417, ambulance, collision '), ['ambulance', 'HIGHWAY 417']);
});
