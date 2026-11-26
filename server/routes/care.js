// Care: family profiles, medicine reminders & refills, emergency card, lab tests, appointments.
import express from 'express';
import { validate, bad, notFound, forbidden } from '../lib/validate.js';
import { hashPassword, randomToken, decrypt, encrypt } from '../lib/crypto.js';
import { publicUser } from '../lib/auth.js';
import { validEndpoint } from '../lib/push.js';

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RELATIONS = ['child', 'spouse', 'parent', 'sibling', 'grandparent', 'other'];
const pkDate = (d = new Date()) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10); // Pakistan time (UTC+5)
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** "1 tab twice daily" → ["08:00","20:00"]. Plain-language dosing to reminder times. */
export function timesFromDosage(text = '') {
  const t = String(text).toLowerCase();
  if (/(three|thrice|3)\s*(times|x)|tds|tid/.test(t)) return ['08:00', '14:00', '20:00'];
  if (/(four|4)\s*(times|x)|qid/.test(t)) return ['08:00', '12:00', '16:00', '20:00'];
  if (/(twice|two times|2\s*(times|x)|bd|bid|morning and (night|evening))/.test(t)) return ['08:00', '20:00'];
  if (/(night|bedtime|hs|sone se pehle)/.test(t)) return ['21:00'];
  return ['09:00'];
}

