import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRadioFrequencies, OTTAWA_FREQUENCIES } from '../src/lib/radio-frequencies.ts';

test('frequency search combines service, online access, location, callsign, and MHz without changing source records', () => {
  assert.equal(filterRadioFrequencies(OTTAWA_FREQUENCIES).length, 6, 'No-receiver users start with online audio links');
  assert.deepEqual(filterRadioFrequencies(OTTAWA_FREQUENCIES, '122.800').map(row => row.id), ['carp-ctaf']);
  assert.deepEqual(filterRadioFrequencies(OTTAWA_FREQUENCIES, 'ottawa VE3OCE').map(row => row.id), ['ve3oce-vhf', 've3oce-uhf']);
  assert.equal(filterRadioFrequencies(OTTAWA_FREQUENCIES, '', 'Aviation').length, 3);
  assert.equal(filterRadioFrequencies(OTTAWA_FREQUENCIES, 'VE2CRA').length, 0);
  assert.equal(filterRadioFrequencies(OTTAWA_FREQUENCIES, 've2cra', 'Amateur radio', 'all').length, 2);
  assert.equal(filterRadioFrequencies(OTTAWA_FREQUENCIES, 'anything missing').length, 0);
  assert.equal(OTTAWA_FREQUENCIES.length, 8, 'Filters leave the directory intact');
});

test('shared feeds retain their coverage limits and receiver-only frequencies never get a fabricated listening link', () => {
  const airports = OTTAWA_FREQUENCIES.filter(row => row.category === 'Aviation');
  assert.deepEqual(airports.map(row => row.mhz), [122.7, 122.8, 123.5]);
  assert(airports.every(row => row.listening.url === 'https://www.broadcastify.com/listen/feed/47740' && /individual channels cannot be selected/.test(row.listening.coverage)));
  const amateur = OTTAWA_FREQUENCIES.filter(row => row.id.startsWith('ve3oce'));
  assert.deepEqual(amateur.map(row => row.mhz), [146.88, 443.8]);
  assert(amateur.every(row => row.listening.url.endsWith('/47504')));
  const localOnly = OTTAWA_FREQUENCIES.filter(row => row.listening === null);
  assert.deepEqual(localOnly.map(row => row.mhz), [146.94, 443.3], 'Receive frequencies, rather than repeater inputs');
  assert(localOnly.every(row => /needs a receiver/.test(row.note)));
  assert(OTTAWA_FREQUENCIES.every(row => row.mhz > 0 && row.checkedOn && new URL(row.source.url).protocol === 'https:'));
});
