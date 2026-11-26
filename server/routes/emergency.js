// Ambulance module: one request, every fleet. Dispatches the fastest suitable ambulance regardless
// of operator (Rescue 1122, Edhi, Chhipa, private) — the Flare (Kenya) model — sends a motorbike first
// responder for critical calls when it is faster, picks a destination hospital with a free bed and power,
// pre-alerts that hospital, and shows the fare up front (govt services free; private fares capped).
import express from 'express';
import { validate, bad, notFound, forbidden, isLatLng, isPkPhone, normPhone } from '../lib/validate.js';
import { etaMinutes, haversineKm, stepTowards, round } from '../lib/geo.js';
import { assess, powerOk } from '../lib/energy.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { rateLimit } from '../lib/auth.js';
import { quoteSubsidy, chargeSubsidy } from '../lib/subsidy.js';
import { sendSms } from '../lib/adapters.js';

const FLOW = ['requested', 'dispatched', 'on_scene', 'transporting', 'at_hospital', 'closed'];
const ACTIVE = ['requested', 'dispatched', 'on_scene', 'transporting'];

export default function emergencyRoutes({ h, auth, audit }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 10 * 60_000, max: 10, key: 'sos' });

  r.get('/providers', (_req, res) => {
    res.json(h.all(`SELECT p.*, (SELECT COUNT(*) FROM ambulances a WHERE a.provider_id = p.id AND a.status = 'available') AS available,
      (SELECT COUNT(*) FROM ambulances a WHERE a.provider_id = p.id) AS fleet FROM ambulance_providers p ORDER BY p.kind, p.name`));
  });

  function fare(provider, km) {
    if (provider.kind === 'govt') return 0;
    return Math.round(provider.fare_base + provider.fare_per_km * km);
  }

  function chooseHospital(at, severity) {
    // Only licence-verified ERs. Imported OpenStreetMap hospitals (verified = 0) are never dispatch targets.
    const hospitals = h.all(`SELECT * FROM facilities WHERE type = 'hospital' AND emergency = 1 AND verified = 1`);
    const scored = hospitals.map((f) => {
      const reading = h.get('SELECT * FROM energy_readings WHERE facility_id = ? ORDER BY ts DESC LIMIT 1', f.id);
      const power = assess(reading, f);
      const t = etaMinutes(at, f, 'ALS');
      const ok = f.beds_free > 0 && powerOk(power) && f.verified;
      // Critical patients go to the nearest capable hospital; for minor cases prefer public/PPP to keep cost down.
      const costBias = severity >= 3 && f.sector === 'private' ? 5 : 0;
      return { f, t, ok, power, score: t.minutes + costBias };
    }).sort((a, b) => a.score - b.score);
    return scored.find((s) => s.ok) || scored[0];
  }

  // Core dispatch logic, exported for tests.
  function plan({ lat, lng, severity }) {
    const at = { lat, lng };
    const fleet = h.all(`SELECT a.*, p.name AS provider_name, p.kind AS provider_kind, p.fare_base, p.fare_per_km, p.hotline
      FROM ambulances a JOIN ambulance_providers p ON p.id = a.provider_id WHERE a.status = 'available'`);
    const vans = fleet.filter((a) => a.type !== 'bike' && (severity > 2 || a.type === 'ALS' || severity === 2));
    const pool = vans.length ? vans : fleet.filter((a) => a.type !== 'bike');
    if (!pool.length) return null;
    const ranked = pool.map((a) => ({ a, ...etaMinutes(a, at, a.type) })).sort((x, y) => x.minutes - y.minutes);
    const best = ranked[0];
    const dest = chooseHospital(at, severity);
    const tripKm = best.km + (dest ? dest.t.km : 0);
    const provider = { kind: best.a.provider_kind, fare_base: best.a.fare_base, fare_per_km: best.a.fare_per_km };
    let firstResponder = null;
    if (severity <= 2) {
      const bikes = fleet.filter((a) => a.type === 'bike').map((a) => ({ a, ...etaMinutes(a, at, 'bike') })).sort((x, y) => x.minutes - y.minutes);
      if (bikes[0] && bikes[0].minutes < best.minutes - 2) firstResponder = bikes[0];
    }
    return {
      ambulance: best, firstResponder, destination: dest,
      alternatives: ranked.slice(1, 4).map((x) => ({ id: x.a.id, provider: x.a.provider_name, type: x.a.type, eta_min: x.minutes })),
      tripKm: round(tripKm, 1), fare: fare(provider, tripKm),
    };
  }

  r.post('/quote', (req, res) => {
    const b = validate(req.body, { lat: 'number', lng: 'number', severity: 'int' });
    if (!isLatLng(b.lat, b.lng)) throw bad('Location must be inside Pakistan');
    const p = plan(b);
    if (!p) throw bad('No ambulance available nearby — call 1122 or 115 directly');
    res.json(summarise(p));
  });

  function summarise(p) {
    return {
      ambulance: { id: p.ambulance.a.id, call_sign: p.ambulance.a.call_sign, type: p.ambulance.a.type, provider: p.ambulance.a.provider_name, provider_kind: p.ambulance.a.provider_kind, eta_min: p.ambulance.minutes, distance_km: p.ambulance.km },
      first_responder: p.firstResponder ? { id: p.firstResponder.a.id, call_sign: p.firstResponder.a.call_sign, provider: p.firstResponder.a.provider_name, eta_min: p.firstResponder.minutes } : null,
      destination: p.destination ? { id: p.destination.f.id, name: p.destination.f.name, eta_min: p.destination.t.minutes, beds_free: p.destination.f.beds_free, power: p.destination.power.level, sehat_empanelled: !!p.destination.f.sehat_empanelled } : null,
      alternatives: p.alternatives, trip_km: p.tripKm, fare_estimate: p.fare,
    };
  }

  // Works without an account — in an emergency nobody should have to sign up first.
  r.post('/request', limiter, (req, res) => {
    const b = validate(req.body, { lat: 'number', lng: 'number', severity: 'int', complaint: 'string?', contact_phone: 'string?', subsidy_program_id: 'int?' });
    if (!isLatLng(b.lat, b.lng)) throw bad('Location must be inside Pakistan');
    if (b.severity < 1 || b.severity > 4) throw bad('Severity must be 1 (critical) to 4 (minor)');
    const phone = b.contact_phone && isPkPhone(b.contact_phone) ? normPhone(b.contact_phone) : req.user?.phone;
    if (!phone) throw bad('A contact number is needed so the crew can reach you');
    const p = plan(b);
    if (!p) throw bad('No ambulance available nearby — call 1122 or 115 directly');
    const token = randomToken(18);
    const s = summarise(p);
    let subsidy = { amount: 0 };
    if (b.subsidy_program_id && req.user && s.fare_estimate > 0) subsidy = quoteSubsidy(h, req.user.id, b.subsidy_program_id, 'ambulance', s.fare_estimate);
    const now = new Date().toISOString();
    const timeline = [{ status: 'requested', at: now }, { status: 'dispatched', at: now, note: `${s.ambulance.provider} ${s.ambulance.call_sign}` }];
    const id = h.tx(() => {
      const info = h.run(
        `INSERT INTO emergencies (requester_id, contact_phone, lat, lng, severity, complaint, status, ambulance_id, facility_id, eta_min, distance_km, fare_estimate, fare_payer, timeline, track_token_hash, subsidy_amount)
         VALUES (?,?,?,?,?,?, 'dispatched', ?,?,?,?,?,?,?,?,?)`,
        req.user?.id ?? null, phone, b.lat, b.lng, b.severity, b.complaint ?? null, s.ambulance.id, s.destination?.id ?? null, s.ambulance.eta_min,
        s.trip_km, s.fare_estimate, s.fare_estimate === 0 ? 'free (public service)' : subsidy.amount ? `${subsidy.program.name} + patient` : 'patient',
        JSON.stringify(timeline), sha256(token), subsidy.amount);
      h.run(`UPDATE ambulances SET status = 'dispatched', updated_at = datetime('now') WHERE id = ?`, s.ambulance.id);
      if (s.first_responder) h.run(`UPDATE ambulances SET status = 'dispatched' WHERE id = ?`, s.first_responder.id);
      if (subsidy.amount) chargeSubsidy(h, { userId: req.user.id, program: subsidy.program, amount: subsidy.amount, purpose: 'ambulance', ref: `emergency:${info.lastInsertRowid}` });
      if (s.destination) {
        h.run(`INSERT INTO notifications (facility_id, kind, message) VALUES (?, 'pre_alert', ?)`, s.destination.id,
          `Incoming: severity ${b.severity} patient (${b.complaint || 'not stated'}), ETA ~${round(s.ambulance.eta_min + s.destination.eta_min)} min via ${s.ambulance.provider}`);
      }
      return info.lastInsertRowid;
    });
    audit.log(req, 'emergency.request', { resource: 'emergency', resourceId: id, patientId: req.user?.id, detail: { severity: b.severity } });
    res.status(201).json({ id, track_token: token, ...s, subsidy_amount: subsidy.amount, sms: sendSms(phone, `Sehatyab: ${s.ambulance.provider} ambulance ${s.ambulance.call_sign} is coming, ETA ${Math.round(s.ambulance.eta_min)} min.`) });
  });

  function load(req) {
    const e = h.get('SELECT * FROM emergencies WHERE id = ?', req.params.id);
    if (!e) throw notFound('Emergency not found');
    const token = req.get('x-track-token') || req.query.token;
    const allowed = (req.user && (req.user.id === e.requester_id || ['dispatcher', 'admin'].includes(req.user.role))) ||
      (token && sha256(token) === e.track_token_hash) ||
      (req.user?.role === 'facility_admin' && req.user.org_id === e.facility_id);
    if (!allowed) throw forbidden();
    return e;
  }

  function detail(e) {
    const amb = e.ambulance_id ? h.get(`SELECT a.*, p.name AS provider_name, p.hotline, p.kind AS provider_kind FROM ambulances a JOIN ambulance_providers p ON p.id = a.provider_id WHERE a.id = ?`, e.ambulance_id) : null;
    const fac = e.facility_id ? h.get('SELECT id, name, lat, lng, phone, address FROM facilities WHERE id = ?', e.facility_id) : null;
    let eta = null;
    if (amb && ['dispatched'].includes(e.status)) eta = etaMinutes(amb, e, amb.type).minutes;
    if (amb && fac && e.status === 'transporting') eta = etaMinutes(amb, fac, amb.type).minutes;
    const { track_token_hash, ...rest } = e;
    return { ...rest, timeline: JSON.parse(e.timeline), ambulance: amb, facility: fac, live_eta_min: eta };
  }

  r.get('/board', auth.requireRole('dispatcher'), (_req, res) => {
    const active = h.all(`SELECT * FROM emergencies WHERE status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY severity, id`, ...ACTIVE).map(detail);
    const fleet = h.all(`SELECT a.*, p.name AS provider_name, p.kind AS provider_kind FROM ambulances a JOIN ambulance_providers p ON p.id = a.provider_id ORDER BY p.name, a.call_sign`);
    const today = h.get(`SELECT COUNT(*) AS n, AVG(eta_min) AS avg_eta FROM emergencies WHERE date(created_at) = date('now')`);
    // Actual response time (request → crew on scene) from each call's timeline, last 7 days.
    const resp = h.all(`SELECT created_at, timeline FROM emergencies WHERE created_at >= datetime('now', '-7 days')`).map((e) => {
      const onScene = JSON.parse(e.timeline || '[]').find((x) => x.status === 'on_scene');
      return onScene ? (Date.parse(onScene.at) - Date.parse(e.created_at.replace(' ', 'T') + 'Z')) / 60_000 : null;
    }).filter((m) => m != null && m >= 0);
    today.avg_response_7d = resp.length ? Math.round(resp.reduce((s, x) => s + x, 0) / resp.length) : null;
    res.json({ active, fleet, today });
  });

  r.get('/mine', auth.requireAuth, (req, res) => {
    res.json(h.all('SELECT * FROM emergencies WHERE requester_id = ? ORDER BY id DESC LIMIT 20', req.user.id).map(detail));
  });

  r.get('/:id', (req, res) => res.json(detail(load(req))));

  function advance(e, to, note) {
    const timeline = JSON.parse(e.timeline);
    timeline.push({ status: to, at: new Date().toISOString(), note });
    h.run('UPDATE emergencies SET status = ?, timeline = ? WHERE id = ?', to, JSON.stringify(timeline), e.id);
    if (['at_hospital', 'closed', 'cancelled'].includes(to) && e.ambulance_id) {
      // Free the vehicle(s); any first responder on this job is released too.
      h.run(`UPDATE ambulances SET status = 'available' WHERE id = ?`, e.ambulance_id);
    }
    if (to === 'at_hospital' && e.facility_id) h.run('UPDATE facilities SET beds_free = MAX(0, beds_free - 1) WHERE id = ?', e.facility_id);
  }

  r.post('/:id/advance', auth.requireRole('dispatcher'), (req, res) => {
    const e = load(req);
    const i = FLOW.indexOf(e.status);
    if (i < 0 || i === FLOW.length - 1) throw bad(`Cannot advance from ${e.status}`);
    advance(e, FLOW[i + 1]);
    audit.log(req, 'emergency.advance', { resource: 'emergency', resourceId: e.id, detail: { to: FLOW[i + 1] } });
    res.json(detail(h.get('SELECT * FROM emergencies WHERE id = ?', e.id)));
  });

  r.post('/:id/cancel', (req, res) => {
    const e = load(req);
    if (!ACTIVE.includes(e.status)) throw bad('This request is already finished');
    advance(e, 'cancelled', 'Cancelled by requester');
    if (e.subsidy_amount) {
      h.run('UPDATE subsidy_programs SET fund_balance = fund_balance + ? WHERE id = (SELECT program_id FROM ledger WHERE ref = ? LIMIT 1)', e.subsidy_amount, `emergency:${e.id}`);
    }
    res.json(detail(h.get('SELECT * FROM emergencies WHERE id = ?', e.id)));
  });

  // Fleet simulator: moves dispatched vehicles towards the patient, then the hospital.
  // In production, positions arrive from vehicle GPS/AVL (e.g. existing TPL Trakker units).
  r.post('/simulate-tick', auth.requireRole('dispatcher'), (req, res) => {
    let moved = 0;
    for (const e of h.all(`SELECT * FROM emergencies WHERE status IN ('dispatched','transporting','on_scene')`)) {
      const a = h.get('SELECT * FROM ambulances WHERE id = ?', e.ambulance_id);
      if (!a) continue;
      if (e.status === 'on_scene') { advance(e, 'transporting', 'Patient loaded'); continue; }
      const target = e.status === 'dispatched' ? e : h.get('SELECT lat, lng FROM facilities WHERE id = ?', e.facility_id);
      if (!target) continue;
      const dist = haversineKm(a, target);
      const next = dist < 0.3 ? target : stepTowards(a, target, 0.45);
      h.run(`UPDATE ambulances SET lat = ?, lng = ?, updated_at = datetime('now') WHERE id = ?`, next.lat, next.lng, a.id);
      if (dist < 0.3) advance(e, e.status === 'dispatched' ? 'on_scene' : 'at_hospital');
      moved++;
    }
    // Release first-responder bikes that are not tied to an active job.
    h.run(`UPDATE ambulances SET status = 'available' WHERE type = 'bike' AND status = 'dispatched'
      AND id NOT IN (SELECT ambulance_id FROM emergencies WHERE status IN ('dispatched','on_scene','transporting') AND ambulance_id IS NOT NULL)
      AND (SELECT COUNT(*) FROM emergencies WHERE status = 'dispatched') = 0`);
    res.json({ moved });
  });

  r.plan = plan; // exposed for tests
  return r;
}
