// Community: questions answered by verified doctors, announcements, health camps, blood requests
// matched to nearby donors, awareness posts. Flagging + moderation to fight misinformation.
import express from 'express';
import { validate, bad, notFound, forbidden } from '../lib/validate.js';

const CATS = ['question', 'announcement', 'blood_request', 'camp', 'awareness', 'story'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
// Who can receive from whom (recipient → compatible donors)
const COMPATIBLE = {
  'O-': ['O-'], 'O+': ['O-', 'O+'], 'A-': ['O-', 'A-'], 'A+': ['O-', 'O+', 'A-', 'A+'],
  'B-': ['O-', 'B-'], 'B+': ['O-', 'O+', 'B-', 'B+'], 'AB-': ['O-', 'A-', 'B-', 'AB-'], 'AB+': BLOOD,
};
// Phrases that commonly signal dangerous health misinformation in Pakistan; posts are held for review.
const RISKY = [/polio.{0,20}(drops?|vaccine).{0,30}(haram|sterili[sz]|poison|kill)/i, /cure[sd]? (cancer|diabetes|hepatitis) (in|within) \d+ days/i,
  /stop (taking )?(insulin|medicine)/i, /vaccines? cause autism/i, /miracle cure/i];
const FLAG_HIDE_THRESHOLD = 3;

export default function communityRoutes({ h, auth, audit }) {
  const r = express.Router();

  const shape = (p, viewer) => ({
    ...p,
    author_name: p.anonymous && viewer?.id !== p.author_id && viewer?.role !== 'admin' ? 'Anonymous' : p.author_name,
    author_role: p.anonymous ? null : p.author_role,
    author_verified: p.anonymous ? 0 : p.author_verified,
    author_id: p.anonymous && viewer?.id !== p.author_id ? null : p.author_id,
  });

  r.get('/posts', (req, res) => {
    const cat = CATS.includes(req.query.category) ? req.query.category : '';
    const city = String(req.query.city || '').slice(0, 40);
    const rows = h.all(
      `SELECT p.*, u.name AS author_name, u.role AS author_role, u.verified AS author_verified,
         (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.status='published') AS reply_count,
         (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.verified_doctor = 1) AS doctor_replies
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.status = 'published' AND (? = '' OR p.category = ?) AND (? = '' OR p.city = ?)
       ORDER BY (p.category = 'blood_request') DESC, p.id DESC LIMIT 100`, cat, cat, city, city);
    res.json(rows.map((p) => shape(p, req.user)));
  });

  r.get('/posts/:id', (req, res) => {
    const p = h.get(`SELECT p.*, u.name AS author_name, u.role AS author_role, u.verified AS author_verified FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`, req.params.id);
    if (!p || (p.status !== 'published' && req.user?.role !== 'admin' && req.user?.id !== p.author_id)) throw notFound('Post not found');
    const replies = h.all(`SELECT r.*, u.name AS author_name, u.role AS author_role FROM replies r JOIN users u ON u.id = r.author_id
      WHERE r.post_id = ? AND r.status = 'published' ORDER BY r.verified_doctor DESC, r.id`, p.id);
    res.json({ ...shape(p, req.user), replies });
  });

  r.post('/posts', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { category: CATS, title: 'string', body: 'text', city: 'string?', blood_group: [...BLOOD, '?'], anonymous: 'bool?' });
    if (b.title.length < 5 || b.body.length < 10) throw bad('Please add a clear title and some detail');
    if (b.category === 'blood_request' && (!b.blood_group || !b.city)) throw bad('Blood requests need a blood group and city');
    if (b.category === 'announcement' && !['admin', 'facility_admin', 'program_admin', 'doctor'].includes(req.user.role)) throw forbidden('Only verified organisations and doctors can post announcements');
    if (b.anonymous && b.category !== 'question' && b.category !== 'story') throw bad('Only questions and stories can be anonymous');
    const text = `${b.title} ${b.body}`;
    const held = RISKY.some((rx) => rx.test(text));
    // Strip anything that looks like a CNIC or phone number from public posts (privacy by default), except blood requests (need contact).
    const scrub = (s) => s.replace(/\b\d{5}-?\d{7}-?\d\b/g, '[CNIC removed]').replace(b.category === 'blood_request' ? /$^/ : /\b(\+92|0)3\d{2}[\s-]?\d{7}\b/g, '[number removed]');
    const info = h.run(`INSERT INTO posts (author_id, category, title, body, city, blood_group, anonymous, status) VALUES (?,?,?,?,?,?,?,?)`,
      req.user.id, b.category, scrub(b.title), scrub(b.body), b.city ?? null, b.blood_group ?? null, b.anonymous ? 1 : 0, held ? 'flagged' : 'published');
    let notifiedDonors = 0;
    if (b.category === 'blood_request' && !held) {
      // Skip donors who gave recently: 90 days (men) / 120 days (women) between whole-blood donations.
      const donors = h.all(`SELECT id FROM users WHERE blood_donor = 1 AND deleted_at IS NULL AND guardian_id IS NULL AND city = ? AND id != ?
          AND (last_donation_date IS NULL OR date(last_donation_date, CASE WHEN gender = 'female' THEN '+120 days' ELSE '+90 days' END) <= date('now'))
          AND blood_group IN (${COMPATIBLE[b.blood_group].map(() => '?').join(',')})`,
        b.city, req.user.id, ...COMPATIBLE[b.blood_group]);
      for (const d of donors) h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'blood', ?)`, d.id, `Urgent: ${b.blood_group} blood needed in ${b.city}. Your blood type can help — see Community post #${info.lastInsertRowid}.`);
      notifiedDonors = donors.length;
    }
    audit.log(req, 'post.create', { resource: 'post', resourceId: info.lastInsertRowid, detail: { held } });
    res.status(201).json({ id: info.lastInsertRowid, status: held ? 'flagged' : 'published', notifiedDonors,
      message: held ? 'Your post is waiting for a moderator because it may contain health claims that need checking.' : undefined });
  });

  r.post('/posts/:id/replies', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { body: 'text' });
    const p = h.get(`SELECT * FROM posts WHERE id = ? AND status = 'published'`, req.params.id);
    if (!p) throw notFound('Post not found');
    const verifiedDoctor = req.user.role === 'doctor' && req.user.verified ? 1 : 0;
    const held = RISKY.some((rx) => rx.test(b.body));
    const info = h.run(`INSERT INTO replies (post_id, author_id, body, verified_doctor, status) VALUES (?,?,?,?,?)`, p.id, req.user.id, b.body, verifiedDoctor, held ? 'flagged' : 'published');
    if (p.author_id !== req.user.id) h.run(`INSERT INTO notifications (user_id, kind, message) VALUES (?, 'community', ?)`, p.author_id,
      `${verifiedDoctor ? 'A verified doctor' : 'Someone'} replied to “${p.title.slice(0, 40)}”`);
    res.status(201).json({ id: info.lastInsertRowid, status: held ? 'flagged' : 'published' });
  });

  r.post('/posts/:id/flag', auth.requireAuth, (req, res) => {
    const b = validate(req.body, { reason: ['misinformation', 'spam', 'abuse', 'privacy', 'other'] });
    const p = h.get('SELECT * FROM posts WHERE id = ?', req.params.id);
    if (!p) throw notFound();
    h.run('INSERT OR IGNORE INTO post_flags (post_id, user_id, reason) VALUES (?,?,?)', p.id, req.user.id, b.reason);
    const n = h.get('SELECT COUNT(*) AS n FROM post_flags WHERE post_id = ?', p.id).n;
    h.run(`UPDATE posts SET flags = ?, status = CASE WHEN ? >= ? AND status = 'published' THEN 'flagged' ELSE status END WHERE id = ?`, n, n, FLAG_HIDE_THRESHOLD, p.id);
    res.json({ ok: true });
  });

  // Moderation queue
  r.get('/moderation', auth.requireRole('admin'), (_req, res) => {
    res.json({
      posts: h.all(`SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.status = 'flagged' ORDER BY p.id DESC`),
      replies: h.all(`SELECT r.*, u.name AS author_name FROM replies r JOIN users u ON u.id = r.author_id WHERE r.status = 'flagged' ORDER BY r.id DESC`),
    });
  });

  r.post('/moderation/:kind/:id', auth.requireRole('admin'), (req, res) => {
    const b = validate(req.body, { action: ['publish', 'remove'] });
    const table = req.params.kind === 'reply' ? 'replies' : 'posts';
    h.run(`UPDATE ${table} SET status = ? WHERE id = ?`, b.action === 'publish' ? 'published' : 'removed', req.params.id);
    audit.log(req, `moderation.${b.action}`, { resource: table, resourceId: req.params.id });
    res.json({ ok: true });
  });

  return r;
}
