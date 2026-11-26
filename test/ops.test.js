// Operations: web push, backups, erasure covering family members, FHIR export with family, HTTPS redirect.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setKeysForTest } from '../server/lib/crypto.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD, STAFF_PASSWORD } from '../server/seed.js';
import { loadVapid, setVapidForTest, validEndpoint, vapidJwt, sendPush, dueDoseUsers } from '../server/lib/push.js';
import { backupNow } from '../server/lib/backup.js';

let server, base, ctx, tmp;
const tokens = {};
async function call(method, p, { body, as, actAs } = {}) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (as) h.authorization = `Bearer ${tokens[as]}`;
  if (actAs) h['x-act-as'] = String(actAs);
  const res = await fetch(base + '/api' + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
before(async () => {
  setKeysForTest();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-ops-'));
  setVapidForTest(null); loadVapid(tmp);
  const created = createApp({ db: openDb(':memory:') });
  ctx = created.ctx;
  seed(ctx);
  await new Promise((r) => { server = created.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, phone, pw] of [['ayesha', '03001234567', DEMO_PASSWORD], ['usman', '03331234567', DEMO_PASSWORD], ['admin', '03070000001', STAFF_PASSWORD]]) {
    tokens[k] = (await call('POST', '/auth/login', { body: { phone, password: pw } })).data.token;
  }
});
after(() => { server?.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold a file briefly */ } });

test('push: only real push services accepted (SSRF guard); VAPID JWT verifies; empty payload', async () => {
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(validEndpoint('https://web.push.apple.com/QGx'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com:8443/x', 'file:///etc/passwd']) {
    assert.equal(validEndpoint(bad), false, bad);
  }
  assert.equal((await call('POST', '/care/push', { as: 'ayesha', body: { endpoint: 'https://evil.com/steal' } })).status, 400);
  assert.equal((await call('POST', '/care/push', { as: 'ayesha', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/test1' } })).status, 201);
  const cfg = await call('GET', '/config');
  assert.match(cfg.data.vapidPublicKey, /^[A-Za-z0-9_-]{87}$/, '65-byte uncompressed P-256 key, base64url');

  // JWT signature verifies with the public key
  const jwt = vapidJwt('https://fcm.googleapis.com');
  const [h, p, s] = jwt.split('.');
  const pub = Buffer.from(cfg.data.vapidPublicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');

  let seen;
  const r = await sendPush('https://fcm.googleapis.com/fcm/send/test1', { fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, status: 201 }; } });
  assert.equal(r, 'ok');
  assert.equal(seen.opts.body, undefined, 'no payload — nothing medical leaves the server');
  assert.match(seen.opts.headers.Authorization, /^vapid t=.+, k=/);
  assert.equal(await sendPush('https://fcm.googleapis.com/fcm/send/test1', { fetchImpl: async () => ({ ok: false, status: 410 }) }), 'gone');
});

test('push: due-dose users include guardians of family members, exclude doses already logged', () => {
  const ay = ctx.h.get(`SELECT id FROM users WHERE phone = '03001234567'`).id;
  const kid = ctx.h.get('SELECT id FROM users WHERE guardian_id = ?', ay).id;
  const now = new Date('2026-11-26T03:00:00Z'); // 08:00 in Pakistan
  ctx.h.run(`INSERT INTO med_schedules (user_id, name, times, start_date) VALUES (?, 'Syrup', '["08:00"]', '2026-11-01')`, kid);
  const due = dueDoseUsers(ctx.h, now);
  assert.ok(due.includes(ay), 'guardian notified for child’s dose (and for her own 08:00 dose)');
  for (const s of ctx.h.all(`SELECT id, user_id FROM med_schedules WHERE times LIKE '%"08:00"%'`)) {
    ctx.h.run(`INSERT OR IGNORE INTO dose_log (schedule_id, user_id, slot, status) VALUES (?, ?, '2026-11-26 08:00', 'taken')`, s.id, s.user_id);
  }
  assert.equal(dueDoseUsers(ctx.h, now).length, 0, 'logged doses are not re-notified');
});

test('backup: consistent snapshot, readable, rotated', () => {
  const dir = path.join(tmp, 'bk');
  const db = openDb(path.join(tmp, 'live.db'));
  db.exec(`INSERT INTO users (name, phone, password_hash) VALUES ('X', '03009999999', 'x')`);
  let last;
  for (let i = 0; i < 4; i++) { last = backupNow(db, dir, 2); fs.utimesSync(last.file, new Date(), new Date()); }
  const files = fs.readdirSync(dir);
  assert.ok(files.length <= 2, `rotation keeps 2, found ${files.length}`);
  const snap = new DatabaseSync(last.file, { readOnly: true });
  assert.equal(Object.values(snap.prepare('PRAGMA integrity_check').get())[0], 'ok');
  assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  snap.close(); db.close();
});

test('erasure covers family members; export includes them', async () => {
  const kid = await call('POST', '/care/family', { as: 'usman', body: { name: 'Hira Tariq', relation: 'child', birth_year: 2015 } });
  await call('POST', '/records', { as: 'usman', actAs: kid.data.id, body: { type: 'note', title: 'Kid note', data: { text: 'x' } } });
  await call('POST', '/care/schedules', { as: 'usman', actAs: kid.data.id, body: { name: 'Syrup', times: ['09:00'] } });
  const ex = await fetch(`${base}/api/records/export`, { headers: { authorization: `Bearer ${tokens.usman}` } }).then((r) => r.json());
  assert.ok(ex.entry.some((e) => e.resource.resourceType === 'Patient' && e.resource.name[0].text === 'Hira Tariq'), 'family in export');
  const req = await call('POST', '/privacy/requests', { as: 'usman', body: { kind: 'delete', detail: 'please delete' } });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  const reqId = ctx.h.get(`SELECT id FROM data_requests WHERE kind = 'delete' ORDER BY id DESC`).id;
  assert.equal((await call('POST', `/admin/data-requests/${reqId}/close`, { as: 'admin' })).status, 200);
  const k = ctx.h.get('SELECT * FROM users WHERE id = ?', kid.data.id);
  assert.equal(k.name, 'Deleted user'); assert.ok(k.deleted_at);
  assert.equal(ctx.h.get('SELECT COUNT(*) AS n FROM records WHERE patient_id = ?', kid.data.id).n, 0);
  assert.equal(ctx.h.get('SELECT COUNT(*) AS n FROM med_schedules WHERE user_id = ?', kid.data.id).n, 0);
  const u = ctx.h.get(`SELECT * FROM users WHERE id = (SELECT user_id FROM data_requests WHERE id = ?)`, reqId);
  assert.equal(u.emergency_contact_phone, null); assert.equal(u.name, 'Deleted user');
});

test('FORCE_HTTPS redirects plain HTTP (health check exempt)', async () => {
  process.env.FORCE_HTTPS = '1';
  const { app } = createApp({ db: openDb(':memory:') });
  delete process.env.FORCE_HTTPS;
  const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  try {
    const port = s.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/#/care`, { redirect: 'manual' });
    assert.equal(r.status, 308); assert.match(r.headers.get('location'), /^https:\/\//);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
    const behindProxy = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(behindProxy.status, 200, 'trusted loopback proxy saying https is accepted');
  } finally { s.close(); }
});
