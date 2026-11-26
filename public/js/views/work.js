// Staff workspaces: doctor, pharmacist, insurer, dispatcher, facility admin, programme officer, platform admin.
import { html, render, state, api, pkr, when, tag, tabs, onSubmit, actions, toast, needLogin, statusTag, loading, poll, esc, more, peek } from './_shared.js';
import { recordList } from './records.js';
import { ppp as pppView } from './support.js';
import { showRxPhotos } from './pharmacy.js';
import { makeMap, COLORS } from './_map.js';

export default function work({ view, parts }) {
  if (!state.user) return render(view, needLogin());
  const role = state.user.role;
  const area = parts[1];
  const allowed = { doctor: 'doctor', pharmacist: 'pharmacist', insurer: 'insurer', dispatch: 'dispatcher', facility: 'facility_admin', programs: 'program_admin', admin: 'admin' };
  if (allowed[area] !== role && role !== 'admin') return render(view, html`<div class="notice notice-warn">This workspace is for ${allowed[area] || 'staff'} accounts.</div>`);
  return ({ doctor, pharmacist, insurer, dispatch, facility, programs, admin }[area] || (() => render(view, html`<p>Unknown workspace</p>`)))(view, parts);
}

// ───────── Shared staff queues: appointment call-backs & lab bookings ─────────
async function appointmentQueue(box) {
  const rows = await api('/care/appointments/queue');
  const open = rows.filter((a) => ['requested', 'called'].includes(a.status));
  box.innerHTML = String(html`<div class="card"><h2>📅 Appointment requests ${open.length ? tag(`${open.length} open`, 'warn') : ''}</h2>
    <ul class="list">${open.length ? open.map((a) => html`<li>
      <div class="row between"><b>${a.patient_name}</b>${a.female_only ? tag('Female doctor requested', 'brand') : ''}</div>
      <div class="small">${a.reason}</div>
      <div class="small muted">Call ${a.patient_phone ? html`<a href="tel:${a.patient_phone}">${a.patient_phone}</a>` : '—'} · ${a.preferred_time || 'any time'} · ${when(a.created_at)}</div>
      <form class="row" data-appt="${a.id}" style="margin-top:6px"><input name="note" placeholder="e.g. Tue 10am, Dr. Sana" style="flex:1;min-width:160px" aria-label="Appointment details">
        <button class="btn btn-sm btn-primary" name="status" value="booked">Booked</button><button class="btn btn-sm" name="status" value="called">Called, no answer</button><button class="btn btn-sm" name="status" value="cancelled">Can’t help</button></form>
    </li>`) : html`<li class="muted">No open requests.</li>`}</ul>
    ${rows.length > open.length ? more('Handled', html`<ul class="list">${rows.filter((a) => !open.includes(a)).map((a) => html`<li class="row between"><span>${a.patient_name} · ${a.reason}</span>${statusTag(a.status === 'booked' ? 'approved' : a.status)}</li>`)}</ul>`) : ''}</div>`);
  box.querySelectorAll('form[data-appt]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/care/appointments/${f.dataset.appt}/status`, { method: 'POST', body: { status: e.submitter.value, note: f.note.value || undefined } }); toast('Updated; patient notified'); appointmentQueue(box); }
    catch (err) { toast(err.message, true); }
  }));
}
async function labQueue(box) {
  const rows = await api('/care/lab-bookings/facility');
  if (!rows.length) { box.innerHTML = ''; return; }
  const next = { booked: 'confirmed', confirmed: 'sample_collected', sample_collected: 'completed' };
  box.innerHTML = String(html`<div class="card"><h2>🧪 Lab bookings</h2><ul class="list">${rows.filter((b) => next[b.status]).map((b) => html`<li>
    <div class="row between"><b>${b.patient_name} · ${b.tests.map((x) => x.name).join(', ')}</b>${statusTag(b.status === 'booked' ? 'pending' : b.status)}</div>
    <div class="small muted">${when(b.slot_at)}${b.home_collection ? html` · 🏠 ${b.address}` : ''} · ${pkr(b.total)} · <a href="tel:${b.patient_phone}">${b.patient_phone}</a></div>
    ${b.status === 'sample_collected' ? html`<form data-results="${b.id}" style="margin-top:6px">${b.tests.map((x, i) => html`<div class="row"><span class="small" style="min-width:160px">${x.name}</span>
        <input name="v${i}" placeholder="Result" style="width:120px" aria-label="${x.name} result"><input name="u${i}" placeholder="Unit" style="width:90px" aria-label="Unit"></div>`)}
      <button class="btn btn-sm btn-primary" type="submit">Send results to patient’s record</button></form>`
      : html`<button class="btn btn-sm" data-lab="${b.id}" data-to="${next[b.status]}">Mark ${next[b.status].replace('_', ' ')}</button>`}
  </li>`)}</ul></div>`);
  box.querySelectorAll('[data-lab]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/care/lab-bookings/${b.dataset.lab}/status`, { method: 'POST', body: { status: b.dataset.to } }); labQueue(box); } catch (err) { toast(err.message, true); }
  }));
  box.querySelectorAll('form[data-results]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bk = rows.find((x) => String(x.id) === f.dataset.results);
    const results = bk.tests.map((x, i) => ({ name: x.name, value: f[`v${i}`].value, unit: f[`u${i}`].value || undefined })).filter((r) => r.value);
    try { await api(`/care/lab-bookings/${bk.id}/status`, { method: 'POST', body: { status: 'completed', results } }); toast('Results sent — patient notified'); labQueue(box); } catch (err) { toast(err.message, true); }
  }));
}

