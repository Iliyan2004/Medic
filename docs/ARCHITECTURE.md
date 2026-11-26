# Architecture

## Shape

```
public/            Front end (no build step)
  index.html       App shell
  css/app.css      One stylesheet, system fonts, dark mode via prefers-color-scheme
  js/app.js        Router, API client, templating (auto-escaping), state, polling
  js/i18n.js       English / Urdu strings, RTL
  js/views/*.js    One module per area, loaded on demand (dynamic import)
  sw.js            Service worker: caches app shell; never caches /api
server/
  index.js         Boot: keys, DB, seed on first run, listen
  app.js           Express app: security headers, gzip, JSON limits, routers, error handler
  db.js            SQLite schema (node:sqlite), query helpers, transactions
  seed.js          Fictional demo data
  lib/
    crypto.js      scrypt passwords, AES-256-GCM field encryption, HMAC (CNIC), tokens
    auth.js        Sessions, role checks, rate limiting
    consent.js     Consent manager
    audit.js       Hash-chained audit log
    validate.js    Input validation, Pakistani phone/CNIC/coordinate checks
    fraud.js       Claim screening rules
    energy.js      Power/cold-chain assessment, solar sizing
    subsidy.js     Subsidy quote + ledger
    geo.js         Distance, ETA by vehicle type and Pakistan traffic period
    adapters.js    Simulated external systems (NSER, Sehat Card, payments, DRAP, SMS)
  routes/          auth, pharmacy, insurance, subsidy (support+PPP), facilities, community,
                   emergency, records, energy, privacy, admin
test/api.test.js   End-to-end API tests on an in-memory DB
```

## Roles

`patient`, `doctor`, `pharmacist`, `insurer`, `dispatcher`, `facility_admin`, `program_admin`, `admin`.
Staff accounts are created by an admin and tied to an organisation (`org_id`: pharmacy, insurer or facility).
Every staff query is scoped to that organisation (e.g. an insurer only sees claims on its own plans).

## Key flows

**Prescription order.** Patient cart → server validates each item’s schedule against the pharmacy’s licence type →
Rx items must appear on a valid prescription owned by the patient → stock reserved in a transaction → subsidy charged
to the programme ledger → status `awaiting_rx` → pharmacist reviews (sees the prescription; access logged) → dispense
requires scanning pack codes, each serial marked `dispensed` → delivered.

**Claim.** Patient files → `screenClaim` scores rules (waiting period, over-limit, cost benchmark by ICD-10, duplicate,
frequency, unverified facility) → ≤20 points and ≤ Rs 50,000 auto-approves, else review with reasons visible to both sides.

**Emergency.** Quote/request → all *available* vehicles from every provider ranked by ETA (haversine × 1.35 road
factor ÷ speed by vehicle type and traffic period) → ALS required for critical → bike first responder if ≥2 min faster →
destination = nearest verified ER hospital with a free bed and non-critical power → pre-alert notification → tracking
token for anonymous requesters → simulator (or GPS feed) moves vehicles; statuses advance.

**Records access.** `self` or active consent for scope `records`; doctors can break-glass for 24h (logged, patient notified).
Data is encrypted per record with the patient id as associated data, so ciphertext can’t be moved between patients.

## Energy-conscious engineering

- No framework, no build: the whole app shell is roughly 60 KB gzipped; screens download only their own module.
- Leaflet and tiles load only on map screens and never in low-data mode.
- Service worker: repeat visits load from cache and work offline (emergency call buttons are plain `tel:` links).
- gzip on everything; static assets cached; polling slows down 4× when the tab is hidden.
- Dark theme follows the OS (OLED battery). System fonts only (no web-font downloads).
- Canvas rendering for map markers (`preferCanvas`), circle markers instead of image icons.

## Scaling path

1. Pilot (one city): current stack on a single VM in a Pakistan data centre, nightly encrypted backups.
2. Province: PostgreSQL with row-level security, Redis for sessions/rate limits, object storage for prescription images,
   a KMS for keys, managed OSRM + tile server, message queue for notifications/SMS.
3. National: split dispatch into its own service (WebSockets, GPS ingestion), HL7 FHIR server for record exchange with
   PITB HMIS / “One Patient, One ID”, claims exchange API for insurers/TPAs.
