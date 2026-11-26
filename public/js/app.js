// Sehatyab front-end core: tiny router, API client, i18n, state, rendering helpers.
// Views are loaded on demand (dynamic import) so each screen only downloads what it needs.
import { t, setLang, getLang } from './i18n.js';
import './tilt.js';

// ───────── Safe HTML templating ─────────
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v === null || v === undefined || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ''); });
  return new Raw(out);
}

// ───────── Storage (guarded: may be unavailable in private mode) ─────────
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const state = {
  token: store.get('sy.token'),
  user: store.get('sy.user'),
  lowData: store.get('sy.lowData', false),
  cart: store.get('sy.cart', []),
  saveCart() { store.set('sy.cart', this.cart); updateCartBadge(); },
  actAs: store.get('sy.actAs'), // { id, name } when managing a family member's care
};
export function setActAs(member) {
  state.actAs = member ? { id: member.id, name: member.name } : null;
  if (member) store.set('sy.actAs', state.actAs); else store.del('sy.actAs');
  memo.clear();
  renderChrome();
}
export const prefs = {
  get: (k, d) => store.get(`sy.pref.${k}`, d),
  set: (k, v) => store.set(`sy.pref.${k}`, v),
};

// ───────── API client ─────────
export class ApiError extends Error { constructor(msg, status, details) { super(msg); this.status = status; this.details = details; } }
// RAM cache for PUBLIC catalogue reads only (no personal or health data — those always hit the server).
// Cuts repeat network + JSON parsing when moving between screens. Any write clears it.
const PUBLIC_GET = /^\/(config|pharmacy\/(products|categories)(\?|\/|$)|insurance\/plans|support\/programs$|facilities\/cities|auth\/doctors)/;
const memo = new Map();
const MEMO_MS = 60_000;
export function clearApiCache() { memo.clear(); }
export async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  if (method !== 'GET') memo.clear();
  else if (PUBLIC_GET.test(path)) {
    const hit = memo.get(path);
    if (hit && Date.now() - hit.t < MEMO_MS) return hit.p;
    const p = request(path, opts);
    memo.set(path, { t: Date.now(), p });
    p.catch(() => memo.delete(path));
    return p;
  }
  return request(path, opts);
}
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  // Acting for a family member applies to care data, never to the account itself (/auth/*).
  if (state.actAs && !path.startsWith('/auth/') && !path.startsWith('/care/family')) h['X-Act-As'] = String(state.actAs.id);
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(t('offline_error'), 0);
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && state.token && !path.startsWith('/auth/login')) { signOut(false); }
    const err = new ApiError(data?.error || `Error ${res.status}`, res.status, data?.details);
    err.data = data;
    throw err;
  }
  return data;
}

/** Authenticated binary fetch (e.g. encrypted prescription photos) → object URL. Caller revokes it. */
export async function apiBlobUrl(path) {
  const h = state.token ? { Authorization: `Bearer ${state.token}` } : {};
  if (state.actAs) h['X-Act-As'] = String(state.actAs.id);
  const res = await fetch(`/api${path}`, { headers: h });
  if (!res.ok) throw new ApiError(`Could not load (${res.status})`, res.status);
  return URL.createObjectURL(await res.blob());
}
/** Downscale a camera photo before upload: max 1600px, JPEG ~0.8 → typically 150–400 KB instead of 4–8 MB. */
export async function shrinkImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new ApiError('Choose a photo (JPEG, PNG or WebP)', 400);
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); // decoded off the main thread / on GPU where supported
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.8);
}

