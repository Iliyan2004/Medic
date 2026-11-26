// Database backups: a consistent snapshot with SQLite's VACUUM INTO (safe while the app runs, WAL included).
// Health record contents inside the snapshot stay AES-256-GCM encrypted. The ENCRYPTION KEYS ARE NOT in the
// backup on purpose — store DATA_KEY / HMAC_KEY separately (password manager / secret store). Without the
// keys a backup's records cannot be read; with backup + keys together, everything can. See DEPLOY.md.
import fs from 'node:fs';
import path from 'node:path';

export function backupNow(db, dir, keep = 14) {
  fs.mkdirSync(dir, { recursive: true });
  // Sortable timestamp to the millisecond + short random suffix: two backups in the same second never collide.
  const stamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23);
  const file = path.join(dir, `sehatyab-${stamp}-${Math.random().toString(36).slice(2, 6)}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  // Rotate: keep the newest `keep` snapshots.
  const all = fs.readdirSync(dir).filter((f) => /^sehatyab-.*\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(dir, old));
  return { file, bytes: fs.statSync(file).size, kept: Math.min(all.length, keep) };
}

/** Daily snapshot (first one an hour after start, so restarts don't pile up backups). */
export function scheduleBackups(db, dir, { keep = 14, log = console.log } = {}) {
  const run = () => { try { const r = backupNow(db, dir, keep); log(`[backup] ${path.basename(r.file)} (${Math.round(r.bytes / 1024)} KB)`); } catch (e) { log(`[backup] FAILED: ${e.message}`); } };
  setTimeout(() => { run(); setInterval(run, 86_400_000).unref(); }, 3600_000).unref();
}
