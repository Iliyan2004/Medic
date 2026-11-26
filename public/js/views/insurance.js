import { html, render, state, api, pkr, when, tabs, onSubmit, actions, toast, go, needLogin, statusTag, tag, loading, dateOnly, more, peek } from './_shared.js';

const TABS = () => tabs([['#/insurance', 'Compare plans'], ['#/insurance/sehat', 'Sehat Card check'], ['#/insurance/policies', 'My policies'], ['#/insurance/claims', 'My claims']], location.hash.split('?')[0] || '#/insurance');
const KIND = { opd: 'OPD & medicines', hospital_cash: 'Hospital cash', family: 'Family inpatient', topup: 'Top-up', inpatient: 'Inpatient' };

export default function insurance({ view, parts, params }) {
  if (parts[1] === 'sehat') return sehat(view);
  if (parts[1] === 'policies') return policies(view);
  if (parts[1] === 'claims') return claims(view, params);
  return plans(view, params);
}

async function plans(view, params) {
  const model = params.get('model') || '';
  render(view, html`${TABS()}${loading()}`);
  const rows = await api(`/insurance/plans?model=${model}`);
  render(view, html`${TABS()}
    <div class="page-head"><div><h1>Health insurance</h1><p class="muted">Cover for what Sehat Card doesn’t pay.</p></div>
      <div class="row">${[['', 'All'], ['takaful', 'Takaful'], ['conventional', 'Conventional']].map(([v, l]) => html`<a class="btn btn-sm ${v === model ? 'btn-primary' : ''}" href="#/insurance?model=${v}">${l}</a>`)}</div></div>
    <div class="grid">${rows.map((p) => html`<div class="card flex">
      <div class="row between">${tag(p.model === 'takaful' ? 'Takaful' : 'Conventional', p.model === 'takaful' ? 'ok' : 'info')}${p.sehat_topup ? tag('+ Sehat Card', 'brand') : ''}</div>
      <h3 style="margin-top:10px">${p.name}</h3>
      <div><span class="big">${pkr(p.premium_monthly)}</span> <span class="muted small">/ month</span></div>
      <div class="small muted">${p.daily_cash ? `Pays ${pkr(p.daily_cash)} per hospital night` : `Covers up to ${pkr(p.annual_limit)} a year`}</div>
      ${peek(html`<p>${p.description}</p>
        <table class="small"><tbody>
          <tr><th>Insurer</th><td>${p.insurer}${p.digital_only ? ' (digital-only)' : ''}</td></tr>
          <tr><th>Type</th><td>${KIND[p.kind] || p.kind}</td></tr>
          <tr><th>Per day</th><td>~${pkr(p.premium_monthly / 30)}</td></tr>
          ${p.opd_limit ? html`<tr><th>OPD/medicines</th><td>${pkr(p.opd_limit)}/year</td></tr>` : ''}
          <tr><th>Waiting period</th><td>${p.waiting_days ? `${p.waiting_days} days` : 'None'}</td></tr>
        </tbody></table>`)}
      <div class="actions"><button class="btn btn-primary btn-block" data-action="enroll" data-id="${p.id}" data-name="${p.name}" data-kind="${p.kind}">Get this plan</button></div>
    </div>`)}</div>
    <div id="enroll"></div>`);
  actions(view, {
    enroll: ({ id, name, kind }) => {
      if (!state.user) return go('#/login?next=' + encodeURIComponent('#/insurance'));
      const box = view.querySelector('#enroll');
      box.innerHTML = String(html`<form class="card" id="ef"><h2>Enrol in ${name}</h2>
        ${kind === 'family' ? html`<div class="field"><label>Family members (optional)</label>
          ${[0, 1, 2].map((i) => html`<div class="form-grid"><input name="m${i}_name" placeholder="Name"><select name="m${i}_rel"><option value="spouse">Spouse</option><option value="child">Child</option><option value="parent">Parent</option></select></div>`)}</div>` : ''}
        <div class="field"><label for="f-payment_method">Pay first premium with</label><select id="f-payment_method" name="payment_method"><option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="raast">Raast</option><option value="card">Card</option></select></div>
        <div class="field"><label for="f-employer">Employer (optional — some employers pay the premium)</label><input id="f-employer" name="employer"></div>
        <p class="tiny muted">You can cancel within 14 days for a full refund (free-look period). Payment is simulated.</p>
        <button class="btn btn-primary" type="submit">Confirm & pay</button></form>`);
      box.scrollIntoView({ behavior: 'smooth' });
      onSubmit(box.querySelector('#ef'), async (d) => {
        const members = [0, 1, 2].filter((i) => d[`m${i}_name`]).map((i) => ({ name: d[`m${i}_name`], relation: d[`m${i}_rel`] }));
        const r = await api('/insurance/enroll', { method: 'POST', body: { plan_id: Number(id), members, payment_method: d.payment_method, employer: d.employer } });
        toast(`Enrolled! Policy ${r.policy.policy_no}`);
        go('#/insurance/policies');
      });
    },
  });
}

