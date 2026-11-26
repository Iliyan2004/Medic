// Opt-in alerts: free health camps in the user's city (only once a camp is verified).
export function notifyCampAlerts(h, facility) {
  if (!facility || facility.type !== 'camp' || !facility.verified || !facility.city) return 0;
  const users = h.all(`SELECT id FROM users WHERE camp_alerts = 1 AND deleted_at IS NULL AND guardian_id IS NULL AND city = ?`, facility.city);
  const when = facility.starts_at ? new Date(facility.starts_at).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : 'soon';
  for (const u of users) {
    h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'camp', ?)`, u.id, `Free health camp in ${facility.city} on ${when}: ${facility.name}. See Map → Health camps.`);
  }
  return users.length;
}
