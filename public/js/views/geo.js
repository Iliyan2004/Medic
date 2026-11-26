// Health map: disease burden, facility access and medicine supply by city.
// Aggregates only (no individual locations); small counts shown as "<5".
import { html, render, state, api, tabs, tag, loading, more, peek, sparkline, esc } from './_shared.js';
import { makeMap } from './_map.js';

const TABS = () => tabs([['#/geo', 'Disease'], ['#/geo/access', 'Access to care'], ['#/geo/medicines', 'Medicine supply']], location.hash.split('?')[0] || '#/geo');
const ALERT = { rising: ['Rising', 'danger', '#dc2626'], watch: ['Watch', 'warn', '#d97706'], ok: ['Normal', 'ok', '#0d9488'] };

export default async function geo({ view, parts, params }) {
  const sub = parts[1] || 'disease';
  render(view, html`${TABS()}${loading()}`);
  let mapObj = null;
  const mapBox = () => (state.lowData ? html`<div class="notice notice-warn small">Low-data mode: map is off — showing the table.</div>` : html`<div id="gmap" class="map"></div>`);
  const initMap = async (center = [30.3753, 69.3451], zoom = 5) => { if (!state.lowData) mapObj = await makeMap(view.querySelector('#gmap'), center, zoom); return mapObj; };

  if (sub === 'access') await access(view, mapBox, initMap);
  else if (sub === 'medicines') await medicines(view, mapBox, initMap);
  else await disease(view, params, mapBox, initMap);
  return () => mapObj?.map.remove();
}