// ───────── Doctor ─────────
const rxLine = (i, products) => html`<div class="form-grid"><div class="field"><label for="f-p${i}">Medicine ${i + 1}</label><select id="f-p${i}" name="p${i}"><option value="">—</option>${products.filter((p) => p.schedule !== 'controlled').map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
  <div class="field"><label for="f-q${i}">Packs</label><input id="f-q${i}" name="q${i}" type="number" min="1" value="1"></div><div class="field"><label for="f-d${i}">Dosage</label><input id="f-d${i}" name="d${i}"></div></div>`;
async function doctor(view, parts) {
  if (parts[2] === 'p') return doctorPatient(view, Number(parts[3]));
  const [patients, rx, products] = await Promise.all([api('/records/consents'), api('/pharmacy/prescriptions'), api('/pharmacy/products')]);
  render(view, html`
    <div class="page-head"><div><h1>Dr. ${state.user.name}</h1><p class="muted">PMDC ${state.user.pmdc_no} ${state.user.verified ? tag('verified', 'ok') : tag('verification pending', 'warn')}</p></div></div>
    <div class="grid-2">
      <div class="card"><h2>Patients who gave me access</h2><ul class="list">${patients.length ? patients.map((c) => html`<li class="row between">
        <span><a href="#/work/doctor/p/${c.patient_id}">${c.patient_name}</a><br><span class="tiny muted">${c.purpose} · until ${when(c.expires_at)}</span></span>
        ${c.purpose.startsWith('EMERGENCY') ? tag('Emergency', 'danger') : tag('Consent', 'ok')}</li>`) : html`<li class="muted">No patients yet. Patients grant access from their Records tab.</li>`}</ul></div>
      <form class="card" id="erx"><h2>Write an e-prescription</h2>
        <div class="field"><label for="f-patient_phone">Patient mobile</label><input id="f-patient_phone" name="patient_phone" required placeholder="03001234567"></div>
        ${rxLine(0, products)}
        <details class="peek" style="margin-bottom:12px"><summary>More medicines & notes</summary><div class="peek-body">
          ${rxLine(1, products)}${rxLine(2, products)}
          <div class="field"><label for="f-notes">Notes</label><input id="f-notes" name="notes"></div></div></details>
        <button class="btn btn-primary" type="submit">Send to patient</button>
        <p class="tiny muted">The patient gets it in the app and can order it; the pharmacist still checks it before dispensing.</p></form>
    </div>
    <div id="appq"></div>
    ${more('Prescriptions I wrote', html`<ul class="list">${rx.map((r) => html`<li class="row between"><span>#${r.id} · ${r.patient_name}<br><span class="tiny muted">${r.items.map((i) => i.name).join(', ')} · ${when(r.created_at)}</span></span>${statusTag(r.status)}</li>`)}</ul>`, { hint: `${rx.length}` })}
    ${more('⚠️ Emergency access (break-glass)', html`<form id="bg">
        <p class="small">Only for a patient who cannot consent (e.g. unconscious). Gives 24-hour access. The patient is told immediately and every use is reviewed.</p>
        <div class="field"><label for="f-bg-patient_phone">Patient mobile</label><input id="f-bg-patient_phone" name="patient_phone" required></div>
        <div class="field"><label for="f-reason">Reason</label><textarea id="f-reason" name="reason" required minlength="20" placeholder="Describe the emergency"></textarea></div>
        <button class="btn btn-danger" type="submit">Open record</button></form>`, { hint: 'Logged & reviewed' })}`);
  appointmentQueue(view.querySelector('#appq')).catch(() => {});
  onSubmit(view.querySelector('#erx'), async (d) => {
    const items = [0, 1, 2].filter((i) => d[`p${i}`]).map((i) => ({ product_id: Number(d[`p${i}`]), qty: d[`q${i}`] || 1, dosage: d[`d${i}`] }));
    await api('/pharmacy/prescriptions', { method: 'POST', body: { patient_phone: d.patient_phone, items, notes: d.notes } });
    toast('e-Prescription sent'); doctor(view, []);
  });
  onSubmit(view.querySelector('#bg'), async (d) => {
    const r = await api('/records/break-glass', { method: 'POST', body: d });
    toast('Emergency access granted for 24 hours — this has been logged');
    location.hash = `#/work/doctor/p/${r.patient_id}`;
  });
}

async function doctorPatient(view, pid) {
  const r = await api(`/records/patient/${pid}`);
  render(view, html`<p><a href="#/work/doctor">← My patients</a></p>
    <div class="page-head"><div><h1>${r.patient.name}</h1><p class="muted">${r.patient.gender || ''} ${r.patient.birth_year ? `· born ${r.patient.birth_year}` : ''} ${r.patient.blood_group ? `· blood ${r.patient.blood_group}` : ''} · access: ${r.consent?.purpose}</p></div></div>
    <div class="grid-2"><div>${recordList(r.records)}</div>
      <form class="card" id="f"><h2>Add clinical entry</h2>
        <div class="field"><label for="f-type">Type</label><select id="f-type" name="type"><option value="visit">Visit note</option><option value="condition">Diagnosis</option><option value="lab">Lab result</option><option value="vitals">Vitals</option><option value="prescription">Medication</option><option value="allergy">Allergy</option></select></div>
        <div class="field"><label for="f-title">Title</label><input id="f-title" name="title" required></div>
        <div class="field"><label for="f-notes">Details / notes</label><textarea id="f-notes" name="notes"></textarea></div>
        <div class="field"><label for="f-icd10">ICD-10 (optional)</label><input id="f-icd10" name="icd10"></div>
        <button class="btn btn-primary" type="submit">Save to record</button></form></div>`);
  onSubmit(view.querySelector('#f'), async (d) => {
    await api('/records', { method: 'POST', body: { patient_id: pid, type: d.type, title: d.title, data: { notes: d.notes, reason: d.title, icd10: d.icd10, text: d.notes } } });
    toast('Saved; patient notified'); doctorPatient(view, pid);
  });
}

