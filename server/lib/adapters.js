// External system adapters.
// None of these institutions currently offers an open API to third-party platforms
// (see research report). Each adapter has the interface the real integration would
// need, and a clearly-labelled SIMULATED implementation so the platform runs end to end.
import crypto from 'node:crypto';

export const SIMULATED = true;

/**
 * NSER / BISP proxy-means-test lookup (would go via NADRA / BISP data-sharing MoU).
 * Simulated: deterministic score from the CNIC hash so the same person always gets the same answer.
 * PMT scores run 0–100; BISP's cut-off has historically been around 32.
 */
export function nserLookup(cnicHash) {
  const n = parseInt(cnicHash.slice(0, 8), 16);
  const pmt = 8 + (n % 600) / 10; // 8.0 – 67.9
  return { simulated: true, source: 'NSER (simulated)', pmtScore: +pmt.toFixed(1), householdSize: 3 + (n % 6) };
}

/**
 * Sehat Card eligibility (State Life / provincial health insurance programme).
 * Simulated rule set: KP & Punjab universal by domicile (Punjab: private empanelled hospitals only
 * since July 2025), ICT/AJK/GB relaunched Jan 2026, Sindh/Balochistan targeted by PMT.
 */
export function sehatCardLookup({ province, pmtScore }) {
  const universal = ['Khyber Pakhtunkhwa', 'Punjab', 'Islamabad', 'AJK', 'Gilgit-Baltistan'];
  const eligible = universal.includes(province) || (pmtScore != null && pmtScore <= 32);
  return {
    simulated: true,
    eligible,
    annualLimit: eligible ? 1000000 : 0,
    coverage: 'Inpatient only, cashless at empanelled hospitals',
    note: province === 'Punjab' ? 'Since 1 Jul 2025 Punjab coverage applies at private empanelled hospitals' : undefined,
  };
}

/** Mobile wallet / Raast payment (JazzCash, Easypaisa, Raast P2M). Simulated instant success. */
export function initiatePayment({ method, amount, reference }) {
  if (method === 'cod') return { simulated: true, status: 'pending', message: 'Pay cash on delivery' };
  return {
    simulated: true,
    status: 'paid',
    providerRef: `${method.toUpperCase()}-${crypto.randomBytes(4).toString('hex')}`,
    amount,
    reference,
  };
}

/**
 * DRAP 2D DataMatrix (GS1) serial verification — mandatory on packs from 9 Oct 2026 (SRO 963(I)/2026).
 * Real version would query DRAP's / GS1 Pakistan's traceability registry; here we check our local serial table.
 */
// DRAP's Guideline on GS1 DataMatrix & Serialization (v2.2, 2026) requires four AIs on each pack:
// (01) GTIN-14, (17) expiry YYMMDD, (10) batch/lot, (21) serial. Scanners return the raw element string:
// fixed-length AIs run on, variable-length ones end with the GS separator (ASCII 29), sometimes prefixed
// by a symbology id "]d2". People typing from the box use the bracketed human-readable form.
const FIXED = { '01': 14, '17': 6, '11': 6, '15': 6 };
const VAR = new Set(['10', '21', '240', '30']);
export function parseGs1(datamatrix) {
  let s = String(datamatrix ?? '').trim();
  const out = { gtin: null, serial: null, batch: null, expiry: null, expiry_date: null };
  if (s.includes('(')) {
    const get = (ai) => { const m = s.match(new RegExp(`\\(${ai}\\)([^()]+)`)); return m ? m[1].trim() : null; };
    Object.assign(out, { gtin: get('01'), serial: get('21'), batch: get('10'), expiry: get('17') });
  } else {
    s = s.replace(/^\]d2|^\]C1|^\]Q3/, '').replace(/<GS>|\\x1d|\|/gi, '\x1d');
    let i = 0;
    for (let guard = 0; i < s.length && guard < 10; guard++) {
      if (s[i] === '\x1d') { i++; continue; }
      const ai2 = s.slice(i, i + 2), ai3 = s.slice(i, i + 3);
      if (FIXED[ai2]) { const v = s.slice(i + 2, i + 2 + FIXED[ai2]); if (ai2 === '01') out.gtin = v; if (ai2 === '17') out.expiry = v; i += 2 + FIXED[ai2]; continue; }
      const ai = VAR.has(ai3) ? ai3 : VAR.has(ai2) ? ai2 : null;
      if (!ai) break;
      const end = s.indexOf('\x1d', i + ai.length);
      const v = s.slice(i + ai.length, end === -1 ? undefined : end).slice(0, 20);
      if (ai === '21') out.serial = v; if (ai === '10') out.batch = v;
      i = end === -1 ? s.length : end + 1;
    }
  }
  if (out.gtin && !/^\d{14}$/.test(out.gtin)) out.gtin = null;
  if (out.expiry && /^\d{6}$/.test(out.expiry)) {
    const [yy, mm, dd] = [out.expiry.slice(0, 2), out.expiry.slice(2, 4), out.expiry.slice(4, 6)];
    // GS1: day "00" means the last day of the month.
    const day = dd === '00' ? new Date(Date.UTC(2000 + +yy, +mm, 0)).getUTCDate() : +dd;
    out.expiry_date = `20${yy}-${mm}-${String(day).padStart(2, '0')}`;
  }
  return out;
}
/** GS1 mod-10 check digit, so typos in a typed GTIN are caught before a registry lookup. */
export function gtinValid(gtin) {
  if (!/^\d{14}$/.test(String(gtin))) return false;
  const d = [...gtin].map(Number);
  const sum = d.slice(0, 13).reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[13];
}

/** SMS gateway (for low-data users). Simulated: returns the message that would be sent. */
export function sendSms(phone, text) {
  const out = { simulated: !whatsappConfigured(), to: phone.replace(/\d(?=\d{4})/g, '•'), text };
  sendWhatsApp(phone, text).catch(() => { /* never block care on messaging */ });
  return out;
}

// ── WhatsApp (Meta WhatsApp Cloud API) ──
// Live when WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are set (Meta Business account, verified number).
// Business-initiated messages must use a pre-approved template: create one named by WHATSAPP_TEMPLATE
// (default "sehatyab_alert") with a single body variable {{1}}, language Urdu or English.
const WA_API = 'https://graph.facebook.com/v21.0';
export const whatsappConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
export const toE164Pk = (phone) => String(phone).replace(/[\s-]/g, '').replace(/^(\+92|0092|0)/, '92');

export async function sendWhatsApp(phone, text, { lang = 'en', fetchImpl = globalThis.fetch } = {}) {
  if (!whatsappConfigured()) return { simulated: true };
  const body = {
    messaging_product: 'whatsapp', to: toE164Pk(phone), type: 'template',
    template: { name: process.env.WHATSAPP_TEMPLATE || 'sehatyab_alert', language: { code: lang === 'ur' ? 'ur' : 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: String(text).slice(0, 1000) }] }] },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetchImpl(`${WA_API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { simulated: false, ok: r.ok, id: j.messages?.[0]?.id, error: r.ok ? undefined : j.error?.message };
  } finally { clearTimeout(timer); }
}
