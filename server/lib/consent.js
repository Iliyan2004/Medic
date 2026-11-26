// Consent manager: a patient's data is visible only to the patient, or to someone holding an
// active, unrevoked, unexpired consent for that scope (ABDM/DEPA-style), or via logged break-glass.
export function makeConsent(h) {
  function activeConsent(patientId, granteeId, scope) {
    return h.get(
      `SELECT * FROM consents WHERE patient_id = ? AND grantee_id = ? AND scope = ?
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      patientId, granteeId, scope, new Date().toISOString(),
    );
  }

  /** Returns 'self' | 'consent' | null */
  function access(user, patientId, scope) {
    if (!user) return null;
    if (user.id === Number(patientId)) return 'self';
    if (activeConsent(Number(patientId), user.id, scope)) return 'consent';
    return null;
  }

  return { activeConsent, access };
}