// ───────── Pharmacist ─────────
async function pharmacist(view) {
  const [orders, ds] = await Promise.all([api('/pharmacy/orders'), api('/pharmacy/desk-stats').catch(() => null)]);
  const groups = { awaiting_rx: 'Prescription check', placed: 'Ready to dispense', verified: 'Ready to dispense', dispatched: 'Out for delivery' };
  const active = orders.filter((o) => groups[o.status]);
  render(view, html`<h1>Pharmacy desk</h1>
    ${ds ? html`<div class="stats">
      <div class="stat"><div class="v">${ds.awaiting_rx}</div><div class="l">Prescriptions to check</div></div>
      <div class="stat"><div class="v">${ds.to_dispense}</div><div class="l">Ready to dispense</div></div>
      <div class="stat"><div class="v">${ds.avg_delivery_hours ?? '—'}${ds.avg_delivery_hours != null ? ' h' : ''}</div><div class="l">Avg. order → delivered (30 days)</div></div>
    </div>${ds.low_stock.length ? more('⚠️ Low stock', html`<ul class="list">${ds.low_stock.map((s) => html`<li class="row between"><span>${s.name}</span>${tag(`${s.stock} left`, s.stock === 0 ? 'danger' : 'warn')}</li>`)}</ul>`, { hint: `${ds.low_stock.length} items` }) : ''}` : ''}
    <p class="muted">Check prescriptions, scan each pack’s DRAP barcode when dispensing (this catches fakes and reused codes), and update delivery.</p>
    <div class="card"><ul class="list">${active.length ? active.map((o) => html`<li>
      <div class="row between"><b>#${o.id} · ${o.patient_name}</b>${statusTag(o.status)}</div>
      <div class="small">${o.items.map((i) => html`${i.name} × ${i.qty} ${i.schedule !== 'OTC' ? tag(i.schedule, 'warn') : ''} `)}</div>
      ${peek(html`<div class="small muted">${o.address}<br>${pkr(o.total)} (${o.payment_method})${o.subsidy_amount ? ` · support ${pkr(o.subsidy_amount)}` : ''}<br>${when(o.created_at)}</div>`)}
      <div id="o${o.id}"></div>
      <div class="row" style="margin-top:6px">
        ${o.status === 'awaiting_rx' ? html`<button class="btn btn-sm" data-action="rx" data-id="${o.id}">View prescription</button><button class="btn btn-sm btn-primary" data-action="approve" data-id="${o.id}">Approve</button><button class="btn btn-sm" data-action="reject" data-id="${o.id}">Reject</button>` : ''}
        ${['placed', 'verified'].includes(o.status) ? html`<button class="btn btn-sm btn-primary" data-action="dispense" data-id="${o.id}">Scan & dispense</button>` : ''}
        ${o.status === 'dispatched' ? html`<button class="btn btn-sm" data-action="delivered" data-id="${o.id}">Mark delivered</button>` : ''}
      </div></li>`) : html`<li class="muted">No open orders.</li>`}</ul></div>
    ${more('Completed orders', html`<ul class="list">${orders.filter((o) => !groups[o.status]).map((o) => html`<li class="row between"><span>#${o.id} · ${o.patient_name} · ${pkr(o.total)}</span>${statusTag(o.status)}</li>`)}</ul>`, { hint: `${orders.length - active.length}` })}`);
  const products = await api('/pharmacy/products');
  actions(view, {
    rx: async ({ id }) => {
      const rx = await api(`/pharmacy/orders/${id}/prescription`);
      view.querySelector(`#o${id}`).innerHTML = String(html`<div class="notice small"><b>${rx.source === 'e-rx' ? `e-Rx from Dr. ${rx.doctor_name} (PMDC ${rx.pmdc_no})` : 'Patient-uploaded prescription — collect the original paper on delivery'}</b><br>
        ${rx.items.map((i) => html`${products.find((p) => p.id === i.product_id)?.name || i.product_id} × ${i.qty} — ${i.dosage || ''}<br>`)}${rx.notes ? html`Notes: ${rx.notes}` : ''}
        ${rx.source !== 'e-rx' ? html`<div id="rxp${id}" style="margin-top:8px"><span class="tiny muted">Loading photo…</span></div>` : ''}</div>`);
      if (rx.source !== 'e-rx') showRxPhotos(view.querySelector(`#rxp${id}`), rx.id).catch((e) => { view.querySelector(`#rxp${id}`).textContent = e.message; });
    },
    approve: async ({ id }) => { await api(`/pharmacy/orders/${id}/review`, { method: 'POST', body: { decision: 'approve' } }); toast('Approved'); pharmacist(view); },
    reject: async ({ id }) => { const note = prompt('Reason for rejecting (sent to patient):'); if (!note) return; await api(`/pharmacy/orders/${id}/review`, { method: 'POST', body: { decision: 'reject', note } }); toast('Rejected'); pharmacist(view); },
    dispense: async ({ id }) => {
      const o = orders.find((x) => String(x.id) === id);
      const p = products.find((x) => x.id === o.items[0].product_id);
      const box = view.querySelector(`#o${id}`);
      box.innerHTML = String(html`<form class="notice" id="df${id}"><label for="f-codes">Scan pack codes (one per line)</label>
        <textarea id="f-codes" name="codes" placeholder="(01)GTIN(21)SERIAL"></textarea>
        <button class="btn btn-sm" type="button" data-scanto="${id}">📷 Scan a pack</button>
        <div class="tiny muted">Demo: <a href="#" data-fill="${id}" data-code="(01)${p.gtin}(21)SN${p.id}${String(Math.floor(Math.random() * 15) + 1).padStart(5, '0')}">fill a sample code</a> (only some demo products are serialised; leave empty to skip).</div>
        <button class="btn btn-sm btn-primary" type="submit">Confirm dispense</button></form>`);
      box.querySelector('[data-fill]').addEventListener('click', (e) => { e.preventDefault(); box.querySelector('textarea').value = e.target.dataset.code; });
      box.querySelector('[data-scanto]').addEventListener('click', async () => {
        try {
          const { scanCode } = await import('../tools.js');
          const code = await scanCode();
          if (code) { const ta = box.querySelector('textarea'); ta.value = `${ta.value.trim()}\n${code}`.trim(); toast('Pack added — scan the next one'); }
        } catch (err) { toast(err.message, true); }
      });
      onSubmit(box.querySelector('form'), async (d) => {
        await api(`/pharmacy/orders/${id}/dispense`, { method: 'POST', body: { codes: (d.codes || '').split('\n').map((s) => s.trim()).filter(Boolean) } });
        toast('Dispensed — out for delivery'); pharmacist(view);
      });
    },
    delivered: async ({ id }) => { await api(`/pharmacy/orders/${id}/status`, { method: 'POST', body: { status: 'delivered' } }); toast('Delivered'); pharmacist(view); },
  });
}

