// Platform administration: verification of doctors (PMDC), pharmacies (drug sale licence) and
// facilities (healthcare commission licence), staff accounts, audit log, data-subject requests.
import express from 'express';
import { validate, bad, notFound, isPkPhone, normPhone, HttpError } from '../lib/validate.js';
import { hashPassword } from '../lib/crypto.js';
import { ROLES, publicUser } from '../lib/auth.js';
import { notifyCampAlerts } from '../lib/alerts.js';

/**
 * Right to erasure. Health data, reminders, photos, contacts and push subscriptions are deleted; records the law
 * requires (dispensing registers, insurance claims, ledger) keep the transaction but lose the identity.
 */
export function anonymiseUser(h, id) {
  h.run('DELETE FROM records WHERE patient_id = ?', id);
  h.run('DELETE FROM rx_images WHERE patient_id = ?', id);
  h.run('DELETE FROM dose_log WHERE user_id = ?', id);
  h.run('DELETE FROM med_schedules WHERE user_id = ?', id);
  h.run('DELETE FROM push_subs WHERE user_id = ?', id);
  h.run('DELETE FROM sessions WHERE user_id = ?', id);
  h.run('DELETE FROM share_tokens WHERE patient_id = ?', id);
  h.run(`UPDATE consents SET revoked_at = datetime('now') WHERE patient_id = ? AND revoked_at IS NULL`, id);
  h.run(`UPDATE appointments SET reason = '[deleted]', note = NULL WHERE patient_id = ?`, id);
  h.run(`UPDATE lab_bookings SET address = NULL WHERE patient_id = ?`, id);
  h.run(`UPDATE orders SET address = '[deleted]' WHERE patient_id = ?`, id);
  h.run(`UPDATE emergencies SET contact_phone = NULL, complaint = NULL WHERE requester_id = ?`, id);
  h.run(`UPDATE users SET name = 'Deleted user', phone = 'deleted-' || id, cnic_hash = NULL, cnic_last4 = NULL, city = NULL, province = NULL,
    birth_year = NULL, gender = NULL, blood_group = NULL, blood_donor = 0, last_donation_date = NULL, emergency_contact_name = NULL,
    emergency_contact_phone = NULL, mfa_secret_enc = NULL, mfa_enabled = 0, camp_alerts = 0, deleted_at = datetime('now') WHERE id = ?`, id);
  h.run(`UPDATE posts SET anonymous = 1 WHERE author_id = ?`, id);
}

