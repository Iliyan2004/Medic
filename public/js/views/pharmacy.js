import { html, render, state, api, t, pkr, when, tabs, onSubmit, actions, toast, go, needLogin, statusTag, tag, loading, raw, more, peek, apiBlobUrl, shrinkImage } from './_shared.js';

/** Load a prescription's encrypted photos into `box` as thumbnails (object URLs, never cached). */
export async function showRxPhotos(box, rxId) {
  const imgs = await api(`/pharmacy/prescriptions/${rxId}/images`);
  if (!imgs.length) { box.innerHTML = String(html`<span class="tiny muted">No photo attached.</span>`); return; }
  box.innerHTML = String(html`<div class="row">${imgs.map((i) => html`<a href="#" data-img="${i.id}" class="rx-thumb" aria-label="Open photo"><img alt="Prescription photo" data-id="${i.id}"></a>`)}</div>`);
  for (const el of box.querySelectorAll('img[data-id]')) el.src = await apiBlobUrl(`/pharmacy/rx-images/${el.dataset.id}`);
  box.addEventListener('click', (e) => { const a = e.target.closest('[data-img]'); if (!a) return; e.preventDefault(); a.classList.toggle('big'); });
}

const TABS = () => tabs([['#/pharmacy', 'Shop'], ['#/pharmacy/cart', `${t('cart')}${state.cart.length ? ` (${state.cart.reduce((s, i) => s + i.qty, 0)})` : ''}`],
  ['#/pharmacy/rx', 'Prescriptions'], ['#/pharmacy/orders', 'My orders'], ['#/pharmacy/verify', 'Is my medicine genuine?']], location.hash.split('?')[0] || '#/pharmacy');

export default function pharmacy({ view, parts, params }) {
  const sub = parts[1];
  if (sub === 'p') return product(view, parts[2]);
  if (sub === 'cart') return cart(view);
  if (sub === 'rx') return prescriptions(view);
  if (sub === 'orders') return orders(view);
  if (sub === 'verify') return verify(view);
  return shop(view, params);
}

const rxBadge = (p) => (p.schedule === 'controlled' ? tag('Not sold online', 'danger') : p.requires_rx ? tag(t('rx_required'), 'warn') : tag(t('otc'), 'ok'));

function addToCart(id, name) {
  const it = state.cart.find((i) => i.product_id === id);
  if (it) it.qty += 1; else state.cart.push({ product_id: id, qty: 1 });
  state.saveCart();
  toast(`${name} added to cart`);
}

async function shop(view, params) {
  const q = params.get('q') || '';
  const cat = params.get('category') || '';
  render(view, html`${TABS()}${loading()}`);
  const [products, cats] = await Promise.all([api(`/pharmacy/products?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`), api('/pharmacy/categories')]);
  render(view, html`${TABS()}
    <form id="s" class="row" role="search" style="margin-bottom:12px">
      <input name="q" value="${q}" placeholder="Search medicine or generic name, e.g. paracetamol" aria-label="${t('search')}" style="flex:1;min-width:200px">
      <select name="category" aria-label="Category" style="width:auto"><option value="">All categories</option>${cats.map((c) => html`<option ${c.category === cat ? 'selected' : ''}>${c.category}</option>`)}</select>
      <button class="btn btn-primary" type="submit">${t('search')}</button>
    </form>
    ${more('How ordering works', html`<p class="small muted">All pharmacies are licensed and checked. Prescription medicines are dispensed only after a pharmacist checks your prescription, as provincial Drug Rules require. Prices are capped at the printed retail price (MRP).</p>`, { hint: 'Licensed pharmacies · pharmacist-checked' })}
    <div class="grid" style="margin-top:16px">${products.map((p) => html`
      <div class="card flex">
        <div class="row between"><a href="#/pharmacy/p/${p.id}"><b>${p.name}</b></a>${rxBadge(p)}</div>
        <div class="small muted">${p.generic} ${p.strength}</div>
        <div class="row between" style="margin-top:10px">
          <div><span class="big">${pkr(p.price)}</span> ${p.price < p.mrp ? html`<span class="tiny muted"><s>${pkr(p.mrp)}</s></span>` : ''}</div>
          ${p.online_sale && p.total_stock > 0 ? html`<button class="btn btn-sm btn-primary" data-action="add" data-id="${p.id}" data-name="${p.name}">${t('add_to_cart')}</button>` : html`<span class="tag">${p.online_sale ? t('out_of_stock') : 'Visit pharmacy'}</span>`}
        </div>
        ${peek(html`<div class="small">${p.form} · ${p.manufacturer}${p.price_controlled ? html`<br>DRAP price-controlled` : ''}${p.cold_chain ? html`<br>❄️ Cold-chain delivery` : ''}<br><a href="#/pharmacy/p/${p.id}">Full details & cheaper alternatives →</a></div>`)}
      </div>`)}</div>
    ${products.length ? '' : html`<p class="muted">No medicines match your search.</p>`}`);
  import('../tools.js').then((m) => m.voiceInput(view, '#s input[name="q"]'));
  view.querySelector('#s').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    go(`#/pharmacy?q=${encodeURIComponent(f.get('q'))}&category=${encodeURIComponent(f.get('category'))}`);
  });
  actions(view, { add: ({ id, name }) => addToCart(Number(id), name) });
}

