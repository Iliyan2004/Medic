# Sehatyab — project handoff for Claude Code

Paste or open this file in Claude Code (VS Code) and say: **"Read SEHATYAB_HANDOFF.md and set up and run the project."**

---

## 1. What we are building

**Sehatyab** is an all-in-one digital health platform for **Pakistan**. It has seven modules:

1. **Pharmacy** — buy and sell over-the-counter (OTC) and prescription medicines, following DRAP and provincial Drug Rules.
2. **Energy** — best energy use: clinic power and vaccine-fridge monitoring, a solar calculator, and an ultra-light app.
3. **Support / PPP** — public-private partnerships and subsidies (government, zakat, company CSR, donors) for low-income patients.
4. **Insurance** — a health insurance platform with takaful and conventional plans, a Sehat Card check, and claims.
5. **Map + community + ambulance** — a map of hospitals, clinics and health camps; a community page; ambulance dispatch and routes.
6. **Patient records** — digitised, encrypted records controlled by the patient.
7. **Privacy & security** — rules for patient data.

**Status:** a working prototype. All modules run end to end on fictional demo data. 20 API tests pass, and every screen has been checked in a browser for every role, in English and Urdu, on desktop and mobile.

---

## 2. Setup (Windows, VS Code)

Requires **Node.js 22.13 or newer** (`node -v`). Get it from nodejs.org if needed.

