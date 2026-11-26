// Demo data. All organisations, people, facilities, prices and figures are FICTIONAL and for
// demonstration only (except public facts such as drug generic names and emergency hotline numbers).
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword, hmac, encrypt, loadKeys } from './lib/crypto.js';

export const DEMO_PASSWORD = 'Demo@12345';
export const STAFF_PASSWORD = 'Demo@12345678';

// Deterministic pseudo-random so demo data is stable.
function rng(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function seed({ h }) {
  const rand = rng();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pwPatient = hashPassword(DEMO_PASSWORD);
  const pwStaff = hashPassword(STAFF_PASSWORD);

  h.tx(() => {
    // ── Facilities ──
    const C = {
      Karachi: { lat: 24.8607, lng: 67.0011, province: 'Sindh' },
      Lahore: { lat: 31.5204, lng: 74.3587, province: 'Punjab' },
      Islamabad: { lat: 33.6844, lng: 73.0479, province: 'Islamabad' },
      Peshawar: { lat: 34.0151, lng: 71.5249, province: 'Khyber Pakhtunkhwa' },
      Quetta: { lat: 30.1798, lng: 66.975, province: 'Balochistan' },
    };
    const off = (c, dLat, dLng) => ({ lat: +(C[c].lat + dLat).toFixed(5), lng: +(C[c].lng + dLng).toFixed(5) });
    const F = [];
    const addF = (o) => {
      const info = h.run(`INSERT INTO facilities (name, type, sector, lat, lng, city, province, address, phone, services, emergency, beds_total, beds_free,
        sehat_empanelled, female_doctor, license_no, verified, starts_at, ends_at, organizer, power_source, solar_kw, battery_kwh)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        o.name, o.type, o.sector, o.lat, o.lng, o.city, C[o.city].province, o.address ?? null, o.phone ?? null, JSON.stringify(o.services ?? []),
        o.emergency ? 1 : 0, o.beds ?? 0, o.free ?? 0, o.sehat ? 1 : 0, o.female ? 1 : 0, o.license ?? `HC-${o.city.slice(0, 3).toUpperCase()}-${1000 + F.length}`,
        o.verified === false ? 0 : 1, o.starts_at ?? null, o.ends_at ?? null, o.organizer ?? null, o.power ?? 'grid', o.solar_kw ?? 0, o.battery ?? 0);
      const id = Number(info.lastInsertRowid);
      F.push({ id, ...o });
      return id;
    };
    const hospitals = [
      ['Karachi', 'Seaview General Hospital (Demo)', 'public', 0.01, 0.03, 600, 22, true, 'hybrid', 120, 200],
      ['Karachi', 'Korangi Community Hospital (Demo)', 'ppp', -0.03, 0.12, 180, 6, true, 'solar', 60, 120],
      ['Karachi', 'Clifton Care Hospital (Demo)', 'private', -0.04, 0.02, 250, 11, true, 'grid', 0, 0],
      ['Karachi', 'Orangi Town Hospital (Demo)', 'public', 0.07, -0.06, 150, 0, true, 'generator', 0, 0],
      ['Lahore', 'Ravi Teaching Hospital (Demo)', 'public', 0.02, -0.02, 900, 35, true, 'hybrid', 400, 300],
      ['Lahore', 'Gulberg Medical Centre (Demo)', 'private', -0.03, 0.01, 200, 9, true, 'grid', 0, 0],
      ['Lahore', 'Johar Town Hospital (Demo)', 'private', -0.06, -0.06, 160, 4, true, 'solar', 80, 150],
      ['Islamabad', 'Margalla Federal Hospital (Demo)', 'public', 0.02, 0.01, 700, 18, true, 'hybrid', 250, 250],
      ['Islamabad', 'Blue Area Specialist Hospital (Demo)', 'private', -0.01, 0.03, 120, 7, true, 'grid', 0, 0],
      ['Peshawar', 'Khyber District Hospital (Demo)', 'public', 0.01, 0.01, 500, 14, true, 'solar', 150, 200],
      ['Quetta', 'Bolan Civil Hospital (Demo)', 'public', 0.0, 0.01, 400, 12, true, 'generator', 0, 0],
    ];
    for (const [city, name, sector, dLat, dLng, beds, free, sehat, power, solar, batt] of hospitals) {
      addF({ name, type: 'hospital', sector, ...off(city, dLat, dLng), city, beds, free, sehat, emergency: true, female: true, power, solar_kw: solar, battery: batt,
        services: ['Emergency', 'Maternity', 'Surgery', 'Medicine', 'Paediatrics', 'Dialysis'].slice(0, 3 + Math.floor(rand() * 4)), phone: '021-0000000' });
    }
    const clinics = [
      ['Karachi', 'Lyari Women & Child e-Clinic (Demo)', 'clinic', 'ppp', 0.02, -0.01, 'solar', 5, 10, true],
      ['Karachi', 'Malir Family Clinic (Demo)', 'clinic', 'private', 0.03, 0.15, 'grid', 0, 0, false],
      ['Karachi', 'Ibrahim Hyderi BHU (Demo)', 'bhu', 'ppp', -0.02, 0.2, 'solar', 4, 8, true],
      ['Lahore', 'Shahdara Basic Health Unit (Demo)', 'bhu', 'ppp', 0.07, 0.0, 'solar', 5, 10, true],
      ['Lahore', 'Model Town Diagnostic Lab (Demo)', 'lab', 'private', -0.04, 0.02, 'grid', 0, 0, false],
      ['Lahore', 'Raiwind Rural Health Centre (Demo)', 'rhc', 'public', -0.15, -0.05, 'hybrid', 10, 20, true],
      ['Islamabad', 'G-9 Community Clinic (Demo)', 'clinic', 'ngo', 0.0, -0.04, 'solar', 3, 5, true],
      ['Islamabad', 'Regional Blood Centre (Demo)', 'blood_bank', 'public', 0.01, -0.02, 'grid', 0, 0, false],
      ['Peshawar', 'Hayatabad BHU (Demo)', 'bhu', 'public', -0.02, -0.08, 'solar', 5, 10, true],
      ['Peshawar', 'Nowshera Road RHC (Demo)', 'rhc', 'public', 0.02, 0.1, 'hybrid', 20, 20, true],
      ['Quetta', 'Satellite Town Clinic (Demo)', 'clinic', 'private', 0.02, -0.01, 'generator', 0, 0, false],
    ];
    for (const [city, name, type, sector, dLat, dLng, power, solar, batt, female] of clinics) {
      addF({ name, type, sector, ...off(city, dLat, dLng), city, power, solar_kw: solar, battery: batt, female, sehat: false,
        services: type === 'lab' ? ['Blood tests', 'X-ray', 'Ultrasound'] : type === 'blood_bank' ? ['Blood donation', 'Screening'] : ['OPD', 'Immunisation', 'Antenatal care', 'Family planning'] });
    }
    const day = 86400000;
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    addF({ name: 'Free Eye Camp — cataract screening (Demo)', type: 'camp', sector: 'ngo', ...off('Karachi', 0.05, 0.05), city: 'Karachi', organizer: 'Roshni Welfare Trust (Demo)',
      starts_at: iso(-day / 4), ends_at: iso(day * 2), services: ['Eye screening', 'Free glasses', 'Cataract referral'], female: true });
    addF({ name: 'Polio & Measles Vaccination Camp (Demo)', type: 'camp', sector: 'public', ...off('Peshawar', 0.03, -0.03), city: 'Peshawar', organizer: 'District Health Office (Demo)',
      starts_at: iso(day), ends_at: iso(day * 4), services: ['Polio drops', 'Measles vaccine', 'Vitamin A'] });
    addF({ name: 'Diabetes & BP Screening Camp (Demo)', type: 'camp', sector: 'ngo', ...off('Lahore', 0.01, 0.04), city: 'Lahore', organizer: 'Sehat Volunteers Lahore (Demo)',
      starts_at: iso(-day / 8), ends_at: iso(day / 2), services: ['Blood sugar', 'Blood pressure', 'Diet counselling'], female: true });
    addF({ name: 'Flood Relief Medical Camp (Demo)', type: 'camp', sector: 'ngo', ...off('Quetta', -0.05, 0.08), city: 'Quetta', organizer: 'Relief Alliance (Demo)',
      starts_at: iso(-day), ends_at: iso(day * 10), services: ['General OPD', 'ORS & water purification', 'Skin infections'] });
    addF({ name: 'Unverified Free Clinic Day (Demo)', type: 'camp', sector: 'ngo', ...off('Islamabad', 0.03, 0.02), city: 'Islamabad', organizer: 'Community submitted',
      starts_at: iso(day * 2), ends_at: iso(day * 2.3), services: ['General OPD'], verified: false });

    // Energy telemetry: 48 hourly readings for every non-camp facility.
    const now = Date.now();
    for (const f of F.filter((x) => x.type !== 'camp')) {
      let battery = 80;
      const outageBase = { Karachi: 4, Lahore: 3, Islamabad: 1, Peshawar: 6, Quetta: 8 }[f.city];
      const hasFridge = ['bhu', 'rhc', 'clinic', 'hospital'].includes(f.type);
      for (let i = 47; i >= 0; i--) {
        const ts = new Date(now - i * 3600_000);
        const hr = (ts.getUTCHours() + 5) % 24;
        const sun = hr >= 7 && hr <= 18 ? Math.sin(((hr - 7) / 11) * Math.PI) : 0;
        const gridOn = !((hr + f.id) % 24 < outageBase && rand() < 0.85);
        const baseLoad = f.type === 'hospital' ? 40 + f.beds * 0.08 : f.type === 'lab' ? 8 : 2.5;
        const load = +(baseLoad * (hr >= 8 && hr <= 20 ? 1.3 : 0.7)).toFixed(1);
        const solar = +(f.solar_kw * sun * (0.75 + rand() * 0.2)).toFixed(1);
        let gen = 0;
        if (!gridOn) {
          if (f.battery) battery = Math.max(0, battery - (Math.max(0, load - solar) / f.battery) * 100);
          gen = f.power === 'generator' || (f.type === 'hospital' && (!f.battery || battery < 15)) ? 1 : 0;
        } else battery = Math.min(100, battery + 15);
        let fridge = hasFridge ? +(4 + rand() * 2.5).toFixed(1) : null;
        if (hasFridge && !gridOn && !gen && battery < 10 && f.power !== 'solar') fridge = +(8.5 + rand() * 2).toFixed(1);
        // Make one facility visibly critical right now for the demo.
        if (i === 0 && f.name.startsWith('Orangi')) { fridge = 9.4; gen = 0; }
        h.run(`INSERT INTO energy_readings (facility_id, ts, grid_on, solar_kw, battery_pct, load_kw, fridge_temp_c, generator_on) VALUES (?,?,?,?,?,?,?,?)`,
          f.id, ts.toISOString(), i === 0 && f.name.startsWith('Orangi') ? 0 : gridOn ? 1 : 0, solar, f.battery ? +battery.toFixed(0) : null, load, fridge, gen);
      }
    }

    // ── Users ──
    const addU = (o) => Number(h.run(`INSERT INTO users (name, phone, cnic_hash, cnic_last4, password_hash, role, gender, birth_year, province, city, pmdc_no, license_no, verified, org_id, blood_group, blood_donor, lang)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.name, o.phone, o.cnic ? hmac(o.cnic) : null, o.cnic ? o.cnic.slice(-4) : null, o.role === 'patient' ? pwPatient : pwStaff,
      o.role, o.gender ?? null, o.birth_year ?? null, o.province ?? null, o.city ?? null, o.pmdc ?? null, o.license ?? null, o.verified ?? 1, o.org ?? null,
      o.blood ?? null, o.donor ? 1 : 0, o.lang ?? 'en').lastInsertRowid);

    // CNICs chosen so the simulated NSER gives a mix of poverty scores.
    const findCnic = (prefix, want) => { for (let i = 0; i < 100000; i++) { const c = `${prefix}${String(1000000 + i).slice(1)}${i % 10}`; const s = 8 + (parseInt(hmac(c).slice(0, 8), 16) % 600) / 10; if (want(s)) return c; } };
    const ayesha = addU({ name: 'Ayesha Khan', phone: '03001234567', cnic: findCnic('42101', (s) => s <= 25), role: 'patient', gender: 'female', birth_year: 1992, province: 'Sindh', city: 'Karachi', blood: 'B+', donor: true });
    const bilal = addU({ name: 'Bilal Ahmed', phone: '03111234567', cnic: findCnic('17301', (s) => s > 45), role: 'patient', gender: 'male', birth_year: 1985, province: 'Khyber Pakhtunkhwa', city: 'Peshawar', blood: 'O+', donor: true });
    const sana = addU({ name: 'Sana Malik', phone: '03211234567', role: 'patient', gender: 'female', birth_year: 2000, province: 'Punjab', city: 'Lahore', blood: 'A+', donor: false, lang: 'ur' });
    addU({ name: 'Usman Tariq', phone: '03331234567', role: 'patient', gender: 'male', birth_year: 1979, province: 'Sindh', city: 'Karachi', blood: 'B-', donor: true });
    const drFatima = addU({ name: 'Fatima Siddiqui', phone: '03009876543', role: 'doctor', gender: 'female', city: 'Karachi', pmdc: '12345-S' });
    const drHamza = addU({ name: 'Hamza Qureshi', phone: '03019876543', role: 'doctor', gender: 'male', city: 'Lahore', pmdc: '67890-P' });
    addU({ name: 'Imran Shah (pending)', phone: '03029876543', role: 'doctor', gender: 'male', city: 'Peshawar', pmdc: '24680-N', verified: 0 });

    // ── Pharmacies ──
    const addPh = (name, lic, type, pharmacist, city, verified = 1) => Number(h.run(
      'INSERT INTO pharmacies (name, license_no, license_type, pharmacist_name, city, verified) VALUES (?,?,?,?,?,?)', name, lic, type, pharmacist, city, verified).lastInsertRowid);
    const ph1 = addPh('Shifaa Pharmacy Clifton (Demo)', 'DSL-KHI-F9-0412', 'pharmacy', 'Ph. Kamran Ali', 'Karachi');
    const ph2 = addPh('Lahore Care Pharmacy (Demo)', 'DSL-LHR-F9-1180', 'pharmacy', 'Ph. Nida Javed', 'Lahore');
    const ph3 = addPh('Al-Noor Medical Store (Demo)', 'DSL-ISB-F10-0077', 'medical_store', null, 'Islamabad');
    addPh('New Pharmacy Awaiting Check (Demo)', 'DSL-PEW-F9-0999', 'pharmacy', 'Ph. Saad', 'Peshawar', 0);
    addU({ name: 'Kamran Ali', phone: '03051112233', role: 'pharmacist', city: 'Karachi', license: 'PCP-S-3321', org: ph1 });
    addU({ name: 'Nida Javed', phone: '03052223344', role: 'pharmacist', city: 'Lahore', license: 'PCP-P-8812', org: ph2 });

    // ── Medicines (generic names real; brands/prices fictional) ──
    const P = [
      // name, generic, maker, form, strength, schedule, price, mrp, controlled-price, essential, cold, category
      ['Paracet 500', 'Paracetamol', 'DemoPharma', 'Tablet', '500mg', 'OTC', 45, 50, 1, 1, 0, 'Pain & fever'],
      ['Feverex 500', 'Paracetamol', 'Generico Labs', 'Tablet', '500mg', 'OTC', 28, 32, 1, 1, 0, 'Pain & fever'],
      ['Ibrufen 400', 'Ibuprofen', 'DemoPharma', 'Tablet', '400mg', 'OTC', 90, 95, 0, 1, 0, 'Pain & fever'],
      ['ORS Sachet', 'Oral rehydration salts', 'Generico Labs', 'Sachet', '20.5g', 'OTC', 25, 25, 1, 1, 0, 'Stomach'],
      ['Zinco 20', 'Zinc sulphate', 'Generico Labs', 'Dispersible tab', '20mg', 'OTC', 60, 65, 1, 1, 0, 'Stomach'],
      ['Antacid Plus', 'Aluminium/Magnesium hydroxide', 'DemoPharma', 'Suspension', '120ml', 'OTC', 140, 150, 0, 0, 0, 'Stomach'],
      ['Cetrizin 10', 'Cetirizine', 'DemoPharma', 'Tablet', '10mg', 'OTC', 75, 80, 0, 1, 0, 'Allergy & cold'],
      ['Loratin 10', 'Loratadine', 'Generico Labs', 'Tablet', '10mg', 'OTC', 95, 100, 0, 0, 0, 'Allergy & cold'],
      ['Folic Plus', 'Folic acid + Iron', 'DemoPharma', 'Tablet', '5mg/150mg', 'OTC', 120, 130, 1, 1, 0, 'Vitamins & maternal'],
      ['Vita-D 50k', 'Cholecalciferol', 'Generico Labs', 'Capsule', '50,000 IU', 'OTC', 180, 190, 0, 0, 0, 'Vitamins & maternal'],
      ['Amoxil 500', 'Amoxicillin', 'DemoPharma', 'Capsule', '500mg', 'G', 210, 230, 1, 1, 0, 'Antibiotics'],
      ['Amoxi-Gen 500', 'Amoxicillin', 'Generico Labs', 'Capsule', '500mg', 'G', 150, 165, 1, 1, 0, 'Antibiotics'],
      ['Azithro 500', 'Azithromycin', 'DemoPharma', 'Tablet', '500mg', 'G', 380, 400, 1, 1, 0, 'Antibiotics'],
      ['Cipro 500', 'Ciprofloxacin', 'Generico Labs', 'Tablet', '500mg', 'G', 260, 280, 1, 1, 0, 'Antibiotics'],
      ['Metfor 500', 'Metformin', 'DemoPharma', 'Tablet', '500mg', 'G', 160, 170, 1, 1, 0, 'Diabetes'],
      ['Gliclaz 80', 'Gliclazide', 'Generico Labs', 'Tablet', '80mg', 'G', 240, 250, 1, 1, 0, 'Diabetes'],
      ['Insul-R 10ml', 'Human insulin (regular)', 'DemoBio', 'Vial', '100 IU/ml', 'G', 1150, 1200, 1, 1, 1, 'Diabetes'],
      ['Amlo 5', 'Amlodipine', 'DemoPharma', 'Tablet', '5mg', 'G', 190, 200, 1, 1, 0, 'Heart & BP'],
      ['Losar 50', 'Losartan', 'Generico Labs', 'Tablet', '50mg', 'G', 280, 300, 1, 1, 0, 'Heart & BP'],
      ['Ator 20', 'Atorvastatin', 'DemoPharma', 'Tablet', '20mg', 'G', 420, 450, 0, 1, 0, 'Heart & BP'],
      ['Salbu Inhaler', 'Salbutamol', 'DemoPharma', 'Inhaler', '100mcg', 'G', 520, 550, 1, 1, 0, 'Respiratory'],
      ['Omepra 20', 'Omeprazole', 'Generico Labs', 'Capsule', '20mg', 'G', 210, 220, 0, 1, 0, 'Stomach'],
      ['Artem-L', 'Artemether/Lumefantrine', 'DemoPharma', 'Tablet', '20/120mg', 'G', 640, 680, 1, 1, 0, 'Antibiotics'],
      ['Hep-B Vaccine', 'Hepatitis B vaccine', 'DemoBio', 'Vial', '20mcg/ml', 'B', 950, 1000, 1, 1, 1, 'Vaccines'],
      ['Alprax 0.5', 'Alprazolam', 'DemoPharma', 'Tablet', '0.5mg', 'controlled', 150, 160, 1, 0, 0, 'Mental health'],
      ['Sertra 50', 'Sertraline', 'Generico Labs', 'Tablet', '50mg', 'D', 480, 500, 0, 1, 0, 'Mental health'],
      ['Sanitary Pads (10)', 'Sanitary pads', 'CareCo', 'Pack', '10 pcs', 'OTC', 220, 240, 0, 0, 0, 'Women’s health'],
      ['Digital Thermometer', 'Thermometer', 'CareCo', 'Device', '-', 'OTC', 650, 700, 0, 0, 0, 'Devices'],
      ['BP Monitor', 'Blood pressure monitor', 'CareCo', 'Device', '-', 'OTC', 5200, 5500, 0, 0, 0, 'Devices'],
      ['Glucose Strips (50)', 'Glucometer strips', 'CareCo', 'Pack', '50 strips', 'OTC', 1800, 1900, 0, 0, 0, 'Devices'],
    ];
    const productIds = [];
    P.forEach((p, i) => {
      // GTIN-14 = 13 digits + GS1 mod-10 check digit (896 = GS1 Pakistan prefix; numbers are fictional).
      const base = `0896${String(1000000000 + i * 7919).slice(-9)}`;
      const sum = [...base].reduce((s, d, k) => s + Number(d) * (k % 2 === 0 ? 3 : 1), 0);
      const gtin = base + ((10 - (sum % 10)) % 10);
      productIds.push(Number(h.run(`INSERT INTO products (name, generic, manufacturer, form, strength, schedule, drap_reg_no, gtin, price, mrp, price_controlled, essential, cold_chain, category)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, p[0], p[1], p[2], p[3], p[4], p[5], `0${String(30000 + i * 37)}`, gtin, p[6], p[7], p[8], p[9], p[10], p[11]).lastInsertRowid));
    });
    for (const ph of [ph1, ph2, ph3]) for (const pid of productIds) {
      const prod = P[pid - productIds[0]];
      if (ph === ph3 && prod[5] !== 'OTC') continue; // medical store: OTC only
      h.run('INSERT INTO inventory (pharmacy_id, product_id, stock) VALUES (?,?,?)', ph, pid, rand() < 0.1 ? 0 : 10 + Math.floor(rand() * 90));
    }
    // Serialised packs (DRAP 2D barcode) for the first 12 products
    const products = h.all('SELECT * FROM products ORDER BY id LIMIT 12');
    for (const p of products) for (let s = 1; s <= 20; s++) {
      h.run('INSERT INTO serials (gtin, serial, batch, expiry, status, pharmacy_id) VALUES (?,?,?,?,?,?)', p.gtin, `SN${p.id}${String(s).padStart(5, '0')}`,
        `B${p.id}26${s < 10 ? 'A' : 'B'}`, s === 20 ? '2025-12-31' : '2028-06-30', s === 19 ? 'recalled' : 'valid', s % 2 ? ph1 : ph2);
    }

    // ── Insurance ──
    const ins = (name, lic, takaful, digital) => Number(h.run('INSERT INTO insurers (name, secp_license, takaful, digital_only) VALUES (?,?,?,?)', name, lic, takaful, digital).lastInsertRowid);
    const i1 = ins('Hifazat General Insurance (Demo)', 'SECP-NL-0101', 0, 0);
    const i2 = ins('Amanat Takaful (Demo)', 'SECP-TK-0202', 1, 0);
    const i3 = ins('Pocket Insure Digital (Demo)', 'SECP-DIG-0303', 0, 1);
    const plan = (iid, name, model, kind, prem, limit, opd, cash, wait, topup, desc) => h.run(`INSERT INTO insurance_plans (insurer_id, name, model, kind, premium_monthly, annual_limit, opd_limit, daily_cash, waiting_days, sehat_topup, description)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, iid, name, model, kind, prem, limit, opd, cash, wait, topup, desc).lastInsertRowid;
    const pOpd = plan(i3, 'Sehat Plus OPD & Medicines', 'conventional', 'opd', 299, 60000, 60000, 0, 0, 1, 'Doctor visits, lab tests and medicines — the outpatient costs Sehat Card does not cover. Pairs with Sehatyab pharmacy for cashless medicines.');
    plan(i3, 'Hospital Cash Daily', 'conventional', 'hospital_cash', 60, 150000, 0, 2500, 0, 0, 'PKR 2,500 for every night in hospital, paid to your wallet. Micro-premium, no medical tests.');
    plan(i2, 'Takaful Family Health', 'takaful', 'family', 2200, 1000000, 30000, 0, 30, 0, 'Shariah-compliant family cover: inpatient up to PKR 1m plus OPD. Up to 6 family members.');
    plan(i2, 'Takaful Hospital Cash', 'takaful', 'hospital_cash', 75, 150000, 0, 2500, 0, 0, 'Shariah-compliant daily cash for hospital stays.');
    plan(i2, 'Takaful OPD Top-up', 'takaful', 'opd', 349, 50000, 50000, 0, 0, 1, 'Shariah-compliant outpatient & medicines cover on top of Sehat Card.');
    plan(i1, 'Family Inpatient Shield', 'conventional', 'family', 1900, 800000, 0, 0, 30, 0, 'Inpatient cover for families who do not qualify for Sehat Card.');
    plan(i1, 'Critical Illness Top-up', 'conventional', 'topup', 450, 2000000, 0, 0, 90, 1, 'Extra cover above Sehat Card limit for cancer, cardiac surgery, transplants.');
    addU({ name: 'Zara Hussain', phone: '03061112233', role: 'insurer', city: 'Karachi', org: i3 });
    addU({ name: 'Ahmed Raza', phone: '03062223344', role: 'insurer', city: 'Karachi', org: i2 });

    // Ayesha has the OPD plan with a little history
    const start = new Date(Date.now() - 120 * day).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 245 * day).toISOString().slice(0, 10);
    const pol = Number(h.run(`INSERT INTO policies (policy_no, user_id, plan_id, start_date, end_date) VALUES (?,?,?,?,?)`, 'SY-C-DEMO0001', ayesha, pOpd, start, end).lastInsertRowid);
    h.run(`INSERT INTO claims (policy_id, user_id, facility_id, kind, icd10, diagnosis, amount, approved_amount, status, fraud_score, fraud_flags, created_at, decided_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','-40 days'),datetime('now','-40 days'))`, pol, ayesha, F[11].id, 'opd', 'J06', 'Upper respiratory infection', 3500, 3500, 'paid', 0, '[]');
    h.run(`INSERT INTO claims (policy_id, user_id, facility_id, kind, icd10, diagnosis, amount, status, fraud_score, fraud_flags)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, pol, ayesha, F[13].id, 'opd', 'E11', 'Diabetes follow-up + HbA1c', 58000, 'under_review', 25,
      JSON.stringify([{ points: 25, code: 'ABOVE_BENCHMARK', reason: 'Amount is 1.5× the typical cost for E11' }]));

    // ── Subsidy programmes ──
    const prog = (name, sponsor, type, desc, pmt, provinces, covers, cap, copay, fund) => {
      const id = Number(h.run(`INSERT INTO subsidy_programs (name, sponsor, type, description, max_pmt_score, provinces, covers, per_person_annual_cap, copay_pct, fund_balance) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        name, sponsor, type, desc, pmt, JSON.stringify(provinces), JSON.stringify(covers), cap, copay, fund).lastInsertRowid);
      h.run(`INSERT INTO ledger (program_id, amount, kind, purpose, ref, ts) VALUES (?,?,'credit','opening budget','seed',datetime('now','-60 days'))`, id, fund);
      return id;
    };
    prog('Sehat Card (Inpatient)', 'Federal & provincial governments via State Life', 'govt', 'Cashless inpatient care at empanelled hospitals. Eligibility shown here is simulated until NADRA/State Life integration.', null, [], ['inpatient'], 1000000, 0, 50000000);
    const zakat = prog('Zakat Medicine Fund', 'Sehatyab Zakat Pool (Demo)', 'zakat', 'Zakat-eligible patients get prescribed medicines free. Every rupee in and out is on the public ledger.', 32, [], ['medicines'], 15000, 0, 750000);
    prog('Bait-ul-Mal Medical Aid (simulated)', 'Pakistan Bait-ul-Mal (simulated integration)', 'govt', 'Support for treatment costs for deserving patients. Integration is simulated.', 32, [], ['inpatient', 'diagnostics'], 1500000, 0, 5000000);
    const csr = prog('DemoPharma Chronic Care Programme', 'DemoPharma Ltd (CSR, Demo)', 'csr', '80% off diabetes and blood pressure medicines for low-income patients.', 40, [], ['medicines'], 12000, 20, 400000);
    prog('Free OPD at PPP Clinics — Sindh', 'Sindh Health Dept + clinic operators (Demo)', 'ppp', 'Free consultations at partner e-clinics and BHUs run under public-private partnership.', null, ['Sindh'], ['opd'], null, 0, 2000000);
    const amb = prog('Ambulance Fare Support', 'Corporate donors (Demo)', 'donor', 'Pays private ambulance fares for low-income families when no free service is closest.', 40, [], ['ambulance'], 6000, 0, 250000);
    // Some anonymised historical disbursements for the transparency dashboard
    for (let i = 0; i < 30; i++) {
      const pgm = pick([zakat, csr, amb]);
      const amt = 500 + Math.floor(rand() * 4000);
      h.run(`INSERT INTO ledger (program_id, user_id, amount, kind, purpose, ref, ts) VALUES (?,?,?,?,?,?,datetime('now', ?))`, pgm, null, amt, 'debit',
        pgm === amb ? 'ambulance' : 'medicines', 'historic', `-${1 + Math.floor(rand() * 55)} days`);
      h.run('UPDATE subsidy_programs SET fund_balance = fund_balance - ? WHERE id = ?', amt, pgm);
    }
    for (let i = 0; i < 6; i++) {
      const amt = 5000 + Math.floor(rand() * 50000);
      h.run(`INSERT INTO ledger (program_id, amount, kind, purpose, ref, ts) VALUES (?,?,'credit','zakat','donation',datetime('now', ?))`, zakat, amt, `-${Math.floor(rand() * 40)} days`);
      h.run('UPDATE subsidy_programs SET fund_balance = fund_balance + ? WHERE id = ?', amt, zakat);
    }

    // ── PPP contracts ──
    const byName = (n) => F.find((f) => f.name.startsWith(n)).id;
    const contract = (fac, operator, partner, model, fee, targets, months) => {
      const id = Number(h.run(`INSERT INTO ppp_contracts (facility_id, operator, govt_partner, model, start_date, end_date, monthly_fee, kpi_targets) VALUES (?,?,?,?,?,?,?,?)`,
        fac, operator, partner, model, '2025-07-01', '2028-06-30', fee, JSON.stringify(targets)).lastInsertRowid);
      months.forEach(([period, metrics]) => {
        const parts = Object.entries(targets).map(([k, t]) => (t.lower ? (metrics[k] <= t.target ? 1 : t.target / metrics[k]) : Math.min(1, metrics[k] / t.target)));
        h.run('INSERT INTO ppp_reports (contract_id, period, metrics, score) VALUES (?,?,?,?)', id, period, JSON.stringify(metrics), Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100));
      });
    };
    const bhuTargets = { opd_visits: { target: 2500, label: 'OPD visits', unit: 'visits' }, antenatal_visits: { target: 150, label: 'Antenatal visits' },
      immunisation_coverage_pct: { target: 90, label: 'Immunisation coverage', unit: '%' }, medicine_stockout_days: { target: 2, lower: true, label: 'Medicine stock-out days' },
      staff_attendance_pct: { target: 95, label: 'Staff attendance', unit: '%' } };
    contract(byName('Shahdara'), 'Private doctor-operator (Demo)', 'Punjab Health Dept (Demo)', 'Outsourced BHU', 700000, bhuTargets, [
      ['2026-08', { opd_visits: 2100, antenatal_visits: 120, immunisation_coverage_pct: 84, medicine_stockout_days: 5, staff_attendance_pct: 91 }],
      ['2026-09', { opd_visits: 2400, antenatal_visits: 140, immunisation_coverage_pct: 88, medicine_stockout_days: 3, staff_attendance_pct: 94 }],
      ['2026-10', { opd_visits: 2650, antenatal_visits: 155, immunisation_coverage_pct: 91, medicine_stockout_days: 1, staff_attendance_pct: 96 }]]);
    contract(byName('Ibrahim Hyderi'), 'Primary Care Initiative (Demo)', 'Sindh Health Dept (Demo)', 'Outsourced BHU', 650000, bhuTargets, [
      ['2026-08', { opd_visits: 1800, antenatal_visits: 90, immunisation_coverage_pct: 72, medicine_stockout_days: 9, staff_attendance_pct: 82 }],
      ['2026-09', { opd_visits: 1650, antenatal_visits: 85, immunisation_coverage_pct: 70, medicine_stockout_days: 11, staff_attendance_pct: 80 }],
      ['2026-10', { opd_visits: 1700, antenatal_visits: 95, immunisation_coverage_pct: 74, medicine_stockout_days: 8, staff_attendance_pct: 84 }]]);
    contract(byName('Korangi'), 'Hospital Trust (Demo)', 'Sindh Health Dept (Demo)', 'Hospital management', 18000000, {
      bed_occupancy_pct: { target: 85, label: 'Bed occupancy', unit: '%' }, er_wait_minutes: { target: 15, lower: true, label: 'ER wait', unit: 'min' },
      patient_satisfaction_pct: { target: 85, label: 'Patient satisfaction', unit: '%' }, maternal_referrals_completed_pct: { target: 95, label: 'Referrals completed', unit: '%' } }, [
      ['2026-09', { bed_occupancy_pct: 88, er_wait_minutes: 22, patient_satisfaction_pct: 81, maternal_referrals_completed_pct: 93 }],
      ['2026-10', { bed_occupancy_pct: 86, er_wait_minutes: 17, patient_satisfaction_pct: 84, maternal_referrals_completed_pct: 96 }]]);

    // ── Staff for other modules ──
    addU({ name: 'Admin User', phone: '03070000001', role: 'admin', city: 'Islamabad' });
    addU({ name: 'Programme Officer', phone: '03070000002', role: 'program_admin', city: 'Islamabad' });
    addU({ name: 'Dispatch Desk Karachi', phone: '03070000003', role: 'dispatcher', city: 'Karachi' });
    addU({ name: 'Seaview Hospital Admin', phone: '03070000004', role: 'facility_admin', city: 'Karachi', org: F[0].id });

    // ── Ambulances ──
    const prov = (name, kind, hotline, base, perKm) => Number(h.run('INSERT INTO ambulance_providers (name, kind, hotline, fare_base, fare_per_km) VALUES (?,?,?,?,?)', name, kind, hotline, base, perKm).lastInsertRowid);
    const govt = prov('Government Rescue Service (Demo fleet)', 'govt', '1122', 0, 0);
    const ngo = prov('Volunteer Ambulance Trust (Demo fleet)', 'ngo', '115', 500, 0);
    const pvt = prov('CityCare Private Ambulance (Demo)', 'private', '0300-0000000', 1200, 60);
    let n = 0;
    for (const city of Object.keys(C)) {
      const big = ['Karachi', 'Lahore'].includes(city);
      const fleet = [[govt, 'ALS'], [govt, 'BLS'], [govt, 'bike'], [ngo, 'BLS'], [ngo, 'BLS'], [pvt, 'ALS']].concat(big ? [[govt, 'bike'], [ngo, 'BLS'], [pvt, 'BLS'], [govt, 'ALS']] : []);
      for (const [p, type] of fleet) {
        n++;
        const pos = off(city, (rand() - 0.5) * 0.18, (rand() - 0.5) * 0.22);
        h.run('INSERT INTO ambulances (provider_id, call_sign, type, lat, lng) VALUES (?,?,?,?,?)', p, `${city.slice(0, 3).toUpperCase()}-${type}-${String(n).padStart(2, '0')}`, type, pos.lat, pos.lng);
      }
    }

    // ── Community ──
    const post = (author, cat, title, body, city, blood, anon = 0) => Number(h.run(`INSERT INTO posts (author_id, category, title, body, city, blood_group, anonymous, created_at) VALUES (?,?,?,?,?,?,?,datetime('now', ?))`,
      author, cat, title, body, city, blood, anon, `-${Math.floor(rand() * 72)} hours`).lastInsertRowid);
    const q1 = post(sana, 'question', 'Is it safe to take paracetamol during pregnancy?', 'I am 5 months pregnant and have a headache most evenings. Can I take paracetamol, and how much?', 'Lahore', null, 1);
    h.run('INSERT INTO replies (post_id, author_id, body, verified_doctor) VALUES (?,?,?,1)', q1, drFatima,
      'Paracetamol is generally considered the safest pain reliever in pregnancy at normal doses (500mg–1g, up to 4 times a day, max 4g/day). But frequent evening headaches at 5 months should be checked — please get your blood pressure measured soon, as high BP in pregnancy needs attention.');
    post(bilal, 'blood_request', 'O+ blood needed at Khyber District Hospital', 'My father needs 2 bags of O+ for surgery tomorrow morning. Please contact the blood bank counter or call 0311-1234567.', 'Peshawar', 'O+');
    post(drHamza, 'awareness', 'Dengue season: how to protect your family', 'Remove standing water from pots, tyres and coolers every 3 days. Use nets and repellent at dawn and dusk. If fever with body aches lasts more than 2 days, get a CBC test. Do not take ibuprofen or aspirin for suspected dengue — use paracetamol.', 'Lahore', null);
    post(drFatima, 'camp', 'Free eye camp this weekend in Karachi', 'Free cataract screening and glasses for children and elderly. See the Map for the exact location and timings.', 'Karachi', null);
    post(ayesha, 'story', 'How I got my mother’s diabetes medicines through the zakat fund', 'I didn’t know we were eligible until I checked under Support. Now her metformin is free every month.', 'Karachi', null);

    // ── Ayesha's encrypted health record + consent to Dr Fatima ──
    const rec = (type, title, data, daysAgo, author = null, fac = null) => h.run(`INSERT INTO records (patient_id, author_id, facility_id, type, title, data_enc, self_reported, recorded_at) VALUES (?,?,?,?,?,?,?,?)`,
      ayesha, author ?? ayesha, fac, type, title, encrypt(data, `record:${ayesha}`), author ? 0 : 1, new Date(Date.now() - daysAgo * day).toISOString());
    rec('allergy', 'Penicillin allergy', { substance: 'Penicillin', reaction: 'Skin rash', severity: 'moderate' }, 900);
    rec('condition', 'Type 2 diabetes', { icd10: 'E11', since: '2021', notes: 'On metformin' }, 400, drFatima, F[0].id);
    rec('lab', 'HbA1c', { value: 7.4, unit: '%', reference: '< 5.7 normal, < 7.0 target for diabetics' }, 95, drFatima, F[0].id);
    rec('vitals', 'Blood pressure', { systolic: 128, diastolic: 82, pulse: 76 }, 40);
    rec('prescription', 'Metformin 500mg', { medicine: 'Metformin 500mg', dosage: '1 tablet twice daily after meals', duration: '3 months' }, 40, drFatima, F[0].id);
    rec('immunization', 'COVID-19 booster', { vaccine: 'COVID-19 mRNA', dose: 'Booster' }, 600);
    rec('visit', 'Diabetes follow-up', { reason: 'Routine follow-up', notes: 'Sugar improving; continue metformin, walk 30 min daily.' }, 40, drFatima, F[0].id);
    h.run(`INSERT INTO consents (patient_id, grantee_id, scope, purpose, expires_at) VALUES (?,?,?,?,?)`, ayesha, drFatima, 'records', 'Ongoing diabetes care', new Date(Date.now() + 180 * day).toISOString());
    // An e-prescription waiting to be ordered
    const metfor = productIds[14];
    const amox = productIds[11];
    h.run(`INSERT INTO prescriptions (patient_id, doctor_id, source, items, notes) VALUES (?,?,?,?,?)`, ayesha, drFatima, 'e-rx',
      JSON.stringify([{ product_id: metfor, qty: 2, dosage: '1 tab twice daily' }, { product_id: amox, qty: 1, dosage: '1 cap three times daily for 5 days' }]), 'Refill + chest infection');
    h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'rx', ?)`, ayesha, 'Dr. Fatima Siddiqui sent you an e-prescription. Order it from Pharmacy.');
  });
  seedExtras(h);
}

/**
 * Demo data for features added later (lab tests, per-pharmacy prices, a reminder, family member, preferences).
 * Idempotent — also run at boot so databases created by older versions get it.
 */
export function seedExtras(h) {
  h.tx(() => {
    if (!h.get('SELECT 1 FROM lab_tests LIMIT 1')) {
      // Typical private-lab tests in Pakistan; prices are illustrative.
      const T = [
        ['Complete Blood Count (CBC)', 'CBC', 900, 'blood', 0, 12], ['HbA1c (3-month sugar)', 'HBA1C', 1800, 'blood', 0, 24, '%', '< 5.7'],
        ['Fasting Blood Sugar', 'FBS', 300, 'blood', 1, 6, 'mg/dL', '70–99'], ['Lipid Profile', 'LIPID', 1900, 'blood', 1, 24],
        ['Liver Function Tests (LFT)', 'LFT', 1600, 'blood', 0, 24], ['Kidney Function (Urea, Creatinine)', 'RFT', 1200, 'blood', 0, 24],
        ['Thyroid (TSH)', 'TSH', 1500, 'blood', 0, 24, 'mIU/L', '0.4–4.0'], ['Dengue NS1 Antigen', 'NS1', 2200, 'blood', 0, 12],
        ['Typhoid (Typhidot)', 'TYPHI', 1100, 'blood', 0, 12], ['Malaria Parasite (MP)', 'MP', 500, 'blood', 0, 6],
        ['Urine Routine Examination', 'URE', 450, 'urine', 0, 6], ['Vitamin D', 'VITD', 3500, 'blood', 0, 48, 'ng/mL', '30–100'],
        ['Hepatitis B & C Screening', 'HBV-HCV', 1400, 'blood', 0, 24], ['Pregnancy Test (Beta hCG)', 'BHCG', 1300, 'blood', 0, 12],
      ];
      for (const t of T) h.run('INSERT INTO lab_tests (name, code, price, sample, fasting, turnaround_hours, unit, reference) VALUES (?,?,?,?,?,?,?,?)', t[0], t[1], t[2], t[3], t[4], t[5], t[6] ?? null, t[7] ?? null);
    }
    // Per-pharmacy prices: each pharmacy discounts a little differently (never above MRP).
    if (!h.get('SELECT 1 FROM inventory WHERE price IS NOT NULL LIMIT 1')) {
      const ph = h.all('SELECT id FROM pharmacies ORDER BY id').map((x) => x.id);
      for (const row of h.all('SELECT i.pharmacy_id, i.product_id, p.price, p.mrp, p.price_controlled FROM inventory i JOIN products p ON p.id = i.product_id')) {
        const k = [1, 0.96, 0.93, 0.98][ph.indexOf(row.pharmacy_id) % 4] - ((row.product_id % 3) * 0.01);
        h.run('UPDATE inventory SET price = ? WHERE pharmacy_id = ? AND product_id = ?', Math.min(row.mrp, Math.round(row.price * (row.price_controlled ? Math.max(k, 0.97) : k))), row.pharmacy_id, row.product_id);
      }
    }
    const ayesha = h.get(`SELECT * FROM users WHERE phone = '03001234567'`);
    if (ayesha && !h.get('SELECT 1 FROM med_schedules WHERE user_id = ?', ayesha.id)) {
      const metfor = h.get(`SELECT id, name FROM products WHERE generic LIKE 'Metformin%' LIMIT 1`);
      const start = new Date(Date.now() + 5 * 3600_000 - 27 * 86_400_000).toISOString().slice(0, 10);
      if (metfor) h.run('INSERT INTO med_schedules (user_id, product_id, name, dose, times, start_date, days_supply) VALUES (?,?,?,?,?,?,?)', ayesha.id, metfor.id, metfor.name, '1 tablet after meals', '["08:00","20:00"]', start, 30);
      h.run(`UPDATE users SET emergency_contact_name = 'Imran Khan (husband)', emergency_contact_phone = '03331112223', pref_female_doctor = 1, camp_alerts = 1, last_donation_date = ? WHERE id = ?`,
        new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10), ayesha.id);
      if (!h.get('SELECT 1 FROM users WHERE guardian_id = ?', ayesha.id)) {
        h.run(`INSERT INTO users (name, phone, password_hash, role, gender, birth_year, blood_group, province, city, guardian_id, relation)
          VALUES ('Zara Khan', ?, ?, 'patient', 'female', 2019, 'B+', 'Sindh', 'Karachi', ?, 'child')`, `dep-${ayesha.id}-demo`, hashPassword(crypto.randomBytes(24).toString('hex')), ayesha.id);
      }
    }
  });
}

// CLI: node server/seed.js --reset
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
  const file = path.join(DATA, 'sehatyab.db');
  if (process.argv.includes('--reset')) for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  loadKeys(DATA);
  const { createApp } = await import('./app.js');
  const { ctx } = createApp({ dbFile: file });
  seed(ctx);
  console.log('Seeded', file);
}
void crypto;
