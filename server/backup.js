// CLI: npm run backup            → snapshot now into BACKUP_DIR (default data/backups)
//      npm run backup -- --verify → also open the newest snapshot and check it is readable
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from './db.js';
import { backupNow } from './lib/backup.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const DIR = process.env.BACKUP_DIR || path.join(DATA, 'backups');
const src = path.join(DATA, 'sehatyab.db');
if (!fs.existsSync(src)) { console.error(`No database at ${src}`); process.exit(1); }

const r = backupNow(openDb(src), DIR, Number(process.env.BACKUP_KEEP) || 14);
console.log(`Backup written: ${r.file} (${Math.round(r.bytes / 1024)} KB). Keeping ${r.kept} snapshots in ${DIR}.`);
if (process.argv.includes('--verify')) {
  const check = new DatabaseSync(r.file, { readOnly: true });
  const ok = check.prepare('PRAGMA integrity_check').get();
  const users = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  console.log(`Verify: integrity=${Object.values(ok)[0]}, users=${users}`);
  check.close();
}
console.log('Reminder: encryption keys are NOT in the backup. Keep DATA_KEY / HMAC_KEY in a separate safe place (see DEPLOY.md).');
