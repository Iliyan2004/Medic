// My care: today's medicines, reminders & refills, lab tests, appointments, family;
// emergency card (#/card); printable prescription (#/rx/:id); public QR check (#/rx-check/:token).
import { html, render, state, api, pkr, when, tabs, onSubmit, actions, toast, go, needLogin, statusTag, tag, loading, more, peek, prefs, setActAs, raw } from './_shared.js';
import { cardHtml, enableReminderAlerts, refreshReminders } from '../phone.js';

const TABS = () => tabs([['#/care', 'Today'], ['#/care/meds', 'Medicines'], ['#/care/labs', 'Lab tests'], ['#/care/appointments', 'Appointments'], ['#/care/family', 'Family']],
  location.hash.split('?')[0] || '#/care');
const whoBanner = () => (state.actAs ? html`<div class="notice small">Managing care for <b>${state.actAs.name}</b>. <a href="#" data-action="me">Switch to me</a></div>` : '');

export default function care({ view, parts }) {
  if (parts[0] === 'rx-check') return rxCheck(view, parts[1]);
  if (!state.user) return render(view, needLogin('Sign in to set reminders and manage your family’s care.'));
  if (parts[0] === 'card') return card(view);
  if (parts[0] === 'rx') return rxPrint(view, parts[1]);
  actions(view, { me: () => { setActAs(null); go(location.hash); } });
  const sub = parts[1];
  if (sub === 'meds') return meds(view);
  if (sub === 'labs') return labs(view);
  if (sub === 'appointments') return appointments(view);
  if (sub === 'family') return family(view);
  return today(view);
}

// ───────── Today ─────────
export function doseRows(list) {
  const rows = list.flatMap((s) => s.today.map((d) => ({ s, d }))).sort((a, b) => a.d.time.localeCompare(b.d.time));
  const now = new Date().toTimeString().slice(0, 5);
  return html`<ul class="list doses">${rows.map(({ s, d }) => html`<li class="dose ${d.status || (d.time < now ? 'late' : '')}">
    <span class="dose-time">${d.time}</span>
    <span class="dose-name"><b>${s.name}</b>${s.dose ? html`<br><span class="tiny muted">${s.dose}</span>` : ''}</span>
    ${d.status ? tag(d.status === 'taken' ? '✓ Taken' : 'Skipped', d.status === 'taken' ? 'ok' : '')
      : html`<span class="row"><button class="btn btn-sm btn-primary" data-action="dose" data-id="${s.id}" data-slot="${d.slot}" data-st="taken">✓ Taken</button>
        <button class="btn btn-sm" data-action="dose" data-id="${s.id}" data-slot="${d.slot}" data-st="skipped" aria-label="Skip">Skip</button></span>`}
  </li>`)}</ul>`;
}
export async function logDose({ id, slot, st }) {
  await api(`/care/schedules/${id}/doses`, { method: 'POST', body: { slot, status: st } });
  refreshReminders();
}

async function today(view) {
  render(view, html`${TABS()}${loading()}`);
  const list = await api('/care/schedules');
  const refills = list.filter((s) => s.refill_due);
  const alertsOn = 'Notification' in window && Notification.permission === 'granted';
  render(view, html`${TABS()}${whoBanner()}
    <div class="page-head"><div><h1>Today</h1><p class="muted">${new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <a class="btn" href="#/card">🆘 Emergency card</a></div>
    ${refills.map((s) => html`<div class="notice notice-warn row between"><span>💊 <b>${s.name}</b> runs out in ${s.days_left} day${s.days_left === 1 ? '' : 's'}.</span>
      <span class="row">${s.product_id ? html`<button class="btn btn-sm btn-primary" data-action="refill" data-pid="${s.product_id}">Reorder</button>` : ''}
      <button class="btn btn-sm" data-action="refilled" data-id="${s.id}">I’ve refilled</button></span></div>`)}
    ${list.length ? html`<div class="card">${doseRows(list)}</div>` : html`<div class="card"><h2>No medicines yet</h2>
      <p class="muted">Add a medicine, or open a prescription and tap “Set reminders”.</p><a class="btn btn-primary" href="#/care/meds">+ Add medicine</a></div>`}
    ${!state.actAs && !alertsOn ? html`<div class="notice small row between"><span>Get a phone alert at dose time while Sehatyab is open.</span><button class="btn btn-sm" data-action="alerts">Turn on alerts</button></div>` : ''}`);
  actions(view, {
    me: () => { setActAs(null); go(location.hash); },
    dose: async (d) => { await logDose(d); today(view); },
    refill: ({ pid }) => { const it = state.cart.find((c) => c.product_id === Number(pid)); if (it) it.qty++; else state.cart.push({ product_id: Number(pid), qty: 1 }); state.saveCart(); go('#/pharmacy/cart'); },
    refilled: async ({ id }) => { await api(`/care/schedules/${id}`, { method: 'PATCH', body: { refilled: true } }); toast('Supply reset — reminders continue'); today(view); },
    alerts: async () => { try { await enableReminderAlerts(); toast('Alerts on'); today(view); } catch (e) { toast(e.message, true); } },
  });
}

