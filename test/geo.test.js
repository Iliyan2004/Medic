// Health geography: disease aggregation & alerts, privacy suppression, facility reporting rules, access, supply.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setKeysForTest } from '../server/lib/crypto.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD, STAFF_PASSWORD } from '../server/seed.js';
import { alertLevel, weekStart, addWeeks, suppress, diseaseByCity } from '../server/lib/geo-health.js';

let server, base, ctx;
const tokens = {};
async function call(method, p, { body, as } = {}) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (as) h.authorization = `Bearer ${tokens[as]}`;
  const res = await fetch(base + '/api' + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
before(async () => {
  setKeysForTest();
  const created = createApp({ db: openDb(':memory:') });
  ctx = created.ctx;
  seed(ctx);
  await new Promise((r) => { server = created.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, phone, pw] of [['ayesha', '03001234567', DEMO_PASSWORD], ['facility', '03070000004', STAFF_PASSWORD]]) {
    tokens[k] = (await call('POST', '/auth/login', { body: { phone, password: pw } })).data.token;
  }
});
after(() => server?.close());

test('alert rule: rising needs ≥5 cases and > mean + 2 SD; weeks start on Monday', () => {
  assert.equal(alertLevel([10, 11, 9, 10, 30]), 'rising');
  assert.equal(alertLevel([10, 11, 9, 10, 12]), 'ok');
  assert.equal(alertLevel([1, 0, 1, 0, 4]), 'ok', 'tiny numbers never alert');
  assert.equal(alertLevel([10, 10, 10, 10, 12]), 'ok', 'normal wobble (≈√10) is not an alert');
  assert.equal(alertLevel([10, 10, 10, 10, 15]), 'watch');
  assert.equal(weekStart(new Date('2026-11-26T12:00:00Z')), '2026-11-23'); // Thursday → Monday
  assert.equal(weekStart(new Date('2026-11-23T00:00:00Z')), '2026-11-23');
  assert.equal(addWeeks('2026-11-23', -1), '2026-11-16');
  assert.equal(suppress(3), '<5'); assert.equal(suppress(0), 0); assert.equal(suppress(12), 12);
});

test('public disease map: demo season shows dengue rising in Karachi; only city aggregates returned', async () => {
  const d = await call('GET', '/geo/disease?disease=dengue');
  assert.equal(d.status, 200);
  assert.equal(d.data.weeks.length, 8);
  assert.ok(d.data.rising.includes('Karachi'));
  const k = d.data.cities.find((c) => c.city === 'Karachi');
  assert.deepEqual(Object.keys(k).sort(), ['alert', 'city', 'lat', 'lng', 'province', 'sources', 'this_week', 'total', 'trend'].sort(), 'no facility or patient fields');
  const al = await call('GET', '/geo/alerts');
  assert.ok(al.data.some((a) => a.code === 'dengue' && a.cities.includes('Karachi')));
  assert.equal((await call('GET', '/geo/disease?disease=../../etc')).data.disease.code, 'dengue', 'unknown codes fall back safely');
});

test('small counts are suppressed as "<5" (privacy)', () => {
  const fac = ctx.h.get(`SELECT id FROM facilities WHERE verified = 1 AND city = 'Islamabad' LIMIT 1`) || ctx.h.get(`SELECT id FROM facilities WHERE verified = 1 LIMIT 1`);
  ctx.h.run(`INSERT OR REPLACE INTO disease_reports (facility_id, week_start, disease, cases, source) VALUES (?, ?, 'cholera', 2, 'facility')`, fac.id, weekStart());
  const d = diseaseByCity(ctx.h, 'cholera', 8);
  const row = d.cities[0];
  assert.equal(row.this_week, '<5'); assert.equal(row.total, '<5');
  assert.equal(row.trend.at(-1), null, 'suppressed week is a gap in the trend');
});

test('weekly reporting: facility staff only, own facility, recent weeks, valid numbers', async () => {
  assert.equal((await call('POST', '/geo/disease-reports', { as: 'ayesha', body: { counts: { dengue: 5 } } })).status, 403);
  assert.equal((await call('POST', '/geo/disease-reports', { as: 'facility', body: { counts: { plague: 5 } } })).status, 400);
  assert.equal((await call('POST', '/geo/disease-reports', { as: 'facility', body: { counts: { dengue: -3 } } })).status, 400);
  assert.equal((await call('POST', '/geo/disease-reports', { as: 'facility', body: { week_start: '2020-01-06', counts: { dengue: 5 } } })).status, 400);
  const ok = await call('POST', '/geo/disease-reports', { as: 'facility', body: { counts: { measles: 40, dengue: 12 } } });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.week_start, weekStart());
  const mine = await call('GET', '/geo/disease-reports/mine', { as: 'facility' });
  assert.ok(mine.data.some((r) => r.disease === 'measles' && r.cases === 40));
  const m = await call('GET', '/geo/disease?disease=measles');
  assert.ok(m.data.cities.some((c) => c.this_week >= 40), 'report reaches the public map (cache cleared on write)');
  const again = await call('POST', '/geo/disease-reports', { as: 'facility', body: { counts: { measles: 41 } } });
  assert.equal(again.status, 201, 're-submitting the same week updates it');
});

test('access and supply aggregates', async () => {
  const a = await call('GET', '/geo/access');
  assert.equal(a.status, 200);
  assert.equal(a.data.cities.length, 27);
  const kar = a.data.cities.find((c) => c.city === 'Karachi');
  assert.ok(kar.hospitals_10km >= 1 && kar.nearest_verified_er_km != null);
  assert.ok(Array.isArray(a.data.hospitals[0]) && a.data.hospitals[0].length === 3, 'compact points only');
  const s = await call('GET', '/geo/supply');
  assert.ok(s.data.essentials > 0);
  const c = s.data.cities[0];
  assert.ok(c.availability_pct >= 0 && c.availability_pct <= 100 && Array.isArray(c.stock_outs));
});