1. Extract `sehatyab.zip` into `Desktop\medic` so you have `Desktop\medic\sehatyab\`.
2. In VS Code, open the folder `Desktop\medic\sehatyab`.
3. In the terminal:

```bash
npm install
```

```bash
npm start
```

4. Open http://localhost:3000

The first start creates `data/sehatyab.db` with demo data and `data/dev-keys.json` (development encryption keys).

Other commands:

```bash
npm test
```

```bash
npm run seed
```

`npm run seed` wipes the database and reseeds it. Use a different port with `PORT=4000 npm start`. On Windows PowerShell that is `$env:PORT=4000; npm start`.

> If the zip is missing: the code was built in a cloud session. Section 9 lists every file so it can be rebuilt, but get the zip if at all possible.

### Demo accounts

| Role | Phone | Password |
|---|---|---|
| Patient, Karachi, low-income (has records, an e-prescription, a policy) | 03001234567 | Demo@12345 |
| Patient, Peshawar | 03111234567 | Demo@12345 |
| Patient, Lahore (no CNIC, Urdu) | 03211234567 | Demo@12345 |
| Doctor (verified) | 03009876543 | Demo@12345678 |
| Pharmacist | 03051112233 | Demo@12345678 |
| Insurer claims officer | 03061112233 | Demo@12345678 |
| Ambulance dispatcher | 03070000003 | Demo@12345678 |
| Hospital admin | 03070000004 | Demo@12345678 |
| Programme officer (subsidy/PPP) | 03070000002 | Demo@12345678 |
| Platform admin | 03070000001 | Demo@12345678 |

---

## 3. Research findings that shaped the design (Nov 2026)

A deep research report compared existing work in Pakistan and comparable countries.

**Main conclusion: no Pakistani player covers all seven modules.** The opportunity is in joining them up.

**Existing players**
- Sehat Kahani (female-doctor telemedicine, e-clinics, employer-funded — the strongest local model)
- oladoc, Marham, Healthwire (doctor booking)
- Dawaai, MedznMore, DVAGO (pharmacy)
- Daraz (licensed e-pharmacy since August 2026, OTC only, Getz Pharma partner)
- Jazz, which now owns the micro-insurance chain: the FikrFree marketplace and JazzSure (ex-TPL Insurance)

**Government**
- **Sehat Card** covers inpatient care only.
  - Khyber Pakhtunkhwa: arrears and treatment suspensions, plus a NAB probe into about Rs21bn (October 2026).
  - Punjab: dropped public-hospital cover from July 2025.
  - Islamabad, AJK and Gilgit-Baltistan: relaunched in January 2026.
- **"One Patient, One ID"** (the CNIC as a lifelong medical record number) is not live yet.
- Punjab PITB's hospital system (HMIS) is live in Lahore hospitals.
- DHIS2 is used for aggregate reporting.

**Pharmacy rules**
- There is no dedicated e-pharmacy rule.
- Punjab Drug Rules 2007:
  - Form 9 pharmacies need a pharmacist.
  - Form 10 medical stores cannot sell Schedule G drugs.
  - For Schedule B and D drugs the original prescription must be kept.
- DRAP made the GS1 2D DataMatrix barcode with a serial number mandatory from **9 October 2026** (SRO 963(I)/2026).
- Non-essential medicine prices were deregulated in February 2024; 460+ essential drugs are still price-controlled.
- Counterfeit estimates run from 40% to 50%.

**Insurance**
- Penetration is about 0.7% of GDP. Most cover is inpatient-only.
- SECP flags fraud, inflated bills and slow approvals, and targets 5-minute admission pre-approvals.
- First digital-only insurers: Digi Insurance (2025) and First Digital Takaful (2026).

**Ambulance**
- Rescue 1122 Punjab averages about 8 minutes (bikes about 5).
- Other services: Edhi 115, Chhipa 1020, SIEHS/Sindh 1122.
- No fleet pooling exists. About 4% of emergency-department patients arrive by ambulance. Private fares are unregulated.
- Model to copy: Kenya's **Flare**, which dispatches the fastest ambulance across all fleets.

**Facilities**
- There is no public geocoded national facility list.
- Health camps appear only in WHO/NDMA PDFs.
- The best open data is HDX Healthsites (OpenStreetMap).

**Privacy**
- The **PDP Bill is NOT enacted.** The draft treats health data as sensitive, requires 72-hour breach notice, and localises critical data.
- PECA 2016 and its 2025 amendments apply; so do PMDC confidentiality rules, the Sindh Telemedicine Act 2021, and the Cloud First Policy 2022.
- NADRA leaked 2.7M records (2019–23). Sehat Card data was stolen at PIMS (2023).

**Energy**
- Load-shedding runs 11–17 hours a day in parts of Sindh.
- NEPRA replaced net metering with **net billing** on 9 February 2026.
- Solarisation programmes (Khyber Pakhtunkhwa via the World Bank, Punjab via KfW, Gavi's 398 facilities) do not include monitoring.

**Lessons**
- Start from revenue with a margin: employer and insurer contracts, or pharmacy.
- Avoid discount-led cash burn (PharmEasy's valuation fell about 92%).
- Design for women: female doctors and privacy on shared phones.
- Support Urdu, voice and low data.

---

## 4. Tech stack and why

- **Node.js 22 + Express 5**, using **Node's built-in SQLite** (`node:sqlite`, WAL mode). No database server and no native build.
- **Front end:** plain ES modules with **no framework and no build step**, about 58 KB gzipped for the whole app. Screens load on demand. The service worker gives offline support. Leaflet maps load only on map screens. Low-data mode, dark mode, system fonts.
- **Security:**
  - Passwords hashed with scrypt.
  - Record contents encrypted with AES-256-GCM, bound to the patient ID.
  - CNIC stored only as an HMAC plus its last 4 digits.
  - Hash-chained audit log.
  - Strict CSP (no inline scripts; inline style attributes allowed), plus HSTS and nosniff.
  - Role-based access; staff queries scoped to their organisation; rate limiting.
- Dependencies are only `express`, `compression` and `leaflet`.

---

## 5. File map

```
package.json            scripts: start, seed, test
README.md               overview, demo tour, simulated-integration table
docs/ARCHITECTURE.md    structure, flows, scaling path
docs/PRIVACY_SECURITY.md  15-rule patient data rulebook
docs/screenshots/       5 screenshots
server/
  index.js              boot (keys, DB, seed on first run)
  app.js                Express app, security headers, routers, error handler
  db.js                 full SQLite schema + helpers (get/all/run/tx)
  seed.js               fictional demo data (facilities, energy telemetry, users, medicines, serials,
                        insurers/plans, programmes, PPP contracts, ambulances, posts, records)
  lib/crypto.js         scrypt, AES-GCM encrypt/decrypt, hmac, tokens, share codes, key loading
  lib/auth.js           sessions, requireAuth/requireRole, rate limiter, ROLES
  lib/consent.js        consent checks
  lib/audit.js          hash-chained audit log + verifyChain
  lib/validate.js       validate(), HttpError, Pakistani phone/CNIC/lat-lng checks
  lib/fraud.js          claim screening rules, ICD-10 cost benchmarks, auto-approve thresholds
  lib/energy.js         assess() power/cold-chain, sizeSolar() with net-billing assumptions
  lib/subsidy.js        quoteSubsidy / chargeSubsidy (ledger)
  lib/geo.js            haversine, ETA by vehicle type & PKT traffic period
  lib/adapters.js       SIMULATED: NSER, Sehat Card, payments, GS1 parse, SMS
  routes/auth.js        register/login/me/doctors
  routes/pharmacy.js    products, prescriptions, orders, pharmacist review/dispense, verify-pack
  routes/insurance.js   plans, sehat-check, enroll, policies, claims, insurer decide/pay/analytics
  routes/subsidy.js     programmes, eligibility, my support, donate, transparency, PPP KPIs (mounted at /api/support)
  routes/facilities.js  map list/filters/near, add facility or camp, beds
  routes/community.js   posts, replies, flags, moderation, blood donor matching
  routes/emergency.js   quote, request (no login), track, board, advance, simulate-tick
  routes/records.js     mine, doctor view, add, consents, break-glass, share codes, access log, FHIR export
  routes/energy.js      facility telemetry, readings, solar calculator, platform footprint
  routes/privacy.js     notice, data requests, breach register
  routes/admin.js       stats, verifications, staff, audit, data-request closing (anonymisation)