// ───────── Medicines (schedules) ─────────
async function meds(view) {
  const [list, products] = await Promise.all([api('/care/schedules'), api('/pharmacy/products')]);
  render(view, html`${TABS()}${whoBanner()}
    <h1>Medicines & reminders</h1>
    <div class="grid">${list.map((s) => html`<div class="card">
      <div class="row between"><b>${s.name}</b>${s.refill_due ? tag('Refill soon', 'warn') : s.days_left != null ? tag(`${s.days_left} days left`, 'ok') : ''}</div>
      <div class="small muted">${s.dose || ''}</div>
      <div class="row" style="margin-top:8px">${s.times.map((tm) => html`<span class="tag tag-brand">⏰ ${tm}</span>`)}</div>
      ${peek(html`<p class="small">Taken on time: <b>${s.adherence_pct}%</b> (last 30 days)</p><div class="bar ${s.adherence_pct < 70 ? 'warn' : ''}"><span style="width:${s.adherence_pct}%"></span></div>
        <form class="row" data-times="${s.id}" style="margin-top:10px"><input name="times" value="${s.times.join(', ')}" aria-label="Times" style="flex:1"><button class="btn btn-sm" type="submit">Save times</button></form>
        <div class="row" style="margin-top:8px"><button class="btn btn-sm" data-action="stop" data-id="${s.id}">Stop reminders</button></div>`, 'Progress & settings')}
    </div>`)}</div>
    ${more('+ Add a medicine', html`<form id="f">
      <div class="form-grid">
        <div class="field"><label for="pp">Medicine</label><input id="pp" name="name" list="plist" required placeholder="e.g. Metfor 500"><datalist id="plist">${products.map((p) => html`<option value="${p.name}">`)}</datalist></div>
        <div class="field"><label for="dd">Dose</label><input id="dd" name="dose" placeholder="e.g. 1 tablet after meals"></div>
        <div class="field"><label for="tt">Times</label><select id="tt" name="preset"><option value="09:00">Once a day (9 am)</option><option value="08:00,20:00">Twice a day (8 am, 8 pm)</option>
          <option value="08:00,14:00,20:00">Three times (8, 2, 8)</option><option value="21:00">At night (9 pm)</option></select></div>
        <div class="field"><label for="ds">Days of supply <span class="hint">(for refill alerts)</span></label><input id="ds" name="days_supply" type="number" min="1" max="365" placeholder="e.g. 30"></div>
      </div><button class="btn btn-primary" type="submit">Add reminder</button></form>`, { open: !list.length })}`);
  onSubmit(view.querySelector('#f'), async (d) => {
    const p = products.find((x) => x.name.toLowerCase() === d.name.toLowerCase());
    await api('/care/schedules', { method: 'POST', body: { name: d.name, dose: d.dose, times: d.preset.split(','), days_supply: d.days_supply, product_id: p?.id } });
    toast('Reminder added'); refreshReminders(); meds(view);
  });
  view.querySelectorAll('form[data-times]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const times = f.times.value.split(/[,\s]+/).filter(Boolean).map((x) => x.padStart(5, '0'));
    try { await api(`/care/schedules/${f.dataset.times}`, { method: 'PATCH', body: { times } }); toast('Times saved'); refreshReminders(); meds(view); } catch (err) { toast(err.message, true); }
  }));
  actions(view, {
    me: () => { setActAs(null); go(location.hash); },
    stop: async ({ id }) => { await api(`/care/schedules/${id}`, { method: 'PATCH', body: { active: false } }); toast('Stopped'); refreshReminders(); meds(view); },
  });
}

