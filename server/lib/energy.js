// Facility energy & cold-chain intelligence.
// Pakistan context: long load-shedding hours, high tariffs, a solar boom, and NEPRA's
// 2026 move from net metering to net billing. All economic inputs are parameters.

export const DEFAULT_ASSUMPTIONS = {
  peakSunHours: 5.5,          // typical for most of Pakistan; northern areas lower
  systemLosses: 0.2,          // inverter, wiring, dust, heat derating
  panelCostPerWatt: 55,       // PKR/W installed panels+inverter+BOS — check current market quotes
  batteryCostPerKwh: 45000,   // PKR/kWh lithium — check current market quotes
  gridTariff: 60,             // PKR/kWh all-in commercial tariff — check your DISCO bill
  exportRate: 11,             // PKR/kWh buyback under net billing — check current NEPRA rate
  dieselCostPerKwh: 95,       // PKR/kWh generator cost
  selfConsumption: 0.8,       // share of solar used on-site (rest exported)
};

/** Classify the latest reading for a facility. */
export function assess(reading, facility) {
  if (!reading) return { level: 'unknown', alerts: ['No telemetry received'] };
  const alerts = [];
  let level = 'ok';
  const raise = (l) => { const order = { ok: 0, warning: 1, critical: 2 }; if (order[l] > order[level]) level = l; };

  if (!reading.grid_on) {
    if (reading.battery_pct != null && reading.battery_pct < 20 && !reading.generator_on) {
      raise('critical'); alerts.push(`Grid down and battery at ${reading.battery_pct}%`);
    } else if (reading.generator_on) {
      raise('warning'); alerts.push('Running on generator (high cost, emissions)');
    } else if (reading.battery_pct == null && !(reading.solar_kw > 0)) {
      raise('critical'); alerts.push('Grid down and no backup power running');
    } else {
      raise('warning'); alerts.push(reading.battery_pct != null ? `Grid down — on battery (${reading.battery_pct}%)` : 'Grid down — on solar only');
    }
  }
  if (reading.fridge_temp_c != null) {
    if (reading.fridge_temp_c < 2 || reading.fridge_temp_c > 8) {
      raise('critical'); alerts.push(`Vaccine fridge at ${reading.fridge_temp_c}°C (safe range 2–8°C)`);
    } else if (reading.fridge_temp_c > 7) {
      raise('warning'); alerts.push(`Vaccine fridge near limit (${reading.fridge_temp_c}°C)`);
    }
  }
  if (reading.load_kw && facility?.solar_kw && reading.solar_kw != null && reading.solar_kw < facility.solar_kw * 0.15 && isDaylight(reading.ts)) {
    raise('warning'); alerts.push('Solar output very low for daytime — panels may need cleaning or repair');
  }
  return { level, alerts };
}

function isDaylight(ts) {
  const h = (new Date(ts.endsWith('Z') ? ts : ts + 'Z').getUTCHours() + 5) % 24;
  return h >= 9 && h <= 16;
}

/** Can a facility accept an emergency patient right now (power-wise)? */
export function powerOk(assessment) {
  return assessment.level !== 'critical';
}

/** Solar + battery sizing and payback for a clinic. */
export function sizeSolar({ dailyKwh, outageHours = 6, criticalLoadKw = 1, a = {} }) {
  const A = { ...DEFAULT_ASSUMPTIONS, ...a };
  const pvKw = dailyKwh / (A.peakSunHours * (1 - A.systemLosses));
  const batteryKwh = criticalLoadKw * outageHours / 0.8; // 80% usable depth of discharge
  const capex = pvKw * 1000 * A.panelCostPerWatt + batteryKwh * A.batteryCostPerKwh;
  const annualGen = pvKw * A.peakSunHours * (1 - A.systemLosses) * 365;
  const selfUsed = annualGen * A.selfConsumption;
  const exported = annualGen - selfUsed;
  // Outage hours would otherwise run on diesel; normal hours on grid
  const outageShare = Math.min(1, outageHours / 24);
  const avoidedCostPerKwh = A.gridTariff * (1 - outageShare) + A.dieselCostPerKwh * outageShare;
  const annualSavings = selfUsed * avoidedCostPerKwh + exported * A.exportRate;
  const co2Tonnes = (annualGen * 0.42) / 1000; // ~0.42 kg CO2/kWh grid+diesel mix estimate
  return {
    pvKw: +pvKw.toFixed(1),
    batteryKwh: +batteryKwh.toFixed(1),
    capexPkr: Math.round(capex),
    annualGenerationKwh: Math.round(annualGen),
    annualSavingsPkr: Math.round(annualSavings),
    paybackYears: +(capex / annualSavings).toFixed(1),
    co2AvoidedTonnesPerYear: +co2Tonnes.toFixed(1),
    assumptions: A,
  };
}
