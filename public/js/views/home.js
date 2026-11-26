import { html, render, state, api, t, when, loading } from './_shared.js';

// Simple first: four core services up front, everything else one tap away.
// Each card shows a title + one line; the full description is behind "Details".
const CORE = [
  ['#/pharmacy', '💊', 'pharmacy', 'Medicines', 'Order from licensed pharmacies', 'Order OTC & prescription medicines from licensed pharmacies, and scan a pack to check it is genuine.'],
  ['#/insurance', '🛡️', 'insurance', 'Insurance', 'Plans, Sehat Card & claims', 'Compare takaful & conventional plans, check your Sehat Card eligibility and file a claim in minutes.'],
  ['#/support', '🤝', 'support', 'Financial help', 'Zakat, CSR & govt. support', 'One check matches you with zakat, Bait-ul-Mal, company CSR and government programmes that pay at checkout.'],
  ['#/records', '📋', 'records', 'Health record', 'Encrypted, you control it', 'Your encrypted record. You decide who sees it, share it with a time-limited code, and see every access.'],
];
const MORE = [
  ['#/map', '🗺️', 'map', 'Hospitals & camps', 'Find care near you', 'Verified hospitals, clinics, BHUs, labs, blood banks and today’s free health camps on a map.'],
  ['#/geo', '📊', 'records', 'Health map', 'Disease, access & medicines', 'Where diseases are rising, which areas lack hospitals or blood banks, and essential-medicine stock by city.'],
  ['#/community', '💬', 'community', 'Community', 'Ask verified doctors', 'Questions answered by verified doctors, blood donation requests and local health alerts.'],
  ['#/energy', '☀️', 'energy', 'Clinic energy', 'Power & vaccine fridges', 'Power and vaccine-fridge monitoring for clinics, plus a solar sizing calculator under net billing.'],
  ['#/privacy', '🔒', 'privacy', 'Privacy', 'Your data, your rights', 'How we protect your data, and how to download or delete it.'],
];

const tile = ([href, ico, acc, title, sub, body]) => html`
  <a class="card tile acc-${acc}" href="${href}">
    <span class="go" aria-hidden="true">→</span>
    <div class="ico" aria-hidden="true">${ico}</div>
    <h3>${title}</h3>
    <p class="sub">${sub}</p>
    <details><summary>Details</summary><p class="muted small">${body}</p></details>
  </a>`;

