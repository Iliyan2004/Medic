// Patient records: encrypted, patient-controlled. Patients see everything about themselves, grant and
// revoke time-limited consent to doctors, share via one-time codes, see who accessed their data,
// and export a FHIR R4 bundle. Doctors get access only with consent or logged break-glass.
import express from 'express';
import { validate, bad, forbidden, notFound, isPkPhone, normPhone } from '../lib/validate.js';
import { encrypt, decrypt, shareCode, sha256 } from '../lib/crypto.js';
import { rateLimit } from '../lib/auth.js';

const TYPES = ['visit', 'lab', 'prescription', 'allergy', 'immunization', 'vitals', 'condition', 'note'];
const SCOPES = ['records', 'insurance', 'pharmacy'];

export default function recordsRoutes({ h, auth, audit, consent }) {
  const r = express.Router();
  const aad = (pid) => `record:${pid}`;

  function readRecords(patientId) {
    return h.all(`SELECT r.*, u.name AS author_name, u.role AS author_role, f.name AS facility_name FROM records r
      LEFT JOIN users u ON u.id = r.author_id LEFT JOIN facilities f ON f.id = r.facility_id
      WHERE r.patient_id = ? ORDER BY r.recorded_at DESC, r.id DESC`, patientId)
      .map(({ data_enc, ...rec }) => ({ ...rec, data: decrypt(data_enc, aad(rec.patient_id)) }));
  }

  function patientSummary(pid) {
    const u = h.get('SELECT id, name, gender, birth_year, blood_group, city, cnic_last4 FROM users WHERE id = ?', pid);
    if (!u) throw notFound('Patient not found');
    return u;
  }

  // Own records
  r.get('/mine', auth.requireAuth, (req, res) => {
    audit.log(req, 'records.view', { resource: 'records', patientId: req.user.id, detail: { basis: 'self' } });
    res.json({ patient: patientSummary(req.user.id), records: readRecords(req.user.id) });
  });

  // A doctor viewing a patient's records
  r.get('/patient/:pid', auth.requireRole('doctor'), (req, res) => {
    const pid = Number(req.params.pid);
    const basis = consent.access(req.user, pid, 'records');
    if (!basis) throw forbidden('The patient has not given you consent. Ask them to grant access, or use emergency access.');
    const c = consent.activeConsent(pid, req.user.id, 'records');
    audit.log(req, 'records.view', { resource: 'records', patientId: pid, detail: { basis, purpose: c?.purpose } });
    res.json({ patient: patientSummary(pid), records: readRecords(pid), consent: c });
  });

  r.post('/', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { patient_id: 'int?', type: TYPES, title: 'string', data: 'object', facility_id: 'int?', recorded_at: 'string?' });
    if (JSON.stringify(b.data).length > 20000) throw bad('Record is too large');
    let pid = req.user.id;
    let self = 1;
    if (req.user.role === 'doctor') {
      if (!b.patient_id) throw bad('Choose the patient');
      if (!req.user.verified) throw forbidden('Your PMDC registration must be verified');
      if (!consent.access(req.user, b.patient_id, 'records')) throw forbidden('No consent from this patient');
      pid = b.patient_id; self = 0;
    } else if (req.user.role !== 'patient') throw forbidden();
    const info = h.run(`INSERT INTO records (patient_id, author_id, facility_id, type, title, data_enc, self_reported, recorded_at) VALUES (?,?,?,?,?,?,?,?)`,
      pid, req.user.id, b.facility_id ?? null, b.type, b.title, encrypt(b.data, aad(pid)), self,
      b.recorded_at ? new Date(b.recorded_at).toISOString() : new Date().toISOString());
    if (!self) h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'records', ?)`, pid, `Dr. ${req.user.name} added “${b.title}” to your health record`);
    audit.log(req, 'records.create', { resource: 'record', resourceId: info.lastInsertRowid, patientId: pid, detail: { type: b.type } });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  r.delete('/:id', auth.requireRole('patient'), (req, res) => {
    const rec = h.get('SELECT * FROM records WHERE id = ? AND patient_id = ?', req.params.id, req.user.id);
    if (!rec) throw notFound();
    if (!rec.self_reported) throw bad('Clinician-entered records cannot be deleted, but you can request a correction under Privacy');
    h.run('DELETE FROM records WHERE id = ?', rec.id);
    audit.log(req, 'records.delete', { resource: 'record', resourceId: rec.id, patientId: req.user.id });
    res.json({ ok: true });
  });

  // ── Consent ──
  r.get('/consents', auth.requireAuth, (req, res) => {
    const rows = req.user.role === 'doctor'
      ? h.all(`SELECT c.*, u.name AS patient_name, u.gender, u.birth_year FROM consents c JOIN users u ON u.id = c.patient_id
          WHERE c.grantee_id = ? AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > ?) ORDER BY c.id DESC`, req.user.id, new Date().toISOString())
      : h.all(`SELECT c.*, u.name AS grantee_name, u.role AS grantee_role, u.pmdc_no FROM consents c JOIN users u ON u.id = c.grantee_id
          WHERE c.patient_id = ? ORDER BY c.revoked_at IS NOT NULL, c.id DESC`, req.user.id);
    res.json(rows);
  });

  r.post('/consents', auth.requireRole('patient'), (req, res) => {
    const b = validate(req.body, { grantee_id: 'int', scope: SCOPES, purpose: 'string', days: 'int' });
    if (b.days < 1 || b.days > 365) throw bad('Consent can last 1–365 days');
    const g = h.get(`SELECT * FROM users WHERE id = ? AND role IN ('doctor','insurer','pharmacist') AND verified = 1`, b.grantee_id);
    if (!g) throw bad('You can only grant access to verified doctors, pharmacists or insurers');
    const exp = new Date(Date.now() + b.days * 86400000).toISOString();
    const info = h.run('INSERT INTO consents (patient_id, grantee_id, scope, purpose, expires_at) VALUES (?,?,?,?,?)', req.user.id, g.id, b.scope, b.purpose, exp);
    h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'consent', ?)`, g.id, `${req.user.name} gave you access to their ${b.scope} for ${b.days} days`);
    audit.log(req, 'consent.grant', { resource: 'consent', resourceId: info.lastInsertRowid, patientId: req.user.id, detail: { grantee: g.id, scope: b.scope, days: b.days } });
    res.status(201).json(h.get('SELECT * FROM consents WHERE id = ?', info.lastInsertRowid));
  });

  r.delete('/consents/:id', auth.requireRole('patient'), (req, res) => {
    const c = h.get('SELECT * FROM consents WHERE id = ? AND patient_id = ?', req.params.id, req.user.id);
    if (!c) throw notFound();
    h.run(`UPDATE consents SET revoked_at = datetime('now') WHERE id = ?`, c.id);
    audit.log(req, 'consent.revoke', { resource: 'consent', resourceId: c.id, patientId: req.user.id });
    res.json({ ok: true });
  });

  // Break-glass: a verified doctor can open an unconscious patient's record for 24h. Always logged,
  // the patient is notified, and every use is reviewed by the privacy officer.
  r.post('/break-glass', auth.requireRole('doctor'), (req, res) => {
    const b = validate(req.body, { patient_phone: 'string', reason: 'text' });
    if (!req.user.verified) throw forbidden('Only verified doctors can use emergency access');
    if (b.reason.length < 20) throw bad('Explain the emergency in at least 20 characters');
    if (!isPkPhone(b.patient_phone)) throw bad('Enter the patient’s mobile number');
    const p = h.get(`SELECT id, name FROM users WHERE phone = ? AND role = 'patient'`, normPhone(b.patient_phone));
    if (!p) throw notFound('Patient not found');
    const exp = new Date(Date.now() + 24 * 3600_000).toISOString();
    const info = h.run('INSERT INTO consents (patient_id, grantee_id, scope, purpose, expires_at) VALUES (?,?,?,?,?)', p.id, req.user.id, 'records', `EMERGENCY: ${b.reason}`, exp);
    h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'security', ?)`, p.id,
      `Emergency access: Dr. ${req.user.name} opened your health record (reason: ${b.reason.slice(0, 80)}). If this is wrong, revoke it under Records → Consents and report it.`);
    audit.log(req, 'records.break_glass', { resource: 'consent', resourceId: info.lastInsertRowid, patientId: p.id, detail: { reason: b.reason } });
    res.status(201).json({ patient_id: p.id, expires_at: exp });
  });

  // ── Share codes (e.g., show a new doctor without either needing an account link) ──
  r.post('/share', auth.requireRole('patient'), (req, res) => {
    const b = validate(req.body, { hours: 'int' });
    if (b.hours < 1 || b.hours > 72) throw bad('Share codes last 1–72 hours');
    const code = shareCode();
    const exp = new Date(Date.now() + b.hours * 3600_000).toISOString();
    h.run('INSERT INTO share_tokens (token_hash, patient_id, scope, expires_at) VALUES (?,?,?,?)', sha256(code), req.user.id, 'records', exp);
    audit.log(req, 'records.share_create', { resource: 'share', patientId: req.user.id, detail: { hours: b.hours } });
    res.status(201).json({ code, expires_at: exp });
  });

  r.post('/shared', rateLimit({ windowMs: 15 * 60_000, max: 15, key: 'share' }), (req, res) => {
    const b = validate(req.body, { code: 'string' });
    const t = h.get('SELECT * FROM share_tokens WHERE token_hash = ? AND expires_at > ?', sha256(b.code.toUpperCase().trim()), new Date().toISOString());
    if (!t) throw notFound('Code not found or expired');
    h.run('UPDATE share_tokens SET used_count = used_count + 1 WHERE token_hash = ?', t.token_hash);
    audit.log(req, 'records.view', { resource: 'records', patientId: t.patient_id, detail: { basis: 'share_code', viewer: req.user?.name || 'anonymous' } });
    h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'records', ?)`, t.patient_id, `Your shared record was opened${req.user ? ' by ' + req.user.name : ''}`);
    // Share view excludes free-text notes to minimise exposure.
    res.json({ patient: patientSummary(t.patient_id), records: readRecords(t.patient_id).filter((x) => x.type !== 'note'), expires_at: t.expires_at });
  });

  // Who accessed my data
  r.get('/access-log', auth.requireRole('patient'), (req, res) => {
    res.json(h.all(`SELECT a.ts, a.action, a.resource, a.detail, u.name AS actor_name, u.role AS actor_role FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_id WHERE a.patient_id = ? ORDER BY a.id DESC LIMIT 200`, req.user.id)
      .map((x) => ({ ...x, detail: x.detail ? JSON.parse(x.detail) : null })));
  });

  // FHIR R4 export (data portability)
  r.get('/export', auth.requireRole('patient'), (req, res) => {
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const recs = readRecords(u.id);
    const pRef = `Patient/${u.id}`;
    const entries = [{ resource: { resourceType: 'Patient', id: String(u.id), name: [{ text: u.name }], gender: u.gender || 'unknown',
      birthDate: u.birth_year ? String(u.birth_year) : undefined, telecom: [{ system: 'phone', value: u.phone }],
      address: [{ city: u.city, state: u.province, country: 'PK' }] } }];
    for (const r0 of recs) entries.push({ resource: toFhir(r0, pRef) });
    // Family members the account holder manages are included (data portability covers them too).
    const family = req.guardian ? [] : h.all('SELECT * FROM users WHERE guardian_id = ? AND deleted_at IS NULL', u.id);
    for (const m of family) {
      const mRef = `Patient/${m.id}`;
      entries.push({ resource: { resourceType: 'Patient', id: String(m.id), name: [{ text: m.name }], gender: m.gender || 'unknown',
        birthDate: m.birth_year ? String(m.birth_year) : undefined,
        link: [{ other: { reference: pRef }, type: 'seealso' }], extension: [{ url: 'https://sehatyab.pk/fhir/relation', valueString: m.relation || 'family' }] } });
      for (const r0 of readRecords(m.id)) entries.push({ resource: toFhir(r0, mRef) });
    }
    audit.log(req, 'records.export', { resource: 'records', patientId: u.id, detail: { count: recs.length, family: family.length } });
    res.set('Content-Disposition', 'attachment; filename="my-health-record.fhir.json"');
    res.json({ resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), entry: entries });
  });

  return r;
}