// ───────── Insurer ─────────
async function insurer(view) {
  const [a, claims] = await Promise.all([api('/insurance/analytics'), api('/insurance/claims')]);
  const review = claims.filter((c) => c.status === 'under_review');
  render(view, html`<h1>Claims desk</h1>
    <div class="stats">
      <div class="stat"><div class="v">${review.length}</div><div class="l">Waiting for review</div></div>
      <div class="stat"><div class="v">${a.avgDecisionMinutes != null ? (a.avgDecisionMinutes >= 120 ? `${Math.round(a.avgDecisionMinutes / 60)} h` : `${a.avgDecisionMinutes} min`) : '—'}</div><div class="l">Avg. time to decide</div></div>
      <div class="stat"><div class="v">${a.autoApprovedPct ?? '—'}${a.autoApprovedPct != null ? '%' : ''}</div><div class="l">Approved instantly</div></div>
      <div class="stat"><div class="v">${a.lossRatio ?? '—'}</div><div class="l">Loss ratio</div></div>
    </div>
    <div class="card"><h2>Review queue <span class="tiny muted">(highest risk first)</span></h2><ul class="list">${review.length ? review.map((c) => html`<li>
      <div class="row between"><b>#${c.id} · ${c.patient_name} · ${c.diagnosis} ${c.icd10 ? `(${c.icd10})` : ''}</b>${tag(`risk ${c.fraud_score}`, c.fraud_score >= 40 ? 'danger' : 'warn')}</div>
      <div class="small">${c.plan_name} · ${c.policy_no} · ${c.kind.replace('_', ' ')} · claimed <b>${pkr(c.amount)}</b>${c.facility_name ? ` · ${c.facility_name}` : ''}</div>
      ${peek(html`<ul class="small" style="margin:0;padding-inline-start:18px">${c.fraud_flags.map((f) => html`<li>${f.reason} <span class="muted">(+${f.points})</span></li>`)}</ul>`, `Why flagged (${c.fraud_flags.length})`)}<p></p>
      <form class="row" data-claim="${c.id}"><input name="approved_amount" type="number" value="${c.amount}" style="width:140px" aria-label="Approved amount"><input name="note" placeholder="Note to patient (required to reject)" style="flex:1;min-width:180px">
        <button class="btn btn-sm btn-primary" name="decision" value="approve">Approve</button><button class="btn btn-sm" name="decision" value="reject">Reject</button></form>
    </li>`) : html`<li class="muted">Queue is empty.</li>`}</ul></div>
    ${more('All claims', html`<div class="table-wrap"><table><thead><tr><th>#</th><th>Patient</th><th>Diagnosis</th><th class="right">Claimed</th><th>Status</th><th></th></tr></thead><tbody>
      ${claims.map((c) => html`<tr><td>${c.id}</td><td>${c.patient_name}</td><td>${c.diagnosis}</td><td class="right">${pkr(c.amount)}</td><td>${statusTag(c.status)}</td>
        <td>${['approved', 'auto_approved'].includes(c.status) ? html`<button class="btn btn-sm" data-action="pay" data-id="${c.id}">Pay</button>` : ''}</td></tr>`)}</tbody></table></div>`, { hint: `${claims.length}` })}
    ${more('Portfolio numbers', html`<div class="stats">
      <div class="stat"><div class="v">${a.activePolicies}</div><div class="l">Active policies</div></div>
      <div class="stat"><div class="v">${pkr(a.annualisedPremium)}</div><div class="l">Annualised premium</div></div>
      <div class="stat"><div class="v">${pkr(a.approvedOrPaid)}</div><div class="l">Approved / paid</div></div></div>
      ${Object.keys(a.flagCounts).length ? html`<h3>Why claims were flagged</h3><div class="row">${Object.entries(a.flagCounts).map(([k, v]) => tag(`${k.replace(/_/g, ' ')}: ${v}`, 'warn'))}</div>` : ''}`)}`);
  view.querySelectorAll('form[data-claim]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    try {
      await api(`/insurance/claims/${f.dataset.claim}/decide`, { method: 'POST', body: { decision: e.submitter.value, approved_amount: Number(d.approved_amount), note: d.note || undefined } });
      toast('Decision saved; patient notified'); insurer(view);
    } catch (err) { toast(err.message, true); }
  }));
  actions(view, { pay: async ({ id }) => { await api(`/insurance/claims/${id}/pay`, { method: 'POST' }); toast('Marked paid'); insurer(view); } });
}

