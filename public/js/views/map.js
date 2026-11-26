import { html, render, state, api, when, tag, onSubmit, toast, loading, esc, peek } from './_shared.js';
import { makeMap, COLORS } from './_map.js';

const TYPES = [['', 'All'], ['hospital', 'Hospitals'], ['clinic', 'Clinics'], ['bhu', 'BHUs'], ['rhc', 'RHCs'], ['lab', 'Labs'], ['blood_bank', 'Blood banks'], ['camp', 'Health camps']];
const LABEL = Object.fromEntries(TYPES);
const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];

export default async function mapView({ view, params }) {
  const f = {
    type: params.get('type') || '', city: params.get('city') || '', sehat: params.get('sehat') === '1',
    // Female-doctor preference from the profile is the default filter (can be unticked).
    female: params.get('female') === '1' || (params.get('female') !== '0' && !!state.user?.pref_female_doctor),
    emergency: params.get('emergency') === '1', q: params.get('q') || '',
  };
  let near = null;
  render(view, html`
    <div class="page-head"><div><h1>Hospitals, clinics & camps</h1><p class="muted">Verified places and free camps near you.</p></div>
      ${state.user ? html`<button class="btn" id="add-btn" type="button">+ Add a health camp</button>` : ''}</div>
    <form id="filters" class="card">
      <div class="row">
        <select name="type" aria-label="Type" style="width:auto">${TYPES.map(([v, l]) => html`<option value="${v}" ${v === f.type ? 'selected' : ''}>${l}</option>`)}</select>
        <input name="q" value="${f.q}" placeholder="Service e.g. dialysis, maternity" style="flex:1;min-width:160px" aria-label="Search services">
        <button class="btn btn-primary btn-sm" type="button" id="near">📍 Near me</button>
      </div>
      <details class="peek" ${f.city || f.sehat || f.female || f.emergency ? 'open' : ''}><summary>More filters</summary><div class="peek-body row">
        <select name="city" aria-label="City" style="width:auto" id="city"><option value="">All cities</option></select>
        <label class="check"><input type="checkbox" name="sehat" ${f.sehat ? 'checked' : ''}> Sehat Card</label>
        <label class="check"><input type="checkbox" name="female" ${f.female ? 'checked' : ''}> Female doctor</label>
        <label class="check"><input type="checkbox" name="emergency" ${f.emergency ? 'checked' : ''}> 24/7 emergency</label>
      </div></details>
    </form>
    <div id="add"></div>
    ${state.lowData ? html`<div class="notice notice-warn small">Low-data mode: map tiles are off. Showing a list.</div>` : html`<div id="map" class="map" role="region" aria-label="Map of facilities"></div>`}
    <div id="list" style="margin-top:16px">${loading()}</div>`);

  api('/facilities/cities').then((cities) => {
    view.querySelector('#city').innerHTML += cities.map((c) => `<option ${c.city === f.city ? 'selected' : ''}>${esc(c.city)}</option>`).join('');
  });

  let mapObj = null, layer = null, pickMarker = null;
  if (!state.lowData) {
    mapObj = await makeMap(view.querySelector('#map'));
    layer = mapObj.L.layerGroup().addTo(mapObj.map);
  }

  async function load() {
    const qs = new URLSearchParams({ type: f.type, city: f.city, q: f.q });
    if (f.sehat) qs.set('sehat', '1');
    if (f.female) qs.set('female_doctor', '1');
    if (f.emergency) qs.set('emergency', '1');
    if (near) qs.set('near', `${near.lat},${near.lng}`);
    // Offline: fall back to the last list seen (public data only — safe to keep on the phone).
    let rows, stale = false;
    try {
      rows = await api(`/facilities?${qs}`);
      try { localStorage.setItem('sy.lastPlaces', JSON.stringify(rows.slice(0, 60))); } catch { /* full */ }
    } catch (e) {
      try { rows = JSON.parse(localStorage.getItem('sy.lastPlaces')) || []; stale = true; } catch { throw e; }
    }
    const list = view.querySelector('#list');
    if (stale) view.querySelector('#list').insertAdjacentHTML('beforebegin', '<div class="notice notice-warn small">You are offline — showing places from your last search. Call 1122 or 115 in an emergency.</div>');
    list.innerHTML = String(html`<p class="small muted">${rows.length}${rows.length >= 200 ? '+' : ''} places${near ? ' nearest to you' : ''} · verified first.
      ${peek(html`<span class="tiny">“OpenStreetMap” places come from the open <a href="https://healthsites.io" target="_blank" rel="noopener">Healthsites.io</a> map (© OpenStreetMap contributors, ODbL). They are community-mapped and not licence-checked by Sehatyab, and ambulances are never routed to them.</span>`, 'About this data')}</p>
      <div class="grid">${rows.map(card)}</div>`);
    if (mapObj) {
      layer.clearLayers();
      const { L, map } = mapObj;
      const pts = [];
      for (const r of rows) {
        const m = L.circleMarker([r.lat, r.lng], { radius: r.type === 'hospital' ? 9 : 7, color: '#fff', weight: 2, fillColor: COLORS[r.type] || '#555', fillOpacity: r.verified ? 0.95 : 0.45 });
        m.bindPopup(String(popup(r)));
        m.addTo(layer); pts.push([r.lat, r.lng]);
      }
      if (near) L.circleMarker([near.lat, near.lng], { radius: 8, color: '#fff', weight: 3, fillColor: COLORS.patient, fillOpacity: 1 }).addTo(layer).bindTooltip('You');
      if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
    }
  }

  function card(r) {
    return html`<div class="card">
      <div class="row between"><b>${r.name}</b>${tag(LABEL[r.type] || r.type)}</div>
      <div class="small muted">${r.city}${r.distance_km != null ? ` · ${r.distance_km} km` : ''} · ${r.sector}</div>
      <div class="row" style="margin-top:6px">
        ${r.verified ? tag('✓ Verified', 'ok') : r.source === 'osm' ? tag('OpenStreetMap', 'info') : tag('Unverified', 'warn')}
        ${r.emergency ? tag('24/7 ER', 'danger') : ''}
        ${r.camp_state ? tag(r.camp_state === 'active' ? 'Happening now' : 'Upcoming', r.camp_state === 'active' ? 'ok' : 'info') : ''}
      </div>
      <div class="actions"><a class="btn btn-sm" href="https://www.openstreetmap.org/directions?to=${r.lat},${r.lng}" target="_blank" rel="noopener">Directions ↗</a>
        ${r.beds_total ? html`<span class="small">Beds free <b>${r.beds_free}</b>/${r.beds_total}</span>` : ''}</div>
      ${peek(html`<div class="row" style="margin-bottom:6px">
          ${r.sehat_empanelled ? tag('Sehat Card', 'info') : ''}${r.female_doctor ? tag('Female doctor', 'brand') : ''}
          ${r.power ? tag(r.power.level === 'ok' ? '⚡ Power OK' : r.power.level === 'warning' ? '⚡ Backup power' : '⚡ Power problem', r.power.level === 'ok' ? 'ok' : r.power.level === 'warning' ? 'warn' : 'danger') : ''}</div>
        ${r.type === 'camp' ? html`<div class="small">🗓 ${when(r.starts_at)} – ${when(r.ends_at)}<br>By ${r.organizer}</div>` : ''}
        <div class="small muted">${r.services.join(' · ')}</div>`)}
    </div>`;
  }
  const popup = (r) => html`<b>${r.name}</b><br>${LABEL[r.type] || r.type} · ${r.city}<br>${r.verified ? '✓ verified' : r.source === 'osm' ? 'OpenStreetMap (not licence-checked)' : 'unverified'}${r.sehat_empanelled ? ' · Sehat Card' : ''}${r.beds_total ? html`<br>Beds free: ${r.beds_free}` : ''}${r.type === 'camp' ? html`<br>${when(r.starts_at)} – ${when(r.ends_at)}` : ''}`;

  view.querySelector('#filters').addEventListener('change', (e) => {
    const fd = new FormData(e.currentTarget);
    Object.assign(f, { type: fd.get('type'), city: fd.get('city'), q: fd.get('q'), sehat: fd.has('sehat'), female: fd.has('female'), emergency: fd.has('emergency') });
    load();
  });
  view.querySelector('#filters').addEventListener('submit', (e) => e.preventDefault());
  view.querySelector('#near').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location not available on this device', true);
    navigator.geolocation.getCurrentPosition((p) => { near = { lat: p.coords.latitude, lng: p.coords.longitude }; load(); },
      () => { near = { lat: 24.8607, lng: 67.0011 }; toast('Could not get your location — showing Karachi'); load(); }, { timeout: 8000 });
  });

  view.querySelector('#add-btn')?.addEventListener('click', () => {
    const box = view.querySelector('#add');
    box.innerHTML = String(html`<form class="card" id="cf"><h2>Add a health camp</h2>
      <p class="small muted">${mapObj ? 'Click the map to set the location, or type coordinates.' : 'Enter coordinates (from your phone’s maps app).'}</p>
      <div class="form-grid">
        <div class="field"><label for="f-name">Camp name</label><input id="f-name" name="name" required placeholder="Free eye camp"></div>
        <div class="field"><label for="f-organizer">Organiser</label><input id="f-organizer" name="organizer" required></div>
        <div class="field"><label for="f-starts_at">Starts</label><input id="f-starts_at" name="starts_at" type="datetime-local" required></div>
        <div class="field"><label for="f-ends_at">Ends</label><input id="f-ends_at" name="ends_at" type="datetime-local" required></div>
        <div class="field"><label for="f-city">City</label><input id="f-city" name="city" required></div>
        <div class="field"><label for="f-province">Province</label><select id="f-province" name="province">${PROVINCES.map((p) => html`<option>${p}</option>`)}</select></div>
        <div class="field"><label for="f-lat">Latitude</label><input id="f-lat" name="lat" type="number" step="any" required></div>
        <div class="field"><label for="f-lng">Longitude</label><input id="f-lng" name="lng" type="number" step="any" required></div>
      </div>
      <div class="field"><label for="f-services">Services (comma-separated)</label><input id="f-services" name="services" placeholder="Eye screening, free glasses"></div>
      <label class="check"><input type="checkbox" name="female_doctor"> Female doctor available</label><p></p>
      <button class="btn btn-primary" type="submit">Submit camp</button></form>`);
    if (mapObj) mapObj.map.on('click', (e) => setPick(e.latlng));
    function setPick(ll) {
      box.querySelector('[name=lat]').value = ll.lat.toFixed(5); box.querySelector('[name=lng]').value = ll.lng.toFixed(5);
      if (pickMarker) pickMarker.remove();
      pickMarker = mapObj.L.circleMarker(ll, { radius: 9, color: '#000', fillColor: COLORS.camp, fillOpacity: 1 }).addTo(mapObj.map);
    }
    onSubmit(box.querySelector('#cf'), async (d) => {
      const r = await api('/facilities', { method: 'POST', body: { ...d, type: 'camp', services: (d.services || '').split(',').map((s) => s.trim()).filter(Boolean) } });
      toast(r.verified ? 'Camp published' : 'Camp submitted — it will show as unverified until checked');
      box.innerHTML = ''; f.type = 'camp'; view.querySelector('[name=type]').value = 'camp'; load();
    });
  });

  await load();
  return () => mapObj?.map.remove();
}
