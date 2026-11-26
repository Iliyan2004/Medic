// Cryptography helpers: password hashing, field-level encryption, keyed hashing, tokens.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let KEYS = null;

/**
 * Keys come from env in production (DATA_KEY, HMAC_KEY: 64 hex chars each, from a KMS / secret store).
 * In development we generate them once into data/dev-keys.json (gitignored) and warn loudly.
 */
export function loadKeys(dataDir) {
  if (KEYS) return KEYS;
  let dataKey = process.env.DATA_KEY;
  let hmacKey = process.env.HMAC_KEY;
  if (!dataKey || !hmacKey) {
    if (process.env.NODE_ENV === 'production') throw new Error('DATA_KEY and HMAC_KEY must be set in production');
    const file = path.join(dataDir, 'dev-keys.json');
    if (fs.existsSync(file)) {
      ({ dataKey, hmacKey } = JSON.parse(fs.readFileSync(file, 'utf8')));
    } else {
      dataKey = crypto.randomBytes(32).toString('hex');
      hmacKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ dataKey, hmacKey }), { mode: 0o600 });
    }
    console.warn('[sehatyab] Using development encryption keys from data/dev-keys.json — set DATA_KEY and HMAC_KEY in production.');
  }
  // 64 hex chars are used as-is; any other secret of 32+ characters (e.g. a host-generated random value)
  // is turned into a 32-byte key with SHA-256.
  const toKey = (k, name) => {
    if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, 'hex');
    if (String(k).length < 32) throw new Error(`${name} must be 64 hex chars or a random secret of at least 32 characters`);
    return crypto.createHash('sha256').update(String(k)).digest();
  };
  KEYS = { data: toKey(dataKey, 'DATA_KEY'), hmac: toKey(hmacKey, 'HMAC_KEY') };
  return KEYS;
}

export function setKeysForTest() {
  KEYS = { data: crypto.randomBytes(32), hmac: crypto.randomBytes(32) };
}

// AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). Associated data binds a value to its owner row.
export function encrypt(obj, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEYS.data, iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(blob, aad = '') {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown ciphertext version');
  const d = crypto.createDecipheriv('aes-256-gcm', KEYS.data, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
}

// Keyed hash: lets us look up a CNIC without storing it.
export function hmac(value) {
  return crypto.createHmac('sha256', KEYS.hmac).update(String(value)).digest('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Short human-readable share code, e.g. "K7Q-4MZ-9TD" (no ambiguous chars).
export function shareCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(9);
  let s = '';
  for (let i = 0; i < 9; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
}

// scrypt password hashing (memory-hard, built into Node).
const SCRYPT = { N: 16384, r: 8, p: 1 };
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = crypto.scryptSync(pw, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}
