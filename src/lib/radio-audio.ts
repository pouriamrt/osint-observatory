export type AudioSource = { url: string; kind: 'audio' | 'hls'; name: string };

// These are curated links to the provider's own player, not mirrored streams or a scraped catalogue.
export const OTTAWA_RADIO_FEEDS = [
  { id: 'ottawa-opp-ems', name: 'EMS & OPP (Ottawa & Region)', category: 'Police & EMS', url: 'https://www.broadcastify.com/listen/feed/37900', description: 'Ontario Provincial Police and EMS around Ottawa. This listing does not advertise Ottawa Police Service dispatch.' },
  { id: 'ottawa-amateur', name: 'VE3OCE Repeater VHF and UHF', category: 'Amateur radio', url: 'https://www.broadcastify.com/listen/feed/47504', description: 'Public amateur-radio repeater audio in Ottawa.' },
  { id: 'ottawa-airports', name: 'Arnprior, Carp and Rockcliffe Airport CTAF', category: 'Aviation', url: 'https://www.broadcastify.com/listen/feed/47740', description: 'Aircraft traffic-advisory communications for these Ottawa-area airports.' }
];

export function parseAudioSource(value: string, name = '', format = 'auto'): AudioSource {
  const input = value.trim();
  if (!input || input.length > 2048) throw new Error('Enter an audio stream URL, up to 2,048 characters.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter a complete audio URL beginning with https:// or http://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS audio URL without a username or password in it.');
  if (url.hostname === 'broadcastify.com' || url.hostname.endsWith('.broadcastify.com')) throw new Error('Use Listen on Broadcastify for that feed. Its audio plays in the provider\'s own player.');
  if (/\.(?:m3u|pls)$/i.test(url.pathname)) throw new Error('Use a direct audio stream URL or an HLS .m3u8 playlist, rather than an M3U or PLS file.');
  return { url: url.href, kind: format === 'hls' || format === 'auto' && /\.m3u8$/i.test(url.pathname) ? 'hls' : 'audio', name: name.trim().slice(0, 100) || 'Your audio stream' };
}
