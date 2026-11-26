import { html, render, state, api, t, setSession, updateUser, signOut, onSubmit, toast, go, query, needLogin, peek, tag, raw, prefs } from './_shared.js';

// Whole-blood donation interval: 90 days (men), 120 days (women).
function donorStatus(u) {
  if (!u.last_donation_date) return 'Add the date so we only ask when you can donate again.';
  const next = new Date(Date.parse(u.last_donation_date) + (u.gender === 'female' ? 120 : 90) * 86_400_000);
  const days = Math.ceil((next - Date.now()) / 86_400_000);
  return days <= 0 ? '✅ You can donate again. Thank you!' : `You can donate again in ${days} days (${next.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}). We won’t send blood requests until then.`;
}

const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const DEMO = [
  ['Patient (Karachi, low-income)', '03001234567', 'Demo@12345'],
  ['Patient (Peshawar)', '03111234567', 'Demo@12345'],
  ['Doctor (verified)', '03009876543', 'Demo@12345678'],
  ['Pharmacist', '03051112233', 'Demo@12345678'],
  ['Insurer claims officer', '03061112233', 'Demo@12345678'],
  ['Ambulance dispatcher', '03070000003', 'Demo@12345678'],
  ['Hospital admin', '03070000004', 'Demo@12345678'],
  ['Programme officer (subsidy/PPP)', '03070000002', 'Demo@12345678'],
  ['Platform admin', '03070000001', 'Demo@12345678'],
];

export default function auth({ view, parts }) {
  if (parts[0] === 'register') return register(view);
  if (parts[0] === 'account') return account(view);
  return login(view);
}

const demoRow = ([label, phone, pw]) => html`<li class="row between"><span>${label}<br><span class="tiny muted">${phone}</span></span><button class="btn btn-sm" data-phone="${phone}" data-pw="${pw}" type="button">Use</button></li>`;
const afterLogin =() => go(decodeURIComponent(query().get('next') || '') || '#/');

function login(view) {
  render(view, html`
    <div class="grid-2">
      <div class="card">
        <h1>${t('sign_in')}</h1>
        <form id="f">
          <div class="field"><label for="phone">${t('phone')}</label><input id="phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="03001234567" required></div>
          <div class="field"><label for="pw">${t('password')}</label><input id="pw" name="password" type="password" autocomplete="current-password" required></div>
          <div class="field" id="otpf" hidden><label for="otp">Code from your authenticator app</label>
            <input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="123 456"></div>
          <button class="btn btn-primary btn-block" type="submit">${t('sign_in')}</button>
        </form>
        <p class="small muted" style="margin-top:12px">New here? <a href="#/register">${t('create_account')}</a></p>
      </div>
      <div class="card">
        <h2>Demo accounts</h2>
        <p class="small muted">All data is fictional. Tap one to fill the form.</p>
        <ul class="list">${DEMO.slice(0, 3).map(demoRow)}</ul>
        ${peek(html`<ul class="list">${DEMO.slice(3).map(demoRow)}</ul>`, 'Staff accounts')}
      </div>
    </div>`);
  view.querySelectorAll('[data-phone]').forEach((b) => b.addEventListener('click', () => {
    view.querySelector('#phone').value = b.dataset.phone; view.querySelector('#pw').value = b.dataset.pw;
  }));
  onSubmit(view.querySelector('#f'), async (d) => {
    let r;
    try {
      r = await api('/auth/login', { method: 'POST', body: d });
    } catch (e) {
      if (e.data?.mfa_required) {
        const f = view.querySelector('#otpf');
        f.hidden = false; view.querySelector('#otp').required = true; view.querySelector('#otp').focus();
        if (!d.otp) return; // first step: just reveal the code field
      }
      throw e;
    }
    setSession(r);
    if (r.mfa_recommended) toast('Tip: turn on two-step sign-in in your account — staff accounts can open patient data.');
    afterLogin();
  });
}