// ───────── Lab tests ─────────
async function labs(view) {
  const [tests, labsList, bookings] = await Promise.all([api('/care/lab-tests'), api('/care/labs'), api('/care/lab-bookings')]);
  const verified = labsList.filter((l) => l.verified);
  const tomorrow = new Date(Date.now() + 86_400_000); tomorrow.setHours(9, 0, 0, 0);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  render(view, html`${TABS()}${whoBanner()}
    <h1>Lab tests</h1><p class="muted">Book at a verified lab or get the sample taken at home. Results go straight into your record.</p>
    ${bookings.length ? html`<div class="card"><h2>My bookings</h2><ul class="list">${bookings.map((b) => html`<li>
      <div class="row between"><b>${b.tests.map((x) => x.name).join(', ')}</b>${statusTag(b.status)}</div>
      <div class="small">${b.lab_name} · ${when(b.slot_at)}${b.home_collection ? ' · 🏠 home collection' : ''} · <b>${pkr(b.total)}</b></div>
      ${['booked', 'confirmed'].includes(b.status) ? html`<button class="btn btn-sm" data-action="cancel" data-id="${b.id}">Cancel</button>` : ''}</li>`)}</ul></div>` : ''}
    ${verified.length ? more('+ Book a test', html`<form id="f">
      <div class="field"><label>Tests</label><div class="test-pick">${tests.map((x) => html`<label class="check"><input type="checkbox" name="t${x.id}" data-price="${x.price}"> <span>${x.name} <span class="muted small">${pkr(x.price)}${x.fasting ? ' · fasting' : ''}</span></span></label>`)}</div></div>
      <div class="form-grid">
        <div class="field"><label for="lab">Lab</label><select id="lab" name="facility_id">${verified.map((l) => html`<option value="${l.id}">${l.name} — ${l.city}</option>`)}</select></div>
        <div class="field"><label for="slot">When</label><input id="slot" name="slot_at" type="datetime-local" value="${local}" required></div>
      </div>
      <label class="check"><input type="checkbox" name="home_collection" id="hc"> Take the sample at my home (+ Rs 300)</label>
      <div class="field" id="addrf" hidden><label for="addr">Address</label><input id="addr" name="address" placeholder="House, street, area"></div>
      <div class="notice" id="tot">Choose tests</div>
      <button class="btn btn-primary" type="submit">Book</button></form>`, { open: !bookings.length })
    : html`<div class="notice">No verified lab in your city yet. <a href="#/map?type=lab">See labs on the map</a>.</div>`}`);
  const form = view.querySelector('#f');
  if (form) {
    const total = () => {
      const sel = [...form.querySelectorAll('input[data-price]:checked')];
      const sum = sel.reduce((s, x) => s + Number(x.dataset.price), 0) + (form.home_collection.checked ? 300 : 0);
      view.querySelector('#tot').textContent = sel.length ? `${sel.length} test${sel.length > 1 ? 's' : ''} · total Rs ${sum.toLocaleString('en-PK')}` : 'Choose tests';
      view.querySelector('#addrf').hidden = !form.home_collection.checked;
    };
    form.addEventListener('change', total);
    onSubmit(form, async (d) => {
      const test_ids = Object.keys(d).filter((k) => /^t\d+$/.test(k) && d[k]).map((k) => Number(k.slice(1)));
      const r = await api('/care/lab-bookings', { method: 'POST', body: { facility_id: Number(d.facility_id), test_ids, home_collection: !!d.home_collection, address: d.address, slot_at: new Date(d.slot_at).toISOString() } });
      toast(`Booked at ${r.lab}${r.fasting ? ' — don’t eat for 8–10 hours before' : ''}`); labs(view);
    });
  }
  actions(view, {
    me: () => { setActAs(null); go(location.hash); },
    cancel: async ({ id }) => { await api(`/care/lab-bookings/${id}/status`, { method: 'POST', body: { status: 'cancelled' } }); toast('Cancelled'); labs(view); },
  });
}

