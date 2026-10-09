import { LIVE_VIEW_SOURCES, SATELLITE_CLIPS } from '../server/live-views.mjs';
export const liveViewFixture = {
  cameras: LIVE_VIEW_SOURCES.filter(view => view.group === 'earthcam').map(({ group, match, ...view }) => ({ ...view, status: 'live', checkedAt: '2026-10-09T22:00:00Z', stale: false })),
  orbit: LIVE_VIEW_SOURCES.filter(view => view.group === 'nasa').map(({ group, match, ...view }) => ({ ...view, status: 'live', checkedAt: '2026-10-09T22:00:00Z', stale: false })),
  clips: SATELLITE_CLIPS, stale: false
};
