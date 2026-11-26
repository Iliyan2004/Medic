// Sessions + role-based access control.
import { randomToken, sha256 } from './crypto.js';
import { HttpError } from './validate.js';

export const ROLES = ['patient', 'doctor', 'pharmacist', 'insurer', 'dispatcher', 'facility_admin', 'program_admin', 'admin'];
const STAFF_SESSION_HOURS = 12;
const PATIENT_SESSION_HOURS = 24 * 7;

export function makeAuth(h) {
  function createSession(user) {
    const token = randomToken();
    const hours = user.role === 'patient' ? PATIENT_SESSION_HOURS : STAFF_SESSION_HOURS;
    const expires = new Date(Date.now() + hours * 3600_000).toISOString();
    h.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), user.id, expires);
    return { token, expires };
  }

  function destroySession(token) {
    h.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  }

  // Attaches req.user if a valid bearer token is present. Never throws.
  function attachUser(req, _res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const row = h.get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
        sha256(token), new Date().toISOString(),
      );
      if (row) {
        req.user = publicUser(row); req.token = token;
        // Family profiles: a patient may act for a dependant they are guardian of (X-Act-As header).
        const actAs = Number(req.get('x-act-as'));
        if (actAs && actAs !== row.id && row.role === 'patient') {
          const dep = h.get('SELECT * FROM users WHERE id = ? AND guardian_id = ? AND deleted_at IS NULL', actAs, row.id);
          if (dep) { req.guardian = req.user; req.user = publicUser(dep); }
        }
      }
    }
    next();
  }

  const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in')));

  const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (!roles.includes(req.user.role) && req.user.role !== 'admin') return next(new HttpError(403, 'Your role cannot do this'));
    next();
  };

  return { createSession, destroySession, attachUser, requireAuth, requireRole };
}

export function publicUser(u) {
  return {
    id: u.id, name: u.name, phone: u.phone, role: u.role, gender: u.gender, birth_year: u.birth_year,
    province: u.province, city: u.city, lang: u.lang, verified: !!u.verified, org_id: u.org_id,
    pmdc_no: u.pmdc_no, cnic_last4: u.cnic_last4, blood_group: u.blood_group, blood_donor: !!u.blood_donor,
    mfa_enabled: !!u.mfa_enabled, guardian_id: u.guardian_id ?? null, relation: u.relation ?? null,
    emergency_contact_name: u.emergency_contact_name ?? null, emergency_contact_phone: u.emergency_contact_phone ?? null,
    pref_female_doctor: !!u.pref_female_doctor, camp_alerts: !!u.camp_alerts, last_donation_date: u.last_donation_date ?? null,
  };
}

// Simple in-memory fixed-window rate limiter (per IP + key). Use Redis in a multi-instance deployment.
export function rateLimit({ windowMs, max, key = 'global' }) {
  const hits = new Map();
  return (req, _res, next) => {
    const k = `${key}:${req.ip}`;
    const now = Date.now();
    const e = hits.get(k);
    if (!e || now - e.start > windowMs) hits.set(k, { start: now, count: 1 });
    else if (++e.count > max) return next(new HttpError(429, 'Too many attempts — please wait and try again'));
    if (hits.size > 10000) hits.clear();
    next();
  };
}
