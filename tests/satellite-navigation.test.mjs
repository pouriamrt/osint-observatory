import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbySatelliteRoute, satelliteLocationFromRoute } from '../src/lib/satellite.ts';

test('satellite camera links preserve the place and radius with an area sized to show nearby cameras', () => {
  const route = nearbySatelliteRoute(45.4215, -75.6972, 50, 'Bank St & Gladstone Ave, Ottawa');
  const destination = satelliteLocationFromRoute(route);
  assert.deepEqual({ lat: destination.place.lat, lon: destination.place.lon, name: destination.place.name, radius: destination.radius, showCameras: destination.showCameras }, { lat: 45.4215, lon: -75.6972, name: 'Bank St & Gladstone Ave, Ottawa', radius: 50, showCameras: true });
  assert(destination.place.span.lat > .8 && destination.place.span.lat < 1);
  assert(destination.place.span.lon > destination.place.span.lat);
  const zero = satelliteLocationFromRoute('#satellite?lat=0&lon=0');
  assert.equal(zero.radius, 25); assert.equal(zero.showCameras, false); assert.equal(zero.place.name, '0.00000, 0.00000');
});

test('invalid satellite navigation never creates a location, and unsupported radii use the existing default', () => {
  for (const route of ['#satellite', '#camera?lat=45&lon=-75', '#satellite?lat=&lon=10', '#satellite?lat=45', '#satellite?lat=NaN&lon=-75', '#satellite?lat=90&lon=10', '#satellite?lat=45&lon=181']) assert.equal(satelliteLocationFromRoute(route), null, route);
  assert.equal(satelliteLocationFromRoute('#satellite?lat=45&lon=-75&radius=Infinity').radius, 25);
  assert.equal(satelliteLocationFromRoute('#satellite?lat=45&lon=-75&radius=10000000').radius, 25);
});
