// Only official, fixed provider pages are fetched. Media stays in the provider's player.
const EARTHCAM_STREAMS = 'https://www.youtube.com/@EarthCam/streams';
const NASA_STREAMS = 'https://www.youtube.com/playlist?list=PL2aBZuCeDwlQMf6xMgQAUAY_nbHAgW5jz';
export const LIVE_VIEW_SOURCES = [
  { id: 'live:times-square', name: 'Times Square North', provider: 'EarthCam', group: 'earthcam', match: /Times Square North/i, lat: 40.75634033580675, lon: -73.98645472552745, country: 'United States', sourceURL: 'https://www.earthcam.com/usa/newyork/timessquare/?cam=tsnorth4k', videoId: 'JQ_jwk_7OVE' },
  { id: 'live:abbey-road', name: 'Abbey Road crossing', provider: 'EarthCam', group: 'earthcam', match: /Abbey Road Crossing/i, lat: 51.5321471, lon: -.1779579, country: 'United Kingdom', sourceURL: 'https://www.earthcam.com/world/england/london/abbeyroad/', videoId: 'zMCea32gpmg' },
  { id: 'live:bourbon-street', name: 'Bourbon Street', provider: 'EarthCam', group: 'earthcam', match: /New Orleans Street View/i, lat: 29.95865506836703, lon: -90.0656758993864, country: 'United States', sourceURL: 'https://www.earthcam.com/usa/louisiana/neworleans/bourbonstreet/?cam=bourbonstreet', videoId: 'xqdukYhcGEU' },
  { id: 'earth', name: 'Earth views · HD exterior camera', provider: 'NASA', group: 'nasa', match: /Live High-Definition Views from the International Space Station/i, sourceURL: NASA_STREAMS, videoId: 'awQzjn72bI0', note: 'NASA may show a loop marked “Previously Recorded” when the exterior camera is unavailable.' },
  { id: 'station', name: 'Station views · mission audio', provider: 'NASA', group: 'nasa', match: /^Live Video from the International Space Station/i, sourceURL: NASA_STREAMS, videoId: 'M3HKLzjvKPc', note: 'Includes crew activities, Earth views, and occasional mission audio. Signal handovers can interrupt the picture.' }
];
export const SATELLITE_CLIPS = [
  { id: 'skysat-dubai', name: 'Dubai airport · SkySat', provider: 'Planet', videoId: '2ES8qg5OdC4', status: 'recorded', sourceURL: 'https://www.planet.com/pulse/hi-res-skysat-imagery-available-via-planet-api/', note: 'Recorded satellite video published by Planet in 2017. The public source does not specify this clip’s capture date. This is an example of motion captured from orbit, not a live view of the selected map location.' }
];
const validId = value => typeof value === 'string' && /^[\w-]{11}$/.test(value);
export function parseStreamListings(html) {
  const raw = html.match(/var ytInitialData\s*=\s*(\{.*?\});/s);
  if (!raw) throw new Error('The provider’s current stream listing could not be read.');
  const rows = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const modern = node.lockupViewModel;
    if (modern && validId(modern.contentId)) {
      const title = modern.metadata?.lockupMetadataViewModel?.title?.content;
      const live = JSON.stringify(modern.contentImage?.thumbnailViewModel?.overlays || []).includes('BADGE_STYLE_LIVE');
      if (typeof title === 'string') rows.set(modern.contentId, { videoId: modern.contentId, title, live });
    }
    const classic = node.videoRenderer || node.playlistVideoRenderer;
    if (classic && validId(classic.videoId)) {
      const title = classic.title?.simpleText || classic.title?.runs?.map(run => run.text).join('');
      const live = classic.badges?.some(badge => badge.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW') || classic.thumbnailOverlays?.some(overlay => overlay.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE') || false;
      if (typeof title === 'string') rows.set(classic.videoId, { videoId: classic.videoId, title, live });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(JSON.parse(raw[1]));
  if (!rows.size) throw new Error('The provider’s current stream listing is unavailable.');
  return [...rows.values()];
}
async function readListing(fetchImpl, url) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html', 'User-Agent': 'NorthstarWorkbench/0.2 public-stream-metadata' } });
  if (!response.ok) throw new Error(`Stream provider returned HTTP ${response.status}.`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 8e6) { await reader.cancel(); throw new Error('Stream provider response is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return parseStreamListings(Buffer.concat(chunks).toString());
}
export function createLiveViewsProvider(fetchImpl = fetch, clock = Date.now) {
  const good = new Map(); let cached, pending, nextCheck = 0;
  return async function catalogue(force = false) {
    if (pending) return pending;
    if (cached && !force && clock() < nextCheck) return cached;
    pending = (async () => {
      const groups = await Promise.all(['earthcam', 'nasa'].map(async group => {
        const definitions = LIVE_VIEW_SOURCES.filter(source => source.group === group);
        try {
          const listing = await readListing(fetchImpl, group === 'earthcam' ? EARTHCAM_STREAMS : NASA_STREAMS);
          const checkedAt = new Date(clock()).toISOString();
          const streams = definitions.map(({ match, group: _, ...source }) => {
            const current = listing.find(item => item.live && match.test(item.title));
            return { ...source, videoId: current?.videoId, status: current ? 'live' : 'unavailable', checkedAt, stale: false };
          });
          good.set(group, streams); return streams;
        } catch {
          const previous = good.get(group) || definitions.map(({ match, group: _, ...source }) => source);
          return previous.map(source => ({ ...source, status: 'unknown', stale: true, error: 'Live status could not be checked. Open the provider for its current broadcast.' }));
        }
      }));
      const all = groups.flat(), stale = all.some(stream => stream.stale);
      cached = { cameras: all.filter(stream => stream.id.startsWith('live:')), orbit: all.filter(stream => !stream.id.startsWith('live:')), clips: SATELLITE_CLIPS, stale };
      nextCheck = clock() + (stale ? 60000 : 300000);
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