public/
  index.html, css/app.css, sw.js, manifest.webmanifest, icon.svg
  js/app.js             router, api(), html`` auto-escaping templates, actions(), poll(), chrome/nav
  js/i18n.js            English/Urdu strings (RTL)
  js/views/             home, auth, pharmacy, insurance, support, map, community, emergency,
                        records, energy, privacy, work (staff workspaces), _map.js, _shared.js
test/api.test.js        20 end-to-end tests on an in-memory DB
```

---

## 6. Key business rules (keep these when changing code)

**Pharmacy**
- OTC items: no prescription needed.
- Schedule G/B/D items need a prescription owned by the patient, and only Form 9 pharmacies may sell them.
- Controlled drugs are never sold online.
- One prescription can back only one live order.
- A pharmacist must approve prescription orders.
- Dispensing scans GS1 codes and marks each serial `dispensed`. The public pack checker reports genuine, already dispensed, recalled, unknown or expired.

**Claims**
- Rule score: waiting period 40, over limit 35, duplicate within 30 days 30, more than 1.5× the ICD-10 benchmark 25, unverified facility 20, frequency 15, and so on.
- **Auto-approve when the score is ≤20 AND the amount is ≤ Rs 50,000.** Everything else goes to review, with the reasons shown.
- Insurers see only claims on their own plans.

**Subsidy**
- One NSER check (PMT score; cut-off around 32) matches every programme.
- The programme pays at checkout (medicines, ambulance), with co-pay and an annual cap.
- Every movement goes into the `ledger`. The public transparency view shows no names.

**Ambulance**
- Works without login (returns a tracking token).
- Picks the fastest available vehicle across all providers; ALS for severity 1.
- Sends a bike first responder if it is at least 2 minutes faster.
- Destination: the nearest verified ER hospital with a free bed and non-critical power, which gets a pre-alert.
- Government services are free; private fares use base + per km.

**Records**
- Visible to the patient (self), to anyone with active scoped consent, or via break-glass: 24 hours, a reason of 20+ characters, the patient is notified, and it is logged.
- Share codes last 1–72 hours and exclude notes.
- FHIR R4 export.

**Community**
- Misinformation regexes hold posts for review; 3 flags hide a post.
- CNICs are scrubbed from posts, and phone numbers too except on blood requests.
- Blood requests notify compatible donors in the same city.

**Privacy**
- A delete request removes records and anonymises the user; claims and dispensing records are kept without identity.
- Breaches carry a 72-hour clock.

---

## 7. What is SIMULATED (needs real partnerships)

| Feature | Real integration |
|---|---|
| NSER poverty score, Sehat Card eligibility | NADRA/BISP + State Life / provincial health insurance programme data-sharing agreement |
| JazzCash, Easypaisa, Raast, card | merchant accounts / PSP |
| DRAP barcode registry | DRAP / GS1 Pakistan API |
| Ambulance GPS | fleet AVL feeds (Rescue 1122, Edhi, private) |
| Facility energy telemetry | IoT gateways or staff entry |
| SMS | PTA-registered SMS gateway |
| Bait-ul-Mal | partnership |

Map tiles (OpenStreetMap) and routing (public OSRM) are real but rate-limited. Self-host both for production.

---

## 8. Next steps / backlog

1. Full Urdu translation (most body text is still English); then Sindhi, Pashto, Punjabi.
2. Staff MFA; key rotation (ciphertext is versioned `v1.`).
3. Prescription photo upload with secure storage.
4. Move from SQLite to PostgreSQL with row-level security; Redis for sessions and rate limits (needed for multi-instance).
5. Coarsen emergency locations after 90 days (retention job).
6. WhatsApp/SMS/IVR channels for low-literacy and feature-phone users.
7. Telemedicine: partner rather than build.
8. Before a pilot: legal review (provincial Drug Rules, SECP distribution, telemedicine rules), penetration test, clinical safety review, accessibility testing with real users.
9. Pick a launch wedge (recommended: prescription pharmacy + employer health bundles in one city), then add support-programme linking, a top-up insurance partner outside the Jazz group, the verified map and community, then claims tools, PPP dashboards, ambulance aggregation and energy telemetry.

---

## 8b. Done in session 2 (26 Nov 2026)

- **UI:** new design system (depth, colour, 3D hero/tilt), "simple first, detail on tap" on every screen (`more()` / `peek()` helpers in `app.js`), GPU→RAM→CPU performance pass. 3D/animation off in low-data and reduced-motion modes.
- **Maps:** Mapbox tiles (theme-matched) + Mapbox Directions with traffic; token in `.env` (`MAPBOX_TOKEN`, public `pk.` only — enforced by test). Falls back to OSM/OSRM.
- **Real facilities:** 4,115 places imported from Healthsites.io/OpenStreetMap (HDX, ODbL, updated Sep 2026) → `source='osm'`, `verified=0`, never ambulance targets. `npm run import:healthsites`. Auto-imports on start if `data/healthsites/pakistan.geojson` exists.
- **Bug fixed:** ambulance routing now filters `verified = 1` in SQL.
- **GS1:** raw scanner strings (FNC1/GS), AIs 01/17/10/21 per DRAP guideline v2.2, check digit, printed-vs-registry batch/expiry mismatch. Seed now makes valid GTIN-14s (reseed needed for old DBs).
- **Staff two-step sign-in:** TOTP (RFC 6238), secret encrypted; Account → Two-step sign-in.
- **Prescription photos:** encrypted at rest, magic-byte checked, visible to patient / dispensing pharmacist only, every view audited; client downsizes to ~300 KB.
- **Retention job:** emergencies >90 days coarsened to ~1 km, phone/complaint removed (daily).
- **WhatsApp Cloud API adapter:** live when `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` set; needs an approved template `sehatyab_alert`.
- **Urdu:** `public/js/ur.js` translates all patient screens (loaded only in Urdu). Needs native-speaker review.
- Tests: 28 passing (`test/api.test.js`, `test/features.test.js`).

## 8c. Done in session 3 (26 Nov 2026) — patient & staff features

- **My care (`#/care`)**: today's doses (taken/skip), reminders from any prescription (dosage text → times), refill alerts + one-tap reorder, adherence %. Alerts fire while the app is open (true background push needs a push server — not built).
- **Family profiles**: dependants are user rows with `guardian_id` that cannot sign in; the client sends `X-Act-As`; the guardian is the audited actor. Never applied to `/auth/*`.
- **Emergency card (`#/card`)**: blood group, allergies, conditions, medicines, emergency contact; optional offline copy, reachable from the lock screen.
- **Lab tests** (catalogue, home collection, staff enter results → encrypted lab records) and **appointment call-backs** (facility / doctor queues).
- **Per-pharmacy prices** (`inventory.price`, capped at MRP) with comparison; orders use the chosen pharmacy's price.
- **Printable prescription + QR** (`#/rx/:id`) → public `#/rx-check/:token` (HMAC token, initials only).
- **Donor timer** (90/120 days; ineligible donors skipped in blood alerts), **camp alerts** (opt-in, city), **female-doctor preference** (map default, lists, appointments).
- **This phone** (`public/js/phone.js`): PIN lock (PBKDF2, 5 tries → sign-out), discreet mode, text size, high contrast, read-aloud, first-run walkthrough. `public/js/tools.js`: voice input (Web Speech) and camera DataMatrix scanning (BarcodeDetector).
- **Staff numbers**: pharmacist delivery time + low stock, insurer decision time + % instant, dispatch actual response time.
- Offline: all screen code cached by the service worker; last-seen places kept for offline map.
- Tests: 38 (`api`, `features`, `care`).

