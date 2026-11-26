// Insurance module: compare conventional & takaful plans, enrol, Sehat Card check,
// file claims with instant rule-based screening, insurer review queue & analytics.
import express from 'express';
import crypto from 'node:crypto';
import { validate, bad, forbidden, notFound } from '../lib/validate.js';
import { screenClaim } from '../lib/fraud.js';
import { initiatePayment, nserLookup, sehatCardLookup } from '../lib/adapters.js';

export default function insuranceRoutes({ h, auth, audit }) {
  const r = express.Router();
  const PLAN_SQL = `SELECT p.*, i.name AS insurer, i.digital_only FROM insurance_plans p JOIN insurers i ON i.id = p.insurer_id`;
  const parseClaim = (c) => ({ ...c, fraud_flags: JSON.parse(c.fraud_flags || '[]') });

  r.get('/plans', (req, res) => {
    const model = ['conventional', 'takaful'].includes(req.query.model) ? req.query.model : '';
    const kind = String(req.query.kind || '').slice(0, 20);
    res.json(h.all(`${PLAN_SQL} WHERE (? = '' OR p.model = ?) AND (? = '' OR p.kind = ?) ORDER BY p.premium_monthly`, model, model, kind, kind));
  });

  // Sehat Card + NSER check for the signed-in patient (simulated adapters until NADRA/State Life open access).
  r.get('/sehat-check', auth.requireRole('patient'), (req, res) => {
    const u = h.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.cnic_hash) throw bad('Add your CNIC in your profile to check Sehat Card eligibility');
    if (!u.province) throw bad('Add your province in your profile');
    const nser = nserLookup(u.cnic_hash);
    const sehat = sehatCardLookup({ province: u.province, pmtScore: nser.pmtScore });
    audit.log(req, 'sehat.check', { patientId: u.id, resource: 'eligibility' });
    res.json({ sehat, nser: { pmtScore: nser.pmtScore, simulated: true }, recommendation: sehat.eligible
      ? 'You have inpatient cover through Sehat Card. Consider an OPD or medicines top-up plan for outpatient costs, which Sehat Card does not cover.'
      : 'You do not appear to qualify for Sehat Card. A family inpatient plan or hospital-cash micro-plan gives basic protection.' });
  });

  r.post('/enroll', auth.requireRole('patient'), (req, res) => {
    const b = validate(req.body, { plan_id: 'int', members: 'array?', payment_method: ['jazzcash', 'easypaisa', 'raast', 'card'], employer: 'string?' });
    const plan = h.get(`${PLAN_SQL} WHERE p.id = ?`, b.plan_id);
    if (!plan) throw notFound('Plan not found');
    const members = (b.members || []).slice(0, 8).map((m) => validate(m, { name: 'string', relation: ['spouse', 'child', 'parent', 'self'], birth_year: 'int?' }));
    if (plan.kind !== 'family' && members.length) throw bad('Only family plans can include dependants');
    if (h.get(`SELECT id FROM policies WHERE user_id = ? AND plan_id = ? AND status = 'active'`, req.user.id, plan.id)) throw bad('You already have this plan');
    const start = new Date();
    const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
    const policyNo = `SY-${plan.model === 'takaful' ? 'T' : 'C'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const pay = initiatePayment({ method: b.payment_method, amount: plan.premium_monthly, reference: policyNo });
    const info = h.run(`INSERT INTO policies (policy_no, user_id, plan_id, start_date, end_date, members, employer) VALUES (?,?,?,?,?,?,?)`,
      policyNo, req.user.id, plan.id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), JSON.stringify(members), b.employer ?? null);
    audit.log(req, 'policy.create', { resource: 'policy', resourceId: info.lastInsertRowid, patientId: req.user.id });
    res.status(201).json({ policy: h.get('SELECT * FROM policies WHERE id = ?', info.lastInsertRowid), payment: pay });
  });

  r.get('/policies', auth.requireRole('patient'), (req, res) => {
    const rows = h.all(
      `SELECT po.*, p.name AS plan_name, p.kind, p.model, p.annual_limit, p.opd_limit, p.daily_cash, i.name AS insurer,
         (SELECT COALESCE(SUM(approved_amount),0) FROM claims c WHERE c.policy_id = po.id AND c.status IN ('auto_approved','approved','paid')) AS used
       FROM policies po JOIN insurance_plans p ON p.id = po.plan_id JOIN insurers i ON i.id = p.insurer_id
       WHERE po.user_id = ? ORDER BY po.id DESC`, req.user.id);
    res.json(rows.map((p) => ({ ...p, members: JSON.parse(p.members), remaining: p.annual_limit - p.used })));
  });

  r.post('/claims', auth.requireRole('patient'), (req, res) => {
    const b = validate(req.body, {
      policy_id: 'int', facility_id: 'int?', kind: ['preauth', 'reimbursement', 'hospital_cash', 'pharmacy', 'opd'],
      icd10: 'string?', diagnosis: 'string', amount: 'number?', nights: 'int?',
    });
    const policy = h.get('SELECT * FROM policies WHERE id = ? AND user_id = ?', b.policy_id, req.user.id);
    if (!policy) throw notFound('Policy not found');
    if (policy.status !== 'active' || policy.end_date < new Date().toISOString().slice(0, 10)) throw bad('Policy is not active');
    const plan = h.get('SELECT * FROM insurance_plans WHERE id = ?', policy.plan_id);
    if (b.kind === 'hospital_cash') {
      if (!plan.daily_cash) throw bad('This plan does not pay hospital cash');
      if (!b.nights || b.nights < 1) throw bad('Enter number of nights in hospital');
      b.amount = b.nights * plan.daily_cash;
    }
    if (['opd', 'pharmacy'].includes(b.kind) && !plan.opd_limit) throw bad('This plan does not cover outpatient/pharmacy costs');
    if (!b.amount || b.amount <= 0) throw bad('Enter the claim amount');
    if (b.icd10 && !/^[A-Z]\d{2}(\.\d{1,2})?$/.test(b.icd10.toUpperCase())) throw bad('ICD-10 code looks wrong (e.g. A09 or J18.9)');
    b.icd10 = b.icd10?.toUpperCase();
    const facility = b.facility_id ? h.get('SELECT * FROM facilities WHERE id = ?', b.facility_id) : null;
    const history = h.all('SELECT * FROM claims WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
    const used = h.get(`SELECT COALESCE(SUM(approved_amount),0) AS s FROM claims WHERE policy_id = ? AND status IN ('auto_approved','approved','paid')`, policy.id).s;
    const effectivePlan = ['opd', 'pharmacy'].includes(b.kind) ? { ...plan, annual_limit: plan.opd_limit } : plan;
    const usedForLimit = ['opd', 'pharmacy'].includes(b.kind)
      ? h.get(`SELECT COALESCE(SUM(approved_amount),0) AS s FROM claims WHERE policy_id = ? AND kind IN ('opd','pharmacy') AND status IN ('auto_approved','approved','paid')`, policy.id).s
      : used;
    const s = screenClaim({ claim: b, policy, plan: effectivePlan, facility, history, usedThisYear: usedForLimit });
    const status = s.autoApprove ? 'auto_approved' : 'under_review';
    const info = h.run(
      `INSERT INTO claims (policy_id, user_id, facility_id, kind, icd10, diagnosis, amount, approved_amount, nights, status, fraud_score, fraud_flags, decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      policy.id, req.user.id, facility?.id ?? null, b.kind, b.icd10 ?? null, b.diagnosis, b.amount,
      s.autoApprove ? b.amount : null, b.nights ?? 0, status, s.score, JSON.stringify(s.flags), s.autoApprove ? new Date().toISOString() : null);
    if (facility && b.kind === 'preauth' && s.autoApprove) {
      h.run(`INSERT INTO notifications (facility_id, kind, message) VALUES (?, 'preauth', ?)`, facility.id, `Cashless pre-authorisation approved for claim #${info.lastInsertRowid} (PKR ${b.amount})`);
    }
    audit.log(req, 'claim.create', { resource: 'claim', resourceId: info.lastInsertRowid, patientId: req.user.id, detail: { status, score: s.score } });
    res.status(201).json(parseClaim(h.get('SELECT * FROM claims WHERE id = ?', info.lastInsertRowid)));
  });

  r.get('/claims', auth.requireAuth, (req, res) => {
    let rows;
    if (req.user.role === 'insurer') {
      const status = String(req.query.status || '');
      rows = h.all(
        `SELECT c.*, u.name AS patient_name, f.name AS facility_name, p.name AS plan_name, po.policy_no
         FROM claims c JOIN policies po ON po.id = c.policy_id JOIN insurance_plans p ON p.id = po.plan_id
         JOIN users u ON u.id = c.user_id LEFT JOIN facilities f ON f.id = c.facility_id
         WHERE p.insurer_id = ? AND (? = '' OR c.status = ?) ORDER BY c.fraud_score DESC, c.id DESC LIMIT 200`, req.user.org_id, status, status);
      audit.log(req, 'claims.list', { resource: 'claims', detail: { count: rows.length } });
    } else {
      rows = h.all(`SELECT c.*, f.name AS facility_name, p.name AS plan_name FROM claims c JOIN policies po ON po.id = c.policy_id
        JOIN insurance_plans p ON p.id = po.plan_id LEFT JOIN facilities f ON f.id = c.facility_id WHERE c.user_id = ? ORDER BY c.id DESC`, req.user.id);
    }
    res.json(rows.map(parseClaim));
  });

  function insurerClaim(req) {
    const c = h.get(`SELECT c.* FROM claims c JOIN policies po ON po.id = c.policy_id JOIN insurance_plans p ON p.id = po.plan_id
      WHERE c.id = ? AND p.insurer_id = ?`, req.params.id, req.user.org_id);
    if (!c) throw notFound('Claim not found');
    return c;
  }

  r.post('/claims/:id/decide', auth.requireRole('insurer'), (req, res) => {
    const b = validate(req.body, { decision: ['approve', 'reject'], approved_amount: 'number?', note: 'string?' });
    const c = insurerClaim(req);
    if (!['under_review', 'submitted'].includes(c.status)) throw bad(`Claim is already ${c.status}`);
    if (b.decision === 'reject' && !b.note) throw bad('Give the patient a reason for rejection');
    const amt = b.decision === 'approve' ? Math.min(b.approved_amount ?? c.amount, c.amount) : null;
    h.run(`UPDATE claims SET status = ?, approved_amount = ?, decided_by = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?`,
      b.decision === 'approve' ? 'approved' : 'rejected', amt, req.user.id, b.note ?? null, c.id);
    h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'claim', ?)`, c.user_id,
      b.decision === 'approve' ? `Claim #${c.id} approved for PKR ${amt.toLocaleString()}` : `Claim #${c.id} rejected: ${b.note}`);
    audit.log(req, `claim.${b.decision}`, { resource: 'claim', resourceId: c.id, patientId: c.user_id, detail: { amount: amt } });
    res.json(parseClaim(h.get('SELECT * FROM claims WHERE id = ?', c.id)));
  });

  r.post('/claims/:id/pay', auth.requireRole('insurer'), (req, res) => {
    const c = insurerClaim(req);
    if (!['approved', 'auto_approved'].includes(c.status)) throw bad('Only approved claims can be paid');
    h.run(`UPDATE claims SET status = 'paid' WHERE id = ?`, c.id);
    audit.log(req, 'claim.pay', { resource: 'claim', resourceId: c.id, patientId: c.user_id });
    res.json(parseClaim(h.get('SELECT * FROM claims WHERE id = ?', c.id)));
  });

  r.get('/analytics', auth.requireRole('insurer'), (req, res) => {
    const id = req.user.org_id;
    const by = h.all(`SELECT c.status, COUNT(*) AS n, SUM(c.amount) AS claimed, SUM(COALESCE(c.approved_amount,0)) AS approved
      FROM claims c JOIN policies po ON po.id = c.policy_id JOIN insurance_plans p ON p.id = po.plan_id WHERE p.insurer_id = ? GROUP BY c.status`, id);
    const premiums = h.get(`SELECT COALESCE(SUM(p.premium_monthly * 12),0) AS annual FROM policies po JOIN insurance_plans p ON p.id = po.plan_id
      WHERE p.insurer_id = ? AND po.status = 'active'`, id).annual;
    const paidOut = by.filter((x) => ['approved', 'auto_approved', 'paid'].includes(x.status)).reduce((s, x) => s + x.approved, 0);
    const flags = {};
    for (const c of h.all(`SELECT c.fraud_flags FROM claims c JOIN policies po ON po.id = c.policy_id JOIN insurance_plans p ON p.id = po.plan_id WHERE p.insurer_id = ?`, id)) {
      for (const f of JSON.parse(c.fraud_flags)) flags[f.code] = (flags[f.code] || 0) + 1;
    }
    const policies = h.get(`SELECT COUNT(*) AS n FROM policies po JOIN insurance_plans p ON p.id = po.plan_id WHERE p.insurer_id = ? AND po.status='active'`, id).n;
    // Speed: SECP pushes for fast pre-approvals, so the desk tracks how long manual decisions take.
    const speed = h.get(`SELECT AVG((julianday(c.decided_at) - julianday(c.created_at)) * 24 * 60) AS mins, COUNT(*) AS n FROM claims c
      JOIN policies po ON po.id = c.policy_id JOIN insurance_plans p ON p.id = po.plan_id
      WHERE p.insurer_id = ? AND c.decided_at IS NOT NULL AND c.status IN ('approved','rejected','paid')`, id);
    const total = by.reduce((s, x) => s + x.n, 0);
    const auto = by.filter((x) => x.status === 'auto_approved').reduce((s, x) => s + x.n, 0);
    res.json({ byStatus: by, activePolicies: policies, annualisedPremium: premiums, approvedOrPaid: paidOut,
      lossRatio: premiums ? +(paidOut / premiums).toFixed(2) : null, flagCounts: flags,
      avgDecisionMinutes: speed.n ? Math.round(speed.mins) : null, autoApprovedPct: total ? Math.round((auto / total) * 100) : null });
  });

  return r;
}
