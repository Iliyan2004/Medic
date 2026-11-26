// Geo helpers for mapping and ambulance dispatch.
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Road distance ≈ straight line × detour factor (typical 1.3–1.4 for South Asian cities).
export const ROAD_FACTOR = 1.35;

// Average urban speeds (km/h) by vehicle type and traffic period. Motorbike first responders
// (Rescue 1122 reports ~5 min responses) cut through congestion far better than vans.
const SPEEDS = {
  bike: { peak: 28, normal: 35, night: 45 },
  BLS: { peak: 16, normal: 28, night: 45 },
  ALS: { peak: 16, normal: 28, night: 45 },
};

export function trafficPeriod(date = new Date()) {
  // Pakistan Standard Time = UTC+5
  const h = (date.getUTCHours() + 5) % 24;
  if ((h >= 8 && h < 10) || (h >= 13 && h < 15) || (h >= 17 && h < 20)) return 'peak';
  if (h >= 23 || h < 6) return 'night';
  return 'normal';
}

export function etaMinutes(from, to, vehicleType = 'BLS', date = new Date()) {
  const km = haversineKm(from, to) * ROAD_FACTOR;
  const speed = SPEEDS[vehicleType]?.[trafficPeriod(date)] ?? 25;
  return { km: round(km, 2), minutes: round((km / speed) * 60 + 1, 1) }; // +1 min crew turnout
}

export const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

// Move a point a fraction of the way towards a target (used by the fleet simulator).
export function stepTowards(from, to, fraction) {
  return { lat: from.lat + (to.lat - from.lat) * fraction, lng: from.lng + (to.lng - from.lng) * fraction };
}
