// Database layer: Node's built-in SQLite (no native build step, tiny footprint).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

-- ───────────── Identity, access, privacy ─────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  cnic_hash TEXT UNIQUE,            -- keyed HMAC, never the raw CNIC
  cnic_last4 TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'patient',
  gender TEXT,
  birth_year INTEGER,
  province TEXT,
  city TEXT,
  lang TEXT DEFAULT 'en',
  pmdc_no TEXT,                     -- doctors
  license_no TEXT,                  -- pharmacists
  verified INTEGER DEFAULT 0,
  org_id INTEGER,                   -- pharmacy / facility / insurer / provider the staff belongs to
  blood_group TEXT,
  blood_donor INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT DEFAULT (datetime('now')),
  actor_id INTEGER,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  patient_id INTEGER,
  ip TEXT,
  detail TEXT,
  prev_hash TEXT,
  hash TEXT                          -- hash chain: tampering breaks the chain
);
CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_log(patient_id);

CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  grantee_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,               -- records | insurance | pharmacy
  purpose TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token_hash TEXT PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,                -- export | delete | correct
  detail TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS breaches (
  id INTEGER PRIMARY KEY,
  detected_at TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_count INTEGER DEFAULT 0,
  severity TEXT DEFAULT 'medium',
  notified_regulator_at TEXT,
  notified_subjects_at TEXT,
  status TEXT DEFAULT 'open',
  created_by INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  facility_id INTEGER,
  kind TEXT,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ───────────── Facilities, map, energy ─────────────
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                -- hospital | clinic | bhu | rhc | lab | pharmacy | blood_bank | camp
  sector TEXT DEFAULT 'private',     -- public | private | ngo | ppp
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  city TEXT, province TEXT, address TEXT, phone TEXT,
  services TEXT DEFAULT '[]',        -- JSON array
  emergency INTEGER DEFAULT 0,
  beds_total INTEGER DEFAULT 0,
  beds_free INTEGER DEFAULT 0,
  sehat_empanelled INTEGER DEFAULT 0,
  female_doctor INTEGER DEFAULT 0,
  license_no TEXT,
  verified INTEGER DEFAULT 0,
  starts_at TEXT, ends_at TEXT,      -- temporary camps
  organizer TEXT,
  power_source TEXT DEFAULT 'grid',  -- grid | solar | hybrid | generator
  solar_kw REAL DEFAULT 0,
  battery_kwh REAL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS energy_readings (
  id INTEGER PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  ts TEXT DEFAULT (datetime('now')),
  grid_on INTEGER, solar_kw REAL, battery_pct REAL, load_kw REAL,
  fridge_temp_c REAL, generator_on INTEGER
);
CREATE INDEX IF NOT EXISTS idx_energy_fac ON energy_readings(facility_id, ts);

-- ───────────── Pharmacy ─────────────
CREATE TABLE IF NOT EXISTS pharmacies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  license_no TEXT NOT NULL,
  license_type TEXT NOT NULL,        -- pharmacy (Form 9, pharmacist supervised) | medical_store (Form 10)
  pharmacist_name TEXT,
  facility_id INTEGER REFERENCES facilities(id),
  city TEXT,
  verified INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  generic TEXT NOT NULL,
  manufacturer TEXT,
  form TEXT, strength TEXT,
  schedule TEXT NOT NULL DEFAULT 'OTC', -- OTC | G | B | D | controlled
  drap_reg_no TEXT,
  gtin TEXT,
  price REAL NOT NULL,
  mrp REAL NOT NULL,
  price_controlled INTEGER DEFAULT 0,
  essential INTEGER DEFAULT 0,
  cold_chain INTEGER DEFAULT 0,
  category TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  stock INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pharmacy_id, product_id)
);

