// Health geography: disease burden, facility access and medicine supply, aggregated by city.
// Privacy: only aggregates leave the server; counts of 1–4 are shown as "<5" (small-cell suppression),
// and no individual locations are ever returned.
import { haversineKm } from './geo.js';
import { CITIES, CITY } from './places.js';

// Priority communicable diseases for Pakistan (IDSR priority list). ICD-10 prefixes link insurance-claim signals.
export const DISEASES = [
  { code: 'dengue', name: 'Dengue', icd: ['A90', 'A91', 'A97'] },
  { code: 'malaria', name: 'Malaria', icd: ['B50', 'B51', 'B52', 'B53', 'B54'] },
  { code: 'typhoid', name: 'Typhoid (incl. XDR)', icd: ['A01'] },
  { code: 'diarrhoea', name: 'Acute diarrhoea', icd: ['A09', 'A08', 'A04'] },
  { code: 'cholera', name: 'Cholera', icd: ['A00'] },
  { code: 'measles', name: 'Measles', icd: ['B05'] },
  { code: 'hepatitis', name: 'Viral hepatitis', icd: ['B15', 'B16', 'B17', 'B18', 'B19'] },
  { code: 'tb', name: 'Tuberculosis', icd: ['A15', 'A16', 'A17', 'A18', 'A19'] },
  { code: 'ili', name: 'Influenza-like illness', icd: ['J09', 'J10', 'J11'] },
];
export const DISEASE = Object.fromEntries(DISEASES.map((d) => [d.code, d]));
export const SUPPRESS_BELOW = 5;
export const suppress = (n) => (n > 0 && n < SUPPRESS_BELOW ? '<5' : n);

