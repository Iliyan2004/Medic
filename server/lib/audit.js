// Append-only, hash-chained audit log. Every access to patient data is written here
// and patients can see who touched their data.
import { sha256 } from './crypto.js';

export function makeAudit(h) {
  function log(req, action, { resource, resourceId, patientId, detail } = {}) {
    const prev = h.get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prevHash = prev?.hash || 'genesis';
    const ts = new Date().toISOString();
    // When a guardian acts for a family member, the guardian is the actor; the member is recorded in detail.
    const actor = req?.guardian?.id ?? req?.user?.id ?? null;
    const ip = req?.ip ?? null;
    if (req?.guardian) detail = { ...(detail || {}), for_family_member: req.user.id };
    const det = detail ? JSON.stringify(detail) : null;
    const hash = sha256([prevHash, ts, actor, action, resource, resourceId, patientId, det].join('|'));
    h.run(
      `INSERT INTO audit_log (ts, actor_id, action, resource, resource_id, patient_id, ip, detail, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ts, actor, action, resource ?? null, resourceId != null ? String(resourceId) : null,
      patientId ?? null, ip, det, prevHash, hash,
    );
  }

  // Recompute the chain; returns the first broken row id or null if intact.
  function verifyChain() {
    let prevHash = 'genesis';
    for (const r of h.all('SELECT * FROM audit_log ORDER BY id')) {
      const expected = sha256([prevHash, r.ts, r.actor_id, r.action, r.resource, r.resource_id, r.patient_id, r.detail].join('|'));
      if (r.prev_hash !== prevHash || r.hash !== expected) return r.id;
      prevHash = r.hash;
    }
    return null;
  }

  return { log, verifyChain };
}
