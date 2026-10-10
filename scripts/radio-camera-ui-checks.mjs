import assert from 'node:assert/strict';
import { mockStreetTiles, streetTileFixture } from './map-test-fixtures.mjs';

// Synthetic places and cameras, served only to an isolated browser-test context.
export async function radioCameraFixtures(context) {
  const queries = [], held = [];
  const first = { id: 'place:0', name: 'Example Street, Ottawa, Ontario, Canada', lat: 45.4215, lon: -75.6972, span: { lat: .01, lon: .01 } };
  const second = { id: 'place:1', name: 'Example Street, Toronto, Ontario, Canada', lat: 43.6532, lon: -79.3832, span: { lat: .01, lon: .01 } };
  const state = { mode: 'normal', queries, first, second, release: () => held.splice(0).forEach(resolve => resolve()) };
  await context.route('**/api/places?**', async route => {
    queries.push(new URL(route.request().url()).searchParams.get('query'));
    const mode = state.mode;
    if (mode === 'hold') await new Promise(resolve => held.push(resolve));
    try {
      if (mode === 'error') return await route.fulfill({ status: 502, json: { error: 'Controlled place-search outage. Try again.' } });
      await route.fulfill({ json: { results: mode === 'empty' ? [] : mode === 'hold' ? [second] : [first, second], source: 'Synthetic place-search fixture', sourceUrl: 'https://example.org/place-fixture' } });
    } catch { /* An aborted lookup has no response to deliver. */ }
  });
  const cameras = [
    { id: 'near-a', name: 'Synthetic camera A', lat: 45.421, lon: -75.697 },
    { id: 'near-b', name: 'Synthetic camera B', lat: 45.45, lon: -75.7 },
    { id: 'far-ottawa', name: 'Synthetic distant camera', lat: 45.05, lon: -75.7 },
    { id: 'toronto', name: 'Synthetic Toronto camera', lat: 43.6532, lon: -79.3832 }
  ].map(camera => ({ ...camera, provider: 'Synthetic camera fixture', source: 'Synthetic browser test', country: 'Canada', location: 'Synthetic location', kind: 'page', url: `https://example.org/cameras/${camera.id}` }));
  Object.assign(cameras[0], { mediaType: 'snapshot', thumbnail: 'https://example.org/radio-camera.png' });
  await context.route('**/api/cameras', route => route.fulfill({ json: { cameras, sources: [] } }));
  await context.route('**/api/live-views*', route => route.fulfill({ json: { cameras: [], orbit: [], clips: [], stale: false } }));
  await context.route('https://example.org/radio-camera.png*', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
  await context.route('https://services.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
  await mockStreetTiles(context);
  return state;
}

export async function checkRadioCameras(page, panel, fixtures, report) {
  assert.equal(fixtures.queries.length, 0, 'AI analysis never geocodes automatically');
  assert.equal(await panel.getByRole('button', { name: 'Cameras nearby', exact: true }).count(), 1, 'Only location mentions offer cameras');
  await panel.getByRole('button', { name: 'Cameras nearby', exact: true }).click();
  const search = panel.getByRole('region', { name: 'Camera search for Example Street', exact: true });
  const matches = search.locator('.radio-camera-match'); await matches.first().waitFor();
  assert.equal(await matches.count(), 2, 'Ambiguous place matches are presented for review');
  assert.equal(fixtures.queries[0], 'Example Street, Ottawa, Ontario, Canada');
  assert.equal(await search.getByLabel('Radio location search', { exact: true }).inputValue(), fixtures.queries[0]);
  const destination = new URLSearchParams((await matches.first().getAttribute('href')).split('?')[1]);
  assert.equal(destination.get('lat'), '45.42150'); assert.equal(destination.get('lon'), '-75.69720'); assert.equal(destination.get('radius'), '10'); assert.equal(destination.get('place'), fixtures.first.name);
  assert((await matches.first().getAttribute('href')).startsWith('#satellite?'));
  await search.getByLabel('Radio nearby camera radius', { exact: true }).selectOption('25');
  assert.equal(new URLSearchParams((await matches.first().getAttribute('href')).split('?')[1]).get('radius'), '25'); assert.equal(fixtures.queries.length, 1);
  await search.getByLabel('Radio nearby camera radius', { exact: true }).selectOption('10');
  const satelliteOpening = page.waitForEvent('popup'); await matches.first().click(); const satellite = await satelliteOpening;
  await satellite.getByRole('heading', { name: 'Satellite views', exact: true }).waitFor();
  await satellite.getByLabel('Selected street camera', { exact: true }).getByRole('heading', { name: 'Synthetic camera A', exact: true }).waitFor();
  await satellite.waitForFunction(() => document.querySelector('.camera-preview-image img')?.naturalWidth > 0);
  assert(satellite.url().includes('#satellite?lat=45.42150&lon=-75.69720&radius=10'));
  assert.equal(await satellite.locator('.satellite-selected-place strong').textContent(), fixtures.first.name);
  assert.equal(await satellite.getByLabel('Nearby satellite cameras radius', { exact: true }).inputValue(), '10');
  assert.deepEqual(await satellite.getByLabel('Choose nearby satellite camera', { exact: true }).locator('option:not([value=""])').evaluateAll(options => options.map(option => option.value)), ['near-a', 'near-b']);
  assert((await satellite.locator('.satellite-camera-player .camera-preview-image').boundingBox()).width >= 580, 'Satellite cameras use the larger player');
  await satellite.getByLabel('Choose nearby satellite camera', { exact: true }).selectOption('near-b');
  assert.equal(await satellite.locator('.satellite-selected-place strong').textContent(), fixtures.first.name, 'Switching a nearby camera retains the radio location and distance origin');
  await satellite.getByLabel('Choose nearby satellite camera', { exact: true }).selectOption('near-a');
  await satellite.getByLabel('Nearby satellite cameras radius', { exact: true }).selectOption('50');
  assert.equal(await satellite.getByLabel('Choose nearby satellite camera', { exact: true }).locator('option:not([value=""])').count(), 3);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await satellite.setViewportSize({ width, height: 1000 });
    assert.equal(await satellite.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Satellite camera link fits ${width}px`);
  }
  await satellite.locator('#satellite-cameras').screenshot({ path: 'artifacts/radio-satellite-cameras-mobile.png', animations: 'disabled' });
  await satellite.setViewportSize({ width: 1440, height: 1000 });
  await satellite.locator('#satellite-cameras').screenshot({ path: 'artifacts/radio-satellite-cameras-desktop.png', animations: 'disabled' });
  await satellite.evaluate(() => { location.hash = '#satellite?lat=43.65320&lon=-79.38320&radius=25&place=Toronto&cameras=1'; });
  await satellite.getByLabel('Selected street camera', { exact: true }).getByRole('heading', { name: 'Synthetic Toronto camera', exact: true }).waitFor();
  assert.equal(await satellite.getByLabel('Nearby satellite cameras radius', { exact: true }).inputValue(), '25');
  assert.equal(await satellite.locator('.satellite-selected-place strong').textContent(), 'Toronto');
  await satellite.evaluate(() => { location.hash = '#satellite?lat=0&lon=0&radius=10&place=Empty+test+area&cameras=1'; });
  await satellite.getByText('No matching cameras within 10 km. Increase the radius, choose another view type, or try a featured live street.', { exact: true }).waitFor();
  assert.equal(await satellite.getByLabel('Selected street camera', { exact: true }).count(), 0, 'An area without cameras never retains an unrelated camera player');
  await satellite.close();
  const opening = page.waitForEvent('popup'); await search.locator('.radio-camera-directory-link').first().click(); const cameras = await opening;
  await cameras.locator('.nearby-banner').getByText(/Within/).waitFor();
  await cameras.waitForFunction(() => document.querySelector('.feed-indicator strong')?.textContent === '2 camera locations');
  assert(cameras.url().endsWith('#camera?lat=45.42150&lon=-75.69720&radius=10'));
  assert.deepEqual(await cameras.locator('#camera-selection option:not([value=""])').evaluateAll(options => options.map(option => option.value)), ['near-a', 'near-b']);
  assert.equal(await cameras.getByLabel('Nearby camera radius', { exact: true }).inputValue(), '10');
  await cameras.getByLabel('Nearby camera radius', { exact: true }).selectOption('50');
  await cameras.waitForFunction(() => document.querySelector('.feed-indicator strong')?.textContent === '3 camera locations');
  assert(page.url().endsWith('#skywave')); assert.equal(await panel.locator('.radio-transcript-entry').count(), 1);
  await cameras.close();
  assert.equal(await panel.getByRole('button', { name: 'Show supporting clip', exact: true }).count(), 2);
  report.checks.push('Quoted radio locations open the larger Satellite camera player or Camera Globe; both preserve coordinates and radius, Satellite retains the location while switching nearby cameras, and radio analysis stays in its tab');

  await search.getByLabel('Radio location search', { exact: true }).fill('Corrected intersection, Gatineau, Quebec');
  assert.equal(await matches.count(), 0, 'Editing an address clears outdated matches');
  fixtures.mode = 'empty'; await search.getByRole('button', { name: 'Find place', exact: true }).click();
  await search.getByRole('status').getByText(/No places found/).waitFor(); assert.equal(await matches.count(), 0);
  fixtures.mode = 'error'; await search.getByRole('button', { name: 'Find place', exact: true }).click();
  await search.getByRole('alert').getByText(/Controlled place-search outage/).waitFor();
  fixtures.mode = 'hold'; const waiting = page.waitForRequest('**/api/places?**'); await search.getByRole('button', { name: 'Find place', exact: true }).click(); await waiting;
  await search.getByLabel('Radio location search', { exact: true }).fill('Example Street, Ottawa');
  fixtures.mode = 'normal'; await search.getByRole('button', { name: 'Find place', exact: true }).click(); await matches.first().waitFor();
  fixtures.release();
  assert.equal(await matches.count(), 2, 'An aborted stale response cannot replace the corrected search');
  assert.equal(fixtures.queries.at(-1), 'Example Street, Ottawa');
  await search.getByRole('button', { name: 'Close camera search', exact: true }).click(); assert.equal(await search.count(), 0);
  await panel.getByRole('button', { name: 'Cameras nearby', exact: true }).click(); await matches.first().waitFor();
  report.checks.push('Location corrections, ambiguous matches, empty results, provider outages, retry, stale-request cancellation, and close/reopen work without fabricating camera locations');
}
