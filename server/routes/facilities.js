// Facility map: hospitals, clinics, BHUs/RHCs, labs, blood banks, pharmacies and time-bound health camps.
import express from 'express';
import { validate, bad, notFound, isLatLng } from '../lib/validate.js';
import { haversineKm } from '../lib/geo.js';
import { assess } from '../lib/energy.js';
import { PROVINCES } from './auth.js';
import { notifyCampAlerts } from '../lib/alerts.js';

const TYPES = ['hospital', 'clinic', 'bhu', 'rhc', 'lab', 'pharmacy', 'blood_bank', 'camp'];

export default function facilityRoutes({ h, auth, audit }) {
  const r = express.Router();

  function withStatus(f) {
    const reading = h.get('SELECT * FROM energy_readings WHERE facility_id = ? ORDER BY ts DESC LIMIT 1', f.id);
    const now = new Date().toISOString();
    return {
      ...f,
      services: JSON.parse(f.services || '[]'),
      power: reading ? { ...assess(reading, f), grid_on: !!reading.grid_on, battery_pct: reading.battery_pct } : null,
      camp_state: f.type === 'camp' ? (f.ends_at < now ? 'ended' : f.starts_at > now ? 'upcoming' : 'active') : undefined,
    };
  }

  // Lightweight list with filters; ?near=lat,lng sorts by distance. Ended camps are hidden by default.
  // All filters run in SQL; power status is computed only for the rows actually returned (CPU stays flat
  // even with thousands of imported OpenStreetMap facilities). Verified places always rank first.
  r.get('/', (req, res) => {
    const type = TYPES.includes(req.query.type) ? req.query.type : '';
    const q = String(req.query.q || '').slice(0, 60);
    const city = String(req.query.city || '').slice(0, 40);
    const limit = Math.min(300, Math.max(1, Number.parseInt(req.query.limit, 10) || 200));
    const flag = (k) => (req.query[k] === '1' ? 1 : 0);
    const [lat, lng] = String(req.query.near || '').split(',').map(Number);
    const near = isLatLng(lat, lng);
    const query = (box) => h.all(
      `SELECT * FROM facilities WHERE (? = '' OR type = ?) AND (? = '' OR city = ?) AND (? = '' OR name LIKE ? OR services LIKE ?)
       AND (type != 'camp' OR ends_at >= ? OR ? = 1)
       AND (? = 0 OR sehat_empanelled = 1) AND (? = 0 OR female_doctor = 1) AND (? = 0 OR emergency = 1) AND (? = 0 OR verified = 1)
       AND (? = 1 OR type != 'pharmacy' OR source != 'osm')
       AND (? = 0 OR (lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?))`, // "near me": index-backed bounding box first
      type, type, city, city, q, `%${q}%`, `%${q}%`, new Date().toISOString(), flag('include_ended'),
      flag('sehat'), flag('female_doctor'), flag('emergency'), flag('verified'), type === 'pharmacy' ? 1 : 0,
      box ? 1 : 0, lat - (box || 0), lat + (box || 0), lng - (box || 0), lng + (box || 0),
    );
    // Widen the box until there are enough places (≈30 km → 110 km → whole country).
    let rows = [];
    if (near) { for (const box of [0.3, 1, 0]) { rows = query(box); if (rows.length >= limit || box === 0) break; } }
    else rows = query(0);
    let out;
    if (near) {
      out = rows.map((f) => ({ f, d: haversineKm({ lat, lng }, f) })).sort((a, b) => a.d - b.d).slice(0, limit)
        .map(({ f, d }) => ({ ...withStatus(f), distance_km: +d.toFixed(1) }));
    } else {
      out = rows.sort((a, b) => b.verified - a.verified || (a.source === 'osm') - (b.source === 'osm') || a.name.localeCompare(b.name))
        .slice(0, limit).map(withStatus);
    }
    res.set('X-Total-Count', String(rows.length));
    res.json(out);
  });

  r.get('/cities', (_req, res) => res.json(h.all(`SELECT city, COUNT(*) AS n FROM facilities WHERE city IS NOT NULL AND city != 'Other' GROUP BY city HAVING n >= 3 ORDER BY n DESC`)));

  r.get('/:id', (req, res) => {
    const f = h.get('SELECT * FROM facilities WHERE id = ?', req.params.id);
    if (!f) throw notFound('Facility not found');
    const ppp = h.get('SELECT operator, govt_partner, model FROM ppp_contracts WHERE facility_id = ?', f.id);
    res.json({ ...withStatus(f), ppp });
  });

  // Anyone signed in can submit a facility or camp; it shows as "unverified" until an admin checks the licence.
  r.post('/', auth.requireAuth, (req, res) => {
    const b = validate(req.body, {
      name: 'string', type: TYPES, sector: ['public', 'private', 'ngo', 'ppp', '?'], lat: 'number', lng: 'number',
      city: 'string', province: [...PROVINCES, '?'], address: 'string?', phone: 'string?', services: 'array?',
      starts_at: 'string?', ends_at: 'string?', organizer: 'string?', female_doctor: 'bool?', license_no: 'string?',
    });
    if (!isLatLng(b.lat, b.lng)) throw bad('Location must be inside Pakistan');
    if (b.type === 'camp') {
      if (!b.starts_at || !b.ends_at || !b.organizer) throw bad('Camps need a start time, end time and organiser');
      if (new Date(b.ends_at) <= new Date(b.starts_at)) throw bad('Camp must end after it starts');
    }
    const trusted = ['admin', 'facility_admin', 'program_admin'].includes(req.user.role);
    const info = h.run(
      `INSERT INTO facilities (name, type, sector, lat, lng, city, province, address, phone, services, starts_at, ends_at, organizer, female_doctor, license_no, verified, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.name, b.type, b.sector ?? (b.type === 'camp' ? 'ngo' : 'private'), b.lat, b.lng, b.city, b.province ?? null, b.address ?? null, b.phone ?? null,
      JSON.stringify((b.services || []).map(String).slice(0, 20)), b.starts_at ? new Date(b.starts_at).toISOString() : null,
      b.ends_at ? new Date(b.ends_at).toISOString() : null, b.organizer ?? null, b.female_doctor ? 1 : 0, b.license_no ?? null, trusted ? 1 : 0, req.user.id);
    audit.log(req, 'facility.create', { resource: 'facility', resourceId: info.lastInsertRowid, detail: { type: b.type } });
    const created = h.get('SELECT * FROM facilities WHERE id = ?', info.lastInsertRowid);
    notifyCampAlerts(h, created);
    res.status(201).json(withStatus(created));
  });

  // Facility admins keep bed availability current (used by ambulance dispatch).
  r.patch('/:id/beds', auth.requireRole('facility_admin'), (req, res) => {
    const b = validate(req.body, { beds_free: 'int' });
    const f = h.get('SELECT * FROM facilities WHERE id = ?', req.params.id);
    if (!f) throw notFound();
    if (req.user.role !== 'admin' && req.user.org_id !== f.id) throw bad('You can only update your own facility');
    h.run('UPDATE facilities SET beds_free = ? WHERE id = ?', Math.max(0, Math.min(b.beds_free, f.beds_total)), f.id);
    res.json(withStatus(h.get('SELECT * FROM facilities WHERE id = ?', f.id)));
  });

  r.get('/:id/notifications', auth.requireRole('facility_admin'), (req, res) => {
    if (req.user.role !== 'admin' && req.user.org_id !== Number(req.params.id)) throw bad('Not your facility');
    res.json(h.all('SELECT * FROM notifications WHERE facility_id = ? ORDER BY id DESC LIMIT 50', req.params.id));
  });

  return r;
}