async function sehat(view) {
  if (!state.user) return render(view, html`${TABS()}${needLogin('Sign in to check your Sehat Card eligibility.')}`);
  render(view, html`${TABS()}${loading()}`);
  try {
    const r = await api('/insurance/sehat-check');
    render(view, html`${TABS()}<div class="card" style="max-width:720px">
      <h1>Sehat Card</h1>
      <div class="notice ${r.sehat.eligible ? 'notice-ok' : 'notice-warn'}"><b>${r.sehat.eligible ? '✅ You appear to be covered' : 'You do not appear to be covered'}</b><br>
        ${r.sehat.eligible ? html`Inpatient treatment up to ${pkr(r.sehat.annualLimit)} per family per year, cashless at empanelled hospitals.` : 'Based on your province and the socio-economic registry.'}
        ${r.sehat.note ? html`<br><span class="small">${r.sehat.note}</span>` : ''}</div>
      <p>${r.recommendation}</p>
      <div class="row"><a class="btn btn-primary" href="#/insurance?model=">See matching plans</a><a class="btn" href="#/map?sehat=1">Find empanelled hospitals</a></div>
      ${peek(html`<p class="tiny muted">Prototype: eligibility is simulated. A live version needs a data-sharing agreement with NADRA/BISP and State Life / provincial health insurance programmes.</p>`, 'About this check')}
    </div>`);
  } catch (e) {
    render(view, html`${TABS()}<div class="notice notice-warn">${e.message} <a href="#/account">Update profile</a></div>`);
  }
}

async function policies(view) {
  if (!state.user) return render(view, html`${TABS()}${needLogin()}`);
  const rows = await api('/insurance/policies');
  render(view, html`${TABS()}${rows.length ? html`<div class="grid-2">${rows.map((p) => html`<div class="card">
      <div class="row between"><h3>${p.plan_name}</h3>${statusTag(p.status)}</div>
      ${p.daily_cash ? html`<p>Pays <b>${pkr(p.daily_cash)}</b> per hospital night.</p>` : html`
        <p class="small" style="margin-top:8px"><b>${pkr(p.remaining ?? p.annual_limit - p.used)}</b> left of ${pkr(p.annual_limit)}</p>
        <div class="bar ${p.remaining / p.annual_limit < 0.2 ? 'danger' : ''}"><span style="width:${Math.min(100, (p.used / p.annual_limit) * 100)}%"></span></div>`}
      ${peek(html`<div class="small">${p.insurer}<br>Policy ${p.policy_no}<br>${dateOnly(p.start_date)} – ${dateOnly(p.end_date)}${p.members.length ? html`<br>Members: ${p.members.map((m) => `${m.name} (${m.relation})`).join(', ')}` : ''}</div>`)}
      <div class="actions"><a class="btn btn-primary btn-sm" href="#/insurance/claims?policy=${p.id}">Make a claim</a></div>
    </div>`)}</div>` : html`<div class="card"><p>You have no policies yet.</p><a class="btn btn-primary" href="#/insurance">Compare plans</a></div>`}`);
}

