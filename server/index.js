import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadKeys } from './lib/crypto.js';
import { seed, seedExtras } from './seed.js';
import { importHealthsites } from './import-healthsites.js';
import { scheduleRetention } from './lib/retention.js';
import { scheduleBackups } from './lib/backup.js';
import { loadVapid, scheduleDosePushes } from './lib/push.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PROD = process.env.NODE_ENV === 'production';
const dbFile = path.join(DATA, 'sehatyab.db');
const fresh = !fs.existsSync(dbFile);

process.on('unhandledRejection', (e) => console.error(`[${new Date().toISOString()}] unhandledRejection`, e));
process.on('uncaughtException', (e) => { console.error(`[${new Date().toISOString()}] uncaughtException`, e); process.exit(1); });

loadKeys(DATA);            // production: refuses to start without DATA_KEY / HMAC_KEY
loadVapid(DATA);           // Web Push keys (env or generated once)
const { app, ctx } = createApp({ dbFile });

// Demo data: always in development; in production only when explicitly asked (SEED_DEMO=1).
const demo = PROD ? process.env.SEED_DEMO === '1' : process.env.NO_SEED !== '1';
if (fresh && demo) { seed(ctx); console.log('Seeded demo data (see README for demo accounts).'); }
else if (demo) seedExtras(ctx.h);

// Real facilities from Healthsites.io / OpenStreetMap, if the dataset has been downloaded (see README).
const hs = path.join(DATA, 'healthsites', 'pakistan.geojson');
if (fs.existsSync(hs) && !ctx.h.get(`SELECT 1 FROM facilities WHERE source = 'osm' LIMIT 1`)) {
  const r = importHealthsites(ctx.db, JSON.parse(fs.readFileSync(hs, 'utf8')));
  console.log(`Imported ${r.added} real facilities from Healthsites.io (© OpenStreetMap contributors, ODbL).`);
}

scheduleRetention(ctx.h);
scheduleDosePushes(ctx.h);
if (process.env.BACKUPS !== 'off') scheduleBackups(ctx.db, process.env.BACKUP_DIR || path.join(DATA, 'backups'), { keep: Number(process.env.BACKUP_KEEP) || 14 });

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => console.log(`Sehatyab running on http://localhost:${port}${PROD ? ' (production)' : ''}`));
server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts

// Graceful shutdown: finish in-flight requests, then close the database cleanly (WAL checkpoint).
let closing = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    console.log(`${sig} received — shutting down`);
    server.close(() => { try { ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); ctx.db.close(); } catch { /* already closed */ } process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
