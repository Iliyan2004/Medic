// "This phone" features — everything here stays on the device:
//  • PIN lock (shared phones), discreet mode (neutral name/icon, no medical words in alerts)
//  • text size & high contrast • read-aloud • in-app medicine reminders • first-run walkthrough
// Loaded after the first screen renders, so it never slows startup.
import { state, prefs, api, toast, signOut, html, getLang, t } from './views/_shared.js';

const $ = (s) => document.querySelector(s);

// ───────── Display: text size & contrast (applied as early as possible) ─────────
export function applyDisplay() {
  document.documentElement.style.fontSize = `${prefs.get('textScale', 1) * 100}%`;
  if (prefs.get('contrast', false)) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast;
}
export const setTextScale = (k) => { prefs.set('textScale', k); applyDisplay(); };
export const setContrast = (on) => { prefs.set('contrast', !!on); applyDisplay(); };

// ───────── Discreet mode ─────────
const NEUTRAL_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#64748b"/><path d="M9 11h14M9 16h14M9 21h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>');
export const isDiscreet = () => !!prefs.get('discreet', false);
export function applyDiscreet() {
  const on = isDiscreet();
  document.title = on ? 'Planner' : 'Sehatyab';
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = on ? NEUTRAL_ICON : '/icon.svg';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#64748b' : '#0d7a6f');
  const brand = document.querySelector('.brand span');
  if (brand) brand.textContent = on ? 'Planner' : 'Sehatyab';
  document.documentElement.toggleAttribute('data-discreet', on);
}
export const setDiscreet = (on) => { prefs.set('discreet', !!on); applyDiscreet(); sendPrefsToSw(); };

// ───────── PIN lock ─────────
// PBKDF2 (WebCrypto) hash of the PIN, salted, stored on this device only. 5 wrong tries → signed out.
async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: 150_000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
export const hasPin = () => !!prefs.get('pin', null);
export async function setPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4–6 digits');
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  prefs.set('pin', { salt, hash: await pinHash(pin, salt) });
}
export const clearPin = () => prefs.set('pin', null);
const LOCK_AFTER_MS = 2 * 60_000;
let hiddenAt = 0, locked = false;

export function lock() {
  if (!hasPin() || !state.token || locked) return;
  locked = true;
  const card = prefs.get('cardOffline', false) && localStorage.getItem('sy.card');
  const el = document.createElement('div');
  el.id = 'lock';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Locked');
  el.innerHTML = String(html`<form class="lock-box" id="lockf">
      <div class="lock-ico" aria-hidden="true">🔒</div>
      <h2>${isDiscreet() ? 'Planner' : 'Sehatyab'} is locked</h2>
      <label for="pinin" class="muted small">Enter your PIN</label>
      <input id="pinin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]*" required>
      <button class="btn btn-primary btn-block" type="submit">Unlock</button>
      <div class="row" style="justify-content:center;margin-top:10px">
        <a class="btn btn-danger btn-sm" href="tel:1122">📞 1122</a>
        ${card ? html`<button class="btn btn-sm" type="button" id="lockcard">🆘 Emergency card</button>` : ''}
      </div>
      <div id="lockcardbox"></div>
      <a href="#" id="forgot" class="tiny muted" style="display:block;margin-top:10px">Forgot PIN? Sign out</a>
    </form>`);
  document.body.append(el);
  document.getElementById('view').inert = true; document.getElementById('nav').inert = true;
  const input = el.querySelector('#pinin');
  setTimeout(() => input.focus(), 50);
  let tries = 0;
  el.querySelector('#lockf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { salt, hash } = prefs.get('pin');
    if (await pinHash(input.value, salt) === hash) return unlock();
    input.value = '';
    if (++tries >= 5) { clearPin(); unlock(); signOut(); toast('Too many wrong PINs — signed out for safety', true); return; }
    toast(`Wrong PIN (${5 - tries} tries left)`, true);
  });
  el.querySelector('#forgot').addEventListener('click', (e) => { e.preventDefault(); clearPin(); unlock(); signOut(); });
  // Emergency card stays reachable while locked (it is what a paramedic needs) — shown here, app stays locked.
  el.querySelector('#lockcard')?.addEventListener('click', () => {
    try { el.querySelector('#lockcardbox').innerHTML = String(cardHtml(JSON.parse(localStorage.getItem('sy.card')))); } catch { /* ignore */ }
  });
}

