import { html, render, state, api, when, onSubmit, toast, statusTag, more } from './_shared.js';

export default async function privacy({ view }) {
  const n = await api('/privacy/notice');
  const reqs = state.user ? await api('/privacy/requests') : [];
  render(view, html`
    <h1>Your privacy</h1>
    <div class="grid-2">
      <div class="card"><h2>In plain words</h2><ul>${n.summary.map((s) => html`<li style="margin-bottom:6px">${s}</li>`)}</ul></div>
      <div class="card"><h2>Your rights</h2>
        <ul class="list">
          <li><b>See it</b> — <a href="#/records">your full record</a> and <a href="#/records/log">every access to it</a>.</li>
          <li><b>Control it</b> — <a href="#/records/consent">give and revoke consent</a>; share codes expire automatically.</li>
          <li><b>Take it</b> — download everything in the international FHIR format.</li>
          <li><b>Fix it</b> — ask us to correct something a clinician entered.</li>
          <li><b>Delete it</b> — close your account. Records the law requires (pharmacy registers, insurance claims) are kept without your identity.</li>
        </ul>
        ${state.user ? more('Make a request', html`<form id="f"><div class="field"><label for="k">Request</label><select id="k" name="kind"><option value="correct">Correct my data</option><option value="export">Full account export</option><option value="delete">Delete my account</option></select></div>
          <div class="field"><label for="d">Details</label><textarea id="d" name="detail" placeholder="What should be corrected?"></textarea></div>
          <button class="btn" type="submit">Send request</button></form>`, { hint: 'Correct, export or delete' }) : ''}
        ${reqs.length ? html`<h3 style="margin-top:16px">My requests</h3><ul class="list">${reqs.map((r) => html`<li class="row between"><span>${r.kind} · ${when(r.created_at)}</span>${statusTag(r.status === 'open' ? 'pending' : 'closed')}</li>`)}</ul>` : ''}
      </div>
    </div>
    ${more('What we keep and why', html`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Why</th><th>How long</th></tr></thead><tbody>
      ${n.categories.map((c) => html`<tr><td>${c.data}</td><td>${c.purpose}</td><td>${c.retention}</td></tr>`)}</tbody></table></div>`, { hint: `${n.categories.length} kinds of data` })}
    ${more('Law & hosting', html`<p>${n.law}</p><p>${n.hosting}</p>
      <p class="small muted">Notice version ${n.version}. Full rulebook: docs/PRIVACY_SECURITY.md in the source code.</p>`)}`);
  onSubmit(view.querySelector('#f'), async (d) => {
    if (d.kind === 'delete' && !confirm('Delete your account? This cannot be undone.')) return;
    const r = await api('/privacy/requests', { method: 'POST', body: d });
    toast(r.message);
    privacy({ view });
  });
}
