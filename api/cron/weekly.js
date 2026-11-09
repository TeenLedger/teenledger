import { q } from '../../lib/db.js';
import { json, getQuery, baseUrl, safeEqual } from '../../lib/util.js';
import { sendWeeklyReport } from '../../lib/customers.js';
import { stripeConfigured, getSubscription } from '../../lib/stripe.js';

// Runs every Sunday at 22:00 UTC (5 PM Eastern in winter, 6 PM in summer) from vercel.json.
export default async function handler(req, res) {
  const query = getQuery(req);
  const auth = String(req.headers.authorization || '');
  const cronOk = process.env.CRON_SECRET && safeEqual(auth, `Bearer ${process.env.CRON_SECRET}`);
  const adminOk = process.env.ADMIN_KEY && safeEqual(query.k || req.headers['x-admin-key'], process.env.ADMIN_KEY);
  if (!cronOk && !adminOk) return json(res, 401, { error: 'Not allowed' });

  const siteUrl = baseUrl(req);
  const dryRun = query.dry === '1';
  const only = query.customer ? Number(query.customer) : null;
  const customers = await q(`select * from tl_customers where status = 'active' ${only ? 'and id = $1' : ''} order by id`, only ? [only] : []);

  const results = [];
  for (const c of customers) {
    try {
      if (!c.test && c.stripe_subscription_id && stripeConfigured()) {
        const sub = await getSubscription(c.stripe_subscription_id).catch(() => null);
        if (sub && ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
          await q(`update tl_customers set status = 'canceled' where id = $1`, [c.id]);
          results.push({ id: c.id, skipped: 'subscription ' + sub.status });
          continue;
        }
      }
      const r = await sendWeeklyReport(c, siteUrl, { dryRun });
      results.push({ id: c.id, status: r.status, body: dryRun ? r.body : undefined, error: r.error || undefined });
    } catch (e) {
      results.push({ id: c.id, error: String(e.message).slice(0, 200) });
    }
  }
  return json(res, 200, { ok: true, dryRun, count: results.length, results });
}