CREATE TABLE IF NOT EXISTS serials (
  gtin TEXT NOT NULL,
  serial TEXT NOT NULL,
  batch TEXT, expiry TEXT,
  status TEXT DEFAULT 'valid',       -- valid | dispensed | recalled
  pharmacy_id INTEGER,
  dispensed_order_id INTEGER,
  PRIMARY KEY (gtin, serial)
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  doctor_id INTEGER REFERENCES users(id),
  source TEXT NOT NULL,              -- e-rx | upload
  items TEXT NOT NULL,               -- JSON [{product_id, qty, dosage}]
  notes TEXT,
  status TEXT DEFAULT 'pending',     -- pending | verified | rejected | dispensed
  verified_by INTEGER,
  verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  items TEXT NOT NULL,               -- JSON [{product_id, name, qty, price, schedule}]
  subtotal REAL NOT NULL,
  subsidy_amount REAL DEFAULT 0,
  subsidy_program_id INTEGER,
  insurance_amount REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT DEFAULT 'placed',      -- placed | awaiting_rx | verified | packed | dispatched | delivered | cancelled
  prescription_id INTEGER REFERENCES prescriptions(id),
  payment_method TEXT,               -- cod | jazzcash | easypaisa | raast | card
  payment_status TEXT DEFAULT 'pending',
  address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ───────────── Insurance ─────────────
CREATE TABLE IF NOT EXISTS insurers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  secp_license TEXT,
  takaful INTEGER DEFAULT 0,
  digital_only INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS insurance_plans (
  id INTEGER PRIMARY KEY,
  insurer_id INTEGER NOT NULL REFERENCES insurers(id),
  name TEXT NOT NULL,
  model TEXT NOT NULL,               -- conventional | takaful
  kind TEXT NOT NULL,                -- inpatient | opd | hospital_cash | topup | family
  premium_monthly REAL NOT NULL,
  annual_limit REAL NOT NULL,
  opd_limit REAL DEFAULT 0,
  daily_cash REAL DEFAULT 0,
  waiting_days INTEGER DEFAULT 0,
  sehat_topup INTEGER DEFAULT 0,     -- designed to sit on top of Sehat Card inpatient cover
  description TEXT
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  policy_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES insurance_plans(id),
  status TEXT DEFAULT 'active',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  members TEXT DEFAULT '[]',
  employer TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES policies(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  facility_id INTEGER REFERENCES facilities(id),
  kind TEXT NOT NULL,                -- preauth | reimbursement | hospital_cash | pharmacy | opd
  icd10 TEXT,
  diagnosis TEXT,
  amount REAL NOT NULL,
  approved_amount REAL,
  nights INTEGER DEFAULT 0,
  status TEXT DEFAULT 'submitted',   -- submitted | auto_approved | under_review | approved | rejected | paid
  fraud_score INTEGER DEFAULT 0,
  fraud_flags TEXT DEFAULT '[]',
  decided_by INTEGER,
  decision_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT
);

-- ───────────── Subsidies & public-private partnerships ─────────────
CREATE TABLE IF NOT EXISTS subsidy_programs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sponsor TEXT NOT NULL,
  type TEXT NOT NULL,                -- govt | zakat | csr | donor | ppp
  description TEXT,
  max_pmt_score REAL,                -- NSER proxy-means-test threshold (null = universal)
  provinces TEXT DEFAULT '[]',       -- empty = nationwide
  covers TEXT DEFAULT '[]',          -- medicines | opd | inpatient | ambulance | diagnostics
  per_person_annual_cap REAL,
  copay_pct REAL DEFAULT 0,
  fund_balance REAL DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  program_id INTEGER NOT NULL REFERENCES subsidy_programs(id),
  pmt_score REAL,
  status TEXT DEFAULT 'eligible',
  verified_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, program_id)
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES subsidy_programs(id),
  user_id INTEGER,
  amount REAL NOT NULL,
  kind TEXT NOT NULL,                -- credit (donation / budget) | debit (care paid)
  purpose TEXT,
  ref TEXT,
  ts TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ppp_contracts (
  id INTEGER PRIMARY KEY,
  facility_id INTEGER REFERENCES facilities(id),
  operator TEXT NOT NULL,
  govt_partner TEXT NOT NULL,
  model TEXT,                        -- outsourced BHU | hospital management | e-clinic | voucher
  start_date TEXT, end_date TEXT,
  monthly_fee REAL,
  kpi_targets TEXT NOT NULL          -- JSON {metric: target}
);

CREATE TABLE IF NOT EXISTS ppp_reports (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES ppp_contracts(id),
  period TEXT NOT NULL,
  metrics TEXT NOT NULL,             -- JSON {metric: actual}
  score REAL,
  submitted_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ───────────── Community ─────────────
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,            -- question | announcement | blood_request | camp | awareness | story
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  city TEXT,
  blood_group TEXT,
  anonymous INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',   -- published | flagged | removed
  flags INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  verified_doctor INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_flags (
  post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, reason TEXT,
  PRIMARY KEY (post_id, user_id)
);

-- ───────────── Ambulance ─────────────
CREATE TABLE IF NOT EXISTS ambulance_providers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                -- govt | ngo | private
  hotline TEXT,
  fare_base REAL DEFAULT 0,
  fare_per_km REAL DEFAULT 0,
  city TEXT
);

CREATE TABLE IF NOT EXISTS ambulances (
  id INTEGER PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES ambulance_providers(id),
  call_sign TEXT NOT NULL,
  type TEXT NOT NULL,                -- BLS | ALS | bike
  lat REAL NOT NULL, lng REAL NOT NULL,
  status TEXT DEFAULT 'available',   -- available | dispatched | busy | offline
  driver_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emergencies (
  id INTEGER PRIMARY KEY,
  requester_id INTEGER REFERENCES users(id),
  contact_phone TEXT,
  lat REAL NOT NULL, lng REAL NOT NULL,
  severity INTEGER NOT NULL,         -- 1 critical … 4 minor
  complaint TEXT,
  status TEXT DEFAULT 'requested',   -- requested | dispatched | on_scene | transporting | at_hospital | closed | cancelled
  ambulance_id INTEGER REFERENCES ambulances(id),
  facility_id INTEGER REFERENCES facilities(id),
  eta_min REAL,
  distance_km REAL,
  fare_estimate REAL,
  fare_payer TEXT,
  timeline TEXT DEFAULT '[]',
  track_token_hash TEXT,
  subsidy_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ───────────── Patient records ─────────────
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  author_id INTEGER REFERENCES users(id),
  facility_id INTEGER REFERENCES facilities(id),
  type TEXT NOT NULL,                -- visit | lab | prescription | allergy | immunization | vitals | condition | note
  title TEXT NOT NULL,
  data_enc TEXT NOT NULL,            -- AES-256-GCM encrypted JSON
  self_reported INTEGER DEFAULT 0,
  recorded_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON records(patient_id);

-- Prescription photos: encrypted at rest (AES-256-GCM, bound to the patient), never served from disk.
CREATE TABLE IF NOT EXISTS rx_images (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id),
  patient_id INTEGER NOT NULL REFERENCES users(id),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data_enc TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rx_images_rx ON rx_images(prescription_id);

-- ───────────── Care: medicine reminders, lab tests, appointments ─────────────
CREATE TABLE IF NOT EXISTS med_schedules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER REFERENCES products(id),
  prescription_id INTEGER REFERENCES prescriptions(id),
  name TEXT NOT NULL,
  dose TEXT,                          -- "1 tablet"
  times TEXT NOT NULL DEFAULT '[]',   -- JSON ["08:00","20:00"] (PKT)
  start_date TEXT NOT NULL,
  days_supply INTEGER,                -- null = ongoing, no refill tracking
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_med_user ON med_schedules(user_id, active);

CREATE TABLE IF NOT EXISTS dose_log (
  id INTEGER PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES med_schedules(id),
  user_id INTEGER NOT NULL,
  slot TEXT NOT NULL,                 -- "2026-11-26 08:00"
  status TEXT NOT NULL,               -- taken | skipped
  logged_at TEXT DEFAULT (datetime('now')),
  UNIQUE(schedule_id, slot)
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  price REAL NOT NULL,
  sample TEXT,                        -- blood | urine | swab
  fasting INTEGER DEFAULT 0,
  turnaround_hours INTEGER DEFAULT 24,
  unit TEXT, reference TEXT
);

CREATE TABLE IF NOT EXISTS lab_bookings (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  tests TEXT NOT NULL,                -- JSON [{id,name,price}]
  home_collection INTEGER DEFAULT 0,
  address TEXT,
  slot_at TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT DEFAULT 'booked',       -- booked | confirmed | sample_collected | completed | cancelled
  created_at TEXT DEFAULT (datetime('now'))
);

-- ───────────── Health geography: weekly facility disease reports (IDSR / DHIS2-style aggregate counts) ─────────────
CREATE TABLE IF NOT EXISTS disease_reports (
  id INTEGER PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  week_start TEXT NOT NULL,          -- Monday of the ISO week, YYYY-MM-DD
  disease TEXT NOT NULL,             -- code from DISEASES (lib/geo-health.js)
  cases INTEGER NOT NULL,
  source TEXT DEFAULT 'facility',    -- facility | demo
  reported_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(facility_id, week_start, disease)
);

CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,     -- browser push service URL (allow-listed hosts only)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id),
  facility_id INTEGER REFERENCES facilities(id),
  doctor_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  preferred_time TEXT,
  female_only INTEGER DEFAULT 0,
  status TEXT DEFAULT 'requested',    -- requested | called | booked | done | cancelled
  note TEXT,
  handled_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

// Additive migrations for databases created by earlier versions (CREATE TABLE IF NOT EXISTS won't add columns).
const COLUMNS = [
  ['users', 'mfa_secret_enc', 'TEXT'],          // TOTP secret, encrypted
  ['users', 'mfa_enabled', 'INTEGER DEFAULT 0'],
  ['facilities', 'source', "TEXT DEFAULT 'sehatyab'"], // sehatyab | osm (Healthsites/OpenStreetMap import)
  ['facilities', 'osm_id', 'TEXT'],
  ['emergencies', 'coarsened_at', 'TEXT'],       // retention job: location rounded, phone removed
  // Family profiles: dependants are user rows that cannot sign in; a guardian acts for them.
  ['users', 'guardian_id', 'INTEGER'],
  ['users', 'relation', 'TEXT'],
  ['users', 'emergency_contact_name', 'TEXT'],
  ['users', 'emergency_contact_phone', 'TEXT'],
  ['users', 'pref_female_doctor', 'INTEGER DEFAULT 0'],
  ['users', 'camp_alerts', 'INTEGER DEFAULT 0'],
  ['users', 'last_donation_date', 'TEXT'],
  ['inventory', 'price', 'REAL'],                // per-pharmacy price (≤ MRP); null = catalogue price
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  for (const [table, col, type] of COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_facilities_osm ON facilities(osm_id) WHERE osm_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_facilities_type_city ON facilities(type, city)');
  // Indexes for the hottest lookups (found by the load test).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facilities_lat ON facilities(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_notifications_fac ON notifications(facility_id, id);
    CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_rx_doctor ON prescriptions(doctor_id);
    CREATE INDEX IF NOT EXISTS idx_orders_patient ON orders(patient_id);
    CREATE INDEX IF NOT EXISTS idx_orders_pharmacy ON orders(pharmacy_id, status);
    CREATE INDEX IF NOT EXISTS idx_ledger_program ON ledger(program_id);
    CREATE INDEX IF NOT EXISTS idx_benef_program ON beneficiaries(program_id);
    CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource, resource_id);
    CREATE INDEX IF NOT EXISTS idx_energy_latest ON energy_readings(facility_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id);
    CREATE INDEX IF NOT EXISTS idx_appts_fac ON appointments(facility_id, status);`);
  return db;
}

// Small helpers so route code stays readable.
export function helpers(db) {
  return {
    get: (sql, ...p) => db.prepare(sql).get(...p),
    all: (sql, ...p) => db.prepare(sql).all(...p),
    run: (sql, ...p) => db.prepare(sql).run(...p),
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
