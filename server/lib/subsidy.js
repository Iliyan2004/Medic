// Shared subsidy engine: works out how much of a bill a programme (govt, zakat, CSR, donor, PPP)
// pays for an eligible patient, and writes a transparent ledger entry.
import { bad } from './validate.js';

export function quoteSubsidy(h, userId, programId, category, amount) {
  if (!programId) return { amount: 0 };
  const program = h.get('SELECT * FROM subsidy_programs WHERE id = ? AND active = 1', programId);
  if (!program) throw bad('Support programme not found');
  if (!JSON.parse(program.covers).includes(category)) throw bad(`${program.name} does not cover ${category}`);
  const ben = h.get(`SELECT * FROM beneficiaries WHERE user_id = ? AND program_id = ? AND status = 'eligible'`, userId, programId);
  if (!ben) throw bad(`You are not enrolled in ${program.name}. Check eligibility under Support first.`);
  const year = new Date().getFullYear().toString();
  const used = h.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE program_id = ? AND user_id = ? AND kind = 'debit' AND substr(ts,1,4) = ?`,
    programId, userId, year,
  ).s;
  const capLeft = program.per_person_annual_cap != null ? Math.max(0, program.per_person_annual_cap - used) : Infinity;
  const share = amount * (1 - (program.copay_pct || 0) / 100);
  const pay = Math.max(0, Math.min(share, capLeft, program.fund_balance));
  return { amount: Math.round(pay), program, capLeft: capLeft === Infinity ? null : capLeft, fundShort: share > program.fund_balance };
}

export function chargeSubsidy(h, { userId, program, amount, purpose, ref }) {
  if (!amount) return;
  h.run('UPDATE subsidy_programs SET fund_balance = fund_balance - ? WHERE id = ?', amount, program.id);
  h.run(`INSERT INTO ledger (program_id, user_id, amount, kind, purpose, ref) VALUES (?,?,?,?,?,?)`,
    program.id, userId, amount, 'debit', purpose, ref);
}
