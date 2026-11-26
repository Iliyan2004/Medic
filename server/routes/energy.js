// Energy module: facility power & vaccine cold-chain telemetry, alerts, solar sizing with payback,
// and the platform's own footprint (bytes shipped per screen).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { validate, bad, notFound, forbidden } from '../lib/validate.js';
import { assess, sizeSolar, DEFAULT_ASSUMPTIONS } from '../lib/energy.js';

const PUBLIC = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'public');

export default function energyRoutes({ h, auth, audit }) {
  const r = express.Router();

  r.get('/facilities', (_req, res) => {
    const rows = h.all(`SELECT id, name, type, city, sector, power_source, solar_kw, battery_kwh, lat, lng FROM facilities WHERE type != 'camp' AND id IN (SELECT DISTINCT facility_id FROM energy_readings)`);
    const out = rows.map((f) => {
      const reading = h.get('SELECT * FROM energy_readings WHERE facility_id = ? ORDER BY ts DESC LIMIT 1', f.id);
      return { ...f, latest: reading || null, assessment: assess(reading, f) };
    }).filter((f) => f.latest);
    const summary = {
      monitored: out.length,
      critical: out.filter((f) => f.assessment.level === 'critical').length,
      warning: out.filter((f) => f.assessment.level === 'warning').length,
      solar_facilities: out.filter((f) => ['solar', 'hybrid'].includes(f.power_source)).length,
      solar_kw_total: +out.reduce((s, f) => s + (f.solar_kw || 0), 0).toFixed(1),
      grid_down_now: out.filter((f) => !f.latest.grid_on).length,
    };
    res.json({ summary, facilities: out.sort((a, b) => ({ critical: 0, warning: 1, ok: 2 }[a.assessment.level] - { critical: 0, warning: 1, ok: 2 }[b.assessment.level])) });
  });

  r.get('/facilities/:id/readings', (req, res) => {
    const f = h.get('SELECT * FROM facilities WHERE id = ?', req.params.id);
    if (!f) throw notFound();
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const readings = h.all('SELECT * FROM energy_readings WHERE facility_id = ? AND ts >= ? ORDER BY ts', f.id, since);
    const n = readings.length || 1;
    const stats = {
      grid_uptime_pct: Math.round((readings.filter((x) => x.grid_on).length / n) * 100),
      generator_hours: readings.filter((x) => x.generator_on).length, // readings are hourly
      solar_kwh: +readings.reduce((s, x) => s + (x.solar_kw || 0), 0).toFixed(1),
      load_kwh: +readings.reduce((s, x) => s + (x.load_kw || 0), 0).toFixed(1),
      fridge_excursions: readings.filter((x) => x.fridge_temp_c != null && (x.fridge_temp_c < 2 || x.fridge_temp_c > 8)).length,
    };
    stats.solar_share_pct = stats.load_kwh ? Math.min(100, Math.round((stats.solar_kwh / stats.load_kwh) * 100)) : 0;
    res.json({ facility: { id: f.id, name: f.name, power_source: f.power_source, solar_kw: f.solar_kw, battery_kwh: f.battery_kwh }, stats, readings });
  });

  // Telemetry ingest (from an IoT gateway at the facility, or manual entry by the facility admin).
  r.post('/readings', auth.requireRole('facility_admin'), (req, res) => {
    const b = validate(req.body, { facility_id: 'int', grid_on: 'bool', solar_kw: 'number?', battery_pct: 'number?', load_kw: 'number?', fridge_temp_c: 'number?', generator_on: 'bool?' });
    if (req.user.role !== 'admin' && req.user.org_id !== b.facility_id) throw forbidden('You can only report for your own facility');
    const f = h.get('SELECT * FROM facilities WHERE id = ?', b.facility_id);
    if (!f) throw notFound();
    if (b.battery_pct != null && (b.battery_pct < 0 || b.battery_pct > 100)) throw bad('Battery % must be 0–100');
    const ts = new Date().toISOString();
    h.run(`INSERT INTO energy_readings (facility_id, ts, grid_on, solar_kw, battery_pct, load_kw, fridge_temp_c, generator_on) VALUES (?,?,?,?,?,?,?,?)`,
      f.id, ts, b.grid_on ? 1 : 0, b.solar_kw ?? null, b.battery_pct ?? null, b.load_kw ?? null, b.fridge_temp_c ?? null, b.generator_on ? 1 : 0);
    const a = assess({ ...b, ts }, f);
    if (a.level === 'critical') {
      h.run(`INSERT INTO notifications (facility_id, kind, message) VALUES (?, 'energy', ?)`, f.id, `CRITICAL at ${f.name}: ${a.alerts.join('; ')}`);
      for (const admin of h.all(`SELECT id FROM users WHERE role IN ('program_admin','admin')`)) {
        h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'energy', ?)`, admin.id, `CRITICAL at ${f.name}: ${a.alerts.join('; ')}`);
      }
    }
    audit.log(req, 'energy.reading', { resource: 'facility', resourceId: f.id, detail: { level: a.level } });
    res.status(201).json({ assessment: a });
  });

  r.get('/assumptions', (_req, res) => res.json(DEFAULT_ASSUMPTIONS));

  r.post('/solar-calculator', (req, res) => {
    const b = validate(req.body, { dailyKwh: 'number', outageHours: 'number?', criticalLoadKw: 'number?', assumptions: 'object?' });
    if (b.dailyKwh <= 0 || b.dailyKwh > 5000) throw bad('Daily use must be between 0 and 5,000 kWh');
    const a = {};
    for (const k of Object.keys(DEFAULT_ASSUMPTIONS)) if (b.assumptions?.[k] != null && Number.isFinite(Number(b.assumptions[k]))) a[k] = Number(b.assumptions[k]);
    res.json(sizeSolar({ dailyKwh: b.dailyKwh, outageHours: b.outageHours ?? 6, criticalLoadKw: b.criticalLoadKw ?? Math.max(0.5, b.dailyKwh / 24), a }));
  });

  // The platform's own footprint: compressed bytes of the app shell (what a phone downloads once).
  let footprint = null;
  r.get('/platform', (_req, res) => {
    if (!footprint) {
      const files = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(js|css|html|webmanifest|svg)$/.test(e.name)) {
            const raw = fs.readFileSync(p);
            files.push({ file: path.relative(PUBLIC, p), raw: raw.length, gzip: zlib.gzipSync(raw).length });
          }
        }
      };
      walk(PUBLIC);
      const gzip = files.reduce((s, f) => s + f.gzip, 0);
      // ~0.06 kWh per GB transferred (network+device, mid-range estimate); Pakistan grid ~0.42 kg CO2/kWh
      const kwhPerLoad = (gzip / 1e9) * 0.06;
      footprint = {
        app_shell_kb_gzip: +(gzip / 1024).toFixed(1),
        app_shell_kb_raw: +(files.reduce((s, f) => s + f.raw, 0) / 1024).toFixed(1),
        files: files.sort((a, b) => b.gzip - a.gzip),
        est_grams_co2_per_first_load: +(kwhPerLoad * 420).toFixed(4),
        practices: [
          'No front-end framework: plain JavaScript modules, no build step',
          'Gzip on every response; long-lived caching of static files',
          'Service worker caches the app shell — repeat visits work offline and download almost nothing',
          'Low-data mode turns off map tiles and route lookups',
          'Dark theme follows the system setting (saves battery on OLED screens)',
          'Polling slows down when the tab is hidden',
          'Map tiles and routing only load when the map screen is opened',
        ],
      };
    }
    res.json(footprint);
  });

  return r;
}