async function product(view, id) {
  const p = await api(`/pharmacy/products/${id}`);
  render(view, html`${TABS()}
    <div class="grid-2">
      <div class="card">
        <div class="row between"><h1>${p.name}</h1>${rxBadge(p)}</div>
        <p class="muted">${p.generic} · ${p.strength} · ${p.form}</p>
        <p><span class="big">${pkr(p.price)}</span> <span class="muted small">MRP ${pkr(p.mrp)}</span></p>
        ${p.schedule !== 'controlled' && p.stock.some((s) => s.stock > 0) ? html`<button class="btn btn-primary" data-action="add" data-id="${p.id}" data-name="${p.name}">${t('add_to_cart')}</button>` : ''}
        ${peek(html`<table><tbody>
          <tr><th>Manufacturer</th><td>${p.manufacturer}</td></tr>
          <tr><th>DRAP registration</th><td>${p.drap_reg_no}</td></tr>
          <tr><th>Price</th><td><b>${pkr(p.price)}</b> (MRP ${pkr(p.mrp)})${p.price_controlled ? ' · price-controlled' : ''}</td></tr>
          <tr><th>Schedule</th><td>${p.schedule}${p.schedule === 'G' ? ' — prescription; licensed pharmacy only' : p.schedule === 'B' || p.schedule === 'D' ? ' — prescription retained in register' : p.schedule === 'controlled' ? ' — controlled drug, in-person only' : ' — over the counter'}</td></tr>
          ${p.cold_chain ? html`<tr><th>Storage</th><td>❄️ 2–8°C cold chain</td></tr>` : ''}
        </tbody></table>`, 'Medicine details')}
      </div>
      <div>
        ${p.alternatives.length ? html`<div class="card"><h2>💡 Same medicine, lower price</h2><p class="small muted">Same generic and strength from another DRAP-registered maker. Ask your doctor or pharmacist before switching.</p>
          <ul class="list">${p.alternatives.map((a) => html`<li class="row between"><span><a href="#/pharmacy/p/${a.id}">${a.name}</a><br><span class="tiny muted">${a.manufacturer}</span></span><span><b>${pkr(a.price)}</b><br><span class="tiny" style="color:var(--ok)">save ${pkr(p.price - a.price)}</span></span></li>`)}</ul></div>` : ''}
        ${(() => {
          const inStock = p.stock.filter((s) => s.stock > 0);
          const low = inStock.length ? Math.min(...inStock.map((s) => s.price)) : null;
          return html`<div class="card"><h2>Compare prices</h2>
            ${p.price_controlled ? html`<p class="tiny muted">Price-controlled by DRAP — no pharmacy may charge more than ${pkr(p.mrp)}.</p>` : html`<p class="tiny muted">Printed price (MRP) ${pkr(p.mrp)}. Pharmacies may sell below it, never above.</p>`}
            <ul class="list">${p.stock.map((s) => html`<li class="row between"><span>${s.name}<br><span class="tiny muted">${s.city} · ${s.license_type === 'pharmacy' ? 'Pharmacy (pharmacist on duty)' : 'Medical store (OTC only)'}</span></span>
              <span class="right">${s.stock > 0 ? html`<b>${pkr(s.price)}</b>${s.price === low && inStock.length > 1 ? html` ${tag('Cheapest', 'ok')}` : ''}${s.price < p.mrp ? html`<div class="tiny" style="color:var(--ok)">save ${pkr(p.mrp - s.price)}</div>` : ''}` : tag(t('out_of_stock'))}</span></li>`)}</ul></div>`;
        })()}
      </div>
    </div>`);
  actions(view, { add: ({ id, name }) => addToCart(Number(id), name) });
}

