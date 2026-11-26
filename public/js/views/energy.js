import { html, render, api, pkr, when, tag, tabs, onSubmit, sparkline, loading, more, peek } from './_shared.js';

const TABS = () => tabs([['#/energy', 'Facility power'], ['#/energy/solar', 'Solar calculator'], ['#/energy/app', 'This app’s footprint']], location.hash.split('?')[0] || '#/energy');
const LEVEL = { ok: ['Power OK', 'ok'], warning: ['Warning', 'warn'], critical: ['Critical', 'danger'], unknown: ['No data', ''] };

export default function energy({ view, parts }) {
  if (parts[1] === 'solar') return solar(view);
  if (parts[1] === 'app') return footprint(view);
  if (parts[1] === 'f') return facility(view, parts[2]);
  return overview(view);
}

async function overview(view) {
  render(view, html`${TABS()}${loading()}`);
  const { summary: s, facilities } = await api('/energy/facilities');
  render(view, html`${TABS()}
    <h1>Clinic & hospital energy</h1>
    <p class="muted">Power and vaccine-fridge status, live.</p>
    <div class="stats">
      <div class="stat"><div class="v">${s.monitored}</div><div class="l">Facilities monitored</div></div>
      <div class="stat"><div class="v" style="color:var(--danger)">${s.critical}</div><div class="l">Critical now</div></div>
      <div class="stat"><div class="v" style="color:var(--warn)">${s.warning}</div><div class="l">Warnings</div></div>
    </div>
    <div class="card table-wrap"><table><thead><tr><th>Facility</th><th>Status</th><th>Fridge</th></tr></thead><tbody>
      ${facilities.map((f) => html`<tr>
        <td><a href="#/energy/f/${f.id}">${f.name}</a><div class="tiny muted">${f.city}</div></td>
        <td>${tag(LEVEL[f.assessment.level][0], LEVEL[f.assessment.level][1])}
          ${peek(html`${f.assessment.alerts.map((a) => html`<div class="tiny">⚠ ${a}</div>`)}
            <div class="tiny">Grid ${f.latest.grid_on ? '✅ on' : '❌ off'}${f.latest.generator_on ? ' · ⛽ generator' : ''}<br>
            Solar ${f.latest.solar_kw ?? '—'} kW · battery ${f.latest.battery_pct != null ? `${f.latest.battery_pct}%` : '—'}<br>
            ${f.power_source}${f.solar_kw ? ` · ${f.solar_kw} kW installed` : ''}</div>`)}</td>
        <td>${f.latest.fridge_temp_c != null ? html`<span style="color:${f.latest.fridge_temp_c < 2 || f.latest.fridge_temp_c > 8 ? 'var(--danger)' : 'inherit'}">${f.latest.fridge_temp_c}°C</span>` : '—'}</td>
      </tr>`)}</tbody></table></div>
    ${more('Network totals', html`<div class="stats">
      <div class="stat"><div class="v">${s.grid_down_now}</div><div class="l">Grid down now</div></div>
      <div class="stat"><div class="v">${s.solar_facilities}</div><div class="l">On solar / hybrid</div></div>
      <div class="stat"><div class="v">${s.solar_kw_total} kW</div><div class="l">Solar capacity</div></div></div>
      <p class="tiny muted">Demo telemetry. In production, readings come from low-cost IoT gateways (inverter, battery and fridge sensors) or are entered by facility staff. Ambulances are routed away from hospitals that have lost power.</p>`)}`);
}

async function facility(view, id) {
  const r = await api(`/energy/facilities/${id}/readings?hours=48`);
  const col = (k) => r.readings.map((x) => x[k]);
  render(view, html`${TABS()}<p><a href="#/energy">← All facilities</a></p>
    <h1>${r.facility.name}</h1><p class="muted">${r.facility.power_source}${r.facility.solar_kw ? ` · ${r.facility.solar_kw} kW solar · ${r.facility.battery_kwh} kWh battery` : ''} · last 48 hours</p>
    <div class="stats">
      <div class="stat"><div class="v">${r.stats.grid_uptime_pct}%</div><div class="l">Grid uptime</div></div>
      <div class="stat"><div class="v">${r.stats.solar_share_pct}%</div><div class="l">Energy from solar</div></div>
      <div class="stat"><div class="v" style="color:${r.stats.fridge_excursions ? 'var(--danger)' : 'inherit'}">${r.stats.fridge_excursions}</div><div class="l">Fridge out of 2–8°C</div></div>
    </div>
    <div class="card"><h3>Vaccine fridge (°C) <span class="tiny muted">green band = safe 2–8°C</span></h3>${sparkline(col('fridge_temp_c'), { min: 0, max: 12, band: [2, 8], color: '#1d4ed8' })}</div>
    ${more('All power charts', html`<p class="small muted">Generator use: ${r.stats.generator_hours} h in 48 h</p><div class="grid-2">
      <div class="card"><h3>Solar output (kW)</h3>${sparkline(col('solar_kw'), { min: 0, color: '#d97706' })}</div>
      <div class="card"><h3>Load (kW)</h3>${sparkline(col('load_kw'), { min: 0 })}</div>
      <div class="card"><h3>Battery (%)</h3>${sparkline(col('battery_pct'), { min: 0, max: 100, color: '#16a34a' })}</div>
      <div class="card"><h3>Grid on/off</h3>${sparkline(col('grid_on'), { min: 0, max: 1, color: '#6b7280' })}</div>
    </div>`, { hint: 'Solar, load, battery, grid' })}
    ${!r.facility.solar_kw ? html`<div class="notice">This facility has no solar. <a href="#/energy/solar?kwh=${Math.round(r.stats.load_kwh / 2)}">Estimate a solar system for it</a>.</div>` : ''}`);
}

