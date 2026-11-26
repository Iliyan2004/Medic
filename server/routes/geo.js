// Health geography API: public aggregate maps + facility weekly disease reporting.
import express from 'express';
import { validate, bad, forbidden } from '../lib/validate.js';
import { DISEASES, DISEASE, diseaseByCity, accessByCity, supplyByCity, weekStart } from '../lib/geo-health.js';

export default function geoRoutes({ h, auth, audit }) {
  const r = express.Router();
  // Aggregates are cached in memory for 5 minutes: access analysis scans every facility.
  const cache = new Map();
  const cached = (key, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < 300_000) return hit.v;
    const v = fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  };

  r.get('/diseases', (_req, res) => res.json(DISEASES.map(({ code, name }) => ({ code, name }))));

  r.get('/disease', (req, res) => {
    const code = DISEASE[req.query.disease] ? req.query.disease : 'dengue';
    const weeks = Math.min(26, Math.max(5, Number.parseInt(req.query.weeks, 10) || 8));
    res.json(cached(`d:${code}:${weeks}`, () => diseaseByCity(h, code, weeks)));
  });

  // Which diseases are rising anywhere right now (for a banner).
  r.get('/alerts', (_req, res) => {
    res.json(cached('alerts', () => DISEASES.map((d) => ({ code: d.code, name: d.name, cities: diseaseByCity(h, d.code, 8).rising })).filter((a) => a.cities.length)));
  });

  r.get('/access', (_req, res) => res.json(cached('access', () => accessByCity(h))));
  r.get('/supply', (_req, res) => res.json(cached('supply', () => supplyByCity(h))));

  // Facility staff submit this week's (or last week's) case counts for their own facility.
  r.post('/disease-reports', auth.requireRole('facility_admin'), (req, res) => {
    const b = validate(req.body, { week_start: 'string?', counts: 'object', facility_id: 'int?' });
    const fid = req.user.role === 'admin' && b.facility_id ? b.facility_id : req.user.org_id;
    if (!fid || !h.get('SELECT 1 FROM facilities WHERE id = ? AND verified = 1', fid)) throw forbidden('Only verified facilities can report');
    const ws = b.week_start ? weekStart(new Date(`${b.week_start}T00:00:00Z`)) : weekStart();
    if (Number.isNaN(Date.parse(ws)) || ws > weekStart() || ws < weekStart(new Date(Date.now() - 8 * 7 * 86_400_000))) throw bad('Report a week within the last 8 weeks');
    let n = 0;
    h.tx(() => {
      for (const [code, raw] of Object.entries(b.counts)) {
        if (!DISEASE[code]) throw bad(`Unknown disease: ${code}`);
        const cases = Number(raw);
        if (!Number.isInteger(cases) || cases < 0 || cases > 100000) throw bad(`Cases for ${code} must be a whole number`);
        h.run(`INSERT INTO disease_reports (facility_id, week_start, disease, cases, source, reported_by) VALUES (?,?,?,?, 'facility', ?)
          ON CONFLICT(facility_id, week_start, disease) DO UPDATE SET cases = excluded.cases, source = 'facility', reported_by = excluded.reported_by, created_at = datetime('now')`,
        fid, ws, code, cases, req.user.id);
        n++;
      }
    });
    cache.clear();
    audit.log(req, 'geo.disease_report', { resource: 'facility', resourceId: fid, detail: { week: ws, diseases: n } });
    res.status(201).json({ ok: true, week_start: ws, saved: n });
  });

  r.get('/disease-reports/mine', auth.requireRole('facility_admin'), (req, res) => {
    res.json(h.all('SELECT week_start, disease, cases FROM disease_reports WHERE facility_id = ? ORDER BY week_start DESC, disease LIMIT 200', req.user.org_id));
  });

  return r;
}