// ───────── Disease ─────────
async function disease(view, params, mapBox, initMap) {
  const [list, alerts] = await Promise.all([api('/geo/diseases'), api('/geo/alerts')]);
  const code = params.get('d') || alerts[0]?.code || 'dengue';
  const d = await api(`/geo/disease?disease=${encodeURIComponent(code)}&weeks=8`);
  const demo = d.cities.some((c) => c.sources.includes('demo reports'));
  render(view, html`${TABS()}
    <div class="page-head"><div><h1>Disease map</h1><p class="muted">Weekly cases reported by facilities, by city.</p></div>
      <select id="dsel" aria-label="Disease" style="width:auto">${list.map((x) => html`<option value="${x.code}" ${x.code === code ? 'selected' : ''}>${x.name}</option>`)}</select></div>
    ${alerts.length ? html`<div class="notice notice-danger">${alerts.map((a) => html`<div>⚠️ <b>${a.name}</b> rising in ${a.cities.join(', ')}</div>`)}</div>` : ''}
    ${demo ? html`<div class="notice notice-warn small"><b>Demo data.</b> These counts are fictional, to show how the map works. Live numbers come from facilities’ weekly reports.</div>` : ''}
    ${mapBox()}
    <div class="card" style="margin-top:16px"><h2>${d.disease.name} — last 8 weeks</h2>
      ${d.cities.length ? html`<div class="table-wrap"><table><thead><tr><th>City</th><th class="right">This week</th><th class="right">8 weeks</th><th style="width:34%">Trend</th><th>Status</th></tr></thead><tbody>
        ${d.cities.map((c) => html`<tr><td><b>${c.city}</b><div class="tiny muted">${c.province}</div></td><td class="right">${c.this_week}</td><td class="right">${c.total}</td>
          <td>${sparkline(c.trend, { min: 0, color: ALERT[c.alert][2] })}</td><td>${tag(ALERT[c.alert][0], ALERT[c.alert][1])}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">No reports for this disease in the last 8 weeks.</p>`}</div>
    ${more('How this map works', html`<ul class="small">
      <li><b>Sources:</b> weekly case counts that hospitals and clinics report (the same aggregate method as DHIS2 and the disease surveillance system), plus insurance claims with a matching ICD-10 diagnosis, placed by the treating facility’s city.</li>
      <li><b>Rising:</b> this week is at least 5 cases and above the average of the previous 4 weeks plus 2 standard deviations. <b>Watch:</b> above the average plus 1 standard deviation. The standard deviation is never taken below the square root of the average, the normal week-to-week noise in case counts, so small wobbles don’t raise alarms.</li>
      <li><b>Privacy:</b> only city totals are shown, never people or addresses. Counts from 1 to 4 appear as “&lt;5”.</li>
      <li><b>Limits:</b> it counts people who reached a reporting facility, not everyone who was ill. Cities with no reporting facility show nothing, which doesn’t mean there are no cases.</li></ul>`)}`);
  view.querySelector('#dsel').addEventListener('change', (e) => { location.hash = `#/geo?d=${e.target.value}`; });
  const m = await initMap();
  if (!m) return;
  const max = Math.max(1, ...d.cities.map((c) => (typeof c.total === 'number' ? c.total : 3)));
  for (const c of d.cities) {
    const n = typeof c.total === 'number' ? c.total : 3;
    m.L.circleMarker([c.lat, c.lng], { radius: 8 + 30 * Math.sqrt(n / max), color: '#fff', weight: 2, fillColor: ALERT[c.alert][2], fillOpacity: 0.7 })
      .bindPopup(`<b>${esc(c.city)}</b><br>${esc(d.disease.name)}: ${esc(c.this_week)} this week, ${esc(c.total)} in 8 weeks<br>${esc(ALERT[c.alert][0])}`)
      .bindTooltip(`${esc(c.city)}: ${esc(c.this_week)}`).addTo(m.map);
  }
}

// ───────── Access to care ─────────
async function access(view, mapBox, initMap) {
  const a = await api('/geo/access');
  const withGaps = a.cities.filter((c) => c.gaps.length);
  const km = (v) => (v == null ? '—' : `${v} km`);
  render(view, html`${TABS()}
    <div class="page-head"><div><h1>Access to care</h1><p class="muted">How far people are from a hospital, emergency room, lab and blood bank.</p></div></div>
    <div class="stats">
      <div class="stat"><div class="v">${a.totals.hospitals.toLocaleString()}</div><div class="l">Hospitals mapped</div></div>
      <div class="stat"><div class="v">${a.totals.facilities.toLocaleString()}</div><div class="l">Facilities mapped</div></div>
      <div class="stat"><div class="v" style="color:${withGaps.length ? 'var(--warn)' : 'inherit'}">${withGaps.length}</div><div class="l">Cities with a gap</div></div>
    </div>
    ${state.lowData ? '' : html`<div class="row" style="margin-bottom:8px"><label class="check"><input type="checkbox" id="eronly"> 24/7 ER only</label>
      <label class="check"><input type="checkbox" id="veronly"> Verified only</label><span class="tiny muted">Shaded = within 10 km of a hospital. Unshaded areas are coverage gaps.</span></div>`}
    ${mapBox()}
    <div class="card" style="margin-top:16px"><h2>By city</h2><div class="table-wrap"><table><thead><tr><th>City</th><th class="right">Hospitals ≤10 km</th><th class="right">Verified ER</th><th class="right">Lab</th><th class="right">Blood bank</th><th>Gaps</th></tr></thead><tbody>
      ${a.cities.map((c) => html`<tr><td><b>${c.city}</b><div class="tiny muted">${c.province}</div>${c.under_mapped ? html`<span class="tag tag-info" title="Fewer than 5 places mapped near the centre — likely missing from the open map, not missing care">Possibly under-mapped</span>` : ''}</td><td class="right">${c.hospitals_10km}</td>
        <td class="right">${km(c.nearest_verified_er_km)}</td><td class="right">${km(c.nearest_lab_km)}</td><td class="right">${km(c.nearest_blood_bank_km)}</td>
        <td>${c.gaps.length ? peek(html`<ul class="tiny" style="margin:0;padding-inline-start:16px">${c.gaps.map((g) => html`<li>${g}</li>`)}</ul>`, `${c.gaps.length} gap${c.gaps.length > 1 ? 's' : ''}`) : tag('Covered', 'ok')}</td></tr>`)}</tbody></table></div>
      <p class="tiny muted">Distances are straight-line from each city centre. Road travel is longer, especially in hilly or rural districts. “Possibly under-mapped” means fewer than 5 places are on the open map near the centre, so the gap may be in the data rather than in care. Help by adding facilities to OpenStreetMap / Healthsites.io.</p></div>
    ${more('About this data', html`<p class="small">Uses every facility Sehatyab knows about: licence-verified places plus ${(a.totals.facilities - a.totals.verified).toLocaleString()} community-mapped places from Healthsites.io / OpenStreetMap (© OpenStreetMap contributors, ODbL). Community-mapped places may be missing, closed or misplaced. “Verified ER” counts only Sehatyab-verified 24/7 emergency hospitals, the only ones ambulances are sent to. Most hospitals run their own lab and blood bank, which the open map rarely lists separately, so a missing standalone lab or blood bank only counts as a gap where there are fewer than 3 hospitals nearby.</p>`)}`);
  const m = await initMap();
  if (!m) return;
  const layer = m.L.layerGroup().addTo(m.map);
  const draw = () => {
    layer.clearLayers();
    const er = view.querySelector('#eronly').checked, ver = view.querySelector('#veronly').checked;
    for (const [lat, lng, f] of a.hospitals) {
      if ((er && !(f & 2)) || (ver && !(f & 1))) continue;
      m.L.circle([lat, lng], { radius: 10_000, stroke: false, fillColor: f & 1 ? '#14b8a6' : '#64748b', fillOpacity: 0.12, interactive: false }).addTo(layer);
    }
    for (const c of a.cities) {
      m.L.circleMarker([c.lat, c.lng], { radius: 7, color: '#fff', weight: 2, fillColor: c.gaps.length >= 2 ? '#dc2626' : c.gaps.length ? '#d97706' : '#16a34a', fillOpacity: 1 })
        .bindPopup(`<b>${esc(c.city)}</b><br>${c.hospitals_10km} hospitals within 10 km<br>${c.gaps.length ? esc(c.gaps.join('; ')) : 'No major gaps'}`).addTo(layer);
    }
  };
  view.querySelector('#eronly').addEventListener('change', draw);
  view.querySelector('#veronly').addEventListener('change', draw);
  draw();
}

// ───────── Medicine supply ─────────
async function medicines(view, mapBox, initMap) {
  const s = await api('/geo/supply');
  const color = (p) => (p == null ? '#64748b' : p >= 90 ? '#16a34a' : p >= 70 ? '#d97706' : '#dc2626');
  render(view, html`${TABS()}
    <div class="page-head"><div><h1>Medicine supply</h1><p class="muted">Essential medicines in stock at licensed pharmacies, by city.</p></div></div>
    ${mapBox()}
    <div class="card" style="margin-top:16px"><h2>Essential medicines available</h2>
      ${s.cities.length ? html`<ul class="list">${s.cities.map((c) => html`<li>
        <div class="row between"><b>${c.city}</b><span><b>${c.availability_pct ?? '—'}%</b> <span class="tiny muted">of ${c.essentials} · ${c.pharmacies} pharmac${c.pharmacies === 1 ? 'y' : 'ies'}</span></span></div>
        <div class="bar ${c.availability_pct < 70 ? 'danger' : c.availability_pct < 90 ? 'warn' : ''}" style="margin:6px 0"><span style="width:${c.availability_pct || 0}%"></span></div>
        ${c.otc_only ? html`<div class="notice small" style="margin:6px 0">Only medical stores here (OTC licence). By law they can’t sell prescription medicines, so a low figure means <b>no licensed pharmacy partner yet</b>, not a shortage.</div>` : ''}
        ${c.stock_outs.length ? peek(html`<ul class="small" style="margin:0;padding-inline-start:16px">${c.stock_outs.map((x) => html`<li>${x}</li>`)}</ul>`, `${c.stock_outs.length} not available`) : ''}
        ${c.low_stock.length ? html`<div class="tiny muted">Running low: ${c.low_stock.join(', ')}</div>` : ''}</li>`)}</ul>`
      : html`<p class="muted">No pharmacy stock data yet.</p>`}</div>
    ${more('About this data', html`<p class="small">Calculated from the live stock of Sehatyab partner pharmacies (${s.essentials} medicines flagged as essential, from DRAP’s price-controlled essential list in the catalogue). It covers partner pharmacies only, not every shop in the city. In the demo, pharmacies and stock are fictional.</p>`)}`);
  const m = await initMap();
  if (!m) return;
  for (const c of s.cities) {
    m.L.circleMarker([c.lat, c.lng], { radius: 14, color: '#fff', weight: 2, fillColor: color(c.availability_pct), fillOpacity: 0.85 })
      .bindPopup(`<b>${esc(c.city)}</b><br>${c.availability_pct}% of essential medicines in stock<br>${c.stock_outs.length} out of stock`).addTo(m.map);
  }
}
