import { html, render, state, api, t, when, dateOnly, tag, tabs, onSubmit, actions, toast, needLogin, loading, more, peek } from './_shared.js';

const TABS = () => tabs([['#/records', 'My record'], ['#/records/add', 'Add entry'], ['#/records/consent', 'Sharing & consent'], ['#/records/log', 'Who saw my data'], ['#/records/shared', 'Open a shared record']], location.hash.split('?')[0] || '#/records');
const ICON = { visit: '🩺', lab: '🧪', prescription: '💊', allergy: '⚠️', immunization: '💉', vitals: '❤️', condition: '📌', note: '📝' };
const TYPES = [['vitals', 'Vitals (BP, sugar, weight)'], ['lab', 'Lab result'], ['allergy', 'Allergy'], ['condition', 'Condition'], ['immunization', 'Vaccination'], ['prescription', 'Medicine I take'], ['note', 'Note']];

export default function records({ view, parts }) {
  if (parts[1] === 'shared') return shared(view);
  if (!state.user) return render(view, html`${TABS()}${needLogin('Sign in to see your health record.')}`);
  if (parts[1] === 'add') return add(view);
  if (parts[1] === 'consent') return consent(view);
  if (parts[1] === 'log') return log(view);
  return mine(view);
}

function details(r) {
  const d = r.data || {};
  switch (r.type) {
    case 'vitals': return [d.systolic && `BP ${d.systolic}/${d.diastolic}`, d.pulse && `pulse ${d.pulse}`, d.sugar && `sugar ${d.sugar} mg/dL`, d.weight && `${d.weight} kg`].filter(Boolean).join(' · ');
    case 'lab': return `${d.value ?? ''} ${d.unit ?? ''}${d.reference ? ` (ref: ${d.reference})` : ''}`;
    case 'allergy': return `${d.substance || ''}${d.reaction ? ` — ${d.reaction}` : ''}${d.severity ? ` (${d.severity})` : ''}`;
    case 'condition': return `${d.icd10 ? `ICD-10 ${d.icd10} · ` : ''}${d.since ? `since ${d.since}` : ''} ${d.notes || ''}`;
    case 'prescription': return `${d.dosage || ''}${d.duration ? ` · ${d.duration}` : ''}`;
    case 'immunization': return `${d.vaccine || ''} ${d.dose || ''}`;
    case 'visit': return d.notes || d.reason || '';
    default: return d.text || '';
  }
}

export function recordList(recs, { canDelete = false } = {}) {
  const allergies = recs.filter((r) => r.type === 'allergy');
  const conditions = recs.filter((r) => r.type === 'condition');
  return html`
    ${allergies.length ? html`<div class="notice notice-danger"><b>Allergies:</b> ${allergies.map((a) => a.data.substance || a.title).join(', ')}</div>` : ''}
    ${conditions.length ? html`<div class="notice"><b>Conditions:</b> ${conditions.map((c) => c.title).join(', ')}</div>` : ''}
    <div class="card"><ul class="list">${recs.length ? recs.map((r) => html`<li>
      <div class="row between"><b>${ICON[r.type] || '•'} ${r.title}</b><span class="tiny muted">${dateOnly(r.recorded_at.slice(0, 10))}</span></div>
      <div class="small">${details(r)}</div>
      ${peek(html`<div class="tiny muted">${r.self_reported ? 'Added by me (self-reported)' : `By ${r.author_role === 'doctor' ? 'Dr. ' : ''}${r.author_name}`}${r.facility_name ? ` · ${r.facility_name}` : ''}
        ${canDelete && r.self_reported ? html` · <a href="#" data-action="del" data-id="${r.id}">delete</a>` : ''}</div>`, 'Source')}
    </li>`) : html`<li class="muted">No entries yet.</li>`}</ul></div>`;
}