function register(view) {
  render(view, html`
    <div class="card" style="max-width:640px">
      <h1>${t('create_account')}</h1>
      <p class="muted small">Just your name, phone and a password.</p>
      <form id="f">
        <div class="form-grid">
          <div class="field"><label for="n">${t('name')}</label><input id="n" name="name" required autocomplete="name"></div>
          <div class="field"><label for="p">${t('phone')}</label><input id="p" name="phone" required inputmode="tel" placeholder="03xxxxxxxxx"></div>
          <div class="field"><label for="pw">${t('password')} <span class="hint">(8+ characters)</span></label><input id="pw" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
        </div>
        <details class="peek" style="margin-bottom:14px"><summary>Optional: CNIC, gender, location</summary><div class="peek-body">
        <p class="tiny muted">Your CNIC lets us check Sehat Card and support programmes for you. We never store the CNIC itself.</p>
        <div class="form-grid">
          <div class="field"><label for="c">${t('cnic')}</label><input id="c" name="cnic" inputmode="numeric" placeholder="35202-1234567-1"></div>
          <div class="field"><label for="g">Gender</label><select id="g" name="gender"><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
          <div class="field"><label for="by">Birth year</label><input id="by" name="birth_year" type="number" min="1900" max="2026"></div>
          <div class="field"><label for="pr">${t('province')}</label><select id="pr" name="province"><option value="">—</option>${PROVINCES.map((p) => html`<option>${p}</option>`)}</select></div>
          <div class="field"><label for="ci">${t('city')}</label><input id="ci" name="city"></div>
        </div></div></details>
        <label class="check"><input type="checkbox" name="consent_terms" required> <span>I have read the <a href="#/privacy" target="_blank">privacy notice</a>. I understand my health data is encrypted and shared only with my consent.</span></label>
        <p></p>
        <button class="btn btn-primary" type="submit">${t('create_account')}</button>
      </form>
    </div>`);
  onSubmit(view.querySelector('#f'), async (d) => {
    setSession(await api('/auth/register', { method: 'POST', body: { ...d, lang: document.documentElement.lang } }));
    toast('Welcome to Sehatyab!');
    go('#/');
  });
}