async function cart(view) {
  if (!state.user) return render(view, html`${TABS()}${needLogin('Sign in to order medicines.')}`);
  if (!state.cart.length) return render(view, html`${TABS()}<div class="card"><p>Your cart is empty.</p><a class="btn btn-primary" href="#/pharmacy">Browse medicines</a></div>`);
  render(view, html`${TABS()}${loading()}`);
  const [pharmacies, rxs, support, products] = await Promise.all([
    api('/pharmacy/pharmacies'), api('/pharmacy/prescriptions'), api('/support/my').catch(() => []),
    Promise.all(state.cart.map((i) => api(`/pharmacy/products/${i.product_id}`))),
  ]);
  const needsRx = products.some((p) => p.requires_rx);
  const usableRx = rxs.filter((r) => !['rejected', 'dispensed'].includes(r.status));
  const medSupport = support.filter((s) => s.covers.includes('medicines'));
  const preselectRx = new URLSearchParams(location.hash.split('?')[1] || '').get('rx');

  render(view, html`${TABS()}
    <div class="grid-2">
      <div class="card"><h2>${t('cart')}</h2>
        <ul class="list">${state.cart.map((it, i) => { const p = products[i]; return html`<li class="row between">
          <span><b>${p.name}</b> ${p.requires_rx ? tag('Rx', 'warn') : ''}<br><span class="tiny muted">${pkr(p.price)} each</span></span>
          <span class="row"><button class="btn btn-sm" data-action="dec" data-i="${i}" aria-label="Less">−</button><b>${it.qty}</b><button class="btn btn-sm" data-action="inc" data-i="${i}" aria-label="More">+</button></span></li>`; })}</ul>
      </div>
      <form class="card" id="f"><h2>${t('checkout')}</h2>
        <div class="field"><label for="ph">Pharmacy</label><select id="ph" name="pharmacy_id" required>${pharmacies.map((ph) => html`<option value="${ph.id}" ${needsRx && ph.license_type !== 'pharmacy' ? 'disabled' : ''}>${ph.name} — ${ph.city}${ph.license_type !== 'pharmacy' ? ' (OTC only)' : ''}</option>`)}</select></div>
        ${needsRx ? html`<div class="field"><label for="rx">Prescription</label>
          <select id="rx" name="prescription_id" required><option value="">Choose…</option>${usableRx.map((r) => html`<option value="${r.id}" ${String(r.id) === preselectRx ? 'selected' : ''}>#${r.id} — ${r.source === 'e-rx' ? `e-Rx from Dr. ${r.doctor_name}` : 'uploaded'} (${r.items.map((x) => x.name).join(', ')})</option>`)}</select>
          <div class="hint">No prescription yet? <a href="#/pharmacy/rx">Add one</a>. A pharmacist checks it before dispensing.</div></div>` : ''}
        ${medSupport.length ? html`<div class="field"><label for="sub">Pay with support programme</label><select id="sub" name="subsidy_program_id"><option value="">None</option>${medSupport.map((s) => html`<option value="${s.program_id}">${s.name}${s.copay_pct ? ` (you pay ${s.copay_pct}%)` : ' (free)'}${s.per_person_annual_cap ? ` — ${pkr(s.per_person_annual_cap - s.used_this_year)} left this year` : ''}</option>`)}</select></div>`
          : html`<p class="small muted">Can’t afford it? <a href="#/support">Check if you qualify for free medicines</a>.</p>`}
        <div class="field"><label for="addr">Delivery address</label><input id="addr" name="address" required placeholder="House, street, area, city"></div>
        <div class="field"><label>Payment</label>
          <div class="row">${[['cod', 'Cash on delivery'], ['jazzcash', 'JazzCash'], ['easypaisa', 'Easypaisa'], ['raast', 'Raast'], ['card', 'Card']].map(([v, l], i) => html`<label class="check"><input type="radio" name="payment_method" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`)}</div></div>
        <div id="quote" class="notice">Fetching price…</div>
        <button class="btn btn-primary btn-block" type="submit">Place order</button>
        <p class="tiny muted" style="margin-top:8px">Payments are simulated in this prototype.</p>
      </form>
    </div>`);

  const form = view.querySelector('#f');
  const body = () => {
    const d = Object.fromEntries(new FormData(form));
    return { pharmacy_id: Number(d.pharmacy_id), items: state.cart, payment_method: d.payment_method, address: d.address || '-',
      prescription_id: d.prescription_id ? Number(d.prescription_id) : undefined, subsidy_program_id: d.subsidy_program_id ? Number(d.subsidy_program_id) : undefined };
  };
  const quote = async () => {
    const el = view.querySelector('#quote');
    try {
      const q = await api('/pharmacy/orders/quote', { method: 'POST', body: body() });
      el.className = 'notice';
      el.innerHTML = String(html`<div class="row between"><span>Medicines + delivery${q.delivery ? '' : ' (free delivery)'}</span><b>${pkr(q.subtotal)}</b></div>
        ${q.subsidy.amount ? html`<div class="row between" style="color:var(--ok)"><span>Paid by ${q.subsidy.program.name}</span><b>− ${pkr(q.subsidy.amount)}</b></div>` : ''}
        <div class="row between"><span>You pay</span><b style="font-size:1.2rem">${pkr(q.total)}</b></div>`);
    } catch (e) { el.className = 'notice notice-warn'; el.textContent = e.message; }
  };
  form.addEventListener('change', quote);
  quote();
  actions(view, {
    inc: ({ i }) => { state.cart[i].qty++; state.saveCart(); cart(view); },
    dec: ({ i }) => { if (--state.cart[i].qty <= 0) state.cart.splice(i, 1); state.saveCart(); cart(view); },
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const o = await api('/pharmacy/orders', { method: 'POST', body: body() });
      state.cart = []; state.saveCart();
      toast(o.status === 'awaiting_rx' ? 'Order placed — a pharmacist will check your prescription' : 'Order placed!');
      go('#/pharmacy/orders');
    } catch (err) { toast(err.message, true); }
  });
}