export default async function home({ view, parts }) {
  if (parts[0] === 'notifications') return notifications(view);
  const u = state.user;
  render(view, html`
    <section class="stack">
      <div class="hero">
        <div>
          <span class="eyebrow">Built for Pakistan</span>
          <h1>${u ? `Assalam-o-Alaikum, ${u.name.split(' ')[0]}` : 'Your health, in one place'}</h1>
          <p>Medicines, insurance, support, hospitals and your record — simple and secure.</p>
          ${u ? '' : html`<div class="cta"><a class="btn" href="#/login">Sign in</a><a class="btn ghost" href="#/register">Create account</a></div>`}
        </div>
        <div class="scene" aria-hidden="true">
          <div class="stage">
            <div class="plate"></div>
            <svg class="pulse-line" viewBox="0 0 400 60" preserveAspectRatio="none"><path d="M0 30 H120 L140 10 L165 52 L185 4 L205 44 L222 30 H400"/></svg>
            <div class="cross"><i></i><i></i></div>
            <div class="orb o1">💊</div>
            <div class="orb o4">🚑</div>
          </div>
        </div>
      </div>

      <a class="sos-big" href="#/emergency"><span aria-hidden="true">🚑</span><span>${t('sos_title')}<small>${t('sos_sub')}</small></span></a>
      ${u?.role === 'patient' ? html`<div class="quick">
        <a href="#/care"><span aria-hidden="true">⏰</span><span>My medicines</span></a>
        <a href="#/card"><span aria-hidden="true">🆘</span><span>Emergency card</span></a>
        <a href="#/care/labs"><span aria-hidden="true">🧪</span><span>Lab tests</span></a>
        <a href="#/care/appointments"><span aria-hidden="true">📅</span><span>Appointment</span></a>
        <a href="#/pharmacy/verify"><span aria-hidden="true">📷</span><span>Check a medicine</span></a>
      </div>` : ''}

      <div id="home-alerts"></div>

      <div class="grid">${CORE.map(tile)}</div>

      <details class="more">
        <summary><span>More services</span><span class="muted small">Map, health map, community, energy, privacy</span></summary>
        <div class="more-body"><div class="grid">${MORE.map(tile)}</div></div>
      </details>

      ${u ? '' : html`<details class="more"><summary>Try the demo</summary><div class="more-body"><p class="muted small">Sign in as a patient with <b>03001234567</b> / <b>Demo@12345</b>. Staff demo accounts are listed on the sign-in page.</p></div></details>`}
    </section>`);

  // "Details" inside a link-card: toggle without navigating.
  view.addEventListener('click', (ev) => {
    const s = ev.target.closest('.tile summary');
    if (!s) return;
    ev.preventDefault();
    const d = s.parentElement; d.open = !d.open;
  });

  if (u?.role === 'patient') {
    // Today's medicines first: the thing people open the app for every day.
    api('/care/schedules').then(async (list) => {
      if (!list.length || !view.isConnected) return;
      const { doseRows, logDose } = await import('./care.js');
      const pending = list.flatMap((s) => s.today).filter((d) => !d.status).length;
      const box = document.createElement('div');
      box.className = 'card';
      box.style.animation = 'none'; // arrives after the first paint — no entrance fade (it could stick at opacity 0)
      const draw = (l) => { box.innerHTML = String(html`<div class="row between"><h2 style="margin:0">⏰ Today’s medicines${state.actAs ? ` · ${state.actAs.name}` : ''}</h2>
        <span class="row">${pending ? html`<span class="tag tag-warn">${pending} to take</span>` : html`<span class="tag tag-ok">All done ✓</span>`}<a class="small" href="#/care">All</a></span></div>${doseRows(l)}`); };
      draw(list);
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-action="dose"]'); if (!b) return;
        b.disabled = true;
        await logDose(b.dataset).catch(() => {});
        draw(await api('/care/schedules'));
      });
      view.querySelector('.sos-big')?.insertAdjacentElement('afterend', box);
    }).catch(() => {});
    try {
      const [notifs, rx] = await Promise.all([api('/notifications'), api('/pharmacy/prescriptions')]);
      const pending = rx.filter((r) => r.status === 'pending' && r.source === 'e-rx');
      const unread = notifs.filter((n) => !n.read_at && n.kind !== 'rx');
      const el = view.querySelector('#home-alerts');
      el.innerHTML = String(html`
        ${pending.map((r) => html`<div class="notice notice-ok">📝 Dr. ${r.doctor_name} sent you an e-prescription (${r.items.map((i) => i.name).join(', ')}). <a href="#/pharmacy/rx">Order it</a></div>`)}
        ${unread.length ? html`<details class="more"><summary><span>🔔 ${unread.length} new update${unread.length > 1 ? 's' : ''}</span></summary><div class="more-body">${unread.slice(0, 5).map((n) => html`<div class="notice">${n.message}</div>`)}<a href="#/notifications" class="small">See all</a></div></details>` : ''}`);
    } catch { /* non-critical */ }
  }
}

async function notifications(view) {
  if (!state.user) { location.hash = '#/login'; return; }
  render(view, loading());
  const rows = await api('/notifications');
  api('/notifications/read', { method: 'POST' }).then(() => { const b = document.getElementById('notif-count'); if (b) b.hidden = true; }).catch(() => {});
  render(view, html`<div class="page-head"><h1>${t('notifications')}</h1></div>
    <div class="card"><ul class="list">${rows.length ? rows.map((n) => html`<li><div>${n.message}</div><div class="tiny muted">${when(n.created_at)}</div></li>`) : html`<li class="muted">Nothing yet.</li>`}</ul></div>`);
}
