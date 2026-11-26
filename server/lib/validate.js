// Minimal schema validation: every route validates input before touching the database.
export class HttpError extends Error {
  /** extra: small, safe, machine-readable fields for the client (e.g. { mfa_required: true }). */
  constructor(status, message, details, extra) { super(message); this.status = status; this.details = details; this.extra = extra; }
}

export const bad = (msg, details) => new HttpError(400, msg, details);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/**
 * spec: { field: 'string' | 'string?' | 'number' | 'int?' | 'bool?' | ['a','b'] | ['a','b','?'] | 'array?' }
 * Strings are trimmed and length-capped. Unknown fields are dropped.
 */
export function validate(body, spec) {
  const out = {};
  const errors = [];
  body = body || {};
  for (const [key, rule] of Object.entries(spec)) {
    let v = body[key];
    const optional = Array.isArray(rule) ? rule.includes('?') : rule.endsWith('?');
    if (v === undefined || v === null || v === '') {
      if (!optional) errors.push(`${key} is required`);
      continue;
    }
    if (Array.isArray(rule)) {
      const allowed = rule.filter((r) => r !== '?');
      if (!allowed.includes(v)) errors.push(`${key} must be one of ${allowed.join(', ')}`);
      else out[key] = v;
      continue;
    }
    const type = rule.replace('?', '');
    if (type === 'string' || type === 'text') {
      if (typeof v !== 'string') { errors.push(`${key} must be text`); continue; }
      v = v.trim();
      const max = type === 'text' ? 5000 : 200;
      if (v.length > max) { errors.push(`${key} is too long (max ${max})`); continue; }
      out[key] = v;
    } else if (type === 'number' || type === 'int') {
      const n = Number(v);
      if (!Number.isFinite(n) || (type === 'int' && !Number.isInteger(n))) errors.push(`${key} must be a ${type}`);
      else out[key] = n;
    } else if (type === 'bool') {
      out[key] = v === true || v === 'true' || v === 1 || v === '1';
    } else if (type === 'array') {
      if (!Array.isArray(v)) errors.push(`${key} must be a list`);
      else out[key] = v;
    } else if (type === 'object') {
      if (typeof v !== 'object' || Array.isArray(v)) errors.push(`${key} must be an object`);
      else out[key] = v;
    }
  }
  if (errors.length) throw bad('Invalid input', errors);
  return out;
}

// Pakistani formats
export const isCnic = (s) => /^\d{5}-?\d{7}-?\d$/.test(String(s));
export const normCnic = (s) => String(s).replace(/-/g, '');
export const isPkPhone = (s) => /^(\+92|0092|0)?3\d{9}$/.test(String(s).replace(/[\s-]/g, ''));
export const normPhone = (s) => '0' + String(s).replace(/[\s-]/g, '').replace(/^(\+92|0092|0)/, '');
export const isLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 23 && lat <= 38 && lng >= 60 && lng <= 78;