async function mine(view) {
  render(view, html`${TABS()}${loading()}`);
  const { patient, records: recs } = await api('/records/mine');
  render(view, html`${TABS()}
    <div class="page-head"><div><h1>${t('my_records')}</h1><p class="muted">🔒 ${patient.name}${patient.blood_group ? ` · blood ${patient.blood_group}` : ''} · only you and people you allow</p></div>
      <div class="row"><button class="btn" data-action="export" title="Download (FHIR)">⬇ Download</button><button class="btn btn-primary" data-action="share">Share with a doctor</button></div></div>
    <div id="sharebox"></div>
    ${recordList(recs, { canDelete: true })}`);
  actions(view, {
    del: async ({ id }) => { if (!confirm('Delete this entry?')) return; await api(`/records/${id}`, { method: 'DELETE' }); toast('Deleted'); mine(view); },
    export: async () => {
      const bundle = await api('/records/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'my-health-record.fhir.json' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Downloaded');
    },
    share: async () => {
      const r = await api('/records/share', { method: 'POST', body: { hours: 24 } });
      view.querySelector('#sharebox').innerHTML = String(html`<div class="card"><h3>Share code</h3>
        <p class="small">Show this to any doctor. They open <b>Records → Open a shared record</b> and enter it. Valid until ${when(r.expires_at)}. Private notes are not shown. You’ll be notified when it’s used.</p>
        <div class="code">${r.code}</div></div>`);
    },
  });
}

function add(view) {
  render(view, html`${TABS()}
    <form class="card" id="f" style="max-width:640px"><h2>Add to my record</h2>
      <p class="small muted">Entries you add are marked “self-reported” so doctors know where they came from.</p>
      <div class="field"><label for="ty">Type</label><select id="ty" name="type">${TYPES.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      <div class="field"><label for="ti">Title</label><input id="ti" name="title" required placeholder="e.g. Blood pressure"></div>
      <div id="dyn"></div>
      <div class="field"><label for="dt">Date</label><input id="dt" name="recorded_at" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <button class="btn btn-primary" type="submit">${t('save')}</button>
    </form>`);
  const FIELDS = {
    vitals: [['systolic', 'Systolic (top)', 'number'], ['diastolic', 'Diastolic (bottom)', 'number'], ['pulse', 'Pulse', 'number'], ['sugar', 'Blood sugar (mg/dL)', 'number'], ['weight', 'Weight (kg)', 'number']],
    lab: [['value', 'Result'], ['unit', 'Unit'], ['reference', 'Normal range']],
    allergy: [['substance', 'Allergic to'], ['reaction', 'Reaction'], ['severity', 'Severity (mild/moderate/severe)']],
    condition: [['since', 'Since (year)'], ['notes', 'Notes']],
    immunization: [['vaccine', 'Vaccine'], ['dose', 'Dose']],
    prescription: [['medicine', 'Medicine'], ['dosage', 'How I take it'], ['duration', 'For how long']],
    note: [['text', 'Note']],
  };
  const sel = view.querySelector('#ty');
  const draw = () => { view.querySelector('#dyn').innerHTML = String(html`<div class="form-grid">${FIELDS[sel.value].map(([k, l, type]) => html`<div class="field"><label for="f-d_${k}">${l}</label><input id="f-d_${k}" name="d_${k}" type="${type || 'text'}" step="any"></div>`)}</div>`); };
  sel.addEventListener('change', draw); draw();
  onSubmit(view.querySelector('#f'), async (d) => {
    const data = {};
    for (const [k, v] of Object.entries(d)) if (k.startsWith('d_')) data[k.slice(2)] = v;
    await api('/records', { method: 'POST', body: { type: d.type, title: d.title, data, recorded_at: d.recorded_at } });
    toast('Saved to your record');
    location.hash = '#/records';
  });
}

