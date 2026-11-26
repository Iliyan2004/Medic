import { html, render, state, api, t, pkr, when, tabs, onSubmit, actions, toast, needLogin, tag, loading, more, peek } from './_shared.js';

const TABS = () => tabs([['#/support', 'Programmes'], ['#/support/check', 'Am I eligible?'], ['#/support/transparency', 'Where the money goes'], ['#/support/ppp', 'Partnership clinics']], location.hash.split('?')[0] || '#/support');
const TYPE = { govt: ['Government', 'info'], zakat: ['Zakat', 'ok'], csr: ['Company CSR', 'brand'], donor: ['Donors', 'brand'], ppp: ['Public-private partnership', 'warn'] };

export default function support({ view, parts }) {
  if (parts[1] === 'check') return check(view);
  if (parts[1] === 'transparency') return transparency(view);
  if (parts[1] === 'ppp') return ppp(view);
  return programs(view);
}

async function programs(view) {
  render(view, html`${TABS()}${loading()}`);
  const rows = await api('/support/programs');
  render(view, html`${TABS()}
    <div class="page-head"><div><h1>Financial support for care</h1><p class="muted">One check matches you to every programme.</p></div>
      <a class="btn btn-primary" href="#/support/check">${t('check_eligibility')}</a></div>
    <div class="grid">${rows.map((p) => html`<div class="card flex">
      ${tag(TYPE[p.type][0], TYPE[p.type][1])}
      <h3 style="margin-top:10px">${p.name}</h3>
      <div class="small">Covers ${p.covers.join(', ')}${p.copay_pct ? ` · you pay ${p.copay_pct}%` : ' · free'}</div>
      ${peek(html`<p class="small">${p.description}</p><div class="small muted">Sponsor: ${p.sponsor}
        ${p.per_person_annual_cap ? html`<br>Up to ${pkr(p.per_person_annual_cap)} per person per year` : ''}
        ${p.provinces.length ? html`<br>Only in: ${p.provinces.join(', ')}` : ''}
        <br>Fund balance ${pkr(p.fund_balance)} · ${p.beneficiaries} enrolled</div>`)}
      ${p.type !== 'govt' ? html`<div class="actions"><button class="btn btn-sm" data-action="donate" data-id="${p.id}" data-name="${p.name}" data-zakat="${p.type === 'zakat' ? 1 : ''}">${t('donate')}</button></div>` : ''}
    </div>`)}</div><div id="don" style="margin-top:16px"></div>`);
  actions(view, {
    donate: ({ id, name, zakat }) => {
      if (!state.user) { location.hash = '#/login?next=%23%2Fsupport'; return; }
      const box = view.querySelector('#don');
      box.innerHTML = String(html`<form class="card" id="df" style="max-width:520px"><h2>Donate to ${name}</h2>
        ${zakat ? html`<p class="small muted">Zakat donations are kept in a separate pool and used only for zakat-eligible patients. Every disbursement appears on the public ledger.</p>` : ''}
        <div class="field"><label for="f-amount">Amount (Rs)</label><input id="f-amount" name="amount" type="number" min="100" value="1000" required></div>
        <div class="field"><label for="f-method">Pay with</label><select id="f-method" name="method"><option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="raast">Raast</option><option value="card">Card</option></select></div>
        <label class="check"><input type="checkbox" name="anonymous"> Donate anonymously</label><p></p>
        <button class="btn btn-primary" type="submit">Donate</button> <span class="tiny muted">Payment is simulated.</span></form>`);
      box.scrollIntoView({ behavior: 'smooth' });
      onSubmit(box.querySelector('#df'), async (d) => {
        const r = await api(`/support/programs/${id}/donate`, { method: 'POST', body: d });
        toast(`JazakAllah! Receipt ${r.receipt.ref}`);
        programs(view);
      });
    },
  });
}

async function check(view) {
  if (!state.user) return render(view, html`${TABS()}${needLogin('Sign in to check which programmes you qualify for.')}`);
  const mine = await api('/support/my');
  render(view, html`${TABS()}
    <div class="grid-2">
      <div class="card"><h2>One check, every programme</h2>
        <p class="small">No forms, no scheme names — one tap.</p>
        ${peek(html`<p class="small">We check your CNIC against the national socio-economic registry (NSER) and match you to every programme you qualify for.</p><p class="small muted">We use your CNIC fingerprint and province only. Your CNIC is never stored.</p>`, 'How it works')}<p></p>
        <button class="btn btn-primary" data-action="run">${t('check_eligibility')}</button>
        <div id="res" style="margin-top:12px"></div>
      </div>
      <div class="card"><h2>My support</h2><ul class="list">${mine.length ? mine.map((m) => html`<li>
        <b>${m.name}</b> ${tag(TYPE[m.type][0], TYPE[m.type][1])}
        <div class="small">Covers ${m.covers.join(', ')}${m.copay_pct ? ` · you pay ${m.copay_pct}%` : ''}</div>
        ${m.per_person_annual_cap ? html`<div class="small">Used ${pkr(m.used_this_year)} of ${pkr(m.per_person_annual_cap)} this year</div><div class="bar"><span style="width:${Math.min(100, (m.used_this_year / m.per_person_annual_cap) * 100)}%"></span></div>` : ''}
      </li>`) : html`<li class="muted">Nothing yet — run the check.</li>`}</ul>
      ${mine.some((m) => m.covers.includes('medicines')) ? html`<a class="btn btn-sm" href="#/pharmacy">Use for medicines</a>` : ''}</div>
    </div>`);
  actions(view, {
    run: async () => {
      const box = view.querySelector('#res');
      try {
        const r = await api('/support/check-eligibility', { method: 'POST' });
        box.innerHTML = String(html`<p class="small">Poverty score (NSER PMT): <b>${r.pmtScore}</b> ${r.simulated ? tag('simulated', 'warn') : ''}</p>
          <ul class="list">${r.results.map((x) => html`<li class="row between"><span><b>${x.name}</b><br><span class="tiny muted">${x.eligible ? `Covers ${x.covers.join(', ')}` : x.reasons.join('; ')}</span></span>${x.eligible ? tag('Eligible', 'ok') : tag('Not eligible')}</li>`)}</ul>`);
        toast('Check complete');
      } catch (e) {
        box.innerHTML = String(html`<div class="notice notice-warn">${e.message} <a href="#/account">Update profile</a></div>`);
      }
    },
  });
}

