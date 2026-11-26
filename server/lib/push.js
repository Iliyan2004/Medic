// Web Push (RFC 8030 + VAPID RFC 8292) with node:crypto only — no library.
// Privacy by design: pushes carry NO payload. The phone shows a generic "time for your medicine" alert,
// so no health information ever passes through Google / Apple / Mozilla push servers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let VAPID = null;

/** Keys from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, base64url) or generated once into data/vapid.json. */
export function loadVapid(dataDir) {
  if (VAPID) return VAPID;
  let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const file = path.join(dataDir, 'vapid.json');
    if (fs.existsSync(file)) ({ pub, priv } = JSON.parse(fs.readFileSync(file, 'utf8')));
    else {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
      pub = ecdh.getPublicKey().toString('base64url'); priv = ecdh.getPrivateKey().toString('base64url');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ pub, priv }), { mode: 0o600 });
    }
  }
  const p = Buffer.from(pub, 'base64url');
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33, 65).toString('base64url') }, format: 'jwk' });
  VAPID = { publicKey: pub, key, subject: process.env.VAPID_SUBJECT || 'https://sehatyab.pk/contact' };
  return VAPID;
}
export const setVapidForTest = (v) => { VAPID = v; };
export const vapidPublicKey = () => VAPID?.publicKey ?? null;

// Only real browser push services — the server never POSTs to arbitrary URLs (SSRF guard).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];
export function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

export function vapidJwt(audience, now = Math.floor(Date.now() / 1000)) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: now + 12 * 3600, sub: VAPID.subject })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: VAPID.key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${sig.toString('base64url')}`;
}

/** Sends an empty ("tickle") push. Returns 'ok' | 'gone' (subscription expired) | 'error'. */
export async function sendPush(endpoint, { urgency = 'high', ttl = 3600, fetchImpl = globalThis.fetch } = {}) {
  if (!VAPID || !validEndpoint(endpoint)) return 'error';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetchImpl(endpoint, {
      method: 'POST', signal: ctrl.signal,
      headers: { TTL: String(ttl), Urgency: urgency, 'Content-Length': '0', Authorization: `vapid t=${vapidJwt(new URL(endpoint).origin)}, k=${VAPID.publicKey}` },
    });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'error';
  } catch { return 'error'; } finally { clearTimeout(timer); }
}

const pkNow = (d = new Date()) => new Date(d.getTime() + 5 * 3600_000).toISOString(); // Pakistan time (UTC+5)

/** Every minute: push to users with a dose due now that isn't logged yet. Deduped per slot. */
export function dueDoseUsers(h, now = new Date()) {
  const iso = pkNow(now);
  const day = iso.slice(0, 10), hm = iso.slice(11, 16);
  return h.all(`SELECT DISTINCT COALESCE(u.guardian_id, s.user_id) AS notify_id FROM med_schedules s JOIN users u ON u.id = s.user_id
    WHERE s.active = 1 AND u.deleted_at IS NULL AND s.times LIKE ? AND NOT EXISTS (SELECT 1 FROM dose_log d WHERE d.schedule_id = s.id AND d.slot = ?)`,
  `%"${hm}"%`, `${day} ${hm}`).map((r) => r.notify_id);
}

export function scheduleDosePushes(h, log = console.log) {
  const sent = new Set();
  const tick = async () => {
    const slot = pkNow().slice(0, 16);
    for (const uid of dueDoseUsers(h)) {
      if (sent.has(`${uid}@${slot}`)) continue;
      sent.add(`${uid}@${slot}`);
      for (const s of h.all('SELECT * FROM push_subs WHERE user_id = ?', uid)) {
        const r = await sendPush(s.endpoint);
        if (r === 'gone') h.run('DELETE FROM push_subs WHERE id = ?', s.id);
      }
    }
    if (sent.size > 5000) sent.clear();
  };
  const t = setInterval(() => tick().catch((e) => log(`[push] ${e.message}`)), 60_000);
  t.unref();
  return t;
}