// ───────── Dispatcher ─────────
async function dispatch(view) {
  render(view, html`<div class="page-head"><div><h1>Dispatch board</h1><p class="muted">All fleets — government, charity and private — on one board. Vehicle positions would come from GPS trackers; here a simulator moves them.</p></div>
    <label class="check"><input type="checkbox" id="auto"> Auto-simulate movement</label></div>
    <div id="stats"></div>
    <div class="grid-2"><div>${state.lowData ? '' : html`<div id="map" class="map"></div>`}</div><div id="active"></div></div>
    <div id="fleet"></div>`);
  let mapObj = null, layer = null;
  if (!state.lowData) { mapObj = await makeMap(view.querySelector('#map'), [27.5, 69.5], 5); layer = mapObj.L.layerGroup().addTo(mapObj.map); }
  let first = true;
  async function load() {
    const b = await api('/emergency/board');
    view.querySelector('#stats').innerHTML = String(html`<div class="stats"><div class="stat"><div class="v">${b.active.length}</div><div class="l">Active calls</div></div>
      <div class="stat"><div class="v">${b.fleet.filter((a) => a.status === 'available').length}/${b.fleet.length}</div><div class="l">Vehicles available</div></div>
      <div class="stat"><div class="v">${b.today.n}</div><div class="l">Calls today</div></div>
      <div class="stat"><div class="v">${b.today.avg_eta ? Math.round(b.today.avg_eta) + ' min' : '—'}</div><div class="l">Avg. dispatch ETA today</div></div>
      <div class="stat"><div class="v">${b.today.avg_response_7d != null ? b.today.avg_response_7d + ' min' : '—'}</div><div class="l">Actual response, 7 days</div></div></div>`);
    view.querySelector('#active').innerHTML = String(html`<div class="card"><h2>Active calls</h2><ul class="list">${b.active.length ? b.active.map((e) => html`<li>
      <div class="row between"><b>#${e.id} · severity ${e.severity}</b>${statusTag(e.status)}</div>
      <div class="small">${e.complaint || 'No details'} · ${e.ambulance?.provider_name || ''} ${e.ambulance?.call_sign || ''} → ${e.facility?.name || 'TBD'}</div>
      <div class="small muted">ETA ${e.live_eta_min != null ? Math.round(e.live_eta_min) + ' min' : '—'} · ${when(e.created_at)} · ${e.contact_phone}</div>
      <button class="btn btn-sm" data-action="advance" data-id="${e.id}">Next stage →</button></li>`) : html`<li class="muted">No active calls. Make a request from the Emergency tab to see dispatch in action.</li>`}</ul></div>`);
    const fleetOpen = view.querySelector('#fleet details')?.open; // survive the 4s refresh
    view.querySelector('#fleet').innerHTML = String(html`<details class="more" style="margin-top:16px" ${fleetOpen ? 'open' : ''}><summary><span>Fleet</span><span class="muted small">${b.fleet.length} vehicles</span></summary><div class="more-body table-wrap"><table><thead><tr><th>Vehicle</th><th>Provider</th><th>Type</th><th>Status</th></tr></thead><tbody>
      ${b.fleet.map((a) => html`<tr><td>${a.call_sign}</td><td>${a.provider_name}</td><td>${a.type}</td><td>${tag(a.status, a.status === 'available' ? 'ok' : 'warn')}</td></tr>`)}</tbody></table></div></details>`);
    if (mapObj) {
      const { L, map } = mapObj; layer.clearLayers();
      for (const a of b.fleet) L.circleMarker([a.lat, a.lng], { radius: a.type === 'bike' ? 5 : 7, color: '#fff', weight: 1, fillColor: a.status === 'available' ? '#16a34a' : COLORS.ambulance, fillOpacity: 0.9 }).addTo(layer).bindTooltip(`${esc(a.call_sign)} (${esc(a.provider_name)})`);
      for (const e of b.active) {
        L.circleMarker([e.lat, e.lng], { radius: 9, color: '#fff', weight: 2, fillColor: COLORS.hospital, fillOpacity: 1 }).addTo(layer).bindTooltip(`Call #${e.id}`);
        if (e.ambulance) L.polyline([[e.ambulance.lat, e.ambulance.lng], [e.lat, e.lng]], { color: COLORS.ambulance, dashArray: '4 6' }).addTo(layer);
      }
      if (first && b.active.length) { map.fitBounds(b.active.map((e) => [e.lat, e.lng]), { maxZoom: 12, padding: [40, 40] }); first = false; }
    }
  }
  await load();
  actions(view, { advance: async ({ id }) => { await api(`/emergency/${id}/advance`, { method: 'POST' }); load(); } });
  const auto = view.querySelector('#auto');
  const stop = poll(async () => { if (auto.checked) await api('/emergency/simulate-tick', { method: 'POST' }); await load(); }, 4000);
  return () => { stop(); mapObj?.map.remove(); };
}

