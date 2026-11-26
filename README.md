# Sehatyab — integrated digital health platform for Pakistan (prototype)

Medicines, health insurance, financial support (government, zakat, CSR, donors, PPP), a hospital/clinic/camp map,
a community, ambulance dispatch across every fleet, patient-controlled health records, and facility energy monitoring —
in one lightweight app, designed for Pakistan’s networks, phones, languages, and laws.

> **Status: working prototype.** Every module runs end to end on demo data. Integrations that Pakistani institutions
> do not yet open to third parties are **simulated adapters** (see “What is simulated”). All organisations, people,
> facilities and prices in the demo data are fictional.

## Free public demo (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

1. In [Render](https://render.com), choose **New → Blueprint**, pick this repository, then click **Apply**. `render.yaml` sets everything up, including generated encryption keys.
2. Optional: paste a public Mapbox `pk.` token into the `MAPBOX_TOKEN` environment variable. Without one, maps use OpenStreetMap.
3. Open `https://<your-service>.onrender.com` and sign in with a demo account (below).

The free tier sleeps after 15 minutes idle (about 50 s to wake) and recreates the fictional demo database on every restart. **Use it for demos only.** For real patients, follow [DEPLOY.md](DEPLOY.md).

## Run it

Requires Node.js 22.13 or newer. No database server, no build step.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000. The first start creates `data/sehatyab.db` and fills it with demo data. To reset it:

```bash
npm run seed
```

Run the tests (20 end-to-end API tests covering security, consent, pharmacy rules, claims, dispatch, privacy):

```bash
npm test
```

### Demo accounts

| Role | Phone | Password |
|---|---|---|
| Patient (Karachi, low-income — eligible for zakat/CSR support; has records, an e-prescription, an insurance policy) | 03001234567 | Demo@12345 |
| Patient (Peshawar) | 03111234567 | Demo@12345 |
| Patient (Lahore, no CNIC, Urdu) | 03211234567 | Demo@12345 |
| Doctor (verified) | 03009876543 | Demo@12345678 |
| Pharmacist | 03051112233 | Demo@12345678 |
| Insurer claims officer | 03061112233 | Demo@12345678 |
| Ambulance dispatcher | 03070000003 | Demo@12345678 |
| Hospital admin | 03070000004 | Demo@12345678 |
| Programme officer (subsidies / PPP) | 03070000002 | Demo@12345678 |
| Platform admin | 03070000001 | Demo@12345678 |

## A five-minute tour

1. **Patient** → Home shows Dr Fatima’s e-prescription → *Order it* → checkout (pharmacist check required for Rx).
2. **Support → Am I eligible?** → one NSER check matches every programme → back in the cart, pay with the Zakat fund.
3. **Pharmacist** → *Pharmacy desk* → view prescription → approve → scan & dispense (barcode serial marked used).
4. **Pharmacy → Is my medicine genuine?** → try the genuine / recalled / unknown demo codes.
5. **Insurance** → Sehat Card check → claim a small OPD bill (approved instantly) and a large one (goes to review with reasons).
6. **Insurer** → *Claims desk* → see risk flags → approve/reject → loss ratio.
7. **Emergency** (works signed out) → pick a city → see fastest ambulance across govt/NGO/private, fare, destination hospital → request → live tracking.
8. **Dispatcher** → tick *Auto-simulate movement* → watch the call progress; **Hospital admin** sees the pre-alert.
9. **Records** → share code, give/revoke consent to a doctor, *Who saw my data*, FHIR download.
10. **Doctor** → open a consented patient, add a note, write an e-Rx, try emergency (break-glass) access.
11. **Map** → filter Sehat-empanelled / female doctor / 24-7 ER / health camps; add a camp (shows unverified).
12. **Energy** → critical vaccine fridge alert, facility charts, solar calculator with net-billing payback, the app’s own footprint.
13. **Support → Where the money goes / Partnership clinics** → public ledger and PPP contract scorecards.
14. **Admin** → verification queue, moderation (misinformation held automatically), tamper-evident audit log, breach register with 72-hour clock.
15. Toggle **اردو** (Urdu, right-to-left) and **⚡ low-data mode** in the top bar.

## Modules and how they answer the research

| Module | What it does | Gap it closes (from the landscape research) |
|---|---|---|
| **Pharmacy** | OTC + prescription ordering; schedule rules (G only from Form-9 pharmacies; controlled drugs never online); e-Rx from verified doctors and paper-Rx entry; pharmacist review queue; DRAP 2D-barcode serial verification at dispense and for the public; cheaper same-generic suggestions; MRP caps; COD / JazzCash / Easypaisa / Raast | No e-pharmacy rulebook in Pakistan — the app enforces existing Drug Rules; counterfeit problem; Daraz is OTC-only |
| **Insurance** | Compare takaful vs conventional; plans designed as Sehat Card top-ups (OPD, medicines, hospital cash); enrolment; claims with transparent rule-based screening — small clean claims auto-approve in seconds; insurer review queue, loss ratio | Sehat Card is inpatient-only; SECP flags fraud, inflated bills and slow approvals |
| **Support / PPP** | One NSER-based eligibility check across every programme; subsidies paid directly at checkout (medicines, ambulance); zakat kept separate; donations; public ledger; PPP contract KPI scorecards submitted monthly by operators | Fragmented schemes, Sehat Card arrears/fraud probes, no PPP performance transparency |
| **Map** | Hospitals, clinics, BHUs/RHCs, labs, blood banks and time-bound camps; licence-verified badge; Sehat-empanelled, female-doctor, 24/7 ER filters; live bed counts and power status; community-submitted camps held as unverified | No public geocoded national facility list; camps only in PDFs |
| **Community** | Q&A with verified-doctor badges; blood requests that alert compatible nearby donors; anonymous questions; CNIC/phone scrubbing; misinformation patterns held for moderation; report button | Misinformation (2019 polio panic); blood donor matching on WhatsApp/Facebook |
| **Emergency** | No-login SOS; fastest suitable vehicle across govt/NGO/private (Flare model); motorbike first responder for critical calls; destination hospital with free bed and power; hospital pre-alert; upfront fare (govt free); fare subsidy; live tracking with road routes; dispatcher board | Many numbers and fleets, no pooling, ~4% of ED patients arrive by ambulance, unregulated private fares |
| **Records** | AES-256-GCM encrypted record; patient grants/revokes time-limited consent; logged break-glass; one-time share codes; full access log; FHIR R4 export; doctor clinical entries; self-reported entries flagged | No national EHR; “One Patient, One ID” not live; paper files |
| **Energy** | Facility telemetry (grid, solar, battery, load, vaccine fridge); alerts; outage-aware ambulance routing; solar + battery sizing with NEPRA net-billing payback; the app’s own compressed size and carbon estimate | Load-shedding, cold-chain losses, solarisation without monitoring |
| **Privacy** | Plain-language notice; rights (see, control, take, fix, delete); data requests; deletion anonymises; breach register with 72-hour clock | PDP Bill not enacted — platform adopts its draft standard now |

## What is simulated (and what a live version needs)

| Simulated | Real integration needed |
|---|---|
| NSER poverty score & Sehat Card eligibility | Data-sharing agreement with NADRA / BISP and State Life / provincial health insurance programmes |
| Payments (JazzCash, Easypaisa, Raast, cards) | Merchant accounts with each provider; SBP-compliant PSP |
| DRAP barcode registry | DRAP / GS1 Pakistan traceability API |
| Vehicle positions | GPS/AVL feeds from fleet operators (Rescue 1122, NGOs, private) |
| Facility energy telemetry | IoT gateways on inverters/batteries/fridges, or staff entry |
| SMS | An SMS gateway (PTA-registered sender ID) |
| Bait-ul-Mal | Pakistan Bait-ul-Mal partnership |

Map tiles (OpenStreetMap) and road routing (public OSRM demo server) are real but rate-limited — self-host both for production.

## Architecture in one paragraph

Node.js + Express 5, Node’s built-in SQLite (WAL), no front-end framework: plain ES modules loaded per screen,
a service worker for offline, about 60 KB compressed for the whole app shell. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and the privacy/security rulebook in [docs/PRIVACY_SECURITY.md](docs/PRIVACY_SECURITY.md).

## Known limitations / next steps

- Urdu covers navigation, emergency and key actions; most body text is still English. Sindhi, Pashto and Punjabi are not started.
- SQLite suits a pilot. Move to PostgreSQL (with row-level security) before multi-region scale.
- Rate limiting is in-memory (single instance). Use Redis behind a load balancer.
- Prescription images (photo upload) are not implemented — paper prescriptions are typed in and the original is collected on delivery.
- Telemedicine video consults are not built (deliberately: partner with an existing provider rather than compete).
- Needs a clinical safety review, penetration test, accessibility audit with real users, and legal review of
  provincial Drug Rules, SECP insurance distribution rules and telemedicine rules before any pilot.