/** Monday of the week containing `d` (UTC date), YYYY-MM-DD. */
export function weekStart(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
export const addWeeks = (ws, n) => { const x = new Date(`${ws}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 7 * n); return x.toISOString().slice(0, 10); };

/**
 * Early warning: the latest week is "rising" when it is ≥ 5 cases and above the mean of the previous 4 weeks
 * plus 2 standard deviations (a common surveillance threshold); "watch" above mean + 1 SD.
 * The SD is never taken as smaller than √mean — the natural (Poisson) noise in case counts — so a quiet
 * baseline doesn't turn ordinary week-to-week wobble into an alert.
 */
export function alertLevel(series) {
  if (series.length < 5) return 'ok';
  const cur = series[series.length - 1];
  const base = series.slice(-5, -1);
  const mean = base.reduce((s, x) => s + x, 0) / base.length;
  const sd = Math.max(Math.sqrt(base.reduce((s, x) => s + (x - mean) ** 2, 0) / base.length), Math.sqrt(mean), 1);
  if (cur >= SUPPRESS_BELOW && cur > mean + 2 * sd) return 'rising';
  if (cur >= SUPPRESS_BELOW && cur > mean + sd) return 'watch';
  return 'ok';
}

/** Weekly cases by city for one disease: facility reports + de-identified insurance-claim signals. */
export function diseaseByCity(h, code, weeks = 8, now = new Date()) {
  const d = DISEASE[code];
  if (!d) return null;
  const last = weekStart(now);
  const first = addWeeks(last, -(weeks - 1));
  const axis = Array.from({ length: weeks }, (_, i) => addWeeks(first, i));
  const byCity = {};
  const add = (city, ws, n) => {
    if (!CITY[city] || !axis.includes(ws)) return;
    const c = (byCity[city] ||= { city, series: Object.fromEntries(axis.map((w) => [w, 0])), sources: new Set() });
    c.series[ws] += n;
  };
  for (const r of h.all(`SELECT f.city, r.week_start, SUM(r.cases) AS n, MIN(r.source) AS src FROM disease_reports r JOIN facilities f ON f.id = r.facility_id
      WHERE r.disease = ? AND r.week_start BETWEEN ? AND ? GROUP BY f.city, r.week_start`, code, first, last)) {
    add(r.city, r.week_start, r.n);
    if (byCity[r.city]) byCity[r.city].sources.add(r.src === 'demo' ? 'demo reports' : 'facility reports');
  }
  // Insurance claims with a matching ICD-10 code, placed by the treating facility's city.
  const like = d.icd.map(() => 'c.icd10 LIKE ?').join(' OR ');
  for (const c of h.all(`SELECT f.city, c.created_at FROM claims c JOIN facilities f ON f.id = c.facility_id
      WHERE (${like}) AND c.created_at >= ?`, ...d.icd.map((p) => `${p}%`), first)) {
    add(c.city, weekStart(new Date(c.created_at.replace(' ', 'T') + 'Z')), 1);
    if (byCity[c.city]) byCity[c.city].sources.add('insurance claims');
  }
  const rows = Object.values(byCity).map((c) => {
    const series = axis.map((w) => c.series[w]);
    const total = series.reduce((s, x) => s + x, 0);
    return { city: c.city, lat: CITY[c.city].lat, lng: CITY[c.city].lng, province: CITY[c.city].province,
      this_week: suppress(series.at(-1)), total: suppress(total), total_n: total,
      trend: series.map((x) => (x > 0 && x < SUPPRESS_BELOW ? null : x)), // suppressed weeks are gaps
      alert: alertLevel(series), sources: [...c.sources] };
  }).filter((c) => c.total_n > 0).sort((a, b) => b.total_n - a.total_n);
  return { disease: d, weeks: axis, cities: rows.map(({ total_n, ...r }) => r), rising: rows.filter((r) => r.alert === 'rising').map((r) => r.city) };
}

/** Facility access per city, from every facility we know (verified + OpenStreetMap). */
export function accessByCity(h) {
  const fac = h.all(`SELECT lat, lng, type, emergency, verified FROM facilities WHERE type != 'camp'`);
  const nearest = (c, pred) => { let d = Infinity; for (const f of fac) if (pred(f)) { const k = haversineKm(c, f); if (k < d) d = k; } return d === Infinity ? null : +d.toFixed(1); };
  const within = (c, km, pred) => fac.reduce((n, f) => n + (pred(f) && haversineKm(c, f) <= km ? 1 : 0), 0);
  const hosp = (f) => f.type === 'hospital';
  const cities = CITIES.map(([city, lat, lng, province]) => {
    const c = { lat, lng };
    const row = {
      city, province, lat, lng,
      facilities_10km: within(c, 10, () => true),
      hospitals_10km: within(c, 10, hosp), clinics_10km: within(c, 10, (f) => ['clinic', 'bhu', 'rhc'].includes(f.type)),
      nearest_hospital_km: nearest(c, hosp), nearest_er_km: nearest(c, (f) => hosp(f) && f.emergency),
      nearest_verified_er_km: nearest(c, (f) => hosp(f) && f.emergency && f.verified),
      nearest_lab_km: nearest(c, (f) => f.type === 'lab'), nearest_blood_bank_km: nearest(c, (f) => f.type === 'blood_bank'),
    };
    // A city with very few mapped places is more likely missing from the open map than missing hospitals.
    row.under_mapped = row.facilities_10km < 5;
    const gaps = [];
    if (row.hospitals_10km === 0) gaps.push('No hospital mapped within 10 km of the centre');
    else if (row.nearest_hospital_km > 25) gaps.push('Nearest hospital more than 25 km away');
    // Most hospitals run their own lab and blood bank, which the open map rarely tags separately, so a
    // missing standalone lab / blood bank only counts as a gap where hospital cover is also thin.
    const thin = row.hospitals_10km < 3;
    if (thin && (row.nearest_blood_bank_km == null || row.nearest_blood_bank_km > 25)) gaps.push('No blood bank mapped within 25 km, and few hospitals nearby');
    if (thin && (row.nearest_lab_km == null || row.nearest_lab_km > 15)) gaps.push('No lab mapped within 15 km, and few hospitals nearby');
    return { ...row, gaps };
  });
  // Compact hospital points for coverage circles: [lat, lng, flags] (1 = verified, 2 = 24/7 ER).
  const points = fac.filter(hosp).map((f) => [+f.lat.toFixed(4), +f.lng.toFixed(4), (f.verified ? 1 : 0) | (f.emergency ? 2 : 0)]);
  return { cities: cities.sort((a, b) => b.gaps.length - a.gaps.length || a.city.localeCompare(b.city)), hospitals: points,
    totals: { facilities: fac.length, hospitals: points.length, verified: fac.filter((f) => f.verified).length } };
}

/** Essential-medicine availability per city from pharmacy stock. */
export function supplyByCity(h) {
  const essentials = h.all('SELECT id, name, generic FROM products WHERE essential = 1 AND schedule != ?', 'controlled');
  const rows = h.all(`SELECT ph.city, i.product_id, SUM(i.stock) AS stock, COUNT(*) AS pharmacies FROM inventory i JOIN pharmacies ph ON ph.id = i.pharmacy_id
    WHERE ph.verified = 1 GROUP BY ph.city, i.product_id`);
  const phCount = Object.fromEntries(h.all('SELECT city, COUNT(*) AS n FROM pharmacies WHERE verified = 1 GROUP BY city').map((r) => [r.city, r.n]));
  // Form 9 pharmacies (pharmacist on duty) can stock prescription medicines; Form 10 medical stores only OTC.
  const form9 = Object.fromEntries(h.all(`SELECT city, COUNT(*) AS n FROM pharmacies WHERE verified = 1 AND license_type = 'pharmacy' GROUP BY city`).map((r) => [r.city, r.n]));
  const byCity = {};
  for (const r of rows) (byCity[r.city] ||= {})[r.product_id] = r.stock;
  const cities = Object.keys(phCount).filter((c) => CITY[c]).map((city) => {
    const stock = byCity[city] || {};
    const inStock = essentials.filter((p) => (stock[p.id] || 0) > 0);
    const out = essentials.filter((p) => !(stock[p.id] > 0));
    const low = essentials.filter((p) => stock[p.id] > 0 && stock[p.id] < 20);
    return { city, lat: CITY[city].lat, lng: CITY[city].lng, pharmacies: phCount[city], licensed_pharmacies: form9[city] || 0,
      otc_only: !form9[city], essentials: essentials.length,
      availability_pct: essentials.length ? Math.round((inStock.length / essentials.length) * 100) : null,
      stock_outs: out.map((p) => `${p.name} (${p.generic})`), low_stock: low.map((p) => p.name) };
  }).sort((a, b) => (a.availability_pct ?? 101) - (b.availability_pct ?? 101));
  return { essentials: essentials.length, cities };
}
