// Nov 2026 additions: real facility import (Healthsites/OSM), GS1 parsing per DRAP guideline v2.2,
// staff two-step sign-in (TOTP), encrypted prescription photos, retention job, WhatsApp Cloud API adapter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setKeysForTest } from '../server/lib/crypto.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD, STAFF_PASSWORD } from '../server/seed.js';
import { parseGs1, gtinValid, sendWhatsApp } from '../server/lib/adapters.js';
import { totp, verifyTotp, base32Encode } from '../server/lib/totp.js';
import { importHealthsites } from '../server/import-healthsites.js';
import { runRetention } from '../server/lib/retention.js';

let server, base, ctx;
const tokens = {};
async function call(method, path, { body, as } = {}) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (as) h.authorization = `Bearer ${tokens[as]}`;
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
  for (const [k, phone, pw] of [['ayesha', '03001234567', DEMO_PASSWORD], ['bilal', '03111234567', DEMO_PASSWORD], ['pharmacist', '03051112233', STAFF_PASSWORD]]) {
    tokens[k] = (await call('POST', '/auth/login', { body: { phone, password: pw } })).data.token;
  }
});
after(() => server?.close());

test('GS1: raw scanner strings, bracketed form, check digit, expiry/batch mismatch', async () => {
  const p = ctx.h.get('SELECT * FROM products WHERE id = 1');
  assert.ok(gtinValid(p.gtin), 'seeded GTINs carry a valid GS1 check digit');
  assert.equal(gtinValid('08961000000001'), false);
  const raw = parseGs1(`]d201${p.gtin}17271231` + '10LOT7\x1d21SN100004');
  assert.deepEqual([raw.gtin, raw.expiry_date, raw.batch, raw.serial], [p.gtin, '2027-12-31', 'LOT7', 'SN100004']);
  assert.equal(parseGs1('(01)08961234567895(17)280200(21)X').expiry_date, '2028-02-29', 'day 00 = last day of month');
  const s = ctx.h.get(`SELECT * FROM serials WHERE gtin = ? AND status = 'valid' LIMIT 1`, p.gtin);
  const relabelled = await call('POST', '/pharmacy/verify-pack', { body: { code: `(01)${p.gtin}(17)200101(21)${s.serial}` } });
  assert.equal(relabelled.data.verdict, 'mismatch');
  const typo = `${p.gtin.slice(0, 13)}${(Number(p.gtin[13]) + 1) % 10}`;
  assert.equal((await call('POST', '/pharmacy/verify-pack', { body: { code: `(01)${typo}(21)${s.serial}` } })).data.verdict, 'invalid_code');
  assert.equal((await call('POST', '/pharmacy/verify-pack', { body: { code: `(01)${p.gtin}(21)${s.serial}` } })).data.verdict, 'genuine');
});

test('TOTP matches RFC 6238 test vectors', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp(secret, 59_000, 30, 8), '94287082');
  assert.equal(totp(secret, 1_111_111_109_000, 30, 8), '07081804');
  assert.ok(verifyTotp(secret, totp(secret, Date.now() - 30_000)), 'one step of clock drift allowed');
  assert.equal(verifyTotp(secret, totp(secret, Date.now() - 120_000)), false);
});

test('two-step sign-in: setup, enable, login needs code, wrong code rejected, secret encrypted', async () => {
  const phone = '03070000002';
  const first = await call('POST', '/auth/login', { body: { phone, password: STAFF_PASSWORD } });
  assert.equal(first.status, 200); assert.equal(first.data.mfa_recommended, true);
  tokens.prog = first.data.token;
  const setup = await call('POST', '/auth/mfa/setup', { as: 'prog' });
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  assert.equal((await call('POST', '/auth/mfa/enable', { as: 'prog', body: { otp: '000000' } })).status, 400);
  const en = await call('POST', '/auth/mfa/enable', { as: 'prog', body: { otp: totp(setup.data.secret) } });
  assert.equal(en.data.user.mfa_enabled, true);
  assert.ok(!ctx.h.get('SELECT mfa_secret_enc FROM users WHERE phone = ?', phone).mfa_secret_enc.includes(setup.data.secret));
  const noCode = await call('POST', '/auth/login', { body: { phone, password: STAFF_PASSWORD } });
  assert.equal(noCode.status, 401); assert.equal(noCode.data.mfa_required, true); assert.ok(!noCode.data.token);
  assert.equal((await call('POST', '/auth/login', { body: { phone, password: STAFF_PASSWORD, otp: '123456' } })).status, 401);
  const ok = await call('POST', '/auth/login', { body: { phone, password: STAFF_PASSWORD, otp: totp(setup.data.secret) } });
  assert.equal(ok.status, 200); assert.ok(ok.data.token);
});

