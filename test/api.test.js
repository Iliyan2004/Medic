// End-to-end API tests against an in-memory database with seeded demo data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setKeysForTest, encrypt, decrypt } from '../server/lib/crypto.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD, STAFF_PASSWORD } from '../server/seed.js';
import { screenClaim } from '../server/lib/fraud.js';
import { sizeSolar, assess } from '../server/lib/energy.js';
import { scoreKpis } from '../server/routes/subsidy.js';

let server, base, ctx;
const tokens = {};

async function call(method, path, { body, as, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (as) h.authorization = `Bearer ${tokens[as]}`;
  const res = await fetch(base + '/api' + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

before(async () => {
  setKeysForTest();
  const created = createApp({ db: openDb(':memory:') });
  ctx = created.ctx;
  seed(ctx);
  await new Promise((r) => { server = created.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const logins = { ayesha: ['03001234567', DEMO_PASSWORD], bilal: ['03111234567', DEMO_PASSWORD], sana: ['03211234567', DEMO_PASSWORD],
    drFatima: ['03009876543', STAFF_PASSWORD], drHamza: ['03019876543', STAFF_PASSWORD], pharmacist: ['03051112233', STAFF_PASSWORD],
    insurer: ['03061112233', STAFF_PASSWORD], dispatcher: ['03070000003', STAFF_PASSWORD], admin: ['03070000001', STAFF_PASSWORD], facility: ['03070000004', STAFF_PASSWORD] };
  for (const [k, [phone, password]] of Object.entries(logins)) {
    const r = await call('POST', '/auth/login', { body: { phone, password } });
    assert.equal(r.status, 200, `login ${k}`);
    tokens[k] = r.data.token;
  }
});
after(() => server?.close());

// ── Security basics ──
test('security headers and no stack traces', async () => {
  const res = await fetch(base + '/api/health');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
  assert.equal(bad.status, 400);
  assert.ok(!JSON.stringify(await bad.json()).includes('at '));
});

test('client config exposes only public (pk.) map tokens, never secret ones', async () => {
  const prev = process.env.MAPBOX_TOKEN;
  const configWith = async (tok) => {
    process.env.MAPBOX_TOKEN = tok;
    const { app } = createApp({ db: openDb(':memory:') });
    const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    try { return await (await fetch(`http://127.0.0.1:${s.address().port}/api/config`)).json(); } finally { s.close(); }
  };
  try {
    assert.equal((await configWith('pk.publicToken')).mapboxToken, 'pk.publicToken');
    assert.equal((await configWith('sk.secretToken')).mapboxToken, null);
    assert.equal((await configWith('')).mapboxToken, null);
  } finally {
    if (prev === undefined) delete process.env.MAPBOX_TOKEN; else process.env.MAPBOX_TOKEN = prev;
  }
  const res = await fetch(base + '/api/health');
  assert.match(res.headers.get('content-security-policy'), /img-src[^;]*https:\/\/api\.mapbox\.com/);
});

test('register validates Pakistani phone/CNIC and never stores raw CNIC', async () => {
  let r = await call('POST', '/auth/register', { body: { name: 'X', phone: '12345', password: 'longenough', consent_terms: true } });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/register', { body: { name: 'New Person', phone: '03451234567', password: 'longenough', cnic: '35202-1234567-1', consent_terms: true } });
  assert.equal(r.status, 201);
  const row = ctx.h.get('SELECT * FROM users WHERE phone = ?', '03451234567');
  assert.equal(row.cnic_last4, '5671');
  assert.ok(!JSON.stringify(row).includes('3520212345671'));
  assert.match(row.password_hash, /^scrypt\$/);
});

test('wrong password rejected; protected routes need auth', async () => {
  assert.equal((await call('POST', '/auth/login', { body: { phone: '03001234567', password: 'nope' } })).status, 401);
  assert.equal((await call('GET', '/records/mine')).status, 401);
});

test('field encryption round-trips and is bound to its owner', () => {
  const blob = encrypt({ a: 1 }, 'record:1');
  assert.deepEqual(decrypt(blob, 'record:1'), { a: 1 });
  assert.throws(() => decrypt(blob, 'record:2'));
  const stored = ctx.h.get('SELECT data_enc FROM records LIMIT 1').data_enc;
  assert.ok(stored.startsWith('v1.') && !stored.includes('Penicillin'));
});

// ── Records & consent ──
test('doctor needs consent; patient sees access log; revoke works', async () => {
  const ayesha = ctx.h.get(`SELECT id FROM users WHERE phone='03001234567'`).id;
  assert.equal((await call('GET', `/records/patient/${ayesha}`, { as: 'drHamza' })).status, 403);
  const ok = await call('GET', `/records/patient/${ayesha}`, { as: 'drFatima' });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.records.some((r) => r.type === 'allergy'));
  const log = await call('GET', '/records/access-log', { as: 'ayesha' });
  assert.ok(log.data.some((e) => e.action === 'records.view' && e.actor_name === 'Fatima Siddiqui'));
  // grant then revoke Dr Hamza
  const g = await call('POST', '/records/consents', { as: 'ayesha', body: { grantee_id: ctx.h.get(`SELECT id FROM users WHERE phone='03019876543'`).id, scope: 'records', purpose: 'Second opinion', days: 1 } });
  assert.equal(g.status, 201);
  assert.equal((await call('GET', `/records/patient/${ayesha}`, { as: 'drHamza' })).status, 200);
  await call('DELETE', `/records/consents/${g.data.id}`, { as: 'ayesha' });
  assert.equal((await call('GET', `/records/patient/${ayesha}`, { as: 'drHamza' })).status, 403);
});

test('break-glass grants 24h access, notifies patient, is audited', async () => {
  const r = await call('POST', '/records/break-glass', { as: 'drHamza', body: { patient_phone: '03111234567', reason: 'Unconscious after road accident, need allergy history' } });
  assert.equal(r.status, 201);
  assert.equal((await call('GET', `/records/patient/${r.data.patient_id}`, { as: 'drHamza' })).status, 200);
  assert.ok(ctx.h.get(`SELECT * FROM notifications WHERE user_id = ? AND kind = 'security'`, r.data.patient_id));
  assert.ok(ctx.h.get(`SELECT * FROM audit_log WHERE action = 'records.break_glass'`));
});

test('share codes work once issued and FHIR export is valid', async () => {
  const s = await call('POST', '/records/share', { as: 'ayesha', body: { hours: 1 } });
  const v = await call('POST', '/records/shared', { body: { code: s.data.code.toLowerCase() } });
  assert.equal(v.status, 200);
  assert.ok(v.data.records.every((r) => r.type !== 'note'));
  assert.equal((await call('POST', '/records/shared', { body: { code: 'AAA-BBB-CCC' } })).status, 404);
  const fhir = await call('GET', '/records/export', { as: 'ayesha' });
  assert.equal(fhir.data.resourceType, 'Bundle');
  assert.ok(fhir.data.entry.some((e) => e.resource.resourceType === 'AllergyIntolerance'));
});

test('audit log hash chain is intact', () => {
  assert.equal(ctx.audit.verifyChain(), null);
});

// ── Pharmacy ──
test('prescription rules: Rx needed, medical store blocked, controlled never online', async () => {
  const products = (await call('GET', '/pharmacy/products')).data;
  const amox = products.find((p) => p.generic === 'Amoxicillin' && p.name.startsWith('Amoxil'));
  const alprax = products.find((p) => p.schedule === 'controlled');
  const pharmacies = (await call('GET', '/pharmacy/pharmacies')).data;
  const pharmacy = pharmacies.find((p) => p.license_type === 'pharmacy' && p.city === 'Karachi');
  const store = pharmacies.find((p) => p.license_type === 'medical_store');
  const base0 = { payment_method: 'cod', address: 'x' };
  let r = await call('POST', '/pharmacy/orders', { as: 'ayesha', body: { ...base0, pharmacy_id: pharmacy.id, items: [{ product_id: amox.id, qty: 1 }] } });
  assert.equal(r.status, 400); assert.match(r.data.error, /prescription/i);
  r = await call('POST', '/pharmacy/orders', { as: 'ayesha', body: { ...base0, pharmacy_id: store.id, items: [{ product_id: amox.id, qty: 1 }] } });
  assert.equal(r.status, 400); assert.match(r.data.error, /medical store/i);
  r = await call('POST', '/pharmacy/orders', { as: 'ayesha', body: { ...base0, pharmacy_id: pharmacy.id, items: [{ product_id: alprax.id, qty: 1 }] } });
  assert.equal(r.status, 400); assert.match(r.data.error, /controlled/i);
});

test('full e-Rx order: subsidy applied, pharmacist approves, dispense catches reused barcode', async () => {
  // Become eligible for zakat medicines
  const elig = await call('POST', '/support/check-eligibility', { as: 'ayesha' });
  assert.equal(elig.status, 200);
  const zakat = elig.data.results.find((x) => x.name === 'Zakat Medicine Fund');
  assert.ok(zakat.eligible, 'seeded Ayesha should be zakat-eligible');
  const rx = (await call('GET', '/pharmacy/prescriptions', { as: 'ayesha' })).data.find((p) => p.source === 'e-rx');
  const pharmacy = (await call('GET', '/pharmacy/pharmacies')).data.find((p) => p.license_type === 'pharmacy' && p.city === 'Karachi');
  const before = ctx.h.get('SELECT fund_balance FROM subsidy_programs WHERE id = ?', zakat.program_id).fund_balance;
  const o = await call('POST', '/pharmacy/orders', { as: 'ayesha', body: { pharmacy_id: pharmacy.id, items: rx.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    prescription_id: rx.id, payment_method: 'cod', address: 'Clifton', subsidy_program_id: zakat.program_id } });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal(o.data.status, 'awaiting_rx');
  const dup = await call('POST', '/pharmacy/orders', { as: 'ayesha', body: { pharmacy_id: pharmacy.id, items: rx.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    prescription_id: rx.id, payment_method: 'cod', address: 'Clifton' } });
  assert.equal(dup.status, 400, 'same prescription cannot back two orders');
  assert.ok(o.data.subsidy_amount > 0);
  assert.equal(ctx.h.get('SELECT fund_balance FROM subsidy_programs WHERE id = ?', zakat.program_id).fund_balance, before - o.data.subsidy_amount);
  // Patient cannot review their own order
  assert.equal((await call('POST', `/pharmacy/orders/${o.data.id}/review`, { as: 'ayesha', body: { decision: 'approve' } })).status, 403);
  assert.equal((await call('POST', `/pharmacy/orders/${o.data.id}/review`, { as: 'pharmacist', body: { decision: 'approve' } })).status, 200);
  const p = ctx.h.get('SELECT * FROM products WHERE id = 1');
  const code = `(01)${p.gtin}(21)SN100002`;
  const d = await call('POST', `/pharmacy/orders/${o.data.id}/dispense`, { as: 'pharmacist', body: { codes: [code] } });
  assert.equal(d.status, 200); assert.equal(d.data.status, 'dispatched');
  const v = await call('POST', '/pharmacy/verify-pack', { body: { code } });
  assert.equal(v.data.verdict, 'already_dispensed');
  assert.equal((await call('POST', '/pharmacy/verify-pack', { body: { code: `(01)${p.gtin}(21)SN100019` } })).data.verdict, 'recalled');
  assert.equal((await call('POST', '/pharmacy/verify-pack', { body: { code: `(01)${p.gtin}(21)FAKE` } })).data.verdict, 'unknown_serial');
});

// ── Insurance ──
test('small clean claim auto-approves; suspicious claim goes to review; insurer isolation', async () => {
  const pol = (await call('GET', '/insurance/policies', { as: 'ayesha' })).data[0];
  const fac = ctx.h.get(`SELECT id FROM facilities WHERE verified = 1 AND type = 'hospital' LIMIT 1`).id;
  const ok = await call('POST', '/insurance/claims', { as: 'ayesha', body: { policy_id: pol.id, kind: 'opd', diagnosis: 'Fever', icd10: 'A09', amount: 2000, facility_id: fac } });
  assert.equal(ok.data.status, 'auto_approved');
  const big = await call('POST', '/insurance/claims', { as: 'ayesha', body: { policy_id: pol.id, kind: 'opd', diagnosis: 'Fever', icd10: 'A09', amount: 45000, facility_id: fac } });
  assert.equal(big.data.status, 'under_review');
  assert.ok(big.data.fraud_flags.some((f) => f.code === 'ABOVE_BENCHMARK'));
  assert.ok(big.data.fraud_flags.some((f) => f.code === 'DUPLICATE'));
  // Another insurer's officer cannot touch this claim
  const other = await call('POST', '/auth/login', { body: { phone: '03062223344', password: STAFF_PASSWORD } });
  tokens.otherInsurer = other.data.token;
  assert.equal((await call('POST', `/insurance/claims/${big.data.id}/decide`, { as: 'otherInsurer', body: { decision: 'approve' } })).status, 404);
  assert.equal((await call('POST', `/insurance/claims/${big.data.id}/decide`, { as: 'insurer', body: { decision: 'reject' } })).status, 400); // needs reason
  assert.equal((await call('POST', `/insurance/claims/${big.data.id}/decide`, { as: 'insurer', body: { decision: 'reject', note: 'Duplicate of earlier claim' } })).status, 200);
});

test('fraud rules unit', () => {
  const plan = { annual_limit: 60000, waiting_days: 30, kind: 'opd' };
  const policy = { start_date: new Date().toISOString().slice(0, 10) };
  const s = screenClaim({ claim: { amount: 5000, icd10: 'A09', kind: 'opd' }, policy, plan, facility: null, history: [], usedThisYear: 0 });
  assert.ok(s.flags.some((f) => f.code === 'WAITING_PERIOD'));
  assert.equal(s.autoApprove, false);
});

// ── Ambulance ──
test('ambulance request works without account, picks fastest, pre-alerts hospital, tracking token required', async () => {
  const r = await call('POST', '/emergency/request', { body: { lat: 24.87, lng: 67.03, severity: 2, complaint: 'chest pain', contact_phone: '03001112222' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.ambulance.eta_min > 0);
  assert.ok(['ALS', 'BLS'].includes(r.data.ambulance.type));
  assert.ok(r.data.destination);
  assert.ok(ctx.h.get(`SELECT * FROM notifications WHERE facility_id = ? AND kind = 'pre_alert'`, r.data.destination.id));
  assert.equal((await call('GET', `/emergency/${r.data.id}`)).status, 403);
  assert.equal((await call('GET', `/emergency/${r.data.id}?token=${r.data.track_token}`)).status, 200);
  assert.equal(ctx.h.get('SELECT status FROM ambulances WHERE id = ?', r.data.ambulance.id).status, 'dispatched');
  // dispatcher moves it along
  for (let i = 0; i < 12; i++) await call('POST', '/emergency/simulate-tick', { as: 'dispatcher' });
  const e = await call('GET', `/emergency/${r.data.id}`, { as: 'dispatcher' });
  assert.ok(['on_scene', 'transporting', 'at_hospital'].includes(e.data.status), e.data.status);
  assert.equal((await call('POST', '/emergency/simulate-tick', { as: 'ayesha' })).status, 403);
});

test('dispatch skips hospitals with no free beds', async () => {
  const orangi = ctx.h.get(`SELECT * FROM facilities WHERE name LIKE 'Orangi%'`);
  const r = await call('POST', '/emergency/quote', { body: { lat: orangi.lat, lng: orangi.lng, severity: 1 } });
  assert.notEqual(r.data.destination.id, orangi.id); // 0 beds + power critical
});

// ── Support / PPP ──
test('eligibility uses NSER score; donations update public ledger', async () => {
  const r = await call('POST', '/support/check-eligibility', { as: 'bilal' });
  assert.equal(r.status, 200);
  assert.ok(r.data.pmtScore > 45);
  assert.ok(r.data.results.find((x) => x.name === 'Zakat Medicine Fund').eligible === false);
  assert.equal((await call('POST', '/support/check-eligibility', { as: 'sana' })).status, 400); // no CNIC
  const progs = (await call('GET', '/support/programs')).data;
  const zakat = progs.find((p) => p.type === 'zakat');
  const d = await call('POST', `/support/programs/${zakat.id}/donate`, { as: 'bilal', body: { amount: 5000, method: 'jazzcash' } });
  assert.equal(d.status, 201);
  const t = await call('GET', '/support/transparency');
  assert.ok(t.data.recent.some((x) => x.amount === 5000 && x.kind === 'credit'));
  assert.ok(!JSON.stringify(t.data).includes('Bilal'));
});

test('PPP KPI scoring', () => {
  const { score } = scoreKpis({ visits: { target: 100 }, stockouts: { target: 2, lower: true } }, { visits: 50, stockouts: 4 });
  assert.equal(score, 50);
});

// ── Community ──
test('community: misinformation held, CNIC scrubbed, donors alerted, anonymous hides author', async () => {
  const bad = await call('POST', '/community/posts', { as: 'sana', body: { category: 'question', title: 'Polio drops?', body: 'I heard polio drops are haram and sterilize children, is it true?' } });
  assert.equal(bad.data.status, 'flagged');
  const scrub = await call('POST', '/community/posts', { as: 'sana', body: { category: 'question', title: 'My CNIC issue', body: 'My CNIC 35202-1234567-1 is not linking, help', anonymous: true } });
  const post = await call('GET', `/community/posts/${scrub.data.id}`);
  assert.ok(!post.data.body.includes('35202'));
  assert.equal(post.data.author_name, 'Anonymous');
  const blood = await call('POST', '/community/posts', { as: 'sana', body: { category: 'blood_request', title: 'Need B+ blood urgently', body: 'At Seaview hospital for surgery', city: 'Karachi', blood_group: 'B+' } });
  assert.ok(blood.data.notifiedDonors >= 1); // Ayesha (B+) and Usman (B-) are Karachi donors
});

// ── Energy ──
test('energy: solar sizing math and critical alerts', async () => {
  const s = sizeSolar({ dailyKwh: 44, outageHours: 6, criticalLoadKw: 2 });
  assert.equal(s.pvKw, 10);
  assert.ok(s.paybackYears > 0 && s.paybackYears < 15);
  assert.equal(assess({ grid_on: 1, fridge_temp_c: 10, ts: new Date().toISOString() }, {}).level, 'critical');
  const fid = ctx.h.get(`SELECT org_id FROM users WHERE phone='03070000004'`).org_id;
  const r = await call('POST', '/energy/readings', { as: 'facility', body: { facility_id: fid, grid_on: false, battery_pct: 10 } });
  assert.equal(r.data.assessment.level, 'critical');
  assert.equal((await call('POST', '/energy/readings', { as: 'facility', body: { facility_id: fid + 1, grid_on: true } })).status, 403);
});

// ── Privacy ──
test('delete request anonymises account and removes records', async () => {
  const reg = await call('POST', '/auth/register', { body: { name: 'Temp User', phone: '03459999999', password: 'longenough', consent_terms: true } });
  tokens.temp = reg.data.token;
  await call('POST', '/records', { as: 'temp', body: { type: 'note', title: 'secret', data: { text: 'x' } } });
  const req = await call('POST', '/privacy/requests', { as: 'temp', body: { kind: 'delete' } });
  assert.equal((await call('POST', `/admin/data-requests/${req.data.id}/close`, { as: 'ayesha' })).status, 403);
  assert.equal((await call('POST', `/admin/data-requests/${req.data.id}/close`, { as: 'admin' })).status, 200);
  const u = ctx.h.get('SELECT * FROM users WHERE id = ?', reg.data.user.id);
  assert.equal(u.name, 'Deleted user');
  assert.equal(ctx.h.get('SELECT COUNT(*) AS n FROM records WHERE patient_id = ?', u.id).n, 0);
  assert.equal((await call('GET', '/auth/me', { as: 'temp' })).status, 401);
});

test('breach register starts 72-hour clock', async () => {
  const b = await call('POST', '/privacy/breaches', { as: 'admin', body: { description: 'Test breach', severity: 'high', affected_count: 3 } });
  assert.ok(b.data.hours_left <= 72 && b.data.hours_left >= 71);
});