// ───────── Appointments ─────────
async function appointments(view) {
  const [mine, facilities, doctors] = await Promise.all([api('/care/appointments'), api('/facilities?verified=1&limit=200'), api('/auth/doctors')]);
  const femaleOnly = !!state.user?.pref_female_doctor;
  const docs = femaleOnly ? doctors.filter((d) => d.gender === 'female') : doctors;
  render(view, html`${TABS()}${whoBanner()}
    <h1>Appointments</h1><p class="muted">Ask a hospital, clinic or doctor to call you back with a time.</p>
    ${mine.length ? html`<div class="card"><ul class="list">${mine.map((a) => html`<li>
      <div class="row between"><b>${a.facility_name || `Dr. ${a.doctor_name}`}</b>${statusTag(a.status === 'requested' ? 'pending' : a.status)}</div>
      <div class="small">${a.reason}${a.female_only ? ' · female doctor' : ''}</div>${a.note ? html`<div class="small"><b>${a.note}</b></div>` : ''}
      <div class="tiny muted">${when(a.created_at)}</div>
      ${a.status === 'requested' ? html`<button class="btn btn-sm" data-action="cancel" data-id="${a.id}">Cancel</button>` : ''}</li>`)}</ul></div>` : ''}
    ${more('+ Request a call back', html`<form id="f">
      <div class="field"><label for="w">With</label><select id="w" name="target" required>
        <optgroup label="Doctors">${docs.map((d) => html`<option value="d${d.id}">Dr. ${d.name} — ${d.city || ''}${d.gender === 'female' ? ' (female)' : ''}</option>`)}</optgroup>
        <optgroup label="Hospitals & clinics">${facilities.filter((f) => ['hospital', 'clinic', 'bhu', 'rhc'].includes(f.type)).map((f) => html`<option value="f${f.id}">${f.name} — ${f.city}</option>`)}</optgroup></select></div>
      <div class="field"><label for="r">What is it about?</label><textarea id="r" name="reason" required minlength="5" placeholder="e.g. Sugar check-up, child has fever for 3 days"></textarea></div>
      <div class="form-grid"><div class="field"><label for="pt">Best time to call</label><select id="pt" name="preferred_time"><option>Morning</option><option>Afternoon</option><option>Evening</option></select></div></div>
      <label class="check"><input type="checkbox" name="female_only" ${femaleOnly ? raw('checked') : ''}> Female doctor only</label><p></p>
      <button class="btn btn-primary" type="submit">Send request</button></form>`, { open: !mine.length })}`);
  import('../tools.js').then((m) => m.voiceInput(view, '#r'));
  onSubmit(view.querySelector('#f'), async (d) => {
    const id = Number(d.target.slice(1));
    await api('/care/appointments', { method: 'POST', body: { [d.target[0] === 'd' ? 'doctor_id' : 'facility_id']: id, reason: d.reason, preferred_time: d.preferred_time, female_only: !!d.female_only } });
    toast('Request sent — they will call you'); appointments(view);
  });
  actions(view, {
    me: () => { setActAs(null); go(location.hash); },
    cancel: async ({ id }) => { await api(`/care/appointments/${id}/status`, { method: 'POST', body: { status: 'cancelled' } }); toast('Cancelled'); appointments(view); },
  });
}

