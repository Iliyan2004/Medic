# Deploying Sehatyab

For whoever puts Sehatyab on a real server for a pilot. One small server is enough for a one-city pilot: on a laptop, the app handled **~540 requests/second with 50 concurrent users and 0 errors** (`npm run loadtest`).

## 1. Where to host

- **In Pakistan.** The draft Personal Data Protection Bill asks for critical/sensitive data to stay in the country, and the Cloud First Policy 2022 points the same way. Use a Pakistani data centre or a provider region that keeps data in Pakistan.
- Minimum: 1–2 vCPU, 2 GB RAM, 20 GB disk, Ubuntu 22.04+ or any Docker host. Node.js 22.13+ if not using Docker.

## 2. Secrets — do this first

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # run twice: DATA_KEY, HMAC_KEY
```

- Put `DATA_KEY` and `HMAC_KEY` in the server's environment (copy `.env.example` to `.env`).
- **Store a second copy outside the server** (password manager or cloud secret store), accessible to two trusted people.
- **Losing the keys means losing every encrypted health record and CNIC lookup.** Backups do not contain the keys, on purpose.
- With `NODE_ENV=production` the server refuses to start without the keys, and it never loads demo data unless `SEED_DEMO=1`.
- Push keys: leave `VAPID_*` empty and they are generated into `data/vapid.json` on first start. Once users have subscribed, keep that file (or copy the values into env), or every phone has to re-allow alerts.

## 3. Run it

**Docker (recommended)**

```bash
docker build -t sehatyab .
docker run -d --name sehatyab --restart unless-stopped -p 127.0.0.1:3000:3000 \
  --env-file .env -v sehatyab-data:/data -v /var/backups/sehatyab:/backups -e BACKUP_DIR=/backups sehatyab
```

**Without Docker**

```bash
npm ci --omit=dev
NODE_ENV=production node --env-file=.env server/index.js     # run under systemd or pm2 so it restarts
```

Real facility data (optional): download `pakistan.geojson` from <https://data.humdata.org/dataset/pakistan-healthsites> into `<DATA_DIR>/healthsites/`. It is imported automatically on the next start. Keep the © OpenStreetMap attribution, which every map already shows.

## 4. HTTPS (required — health data never over plain HTTP)

Put a reverse proxy in front. Caddy gets certificates automatically:

```
# /etc/caddy/Caddyfile
app.your-domain.pk {
  reverse_proxy 127.0.0.1:3000
}
```

Then set `FORCE_HTTPS=1` and `TRUST_PROXY=loopback` (or your load balancer's IP range). HSTS and a strict Content Security Policy are already sent. Push notifications, camera scanning, voice input and the PIN lock all require HTTPS.

## 5. Backups and restore

- An automatic snapshot runs daily (first one an hour after start). The newest `BACKUP_KEEP` (default 14) are kept in `BACKUP_DIR`.
- Manual backup with an integrity check: `npm run backup`.
- **Copy `BACKUP_DIR` off the server every day** (another region or provider, still inside Pakistan). A backup on the same disk doesn't survive a disk failure.
- **Restore:**
  1. Stop the app.
  2. Copy the chosen `sehatyab-*.db` to `<DATA_DIR>/sehatyab.db`.
  3. Delete any `sehatyab.db-wal` and `sehatyab.db-shm` files.
  4. Start the app with the **same** `DATA_KEY` and `HMAC_KEY`.
- **Test a restore once a month** on a spare machine. An untested backup is not a backup.

## 6. Mapbox and WhatsApp

- Mapbox: in the Mapbox dashboard, go to Tokens and add a URL restriction for `https://app.your-domain.pk`. The app sends the origin as referrer so the restriction works.
- WhatsApp (optional): a Meta Business account, a verified number and an approved template named `sehatyab_alert` with one body variable. Then set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`.

## 7. Monitoring

- Health check: `GET /api/health` (Docker HEALTHCHECK already uses it). Point an uptime monitor at it.
- Logs go to stdout/stderr: server errors (never shown to users), `[backup]` and `[retention]` lines. Alert on `[backup] FAILED`.
- Audit log integrity: Admin → Audit log shows whether the hash chain is intact.

## 8. Updating

```bash
npm run backup            # always first
docker build -t sehatyab . && docker rm -f sehatyab && docker run ...   # same command as above
```

Database changes are applied automatically on start. They only add things, never drop anything. Phones pick up the new app code on their next load, because code is network-first.

## 9. Before real patients

This guide makes the software safe to run. It does not replace these:

- legal review (provincial Drug Rules, SECP, telemedicine law, ODbL)
- a penetration test
- a clinical safety review
- testing with real users
- signed partner agreements (pharmacy, labs, payments)

See SEHATYAB_HANDOFF.md §7–8.
