import { q, one } from '../lib/db.js';
import { json, getQuery, readBody, safeEqual, maskPhone, clean, baseUrl, normalizePhone } from '../lib/util.js';
import { sendWeeklyReport, notify } from '../lib/customers.js';
import { stripeMode, PLANS, TRIAL_DAYS } from '../lib/stripe.js';
import { twilioConfigured, sendSms } from '../lib/twilio.js';

const REP_PAY_PER_CUSTOMER = 1; // dollars per active customer per month, from the team agreement

export default async function handler(req, res) {
  const query = getQuery(req);
  const body = req.method === 'POST' ? await readBody(req) : {};
  const key = req.headers['x-admin-key'] || query.k || body.k;
  if (!process.env.ADMIN_KEY) return json(res, 503, { error: 'ADMIN_KEY is not set in Vercel.' });
  if (!safeEqual(key, process.env.ADMIN_KEY)) return json(res, 401, { error: 'Wrong admin key.' });
  const siteUrl = baseUrl(req);

  if (req.method === 'POST') {
    const a = body.action;
    if (a === 'add_rep') {
      const code = String(body.code || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
      const name = clean(body.name, 60);
      if (!code || !name) return json(res, 400, { error: 'Rep code and name are required.' });
      await q('insert into tl_reps (code, name, territory) values ($1,$2,$3) on conflict (code) do update set name = excluded.name, territory = excluded.territory', [code, name, clean(body.territory, 40) || null]);
      return json(res, 200, { ok: true, link: `${siteUrl}/join/${code}`, kit: `${siteUrl}/rep/${code}` });
    }
    if (a === 'remove_rep') {
      await q('delete from tl_reps where code = $1', [String(body.code || '')]);
      return json(res, 200, { ok: true });
    }
    if (a === 'report') {
      const c = await one('select * from tl_customers where id = $1', [Number(body.customerId)]);
      if (!c) return json(res, 404, { error: 'Customer not found.' });
      const r = await sendWeeklyReport(c, siteUrl, { dryRun: Boolean(body.dryRun) });
      return json(res, 200, { ok: true, ...r });
    }
    if (a === 'set_status') {
      const status = ['active', 'canceled', 'pending'].includes(body.status) ? body.status : null;
      if (!status) return json(res, 400, { error: 'Bad status.' });
      await q('update tl_customers set status = $1 where id = $2', [status, Number(body.customerId)]);
      return json(res, 200, { ok: true });
    }
    if (a === 'test_sms') {
      const to = normalizePhone(body.phone);
      if (!to) return json(res, 400, { error: 'Enter a US mobile number.' });
      try {
        const r = await sendSms(to, 'TeenLedger test text: texting is working.');
        return json(res, 200, { ok: true, ...r });
      } catch (e) {
        return json(res, 502, { error: String(e.message).slice(0, 200) });
      }
    }
    if (a === 'message') {
      const c = await one('select * from tl_customers where id = $1', [Number(body.customerId)]);
      if (!c) return json(res, 404, { error: 'Customer not found.' });
      const r = await notify(c, 'manual', clean(body.text, 600));
      return json(res, 200, { ok: true, ...r });
    }
    return json(res, 400, { error: 'Unknown action.' });
  }

  const customers = await q(`
    select c.id, c.first_name, c.phone, c.grade, c.plan, c.status, c.test, c.ref_code, c.weekly_budget,
           c.created_at, c.activated_at, c.connected_at, c.last_report_at,
           coalesce(w.total, 0) as week_total, coalesce(w.n, 0) as week_count, coalesce(a.n, 0) as all_count
    from tl_customers c
    left join (select customer_id, sum(amount) total, count(*) n from tl_transactions where occurred_at > now() - interval '7 days' group by customer_id) w on w.customer_id = c.id
    left join (select customer_id, count(*) n from tl_transactions group by customer_id) a on a.customer_id = c.id
    order by c.id desc limit 500`);
  const reps = await q('select * from tl_reps order by created_at');
  const feedback = await q(`select f.id, f.rating, f.message, f.page, f.created_at, c.first_name, c.id as customer_id
    from tl_feedback f left join tl_customers c on c.id = f.customer_id order by f.id desc limit 60`);
  const messages = await q(`select m.id, m.customer_id, c.first_name, m.direction, m.kind, m.body, m.status, m.error, m.created_at
    from tl_messages m left join tl_customers c on c.id = m.customer_id order by m.id desc limit 40`);

  const active = customers.filter((c) => c.status === 'active');
  const signedUp = active.filter((c) => !c.test);
  const inTrial = (c) => c.activated_at && Date.now() - new Date(c.activated_at).getTime() < TRIAL_DAYS * 864e5;
  const trialing = signedUp.filter(inTrial);
  const paying = signedUp.filter((c) => !inTrial(c));
  const mrr = paying.reduce((s, c) => s + (c.plan === 'yearly' ? PLANS.yearly.price / 12 : PLANS.monthly.price), 0);
  const repRows = reps.map((r) => {
    const mine = paying.filter((c) => c.ref_code === r.code);
    const trial = trialing.filter((c) => c.ref_code === r.code).length;
    return { ...r, link: `${siteUrl}/join/${r.code}`, kit: `${siteUrl}/rep/${r.code}`, activeCustomers: mine.length, trialCustomers: trial, monthlyEarnings: mine.length * REP_PAY_PER_CUSTOMER };
  });
  const unassigned = signedUp.filter((c) => !c.ref_code || !reps.some((r) => r.code === c.ref_code)).length;

  return json(res, 200, {
    config: { payments: stripeMode(), texting: twilioConfigured() ? 'connected' : 'preview only', cron: Boolean(process.env.CRON_SECRET), shortcutLink: Boolean(process.env.SHORTCUT_URL) },
    stats: {
      signups: customers.length,
      active: active.length,
      paying: paying.length,
      trialing: trialing.length,
      test: active.length - signedUp.length,
      canceled: customers.filter((c) => c.status === 'canceled').length,
      connected: active.filter((c) => c.connected_at).length,
      mrr: Math.round(mrr * 100) / 100,
      repPayout: repRows.reduce((s, r) => s + r.monthlyEarnings, 0),
      unassigned,
      feedback: feedback.length,
      avgRating: (() => { const r = feedback.filter((f) => f.rating); return r.length ? Math.round((r.reduce((a, f) => a + f.rating, 0) / r.length) * 10) / 10 : null; })(),
    },
    reps: repRows,
    feedback: feedback.map((f) => ({ ...f, id: Number(f.id) })),
    customers: customers.map((c) => ({ ...c, phone: maskPhone(c.phone), week_total: Number(c.week_total), week_count: Number(c.week_count), all_count: Number(c.all_count), weekly_budget: Number(c.weekly_budget) })),
    messages,
  });
}