async function consent(view) {
  const [rows, allDoctors] = await Promise.all([api('/records/consents'), api('/auth/doctors')]);
  // Female-doctor preference: women listed first.
  const doctors = state.user?.pref_female_doctor ? [...allDoctors].sort((a, b) => (b.gender === 'female') - (a.gender === 'female')) : allDoctors;
  const active = (c) => !c.revoked_at && (!c.expires_at || c.expires_at > new Date().toISOString());
  const giveForm = html`<form id="f">
        <p class="small muted">Access is time-limited and you can take it back any time. The doctor can read your record and add notes.</p>
        <div class="field"><label for="g">Doctor</label><select id="g" name="grantee_id" required>${doctors.map((d) => html`<option value="${d.id}">Dr. ${d.name} — ${d.city || ''} (PMDC ${d.pmdc_no})</option>`)}</select></div>
        <div class="field"><label for="p">Purpose</label><input id="p" name="purpose" required placeholder="e.g. Diabetes care"></div>
        <div class="field"><label for="dy">For how long</label><select id="dy" name="days"><option value="1">1 day</option><option value="7">1 week</option><option value="30" selected>1 month</option><option value="180">6 months</option><option value="365">1 year</option></select></div>
        <input type="hidden" name="scope" value="records">
        <button class="btn btn-primary" type="submit">Give access</button>
      </form>`;
  const now = rows.filter(active), past = rows.filter((c) => !active(c));
  const item = (c) => html`<li>
        <div class="row between"><b>${c.grantee_role === 'doctor' ? 'Dr. ' : ''}${c.grantee_name}</b>
          ${active(c) ? html`<button class="btn btn-sm" data-action="revoke" data-id="${c.id}">Revoke</button>` : tag(c.revoked_at ? 'Revoked' : 'Expired')}</div>
        <div class="small">${c.purpose?.startsWith('EMERGENCY') ? html`<b style="color:var(--danger)">${c.purpose}</b>` : c.purpose}</div>
        ${peek(html`<div class="tiny muted">Scope: ${c.scope}<br>Given ${when(c.created_at)}${c.expires_at ? html`<br>Until ${when(c.expires_at)}` : ''}</div>`)}</li>`;
  render(view, html`${TABS()}
    <div class="card"><h2>Who has access now</h2><ul class="list">${now.length ? now.map(item) : html`<li class="muted">Nobody has access.</li>`}</ul></div>
    ${more('+ Give a doctor access', giveForm)}
    ${past.length ? more('Past access', html`<ul class="list">${past.map(item)}</ul>`, { hint: `${past.length}` }) : ''}`);
  onSubmit(view.querySelector('#f'), async (d) => { await api('/records/consents', { method: 'POST', body: { ...d, grantee_id: Number(d.grantee_id), days: Number(d.days) } }); toast('Access given'); consent(view); });
  actions(view, { revoke: async ({ id }) => { await api(`/records/consents/${id}`, { method: 'DELETE' }); toast('Access revoked'); consent(view); } });
}

async function log(view) {
  const rows = await api('/records/access-log');
  const label = (a) => ({ 'records.view': 'Viewed your record', 'records.create': 'Added to your record', 'records.export': 'Downloaded your record', 'records.break_glass': '⚠️ Emergency access',
    'consent.grant': 'Access given', 'consent.revoke': 'Access revoked', 'rx.view': 'Pharmacist viewed prescription', 'rx.create': 'Prescription created', 'records.share_create': 'Share code created',
    'sehat.check': 'Sehat Card check', 'eligibility.check': 'Support eligibility check', 'claim.create': 'Claim filed', 'auth.login': 'Signed in' }[a] || a);
  const others = rows.filter((r) => r.actor_role && r.actor_role !== 'patient' || !r.actor_name);
  const row = (r) => html`<tr><td class="nowrap small">${when(r.ts)}</td><td>${r.actor_name || 'Someone with a share code'}${r.actor_role && r.actor_role !== 'patient' ? html` <span class="tag">${r.actor_role}</span>` : ''}</td>
      <td>${label(r.action)}${r.detail?.basis ? html` <span class="tiny muted">(${r.detail.basis})</span>` : ''}${r.detail?.reason ? html`<div class="small">Reason: ${r.detail.reason}</div>` : ''}</td></tr>`;
  const table = (list) => html`<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${list.map(row)}</tbody></table></div>`;
  render(view, html`${TABS()}<div class="card"><h2>Other people who saw my data</h2>
    <p class="small muted">Doctors, pharmacists and share-code users. If something looks wrong, revoke access and report it under Privacy.</p>
    ${others.length ? table(others) : html`<p class="muted">Nobody but you.</p>`}</div>
    ${more('Full activity log', table(rows), { hint: `${rows.length} entries · tamper-evident` })}`);
}

function shared(view) {
  render(view, html`${TABS()}
    <form class="card" id="f" style="max-width:520px"><h2>Open a shared record</h2>
      <p class="small muted">For doctors and clinics: enter the code the patient shows you.</p>
      <div class="field"><label for="c">Share code</label><input id="c" name="code" required placeholder="ABC-DEF-GHJ" autocomplete="off" style="text-transform:uppercase"></div>
      <button class="btn btn-primary" type="submit">Open</button></form><div id="out"></div>`);
  onSubmit(view.querySelector('#f'), async (d) => {
    const r = await api('/records/shared', { method: 'POST', body: d });
    view.querySelector('#out').innerHTML = String(html`<h2>${r.patient.name}</h2><p class="muted small">${r.patient.gender || ''} ${r.patient.birth_year ? `· born ${r.patient.birth_year}` : ''} ${r.patient.blood_group ? `· blood ${r.patient.blood_group}` : ''} · access ends ${when(r.expires_at)}</p>${recordList(r.records)}`);
  });
}
