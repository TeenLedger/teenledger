import { one } from '../lib/db.js';
import { json, getQuery, baseUrl } from '../lib/util.js';
import { getCheckout } from '../lib/stripe.js';
import { activate, byToken } from '../lib/customers.js';

// Called by the welcome page after Stripe Checkout. Verifies payment with Stripe, then activates.
export default async function handler(req, res) {
  const { session_id: sessionId, t } = getQuery(req);
  const siteUrl = baseUrl(req);

  if (t) {
    const c = await byToken(t);
    if (!c) return json(res, 404, { error: 'Account not found.' });
    return json(res, 200, { token: c.token, firstName: c.first_name, status: c.status, test: c.test });
  }
  if (!sessionId) return json(res, 400, { error: 'Missing session.' });

  let session;
  try {
    session = await getCheckout(sessionId);
  } catch (e) {
    return json(res, 502, { error: 'Could not check your payment yet. Refresh in a few seconds.' });
  }
  const id = Number(session.client_reference_id || session.metadata?.tl_customer);
  let c = id ? await one('select * from tl_customers where id = $1', [id]) : null;
  if (!c) return json(res, 404, { error: 'Account not found for this payment.' });
  const paid = session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status);
  if (!paid) return json(res, 402, { error: 'Payment is not complete yet.', status: session.status });

  c = await activate(c, siteUrl, {
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
  });
  return json(res, 200, { token: c.token, firstName: c.first_name, status: c.status, test: c.test });
}