export function setSession({ token, user }) {
  state.token = token; state.user = user;
  store.set('sy.token', token); store.set('sy.user', user);
  if (user?.lang && user.lang !== getLang()) applyLang(user.lang);
  renderChrome();
}
export function updateUser(user) { state.user = user; store.set('sy.user', user); renderChrome(); }
export function signOut(callApi = true) {
  // Shared phones: stop this device receiving the previous user's reminders.
  if (state.token && 'serviceWorker' in navigator) {
    const tok = state.token;
    navigator.serviceWorker.ready.then((reg) => reg.pushManager?.getSubscription()).then((sub) => {
      if (!sub) return;
      fetch('/api/care/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ endpoint: sub.endpoint }) })
        .finally(() => sub.unsubscribe());
    }).catch(() => {});
  }
  if (callApi && state.token) api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.token = null; state.user = null; state.actAs = null; store.del('sy.token'); store.del('sy.user'); store.del('sy.actAs'); store.del('sy.card'); memo.clear();
  renderChrome();
  go('#/');
}

// ───────── UI helpers ─────────
export function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = `t${isError ? ' err' : ''}`;
  el.textContent = msg;
  document.getElementById('toast').append(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3500);
}
export function showError(e) {
  const details = Array.isArray(e?.details) ? ` — ${e.details.join('; ')}` : '';
  toast((e?.message || String(e)) + details, true);
}
export const pkr = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
export const when = (s) => {
  if (!s) return '';
  const d = new Date(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString(getLang() === 'ur' ? 'ur-PK' : 'en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};
export const dateOnly = (s) => (s ? new Date(s.includes('T') ? s : s + 'T00:00:00').toLocaleDateString('en-PK', { dateStyle: 'medium' }) : '');
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else if (el.value !== '') o[el.name] = el.type === 'number' ? Number(el.value) : el.value;
  }
  return o;
}
/** Wrap a form submit: disables the button, catches errors. */
export function onSubmit(form, fn) {
  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try { await fn(formData(form), form); } catch (e) { showError(e); } finally { if (btn) btn.disabled = false; }
  });
}
/** Delegate clicks on [data-action] inside root. */
export function actions(root, handlers) {
  // One listener per root; re-rendering a screen replaces the handler map instead of stacking listeners.
  root._actions = handlers;
  if (root._actionsBound) return;
  root._actionsBound = true;
  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = root._actions?.[el.dataset.action];
    if (!fn) return;
    ev.preventDefault();
    el.disabled = true;
    try { await fn(el.dataset, el); } catch (e) { showError(e); } finally { el.disabled = false; }
  });
}
export const loading = () => html`<p class="muted">${t('loading')}</p>`;
export function needLogin(msg) {
  return html`<div class="card"><h2>${t('signin_needed')}</h2><p class="muted">${msg || t('signin_needed_body')}</p>
    <a class="btn btn-primary" href="#/login?next=${encodeURIComponent(location.hash)}">${t('sign_in')}</a>
    <a class="btn" href="#/register">${t('create_account')}</a></div>`;
}
// Progressive disclosure: simple surface, detail one tap away (native <details>, works without JS).
/** A collapsible section: more('Title', body, { hint, open }) */
export function more(summary, body, { hint = '', open = false } = {}) {
  return html`<details class="more" ${open ? raw('open') : ''}><summary><span>${summary}</span>${hint ? html`<span class="muted small">${hint}</span>` : ''}</summary><div class="more-body">${body}</div></details>`;
}
/** A small inline "Details +" toggle inside a card. */
export function peek(body, label = 'Details') {
  return html`<details class="peek"><summary>${label}</summary><div class="peek-body">${body}</div></details>`;
}
export function tag(text, kind = '') { return html`<span class="tag ${kind ? 'tag-' + kind : ''}">${text}</span>`; }
export const statusTag = (s) => {
  const map = { delivered: 'ok', paid: 'ok', approved: 'ok', auto_approved: 'ok', verified: 'ok', closed: 'ok', at_hospital: 'ok', genuine: 'ok', eligible: 'ok', active: 'ok',
    rejected: 'danger', cancelled: 'danger', critical: 'danger', recalled: 'danger', under_review: 'warn', awaiting_rx: 'warn', warning: 'warn', pending: 'warn', upcoming: 'info' };
  return tag(t('st_' + s) !== 'st_' + s ? t('st_' + s) : String(s).replace(/_/g, ' '), map[s] || 'info');
};
export function tabs(items, current) {
  return html`<nav class="tabs" aria-label="Sections">${items.map(([href, label]) => html`<a href="${href}" ${href === current ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}
export function sparkline(values, { min, max, color = 'var(--brand)', band } = {}) {
  const v = values.filter((x) => x != null);
  if (!v.length) return '';
  const lo = min ?? Math.min(...v), hi = max ?? Math.max(...v);
  const W = 300, H = 70, n = values.length;
  const y = (x) => H - 4 - ((x - lo) / (hi - lo || 1)) * (H - 8);
  const pts = values.map((x, i) => (x == null ? null : `${((i / Math.max(1, n - 1)) * W).toFixed(1)},${y(x).toFixed(1)}`)).filter(Boolean).join(' ');
  const bandRect = band ? `<rect x="0" y="${y(band[1])}" width="${W}" height="${y(band[0]) - y(band[1])}" fill="var(--ok-soft)"/>` : '';
  return raw(`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend">${bandRect}<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`);
}
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

// ───────── Navigation & chrome ─────────
const NAV = [
  ['#/', '🏠', 'nav_home'],
  ['#/pharmacy', '💊', 'nav_pharmacy'],
  ['#/care', '⏰', 'nav_care'],
  ['#/insurance', '🛡️', 'nav_insurance'],
  ['#/support', '🤝', 'nav_support'],
  ['#/map', '🗺️', 'nav_map'],
  ['#/geo', '📊', 'nav_geo', 'nav-extra'],
  ['#/community', '💬', 'nav_community'],
  ['#/emergency', '🚑', 'nav_emergency', 'sos'],
  ['#/records', '📋', 'nav_records'],
  ['#/energy', '☀️', 'nav_energy', 'nav-extra'],
  ['#/privacy', '🔒', 'nav_privacy', 'nav-extra'],
];
const WORK = {
  doctor: ['#/work/doctor', '🩺', 'nav_work_doctor'],
  pharmacist: ['#/work/pharmacist', '🧪', 'nav_work_pharmacist'],
  insurer: ['#/work/insurer', '📑', 'nav_work_insurer'],
  dispatcher: ['#/work/dispatch', '📡', 'nav_work_dispatch'],
  facility_admin: ['#/work/facility', '🏥', 'nav_work_facility'],
  program_admin: ['#/work/programs', '📊', 'nav_work_programs'],
  admin: ['#/work/admin', '⚙️', 'nav_work_admin'],
};

function renderChrome() {
  const nav = document.getElementById('nav');
  const cur = '#/' + (location.hash.slice(2).split(/[/?]/)[0] || '');
  const items = NAV.map(([href, ico, key, cls]) => html`<a href="${href}" class="${cls || ''}" ${(href === cur || (href === '#/' && cur === '#/')) ? raw('aria-current="page"') : ''}><span class="nav-ico" aria-hidden="true">${ico}</span><span>${t(key)}</span>${href === '#/pharmacy' ? raw('<span id="cart-count" class="tag tag-brand" hidden></span>') : ''}</a>`);
  const work = state.user && WORK[state.user.role];
  nav.innerHTML = fmt(html`${items}${work ? html`<div class="nav-sep">${t('workspace')}</div><a href="${work[0]}" ${cur === '#/work' ? raw('aria-current="page"') : ''}><span class="nav-ico" aria-hidden="true">${work[1]}</span><span>${t(work[2])}</span></a>` : ''}`);
  const acc = document.getElementById('account-link');
  acc.textContent = state.user ? state.user.name.split(' ')[0] : t('sign_in');
  acc.href = state.user ? '#/account' : '#/login';
  document.getElementById('lang-toggle').textContent = getLang() === 'ur' ? 'English' : 'اردو';
  document.documentElement.classList.toggle('low-data', !!state.lowData);
  const ld = document.getElementById('lowdata-toggle');
  ld.setAttribute('aria-pressed', String(!!state.lowData));
  ld.title = t('low_data');
  document.getElementById('notif-link').hidden = !state.user;
  const pill = document.getElementById('actas-pill');
  pill.hidden = !(state.user && state.actAs);
  if (state.actAs) { pill.textContent = `👤 ${state.actAs.name} ✕`; pill.title = 'Viewing a family member — tap to switch back to you'; }
  updateCartBadge();
}
function updateCartBadge() {
  const el = document.getElementById('cart-count');
  if (!el) return;
  const n = state.cart.reduce((s, i) => s + i.qty, 0);
  el.hidden = !n; el.textContent = n;
}
function applyLang(lang) {
  setLang(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  // Full-screen Urdu layer, downloaded only when Urdu is chosen (English users never fetch it).
  if (lang === 'ur') import('./ur.js').then((m) => { urLayer = m; m.enable(); }).catch(() => {});
  else urLayer?.disable();
}
let urLayer = null;

// ───────── Router ─────────
const ROUTES = {
  '': () => import('./views/home.js'),
  login: () => import('./views/auth.js'),
  register: () => import('./views/auth.js'),
  account: () => import('./views/auth.js'),
  notifications: () => import('./views/home.js'),
  pharmacy: () => import('./views/pharmacy.js'),
  insurance: () => import('./views/insurance.js'),
  support: () => import('./views/support.js'),
  map: () => import('./views/map.js'),
  community: () => import('./views/community.js'),
  emergency: () => import('./views/emergency.js'),
  records: () => import('./views/records.js'),
  energy: () => import('./views/energy.js'),
  privacy: () => import('./views/privacy.js'),
  work: () => import('./views/work.js'),
  care: () => import('./views/care.js'),
  geo: () => import('./views/geo.js'),
  card: () => import('./views/care.js'),
  rx: () => import('./views/care.js'),
  'rx-check': () => import('./views/care.js'),
};
let cleanup = null;
async function route() {
  const [pathPart] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const loader = ROUTES[parts[0] || ''];
  // Fresh <main> per navigation so no listeners leak between screens.
  const old = document.getElementById('view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  renderChrome();
  if (!loader) { view.innerHTML = fmt(html`<div class="card"><h1>${t('not_found')}</h1><a href="#/">${t('nav_home')}</a></div>`); return; }
  view.innerHTML = fmt(loading());
  try {
    const mod = await loader();
    const out = await mod.default({ view, parts, params: query() });
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    view.innerHTML = fmt(html`<div class="notice notice-danger">${e.message || e}</div>`);
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
export function render(view, content) { view.innerHTML = fmt(content); }

// Polling that slows when the tab is hidden (saves battery & data).
export function poll(fn, ms) {
  let timer;
  const tick = async () => { try { await fn(); } catch { /* ignore */ } timer = setTimeout(tick, document.hidden ? ms * 4 : ms); };
  timer = setTimeout(tick, ms);
  return () => clearTimeout(timer);
}

async function refreshNotifCount() {
  if (!state.user) return;
  try {
    const n = (await api('/notifications')).filter((x) => !x.read_at).length;
    const el = document.getElementById('notif-count');
    el.hidden = !n; el.textContent = n > 9 ? '9+' : n;
  } catch { /* ignore */ }
}

// ───────── Boot ─────────
applyLang(store.get('sy.lang', state.user?.lang || 'en'));
document.getElementById('lang-toggle').addEventListener('click', () => {
  const next = getLang() === 'ur' ? 'en' : 'ur';
  applyLang(next); store.set('sy.lang', next);
  if (state.user) api('/auth/me', { method: 'PATCH', body: { lang: next } }).then((r) => updateUser(r.user)).catch(() => {});
  route();
});
document.getElementById('lowdata-toggle').addEventListener('click', () => {
  state.lowData = !state.lowData; store.set('sy.lowData', state.lowData);
  toast(state.lowData ? t('low_data_on') : t('low_data_off'));
  route();
});
document.getElementById('actas-pill').addEventListener('click', () => { setActAs(null); toast('Back to your own profile'); route(); });
window.addEventListener('hashchange', route);
route();
import('./phone.js').then((m) => m.init()).catch(() => {}); // PIN lock, discreet mode, display, read-aloud, reminders, first-run
refreshNotifCount();
poll(refreshNotifCount, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