## 8d. Done in session 4 (26 Nov 2026) — ready to deploy

- **Web Push** (`server/lib/push.js`, VAPID with node:crypto). Pushes carry **no payload**, so nothing medical reaches Google/Apple/Mozilla; the service worker shows a generic or discreet alert. Allow-listed push hosts only (SSRF guard). Unsubscribed on sign-out. Guardians are notified for family members' doses.
- **Backups** (`server/lib/backup.js`, `npm run backup`): daily `VACUUM INTO` snapshots with rotation; keys deliberately not included.
- **Production**: `NODE_ENV=production` (keys required, no demo data unless `SEED_DEMO=1`), `FORCE_HTTPS`, `TRUST_PROXY`, graceful shutdown, crash logging, `Dockerfile`, `.env.example`, **DEPLOY.md**.
- **Erasure and export cover family members** (`anonymiseUser()` in admin.js also clears reminders, photos, push subscriptions, contacts).
- **Service worker is network-first** for app code, so updates never mix old and new files. Static code is served `no-cache` with an ETag.
- **Load test** (`npm run loadtest`): 543 req/s, 50 concurrent users, 0 errors, after adding indexes and a bounding-box prefilter for "near me".
- **Accessibility**: automated audit of 27 screens; 58 form fields linked to their labels.
- Tests: 43 (`api`, `features`, `care`, `ops`).