// ───────── Family ─────────
async function family(view) {
  const { self, members } = await api('/care/family');
  render(view, html`${TABS()}
    <h1>Family</h1><p class="muted">Manage records, medicines and appointments for your children and parents from one phone.</p>
    <div class="grid">
      <div class="card ${!state.actAs ? 'selected' : ''}"><b>👤 ${self.name}</b><div class="small muted">You</div>
        ${state.actAs ? html`<div class="actions"><button class="btn btn-sm btn-primary" data-action="switch" data-id="">Switch to me</button></div>` : html`<div class="actions">${tag('Active', 'ok')}</div>`}</div>
      ${members.map((m) => html`<div class="card ${state.actAs?.id === m.id ? 'selected' : ''}"><b>${m.relation === 'child' ? '🧒' : m.relation === 'parent' || m.relation === 'grandparent' ? '🧓' : '👤'} ${m.name}</b>
        <div class="small muted">${m.relation}${m.birth_year ? ` · ${new Date().getFullYear() - m.birth_year} yrs` : ''}${m.blood_group ? ` · ${m.blood_group}` : ''}</div>
        <div class="actions">${state.actAs?.id === m.id ? tag('Active', 'ok') : html`<button class="btn btn-sm btn-primary" data-action="switch" data-id="${m.id}" data-name="${m.name}">Manage</button>`}
          ${peek(html`<button class="btn btn-sm btn-danger" data-action="remove" data-id="${m.id}" data-name="${m.name}">Remove ${m.name}</button><p class="tiny muted">Deletes their records from Sehatyab.</p>`, 'More')}</div></div>`)}
    </div>
    ${more('+ Add a family member', html`<form id="f"><div class="form-grid">
      <div class="field"><label for="n">Name</label><input id="n" name="name" required></div>
      <div class="field"><label for="rel">Relation</label><select id="rel" name="relation"><option value="child">Child</option><option value="parent">Parent</option><option value="spouse">Spouse</option>
        <option value="grandparent">Grandparent</option><option value="sibling">Sibling</option><option value="other">Other</option></select></div>
      <div class="field"><label for="g">Gender</label><select id="g" name="gender"><option value="">—</option><option value="female">Female</option><option value="male">Male</option></select></div>
      <div class="field"><label for="by">Birth year</label><input id="by" name="birth_year" type="number" min="1900" max="${new Date().getFullYear()}"></div>
      <div class="field"><label for="bg">Blood group</label><select id="bg" name="blood_group"><option value="">—</option>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => html`<option>${b}</option>`)}</select></div>
    </div><button class="btn btn-primary" type="submit">Add</button></form>`, { open: !members.length })}`);
  onSubmit(view.querySelector('#f'), async (d) => { await api('/care/family', { method: 'POST', body: d }); toast('Added'); family(view); });
  actions(view, {
    switch: ({ id, name }) => { setActAs(id ? { id: Number(id), name } : null); toast(id ? `Now managing ${name}` : 'Back to you'); family(view); },
    remove: async ({ id, name }) => {
      if (!confirm(`Remove ${name} and delete their records?`)) return;
      await api(`/care/family/${id}`, { method: 'DELETE' });
      if (state.actAs?.id === Number(id)) setActAs(null);
      toast('Removed'); family(view);
    },
  });
}

// ───────── Emergency card ─────────
async function card(view) {
  let c = null;
  try { c = await api('/care/card'); } catch {
    try { c = JSON.parse(localStorage.getItem('sy.card')); } catch { /* none */ }
  }
  if (!c) return render(view, html`<div class="notice notice-warn">Could not load your card. You may be offline.</div>`);
  const saved = !state.actAs && prefs.get('cardOffline', false);
  if (saved) try { localStorage.setItem('sy.card', JSON.stringify(c)); } catch { /* storage full */ }
  render(view, html`<p><a href="#/care">← My care</a></p>
    ${cardHtml(c)}
    <div class="row no-print" style="margin-top:16px">
      <button class="btn" data-action="print">🖨 Print / save PDF</button><a class="btn" href="#/account">Edit contact & details</a>
    </div>
    ${!state.actAs ? html`<div class="card no-print" style="margin-top:16px"><label class="check"><input type="checkbox" id="off" ${saved ? raw('checked') : ''}>
      <span><b>Keep on this phone for emergencies</b><br><span class="small muted">Works offline and from the lock screen, so a paramedic can see it. Anyone holding the unlocked phone could see it too.</span></span></label></div>` : ''}`);
  view.querySelector('#off')?.addEventListener('change', (e) => {
    prefs.set('cardOffline', e.target.checked);
    try { if (e.target.checked) localStorage.setItem('sy.card', JSON.stringify(c)); else localStorage.removeItem('sy.card'); } catch { /* ignore */ }
    toast(e.target.checked ? 'Saved on this phone' : 'Removed from this phone');
  });
  actions(view, { print: () => window.print() });
}

