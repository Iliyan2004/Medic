// Support module: subsidy programmes (govt, zakat, CSR, donors, PPP), eligibility checks via
// NSER, donations with a public ledger, and a PPP contract performance dashboard.
import express from 'express';
import { validate, bad, notFound } from '../lib/validate.js';
import { nserLookup, initiatePayment } from '../lib/adapters.js';

export function scoreKpis(targets, metrics) {
  const parts = [];
  for (const [k, t] of Object.entries(targets)) {
    const actual = metrics[k];
    if (actual == null) continue;
    const ratio = t.lower ? (actual <= t.target ? 1 : t.target / actual) : Math.min(1, actual / t.target);
    parts.push({ metric: k, target: t.target, actual, lower: !!t.lower, unit: t.unit, label: t.label, achievement: +ratio.toFixed(2) });
  }
  const score = parts.length ? Math.round((parts.reduce((s, p) => s + p.achievement, 0) / parts.length) * 100) : null;
  return { score, parts };
}

export default function subsidyRoutes({ h, auth, audit }) {
  const r = express.Router();
  const parseProgram = (p) => ({ ...p, provinces: JSON.parse(p.provinces), covers: JSON.parse(p.covers) });

  r.get('/programs', (_req, res) => {
    res.json(h.all(`SELECT p.*, (SELECT COUNT(*) FROM beneficiaries b WHERE b.program_id = p.id) AS beneficiaries FROM subsidy_programs p WHERE active = 1 ORDER BY type, name`).map(parseProgram));
  });

  r.post('/programs', auth.requireRole('program_admin'), (req, res) => {
    const b = validate(req.body, {
      name: 'string', sponsor: 'string', type: ['govt', 'zakat', 'csr', 'donor', 'ppp'], description: 'text?',
      max_pmt_score: 'number?', provinces: 'array?', covers: 'array', per_person_annual_cap: 'number?', copay_pct: 'number?', fund_balance: 'number?',
    });
    const info = h.run(`INSERT INTO subsidy_programs (name, sponsor, type, description, max_pmt_score, provinces, covers, per_person_annual_cap, copay_pct, fund_balance)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, b.name, b.sponsor, b.type, b.description ?? null, b.max_pmt_score ?? null, JSON.stringify(b.provinces || []),
      JSON.stringify(b.covers), b.per_person_annual_cap ?? null, b.copay_pct ?? 0, b.fund_balance ?? 0);
    if (b.fund_balance) h.run(`INSERT INTO ledger (program_id, amount, kind, purpose, ref) VALUES (?,?,'credit','opening budget','admin')`, info.lastInsertRowid, b.fund_balance);
    audit.log(req, 'program.create', { resource: 'program', resourceId: info.lastInsertRowid });
    res.status(201).json(parseProgram(h.get('SELECT * FROM subsidy_programs WHERE id = ?', info.lastInsertRowid)));
  });

  // One check, every programme: the patient doesn't need to know which scheme they qualify for.
  r.post('/check-eligibility', auth.requireRole('patient'), (req, res) => {
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.cnic_hash) throw bad('Add your CNIC in your profile first — eligibility is checked against the national socio-economic registry (NSER)');
    if (!u.province) throw bad('Add your province in your profile first');
    const nser = nserLookup(u.cnic_hash);
    const results = [];
    for (const p of h.all('SELECT * FROM subsidy_programs WHERE active = 1').map(parseProgram)) {
      const reasons = [];
      if (p.provinces.length && !p.provinces.includes(u.province)) reasons.push(`only for ${p.provinces.join(', ')}`);
      if (p.max_pmt_score != null && nser.pmtScore > p.max_pmt_score) reasons.push(`poverty score ${nser.pmtScore} is above the cut-off of ${p.max_pmt_score}`);
      const eligible = reasons.length === 0;
      if (eligible) {
        h.run(`INSERT INTO beneficiaries (user_id, program_id, pmt_score) VALUES (?,?,?)
               ON CONFLICT(user_id, program_id) DO UPDATE SET pmt_score = excluded.pmt_score, status = 'eligible', verified_at = datetime('now')`,
          u.id, p.id, nser.pmtScore);
      }
      results.push({ program_id: p.id, name: p.name, sponsor: p.sponsor, type: p.type, covers: p.covers, eligible, reasons, copay_pct: p.copay_pct, per_person_annual_cap: p.per_person_annual_cap });
    }
    audit.log(req, 'eligibility.check', { patientId: u.id, resource: 'nser', detail: { eligible: results.filter((x) => x.eligible).length } });
    res.json({ pmtScore: nser.pmtScore, simulated: nser.simulated, results });
  });

  r.get('/my', auth.requireRole('patient'), (req, res) => {
    const year = new Date().getFullYear().toString();
    res.json(h.all(
      `SELECT b.*, p.name, p.sponsor, p.type, p.covers, p.per_person_annual_cap, p.copay_pct,
         (SELECT COALESCE(SUM(amount),0) FROM ledger l WHERE l.program_id = p.id AND l.user_id = b.user_id AND l.kind='debit' AND substr(l.ts,1,4) = ?) AS used_this_year
       FROM beneficiaries b JOIN subsidy_programs p ON p.id = b.program_id WHERE b.user_id = ? AND b.status = 'eligible'`, year, req.user.id)
      .map((x) => ({ ...x, covers: JSON.parse(x.covers) })));
  });

  r.post('/programs/:id/donate', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { amount: 'number', method: ['jazzcash', 'easypaisa', 'raast', 'card'], anonymous: 'bool?' });
    if (b.amount < 100 || b.amount > 10_000_000) throw bad('Donation must be between PKR 100 and 10,000,000');
    const p = h.get('SELECT * FROM subsidy_programs WHERE id = ? AND active = 1', req.params.id);
    if (!p) throw notFound('Programme not found');
    if (p.type === 'govt') throw bad('Government budget programmes do not accept donations');
    const pay = initiatePayment({ method: b.method, amount: b.amount, reference: `donation:${p.id}` });
    h.tx(() => {
      h.run('UPDATE subsidy_programs SET fund_balance = fund_balance + ? WHERE id = ?', b.amount, p.id);
      h.run(`INSERT INTO ledger (program_id, user_id, amount, kind, purpose, ref) VALUES (?,?,?,'credit',?,?)`,
        p.id, b.anonymous ? null : req.user.id, b.amount, p.type === 'zakat' ? 'zakat' : 'donation', pay.providerRef);
    });
    audit.log(req, 'donation', { resource: 'program', resourceId: p.id, detail: { amount: b.amount } });
    res.status(201).json({ ok: true, payment: pay, receipt: { programme: p.name, amount: b.amount, ref: pay.providerRef } });
  });

  // Public transparency: totals in and out, no personal data.
  r.get('/transparency', (_req, res) => {
    const programs = h.all(`SELECT p.id, p.name, p.sponsor, p.type, p.fund_balance,
        (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE program_id = p.id AND kind='credit') AS total_in,
        (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE program_id = p.id AND kind='debit') AS total_out,
        (SELECT COUNT(DISTINCT user_id) FROM ledger WHERE program_id = p.id AND kind='debit') AS people_helped
      FROM subsidy_programs p ORDER BY total_out DESC`);
    const byPurpose = h.all(`SELECT purpose, COUNT(*) AS n, SUM(amount) AS amount FROM ledger WHERE kind='debit' GROUP BY purpose`);
    const recent = h.all(`SELECT l.ts, p.name AS programme, l.kind, l.amount, l.purpose FROM ledger l JOIN subsidy_programs p ON p.id = l.program_id ORDER BY l.id DESC LIMIT 25`);
    res.json({ programs, byPurpose, recent });
  });

  // ── Public-private partnership monitoring ──
  r.get('/ppp', (_req, res) => {
    const rows = h.all(`SELECT c.*, f.name AS facility_name, f.city, f.type AS facility_type FROM ppp_contracts c LEFT JOIN facilities f ON f.id = c.facility_id ORDER BY c.id`);
    res.json(rows.map((c) => {
      const targets = JSON.parse(c.kpi_targets);
      const reports = h.all('SELECT * FROM ppp_reports WHERE contract_id = ? ORDER BY period', c.id).map((rp) => ({ ...rp, metrics: JSON.parse(rp.metrics) }));
      const latest = reports.at(-1);
      return { ...c, kpi_targets: targets, reports: reports.map((rp) => ({ period: rp.period, score: rp.score })), latest: latest ? { period: latest.period, ...scoreKpis(targets, latest.metrics) } : null };
    }));
  });

  r.post('/ppp/:id/report', auth.requireRole('program_admin', 'facility_admin'), (req, res) => {
    const b = validate(req.body, { period: 'string', metrics: 'object' });
    if (!/^\d{4}-\d{2}$/.test(b.period)) throw bad('Period must be YYYY-MM');
    const c = h.get('SELECT * FROM ppp_contracts WHERE id = ?', req.params.id);
    if (!c) throw notFound('Contract not found');
    if (req.user.role === 'facility_admin' && req.user.org_id !== c.facility_id) throw bad('You can only report for your own facility');
    const targets = JSON.parse(c.kpi_targets);
    const metrics = {};
    for (const k of Object.keys(targets)) if (b.metrics[k] != null && Number.isFinite(Number(b.metrics[k]))) metrics[k] = Number(b.metrics[k]);
    const { score } = scoreKpis(targets, metrics);
    h.run('DELETE FROM ppp_reports WHERE contract_id = ? AND period = ?', c.id, b.period);
    h.run('INSERT INTO ppp_reports (contract_id, period, metrics, score, submitted_by) VALUES (?,?,?,?,?)', c.id, b.period, JSON.stringify(metrics), score, req.user.id);
    audit.log(req, 'ppp.report', { resource: 'ppp_contract', resourceId: c.id, detail: { period: b.period, score } });
    res.status(201).json({ period: b.period, score, ...scoreKpis(targets, metrics) });
  });

  return r;
}