function solar(view) {
  const kwh = new URLSearchParams(location.hash.split('?')[1] || '').get('kwh') || 40;
  render(view, html`${TABS()}
    <div class="grid-2">
      <form class="card" id="f"><h2>Solar for my clinic</h2>
        <p class="small muted">Three numbers from your bill give an estimate.</p>
        <div class="form-grid">
          <div class="field"><label for="f-dailyKwh">Daily electricity use (kWh)</label><input id="f-dailyKwh" name="dailyKwh" type="number" step="any" value="${kwh}" required><div class="hint">Your monthly bill units ÷ 30</div></div>
          <div class="field"><label for="f-outageHours">Load-shedding hours/day</label><input id="f-outageHours" name="outageHours" type="number" step="any" value="6"></div>
          <div class="field"><label for="f-criticalLoadKw">Critical load during outage (kW)</label><input id="f-criticalLoadKw" name="criticalLoadKw" type="number" step="any" value="2"><div class="hint">Fridge, lights, oxygen, fans</div></div>
        </div>
        <details class="peek" style="margin-bottom:12px"><summary>Costs & tariffs</summary><div class="peek-body">
        <p class="tiny muted">Uses Pakistan’s sun hours and NEPRA’s February 2026 net-billing rules. Change any number to match your quotes.</p>
        <div class="form-grid">
          <div class="field"><label for="f-gridTariff">Grid tariff (Rs/kWh)</label><input id="f-gridTariff" name="gridTariff" type="number" step="any" value="60"></div>
          <div class="field"><label for="f-panelCostPerWatt">Panel+inverter cost (Rs/W)</label><input id="f-panelCostPerWatt" name="panelCostPerWatt" type="number" step="any" value="55"></div>
          <div class="field"><label for="f-batteryCostPerKwh">Battery cost (Rs/kWh)</label><input id="f-batteryCostPerKwh" name="batteryCostPerKwh" type="number" step="any" value="45000"></div>
          <div class="field"><label for="f-exportRate">Export rate (Rs/kWh)</label><input id="f-exportRate" name="exportRate" type="number" step="any" value="11"><div class="hint">Net-billing buyback — check current NEPRA rate</div></div>
          <div class="field"><label for="f-dieselCostPerKwh">Diesel cost (Rs/kWh)</label><input id="f-dieselCostPerKwh" name="dieselCostPerKwh" type="number" step="any" value="95"></div>
        </div></div></details>
        <button class="btn btn-primary" type="submit">Calculate</button>
      </form>
      <div id="out"></div>
    </div>`);
  const form = view.querySelector('#f');
  onSubmit(form, async (d) => {
    const { dailyKwh, outageHours, criticalLoadKw, ...a } = d;
    const r = await api('/energy/solar-calculator', { method: 'POST', body: { dailyKwh, outageHours, criticalLoadKw, assumptions: a } });
    view.querySelector('#out').innerHTML = String(html`<div class="card"><h2>Recommended system</h2>
      <div class="stats">
        <div class="stat"><div class="v">${pkr(r.capexPkr)}</div><div class="l">Estimated cost</div></div>
        <div class="stat"><div class="v">${pkr(r.annualSavingsPkr)}</div><div class="l">Savings / year</div></div>
        <div class="stat"><div class="v">${r.paybackYears} yrs</div><div class="l">Payback</div></div>
      </div>
      ${peek(html`<p class="small"><b>${r.pvKw} kW</b> solar panels · <b>${r.batteryKwh} kWh</b> battery · ${r.co2AvoidedTonnesPerYear} t CO₂ avoided a year</p>
        <p class="small">Generates about ${r.annualGenerationKwh.toLocaleString()} kWh a year. The battery keeps the critical load running through ${d.outageHours || 6} hours of load-shedding.</p>
        <p class="tiny muted">Estimate only. Get quotes from AEDB-certified installers. Clinics serving low-income areas may qualify for donor-funded solarisation (World Bank, ADB, Gavi programmes).</p>`, 'System size & notes')}</div>`);
  });
  form.requestSubmit();
}

async function footprint(view) {
  const r = await api('/energy/platform');
  render(view, html`${TABS()}
    <h1>This app’s own footprint</h1>
    <p class="muted">Mobile data is expensive and many phones are entry-level. Every screen is built to download as little as possible and drain little battery.</p>
    <div class="stats">
      <div class="stat"><div class="v">${r.app_shell_kb_gzip} KB</div><div class="l">Whole app, compressed (one-time)</div></div>
      <div class="stat"><div class="v">${r.est_grams_co2_per_first_load} g</div><div class="l">CO₂ per first load (est.)</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h2>How</h2><ul>${r.practices.map((p) => html`<li>${p}</li>`)}</ul></div>
      <div class="card table-wrap"><h2>Files</h2><table><thead><tr><th>File</th><th class="right">Compressed</th></tr></thead><tbody>
        ${r.files.map((f) => html`<tr><td class="small">${f.file}</td><td class="right small">${(f.gzip / 1024).toFixed(1)} KB</td></tr>`)}</tbody></table>
        <p class="tiny muted">The map library (~40 KB) and map tiles load only on map screens, and never in low-data mode.</p></div>
    </div>`);
}
void when;