async function prescriptions(view) {
  if (!state.user) return render(view, html`${TABS()}${needLogin()}`);
  const [rx, products] = await Promise.all([api('/pharmacy/prescriptions'), api('/pharmacy/products')]);
  const rxProducts = products.filter((p) => p.requires_rx);
  render(view, html`${TABS()}
    <div class="stack">
      <div class="card" style="margin:0"><h2>My prescriptions</h2>
        <ul class="list">${rx.length ? rx.map((r) => html`<li>
          <div class="row between"><b>#${r.id} · ${r.source === 'e-rx' ? `e-prescription from Dr. ${r.doctor_name}` : 'Uploaded by me'}</b>${statusTag(r.status)}</div>
          <div class="small">${r.items.map((i) => html`${i.name} × ${i.qty}${i.dosage ? html` <span class="muted">(${i.dosage})</span>` : ''}<br>`)}</div>
          <div class="tiny muted">${when(r.created_at)}</div>
          ${r.source === 'upload' ? html`<details class="peek" data-rxphotos="${r.id}"><summary>📷 Photo</summary><div class="peek-body" id="ph${r.id}"><span class="tiny muted">Loading…</span></div></details>` : ''}
          <div class="row" style="margin:6px 0">
            <button class="btn btn-sm" data-action="remind" data-id="${r.id}">⏰ Set reminders</button>
            <a class="btn btn-sm" href="#/rx/${r.id}">🖨 Print</a></div>
          ${['pending', 'verified'].includes(r.status) ? html`<button class="btn btn-sm btn-primary" data-action="order" data-id="${r.id}" data-items='${JSON.stringify(r.items.map((i) => ({ product_id: i.product_id, qty: i.qty })))}'>Order these medicines</button>` : ''}
        </li>`) : html`<li class="muted">No prescriptions yet.</li>`}</ul>
      </div>
      ${more('+ Add a paper prescription', html`<form id="f">
        <p class="small muted">Type what is on your doctor’s prescription. Keep the paper — the pharmacist or rider will collect the original, as Drug Rules require for prescription medicines.</p>
        <div class="field"><label for="m">Medicine</label><select id="m" name="product_id" required>${rxProducts.map((p) => html`<option value="${p.id}">${p.name} (${p.generic})</option>`)}</select></div>
        <div class="form-grid"><div class="field"><label for="q">Quantity (packs)</label><input id="q" name="qty" type="number" min="1" max="20" value="1"></div>
        <div class="field"><label for="d">Dosage</label><input id="d" name="dosage" placeholder="e.g. 1 tab twice daily"></div></div>
        <div class="field"><label for="n">Doctor & notes</label><input id="n" name="notes" placeholder="Dr. name, clinic, date"></div>
        <div class="field"><label for="photo">📷 Photo of the prescription <span class="hint">(recommended — helps the pharmacist approve faster)</span></label>
          <input id="photo" type="file" accept="image/*" capture="environment">
          <div class="hint">Encrypted and only shown to you and the pharmacist who fills your order.</div></div>
        <button class="btn btn-primary" type="submit">Save prescription</button>
      </form>`, { open: !rx.length })}
    </div>`);
  onSubmit(view.querySelector('#f'), async (d) => {
    const file = view.querySelector('#photo').files[0];
    const image = file ? await shrinkImage(file) : null; // fail early on a bad file, before saving anything
    const rx = await api('/pharmacy/prescriptions', { method: 'POST', body: { items: [{ product_id: Number(d.product_id), qty: d.qty || 1, dosage: d.dosage }], notes: d.notes } });
    if (image) {
      try { await api(`/pharmacy/prescriptions/${rx.id}/images`, { method: 'POST', body: { image } }); }
      catch (e) { toast(`Prescription saved, but the photo failed: ${e.message}`, true); return prescriptions(view); }
    }
    toast(image ? 'Prescription and photo saved' : 'Prescription saved');
    prescriptions(view);
  });
  // Photos load only when opened (saves data; nothing decrypted until asked).
  view.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('[data-rxphotos]');
    if (d?.open && !d.dataset.loaded) { d.dataset.loaded = '1'; showRxPhotos(d.querySelector('.peek-body'), d.dataset.rxphotos).catch((err) => { d.querySelector('.peek-body').textContent = err.message; }); }
  }, true);
  actions(view, {
    remind: async ({ id }) => {
      const made = await api(`/care/schedules/from-rx/${id}`, { method: 'POST' });
      toast(made.length ? `Reminders set for ${made.map((m) => m.name).join(', ')}` : 'Reminders already set for this prescription');
      go('#/care');
    },
    order: ({ id, items }) => {
      for (const it of JSON.parse(items)) {
        const ex = state.cart.find((c) => c.product_id === it.product_id);
        if (ex) ex.qty = Math.max(ex.qty, it.qty); else state.cart.push(it);
      }
      state.saveCart();
      go(`#/pharmacy/cart?rx=${id}`);
    },
  });
}

