import { html, render, state, api, t, pkr, when, tag, actions, toast, go, poll, statusTag, esc, peek } from './_shared.js';
import { makeMap, COLORS, route } from './_map.js';

const CITIES = { Karachi: [24.8607, 67.0011], Lahore: [31.5204, 74.3587], Islamabad: [33.6844, 73.0479], Peshawar: [34.0151, 71.5249], Quetta: [30.1798, 66.975] };
const tokens = {
  get(id) { try { return JSON.parse(localStorage.getItem('sy.track') || '{}')[id]; } catch { return null; } },
  set(id, tok) { try { const o = JSON.parse(localStorage.getItem('sy.track') || '{}'); o[id] = tok; localStorage.setItem('sy.track', JSON.stringify(o)); } catch { /* ignore */ } },
};

const callBar = () => html`<div class="row" style="margin-bottom:12px">
  <a class="btn btn-danger" href="tel:1122">📞 ${t('call_1122')}</a><a class="btn" href="tel:115">📞 ${t('call_115')}</a>
  <span class="small muted">Phone calls work even without internet.</span></div>`;

export default function emergency({ view, parts }) {
  if (parts[1] === 'track') return track(view, parts[2]);
  return requestForm(view);
}

async function requestForm(view) {
  let loc = null;
  let support = [];
  if (state.user?.role === 'patient') support = (await api('/support/my').catch(() => [])).filter((s) => s.covers.includes('ambulance'));
  render(view, html`
    <h1>🚑 ${t('request_ambulance')}</h1>
    ${callBar()}
    <div class="grid-2">
      <form class="card" id="f">
        <div class="field"><label>Where are you?</label>
          <div class="row"><button class="btn btn-primary" type="button" id="geo">📍 ${t('share_location')}</button>
            <select id="cityPick" style="width:auto" aria-label="Or pick city"><option value="">…or pick a city</option>${Object.keys(CITIES).map((c) => html`<option>${c}</option>`)}</select></div>
          <div id="locText" class="small muted" style="margin-top:6px">${state.lowData ? 'Low-data mode: map is off.' : 'You can also tap the map.'}</div></div>
        <fieldset class="field" style="border:0;padding:0;margin:0 0 12px"><legend><b>${t('severity')}</b></legend>
          ${[1, 2, 3, 4].map((s) => html`<label class="check"><input type="radio" name="severity" value="${s}" ${s === 2 ? 'checked' : ''}> ${t('sev_' + s)}</label>`)}</fieldset>
        <div class="field"><label for="ph">${t('contact_phone')}</label><input id="ph" name="contact_phone" inputmode="tel" value="${state.user?.phone || ''}" required></div>
        <details class="peek" style="margin:0 0 12px"><summary>Add details (optional)</summary><div class="peek-body">
          <div class="field"><label for="cp">${t('what_happened')}</label><input id="cp" name="complaint" placeholder="e.g. chest pain, road accident"></div>
          ${support.length ? html`<div class="field"><label for="sp">Fare support</label><select id="sp" name="subsidy_program_id"><option value="">None</option>${support.map((s) => html`<option value="${s.program_id}">${s.name}</option>`)}</select></div>` : ''}
        </div></details>
        <div id="quote"></div>
        <button class="btn btn-danger btn-block" type="submit" id="go" disabled>${t('request_ambulance')}</button>
        <p class="tiny muted" style="margin-top:8px">No account needed. Fastest ambulance from any service.</p>
      </form>
      <div>${state.lowData ? '' : html`<div id="map" class="map"></div>`}<div id="mine"></div></div>
    </div>`);

  const form = view.querySelector('#f');
  import('../tools.js').then((m) => m.voiceInput(view, '#cp'));
  if (state.user?.role === 'patient') view.querySelector('#mine').insertAdjacentHTML('beforebegin', '<a class="btn btn-block" href="#/card" style="margin-top:12px">🆘 Show my emergency card to the crew</a>');
  let mapObj = null, marker = null;
  if (!state.lowData) {
    mapObj = await makeMap(view.querySelector('#map'), [30.3753, 69.3451], 5);
    mapObj.map.on('click', (e) => setLoc(e.latlng.lat, e.latlng.lng, 'Map pin'));
  }
  function setLoc(lat, lng, label) {
    loc = { lat, lng };
    view.querySelector('#locText').textContent = `${label}: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (mapObj) {
      if (marker) marker.remove();
      marker = mapObj.L.circleMarker([lat, lng], { radius: 10, color: '#fff', weight: 3, fillColor: COLORS.patient, fillOpacity: 1 }).addTo(mapObj.map);
      mapObj.map.setView([lat, lng], 13);
    }
    view.querySelector('#go').disabled = false;
    quote();
  }
  view.querySelector('#geo').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location not available — pick a city', true);
    view.querySelector('#locText').textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition((p) => setLoc(p.coords.latitude, p.coords.longitude, 'Your location'),
      () => toast('Could not get location — pick a city or tap the map', true), { enableHighAccuracy: true, timeout: 10000 });
  });
  view.querySelector('#cityPick').addEventListener('change', (e) => {
    const c = CITIES[e.target.value];
    if (c) setLoc(c[0] + (Math.random() - 0.5) * 0.04, c[1] + (Math.random() - 0.5) * 0.04, e.target.value);
  });
  form.addEventListener('change', (e) => { if (e.target.name === 'severity') quote(); });

  async function quote() {
    if (!loc) return;
    const sev = Number(new FormData(form).get('severity'));
    const box = view.querySelector('#quote');
    try {
      const q = await api('/emergency/quote', { method: 'POST', body: { ...loc, severity: sev } });
      box.innerHTML = String(html`<div class="notice">
        <div class="row between"><span>${t('eta')} <span class="big">~${Math.round(q.ambulance.eta_min)}</span> ${t('minutes')}</span><b>${q.fare_estimate === 0 ? t('free') : pkr(q.fare_estimate)}</b></div>
        ${peek(html`<div class="small"><b>${q.ambulance.provider}</b> ${tag(q.ambulance.type)}
          ${q.first_responder ? html`<br>🏍️ Motorbike first responder: ~${Math.round(q.first_responder.eta_min)} ${t('minutes')}` : ''}
          ${q.destination ? html`<br>🏥 To: ${q.destination.name} (${q.destination.beds_free} beds free)` : ''}
          ${q.fare_estimate ? html`<br>Fare is fixed upfront.` : ''}</div>`)}</div>`);
    } catch (e) { box.innerHTML = String(html`<div class="notice notice-danger">${e.message}</div>`); }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!loc) return toast('Set your location first', true);
    const d = Object.fromEntries(new FormData(form));
    try {
      const r = await api('/emergency/request', { method: 'POST', body: { ...loc, severity: Number(d.severity), complaint: d.complaint, contact_phone: d.contact_phone, subsidy_program_id: d.subsidy_program_id ? Number(d.subsidy_program_id) : undefined } });
      tokens.set(r.id, r.track_token);
      go(`#/emergency/track/${r.id}`);
    } catch (err) { toast(err.message, true); }
  });

  if (state.user) {
    const mine = await api('/emergency/mine').catch(() => []);
    if (mine.length) view.querySelector('#mine').innerHTML = String(html`<div class="card" style="margin-top:16px"><h3>My requests</h3><ul class="list">${mine.map((m) => html`<li class="row between"><a href="#/emergency/track/${m.id}">#${m.id} · ${when(m.created_at)}</a>${statusTag(m.status)}</li>`)}</ul></div>`);
  }
  return () => mapObj?.map.remove();
}

