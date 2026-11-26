// Rule-based claim screening. Low-risk, small claims are auto-approved in seconds
// (SECP's healthcare report targets ~5-minute admission approvals); everything else
// goes to a human reviewer with the reasons attached. Inspired by PM-JAY's claim
// anomaly flags — rules are transparent so reviewers and patients can see why.

// Typical cost ceilings (PKR) by ICD-10 chapter/code used to spot inflated bills.
// Placeholder benchmarks — replace with real tariff data from insurer/TPA partners.
export const COST_BENCHMARKS = {
  A09: 25000,    // gastroenteritis
  A01: 60000,    // typhoid
  A90: 70000,    // dengue
  J18: 120000,   // pneumonia
  E11: 40000,    // type 2 diabetes management
  I10: 30000,    // hypertension
  I21: 600000,   // acute MI
  O80: 80000,    // normal delivery
  O82: 180000,   // caesarean delivery
  K35: 200000,   // appendicitis
  N18: 400000,   // chronic kidney disease
  S72: 350000,   // femur fracture
  DEFAULT: 150000,
};

export const AUTO_APPROVE_MAX_AMOUNT = 50000;
export const AUTO_APPROVE_MAX_SCORE = 20;

export function screenClaim({ claim, policy, plan, facility, history, usedThisYear }) {
  const flags = [];
  const add = (points, code, reason) => flags.push({ points, code, reason });

  const daysSinceStart = (Date.now() - new Date(policy.start_date).getTime()) / 86400000;
  if (plan.waiting_days && daysSinceStart < plan.waiting_days) {
    add(40, 'WAITING_PERIOD', `Policy is ${Math.floor(daysSinceStart)} days old; plan waiting period is ${plan.waiting_days} days`);
  } else if (daysSinceStart < 30) {
    add(10, 'NEW_POLICY', 'Claim within 30 days of policy start');
  }

  const remaining = plan.annual_limit - usedThisYear;
  if (claim.amount > remaining) add(35, 'OVER_LIMIT', `Amount exceeds remaining annual limit (PKR ${Math.max(0, remaining).toLocaleString()})`);

  const benchmark = COST_BENCHMARKS[claim.icd10?.slice(0, 3)] ?? COST_BENCHMARKS.DEFAULT;
  if (claim.amount > benchmark * 1.5) add(25, 'ABOVE_BENCHMARK', `Amount is ${(claim.amount / benchmark).toFixed(1)}× the typical cost for ${claim.icd10 || 'this diagnosis'}`);

  const dup = history.find((c) => c.icd10 && c.icd10 === claim.icd10 && c.facility_id === claim.facility_id &&
    (Date.now() - new Date(c.created_at + 'Z').getTime()) / 86400000 < 30);
  if (dup) add(30, 'DUPLICATE', `Same diagnosis at the same facility within 30 days (claim #${dup.id})`);

  const last90 = history.filter((c) => (Date.now() - new Date(c.created_at + 'Z').getTime()) / 86400000 < 90).length;
  if (last90 >= 3) add(15, 'HIGH_FREQUENCY', `${last90} claims in the last 90 days`);

  if (facility && !facility.verified) add(20, 'UNVERIFIED_FACILITY', 'Facility licence not verified on the platform');
  if (facility && ['preauth', 'reimbursement'].includes(claim.kind) && !facility.sehat_empanelled && plan.kind === 'inpatient') {
    add(5, 'NOT_PANEL', 'Facility is not on the cashless panel');
  }
  if (claim.kind === 'hospital_cash' && claim.nights > 14) add(15, 'LONG_STAY', `${claim.nights} nights claimed`);

  const score = Math.min(100, flags.reduce((s, f) => s + f.points, 0));
  const autoApprove = score <= AUTO_APPROVE_MAX_SCORE && claim.amount <= AUTO_APPROVE_MAX_AMOUNT && claim.amount <= remaining;
  return { score, flags, autoApprove, remaining };
}
