// Pharmacy module: catalogue, prescriptions (upload + e-Rx), orders, pharmacist workflow,
// DRAP barcode authenticity checks, cheaper-generic suggestions.
import express from 'express';
import { validate, bad, forbidden, notFound } from '../lib/validate.js';
import { initiatePayment, parseGs1, gtinValid } from '../lib/adapters.js';
import crypto from 'node:crypto';
import { encrypt, decrypt, hmac } from '../lib/crypto.js';
import { rateLimit } from '../lib/auth.js';

// Prescription photos: JPEG/PNG/WebP only, checked by magic bytes (not just the declared type).
const IMG_MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const IMG_MAX_BYTES = 2_500_000;
const IMG_MAX_PER_RX = 3;
export function decodeRxImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Photo must be a JPEG, PNG or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > IMG_MAX_BYTES) throw bad('Photo must be under 2.5 MB');
  if (!IMG_MAGIC[m[1]].every((b, i) => buf[i] === b)) throw bad('That file is not a valid image');
  if (m[1] === 'image/webp' && buf.toString('ascii', 8, 12) !== 'WEBP') throw bad('That file is not a valid image');
  return { mime: m[1], buf };
}
import { quoteSubsidy, chargeSubsidy } from '../lib/subsidy.js';
import { isPkPhone, normPhone } from '../lib/validate.js';

// Drug schedules (Drugs Act 1976 / provincial Drug Rules):
//  OTC – may be sold without prescription
//  G   – prescription; only from a licensed *pharmacy* under a pharmacist (not a medical store)
//  B/D – prescription retained and entered in register
//  controlled – narcotics/psychotropics: never sold online on this platform
export const RX_SCHEDULES = ['G', 'B', 'D'];
const PAYMENT = ['cod', 'jazzcash', 'easypaisa', 'raast', 'card'];