async function track(view, id) {
  const tok = tokens.get(id);
  const get = () => api(`/emergency/${id}${tok ? `?token=${encodeURIComponent(tok)}` : ''}`);
  let e = await get();
  render(view, html`<h1>${t('ambulance_coming')}</h1>${callBar()}
    <div class="grid-2"><div id="info"></div><div>${state.lowData ? '' : html`<div id="map" class="map"></div>`}</div></div>`);
  let mapObj = null, layer = null, lastRouteKey = '';
  if (!state.lowData) { mapObj = await makeMap(view.querySelector('#map'), [e.lat, e.lng], 13); layer = mapObj.L.layerGroup().addTo(mapObj.map); }

  async function draw() {
    const info = view.querySelector('#info');
    const done = ['at_hospital', 'closed', 'cancelled'].includes(e.status);
    const wasOpen = info.querySelector('details.peek')?.open; // keep "Timeline" open across the 5s refresh
    info.innerHTML = String(html`<div class="card">
      <div class="row between"><h2>Request #${e.id}</h2>${statusTag(e.status)}</div>
      ${e.ambulance ? html`<p><b>${e.ambulance.provider_name}</b> · ${e.ambulance.call_sign} (${e.ambulance.type})<br>
        <a href="tel:${e.ambulance.hotline}">Call ${e.ambulance.hotline}</a></p>` : ''}
      ${e.live_eta_min != null && !done ? html`<div class="stat"><div class="v">${Math.max(1, Math.round(e.live_eta_min))} ${t('minutes')}</div><div class="l">${e.status === 'transporting' ? 'to hospital' : 'until ambulance arrives'}</div></div>` : ''}
      ${e.facility ? html`<p style="margin-top:12px">🏥 <b>${e.facility.name}</b> knows you are coming.</p>` : ''}
      ${!done ? html`<div class="notice small"><b>While you wait:</b> stay with the patient, keep the airway clear, press firmly on any bleeding, don’t give food or water, and keep your phone free.</div>` : ''}
      ${peek(html`<p class="small">Fare: <b>${e.fare_estimate ? pkr(e.fare_estimate) : t('free')}</b> · ${e.fare_payer}${e.subsidy_amount ? html` · support pays ${pkr(e.subsidy_amount)}` : ''}</p>
        <ul class="timeline">${e.timeline.map((x) => html`<li><b>${x.status.replace('_', ' ')}</b> <span class="tiny muted">${when(x.at)}</span>${x.note ? html`<div class="small">${x.note}</div>` : ''}</li>`)}</ul>`, 'Timeline & fare')}
      ${!done ? html`<div class="actions"><button class="btn" data-action="cancel">Cancel request</button></div>` : ''}
    </div>`);
    if (wasOpen) info.querySelector('details.peek').open = true;
    if (mapObj) {
      const { L, map } = mapObj;
      layer.clearLayers();
      const pts = [[e.lat, e.lng]];
      L.circleMarker([e.lat, e.lng], { radius: 10, color: '#fff', weight: 3, fillColor: COLORS.patient, fillOpacity: 1 }).addTo(layer).bindTooltip('Patient');
      if (e.facility) { L.circleMarker([e.facility.lat, e.facility.lng], { radius: 10, color: '#fff', weight: 3, fillColor: COLORS.hospital, fillOpacity: 1 }).addTo(layer).bindTooltip(esc(e.facility.name)); pts.push([e.facility.lat, e.facility.lng]); }
      if (e.ambulance) {
        L.circleMarker([e.ambulance.lat, e.ambulance.lng], { radius: 11, color: '#fff', weight: 3, fillColor: COLORS.ambulance, fillOpacity: 1 }).addTo(layer).bindTooltip('🚑 ' + esc(e.ambulance.call_sign));
        pts.push([e.ambulance.lat, e.ambulance.lng]);
        const target = e.status === 'dispatched' ? { lat: e.lat, lng: e.lng } : e.facility;
        if (target && !done) {
          const key = `${e.status}:${e.ambulance.lat.toFixed(3)},${e.ambulance.lng.toFixed(3)}`;
          if (key !== lastRouteKey) { lastRouteKey = key; e._route = await route(e.ambulance, target); }
          if (e._route) L.polyline(e._route.points, { color: COLORS.ambulance, weight: 4, opacity: 0.7, dashArray: e._route.road ? null : '6 6' }).addTo(layer);
        }
      }
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    }
  }
  await draw();
  actions(view, {
    cancel: async () => {
      e = await api(`/emergency/${id}/cancel${tok ? `?token=${encodeURIComponent(tok)}` : ''}`, { method: 'POST' });
      toast('Request cancelled');
      draw();
    },
  });
  const stop = poll(async () => { const r = e._route; e = await get(); e._route = r; draw(); }, 5000);
  return () => { stop(); mapObj?.map.remove(); };
}
