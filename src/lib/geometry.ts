export type Landmark = { name: string; lat: number; lon: number; bearing: number };
const rad = (n: number) => n * Math.PI / 180, deg = (n: number) => n * 180 / Math.PI;
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const l1 = rad(a.lat), l2 = rad(b.lat), d = rad(b.lon - a.lon);
  return (deg(Math.atan2(Math.sin(d) * Math.cos(l2), Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(d))) + 360) % 360;
}
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
export function triangulate(landmarks: Landmark[]) {
  if (landmarks.length < 2) throw new Error('Add at least two known landmarks with measured compass bearings.');
  if (landmarks.some(l => !Number.isFinite(l.lat) || !Number.isFinite(l.lon) || !Number.isFinite(l.bearing) || Math.abs(l.lat) >= 85 || Math.abs(l.lon) > 180 || l.bearing < 0 || l.bearing >= 360)) throw new Error('Use valid coordinates below 85° latitude and bearings from 0° to 359.999°.');
  const ref = { lat: landmarks.reduce((a, l) => a + l.lat, 0) / landmarks.length, lon: landmarks.reduce((a, l) => a + l.lon, 0) / landmarks.length };
  if (landmarks.some(l => distance(ref, l) > 50000)) throw new Error('Keep landmarks within 50 km of their center for this local-plane calculation.');
  const scale = Math.cos(rad(ref.lat)), R = 6371000;
  let a = 0, b = 0, c = 0, d = 0, e = 0;
  for (const l of landmarks) { const nx = Math.cos(rad(l.bearing)), ny = -Math.sin(rad(l.bearing)); const x = R * rad(l.lon - ref.lon) * scale, y = R * rad(l.lat - ref.lat), k = nx * x + ny * y; a += nx * nx; b += nx * ny; c += ny * ny; d += nx * k; e += ny * k; }
  const det = a * c - b * b;
  if (det / (a + c) ** 2 < 0.002) throw new Error('Bearings are too close to parallel. Add a landmark in a different direction.');
  const x = (d * c - b * e) / det, y = (a * e - b * d) / det;
  const candidate = { lat: ref.lat + deg(y / R), lon: ref.lon + deg(x / (R * scale)) };
  if (distance(ref, candidate) > 50000) throw new Error('The intersection is outside the 50 km calculation area.');
  const checks = landmarks.map(l => { const predicted = bearing(candidate, l), residual = ((predicted - l.bearing + 540) % 360) - 180; return { ...l, predicted, residual, distanceM: distance(candidate, l) }; });
  return { candidate, checks, rmsDegrees: Math.sqrt(checks.reduce((s, c) => s + c.residual ** 2, 0) / checks.length), caveat: 'A geometric hypothesis from user-supplied compass bearings. Two lines always intersect; add independent landmarks to test the hypothesis. This does not verify image content or authenticity.' };
}