export default function careRoutes({ h, auth, audit }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  const me = (req) => req.guardian ?? req.user; // the real account holder

  // ── Family profiles ──
  r.get('/family', (req, res) => {
    const owner = me(req);
    res.json({ self: publicUser(h.get('SELECT * FROM users WHERE id = ?', owner.id)),
      members: h.all('SELECT * FROM users WHERE guardian_id = ? AND deleted_at IS NULL ORDER BY id', owner.id).map(publicUser) });
  });

  r.post('/family', (req, res) => {
    const owner = me(req);
    if (owner.role !== 'patient') throw forbidden('Family profiles are for patient accounts');
    const b = validate(req.body, { name: 'string', relation: RELATIONS, gender: ['female', 'male', 'other', '?'], birth_year: 'int?', blood_group: [...BLOOD, '?'] });
    if (h.get('SELECT COUNT(*) AS n FROM users WHERE guardian_id = ? AND deleted_at IS NULL', owner.id).n >= 10) throw bad('Up to 10 family members');
    if (b.birth_year && (b.birth_year < 1900 || b.birth_year > new Date().getFullYear())) throw bad('Check the birth year');
    // Dependants cannot sign in: random unusable password, non-phone identifier.
    const info = h.run(`INSERT INTO users (name, phone, password_hash, role, gender, birth_year, blood_group, province, city, lang, guardian_id, relation)
      VALUES (?,?,?,'patient',?,?,?,?,?,?,?,?)`, b.name, `dep-${owner.id}-${randomToken(6)}`, hashPassword(randomToken(32)),
      b.gender ?? null, b.birth_year ?? null, b.blood_group ?? null, owner.province ?? null, owner.city ?? null, owner.lang ?? 'en', owner.id, b.relation);
    audit.log({ user: owner, ip: req.ip }, 'family.add', { resource: 'user', resourceId: info.lastInsertRowid, patientId: info.lastInsertRowid });
    res.status(201).json(publicUser(h.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid)));
  });

  r.delete('/family/:id', (req, res) => {
    const owner = me(req);
    const dep = h.get('SELECT * FROM users WHERE id = ? AND guardian_id = ? AND deleted_at IS NULL', req.params.id, owner.id);
    if (!dep) throw notFound();
    h.tx(() => {
      h.run('DELETE FROM records WHERE patient_id = ?', dep.id);
      h.run(`UPDATE users SET name = 'Removed member', deleted_at = datetime('now'), blood_group = NULL, birth_year = NULL WHERE id = ?`, dep.id);
      h.run('UPDATE med_schedules SET active = 0 WHERE user_id = ?', dep.id);
    });
    audit.log({ user: owner, ip: req.ip }, 'family.remove', { resource: 'user', resourceId: dep.id, patientId: dep.id });
    res.json({ ok: true });
  });

  // ── Medicine reminders & refills ──
  function withToday(s, today = pkDate()) {
    const times = JSON.parse(s.times || '[]');
    const logs = Object.fromEntries(h.all('SELECT slot, status FROM dose_log WHERE schedule_id = ? AND slot LIKE ?', s.id, `${today}%`).map((l) => [l.slot, l.status]));
    const daysUsed = Math.floor((Date.parse(today) - Date.parse(s.start_date)) / 86_400_000);
    const daysLeft = s.days_supply ? Math.max(0, s.days_supply - daysUsed) : null;
    const taken30 = h.get(`SELECT COUNT(*) AS n FROM dose_log WHERE schedule_id = ? AND status = 'taken' AND slot >= ?`, s.id, pkDate(new Date(Date.now() - 30 * 86_400_000))).n;
    const due30 = Math.max(1, Math.min(30, daysUsed + 1)) * times.length;
    return { ...s, times, today: times.map((tm) => ({ slot: `${today} ${tm}`, time: tm, status: logs[`${today} ${tm}`] || null })),
      days_left: daysLeft, refill_due: daysLeft != null && daysLeft <= 3, adherence_pct: Math.min(100, Math.round((taken30 / due30) * 100)) };
  }
  const ownSchedule = (req) => {
    const s = h.get('SELECT * FROM med_schedules WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!s) throw notFound();
    return s;
  };

  r.get('/schedules', (req, res) => {
    res.json(h.all('SELECT * FROM med_schedules WHERE user_id = ? AND active = 1 ORDER BY id', req.user.id).map((s) => withToday(s)));
  });

  r.post('/schedules', (req, res) => {
    const b = validate(req.body, { name: 'string', dose: 'string?', times: 'array', days_supply: 'int?', product_id: 'int?', start_date: 'string?' });
    if (!b.times.length || b.times.length > 6 || !b.times.every(isTime)) throw bad('Add 1–6 reminder times like 08:00');
    if (b.days_supply != null && (b.days_supply < 1 || b.days_supply > 365)) throw bad('Supply must be 1–365 days');
    if (b.product_id && !h.get('SELECT 1 FROM products WHERE id = ?', b.product_id)) throw bad('Unknown medicine');
    const info = h.run('INSERT INTO med_schedules (user_id, product_id, name, dose, times, start_date, days_supply) VALUES (?,?,?,?,?,?,?)',
      req.user.id, b.product_id ?? null, b.name, b.dose ?? null, JSON.stringify([...new Set(b.times)].sort()), b.start_date || pkDate(), b.days_supply ?? null);
    res.status(201).json(withToday(h.get('SELECT * FROM med_schedules WHERE id = ?', info.lastInsertRowid)));
  });

  // One tap from a prescription: one reminder per medicine, times parsed from the dosage text.
  r.post('/schedules/from-rx/:rxId', (req, res) => {
    const rx = h.get('SELECT * FROM prescriptions WHERE id = ? AND patient_id = ?', req.params.rxId, req.user.id);
    if (!rx) throw notFound('Prescription not found');
    const made = [];
    for (const it of JSON.parse(rx.items)) {
      const p = h.get('SELECT id, name FROM products WHERE id = ?', it.product_id);
      if (!p || h.get('SELECT 1 FROM med_schedules WHERE user_id = ? AND prescription_id = ? AND product_id = ? AND active = 1', req.user.id, rx.id, p.id)) continue;
      const info = h.run('INSERT INTO med_schedules (user_id, product_id, prescription_id, name, dose, times, start_date, days_supply) VALUES (?,?,?,?,?,?,?,?)',
        req.user.id, p.id, rx.id, p.name, it.dosage || null, JSON.stringify(timesFromDosage(it.dosage)), pkDate(), 30);
      made.push(withToday(h.get('SELECT * FROM med_schedules WHERE id = ?', info.lastInsertRowid)));
    }
    res.status(201).json(made);
  });

  r.patch('/schedules/:id', (req, res) => {
    const s = ownSchedule(req);
    const b = validate(req.body, { active: 'bool?', times: 'array?', days_supply: 'int?', dose: 'string?', refilled: 'bool?' });
    if (b.times && (!b.times.length || !b.times.every(isTime))) throw bad('Times must look like 08:00');
    h.run(`UPDATE med_schedules SET active = COALESCE(?, active), times = COALESCE(?, times), days_supply = COALESCE(?, days_supply), dose = COALESCE(?, dose),
      start_date = CASE WHEN ? THEN ? ELSE start_date END WHERE id = ?`,
      b.active == null ? null : Number(b.active), b.times ? JSON.stringify([...new Set(b.times)].sort()) : null, b.days_supply ?? null, b.dose ?? null,
      b.refilled ? 1 : 0, pkDate(), s.id);
    res.json(withToday(h.get('SELECT * FROM med_schedules WHERE id = ?', s.id)));
  });

  r.post('/schedules/:id/doses', (req, res) => {
    const s = ownSchedule(req);
    const b = validate(req.body, { slot: 'string', status: ['taken', 'skipped'] });
    const [d, tm] = b.slot.split(' ');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !JSON.parse(s.times).includes(tm)) throw bad('Unknown dose time');
    if (d > pkDate()) throw bad('Cannot log a future dose');
    h.run(`INSERT INTO dose_log (schedule_id, user_id, slot, status) VALUES (?,?,?,?)
      ON CONFLICT(schedule_id, slot) DO UPDATE SET status = excluded.status, logged_at = datetime('now')`, s.id, req.user.id, b.slot, b.status);
    res.json(withToday(s));
  });

  // ── Push subscriptions (dose reminders on a locked phone). Always tied to the real account holder. ──
  r.post('/push', (req, res) => {
    const b = validate(req.body, { endpoint: 'string' });
    if (b.endpoint.length > 1000 || !validEndpoint(b.endpoint)) throw bad('Unsupported push service');
    h.run(`INSERT INTO push_subs (user_id, endpoint) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id`, me(req).id, b.endpoint);
    res.status(201).json({ ok: true });
  });
  r.delete('/push', (req, res) => {
    const b = validate(req.body, { endpoint: 'string' });
    h.run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', b.endpoint, me(req).id);
    res.json({ ok: true });
  });

  // ── Emergency card (what a paramedic or ER needs, on one screen) ──
  r.get('/card', (req, res) => {
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const recs = h.all(`SELECT * FROM records WHERE patient_id = ? AND type IN ('allergy','condition','prescription') ORDER BY recorded_at DESC`, u.id)
      .map((x) => ({ type: x.type, title: x.title, data: decrypt(x.data_enc, `record:${u.id}`) }));
    const meds = h.all('SELECT name, dose, times FROM med_schedules WHERE user_id = ? AND active = 1', u.id).map((m) => ({ name: m.name, dose: m.dose, times: JSON.parse(m.times) }));
    const guardian = u.guardian_id ? h.get('SELECT name, phone FROM users WHERE id = ?', u.guardian_id) : null;
    audit.log(req, 'records.card', { resource: 'user', resourceId: u.id, patientId: u.id });
    res.json({
      name: u.name, birth_year: u.birth_year, gender: u.gender, blood_group: u.blood_group,
      allergies: recs.filter((x) => x.type === 'allergy').map((x) => [x.data.substance || x.title, x.data.reaction, x.data.severity].filter(Boolean).join(' — ')),
      conditions: recs.filter((x) => x.type === 'condition').map((x) => x.title),
      medicines: meds.length ? meds.map((m) => [m.name, m.dose].filter(Boolean).join(' — ')) : recs.filter((x) => x.type === 'prescription').slice(0, 8).map((x) => [x.title, x.data.dosage].filter(Boolean).join(' — ')),
      emergency_contact: u.emergency_contact_phone ? { name: u.emergency_contact_name, phone: u.emergency_contact_phone } : guardian ? { name: `${guardian.name} (guardian)`, phone: guardian.phone } : null,
      generated_at: new Date().toISOString(),
    });
  });

  // ── Lab tests ──
  r.get('/lab-tests', (_req, res) => res.json(h.all('SELECT * FROM lab_tests ORDER BY name')));
  r.get('/labs', (req, res) => {
    const city = String(req.query.city || req.user.city || '').slice(0, 40);
    res.json(h.all(`SELECT id, name, city, address, lat, lng, verified FROM facilities WHERE type = 'lab' AND (? = '' OR city = ?) ORDER BY verified DESC, name LIMIT 50`, city, city));
  });

  r.post('/lab-bookings', (req, res) => {
    const b = validate(req.body, { facility_id: 'int', test_ids: 'array', home_collection: 'bool?', address: 'string?', slot_at: 'string' });
    const lab = h.get(`SELECT * FROM facilities WHERE id = ? AND type = 'lab' AND verified = 1`, b.facility_id);
    if (!lab) throw bad('Choose a verified lab');
    const ids = [...new Set(b.test_ids.map(Number))].slice(0, 20);
    const tests = ids.map((id) => h.get('SELECT id, name, price, fasting FROM lab_tests WHERE id = ?', id));
    if (!tests.length || tests.some((x) => !x)) throw bad('Choose at least one test');
    const slot = new Date(b.slot_at);
    if (Number.isNaN(slot.getTime()) || slot < new Date(Date.now() - 3600_000) || slot > new Date(Date.now() + 30 * 86_400_000)) throw bad('Pick a time in the next 30 days');
    if (b.home_collection && !b.address) throw bad('Add an address for home sample collection');
    const total = tests.reduce((s, x) => s + x.price, 0) + (b.home_collection ? 300 : 0);
    const info = h.run('INSERT INTO lab_bookings (patient_id, facility_id, tests, home_collection, address, slot_at, total) VALUES (?,?,?,?,?,?,?)',
      req.user.id, lab.id, JSON.stringify(tests), b.home_collection ? 1 : 0, b.address ?? null, slot.toISOString(), total);
    h.run(`INSERT INTO notifications (facility_id, kind, message) VALUES (?, 'lab', ?)`, lab.id, `New lab booking #${info.lastInsertRowid}: ${tests.map((x) => x.name).join(', ')}${b.home_collection ? ' (home collection)' : ''}`);
    audit.log(req, 'lab.book', { resource: 'lab_booking', resourceId: info.lastInsertRowid, patientId: req.user.id });
    res.status(201).json({ id: info.lastInsertRowid, total, fasting: tests.some((x) => x.fasting), lab: lab.name, slot_at: slot.toISOString() });
  });

  r.get('/lab-bookings', (req, res) => {
    res.json(h.all(`SELECT b.*, f.name AS lab_name FROM lab_bookings b JOIN facilities f ON f.id = b.facility_id WHERE b.patient_id = ? ORDER BY b.id DESC`, req.user.id)
      .map((x) => ({ ...x, tests: JSON.parse(x.tests) })));
  });

  // Facility staff update a booking; "completed" with results writes them (encrypted) into the patient's record.
  r.post('/lab-bookings/:id/status', (req, res) => {
    const b = validate(req.body, { status: ['confirmed', 'sample_collected', 'completed', 'cancelled'], results: 'array?' });
    const bk = h.get('SELECT * FROM lab_bookings WHERE id = ?', req.params.id);
    if (!bk) throw notFound();
    const isPatient = bk.patient_id === req.user.id;
    const isLab = ['facility_admin', 'admin'].includes(req.user.role) && (req.user.role === 'admin' || req.user.org_id === bk.facility_id);
    if (!(isLab || (isPatient && b.status === 'cancelled'))) throw forbidden();
    if (['completed', 'cancelled'].includes(bk.status)) throw bad(`Booking is already ${bk.status}`);
    h.tx(() => {
      h.run('UPDATE lab_bookings SET status = ? WHERE id = ?', b.status, bk.id);
      if (b.status === 'completed') {
        for (const raw of b.results || []) {
          const x = validate(raw, { name: 'string', value: 'string', unit: 'string?', reference: 'string?' });
          h.run(`INSERT INTO records (patient_id, author_id, facility_id, type, title, data_enc, recorded_at) VALUES (?,?,?,'lab',?,?,datetime('now'))`,
            bk.patient_id, req.user.id, bk.facility_id, x.name, encrypt({ value: x.value, unit: x.unit, reference: x.reference }, `record:${bk.patient_id}`));
        }
      }
      h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'lab', ?)`, bk.patient_id,
        b.status === 'completed' ? `Your lab results (booking #${bk.id}) are in your health record.` : `Lab booking #${bk.id}: ${b.status.replace('_', ' ')}`);
    });
    audit.log(req, `lab.${b.status}`, { resource: 'lab_booking', resourceId: bk.id, patientId: bk.patient_id });
    res.json({ ok: true });
  });

  r.get('/lab-bookings/facility', auth.requireRole('facility_admin'), (req, res) => {
    res.json(h.all(`SELECT b.*, u.name AS patient_name, u.phone AS patient_phone FROM lab_bookings b JOIN users u ON u.id = b.patient_id
      WHERE b.facility_id = ? ORDER BY b.slot_at`, req.user.org_id).map((x) => ({ ...x, tests: JSON.parse(x.tests) })));
  });

  // ── Appointments (call-back requests) ──
  r.post('/appointments', (req, res) => {
    const b = validate(req.body, { facility_id: 'int?', doctor_id: 'int?', reason: 'text', preferred_time: 'string?', female_only: 'bool?' });
    if (!b.facility_id && !b.doctor_id) throw bad('Choose a hospital, clinic or doctor');
    if (b.reason.length < 5) throw bad('Say briefly what it is about');
    if (b.facility_id && !h.get(`SELECT 1 FROM facilities WHERE id = ? AND verified = 1 AND type != 'camp'`, b.facility_id)) throw bad('Choose a verified facility');
    if (b.doctor_id && !h.get(`SELECT 1 FROM users WHERE id = ? AND role = 'doctor' AND verified = 1`, b.doctor_id)) throw bad('Choose a verified doctor');
    const info = h.run('INSERT INTO appointments (patient_id, facility_id, doctor_id, reason, preferred_time, female_only) VALUES (?,?,?,?,?,?)',
      req.user.id, b.facility_id ?? null, b.doctor_id ?? null, b.reason, b.preferred_time ?? null, b.female_only ? 1 : 0);
    if (b.facility_id) h.run(`INSERT INTO notifications (facility_id, kind, message) VALUES (?, 'appointment', ?)`, b.facility_id, `Call-back request #${info.lastInsertRowid}${b.female_only ? ' (female doctor requested)' : ''}`);
    if (b.doctor_id) h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'appointment', ?)`, b.doctor_id, `New appointment request #${info.lastInsertRowid}`);
    audit.log(req, 'appointment.request', { resource: 'appointment', resourceId: info.lastInsertRowid, patientId: req.user.id });
    res.status(201).json({ id: info.lastInsertRowid, status: 'requested' });
  });

  r.get('/appointments', (req, res) => {
    res.json(h.all(`SELECT a.*, f.name AS facility_name, d.name AS doctor_name FROM appointments a LEFT JOIN facilities f ON f.id = a.facility_id
      LEFT JOIN users d ON d.id = a.doctor_id WHERE a.patient_id = ? ORDER BY a.id DESC`, req.user.id));
  });

  // Staff queue: facility admins see their facility's requests; doctors see requests addressed to them.
  r.get('/appointments/queue', auth.requireRole('facility_admin', 'doctor'), (req, res) => {
    const rows = req.user.role === 'doctor'
      ? h.all(`SELECT a.*, u.name AS patient_name, u.phone AS patient_phone FROM appointments a JOIN users u ON u.id = a.patient_id WHERE a.doctor_id = ? ORDER BY a.id DESC LIMIT 100`, req.user.id)
      : h.all(`SELECT a.*, u.name AS patient_name, u.phone AS patient_phone FROM appointments a JOIN users u ON u.id = a.patient_id WHERE a.facility_id = ? ORDER BY a.id DESC LIMIT 100`, req.user.org_id);
    // Dependants have no phone of their own — staff call the guardian.
    res.json(rows.map((a) => (a.patient_phone?.startsWith('dep-') ? { ...a, patient_phone: h.get('SELECT g.phone FROM users d JOIN users g ON g.id = d.guardian_id WHERE d.id = ?', a.patient_id)?.phone } : a)));
  });

  r.post('/appointments/:id/status', (req, res) => {
    const b = validate(req.body, { status: ['called', 'booked', 'done', 'cancelled'], note: 'string?' });
    const a = h.get('SELECT * FROM appointments WHERE id = ?', req.params.id);
    if (!a) throw notFound();
    const staff = (req.user.role === 'facility_admin' && req.user.org_id === a.facility_id) || (req.user.role === 'doctor' && req.user.id === a.doctor_id) || req.user.role === 'admin';
    if (!staff && !(a.patient_id === req.user.id && b.status === 'cancelled')) throw forbidden();
    h.run('UPDATE appointments SET status = ?, note = COALESCE(?, note), handled_by = ? WHERE id = ?', b.status, b.note ?? null, req.user.id, a.id);
    if (staff) h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'appointment', ?)`, a.patient_id, `Appointment request #${a.id}: ${b.status}${b.note ? ` — ${b.note}` : ''}`);
    res.json({ ok: true });
  });

  return r;
}