async function transparency(view) {
  const r = await api('/support/transparency');
  const totalOut = r.programs.reduce((s, p) => s + p.total_out, 0);
  render(view, html`${TABS()}
    <h1>Where the money goes</h1>
    <p class="muted">Every rupee donated or budgeted, and every rupee spent on care — public, with no personal details.</p>
    <div class="stats">
      <div class="stat"><div class="v">${pkr(r.programs.reduce((s, p) => s + p.total_in, 0))}</div><div class="l">Received</div></div>
      <div class="stat"><div class="v">${pkr(totalOut)}</div><div class="l">Spent on care</div></div>
      <div class="stat"><div class="v">${r.programs.reduce((s, p) => s + p.people_helped, 0)}</div><div class="l">Payments to identified patients</div></div>
    </div>
    ${more('By programme', html`<div class="table-wrap"><table><thead><tr><th>Programme</th><th>Type</th><th class="right">In</th><th class="right">Out</th><th class="right">Balance</th></tr></thead><tbody>
      ${r.programs.map((p) => html`<tr><td>${p.name}<div class="tiny muted">${p.sponsor}</div></td><td>${TYPE[p.type][0]}</td><td class="right nowrap">${pkr(p.total_in)}</td><td class="right nowrap">${pkr(p.total_out)}</td><td class="right nowrap">${pkr(p.fund_balance)}</td></tr>`)}
    </tbody></table></div>`, { hint: `${r.programs.length} programmes` })}
    <div class="card" style="margin-top:16px"><h2>Spent on</h2>${r.byPurpose.map((x) => html`<div class="row between small"><span>${x.purpose}</span><b>${pkr(x.amount)}</b></div><div class="bar" style="margin-bottom:8px"><span style="width:${(x.amount / (totalOut || 1)) * 100}%"></span></div>`)}</div>
    ${more('Latest transactions', html`<ul class="list">${r.recent.map((x) => html`<li class="row between small"><span>${x.programme}<br><span class="tiny muted">${x.purpose} · ${when(x.ts)}</span></span><b style="color:${x.kind === 'credit' ? 'var(--ok)' : 'inherit'}">${x.kind === 'credit' ? '+' : '−'}${pkr(x.amount)}</b></li>`)}</ul>`)}`);
}

export async function ppp(view, withTabs = true) {
  const rows = await api('/support/ppp');
  render(view, html`${withTabs ? TABS() : ''}
    <h1>Partnership clinics & hospitals</h1>
    <p class="muted">Monthly scorecards for government facilities run by private partners.</p>
    ${rows.map((c) => html`<div class="card">
      <div class="row between"><div><h2>${c.facility_name}</h2><div class="small muted">Run by ${c.operator}</div></div>
        ${c.latest ? html`<div class="right"><div class="big" style="color:${c.latest.score >= 85 ? 'var(--ok)' : c.latest.score >= 70 ? 'var(--warn)' : 'var(--danger)'}">${c.latest.score}<span class="tiny muted">/100</span></div><div class="tiny muted">${c.latest.period}</div></div>` : ''}</div>
      ${c.latest ? peek(html`<div class="small muted" style="margin-bottom:8px">${c.model} · partner: ${c.govt_partner} · ${pkr(c.monthly_fee)}/month</div><div class="table-wrap"><table><thead><tr><th>Indicator</th><th class="right">Target</th><th class="right">Actual</th><th style="width:30%">Achievement</th></tr></thead><tbody>
        ${c.latest.parts.map((p) => html`<tr><td>${p.label || p.metric}</td><td class="right">${p.lower ? '≤ ' : ''}${p.target}${p.unit === '%' ? '%' : ''}</td><td class="right">${p.actual}${p.unit === '%' ? '%' : ''}</td>
          <td><div class="bar ${p.achievement < 0.7 ? 'danger' : p.achievement < 0.9 ? 'warn' : ''}"><span style="width:${p.achievement * 100}%"></span></div></td></tr>`)}
      </tbody></table></div><p class="small muted">Trend: ${c.reports.map((r) => `${r.period}: ${r.score}`).join(' → ')}</p>`, 'Scorecard') : html`<p class="muted">No reports yet.</p>`}
    </div>`)}`);
  return rows;
}
