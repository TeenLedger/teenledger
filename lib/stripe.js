import crypto from 'node:crypto';

const apiBase = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
const key = () => process.env.STRIPE_SECRET_KEY || '';

export const stripeConfigured = () => Boolean(key());
export const stripeMode = () => (!key() ? 'off' : key().startsWith('sk_live') || key().startsWith('rk_live') ? 'live' : 'test');

export const TRIAL_DAYS = 7;

export const PLANS = {
  monthly: { amount: 300, interval: 'month', label: 'TeenLedger Monthly', price: 3 },
  yearly: { amount: 3000, interval: 'year', label: 'TeenLedger Yearly', price: 30 },
};

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? flatten(item, `${name}[${i}]`, out) : out.push([`${name}[${i}]`, String(item)])));
    else if (typeof v === 'object') flatten(v, name, out);
    else out.push([name, String(v)]);
  }
  return out;
}

export async function stripe(method, path, params) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
  };
  let url = `${apiBase()}/v1${path}`;
  if (params && method !== 'GET') opts.body = new URLSearchParams(flatten(params)).toString();
  if (params && method === 'GET') url += '?' + new URLSearchParams(flatten(params)).toString();
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Stripe error ${r.status}`);
  return data;
}

export function createCheckout({ customer, plan, siteUrl }) {
  const p = PLANS[plan] || PLANS.monthly;
  return stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    success_url: `${siteUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/?canceled=1#signup`,
    client_reference_id: String(customer.id),
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
    metadata: { tl_customer: String(customer.id) },
    payment_method_collection: 'always',
    subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { tl_customer: String(customer.id) } },
    custom_text: { submit: { message: `Free for ${TRIAL_DAYS} days. Cancel anytime before then and you pay nothing.` } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: p.amount,
          recurring: { interval: p.interval },
          product_data: { name: p.label, description: 'Automatic Apple Pay tracking plus a weekly money text with savings tips.' },
        },
      },
    ],
  });
}

export const getCheckout = (id) => stripe('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
export const getSubscription = (id) => stripe('GET', `/subscriptions/${encodeURIComponent(id)}`);
export const cancelAtPeriodEnd = (id) => stripe('POST', `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: 'true' });
export const cancelNow = (id) => stripe('DELETE', `/subscriptions/${encodeURIComponent(id)}`);

export function verifyWebhook(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((kv) => kv.split('='))
      .filter((p) => p.length === 2 && p[0] !== 'v1')
  );
  const sigs = String(header)
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .map((kv) => kv.slice(3));
  const t = parts.t;
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
