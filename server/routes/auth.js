import express from 'express';
import { hashPassword, verifyPassword, hmac, encrypt, decrypt } from '../lib/crypto.js';
import { newSecret, verifyTotp, otpauthUri } from '../lib/totp.js';
import { publicUser, rateLimit } from '../lib/auth.js';
import { validate, bad, isCnic, normCnic, isPkPhone, normPhone, HttpError } from '../lib/validate.js';

export const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function authRoutes({ h, auth, audit }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: 20, key: 'auth' });

  r.post('/register', limiter, (req, res) => {
    const b = validate(req.body, {
      name: 'string', phone: 'string', password: 'string', cnic: 'string?',
      gender: ['female', 'male', 'other', '?'], birth_year: 'int?', province: [...PROVINCES, '?'], city: 'string?',
      lang: ['en', 'ur', '?'], consent_terms: 'bool',
    });
    if (!b.consent_terms) throw bad('You must accept the privacy notice to create an account');
    if (!isPkPhone(b.phone)) throw bad('Enter a valid Pakistani mobile number, e.g. 03001234567');
    if (b.password.length < 8) throw bad('Password must be at least 8 characters');
    if (b.cnic && !isCnic(b.cnic)) throw bad('CNIC must be 13 digits, e.g. 35202-1234567-1');
    const phone = normPhone(b.phone);
    if (h.get('SELECT id FROM users WHERE phone = ?', phone)) throw new HttpError(409, 'This phone number is already registered');
    const cnicHash = b.cnic ? hmac(normCnic(b.cnic)) : null;
    if (cnicHash && h.get('SELECT id FROM users WHERE cnic_hash = ?', cnicHash)) throw new HttpError(409, 'This CNIC is already registered');

    const info = h.run(
      `INSERT INTO users (name, phone, cnic_hash, cnic_last4, password_hash, role, gender, birth_year, province, city, lang)
       VALUES (?,?,?,?,?,'patient',?,?,?,?,?)`,
      b.name, phone, cnicHash, b.cnic ? normCnic(b.cnic).slice(-4) : null, hashPassword(b.password),
      b.gender ?? null, b.birth_year ?? null, b.province ?? null, b.city ?? null, b.lang ?? 'en',
    );
    const user = h.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
    audit.log({ user, ip: req.ip }, 'account.register', { resource: 'user', resourceId: user.id, patientId: user.id });
    res.status(201).json({ user: publicUser(user), ...auth.createSession(user) });
  });

  r.post('/login', limiter, (req, res) => {
    const b = validate(req.body, { phone: 'string', password: 'string', otp: 'string?' });
    const phone = isPkPhone(b.phone) ? normPhone(b.phone) : b.phone;
    const user = h.get('SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL', phone);
    if (!user || !verifyPassword(b.password, user.password_hash)) {
      audit.log(req, 'auth.login_failed', { detail: { phone: phone.slice(0, 4) + '•••' } });
      throw new HttpError(401, 'Wrong phone number or password');
    }
    // Staff with two-step sign-in must also give a code from their authenticator app.
    if (user.mfa_enabled) {
      if (!b.otp) throw new HttpError(401, 'Enter the 6-digit code from your authenticator app', undefined, { mfa_required: true });
      if (!verifyTotp(decrypt(user.mfa_secret_enc, `mfa:${user.id}`), b.otp)) {
        audit.log({ user, ip: req.ip }, 'auth.mfa_failed', { resource: 'user', resourceId: user.id });
        throw new HttpError(401, 'That code is wrong or expired', undefined, { mfa_required: true });
      }
    }
    audit.log({ user, ip: req.ip }, 'auth.login', { resource: 'user', resourceId: user.id, detail: user.mfa_enabled ? { mfa: true } : undefined });
    const staffNoMfa = user.role !== 'patient' && !user.mfa_enabled;
    res.json({ user: publicUser(user), ...auth.createSession(user), ...(staffNoMfa ? { mfa_recommended: true } : {}) });
  });

  // ── Two-step sign-in (TOTP) — offered to everyone, recommended for all staff ──
  const noActAs = (req, _res, next) => next(req.guardian ? bad('Switch back to your own profile first') : undefined);
  r.use('/mfa', noActAs);
  r.post('/mfa/setup', auth.requireAuth, (req, res) => {
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (u.mfa_enabled) throw bad('Two-step sign-in is already on');
    const secret = newSecret();
    h.run('UPDATE users SET mfa_secret_enc = ? WHERE id = ?', encrypt(secret, `mfa:${u.id}`), u.id);
    res.json({ secret, uri: otpauthUri(secret, u.phone) });
  });

  r.post('/mfa/enable', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { otp: 'string' });
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.mfa_secret_enc) throw bad('Start setup first');
    if (!verifyTotp(decrypt(u.mfa_secret_enc, `mfa:${u.id}`), b.otp)) throw bad('That code is wrong — check your phone’s clock and try the newest code');
    h.run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', u.id);
    audit.log(req, 'auth.mfa_enabled', { resource: 'user', resourceId: u.id });
    res.json({ user: publicUser(h.get('SELECT * FROM users WHERE id = ?', u.id)) });
  });

  r.post('/mfa/disable', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { otp: 'string' });
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.mfa_enabled || !verifyTotp(decrypt(u.mfa_secret_enc, `mfa:${u.id}`), b.otp)) throw bad('Enter a current code to turn this off');
    h.run('UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL WHERE id = ?', u.id);
    audit.log(req, 'auth.mfa_disabled', { resource: 'user', resourceId: u.id });
    res.json({ user: publicUser(h.get('SELECT * FROM users WHERE id = ?', u.id)) });
  });

  r.post('/logout', auth.requireAuth, (req, res) => {
    auth.destroySession(req.token);
    res.json({ ok: true });
  });

  r.get('/me', auth.requireAuth, (req, res) => res.json({ user: req.user }));

  r.patch('/me', auth.requireAuth, (req, res) => {
    const b = validate(req.body, {
      name: 'string?', city: 'string?', province: [...PROVINCES, '?'], lang: ['en', 'ur', '?'],
      blood_group: [...BLOOD, '?'], blood_donor: 'bool?', cnic: 'string?',
      gender: ['female', 'male', 'other', '?'], birth_year: 'int?',
      emergency_contact_name: 'string?', emergency_contact_phone: 'string?', pref_female_doctor: 'bool?', camp_alerts: 'bool?', last_donation_date: 'string?',
    });
    if (b.emergency_contact_phone && !isPkPhone(b.emergency_contact_phone)) throw bad('Emergency contact must be a Pakistani mobile number');
    if (b.emergency_contact_phone) b.emergency_contact_phone = normPhone(b.emergency_contact_phone);
    if (b.last_donation_date && (!/^\d{4}-\d{2}-\d{2}$/.test(b.last_donation_date) || b.last_donation_date > new Date().toISOString().slice(0, 10))) throw bad('Last donation date must be a past date');
    if (b.cnic && req.guardian) throw bad('Add a CNIC from the family member’s own account');
    if (b.cnic) {
      if (!isCnic(b.cnic)) throw bad('CNIC must be 13 digits');
      const hsh = hmac(normCnic(b.cnic));
      const other = h.get('SELECT id FROM users WHERE cnic_hash = ? AND id != ?', hsh, req.user.id);
      if (other) throw new HttpError(409, 'This CNIC is linked to another account');
      h.run('UPDATE users SET cnic_hash = ?, cnic_last4 = ? WHERE id = ?', hsh, normCnic(b.cnic).slice(-4), req.user.id);
      delete b.cnic;
    }
    for (const [k, v] of Object.entries(b)) {
      h.run(`UPDATE users SET ${k} = ? WHERE id = ?`, typeof v === 'boolean' ? Number(v) : v, req.user.id);
    }
    audit.log(req, 'account.update', { resource: 'user', resourceId: req.user.id, patientId: req.user.id, detail: { fields: Object.keys(req.body || {}) } });
    res.json({ user: publicUser(h.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  });

  // Directory of verified doctors (for e-prescriptions, consent grants, community badges)
  r.get('/doctors', (req, res) => {
    res.json(h.all(`SELECT id, name, city, gender, pmdc_no FROM users WHERE role = 'doctor' AND verified = 1 AND deleted_at IS NULL ORDER BY name`));
  });

  return r;
}
