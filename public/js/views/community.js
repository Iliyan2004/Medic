import { html, render, state, api, when, tag, onSubmit, actions, toast, go, needLogin, loading, more, peek, raw } from './_shared.js';

const CATS = [['', 'All'], ['question', 'Questions'], ['blood_request', 'Blood requests'], ['awareness', 'Health tips'], ['camp', 'Camps & events'], ['announcement', 'Announcements'], ['story', 'Stories']];
const LABEL = Object.fromEntries(CATS);
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function community({ view, parts, params }) {
  if (parts[1] === 'new') return compose(view);
  if (parts[1]) return thread(view, parts[1]);
  return feed(view, params);
}

const author = (p) => html`${p.author_name}${p.author_role === 'doctor' && p.author_verified ? html` ${tag('✓ Verified doctor', 'ok')}` : ''}${['facility_admin', 'program_admin', 'admin'].includes(p.author_role) ? html` ${tag('Official', 'info')}` : ''}`;

async function feed(view, params) {
  const cat = params.get('category') || '';
  render(view, loading());
  const posts = await api(`/community/posts?category=${cat}`);
  render(view, html`
    <div class="page-head"><div><h1>Community</h1><p class="muted">Ask questions — verified doctors answer.</p></div>
      <a class="btn btn-primary" href="#/community/new">+ New post</a></div>
    <div class="tabs">${CATS.map(([v, l]) => html`<a href="#/community?category=${v}" ${v === cat ? raw('aria-current="page"') : ''}>${l}</a>`)}</div>
    <div class="card"><ul class="list">${posts.length ? posts.map((p) => html`<li>
      <div class="row between"><a href="#/community/${p.id}"><b>${p.title}</b></a>${p.category === 'blood_request' ? tag(`🩸 ${p.blood_group} needed`, 'danger') : tag(LABEL[p.category])}</div>
      <div class="tiny muted">${p.reply_count} replies${p.doctor_replies ? html` · <b style="color:var(--ok)">✓ doctor answered</b>` : ''} · ${when(p.created_at)}</div>
      ${peek(html`<div class="small" style="white-space:pre-wrap">${p.body.length > 300 ? p.body.slice(0, 300) + '…' : p.body}</div><div class="tiny muted" style="margin-top:6px">${author(p)}${p.city ? ` · ${p.city}` : ''} · <a href="#/community/${p.id}">Open thread →</a></div>`, 'Preview')}
    </li>`) : html`<li class="muted">No posts yet.</li>`}</ul></div>
    ${more('Community rules', html`<p class="small muted">Posts that look like dangerous misinformation are held for a moderator. CNIC numbers are removed automatically, and phone numbers too except on blood requests. Three reports hide a post.</p>`)}`);
}

async function thread(view, id) {
  const p = await api(`/community/posts/${id}`);
  render(view, html`<p><a href="#/community">← Community</a></p>
    <article class="card">
      <div class="row between"><h1>${p.title}</h1>${p.category === 'blood_request' ? tag(`🩸 ${p.blood_group}`, 'danger') : tag(LABEL[p.category])}</div>
      <div class="tiny muted">${author(p)} · ${p.city || ''} · ${when(p.created_at)}</div>
      <p style="margin-top:12px;white-space:pre-wrap">${p.body}</p>
      ${p.category === 'question' ? html`<p class="tiny muted">Community answers are not a diagnosis. For emergencies use the Emergency tab or call 1122.</p>` : ''}
      ${state.user ? html`<button class="btn btn-sm" data-action="flag">Report</button>` : ''}
    </article>
    <h2>${p.replies.length} replies</h2>
    ${p.replies.map((r) => html`<div class="card" style="${r.verified_doctor ? 'border-color:var(--ok)' : ''}">
      <div class="tiny muted">${r.author_name}${r.verified_doctor ? html` ${tag('✓ Verified doctor', 'ok')}` : ''} · ${when(r.created_at)}</div>
      <p style="margin:6px 0 0;white-space:pre-wrap">${r.body}</p></div>`)}
    ${state.user ? html`<form class="card" id="f"><label for="b">Your reply</label><textarea id="b" name="body" required></textarea><p></p><button class="btn btn-primary" type="submit">Reply</button></form>` : needLogin('Sign in to reply.')}
    <div id="flagbox"></div>`);
  onSubmit(view.querySelector('#f'), async (d) => {
    const r = await api(`/community/posts/${id}/replies`, { method: 'POST', body: d });
    toast(r.status === 'flagged' ? 'Your reply is waiting for a moderator' : 'Reply posted');
    thread(view, id);
  });
  actions(view, {
    flag: () => {
      view.querySelector('#flagbox').innerHTML = String(html`<form class="card" id="ff"><label for="f-reason">Why are you reporting this?</label>
        <select id="f-reason" name="reason"><option value="misinformation">Health misinformation</option><option value="privacy">Shares someone’s private information</option><option value="abuse">Abusive</option><option value="spam">Spam</option><option value="other">Other</option></select>
        <p></p><button class="btn" type="submit">Report</button></form>`);
      onSubmit(view.querySelector('#ff'), async (d) => { await api(`/community/posts/${id}/flag`, { method: 'POST', body: d }); toast('Thanks — a moderator will review it'); view.querySelector('#flagbox').innerHTML = ''; });
    },
  });
}

function compose(view) {
  if (!state.user) return render(view, needLogin('Sign in to post.'));
  render(view, html`<p><a href="#/community">← Community</a></p>
    <form class="card" id="f" style="max-width:720px"><h1>New post</h1>
      <div class="field"><label for="c">Type</label><select id="c" name="category">
        <option value="question">Health question</option><option value="blood_request">Blood request (alerts nearby donors)</option>
        <option value="awareness">Health tip</option><option value="story">My story</option><option value="camp">Camp or event</option>
        ${['doctor', 'facility_admin', 'program_admin', 'admin'].includes(state.user.role) ? html`<option value="announcement">Official announcement</option>` : ''}</select></div>
      <div class="field"><label for="t">Title</label><input id="t" name="title" required minlength="5"></div>
      <div class="field"><label for="b">Details</label><textarea id="b" name="body" required minlength="10"></textarea>
        <div class="hint">Don’t share CNIC numbers. Phone numbers are removed automatically except on blood requests.</div></div>
      <div class="form-grid">
        <div class="field"><label for="ci">City</label><input id="ci" name="city" value="${state.user.city || ''}"></div>
        <div class="field" id="bgf" hidden><label for="bg">Blood group needed</label><select id="bg" name="blood_group"><option value="">—</option>${BLOOD.map((b) => html`<option>${b}</option>`)}</select></div>
      </div>
      <label class="check" id="anonf"><input type="checkbox" name="anonymous"> Post anonymously (questions and stories)</label><p></p>
      <button class="btn btn-primary" type="submit">Post</button>
    </form>`);
  const sel = view.querySelector('#c');
  const sync = () => { view.querySelector('#bgf').hidden = sel.value !== 'blood_request'; view.querySelector('#anonf').hidden = !['question', 'story'].includes(sel.value); };
  sel.addEventListener('change', sync); sync();
  onSubmit(view.querySelector('#f'), async (d) => {
    const r = await api('/community/posts', { method: 'POST', body: d });
    if (r.message) toast(r.message); else toast(r.notifiedDonors ? `Posted — ${r.notifiedDonors} compatible donors nearby were alerted` : 'Posted');
    go(r.status === 'published' ? `#/community/${r.id}` : '#/community');
  });
}
