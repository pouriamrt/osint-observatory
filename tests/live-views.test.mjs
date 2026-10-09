import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveViewsProvider, LIVE_VIEW_SOURCES, parseStreamListings, SATELLITE_CLIPS } from '../server/live-views.mjs';

function listing(group, live = true, replace = '') {
  return `var ytInitialData = ${JSON.stringify({ contents: LIVE_VIEW_SOURCES.filter(view => view.group === group).map(view => ({ lockupViewModel: { contentId: replace && view.id === 'earth' ? replace : view.videoId, metadata: { lockupMetadataViewModel: { title: { content: ({ 'live:times-square': 'EarthCam Live: Times Square North 4K', 'live:abbey-road': 'EarthCam Live: Abbey Road Crossing (London, England)', 'live:bourbon-street': 'EarthCam Live: New Orleans Street View', earth: 'Live High-Definition Views from the International Space Station (Official NASA Stream)', station: 'Live Video from the International Space Station (Official NASA Stream)' })[view.id] } } }, contentImage: { thumbnailViewModel: { overlays: live ? [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' } }] } }] : [] } } } })) })};`;
}
test('official listing parsers distinguish live badges from titles and ignore invalid video IDs', () => {
  assert.equal(parseStreamListings(listing('earthcam')).filter(view => view.live).length, 3);
  assert(parseStreamListings(listing('nasa', false)).every(view => !view.live), 'A title saying Live does not make a recording live');
  const classic = { contents: [
    { videoRenderer: { videoId: 'JQ_jwk_7OVE', title: { runs: [{ text: 'Live camera' }] }, thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] } },
    { playlistVideoRenderer: { videoId: 'awQzjn72bI0', title: { simpleText: 'Live NASA' }, badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] } },
    { videoRenderer: { videoId: 'not/a/video/id', title: { simpleText: 'Untrusted ID' } } }
  ] };
  const parsed = parseStreamListings(`var ytInitialData = ${JSON.stringify(classic)};`);
  assert.equal(parsed.length, 2); assert(parsed.every(view => view.live));
  assert.throws(() => parseStreamListings('Unexpected response'), /could not be read/);
});
test('stream replacement, shared refresh, and metadata caching use only fixed official listings', async () => {
  let requests = 0, release, replacement = '', clock = Date.parse('2026-10-09T22:00:00Z');
  const provider = createLiveViewsProvider(async url => {
    assert(['https://www.youtube.com/@EarthCam/streams', 'https://www.youtube.com/playlist?list=PL2aBZuCeDwlQMf6xMgQAUAY_nbHAgW5jz'].includes(url));
    requests++; if (requests === 1) await new Promise(resolve => { release = resolve; });
    return new Response(listing(url.includes('EarthCam') ? 'earthcam' : 'nasa', true, replacement));
  }, () => clock);
  const one = provider(), two = provider(true); release();
  const initial = await one; assert.deepEqual(await two, initial); assert.equal(requests, 2);
  assert.equal(initial.cameras[0].status, 'live'); assert.equal(initial.orbit[0].videoId, 'awQzjn72bI0');
  await provider(); assert.equal(requests, 2);
  replacement = 'replacement'; clock += 300001;
  const changed = await provider(); assert.equal(requests, 4); assert.equal(changed.orbit[0].videoId, 'replacement');
  assert.notEqual(changed.orbit[0].checkedAt, initial.orbit[0].checkedAt);
});
test('partial outages keep the last link without asserting a stale broadcast is live, then recover', async () => {
  let failNASA = false, clock = Date.parse('2026-10-09T22:00:00Z'), requests = 0;
  const provider = createLiveViewsProvider(async url => {
    requests++; if (failNASA && !url.includes('EarthCam')) throw new Error('Fixture outage');
    return new Response(listing(url.includes('EarthCam') ? 'earthcam' : 'nasa'));
  }, () => clock);
  const initial = await provider(); failNASA = true; clock += 300001;
  const failed = await provider(); assert.equal(failed.stale, true);
  assert.equal(failed.cameras[0].status, 'live'); assert.equal(failed.orbit[0].status, 'unknown');
  assert.equal(failed.orbit[0].videoId, initial.orbit[0].videoId); assert.equal(failed.orbit[0].checkedAt, initial.orbit[0].checkedAt);
  await provider(); assert.equal(requests, 4, 'Retry cooldown avoids fetching every render');
  failNASA = false; const recovered = await provider(true); assert.equal(recovered.stale, false); assert.equal(recovered.orbit[0].status, 'live');
});
test('ended streams do not reuse obsolete video IDs and recordings never receive a live status', async () => {
  const provider = createLiveViewsProvider(async url => new Response(listing(url.includes('EarthCam') ? 'earthcam' : 'nasa', false)));
  const catalogue = await provider();
  assert([...catalogue.cameras, ...catalogue.orbit].every(view => view.status === 'unavailable' && !view.videoId));
  assert.equal(catalogue.clips[0].status, 'recorded'); assert.deepEqual(catalogue.clips, SATELLITE_CLIPS);
  const offline = await createLiveViewsProvider(async () => { throw new Error('Offline'); })();
  assert([...offline.cameras, ...offline.orbit].every(view => view.status === 'unknown' && !view.checkedAt && view.stale));
});