// ───────── Printable prescription with QR ─────────
async function loadQr() {
  if (window.qrcode) return window.qrcode;
  await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = '/vendor/qrcode.js'; s.onload = ok; s.onerror = fail; document.head.append(s); });
  return window.qrcode;
}
async function rxPrint(view, id) {
  const rx = await api(`/pharmacy/prescriptions/${id}/print`);
  const url = `${location.origin}/#/rx-check/${rx.token}`;
  const qr = await loadQr();
  const q = qr(0, 'M'); q.addData(url); q.make();
  render(view, html`<p class="no-print"><a href="#/pharmacy/rx">← Prescriptions</a></p>
    <article class="card rx-sheet">
      <div class="row between"><div><b style="font-size:1.2rem">℞ ${rx.source === 'e-rx' ? 'e-Prescription' : 'Prescription (patient copy)'}</b><div class="small muted">#${rx.id} · ${when(rx.created_at)}</div></div>
        <div class="rx-qr" aria-label="QR code to verify this prescription">${raw(q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }))}</div></div>
      <table class="small" style="margin:12px 0"><tbody>
        <tr><th>Patient</th><td>${rx.patient_name}${rx.birth_year ? ` · ${new Date().getFullYear() - rx.birth_year} yrs` : ''}${rx.gender ? ` · ${rx.gender}` : ''}</td></tr>
        ${rx.doctor_name ? html`<tr><th>Doctor</th><td>Dr. ${rx.doctor_name} · PMDC ${rx.pmdc_no}</td></tr>` : ''}
      </tbody></table>
      <table><thead><tr><th>Medicine</th><th>Qty</th><th>How to take</th></tr></thead><tbody>
        ${rx.items.map((i) => html`<tr><td><b>${i.name}</b><div class="tiny muted">${i.generic || ''} ${i.strength || ''}</div></td><td>${i.qty}</td><td>${i.dosage || '—'}</td></tr>`)}</tbody></table>
      ${rx.notes ? html`<p class="small" style="margin-top:10px">Notes: ${rx.notes}</p>` : ''}
      <p class="tiny muted" style="margin-top:12px">Pharmacist: scan the QR code to confirm this prescription is genuine and has not already been dispensed.</p>
    </article>
    <div class="row no-print"><button class="btn btn-primary" data-action="print">🖨 Print / save PDF</button></div>`);
  actions(view, { print: () => window.print() });
}

async function rxCheck(view, token) {
  try {
    const r = await api(`/pharmacy/rx-verify/${encodeURIComponent(token || '')}`);
    const ok = r.doctor ? r.doctor.verified : true;
    render(view, html`<div class="card" style="max-width:640px">
      <div class="notice ${r.status === 'dispensed' ? 'notice-warn' : ok ? 'notice-ok' : 'notice-warn'}"><b>${r.status === 'dispensed' ? '⚠️ Already dispensed' : '✅ Genuine Sehatyab prescription'}</b>
        <br><span class="small">${r.status === 'dispensed' ? 'This prescription has already been filled. Do not dispense again.' : `Status: ${r.status}`}</span></div>
      <p class="small">#${r.id} · issued ${when(r.issued)} · patient <b>${r.patient_initials}</b></p>
      ${r.doctor ? html`<p class="small">Dr. ${r.doctor.name} · PMDC ${r.doctor.pmdc_no} ${r.doctor.verified ? tag('PMDC verified', 'ok') : tag('not verified', 'warn')}</p>` : html`<p class="small">${tag('Patient-uploaded', 'info')} — check the original paper.</p>`}
      <table><thead><tr><th>Medicine</th><th>Qty</th><th>Dosage</th></tr></thead><tbody>${r.items.map((i) => html`<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.dosage || '—'}</td></tr>`)}</tbody></table></div>`);
  } catch (e) {
    render(view, html`<div class="notice notice-danger"><b>Not a valid prescription code.</b><br>${e.message}. Do not dispense — ask for the original.</div>`);
  }
}