/** Emergency card markup (shared by the Care screen and the lock screen). */
export function cardHtml(c) {
  const age = c.birth_year ? new Date().getFullYear() - c.birth_year : null;
  return html`<div class="ecard">
    <div class="ecard-head"><span>🆘 EMERGENCY · ایمرجنسی</span><b class="ecard-blood">${c.blood_group || '?'}</b></div>
    <div class="ecard-name">${c.name}${age ? html` <span class="muted small">· ${age} yrs${c.gender ? ` · ${c.gender}` : ''}</span>` : ''}</div>
    <dl>
      <dt>⚠️ Allergies · الرجی</dt><dd class="${c.allergies.length ? 'danger' : ''}">${c.allergies.length ? c.allergies.join('; ') : 'None known'}</dd>
      <dt>📌 Conditions · بیماریاں</dt><dd>${c.conditions.length ? c.conditions.join('; ') : 'None recorded'}</dd>
      <dt>💊 Medicines · دوائیں</dt><dd>${c.medicines.length ? c.medicines.join('; ') : 'None recorded'}</dd>
      <dt>📞 Emergency contact · رابطہ</dt><dd>${c.emergency_contact ? html`${c.emergency_contact.name} — <a href="tel:${c.emergency_contact.phone}">${c.emergency_contact.phone}</a>` : 'Not set'}</dd>
    </dl>
    <div class="tiny muted">Updated ${new Date(c.generated_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</div>
  </div>`;
}
function unlock() {
  locked = false;
  document.getElementById('lock')?.remove();
  document.getElementById('view').inert = false; document.getElementById('nav').inert = false;
}

// ───────── Read aloud ─────────
function initReadAloud() {
  const btn = $('#read-btn');
  if (!('speechSynthesis' in window)) { btn.hidden = true; return; }
  btn.addEventListener('click', () => {
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.setAttribute('aria-pressed', 'false'); return; }
    const view = document.getElementById('view');
    // Read visible text, skipping collapsed details and the map.
    const clone = view.cloneNode(true);
    clone.querySelectorAll('details:not([open]) > :not(summary), .map, script, style, [aria-hidden="true"]').forEach((n) => n.remove());
    const text = clone.innerText.replace(/\s+\n/g, '\n').slice(0, 4000);
    const u = new SpeechSynthesisUtterance(text);
    const lang = getLang() === 'ur' ? 'ur-PK' : 'en-PK';
    u.lang = lang;
    u.voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith(lang.slice(0, 2))) || null;
    u.rate = 0.95;
    u.onend = u.onerror = () => btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-pressed', 'true');
    speechSynthesis.speak(u);
  });
  addEventListener('hashchange', () => { speechSynthesis.cancel(); btn.setAttribute('aria-pressed', 'false'); });
}

