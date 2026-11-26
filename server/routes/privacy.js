// Privacy module: plain-language notice, data-subject requests (export / delete / correct),
// breach register with 72-hour notification clock (draft PDP Bill / GDPR / India DPDP standard).
import express from 'express';
import { validate, bad, notFound } from '../lib/validate.js';

export const PRIVACY_NOTICE = {
  version: '2026-11',
  summary: [
    'Your health data belongs to you. We store it encrypted and only share it when you say so.',
    'Doctors, pharmacists and insurers can see your records only with your time-limited consent. You can revoke it any time.',
    'In a medical emergency a verified doctor can open your record for 24 hours. You are told immediately and every use is reviewed.',
    'You can see every access to your data, download it all (FHIR format), ask us to correct it, or delete your account.',
    'Your CNIC is never stored — only a one-way keyed fingerprint and the last 4 digits.',
    'We never sell your data. Statistics we publish are aggregated and anonymised.',
    'If your data is ever exposed, we will tell you and the regulator within 72 hours.',
  ],
  categories: [
    { data: 'Account (name, phone)', purpose: 'Sign-in, contacting you', retention: 'While your account is open' },
    { data: 'Health records', purpose: 'Your care', retention: 'While your account is open; deleted on request unless law requires retention' },
    { data: 'Prescriptions & orders', purpose: 'Dispensing medicines legally', retention: 'As required by provincial Drug Rules (registers must be kept)' },
    { data: 'Insurance claims', purpose: 'Paying claims, fraud prevention', retention: 'As required by SECP insurance record rules' },
    { data: 'Location (emergencies)', purpose: 'Sending an ambulance', retention: '90 days, then coarsened' },
    { data: 'Audit log', purpose: 'Security, your access history', retention: 'Kept tamper-evident; not deletable' },
  ],
  hosting: 'Data is hosted in Pakistan (Cloud First Policy; anticipated PDP law localisation for critical personal data).',
  law: 'Pakistan has no enacted data protection law yet (draft Personal Data Protection Bill pending). We follow its draft standards plus PECA 2016, PMDC confidentiality rules, the Sindh Telemedicine Act 2021, and GDPR/HIPAA-grade practice.',
};

export default function privacyRoutes({ h, auth, audit }) {
  const r = express.Router();

  r.get('/notice', (_req, res) => res.json(PRIVACY_NOTICE));

  r.get('/requests', auth.requireAuth, (req, res) => {
    res.json(h.all('SELECT * FROM data_requests WHERE user_id = ? ORDER BY id DESC', req.user.id));
  });

  r.post('/requests', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { kind: ['export', 'delete', 'correct'], detail: 'text?' });
    if (b.kind === 'correct' && !b.detail) throw bad('Tell us what needs correcting');
    if (h.get(`SELECT id FROM data_requests WHERE user_id = ? AND kind = ? AND status = 'open'`, req.user.id, b.kind)) throw bad('You already have an open request of this type');
    const info = h.run('INSERT INTO data_requests (user_id, kind, detail) VALUES (?,?,?)', req.user.id, b.kind, b.detail ?? null);
    audit.log(req, `privacy.request_${b.kind}`, { resource: 'data_request', resourceId: info.lastInsertRowid, patientId: req.user.id });
    res.status(201).json({ id: info.lastInsertRowid, message: b.kind === 'export'
      ? 'You can download your records right away from Records → Export. A full account export will be ready within 7 days.'
      : 'We will respond within 30 days.' });
  });

  // ── Breach register (admin) ──
  const withClock = (b) => {
    const deadline = new Date(new Date(b.detected_at).getTime() + 72 * 3600_000);
    return { ...b, notify_deadline: deadline.toISOString(), hours_left: b.notified_regulator_at ? null : Math.round((deadline - Date.now()) / 3600_000) };
  };

  r.get('/breaches', auth.requireRole('admin'), (_req, res) => res.json(h.all('SELECT * FROM breaches ORDER BY id DESC').map(withClock)));

  r.post('/breaches', auth.requireRole('admin'), (req, res) => {
    const b = validate(req.body, { description: 'text', affected_count: 'int?', severity: ['low', 'medium', 'high', 'critical'], detected_at: 'string?' });
    const info = h.run('INSERT INTO breaches (detected_at, description, affected_count, severity, created_by) VALUES (?,?,?,?,?)',
      b.detected_at ? new Date(b.detected_at).toISOString() : new Date().toISOString(), b.description, b.affected_count ?? 0, b.severity, req.user.id);
    audit.log(req, 'breach.record', { resource: 'breach', resourceId: info.lastInsertRowid, detail: { severity: b.severity } });
    res.status(201).json(withClock(h.get('SELECT * FROM breaches WHERE id = ?', info.lastInsertRowid)));
  });

  r.post('/breaches/:id/notify', auth.requireRole('admin'), (req, res) => {
    const b = validate(req.body, { target: ['regulator', 'subjects'] });
    const br = h.get('SELECT * FROM breaches WHERE id = ?', req.params.id);
    if (!br) throw notFound();
    h.run(`UPDATE breaches SET ${b.target === 'regulator' ? 'notified_regulator_at' : 'notified_subjects_at'} = datetime('now') WHERE id = ?`, br.id);
    audit.log(req, `breach.notify_${b.target}`, { resource: 'breach', resourceId: br.id });
    res.json(withClock(h.get('SELECT * FROM breaches WHERE id = ?', br.id)));
  });

  r.post('/breaches/:id/close', auth.requireRole('admin'), (req, res) => {
    h.run(`UPDATE breaches SET status = 'closed' WHERE id = ?`, req.params.id);
    res.json({ ok: true });
  });

  return r;
}