async function claims(view, params) {
  if (!state.user) return render(view, html`${TABS()}${needLogin()}`);
  const [rows, pols, facilities] = await Promise.all([api('/insurance/claims'), api('/insurance/policies'), api('/facilities')]);
  const pre = params.get('policy');
  const claimForm = pols.length ? html`<form id="f">
        <div class="field"><label for="po">Policy</label><select id="po" name="policy_id">${pols.map((p) => html`<option value="${p.id}" ${String(p.id) === pre ? 'selected' : ''}>${p.plan_name} (${p.policy_no})</option>`)}</select></div>
        <div class="field"><label for="k">Type</label><select id="k" name="kind">
          <option value="opd">Doctor visit / tests (OPD)</option><option value="pharmacy">Medicines</option><option value="hospital_cash">Hospital cash (nights in hospital)</option>
          <option value="preauth">Cashless hospital admission (pre-approval)</option><option value="reimbursement">Reimbursement of hospital bill</option></select></div>
        <div class="field"><label for="fa">Hospital / clinic</label><select id="fa" name="facility_id"><option value="">—</option>${facilities.filter((f) => f.type !== 'camp').map((f) => html`<option value="${f.id}">${f.name} — ${f.city}</option>`)}</select></div>
        <div class="form-grid">
          <div class="field"><label for="dg">Diagnosis</label><input id="dg" name="diagnosis" required placeholder="e.g. Dengue fever"></div>
          <div class="field"><label for="icd">ICD-10 code <span class="hint">(from your bill, optional)</span></label><input id="icd" name="icd10" placeholder="A90"></div>
          <div class="field"><label for="am">Amount (Rs)</label><input id="am" name="amount" type="number" min="1"></div>
          <div class="field"><label for="ni">Nights in hospital</label><input id="ni" name="nights" type="number" min="0"></div>
        </div>
        <p class="tiny muted">Simple claims are approved in seconds. Others are checked by the insurer — you’ll see why.</p>
        <button class="btn btn-primary" type="submit">Submit claim</button></form>` : html`<p>You need a policy before you can claim. <a href="#/insurance">Compare plans</a></p>`;
  render(view, html`${TABS()}
    ${more('+ New claim', claimForm, { open: !!pre || !rows.length, hint: 'Simple claims approved in seconds' })}
    <div class="card" style="margin-top:16px"><h2>My claims</h2><ul class="list">${rows.length ? rows.map((c) => html`<li>
        <div class="row between"><b>${c.diagnosis}</b>${statusTag(c.status)}</div>
        <div class="small">${c.approved_amount != null ? html`<b>${pkr(c.approved_amount)}</b> approved of ${pkr(c.amount)}` : html`Claimed ${pkr(c.amount)}`}</div>
        ${c.decision_note ? html`<div class="small">Insurer: ${c.decision_note}</div>` : ''}
        ${peek(html`<div class="small">Claim #${c.id} · ${c.plan_name} · ${c.kind.replace('_', ' ')}${c.facility_name ? html`<br>${c.facility_name}` : ''}<br>${when(c.created_at)}
          ${c.status === 'under_review' && c.fraud_flags.length ? html`<br><span class="muted">Being checked because: ${c.fraud_flags.map((f) => f.reason).join('; ')}</span>` : ''}</div>`)}
      </li>`) : html`<li class="muted">No claims yet.</li>`}</ul></div>`);
  onSubmit(view.querySelector('#f'), async (d) => {
    const body = { ...d, policy_id: Number(d.policy_id), facility_id: d.facility_id ? Number(d.facility_id) : undefined };
    const c = await api('/insurance/claims', { method: 'POST', body });
    toast(c.status === 'auto_approved' ? `Approved instantly: ${pkr(c.approved_amount)}` : 'Claim submitted for review');
    claims(view, new URLSearchParams());
  });
}