// ───────── In-app medicine reminders ─────────
// Fire while the app is open (or installed and running). True background push needs a push server — see README.
let schedules = [], fetchedAt = 0, pushOn = false;
const fired = new Set();
export async function refreshReminders() { if (!state.token || state.actAs) return; try { schedules = await api('/care/schedules'); fetchedAt = Date.now(); } catch { /* offline */ } }
export async function enableReminderAlerts() {
  if (!('Notification' in window)) throw new Error('This browser cannot show alerts — reminders will appear inside the app');
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error('Alerts were not allowed — reminders will appear inside the app');
  await subscribePush().catch(() => { /* in-app alerts still work */ });
}
/** Web Push: reminders arrive even when the app is closed or the phone is locked. */
export async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const { vapidPublicKey } = await api('/config');
  if (!vapidPublicKey) return false;
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/care/push', { method: 'POST', body: { endpoint: sub.endpoint } });
  sendPrefsToSw();
  pushOn = true;
  return true;
}
function sendPrefsToSw() {
  navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage({ type: 'prefs', prefs: { discreet: isDiscreet() } })).catch(() => {});
}
function checkDue() {
  if (!state.token || state.actAs) return;
  if (Date.now() - fetchedAt > 15 * 60_000) refreshReminders();
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const s of schedules) for (const d of s.today || []) {
    if (d.time !== hm || d.status || fired.has(d.slot + s.id)) continue;
    fired.add(d.slot + s.id);
    const msg = isDiscreet() ? 'You have a reminder' : `Time for ${s.name}${s.dose ? ` — ${s.dose}` : ''}`;
    toast(`⏰ ${msg}`);
    if (!pushOn && 'Notification' in window && Notification.permission === 'granted') { // push already alerts the phone
      try { new Notification(isDiscreet() ? 'Planner' : 'Sehatyab', { body: msg, tag: `dose-${s.id}`, icon: isDiscreet() ? NEUTRAL_ICON : '/icon.svg' }); } catch { /* some browsers need the service worker */ }
    }
  }
}

// ───────── First-run walkthrough ─────────
function onboarding() {
  if (prefs.get('onboarded', false)) return;
  const steps = [
    html`<div class="ob-ico" aria-hidden="true">🌐</div><h2>Choose your language · زبان منتخب کریں</h2>
      <div class="row" style="justify-content:center"><button class="btn btn-primary" data-lang="en" type="button">English</button><button class="btn btn-primary" data-lang="ur" type="button">اردو</button></div>`,
    html`<div class="ob-ico" aria-hidden="true">🩺</div><h2>Your health, in one place</h2>
      <ul class="ob-list"><li>💊 Order medicines and check if a pack is genuine</li><li>🚑 Call the fastest ambulance — no account needed</li>
      <li>🤝 One check for zakat, CSR and government support</li><li>⏰ Reminders for you and your family</li></ul>`,
    html`<div class="ob-ico" aria-hidden="true">🔒</div><h2>Your data stays yours</h2>
      <ul class="ob-list"><li>Your record is encrypted — only people you allow can see it</li><li>You can see everyone who opened it</li>
      <li>Shared phone? Add a PIN and discreet mode in Account</li></ul>`,
  ];
  let i = 0;
  const el = document.createElement('div');
  el.id = 'onboard'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Welcome');
  const draw = () => {
    el.innerHTML = String(html`<div class="ob-box">${steps[i]}
      <div class="ob-dots" aria-hidden="true">${steps.map((_, k) => html`<span class="${k === i ? 'on' : ''}"></span>`)}</div>
      <div class="row between"><button class="btn btn-sm" type="button" data-skip>Skip</button>
        <button class="btn btn-primary" type="button" data-next>${i === steps.length - 1 ? 'Get started' : 'Next'}</button></div></div>`);
  };
  const done = () => { prefs.set('onboarded', true); el.remove(); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.lang) { if (getLang() !== b.dataset.lang) $('#lang-toggle').click(); i = 1; return draw(); }
    if ('skip' in b.dataset) return done();
    if ('next' in b.dataset) { if (++i >= steps.length) return done(); draw(); }
  });
  draw();
  document.body.append(el);
}

export function init() {
  applyDisplay();
  applyDiscreet();
  initReadAloud();
  if (location.hash.startsWith('#/rx-check') || location.hash.startsWith('#/card')) { /* opened from a QR / paramedic: no walkthrough */ } else onboarding();
  if (hasPin() && state.token) lock();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hasPin() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lock();
  });
  refreshReminders();
  setInterval(checkDue, 20_000);
  // Keep the push subscription fresh (browsers rotate them) once alerts have been allowed.
  if (state.token && 'Notification' in window && Notification.permission === 'granted') subscribePush().catch(() => {});
  void t;
}
