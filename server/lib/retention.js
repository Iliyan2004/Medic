// Data retention (docs/PRIVACY_SECURITY.md): keep personal data only as long as it is needed.
// Runs at boot and once a day. Each step is idempotent.
export const EMERGENCY_COARSEN_DAYS = 90;

export function runRetention(h, now = new Date()) {
  const cutoff = new Date(now.getTime() - EMERGENCY_COARSEN_DAYS * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  return h.tx(() => {
    // Emergencies: exact location → ~1 km (2 decimal places), drop phone, complaint text and tracking token.
    // Aggregate stats (response times, severity, hospital) stay for planning.
    const em = h.run(`UPDATE emergencies SET lat = ROUND(lat, 2), lng = ROUND(lng, 2), contact_phone = NULL, complaint = NULL,
        track_token_hash = NULL, coarsened_at = datetime('now')
      WHERE created_at < ? AND coarsened_at IS NULL AND status IN ('closed', 'cancelled', 'at_hospital')`, cutoff).changes;
    const sessions = h.run(`DELETE FROM sessions WHERE expires_at < datetime('now')`).changes;
    const shares = h.run(`DELETE FROM share_tokens WHERE expires_at < datetime('now', '-30 days')`).changes;
    return { emergencies_coarsened: Number(em), sessions_deleted: Number(sessions), share_codes_deleted: Number(shares) };
  });
}

export function scheduleRetention(h, log = console.log) {
  const run = () => { try { const r = runRetention(h); if (r.emergencies_coarsened) log(`[retention] ${JSON.stringify(r)}`); } catch (e) { log(`[retention] failed: ${e.message}`); } };
  run();
  setInterval(run, 86_400_000).unref();
}
