// Care features: family profiles, reminders & refills, emergency card, lab tests, appointments,
// per-pharmacy prices, printable Rx + QR verification, donor eligibility, camp alerts, staff stats.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setKeysForTest } from '../server/lib/crypto.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD, STAFF_PASSWORD } from '../server/seed.js';
import { timesFromDosage } from '../server/routes/care.js';

let server, base, ctx;
const tokens = {};
async function call(method, path, { body, as, actAs } = {}) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (as) h.authorization = `Bearer ${tokens[as]}`;
  if (actAs) h['x-act-as'] = String(actAs);
  const res = await fetch(base + '/api' + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
before(async () => {
  setKeysForTest();
  const created = createApp({ db: openDb(':memory:') });
  ctx = created.ctx;
  seed(ctx);
  await new Promise((r) => { server = created.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, phone, pw] of [['ayesha', '03001234567', DEMO_PASSWORD], ['bilal', '03111234567', DEMO_PASSWORD], ['usman', '03331234567', DEMO_PASSWORD],
    ['pharmacist', '03051112233', STAFF_PASSWORD], ['facility', '03070000004', STAFF_PASSWORD], ['admin', '03070000001', STAFF_PASSWORD], ['insurer', '03061112233', STAFF_PASSWORD],
    ['dispatcher', '03070000003', STAFF_PASSWORD], ['drFatima', '03009876543', STAFF_PASSWORD]]) {
    const r = await call('POST', '/auth/login', { body: { phone, password: pw } });
    assert.equal(r.status, 200, k); tokens[k] = r.data.token;
  }
});
after(() => server?.close());

test('family: add member, act as them, guardian is the audited actor, others cannot act as them', async () => {
  const add = await call('POST', '/care/family', { as: 'bilal', body: { name: 'Ali Ahmed', relation: 'child', gender: 'male', birth_year: 2016, blood_group: 'O+' } });
  assert.equal(add.status, 201);
  const kid = add.data.id;
  const rec = await call('POST', '/records', { as: 'bilal', actAs: kid, body: { type: 'allergy', title: 'Peanut allergy', data: { substance: 'Peanuts', reaction: 'Swelling', severity: 'severe' } } });
  assert.equal(rec.status, 201, JSON.stringify(rec.data));
  const mine = await call('GET', '/records/mine', { as: 'bilal', actAs: kid });
  assert.equal(mine.data.patient.name, 'Ali Ahmed');
  assert.ok(mine.data.records.some((r) => r.title === 'Peanut allergy'));
  assert.ok(!(await call('GET', '/records/mine', { as: 'bilal' })).data.records.some((r) => r.title === 'Peanut allergy'), 'kept separate from guardian');
  const audit = ctx.h.get(`SELECT * FROM audit_log WHERE action = 'records.create' AND patient_id = ? ORDER BY id DESC`, kid);
  assert.equal(audit.actor_id, ctx.h.get(`SELECT id FROM users WHERE phone = '03111234567'`).id, 'guardian recorded as actor');
  assert.match(audit.detail, /for_family_member/);
  // Someone else's header is ignored → they just see their own record
  assert.notEqual((await call('GET', '/records/mine', { as: 'ayesha', actAs: kid })).data.patient.name, 'Ali Ahmed');
  // Dependants cannot sign in, and MFA cannot be set up while acting
  const dep = ctx.h.get('SELECT phone FROM users WHERE id = ?', kid);
  assert.equal((await call('POST', '/auth/login', { body: { phone: dep.phone, password: DEMO_PASSWORD } })).status, 401);
  assert.equal((await call('POST', '/auth/mfa/setup', { as: 'bilal', actAs: kid })).status, 400);
  assert.equal((await call('GET', '/care/family', { as: 'bilal' })).data.members.length, 1);
});

test('reminders: dosage text → times, log doses, refill due, from prescription', async () => {
  assert.deepEqual(timesFromDosage('1 tab twice daily'), ['08:00', '20:00']);
  assert.deepEqual(timesFromDosage('1 cap three times daily for 5 days'), ['08:00', '14:00', '20:00']);
  assert.deepEqual(timesFromDosage('at bedtime'), ['21:00']);
  const seeded = (await call('GET', '/care/schedules', { as: 'ayesha' })).data;
  assert.ok(seeded[0].refill_due, 'seeded 30-day supply started 27 days ago → refill due');
  const s = await call('POST', '/care/schedules', { as: 'usman', body: { name: 'Vitamin D', dose: '1 capsule', times: ['09:00'], days_supply: 10 } });
  assert.equal(s.status, 201);
  assert.equal((await call('POST', '/care/schedules', { as: 'usman', body: { name: 'X', times: ['25:00'] } })).status, 400);
  const slot = s.data.today[0].slot;
  const logged = await call('POST', `/care/schedules/${s.data.id}/doses`, { as: 'usman', body: { slot, status: 'taken' } });
  assert.equal(logged.data.today[0].status, 'taken');
  assert.equal((await call('POST', `/care/schedules/${s.data.id}/doses`, { as: 'ayesha', body: { slot, status: 'taken' } })).status, 404, 'not your schedule');
  const rx = ctx.h.get(`SELECT id FROM prescriptions WHERE source = 'e-rx' LIMIT 1`);
  const fromRx = await call('POST', `/care/schedules/from-rx/${rx.id}`, { as: 'ayesha' });
  assert.equal(fromRx.status, 201); assert.ok(fromRx.data.length >= 1);
  assert.equal((await call('POST', `/care/schedules/from-rx/${rx.id}`, { as: 'ayesha' })).data.length, 0, 'no duplicates');
  const refilled = await call('PATCH', `/care/schedules/${seeded[0].id}`, { as: 'ayesha', body: { refilled: true } });
  assert.equal(refilled.data.refill_due, false);
});

test('emergency card shows allergies, conditions, medicines and contact; is audited', async () => {
  const c = await call('GET', '/care/card', { as: 'ayesha' });
  assert.equal(c.status, 200);
  assert.equal(c.data.blood_group, 'B+');
  assert.ok(c.data.allergies.length >= 1 && c.data.conditions.length >= 1 && c.data.medicines.length >= 1);
  assert.equal(c.data.emergency_contact.phone, '03331112223');
  assert.ok(ctx.h.get(`SELECT 1 FROM audit_log WHERE action = 'records.card'`));
});

test('lab booking: verified lab only, home collection fee, staff completes → results land in record', async () => {
  const tests = (await call('GET', '/care/lab-tests', { as: 'bilal' })).data;
  const lab = ctx.h.get(`SELECT id FROM facilities WHERE type = 'lab' AND verified = 1 LIMIT 1`);
  const slot = new Date(Date.now() + 86_400_000).toISOString();
  const bk = await call('POST', '/care/lab-bookings', { as: 'bilal', body: { facility_id: lab.id, test_ids: [tests[0].id, tests[1].id], home_collection: true, address: 'House 1, Peshawar', slot_at: slot } });
  assert.equal(bk.status, 201);
  assert.equal(bk.data.total, tests[0].price + tests[1].price + 300);
  assert.equal((await call('POST', '/care/lab-bookings', { as: 'bilal', body: { facility_id: lab.id, test_ids: [tests[0].id], home_collection: true, slot_at: slot } })).status, 400, 'address needed');
  assert.equal((await call('POST', `/care/lab-bookings/${bk.data.id}/status`, { as: 'bilal', body: { status: 'completed' } })).status, 403);
  ctx.h.run('UPDATE users SET org_id = ? WHERE phone = ?', lab.id, '03070000004'); // make the facility admin the lab's admin
  const done = await call('POST', `/care/lab-bookings/${bk.data.id}/status`, { as: 'facility', body: { status: 'completed', results: [{ name: tests[0].name, value: '13.2', unit: 'g/dL' }] } });
  assert.equal(done.status, 200);
  assert.ok((await call('GET', '/records/mine', { as: 'bilal' })).data.records.some((r) => r.type === 'lab' && r.title === tests[0].name && r.data.value === '13.2'));
});

test('appointments: request to verified facility, staff queue, status notifies patient', async () => {
  const fac = ctx.h.get(`SELECT id FROM facilities WHERE type = 'hospital' AND verified = 1 LIMIT 1`);
  ctx.h.run('UPDATE users SET org_id = ? WHERE phone = ?', fac.id, '03070000004');
  const a = await call('POST', '/care/appointments', { as: 'ayesha', body: { facility_id: fac.id, reason: 'Diabetes follow-up', female_only: true, preferred_time: 'Morning' } });
  assert.equal(a.status, 201);
  const q = await call('GET', '/care/appointments/queue', { as: 'facility' });
  assert.ok(q.data.some((x) => x.id === a.data.id && x.female_only === 1));
  assert.equal((await call('POST', `/care/appointments/${a.data.id}/status`, { as: 'bilal', body: { status: 'booked' } })).status, 403);
  assert.equal((await call('POST', `/care/appointments/${a.data.id}/status`, { as: 'facility', body: { status: 'booked', note: 'Tue 10am, Dr. Ayesha (female)' } })).status, 200);
  assert.ok(ctx.h.get(`SELECT 1 FROM notifications WHERE user_id = (SELECT id FROM users WHERE phone='03001234567') AND message LIKE '%Tue 10am%'`));
});

test('per-pharmacy prices: shown cheapest first, used in orders, never above MRP', async () => {
  const p = ctx.h.get(`SELECT * FROM products WHERE schedule = 'OTC' AND price_controlled = 0 LIMIT 1`);
  const d = await call('GET', `/pharmacy/products/${p.id}`);
  const inStock = d.data.stock.filter((s) => s.stock > 0);
  assert.ok(inStock.every((s, i) => i === 0 || s.price >= inStock[i - 1].price), 'sorted cheapest first');
  assert.ok(d.data.stock.every((s) => s.price <= p.mrp));
  const cheapest = inStock[0];
  const q = await call('POST', '/pharmacy/orders/quote', { as: 'usman', body: { pharmacy_id: cheapest.id, items: [{ product_id: p.id, qty: 2 }], payment_method: 'cod', address: 'x' } });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.equal(q.data.items[0].price, cheapest.price);
});

test('printable prescription: QR token verifies publicly with initials only; forged token rejected', async () => {
  const rx = ctx.h.get(`SELECT id FROM prescriptions WHERE source = 'e-rx' LIMIT 1`);
  const pr = await call('GET', `/pharmacy/prescriptions/${rx.id}/print`, { as: 'ayesha' });
  assert.equal(pr.status, 200);
  assert.equal((await call('GET', `/pharmacy/prescriptions/${rx.id}/print`, { as: 'bilal' })).status, 404);
  const v = await call('GET', `/pharmacy/rx-verify/${pr.data.token}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.patient_initials, 'AK'); assert.ok(!JSON.stringify(v.data).includes('Ayesha'));
  assert.equal(v.data.doctor.verified, true);
  assert.equal((await call('GET', `/pharmacy/rx-verify/${rx.id}.0000000000000000ffff`)).status, 404);
});

test('blood donors who gave recently are not alerted; camp alerts reach opted-in users', async () => {
  ctx.h.run(`UPDATE users SET last_donation_date = date('now','-10 days') WHERE phone = '03331234567'`); // Usman, B-, Karachi
  const before = ctx.h.get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = (SELECT id FROM users WHERE phone='03331234567') AND kind = 'blood'`).n;
  await call('POST', '/community/posts', { as: 'ayesha', body: { category: 'blood_request', title: 'Need B- blood urgently', body: 'At Civil Hospital Karachi for surgery tomorrow', city: 'Karachi', blood_group: 'B-' } });
  assert.equal(ctx.h.get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = (SELECT id FROM users WHERE phone='03331234567') AND kind = 'blood'`).n, before, 'not eligible yet');
  const camp = await call('POST', '/facilities', { as: 'admin', body: { name: 'Free Diabetes Camp (Demo)', type: 'camp', lat: 24.86, lng: 67.0, city: 'Karachi', organizer: 'Demo NGO',
    starts_at: new Date(Date.now() + 86_400_000).toISOString(), ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
  assert.equal(camp.status, 201);
  assert.ok(ctx.h.get(`SELECT 1 FROM notifications WHERE kind = 'camp' AND user_id = (SELECT id FROM users WHERE phone='03001234567')`), 'Ayesha opted in');
  assert.ok(!ctx.h.get(`SELECT 1 FROM notifications WHERE kind = 'camp' AND user_id = (SELECT id FROM users WHERE phone='03331234567')`), 'Usman did not');
});

test('staff numbers: pharmacist desk stats, insurer speed, dispatch response', async () => {
  const d = await call('GET', '/pharmacy/desk-stats', { as: 'pharmacist' });
  assert.equal(d.status, 200); assert.ok('avg_delivery_hours' in d.data && Array.isArray(d.data.low_stock));
  assert.equal((await call('GET', '/pharmacy/desk-stats', { as: 'ayesha' })).status, 403);
  const a = await call('GET', '/insurance/analytics', { as: 'insurer' });
  assert.ok('avgDecisionMinutes' in a.data && 'autoApprovedPct' in a.data);
  const b = await call('GET', '/emergency/board', { as: 'dispatcher' });
  assert.ok('avg_response_7d' in b.data.today);
});

test('profile preferences validate', async () => {
  assert.equal((await call('PATCH', '/auth/me', { as: 'bilal', body: { emergency_contact_phone: '12345' } })).status, 400);
  assert.equal((await call('PATCH', '/auth/me', { as: 'bilal', body: { last_donation_date: '2999-01-01' } })).status, 400);
  const ok = await call('PATCH', '/auth/me', { as: 'bilal', body: { emergency_contact_name: 'Sara', emergency_contact_phone: '0300-1112223', pref_female_doctor: true } });
  assert.equal(ok.data.user.emergency_contact_phone, '03001112223'); assert.equal(ok.data.user.pref_female_doctor, true);
});