test('prescription photo: encrypted, type-checked, visible only to patient (or dispensing pharmacist)', async () => {
  const product = ctx.h.get(`SELECT id FROM products WHERE schedule = 'G' LIMIT 1`);
  const rx = await call('POST', '/pharmacy/prescriptions', { as: 'bilal', body: { items: [{ product_id: product.id, qty: 1 }] } });
  assert.equal(rx.status, 201);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
  const url = `/pharmacy/prescriptions/${rx.data.id}/images`;
  assert.equal((await call('POST', url, { as: 'bilal', body: { image: `data:image/jpeg;base64,${Buffer.from('hello world').toString('base64')}` } })).status, 400, 'magic bytes checked');
  const up = await call('POST', url, { as: 'bilal', body: { image: `data:image/jpeg;base64,${jpeg.toString('base64')}` } });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const stored = ctx.h.get('SELECT data_enc FROM rx_images WHERE id = ?', up.data.id).data_enc;
  assert.ok(stored.startsWith('v1.') && !stored.includes(jpeg.toString('base64').slice(0, 24)));
  assert.equal((await call('POST', url, { as: 'ayesha', body: { image: `data:image/jpeg;base64,${jpeg.toString('base64')}` } })).status, 404, 'another patient’s Rx: 404, so its existence is not revealed');
  const get = (who) => fetch(`${base}/api/pharmacy/rx-images/${up.data.id}`, { headers: { authorization: `Bearer ${tokens[who]}` } });
  const mine = await get('bilal');
  assert.equal(mine.status, 200); assert.equal(mine.headers.get('content-type'), 'image/jpeg'); assert.equal(mine.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await mine.arrayBuffer()), jpeg);
  for (const who of ['ayesha', 'pharmacist']) assert.equal((await get(who)).status, 404, `${who} has no basis`);
  assert.ok(ctx.h.get(`SELECT 1 FROM audit_log WHERE action = 'rx.image_view' AND patient_id = ?`, rx.data.patient_id));
});

test('real facility import: OSM places are unverified, ranked after verified, never ambulance destinations', async () => {
  const at = { lat: 24.9, lng: 67.1 };
  const r = importHealthsites(ctx.db, { features: [
    { geometry: { type: 'Point', coordinates: [at.lng, at.lat] }, properties: { osm_id: 1, osm_type: 'node', amenity: 'hospital', name: 'OSM Test Hospital', emergency: 'yes' } },
    { geometry: { type: 'Point', coordinates: [67.0, 24.86] }, properties: { osm_id: 2, amenity: 'dentist', name: 'Smile <b>Dental</b>' } },
    { geometry: { type: 'Point', coordinates: [10, 10] }, properties: { osm_id: 3, amenity: 'hospital', name: 'Outside Pakistan' } },
    { geometry: { type: 'Point', coordinates: [67, 24.8] }, properties: { osm_id: 4, amenity: 'toilets', name: 'Not health' } },
  ] });
  assert.deepEqual([r.added, r.skipped], [2, 2]);
  const osm = ctx.h.get(`SELECT * FROM facilities WHERE osm_id = 'node/1'`);
  assert.deepEqual([osm.verified, osm.source, osm.city], [0, 'osm', 'Karachi']);
  assert.equal(ctx.h.get(`SELECT name FROM facilities WHERE osm_id = 'node/2'`).name, 'Smile bDental/b', 'markup stripped');
  assert.equal(importHealthsites(ctx.db, { features: [{ geometry: { type: 'Point', coordinates: [at.lng, at.lat] }, properties: { osm_id: 1, amenity: 'hospital', name: 'OSM Test Hospital' } }] }).updated, 1);
  ctx.h.run('UPDATE facilities SET beds_free = 50, beds_total = 50, emergency = 1 WHERE id = ?', osm.id);
  const q = await call('POST', '/emergency/quote', { body: { ...at, severity: 1 } });
  assert.equal(q.status, 200);
  assert.notEqual(q.data.destination?.id, osm.id);
  const list = await call('GET', '/facilities?type=hospital&limit=5');
  assert.ok(list.data.length <= 5);
  assert.equal(list.data[0].verified, 1, 'verified first');
});

test('retention: emergencies older than 90 days lose exact location, phone and complaint', () => {
  const old = ctx.h.run(`INSERT INTO emergencies (contact_phone, lat, lng, severity, complaint, status, created_at) VALUES ('03001112223', 24.861234, 67.001234, 2, 'chest pain', 'closed', datetime('now', '-91 days'))`).lastInsertRowid;
  const recent = ctx.h.run(`INSERT INTO emergencies (contact_phone, lat, lng, severity, status, created_at) VALUES ('03001112224', 24.861234, 67.001234, 2, 'closed', datetime('now', '-10 days'))`).lastInsertRowid;
  assert.ok(runRetention(ctx.h).emergencies_coarsened >= 1);
  const e = ctx.h.get('SELECT * FROM emergencies WHERE id = ?', old);
  assert.deepEqual([e.lat, e.lng, e.contact_phone, e.complaint], [24.86, 67, null, null]);
  assert.equal(ctx.h.get('SELECT contact_phone FROM emergencies WHERE id = ?', recent).contact_phone, '03001112224');
  assert.equal(runRetention(ctx.h).emergencies_coarsened, 0, 'idempotent');
});

test('WhatsApp Cloud API: simulated until configured, correct template payload when live', async () => {
  assert.equal((await sendWhatsApp('03001234567', 'hi')).simulated, true);
  process.env.WHATSAPP_TOKEN = 'test-token'; process.env.WHATSAPP_PHONE_ID = '12345';
  try {
    let seen;
    const r = await sendWhatsApp('0300-1234567', 'Ambulance coming', { fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; } });
    assert.equal(seen.url, 'https://graph.facebook.com/v21.0/12345/messages');
    const body = JSON.parse(seen.opts.body);
    assert.deepEqual([body.to, body.type, body.template.components[0].parameters[0].text], ['923001234567', 'template', 'Ambulance coming']);
    assert.equal(seen.opts.headers.Authorization, 'Bearer test-token');
    assert.equal(r.id, 'wamid.1');
  } finally { delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_ID; }
});
