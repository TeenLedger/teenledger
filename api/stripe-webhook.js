import { q, one } from '../lib/db.js';
import { json, readRaw, baseUrl } from '../lib/util.js';
import { verifyWebhook } from '../lib/stripe.js';
import { activate } from '../lib/customers.js';

// Optional. Add this URL in Stripe (Developers, Webhooks) and set STRIPE_WEBHOOK_SECRET.
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  const raw = await readRaw(req);
  if (!verifyWebhook(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return json(res, 400, { error: 'Bad signature' });
  }
  const event = JSON.parse(raw);
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    const id = Number(obj.client_reference_id || obj.metadata?.tl_customer);
    const c = id ? await one('select * from tl_customers where id = $1', [id]) : null;
    if (c) await activate(c, baseUrl(req), { stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription });
  } else if (event.type === 'customer.subscription.deleted') {
    await q(`update tl_customers set status = 'canceled' where stripe_subscription_id = $1`, [obj.id]);
  } else if (event.type === 'customer.subscription.updated' && ['unpaid', 'canceled'].includes(obj.status)) {
    await q(`update tl_customers set status = 'canceled' where stripe_subscription_id = $1`, [obj.id]);
  }
  return json(res, 200, { received: true });
}