// ───────── Facility admin ─────────
async function facility(view) {
  const fid = state.user.org_id;
  const [f, notes, contracts] = await Promise.all([api(`/facilities/${fid}`), api(`/facilities/${fid}/notifications`), api('/support/ppp')]);
  const mine = contracts.filter((c) => c.facility_id === fid);
  render(view, html`<h1>${f.name}</h1>
    <div id="appq"></div><div id="labq"></div>
    <div class="grid-2">
      <div class="card"><h2>Incoming alerts</h2><p class="small muted">Ambulance pre-alerts, cashless approvals and power alerts.</p>
        <ul class="list">${notes.length ? notes.map((n) => html`<li><div>${n.kind === 'pre_alert' ? '🚑 ' : n.kind === 'energy' ? '⚡ ' : '📄 '}${n.message}</div><div class="tiny muted">${when(n.created_at)}</div></li>`) : html`<li class="muted">None.</li>`}</ul></div>
      <div>
        <form class="card" id="beds"><h2>Bed availability</h2><p class="small muted">Ambulances are routed only to hospitals with free beds. Keep this current.</p>
          <div class="row"><input name="beds_free" type="number" min="0" max="${f.beds_total}" value="${f.beds_free}" style="width:120px"> <span>of ${f.beds_total}</span><button class="btn btn-primary" type="submit">Update</button></div></form>
        <form class="card" id="en"><h2>Report power status</h2>
          <div class="form-grid">
            <label class="check"><input type="checkbox" name="grid_on" checked> Grid electricity on</label>
            <label class="check"><input type="checkbox" name="generator_on"> Generator running</label>
            <div class="field"><label for="f-battery_pct">Battery %</label><input id="f-battery_pct" name="battery_pct" type="number" min="0" max="100"></div>
            <div class="field"><label for="f-fridge_temp_c">Vaccine fridge °C</label><input id="f-fridge_temp_c" name="fridge_temp_c" type="number" step="0.1"></div>
          </div><button class="btn" type="submit">Submit reading</button></form>
      </div>
    </div>
    ${mine.length ? more('Monthly PPP performance report', html`<form id="ppp">
      <div class="field"><label for="f-period">Period</label><input id="f-period" name="period" type="month" required></div>
      <div class="form-grid">${Object.entries(mine[0].kpi_targets).map(([k, t0]) => html`<div class="field"><label for="f-${k}">${t0.label || k} <span class="hint">(target ${t0.lower ? '≤' : ''}${t0.target})</span></label><input id="f-${k}" name="${k}" type="number" step="any"></div>`)}</div>
      <button class="btn btn-primary" type="submit">Submit report</button></form>`, { hint: 'Due monthly' }) : ''}`);
  appointmentQueue(view.querySelector('#appq')).catch(() => {});
  labQueue(view.querySelector('#labq')).catch(() => {});
  onSubmit(view.querySelector('#beds'), async (d) => { await api(`/facilities/${fid}/beds`, { method: 'PATCH', body: d }); toast('Updated'); });
  onSubmit(view.querySelector('#en'), async (d) => {
    const r = await api('/energy/readings', { method: 'POST', body: { facility_id: fid, ...d } });
    toast(`Recorded — status: ${r.assessment.level}${r.assessment.alerts.length ? ` (${r.assessment.alerts.join('; ')})` : ''}`, r.assessment.level === 'critical');
  });
  onSubmit(view.querySelector('#ppp'), async (d) => {
    const { period, ...metrics } = d;
    const r = await api(`/support/ppp/${mine[0].id}/report`, { method: 'POST', body: { period, metrics } });
    toast(`Report saved — score ${r.score}`);
  });
}

// ───────── Programme officer ─────────
async function programs(view) {
  render(view, html`<div id="new"></div><div id="ppp"></div>`);
  const nb = view.querySelector('#new');
  nb.innerHTML = String(html`<details class="more" style="margin-bottom:16px"><summary><span>+ Create a support programme</span><span class="muted small">Zakat, CSR, donor, PPP</span></summary>
    <div class="more-body"><form id="f"><div class="form-grid">
      <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" required></div>
      <div class="field"><label for="f-sponsor">Sponsor</label><input id="f-sponsor" name="sponsor" required></div>
      <div class="field"><label for="f-type">Type</label><select id="f-type" name="type"><option value="csr">CSR</option><option value="zakat">Zakat</option><option value="donor">Donor</option><option value="ppp">PPP</option><option value="govt">Government</option></select></div>
      <div class="field"><label for="f-max_pmt_score">Max poverty score (NSER PMT)</label><input id="f-max_pmt_score" name="max_pmt_score" type="number" step="any" placeholder="blank = everyone"></div>
      <div class="field"><label for="f-per_person_annual_cap">Annual cap per person (Rs)</label><input id="f-per_person_annual_cap" name="per_person_annual_cap" type="number"></div>
      <div class="field"><label for="f-copay_pct">Patient co-pay %</label><input id="f-copay_pct" name="copay_pct" type="number" min="0" max="100" value="0"></div>
      <div class="field"><label for="f-fund_balance">Opening fund (Rs)</label><input id="f-fund_balance" name="fund_balance" type="number"></div>
    </div>
    <div class="field"><label>Covers</label><div class="row">${['medicines', 'opd', 'inpatient', 'ambulance', 'diagnostics'].map((c) => html`<label class="check"><input type="checkbox" name="cov_${c}"> ${c}</label>`)}</div></div>
    <div class="field"><label for="f-description">Description</label><textarea id="f-description" name="description"></textarea></div>
    <button class="btn btn-primary" type="submit">Create</button></form></div></details>`);
  onSubmit(nb.querySelector('#f'), async (d) => {
    const covers = Object.keys(d).filter((k) => k.startsWith('cov_') && d[k]).map((k) => k.slice(4));
    for (const k of Object.keys(d)) if (k.startsWith('cov_')) delete d[k];
    await api('/support/programs', { method: 'POST', body: { ...d, covers } });
    toast('Programme created — patients can now be matched to it');
  });
  await pppView(view.querySelector('#ppp'), false);
}