function toFhir(rec, subject) {
  const d = rec.data || {};
  const base = { id: String(rec.id), subject: { reference: subject }, meta: { lastUpdated: rec.created_at } };
  switch (rec.type) {
    case 'allergy': return { resourceType: 'AllergyIntolerance', ...base, patient: base.subject, code: { text: d.substance || rec.title }, reaction: d.reaction ? [{ description: d.reaction }] : undefined };
    case 'immunization': return { resourceType: 'Immunization', ...base, patient: base.subject, status: 'completed', vaccineCode: { text: d.vaccine || rec.title }, occurrenceDateTime: rec.recorded_at };
    case 'condition': return { resourceType: 'Condition', ...base, code: { text: rec.title, coding: d.icd10 ? [{ system: 'http://hl7.org/fhir/sid/icd-10', code: d.icd10 }] : undefined } };
    case 'prescription': return { resourceType: 'MedicationRequest', ...base, status: 'active', intent: 'order', medicationCodeableConcept: { text: d.medicine || rec.title }, dosageInstruction: d.dosage ? [{ text: d.dosage }] : undefined };
    case 'vitals': case 'lab': return { resourceType: 'Observation', ...base, status: 'final', category: [{ text: rec.type === 'lab' ? 'laboratory' : 'vital-signs' }], code: { text: rec.title }, effectiveDateTime: rec.recorded_at, valueString: JSON.stringify(d) };
    case 'visit': return { resourceType: 'Encounter', ...base, status: 'finished', class: { code: 'AMB' }, reasonCode: [{ text: d.reason || rec.title }], period: { start: rec.recorded_at } };
    default: return { resourceType: 'DocumentReference', ...base, status: 'current', description: rec.title, content: [{ attachment: { contentType: 'application/json', data: Buffer.from(JSON.stringify(d)).toString('base64') } }] };
  }
}
