import { q, dbConfigured } from '../lib/db.js';
import { json, readBody, clean } from '../lib/util.js';
import { byToken } from '../lib/customers.js';

// Feedback from the app. Lands in tl_feedback and shows in the admin dashboard.
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  if (!dbConfigured()) return json(res, 503, { error: 'Try again soon.' });
  const b = await readBody(req);
  const rating = Number.isInteger(Number(b.rating)) && Number(b.rating) >= 1 && Number(b.rating) <= 5 ? Number(b.rating) : null;
  const message = String(b.message || '').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, ' ').trim().slice(0, 1000);
  if (!rating && !message) return json(res, 400, { error: 'Pick a face or write a note.' });
  const c = b.t ? await byToken(b.t) : null;
  await q('insert into tl_feedback (customer_id, rating, message, page) values ($1,$2,$3,$4)', [c ? c.id : null, rating, message || null, clean(b.page, 40) || null]);
  return json(res, 200, { ok: true });
}
