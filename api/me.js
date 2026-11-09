import { q, one } from '../lib/db.js';
import { json, getQuery, readBody, parseAmount, clean, baseUrl } from '../lib/util.js';
import { byToken, weekData, addTransaction, ingestUrl } from '../lib/customers.js';
import { stripeConfigured, cancelAtPeriodEnd, cancelNow } from '../lib/stripe.js';

export default async function handler(req, res) {
  const query = getQuery(req);
  const body = req.method === 'POST' ? await readBody(req) : {};
  const c = await byToken(query.t || body.t);
  if (!c) return json(res, 404, { error: 'This TeenLedger link is not valid.' });
  const siteUrl = baseUrl(req);

  if (req.method === 'POST') {
    const action = body.action;
    if (action === 'budget') {
      const v = Math.min(1000, Math.max(5, Math.round(Number(body.weeklyBudget) || 0)));
      await q('update tl_customers set weekly_budget = $1 where id = $2', [v, c.id]);
    } else if (action === 'cash') {
      const amount = parseAmount(body.amount);
      if (!amount || amount > 5000) return json(res, 400, { error: 'Enter an amount like 6.50' });
      await addTransaction(c, { amount, merchant: clean(body.merchant, 60) || 'Cash', source: 'cash' }, siteUrl);
    } else if (action === 'delete_tx') {
      await q('delete from tl_transactions where id = $1 and customer_id = $2', [Number(body.id), c.id]);
    } else if (action === 'cancel') {
      if (c.stripe_subscription_id && stripeConfigured()) {
        try {
          await cancelAtPeriodEnd(c.stripe_subscription_id);
        } catch (e) {
          return json(res, 502, { error: 'Could not cancel right now. Text HELP or email support.' });
        }
      }
      await q(`update tl_customers set status = 'canceled' where id = $1`, [c.id]);
      return json(res, 200, { ok: true, canceled: true });
    } else if (action === 'delete_account') {
      if (c.stripe_subscription_id && stripeConfigured()) {
        try {
          await cancelNow(c.stripe_subscription_id);
        } catch {
          /* already canceled */
        }
      }
      await q('delete from tl_customers where id = $1', [c.id]);
      return json(res, 200, { ok: true, deleted: true });
    } else {
      return json(res, 400, { error: 'Unknown action.' });
    }
  }

  const fresh = await one('select * from tl_customers where id = $1', [c.id]);
  const { week, summary, tips, prevTotal, days } = await weekData(fresh);
  const month = await one(`select coalesce(sum(amount),0) as s, count(*) as n from tl_transactions where customer_id = $1 and occurred_at > now() - interval '30 days'`, [c.id]);
  return json(res, 200, {
    firstName: fresh.first_name,
    status: fresh.status,
    test: fresh.test,
    plan: fresh.plan,
    weeklyBudget: Number(fresh.weekly_budget),
    connected: Boolean(fresh.connected_at),
    ingestUrl: ingestUrl(siteUrl, fresh),
    shortcutUrl: process.env.SHORTCUT_URL || null,
    summary,
    tips,
    prevTotal,
    days,
    monthTotal: Number(month.s),
    monthCount: Number(month.n),
    transactions: week.slice(0, 40).map((t) => ({ id: Number(t.id), amount: Number(t.amount), merchant: t.merchant, category: t.category, source: t.source, at: t.occurred_at })),
  });
}
