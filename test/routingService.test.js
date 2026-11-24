const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ORS_API_KEY;

const { haversineDistance, estimateTransitTime } = require('../src/services/routingService');

const mumbai = { latitude: 19.076, longitude: 72.8777 };
const pune = { latitude: 18.5204, longitude: 73.8567 };

test('haversine distance matches the known Mumbai–Pune gap', () => {
  const km = haversineDistance(mumbai, pune);
  assert.ok(km > 115 && km < 125, `expected ~120km, got ${km}`);
});

test('haversine distance of a point to itself is zero', () => {
  assert.equal(haversineDistance(mumbai, mumbai), 0);
});

test('transit estimate falls back to road distance and ambulance speed', async () => {
  const estimate = await estimateTransitTime(mumbai, pune);
  assert.equal(estimate.source, 'haversine_estimate');
  assert.equal(estimate.route, null);
  // ~120km straight line × 1.3 road factor / 60km/h ≈ 156 minutes
  assert.ok(estimate.minutes >= 150 && estimate.minutes <= 160, `unexpected minutes ${estimate.minutes}`);
  assert.ok(estimate.distanceKm >= 150 && estimate.distanceKm <= 160, `unexpected distance ${estimate.distanceKm}`);
});

test('transit estimate never drops below one minute', async () => {
  const estimate = await estimateTransitTime(mumbai, { ...mumbai, latitude: 19.0761 });
  assert.equal(estimate.minutes, 1);
});
