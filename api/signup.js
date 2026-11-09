import { q, one, dbConfigured } from '../lib/db.js';
import { json, readBody, newToken, normalizePhone, clean, baseUrl } from '../lib/util.js';
import { stripeConfigured, createCheckout, PLANS } from '../lib/stripe.js';
import { activate } from '../lib/customers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  if (!dbConfigured()) return json(res, 503, { error: 'TeenLedger is finishing setup. Please try again soon.' });
  const b = await readBody(req);
  const firstName = clean(b.firstName, 40);
  const phone = normalizePhone(b.phone);
  const plan = PLANS[b.plan] ? b.plan : 'monthly';
  const budget = Math.min(1000, Math.max(5, Math.round(Number(b.weeklyBudget) || 50)));
  const grade = clean(b.grade, 12) || null;
  const ref = String(b.ref || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || null;

  if (!firstName) return json(res, 400, { error: 'Add your first name.' });
  if (!phone) return json(res, 400, { error: 'Enter a 10 digit US mobile number.' });
  if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') {
    return json(res, 400, { error: 'Please confirm you are 13 or older and agree to get texts.' });
  }

  const siteUrl = baseUrl(req);
  const live = stripeConfigured();
  const customer = await one(
    `insert into tl_customers (token, first_name, phone, grade, weekly_budget, ref_code, plan, status, test)
     values ($1,$2,$3,$4,$5,$6,$7,'pending',$8) returning *`,
    [newToken(), firstName, phone, grade, budget, ref, plan, !live]
  );

  if (!live) {
    // Test mode: no Stripe key yet, so the account is activated without payment.
    await activate(customer, siteUrl);
    return json(res, 200, { url: `/welcome?t=${customer.token}`, test: true });
  }

  try {
    const session = await createCheckout({ customer, plan, siteUrl });
    await q('update tl_customers set stripe_session_id = $1 where id = $2', [session.id, customer.id]);
    return json(res, 200, { url: session.url });
  } catch (e) {
    await q(`update tl_customers set status = 'failed' where id = $1`, [customer.id]);
    return json(res, 502, { error: 'Payment page could not open. Please try again.', detail: String(e.message).slice(0, 200) });
  }
}
