# Patient data privacy & security rulebook

Pakistan has no enacted data protection law yet (the Personal Data Protection Bill is pending in Parliament as of
late 2026). Sehatyab adopts the draft bill’s standard now, plus PECA 2016, PMDC confidentiality duties, the Sindh
Telemedicine & Telehealth Act 2021, Cloud First Policy hosting rules, and GDPR/HIPAA-grade controls.
“Implemented” below means it exists in this codebase; “Operational” means it is a process the organisation must run.

| # | Rule | How | Status |
|---|---|---|---|
| 1 | **Classify data.** Health records, prescriptions, claims, CNIC and emergency location are *sensitive*. | Schema separates them; sensitive fields encrypted or hashed. | Implemented |
| 2 | **Host in Pakistan.** | Deploy in a Pakistani data centre / accredited cloud (Cloud First Policy; draft PDP localisation for critical data). | Operational |
| 3 | **Encrypt.** TLS everywhere (HSTS); AES-256-GCM for record contents, bound to the patient id; keys from a KMS (`DATA_KEY`, `HMAC_KEY`), never in code. | `lib/crypto.js`; production refuses to start without keys. | Implemented |
| 4 | **Never store the CNIC.** Keyed HMAC for lookup + last 4 digits for display. | `users.cnic_hash`, `cnic_last4`. | Implemented |
| 5 | **Least privilege.** Role-based access; staff scoped to their organisation; staff sessions 12h, patients 7 days; scrypt password hashing; login rate limits; staff passwords ≥12 chars. | `lib/auth.js`, route guards. | Implemented (add MFA for staff before pilot) |
| 6 | **Consent first.** Clinicians, pharmacists and insurers see a patient’s data only with time-limited, purpose-stated, revocable consent. | `consents` table, `lib/consent.js`. | Implemented |
| 7 | **Break-glass.** Verified doctors may open a record for 24h in an emergency, giving a written reason; patient notified instantly; every use reviewed monthly. | `/records/break-glass`; admin stat “break-glass uses”. | Implemented (review = operational) |
| 8 | **Log every access, tamper-evidently.** Patients can see who viewed or changed their data. | Hash-chained `audit_log`; `/records/access-log`; admin chain check. | Implemented |
| 9 | **Minimise.** Share codes exclude private notes; community posts auto-strip CNICs/phone numbers; public ledger has no names; analytics aggregated. | Records share view, community scrubber, transparency API. | Implemented |
| 10 | **Patient rights.** See, export (FHIR R4), correct, delete. Deletion removes records and anonymises the account; legally required registers (dispensing, claims) keep the transaction without identity. Respond within 30 days. | `/records/export`, `/privacy/requests`, admin close. | Implemented |
| 11 | **Retention.** Account data while open; emergency locations coarsened after 90 days; pharmacy registers and claims per Drug Rules / SECP. | Policy in notice; coarsening job. | Partly (coarsening job to add) |
| 12 | **Breach response.** Register incidents; notify regulator and affected people within 72 hours; post-incident review. | `/privacy/breaches` with countdown. | Implemented (process operational) |
| 13 | **Secure by default in the app.** Strict CSP (no inline scripts), no-referrer, nosniff, frame-ancestors none; auto-escaping templates; validated input; no stack traces to clients; API responses `no-store`; service worker never caches health data. | `app.js`, `public/js/app.js`, `sw.js`. | Implemented |
| 14 | **Vendors & payments.** Data-processing agreements with every processor; card data never touches our servers (PSP-hosted); insurers receive claim data only for their own policies. | Org-scoped queries. | Partly (contracts operational) |
| 15 | **Governance.** Named privacy officer; ISO 27001 roadmap; annual penetration test; staff training; minors’ records accessed via guardian account. | — | Operational |

## Known gaps before a real pilot

- Staff MFA (TOTP/SMS) and device binding.
- Key rotation (ciphertext is versioned `v1.` to allow it).
- Prescription image storage with malware scanning.
- Independent penetration test and clinical safety case.
- Legal review once the PDP Act passes (re-check localisation and consent wording).