async function account(view) {
  if (!state.user) return render(view, needLogin());
  const u = (await api('/auth/me')).user;
  render(view, html`
    <div class="page-head"><div><h1>${u.name}</h1><p class="muted">${u.phone} · ${u.role}${u.verified ? ' · verified' : ''}</p></div>
      <button class="btn" id="out" type="button">${t('sign_out')}</button></div>
    <div class="card" style="max-width:640px">
      <h2>Profile</h2>
      <form id="f">
        <div class="form-grid">
          <div class="field"><label for="n">${t('name')}</label><input id="n" name="name" value="${u.name}"></div>
          <div class="field"><label for="c">${t('cnic')} ${u.cnic_last4 ? html`<span class="hint">(on file — ends in ${u.cnic_last4})</span>` : html`<span class="hint">(needed for Sehat Card & support checks)</span>`}</label><input id="c" name="cnic" inputmode="numeric" placeholder="${u.cnic_last4 ? 'Replace CNIC' : '35202-1234567-1'}" autocomplete="off"></div>
          <div class="field"><label for="pr">${t('province')}</label><select id="pr" name="province"><option value="">—</option>${PROVINCES.map((p) => html`<option ${p === u.province ? 'selected' : ''}>${p}</option>`)}</select></div>
          <div class="field"><label for="ci">${t('city')}</label><input id="ci" name="city" value="${u.city || ''}"></div>
          <div class="field"><label for="bg">Blood group</label><select id="bg" name="blood_group"><option value="">—</option>${BLOOD.map((b) => html`<option ${b === u.blood_group ? 'selected' : ''}>${b}</option>`)}</select></div>
        </div>
        <label class="check"><input type="checkbox" name="blood_donor" ${u.blood_donor ? 'checked' : ''}> <span>Notify me when someone nearby needs my blood type</span></label>
        <p></p><button class="btn btn-primary" type="submit">${t('save')}</button>
      </form>
    </div>
    ${u.role === 'patient' ? html`<form class="card" style="max-width:640px" id="prefs">
      <h2>Care preferences</h2>
      <div class="form-grid">
        <div class="field"><label for="ecn">Emergency contact name</label><input id="ecn" name="emergency_contact_name" value="${u.emergency_contact_name || ''}" placeholder="e.g. Imran (husband)"></div>
        <div class="field"><label for="ecp">Emergency contact mobile</label><input id="ecp" name="emergency_contact_phone" inputmode="tel" value="${u.emergency_contact_phone || ''}" placeholder="03xxxxxxxxx"></div>
      </div>
      <label class="check"><input type="checkbox" name="pref_female_doctor" ${u.pref_female_doctor ? raw('checked') : ''}> <span>Prefer female doctors <span class="hint">(maps, appointments and doctor lists show women first or only)</span></span></label>
      <label class="check"><input type="checkbox" name="camp_alerts" ${u.camp_alerts ? raw('checked') : ''}> <span>Tell me about free health camps in my city</span></label>
      ${u.blood_donor ? html`<div class="field" style="margin-top:10px"><label for="ld">Last blood donation</label><input id="ld" name="last_donation_date" type="date" value="${u.last_donation_date || ''}" max="${new Date().toISOString().slice(0, 10)}">
        <div class="hint" id="donorhint">${donorStatus(u)}</div></div>` : ''}
      <p></p><button class="btn btn-primary" type="submit">${t('save')}</button> <a class="btn" href="#/card">🆘 See my emergency card</a> <a class="btn" href="#/care/family">👨‍👩‍👧 Family</a>
    </form>` : ''}
    <div class="card" style="max-width:640px" id="phone">
      <h2>On this phone</h2>
      <p class="small muted">These settings stay on this device only.</p>
      <div class="row between setting"><span><b>🔒 PIN lock</b><br><span class="small muted">Asks for a PIN when the app opens or after 2 minutes away. Good for shared phones.</span></span>
        <span id="pinctl"></span></div>
      <div class="row between setting"><span><b>🕶 Discreet mode</b><br><span class="small muted">Shows the app as “Planner” with a plain icon; alerts never name a medicine or condition.</span></span>
        <label class="switch"><input type="checkbox" id="disc"><span></span><span class="sr">Discreet mode</span></label></div>
      <div class="row between setting"><span><b>Aa Text size</b></span>
        <span class="seg" role="group" aria-label="Text size">${[[1, 'A'], [1.15, 'A+'], [1.3, 'A++']].map(([k, l]) => html`<button type="button" class="btn btn-sm" data-scale="${k}">${l}</button>`)}</span></div>
      <div class="row between setting"><span><b>◐ High contrast</b></span><label class="switch"><input type="checkbox" id="hc"><span></span><span class="sr">High contrast</span></label></div>
      <div class="row between setting"><span><b>👋 Show the welcome tour again</b></span><button class="btn btn-sm" type="button" id="tour">Show</button></div>
    </div>
    <div class="card" style="max-width:640px" id="mfa">
      <div class="row between"><h2 style="margin:0">Two-step sign-in</h2>${u.mfa_enabled ? tag('On', 'ok') : u.role !== 'patient' ? tag('Recommended', 'warn') : tag('Off')}</div>
      <p class="small muted">${u.mfa_enabled ? 'You need a code from your authenticator app each time you sign in.' : 'Adds a 6-digit code from an authenticator app (Google or Microsoft Authenticator) at sign-in, so a stolen password alone can’t open your account.'}</p>
      <div id="mfabox">${u.mfa_enabled
        ? html`<form id="mfaoff" class="row"><input name="otp" inputmode="numeric" maxlength="7" placeholder="Current code" style="width:160px" required><button class="btn" type="submit">Turn off</button></form>`
        : html`<button class="btn btn-primary" type="button" id="mfastart">Set up</button>`}</div>
    </div>`);
  view.querySelector('#out').addEventListener('click', () => signOut());
  onSubmit(view.querySelector('#prefs'), async (d, form) => {
    const body = { ...d, pref_female_doctor: form.pref_female_doctor.checked, camp_alerts: form.camp_alerts.checked };
    updateUser((await api('/auth/me', { method: 'PATCH', body })).user);
    toast('Saved');
    const hint = view.querySelector('#donorhint'); if (hint) hint.textContent = donorStatus(state.user);
  });
  // "On this phone" settings
  const phone = await import('../phone.js');
  const drawPin = () => {
    const box = view.querySelector('#pinctl');
    box.innerHTML = phone.hasPin()
      ? '<button class="btn btn-sm" type="button" id="pinoff">Turn off</button>'
      : '<form id="pinf" class="row"><input name="pin" type="password" autocomplete="new-password" inputmode="numeric" maxlength="6" pattern="[0-9]{4,6}" placeholder="4–6 digits" style="width:120px" required aria-label="New PIN"><button class="btn btn-sm btn-primary" type="submit">Set PIN</button></form>';
    box.querySelector('#pinoff')?.addEventListener('click', () => { phone.clearPin(); toast('PIN lock off'); drawPin(); });
    box.querySelector('#pinf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await phone.setPin(e.target.pin.value); toast('PIN lock on'); drawPin(); } catch (err) { toast(err.message, true); }
    });
  };
  drawPin();
  const disc = view.querySelector('#disc'); disc.checked = phone.isDiscreet();
  disc.addEventListener('change', () => { phone.setDiscreet(disc.checked); toast(disc.checked ? 'Discreet mode on' : 'Discreet mode off'); });
  const hc = view.querySelector('#hc'); hc.checked = !!prefs.get('contrast', false);
  hc.addEventListener('change', () => phone.setContrast(hc.checked));
  const markScale = () => view.querySelectorAll('[data-scale]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.scale) === prefs.get('textScale', 1))));
  view.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => { phone.setTextScale(Number(b.dataset.scale)); markScale(); }));
  markScale();
  view.querySelector('#tour').addEventListener('click', () => { prefs.set('onboarded', false); location.reload(); });
  view.querySelector('#mfastart')?.addEventListener('click', async () => {
    try {
      const s = await api('/auth/mfa/setup', { method: 'POST' });
      const box = view.querySelector('#mfabox');
      box.innerHTML = String(html`<ol class="small">
          <li>Open your authenticator app and add an account. On this phone you can <a href="${s.uri}">tap here to add it</a>.</li>
          <li>Or type this key: <span class="code" style="font-size:1rem;display:block;margin:6px 0">${s.secret.match(/.{1,4}/g).join(' ')}</span></li>
          <li>Enter the 6-digit code it shows:</li></ol>
        <form id="mfaon" class="row"><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456" style="width:160px" required><button class="btn btn-primary" type="submit">Turn on</button></form>`);
      onSubmit(box.querySelector('#mfaon'), async (d) => { updateUser((await api('/auth/mfa/enable', { method: 'POST', body: d })).user); toast('Two-step sign-in is on'); account(view); });
    } catch (e) { toast(e.message, true); }
  });
  onSubmit(view.querySelector('#mfaoff'), async (d) => { updateUser((await api('/auth/mfa/disable', { method: 'POST', body: d })).user); toast('Two-step sign-in is off'); account(view); });
  onSubmit(view.querySelector('#f'), async (d) => {
    if (!d.cnic) delete d.cnic;
    updateUser((await api('/auth/me', { method: 'PATCH', body: d })).user);
    toast('Saved');
    account(view);
  });
}