async function orders(view) {
  if (!state.user) return render(view, html`${TABS()}${needLogin()}`);
  const rows = await api('/pharmacy/orders');
  render(view, html`${TABS()}<div class="card"><ul class="list">${rows.length ? rows.map((o) => html`<li>
    <div class="row between"><b>${o.items.map((i) => i.name).join(', ')}</b>${statusTag(o.status)}</div>
    <div class="small">You pay <b>${pkr(o.total)}</b> · ${when(o.created_at)}</div>
    ${peek(html`<div class="small">Order #${o.id} · ${o.pharmacy_name}<br>${o.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}<br>Total ${pkr(o.subtotal)}${o.subsidy_amount ? html` · <span style="color:var(--ok)">support paid ${pkr(o.subsidy_amount)}</span>` : ''}<br>${o.payment_method} · ${o.payment_status}</div>`)}
    ${['placed', 'awaiting_rx', 'verified'].includes(o.status) ? html`<button class="btn btn-sm" data-action="cancel" data-id="${o.id}">${t('cancel')}</button>` : ''}
  </li>`) : html`<li class="muted">No orders yet.</li>`}</ul></div>`);
  actions(view, { cancel: async ({ id }) => { await api(`/pharmacy/orders/${id}/status`, { method: 'POST', body: { status: 'cancelled' } }); toast('Order cancelled'); orders(view); } });
}

