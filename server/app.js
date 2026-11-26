// Express application factory (used by server/index.js and the tests).
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, helpers } from './db.js';
import { makeAudit } from './lib/audit.js';
import { makeAuth } from './lib/auth.js';
import { makeConsent } from './lib/consent.js';
import { HttpError } from './lib/validate.js';

import authRoutes from './routes/auth.js';
import pharmacyRoutes from './routes/pharmacy.js';
import insuranceRoutes from './routes/insurance.js';
import subsidyRoutes from './routes/subsidy.js';
import facilityRoutes from './routes/facilities.js';
import communityRoutes from './routes/community.js';
import emergencyRoutes from './routes/emergency.js';
import recordsRoutes from './routes/records.js';
import energyRoutes from './routes/energy.js';
import privacyRoutes from './routes/privacy.js';
import adminRoutes from './routes/admin.js';
import careRoutes from './routes/care.js';
import { vapidPublicKey } from './lib/push.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp({ dbFile = path.join(ROOT, 'data', 'sehatyab.db'), db } = {}) {
  db = db || openDb(dbFile);
  const h = helpers(db);
  const ctx = { db, h, audit: makeAudit(h), auth: makeAuth(h), consent: makeConsent(h) };

  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy (Caddy/nginx/load balancer) set TRUST_PROXY, e.g. "loopback" or "10.0.0.0/8",
  // so rate limits see real client IPs. FORCE_HTTPS=1 redirects plain-HTTP requests (health data never over HTTP).
  const tp = process.env.TRUST_PROXY || 'loopback';
  app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp); // a number = how many proxy hops to trust (Render, Heroku: 1)
  if (process.env.FORCE_HTTPS === '1') {
    app.use((req, res, next) => (req.secure || req.path === '/api/health' ? next() : res.redirect(308, `https://${req.hostname}${req.originalUrl}`)));
  }
  app.use(compression()); // gzip: fewer bytes over expensive mobile data

  // Security headers. Strict CSP: no inline scripts; only OSM tiles + OSRM routing allowed externally.
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'", // inline style attrs for bars/widths; scripts stay strict
        "img-src 'self' data: blob: https://api.mapbox.com https://*.tile.openstreetmap.org", // blob: = decrypted Rx photos shown in-page
        "connect-src 'self' https://api.mapbox.com https://router.project-osrm.org",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self)', // mic: speak-instead-of-type
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
    next();
  });

  // Larger body only for prescription photo uploads (client downsizes first; server re-checks 2.5 MB decoded).
  app.use(/^\/api\/pharmacy\/prescriptions\/\d+\/images$/, express.json({ limit: '3.6mb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(ctx.auth.attachUser);

  const api = express.Router();
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
  // Public client config. Only public (pk.*) tokens may ever be exposed here.
  const mapboxToken = /^pk\./.test(process.env.MAPBOX_TOKEN || '') ? process.env.MAPBOX_TOKEN : null;
  api.get('/config', (_req, res) => res.json({ mapboxToken, vapidPublicKey: vapidPublicKey() }));
  api.use('/auth', authRoutes(ctx));
  api.use('/pharmacy', pharmacyRoutes(ctx));
  api.use('/insurance', insuranceRoutes(ctx));
  api.use('/support', subsidyRoutes(ctx));
  api.use('/facilities', facilityRoutes(ctx));
  api.use('/community', communityRoutes(ctx));
  api.use('/emergency', emergencyRoutes(ctx));
  api.use('/records', recordsRoutes(ctx));
  api.use('/energy', energyRoutes(ctx));
  api.use('/privacy', privacyRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use('/care', careRoutes(ctx));
  api.get('/notifications', ctx.auth.requireAuth, (req, res) => {
    res.json(h.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id));
  });
  api.post('/notifications/read', ctx.auth.requireAuth, (req, res) => {
    h.run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`, req.user.id);
    res.json({ ok: true });
  });
  api.use((_req, _res, next) => next(new HttpError(404, 'Unknown API route')));
  app.use('/api', api);

  // Static PWA. Long cache for vendor assets; the service worker handles offline.
  app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules', 'leaflet', 'dist'), { maxAge: '30d' }));
  app.get('/vendor/qrcode.js', (_req, res) => res.set('Cache-Control', 'public, max-age=2592000').sendFile(path.join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js')));
  // App code always revalidates (ETag → cheap 304 when unchanged), so an update never mixes old and new files.
  app.use(express.static(path.join(ROOT, 'public'), { etag: true, setHeaders: (res, p) => {
    res.set('Cache-Control', /\.(svg|webmanifest|png)$/.test(p) ? 'public, max-age=86400' : 'no-cache');
  } }));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  // Errors: never leak stack traces or internals to clients.
  app.use((err, req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
    const message = status >= 500 ? 'Something went wrong' : err.type === 'entity.parse.failed' ? 'Malformed JSON body' : err.type ? 'Bad request' : err.message;
    res.status(status).json({ error: message, details: err.details, ...(status < 500 && err.extra ? err.extra : {}) });
  });

  return { app, ctx };
}
