// Load test: N concurrent virtual users for D seconds against a running server.
// Usage: npm run loadtest -- [baseUrl] [concurrency] [seconds]     e.g. npm run loadtest -- http://localhost:3000 50 15
// Mixes public reads (map, medicines, plans) with signed-in patient reads (record, reminders, card).
const [base = 'http://localhost:3000', conc = '50', secs = '15'] = process.argv.slice(2);
const C = Number(conc), D = Number(secs) * 1000;

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '03001234567', password: 'Demo@12345' }) }).then((r) => r.json());
const auth = login.token ? { authorization: `Bearer ${login.token}` } : null;
const PUBLIC = ['/api/facilities?type=hospital&city=Karachi', '/api/facilities?near=24.86,67.0&limit=50', '/api/pharmacy/products?q=para', '/api/insurance/plans', '/api/support/programs', '/'];
const PRIVATE = ['/api/records/mine', '/api/care/schedules', '/api/care/card', '/api/pharmacy/prescriptions', '/api/notifications'];

const lat = {}, errs = {};
let total = 0;
const end = Date.now() + D;
async function vu(i) {
  let n = i;
  while (Date.now() < end) {
    const priv = auth && n % 3 === 0;
    const pool = priv ? PRIVATE : PUBLIC;
    const p = pool[n++ % pool.length];
    const t0 = performance.now();
    try {
      const r = await fetch(base + p, { headers: priv ? auth : {} });
      await r.arrayBuffer();
      if (!r.ok) errs[p] = (errs[p] || 0) + 1;
    } catch { errs[p] = (errs[p] || 0) + 1; }
    (lat[p] ||= []).push(performance.now() - t0);
    total++;
  }
}
console.log(`Load test: ${C} concurrent users for ${secs}s against ${base}${auth ? ' (incl. signed-in reads)' : ''}`);
const t0 = Date.now();
await Promise.all(Array.from({ length: C }, (_, i) => vu(i)));
const elapsed = (Date.now() - t0) / 1000;
const pct = (a, q) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
console.log(`\n${total} requests in ${elapsed.toFixed(1)}s → ${(total / elapsed).toFixed(0)} req/s\n`);
console.log('endpoint'.padEnd(46), 'n'.padStart(6), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'p99 ms'.padStart(8), 'errors'.padStart(7));
for (const [p, a] of Object.entries(lat)) {
  console.log(p.slice(0, 45).padEnd(46), String(a.length).padStart(6), pct(a, 0.5).toFixed(0).padStart(8), pct(a, 0.95).toFixed(0).padStart(8), pct(a, 0.99).toFixed(0).padStart(8), String(errs[p] || 0).padStart(7));
}
const errTotal = Object.values(errs).reduce((s, x) => s + x, 0);
console.log(`\nErrors: ${errTotal} (${((errTotal / total) * 100).toFixed(2)}%)`);