function verify(view) {
  render(view, html`${TABS()}
    <div class="grid-2">
      <form class="card" id="f"><h2>Check a medicine pack</h2>
        <p class="small muted">Type the code printed next to the 2D barcode.</p>
        ${peek(html`<p class="small muted">Since 9 October 2026, DRAP requires a 2D barcode (GS1 DataMatrix) with a unique serial number on medicine packs. Scan it with your phone camera, or type the code printed next to it.</p>`, 'Why this works')}
        <button class="btn btn-primary btn-block" type="button" data-action="scan" id="scanbtn">📷 Scan with camera</button>
        <div class="field" style="margin-top:12px"><label for="c">…or type the code</label><input id="c" name="code" required placeholder="(01)08960100000000(21)SN100001"></div>
        <button class="btn" type="submit">Check</button>
        <p class="tiny muted" style="margin-top:8px">Try a demo code: <a href="#" data-action="demo" data-code="ok">genuine</a> · <a href="#" data-action="demo" data-code="recalled">recalled</a> · <a href="#" data-action="demo" data-code="fake">unknown</a></p>
      </form>
      <div id="out"></div>
    </div>`);
  let demo = null;
  api('/pharmacy/products').then((ps) => { demo = ps[0]; }).catch(() => {});
  import('../tools.js').then((m) => { if (!m.canScan) view.querySelector('#scanbtn').hidden = true; });
  actions(view, {
    scan: async () => {
      const { scanCode } = await import('../tools.js');
      const code = await scanCode();
      if (!code) return;
      view.querySelector('#c').value = code;
      view.querySelector('#f').requestSubmit();
    },
    demo: ({ code }) => {
      if (!demo) return;
      const serial = code === 'ok' ? `SN${demo.id}00003` : code === 'recalled' ? `SN${demo.id}00019` : 'SNFAKE999';
      view.querySelector('#c').value = `(01)${demo.gtin}(21)${serial}`;
    },
  });
  onSubmit(view.querySelector('#f'), async (d) => {
    const r = await api('/pharmacy/verify-pack', { method: 'POST', body: d });
    const kind = r.verdict === 'genuine' ? 'ok' : ['already_dispensed', 'expired'].includes(r.verdict) ? 'warn' : 'danger';
    view.querySelector('#out').innerHTML = String(html`<div class="card"><div class="notice notice-${kind}"><b>${r.verdict === 'genuine' ? '✅ Genuine' : '⚠️ Warning'}</b><br>${r.message}</div>
      ${r.product ? html`<p><b>${r.product.name}</b> — ${r.product.manufacturer}<br><span class="small muted">DRAP reg. ${r.product.drap_reg_no} · batch ${r.batch || '—'} · expiry ${r.expiry || '—'}</span></p>` : ''}
      ${kind !== 'ok' ? html`<p class="small">Report suspected fake or substandard medicine to DRAP.</p>` : ''}
      <p class="tiny muted">Prototype: checks Sehatyab’s serial registry, standing in for the DRAP/GS1 traceability system.</p></div>`);
  });
}
void raw;