export default function pharmacyRoutes({ h, auth, audit }) {
  const r = express.Router();
  const parse = (o) => ({ ...o, items: JSON.parse(o.items) });

  r.get('/products', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    const cat = String(req.query.category || '').slice(0, 40);
    const rows = h.all(
      `SELECT p.*, SUM(i.stock) AS total_stock, COUNT(CASE WHEN i.stock > 0 THEN 1 END) AS pharmacies_in_stock
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
       WHERE (? = '' OR p.name LIKE ? OR p.generic LIKE ?) AND (? = '' OR p.category = ?)
       GROUP BY p.id ORDER BY p.name LIMIT 100`,
      q, `%${q}%`, `%${q}%`, cat, cat,
    );
    res.json(rows.map((p) => ({ ...p, requires_rx: RX_SCHEDULES.includes(p.schedule), online_sale: p.schedule !== 'controlled' })));
  });

  r.get('/products/:id', (req, res) => {
    const p = h.get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!p) throw notFound('Medicine not found');
    const stock = h.all(
      `SELECT ph.id, ph.name, ph.city, ph.license_type, i.stock, MIN(COALESCE(i.price, ?), ?) AS price FROM inventory i JOIN pharmacies ph ON ph.id = i.pharmacy_id
       WHERE i.product_id = ? AND ph.verified = 1 GROUP BY ph.id ORDER BY (i.stock > 0) DESC, price, i.stock DESC`, p.price, p.mrp, p.id);
    const alternatives = h.all(
      `SELECT id, name, manufacturer, price, strength, form FROM products WHERE generic = ? AND strength IS ? AND id != ? AND price < ? ORDER BY price`,
      p.generic, p.strength, p.id, p.price);
    res.json({ ...p, requires_rx: RX_SCHEDULES.includes(p.schedule), stock, alternatives });
  });

  r.get('/categories', (_req, res) => res.json(h.all('SELECT category, COUNT(*) AS n FROM products GROUP BY category ORDER BY category')));

  r.get('/pharmacies', (_req, res) => res.json(h.all('SELECT * FROM pharmacies WHERE verified = 1 ORDER BY city, name')));

  // ── Prescriptions ──
  r.post('/prescriptions', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { items: 'array', notes: 'text?', patient_phone: 'string?' });
    const items = b.items.map((it) => validate(it, { product_id: 'int', qty: 'int', dosage: 'string?' }));
    if (!items.length || items.some((i) => i.qty < 1 || i.qty > 100)) throw bad('Add at least one medicine with quantity 1–100');
    for (const it of items) if (!h.get('SELECT id FROM products WHERE id = ?', it.product_id)) throw bad(`Unknown medicine ${it.product_id}`);

    let patientId = req.user.id;
    let source = 'upload';
    let doctorId = null;
    if (req.user.role === 'doctor') {
      if (!req.user.verified) throw forbidden('Your PMDC registration must be verified before issuing e-prescriptions');
      if (!b.patient_phone || !isPkPhone(b.patient_phone)) throw bad('Enter the patient’s mobile number');
      const patient = h.get(`SELECT id FROM users WHERE phone = ? AND role = 'patient'`, normPhone(b.patient_phone));
      if (!patient) throw notFound('No patient with that number');
      patientId = patient.id; source = 'e-rx'; doctorId = req.user.id;
    } else if (req.user.role !== 'patient') throw forbidden();

    const info = h.run(
      `INSERT INTO prescriptions (patient_id, doctor_id, source, items, notes) VALUES (?,?,?,?,?)`,
      patientId, doctorId, source, JSON.stringify(items), b.notes ?? null);
    if (source === 'e-rx') {
      h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'rx', ?)`, patientId,
        `Dr. ${req.user.name} sent you an e-prescription (#${info.lastInsertRowid}). Order it from Pharmacy.`);
    }
    audit.log(req, 'rx.create', { resource: 'prescription', resourceId: info.lastInsertRowid, patientId, detail: { source } });
    res.status(201).json(parse(h.get('SELECT * FROM prescriptions WHERE id = ?', info.lastInsertRowid)));
  });

  r.get('/prescriptions', auth.requireAuth, (req, res) => {
    const rows = req.user.role === 'doctor'
      ? h.all('SELECT p.*, u.name AS patient_name FROM prescriptions p JOIN users u ON u.id = p.patient_id WHERE doctor_id = ? ORDER BY p.id DESC', req.user.id)
      : h.all(`SELECT p.*, d.name AS doctor_name FROM prescriptions p LEFT JOIN users d ON d.id = p.doctor_id WHERE patient_id = ? ORDER BY p.id DESC`, req.user.id);
    const names = Object.fromEntries(h.all('SELECT id, name FROM products').map((p) => [p.id, p.name]));
    res.json(rows.map(parse).map((p) => ({ ...p, items: p.items.map((i) => ({ ...i, name: names[i.product_id] })) })));
  });

  // ── Prescription photos (encrypted at rest; every view is audit-logged) ──
  // Who may see a prescription: the patient, the issuing doctor, or a pharmacist at a pharmacy holding an order for it.
  function canSeeRx(user, rx) {
    if (user.id === rx.patient_id) return 'self';
    if (user.role === 'doctor' && rx.doctor_id === user.id) return 'prescriber';
    if (user.role === 'pharmacist' && h.get('SELECT 1 FROM orders WHERE prescription_id = ? AND pharmacy_id = ?', rx.id, user.org_id)) return 'dispensing pharmacist';
    return null;
  }

  r.post('/prescriptions/:id/images', auth.requireRole('patient'), (req, res) => {
    const rx = h.get('SELECT * FROM prescriptions WHERE id = ? AND patient_id = ?', req.params.id, req.user.id);
    if (!rx) throw notFound('Prescription not found');
    if (['dispensed', 'rejected'].includes(rx.status)) throw bad('This prescription is closed');
    if (h.get('SELECT COUNT(*) AS n FROM rx_images WHERE prescription_id = ?', rx.id).n >= IMG_MAX_PER_RX) throw bad(`Up to ${IMG_MAX_PER_RX} photos per prescription`);
    const { mime, buf } = decodeRxImage(req.body?.image);
    const info = h.run('INSERT INTO rx_images (prescription_id, patient_id, mime, bytes, data_enc) VALUES (?,?,?,?,?)',
      rx.id, rx.patient_id, mime, buf.length, encrypt(buf.toString('base64'), `rx-img:${rx.patient_id}:${rx.id}`));
    audit.log(req, 'rx.image_upload', { resource: 'prescription', resourceId: rx.id, patientId: rx.patient_id, detail: { bytes: buf.length } });
    res.status(201).json({ id: info.lastInsertRowid, mime, bytes: buf.length });
  });

  r.get('/prescriptions/:id/images', auth.requireAuth, (req, res) => {
    const rx = h.get('SELECT * FROM prescriptions WHERE id = ?', req.params.id);
    if (!rx || !canSeeRx(req.user, rx)) throw notFound();
    res.json(h.all('SELECT id, mime, bytes, created_at FROM rx_images WHERE prescription_id = ? ORDER BY id', rx.id));
  });

  r.get('/rx-images/:imgId', auth.requireAuth, (req, res) => {
    const img = h.get('SELECT * FROM rx_images WHERE id = ?', req.params.imgId);
    const rx = img && h.get('SELECT * FROM prescriptions WHERE id = ?', img.prescription_id);
    const basis = rx && canSeeRx(req.user, rx);
    if (!basis) throw notFound();
    const buf = Buffer.from(decrypt(img.data_enc, `rx-img:${img.patient_id}:${img.prescription_id}`), 'base64');
    audit.log(req, 'rx.image_view', { resource: 'prescription', resourceId: rx.id, patientId: rx.patient_id, detail: { basis } });
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline' }).send(buf);
  });

  // ── Printable prescription with a QR code any pharmacy can scan to check it is real ──
  const rxToken = (id) => `${id}.${hmac(`rx-verify:${id}`).slice(0, 20)}`;
  r.get('/prescriptions/:id/print', auth.requireAuth, (req, res) => {
    const rx = h.get(`SELECT p.*, d.name AS doctor_name, d.pmdc_no, u.name AS patient_name, u.birth_year, u.gender FROM prescriptions p
      LEFT JOIN users d ON d.id = p.doctor_id JOIN users u ON u.id = p.patient_id WHERE p.id = ?`, req.params.id);
    if (!rx || !canSeeRx(req.user, rx)) throw notFound();
    const names = Object.fromEntries(h.all('SELECT id, name, generic, strength FROM products').map((p) => [p.id, p]));
    audit.log(req, 'rx.print', { resource: 'prescription', resourceId: rx.id, patientId: rx.patient_id });
    res.json({ ...parse(rx), items: JSON.parse(rx.items).map((i) => ({ ...i, ...names[i.product_id] })), token: rxToken(rx.id) });
  });

  // Public, rate-limited: the QR resolves here. Shows only what a pharmacist needs; patient as initials.
  r.get('/rx-verify/:token', rateLimit({ windowMs: 15 * 60_000, max: 60, key: 'rxv' }), (req, res) => {
    const [id] = String(req.params.token).split('.');
    const expected = rxToken(Number(id));
    const a = Buffer.from(String(req.params.token)), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw notFound('This prescription code is not valid');
    const rx = h.get(`SELECT p.*, d.name AS doctor_name, d.pmdc_no, d.verified AS doctor_verified, u.name AS patient_name FROM prescriptions p
      LEFT JOIN users d ON d.id = p.doctor_id JOIN users u ON u.id = p.patient_id WHERE p.id = ?`, Number(id));
    if (!rx) throw notFound('This prescription code is not valid');
    const names = Object.fromEntries(h.all('SELECT id, name, strength FROM products').map((p) => [p.id, `${p.name}${p.strength ? ` ${p.strength}` : ''}`]));
    audit.log(req, 'rx.verify', { resource: 'prescription', resourceId: rx.id, patientId: rx.patient_id });
    res.json({ id: rx.id, status: rx.status, source: rx.source, issued: rx.created_at,
      doctor: rx.doctor_name ? { name: rx.doctor_name, pmdc_no: rx.pmdc_no, verified: !!rx.doctor_verified } : null,
      patient_initials: rx.patient_name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3),
      items: JSON.parse(rx.items).map((i) => ({ name: names[i.product_id], qty: i.qty, dosage: i.dosage })) });
  });

  // Pharmacist desk numbers: open queue and how fast orders reach patients.
  r.get('/desk-stats', auth.requireRole('pharmacist'), (req, res) => {
    const org = req.user.org_id;
    const delivered = h.all(`SELECT o.created_at, MAX(a.ts) AS done FROM orders o JOIN audit_log a ON a.resource = 'order' AND a.resource_id = CAST(o.id AS TEXT) AND a.action = 'order.delivered'
      WHERE o.pharmacy_id = ? AND o.created_at >= datetime('now', '-30 days') GROUP BY o.id`, org);
    const hrs = delivered.map((d) => (Date.parse(d.done) - Date.parse(d.created_at.replace(' ', 'T') + 'Z')) / 3600_000).filter((x) => x >= 0);
    res.json({
      awaiting_rx: h.get(`SELECT COUNT(*) AS n FROM orders WHERE pharmacy_id = ? AND status = 'awaiting_rx'`, org).n,
      to_dispense: h.get(`SELECT COUNT(*) AS n FROM orders WHERE pharmacy_id = ? AND status IN ('placed','verified')`, org).n,
      delivered_30d: hrs.length,
      avg_delivery_hours: hrs.length ? +(hrs.reduce((s, x) => s + x, 0) / hrs.length).toFixed(1) : null,
      low_stock: h.all(`SELECT p.name, i.stock FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.pharmacy_id = ? AND i.stock < 10 ORDER BY i.stock LIMIT 8`, org),
    });
  });

  // ── Orders ──
  r.post('/orders/quote', auth.requireRole('patient'), (req, res) => res.json(buildOrder(req)));

  r.post('/orders', auth.requireRole('patient'), (req, res) => {
    const o = buildOrder(req);
    const result = h.tx(() => {
      for (const it of o.items) {
        const upd = h.run('UPDATE inventory SET stock = stock - ? WHERE pharmacy_id = ? AND product_id = ? AND stock >= ?',
          it.qty, o.pharmacy.id, it.product_id, it.qty);
        if (upd.changes !== 1) throw bad(`${it.name} just went out of stock`);
      }
      const info = h.run(
        `INSERT INTO orders (patient_id, pharmacy_id, items, subtotal, subsidy_amount, subsidy_program_id, total, status,
          prescription_id, payment_method, address) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        req.user.id, o.pharmacy.id, JSON.stringify(o.items), o.subtotal, o.subsidy.amount, o.subsidy.program?.id ?? null,
        o.total, o.needsRx ? 'awaiting_rx' : 'placed', o.prescriptionId ?? null, o.payment_method, o.address);
      const id = info.lastInsertRowid;
      if (o.subsidy.amount) chargeSubsidy(h, { userId: req.user.id, program: o.subsidy.program, amount: o.subsidy.amount, purpose: 'medicines', ref: `order:${id}` });
      const pay = o.total > 0 ? initiatePayment({ method: o.payment_method, amount: o.total, reference: `order:${id}` }) : { status: 'paid' };
      h.run('UPDATE orders SET payment_status = ? WHERE id = ?', pay.status, id);
      return { id, pay };
    });
    audit.log(req, 'order.create', { resource: 'order', resourceId: result.id, patientId: req.user.id });
    res.status(201).json({ ...parse(h.get('SELECT * FROM orders WHERE id = ?', result.id)), payment: result.pay });
  });

  function buildOrder(req) {
    const b = validate(req.body, {
      pharmacy_id: 'int', items: 'array', payment_method: PAYMENT, address: 'string',
      prescription_id: 'int?', subsidy_program_id: 'int?',
    });
    const pharmacy = h.get('SELECT * FROM pharmacies WHERE id = ? AND verified = 1', b.pharmacy_id);
    if (!pharmacy) throw bad('Choose a verified pharmacy');
    if (!b.items.length) throw bad('Your cart is empty');
    let needsRx = false;
    const items = b.items.map((raw) => {
      const it = validate(raw, { product_id: 'int', qty: 'int' });
      if (it.qty < 1 || it.qty > 50) throw bad('Quantity must be 1–50');
      const p = h.get('SELECT * FROM products WHERE id = ?', it.product_id);
      if (!p) throw bad('Unknown medicine');
      if (p.schedule === 'controlled') throw bad(`${p.name} is a controlled drug and cannot be ordered online`);
      if (RX_SCHEDULES.includes(p.schedule)) {
        needsRx = true;
        if (pharmacy.license_type !== 'pharmacy') throw bad(`${pharmacy.name} is a medical store and cannot dispense prescription medicines`);
      }
      const inv = h.get('SELECT stock, price FROM inventory WHERE pharmacy_id = ? AND product_id = ?', pharmacy.id, p.id);
      if (!inv || inv.stock < it.qty) throw bad(`${p.name} is not in stock at ${pharmacy.name}`);
      // This pharmacy's own price, never above the printed MRP.
      return { product_id: p.id, name: p.name, qty: it.qty, price: Math.min(inv.price ?? p.price, p.mrp), schedule: p.schedule };
    });
    if (needsRx) {
      if (!b.prescription_id) throw bad('Prescription medicines need a prescription. Upload one or use an e-prescription.');
      const rx = h.get('SELECT * FROM prescriptions WHERE id = ? AND patient_id = ?', b.prescription_id, req.user.id);
      if (!rx || ['rejected', 'dispensed'].includes(rx.status)) throw bad('That prescription is not valid for a new order');
      const open = h.get(`SELECT id FROM orders WHERE prescription_id = ? AND status != 'cancelled'`, rx.id);
      if (open) throw bad(`This prescription is already being used for order #${open.id}`);
      const rxIds = new Set(JSON.parse(rx.items).map((i) => i.product_id));
      const missing = items.filter((i) => RX_SCHEDULES.includes(i.schedule) && !rxIds.has(i.product_id));
      if (missing.length) throw bad(`Not on your prescription: ${missing.map((m) => m.name).join(', ')}`);
    }
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const delivery = subtotal >= 1500 ? 0 : 150;
    const subsidy = quoteSubsidy(h, req.user.id, b.subsidy_program_id, 'medicines', subtotal);
    return {
      pharmacy, items, needsRx, prescriptionId: b.prescription_id, payment_method: b.payment_method, address: b.address,
      subtotal: subtotal + delivery, delivery, subsidy: { amount: subsidy.amount, program: subsidy.program, capLeft: subsidy.capLeft },
      total: Math.max(0, subtotal + delivery - subsidy.amount),
    };
  }

  r.get('/orders', auth.requireAuth, (req, res) => {
    let rows;
    if (req.user.role === 'pharmacist') {
      rows = h.all(`SELECT o.*, u.name AS patient_name FROM orders o JOIN users u ON u.id = o.patient_id WHERE o.pharmacy_id = ? ORDER BY o.id DESC`, req.user.org_id);
    } else {
      rows = h.all(`SELECT o.*, ph.name AS pharmacy_name FROM orders o JOIN pharmacies ph ON ph.id = o.pharmacy_id WHERE o.patient_id = ? ORDER BY o.id DESC`, req.user.id);
    }
    res.json(rows.map(parse));
  });

  // Pharmacist sees the prescription linked to an order at their pharmacy (logged as patient-data access).
  r.get('/orders/:id/prescription', auth.requireRole('pharmacist'), (req, res) => {
    const o = h.get('SELECT * FROM orders WHERE id = ? AND pharmacy_id = ?', req.params.id, req.user.org_id);
    if (!o || !o.prescription_id) throw notFound();
    const rx = parse(h.get('SELECT p.*, d.name AS doctor_name, d.pmdc_no FROM prescriptions p LEFT JOIN users d ON d.id = p.doctor_id WHERE p.id = ?', o.prescription_id));
    audit.log(req, 'rx.view', { resource: 'prescription', resourceId: rx.id, patientId: o.patient_id, detail: { order: o.id } });
    res.json(rx);
  });

  r.post('/orders/:id/review', auth.requireRole('pharmacist'), (req, res) => {
    const b = validate(req.body, { decision: ['approve', 'reject'], note: 'string?' });
    const o = h.get('SELECT * FROM orders WHERE id = ? AND pharmacy_id = ?', req.params.id, req.user.org_id);
    if (!o) throw notFound();
    if (o.status !== 'awaiting_rx') throw bad('This order is not waiting for prescription review');
    h.tx(() => {
      if (b.decision === 'approve') {
        h.run(`UPDATE orders SET status = 'verified' WHERE id = ?`, o.id);
        h.run(`UPDATE prescriptions SET status = 'verified', verified_by = ?, verified_at = datetime('now') WHERE id = ?`, req.user.id, o.prescription_id);
      } else {
        h.run(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, o.id);
        h.run(`UPDATE prescriptions SET status = 'rejected', verified_by = ?, verified_at = datetime('now') WHERE id = ?`, req.user.id, o.prescription_id);
        for (const it of JSON.parse(o.items)) h.run('UPDATE inventory SET stock = stock + ? WHERE pharmacy_id = ? AND product_id = ?', it.qty, o.pharmacy_id, it.product_id);
        refundSubsidy(o);
      }
      h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'order', ?)`, o.patient_id,
        b.decision === 'approve' ? `Pharmacist approved your prescription for order #${o.id}` : `Order #${o.id} was cancelled: ${b.note || 'prescription not accepted'}`);
    });
    audit.log(req, `rx.${b.decision}`, { resource: 'order', resourceId: o.id, patientId: o.patient_id, detail: { note: b.note } });
    res.json(parse(h.get('SELECT * FROM orders WHERE id = ?', o.id)));
  });

  function refundSubsidy(o) {
    if (!o.subsidy_amount) return;
    h.run('UPDATE subsidy_programs SET fund_balance = fund_balance + ? WHERE id = ?', o.subsidy_amount, o.subsidy_program_id);
    h.run(`INSERT INTO ledger (program_id, user_id, amount, kind, purpose, ref) VALUES (?,?,?,'credit','refund',?)`,
      o.subsidy_program_id, o.patient_id, o.subsidy_amount, `order:${o.id}`);
  }

  // Dispense: pharmacist scans each pack's DataMatrix; serials are marked dispensed so a reused/cloned code is caught.
  r.post('/orders/:id/dispense', auth.requireRole('pharmacist'), (req, res) => {
    const b = validate(req.body, { codes: 'array?' });
    const o = h.get('SELECT * FROM orders WHERE id = ? AND pharmacy_id = ?', req.params.id, req.user.org_id);
    if (!o) throw notFound();
    if (!['placed', 'verified'].includes(o.status)) throw bad(`Cannot dispense an order that is ${o.status}`);
    const scanned = [];
    h.tx(() => {
      for (const code of b.codes || []) {
        const g = parseGs1(code);
        const s = g.gtin && h.get('SELECT * FROM serials WHERE gtin = ? AND serial = ?', g.gtin, g.serial);
        if (!s) throw bad(`Pack ${code} is not in the registry — do not dispense; report to DRAP`);
        if (s.status !== 'valid') throw bad(`Pack ${g.serial} is ${s.status} — do not dispense`);
        h.run(`UPDATE serials SET status = 'dispensed', dispensed_order_id = ? WHERE gtin = ? AND serial = ?`, o.id, g.gtin, g.serial);
        scanned.push(g.serial);
      }
      h.run(`UPDATE orders SET status = 'dispatched' WHERE id = ?`, o.id);
      if (o.prescription_id) h.run(`UPDATE prescriptions SET status = 'dispensed' WHERE id = ?`, o.prescription_id);
      h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'order', ?)`, o.patient_id, `Order #${o.id} is on its way`);
    });
    audit.log(req, 'order.dispense', { resource: 'order', resourceId: o.id, patientId: o.patient_id, detail: { serials: scanned } });
    res.json(parse(h.get('SELECT * FROM orders WHERE id = ?', o.id)));
  });

  r.post('/orders/:id/status', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { status: ['delivered', 'cancelled'] });
    const o = h.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!o) throw notFound();
    const isPharmacist = req.user.role === 'pharmacist' && req.user.org_id === o.pharmacy_id;
    const isOwner = req.user.id === o.patient_id;
    if (b.status === 'delivered' && !isPharmacist) throw forbidden();
    if (b.status === 'cancelled') {
      if (!isOwner && !isPharmacist) throw forbidden();
      if (!['placed', 'awaiting_rx', 'verified'].includes(o.status)) throw bad('Order can no longer be cancelled');
      h.tx(() => {
        for (const it of JSON.parse(o.items)) h.run('UPDATE inventory SET stock = stock + ? WHERE pharmacy_id = ? AND product_id = ?', it.qty, o.pharmacy_id, it.product_id);
        refundSubsidy(o);
      });
    }
    h.run('UPDATE orders SET status = ?, payment_status = CASE WHEN ? = \'delivered\' THEN \'paid\' ELSE payment_status END WHERE id = ?', b.status, b.status, o.id);
    audit.log(req, `order.${b.status}`, { resource: 'order', resourceId: o.id, patientId: o.patient_id });
    res.json(parse(h.get('SELECT * FROM orders WHERE id = ?', o.id)));
  });

  // Public: anyone can check whether a pack is genuine.
  r.post('/verify-pack', (req, res) => {
    const b = validate(req.body, { code: 'string' });
    const g = parseGs1(b.code);
    if (!g.gtin || !g.serial) throw bad('Enter the code as printed: (01)GTIN(21)SERIAL…');
    if (!gtinValid(g.gtin)) {
      return res.json({ verdict: 'invalid_code', message: 'This product code has a wrong check digit — re-check the digits. If it is printed this way, the pack is not genuine.', product: null, simulated_registry: true });
    }
    const product = h.get('SELECT id, name, manufacturer, drap_reg_no FROM products WHERE gtin = ?', g.gtin);
    const s = h.get('SELECT * FROM serials WHERE gtin = ? AND serial = ?', g.gtin, g.serial);
    const today = new Date().toISOString().slice(0, 10);
    const expiry = s?.expiry ?? g.expiry_date;
    let verdict, message;
    if (!product) { verdict = 'unknown_product'; message = 'This product code is not registered. Do not use — report to DRAP.'; }
    else if (!s) { verdict = 'unknown_serial'; message = 'Serial number not found. Possible counterfeit — report to DRAP.'; }
    else if (s.status === 'recalled') { verdict = 'recalled'; message = 'This batch has been recalled. Do not use.'; }
    else if (s.status === 'dispensed') { verdict = 'already_dispensed'; message = 'This pack was already sold once. If you bought it sealed just now, the code may be copied.'; }
    // Printed data that disagrees with the registry is a classic sign of relabelled stock.
    else if ((g.expiry_date && s.expiry && g.expiry_date !== s.expiry) || (g.batch && s.batch && g.batch !== s.batch)) {
      verdict = 'mismatch'; message = 'The batch or expiry printed on this pack does not match the manufacturer’s record. Possible relabelling — do not use, report to DRAP.';
    }
    else if (expiry && expiry < today) { verdict = 'expired'; message = `Expired on ${expiry}.`; }
    else { verdict = 'genuine'; message = 'Genuine pack registered with the manufacturer.'; }
    res.json({ verdict, message, product, batch: s?.batch ?? g.batch, expiry: expiry ?? null, simulated_registry: true });
  });

  return r;
}