// ───────── Platform admin ─────────
async function admin(view, parts) {
  const sub = parts[2] || 'overview';
  const T = tabs([['#/work/admin', 'Overview'], ['#/work/admin/verify', 'Verification'], ['#/work/admin/moderation', 'Moderation'], ['#/work/admin/audit', 'Audit log'], ['#/work/admin/privacy', 'Privacy & breaches'], ['#/work/admin/staff', 'Staff']], location.hash.split('?')[0].replace(/\/overview$/, '') || '#/work/admin');
  render(view, html`${T}${loading()}`);
  const box = (c) => render(view, html`${T}${c}`);

  if (sub === 'overview') {
    const s = await api('/admin/stats');
    box(html`<div class="stats">${[['Facilities', s.facilities], ['Active camps', s.camps_active], ['Orders', s.orders], ['Claims to review', s.claims_review], ['Active emergencies', s.emergencies_active],
      ['Health records', s.records], ['Flagged posts', s.flagged_posts], ['Open privacy requests', s.open_data_requests], ['Break-glass uses (30d)', s.break_glass_30d]].map(([l, v]) => html`<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`)}</div>
      <div class="card"><h2>Users by role</h2>${s.users.map((u) => html`<div class="row between small"><span>${u.role}</span><b>${u.n}</b></div>`)}</div>`);
  } else if (sub === 'verify') {
    const v = await api('/admin/verifications');
    const row = (kind, id, title, sub2) => html`<li class="row between"><span><b>${title}</b><br><span class="tiny muted">${sub2}</span></span><span class="row"><button class="btn btn-sm btn-primary" data-action="ok" data-kind="${kind}" data-id="${id}">Approve</button><button class="btn btn-sm" data-action="no" data-kind="${kind}" data-id="${id}">Reject</button></span></li>`;
    box(html`<p class="muted">Check each against the official register before approving: PMDC for doctors, Pharmacy Council for pharmacists, provincial drug sale licence for pharmacies, provincial healthcare commission for facilities.</p>
      <div class="grid-2">
        <div class="card"><h3>Doctors (PMDC)</h3><ul class="list">${v.doctors.map((d) => row('user', d.id, d.name, `PMDC ${d.pmdc_no} · ${d.city}`))}</ul></div>
        <div class="card"><h3>Pharmacies</h3><ul class="list">${v.pharmacies.map((p) => row('pharmacy', p.id, p.name, `${p.license_type} · licence ${p.license_no}`))}</ul></div>
        <div class="card"><h3>Facilities & camps</h3><ul class="list">${v.facilities.map((f) => row('facility', f.id, f.name, `${f.type} · ${f.city} · ${f.organizer || f.license_no || ''}`))}</ul></div>
        <div class="card"><h3>Pharmacists</h3><ul class="list">${v.pharmacists.map((p) => row('user', p.id, p.name, `licence ${p.license_no}`))}</ul></div>
      </div>`);
    actions(view, {
      ok: async ({ kind, id }) => { await api(`/admin/verify/${kind}/${id}`, { method: 'POST', body: { approve: true } }); toast('Approved'); admin(view, parts); },
      no: async ({ kind, id }) => { await api(`/admin/verify/${kind}/${id}`, { method: 'POST', body: { approve: false } }); toast('Rejected'); admin(view, parts); },
    });
  } else if (sub === 'moderation') {
    const m = await api('/community/moderation');
    box(html`<div class="card"><h2>Held posts</h2><ul class="list">${m.posts.length ? m.posts.map((p) => html`<li><b>${p.title}</b> <span class="tiny muted">by ${p.author_name} · ${p.flags} reports</span><div class="small">${p.body}</div>
      <div class="row"><button class="btn btn-sm" data-action="pub" data-kind="post" data-id="${p.id}">Publish</button><button class="btn btn-sm btn-danger" data-action="rm" data-kind="post" data-id="${p.id}">Remove</button></div></li>`) : html`<li class="muted">Nothing held.</li>`}</ul></div>
      <div class="card"><h2>Held replies</h2><ul class="list">${m.replies.map((r) => html`<li><div class="small">${r.body}</div><span class="tiny muted">by ${r.author_name}</span>
      <div class="row"><button class="btn btn-sm" data-action="pub" data-kind="reply" data-id="${r.id}">Publish</button><button class="btn btn-sm btn-danger" data-action="rm" data-kind="reply" data-id="${r.id}">Remove</button></div></li>`)}</ul></div>`);
    actions(view, {
      pub: async ({ kind, id }) => { await api(`/community/moderation/${kind}/${id}`, { method: 'POST', body: { action: 'publish' } }); admin(view, parts); },
      rm: async ({ kind, id }) => { await api(`/community/moderation/${kind}/${id}`, { method: 'POST', body: { action: 'remove' } }); admin(view, parts); },
    });
  } else if (sub === 'audit') {
    const a = await api('/admin/audit');
    box(html`<div class="notice ${a.chain_broken_at ? 'notice-danger' : 'notice-ok'}">${a.chain_broken_at ? `⚠️ Audit chain broken at entry #${a.chain_broken_at} — possible tampering` : '✅ Audit log hash chain intact'}</div>
      <div class="card table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Patient</th><th>Detail</th></tr></thead><tbody>
      ${a.entries.map((e) => html`<tr><td class="nowrap small">${when(e.ts)}</td><td class="small">${e.actor_name || '—'} <span class="muted">${e.actor_role || ''}</span></td><td class="small">${e.action.includes('break_glass') ? tag(e.action, 'danger') : e.action}</td><td class="small">${e.patient_id || ''}</td><td class="tiny">${e.detail || ''}</td></tr>`)}</tbody></table></div>`);
  } else if (sub === 'privacy') {
    const [reqs, breaches] = await Promise.all([api('/admin/data-requests'), api('/privacy/breaches')]);
    box(html`<div class="grid-2">
      <div class="card"><h2>Data-subject requests</h2><ul class="list">${reqs.map((r) => html`<li><div class="row between"><b>${r.kind} · ${r.name}</b>${statusTag(r.status === 'open' ? 'pending' : 'closed')}</div>
        <div class="small">${r.detail || ''}</div><div class="tiny muted">${when(r.created_at)}</div>
        ${r.status === 'open' ? html`<button class="btn btn-sm ${r.kind === 'delete' ? 'btn-danger' : ''}" data-action="close" data-id="${r.id}">${r.kind === 'delete' ? 'Delete & anonymise account' : 'Mark done'}</button>` : ''}</li>`)}</ul></div>
      <div class="card"><h2>Breach register</h2>
        <form id="bf"><div class="field"><label for="f-description">What happened</label><textarea id="f-description" name="description" required></textarea></div>
          <div class="form-grid"><div class="field"><label for="f-affected_count">People affected</label><input id="f-affected_count" name="affected_count" type="number"></div>
          <div class="field"><label for="f-severity">Severity</label><select id="f-severity" name="severity"><option>low</option><option selected>medium</option><option>high</option><option>critical</option></select></div></div>
          <button class="btn" type="submit">Record breach (starts 72-hour clock)</button></form>
        <ul class="list">${breaches.map((b) => html`<li><div class="row between"><b>#${b.id} · ${b.severity}</b>${b.hours_left != null ? tag(`${b.hours_left}h left to notify`, b.hours_left < 24 ? 'danger' : 'warn') : tag('regulator notified', 'ok')}</div>
          <div class="small">${b.description}</div><div class="tiny muted">${when(b.detected_at)} · ${b.affected_count} affected</div>
          <div class="row">${!b.notified_regulator_at ? html`<button class="btn btn-sm" data-action="notify" data-id="${b.id}" data-target="regulator">Regulator notified</button>` : ''}${!b.notified_subjects_at ? html`<button class="btn btn-sm" data-action="notify" data-id="${b.id}" data-target="subjects">Patients notified</button>` : ''}</div></li>`)}</ul></div></div>`);
    onSubmit(view.querySelector('#bf'), async (d) => { await api('/privacy/breaches', { method: 'POST', body: d }); toast('Breach recorded'); admin(view, parts); });
    actions(view, {
      close: async ({ id }) => { if (!confirm('Proceed?')) return; await api(`/admin/data-requests/${id}/close`, { method: 'POST' }); toast('Done'); admin(view, parts); },
      notify: async ({ id, target }) => { await api(`/privacy/breaches/${id}/notify`, { method: 'POST', body: { target } }); admin(view, parts); },
    });
  } else if (sub === 'staff') {
    box(html`<form class="card" id="sf" style="max-width:640px"><h2>Create staff account</h2>
      <div class="form-grid">
        <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" required></div><div class="field"><label for="f-phone">Mobile</label><input id="f-phone" name="phone" required></div>
        <div class="field"><label for="f-password">Temporary password (12+)</label><input id="f-password" name="password" minlength="12" required></div>
        <div class="field"><label for="f-role">Role</label><select id="f-role" name="role">${['doctor', 'pharmacist', 'insurer', 'dispatcher', 'facility_admin', 'program_admin', 'admin'].map((r) => html`<option>${r}</option>`)}</select></div>
        <div class="field"><label for="f-org_id">Organisation ID <span class="hint">(pharmacy / insurer / facility)</span></label><input id="f-org_id" name="org_id" type="number"></div>
        <div class="field"><label for="f-pmdc_no">PMDC no. (doctors)</label><input id="f-pmdc_no" name="pmdc_no"></div>
        <div class="field"><label for="f-license_no">Licence no. (pharmacists)</label><input id="f-license_no" name="license_no"></div>
        <div class="field"><label for="f-city">City</label><input id="f-city" name="city"></div>
      </div><button class="btn btn-primary" type="submit">Create</button></form>`);
    onSubmit(view.querySelector('#sf'), async (d) => { const u = await api('/admin/staff', { method: 'POST', body: d }); toast(`Created ${u.name} (${u.role})`); });
  }
}