## 8e. Health map (`#/geo`) — session 5

- **Disease:** weekly facility case reports (`disease_reports`, IDSR/DHIS2-style aggregates) plus ICD-10-matched insurance claims, by city. Alert = ≥5 cases and > mean + 2 SD of the previous 4 weeks (SD floored at √mean); "watch" at +1 SD. Counts 1–4 shown as "<5"; no individual locations ever returned. Demo counts are `source='demo'` and labelled in the UI. Facility admins report from their workspace.
- **Access to care:** per city from all facilities (verified + OSM): hospitals within 10 km, nearest verified ER, lab, blood bank; 10 km coverage circles. Lab/blood-bank gaps only count where there are fewer than 3 hospitals nearby (hospitals usually have their own). "Possibly under-mapped" when fewer than 5 facilities are within 10 km.
- **Medicine supply:** essential-medicine availability by city from partner pharmacy stock; OTC-only (Form 10) cities explained rather than shown as shortages.
- Code: `server/lib/geo-health.js`, `server/lib/places.js`, `server/routes/geo.js`, `public/js/views/geo.js`. Tests: `test/geo.test.js` (48 total).

## 9. Instructions for Claude Code

- Run `npm install`, then `npm test` (expect 20 passing), then `npm start`.
- Keep the zero-build, no-framework front end. It is deliberate (energy and data cost).
- All HTML goes through the `html` tagged template in `public/js/app.js`, which auto-escapes. Never build HTML strings from user data without it. No inline `<script>` or `on*=` attributes (CSP).
- Every route validates input with `validate()` and logs patient-data access with `audit.log(...)`.
- Add a test in `test/api.test.js` for every new business rule.
- Demo data is fictional. Keep "(Demo)" in names. Don't present real organisations as partners.
