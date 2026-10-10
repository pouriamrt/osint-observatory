import test from 'node:test';
import assert from 'node:assert/strict';
import { OTTAWA_RADIO_FEEDS, parseAudioSource } from '../src/lib/radio-audio.ts';

test('audio sources validate protocols, credentials, provider pages, and playlist types before playback', () => {
  assert.deepEqual(parseAudioSource(' https://example.org/live.mp3 ', ' Test receiver '), { url: 'https://example.org/live.mp3', kind: 'audio', name: 'Test receiver' });
  assert.equal(parseAudioSource('http://127.0.0.1:8000/live').kind, 'audio', 'An owned local receiver can supply audio');
  assert.equal(parseAudioSource('https://example.org/live.m3u8?key=example').kind, 'hls');
  assert.equal(parseAudioSource('https://example.org/stream', '', 'hls').kind, 'hls');
  assert.equal(parseAudioSource('https://example.org/live.m3u8', '', 'audio').kind, 'audio', 'An explicit audio-type choice overrides auto detection');
  for (const value of ['javascript:alert(1)', 'file:///C:/test.wav', 'data:audio/wav;base64,AA', 'https://name:password@example.org/audio.mp3']) assert.throws(() => parseAudioSource(value), /HTTP or HTTPS/);
  assert.throws(() => parseAudioSource('not a URL'), /complete audio URL/);
  assert.throws(() => parseAudioSource('https://www.broadcastify.com/listen/feed/37900'), /Listen on Broadcastify/);
  assert.throws(() => parseAudioSource('https://audio.broadcastify.com/37900'), /Listen on Broadcastify/);
  assert.throws(() => parseAudioSource('https://example.org/radio.pls'), /direct audio stream/);
  assert.throws(() => parseAudioSource('x'.repeat(2049)), /2,048/);
});

test('Ottawa links identify the Ontario location, service, and official listening destination', () => {
  assert.equal(OTTAWA_RADIO_FEEDS[0].name, 'EMS & OPP (Ottawa & Region)');
  assert.equal(OTTAWA_RADIO_FEEDS[0].url, 'https://www.broadcastify.com/listen/feed/37900');
  assert.match(OTTAWA_RADIO_FEEDS[0].description, /does not advertise Ottawa Police Service dispatch/);
  assert(OTTAWA_RADIO_FEEDS.every(feed => new URL(feed.url).hostname === 'www.broadcastify.com'));
  assert.equal(new Set(OTTAWA_RADIO_FEEDS.map(feed => feed.id)).size, 3);
});