export default function adminRoutes({ h, auth, audit }) {
  const r = express.Router();
  r.use(auth.requireRole('admin'));

  r.get('/stats', (_req, res) => {
    const c = (sql) => h.get(sql).n;
    res.json({
      users: h.all('SELECT role, COUNT(*) AS n FROM users WHERE deleted_at IS NULL GROUP BY role'),
      facilities: c('SELECT COUNT(*) AS n FROM facilities'),
      camps_active: c(`SELECT COUNT(*) AS n FROM facilities WHERE type='camp' AND ends_at >= datetime('now')`),
      orders: c('SELECT COUNT(*) AS n FROM orders'),
      claims_review: c(`SELECT COUNT(*) AS n FROM claims WHERE status='under_review'`),
      emergencies_active: c(`SELECT COUNT(*) AS n FROM emergencies WHERE status IN ('requested','dispatched','on_scene','transporting')`),
      records: c('SELECT COUNT(*) AS n FROM records'),
      flagged_posts: c(`SELECT COUNT(*) AS n FROM posts WHERE status='flagged'`),
      open_data_requests: c(`SELECT COUNT(*) AS n FROM data_requests WHERE status='open'`),
      break_glass_30d: c(`SELECT COUNT(*) AS n FROM audit_log WHERE action='records.break_glass' AND ts >= datetime('now','-30 days')`),
    });
  });

  r.get('/verifications', (_req, res) => {
    res.json({
      doctors: h.all(`SELECT id, name, phone, pmdc_no, city FROM users WHERE role='doctor' AND verified=0 AND deleted_at IS NULL`),
      pharmacists: h.all(`SELECT id, name, phone, license_no, city FROM users WHERE role='pharmacist' AND verified=0 AND deleted_at IS NULL`),
      pharmacies: h.all('SELECT * FROM pharmacies WHERE verified=0'),
      facilities: h.all(`SELECT id, name, type, city, license_no, organizer, starts_at, ends_at FROM facilities WHERE verified=0 AND (source IS NULL OR source != 'osm') LIMIT 200`),
    });
  });

  r.post('/verify/:kind/:id', (req, res) => {
    const b = validate(req.body, { approve: 'bool' });
    const table = { user: 'users', pharmacy: 'pharmacies', facility: 'facilities' }[req.params.kind];
    if (!table) throw bad('Unknown kind');
    if (b.approve) {
      h.run(`UPDATE ${table} SET verified = 1 WHERE id = ?`, req.params.id);
      if (table === 'facilities') notifyCampAlerts(h, h.get('SELECT * FROM facilities WHERE id = ?', req.params.id));
    }
    else if (table === 'facilities') h.run('DELETE FROM facilities WHERE id = ? AND verified = 0', req.params.id);
    audit.log(req, `verify.${req.params.kind}`, { resource: table, resourceId: req.params.id, detail: { approve: b.approve } });
    res.json({ ok: true });
  });

  r.post('/staff', (req, res) => {
    const b = validate(req.body, { name: 'string', phone: 'string', password: 'string', role: ROLES.filter((x) => x !== 'patient'), org_id: 'int?', pmdc_no: 'string?', license_no: 'string?', city: 'string?' });
    if (!isPkPhone(b.phone)) throw bad('Invalid phone');
    if (b.password.length < 12) throw bad('Staff passwords must be at least 12 characters');
    if (b.role === 'doctor' && !b.pmdc_no) throw bad('Doctors need a PMDC registration number');
    const phone = normPhone(b.phone);
    if (h.get('SELECT id FROM users WHERE phone = ?', phone)) throw new HttpError(409, 'Phone already registered');
    const info = h.run(`INSERT INTO users (name, phone, password_hash, role, org_id, pmdc_no, license_no, city, verified) VALUES (?,?,?,?,?,?,?,?,?)`,
      b.name, phone, hashPassword(b.password), b.role, b.org_id ?? null, b.pmdc_no ?? null, b.license_no ?? null, b.city ?? null, b.role === 'doctor' ? 0 : 1);
    audit.log(req, 'staff.create', { resource: 'user', resourceId: info.lastInsertRowid, detail: { role: b.role } });
    res.status(201).json(publicUser(h.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid)));
  });

  r.get('/audit', (req, res) => {
    const pid = req.query.patient_id ? Number(req.query.patient_id) : null;
    const action = String(req.query.action || '');
    const rows = h.all(`SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE (? IS NULL OR a.patient_id = ?) AND (? = '' OR a.action LIKE ?) ORDER BY a.id DESC LIMIT 300`, pid, pid, action, `${action}%`);
    res.json({ chain_broken_at: audit.verifyChain(), entries: rows });
  });

  r.get('/data-requests', (_req, res) => {
    res.json(h.all(`SELECT d.*, u.name, u.phone FROM data_requests d JOIN users u ON u.id = d.user_id ORDER BY d.status = 'open' DESC, d.id DESC`));
  });

  // Closing a delete request anonymises the account. Records go; legally-required registers
  // (dispensing, claims) keep the transaction but lose the identity.
  r.post('/data-requests/:id/close', (req, res) => {
    const d = h.get('SELECT * FROM data_requests WHERE id = ?', req.params.id);
    if (!d) throw notFound();
    if (d.status !== 'open') throw bad('Already closed');
    h.tx(() => {
      if (d.kind === 'delete') {
        // The account holder AND every family member they manage.
        const ids = [d.user_id, ...h.all('SELECT id FROM users WHERE guardian_id = ?', d.user_id).map((x) => x.id)];
        for (const id of ids) anonymiseUser(h, id);
      }
      h.run(`UPDATE data_requests SET status = 'closed', closed_at = datetime('now') WHERE id = ?`, d.id);
    });
    audit.log(req, `privacy.close_${d.kind}`, { resource: 'data_request', resourceId: d.id, patientId: d.user_id });
    res.json({ ok: true });
  });

  return r;
}
