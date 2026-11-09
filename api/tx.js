import { q } from '../lib/db.js';
import { text, getQuery, readBody, parseAmount, clean, money, baseUrl } from '../lib/util.js';
import { byToken, addTransaction } from '../lib/customers.js';

// The iPhone Shortcut posts each Apple Pay tap here. Accepts JSON, form data, query params or plain text.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return text(res, 204, '');
  const query = getQuery(req);
  const body = req.method === 'GET' ? {} : await readBody(req);
  const pick = (...keys) => {
    for (const k of keys) {
      for (const src of [body, query]) {
        if (src[k] !== undefined && src[k] !== '') return src[k];
      }
    }
    return undefined;
  };

  const token = pick('t', 'token', 'key');
  const c = await byToken(token);
  if (!c) return text(res, 404, 'TeenLedger: link not recognized. Copy your link again from your TeenLedger page.');
  if (c.status !== 'active') return text(res, 403, 'TeenLedger: this account is not active.');

  let amount = parseAmount(pick('amount', 'Amount', 'a', 'value', 'total'));
  let merchant = pick('merchant', 'Merchant', 'm', 'store', 'name', 'Name', 'description');
  const card = clean(pick('card', 'Card', 'Card or Pass', 'pass') || '', 40) || null;

  // Plain text body, for example "Starbucks $5.45".
  if (amount === null && body._text) {
    amount = parseAmount(body._text);
    if (!merchant) merchant = body._text.replace(/-?\$?\s*\d+(?:[.,]\d{1,2})?/, '').trim();
  }

  // A run with no amount is the connection test from the setup page.
  if (amount === null) {
    await q('update tl_customers set connected_at = coalesce(connected_at, now()) where id = $1', [c.id]);
    return text(res, 200, `TeenLedger is connected, ${c.first_name}! Your Apple Pay taps will now log automatically.`);
  }
  if (amount <= 0 || amount > 5000) return text(res, 400, 'TeenLedger: that amount looks wrong, so it was not logged.');

  const r = await addTransaction(c, { amount, merchant: clean(merchant, 60), card, source: 'shortcut' }, baseUrl(req));
  if (r.duplicate) return text(res, 200, 'TeenLedger: already logged.');
  const left = Number(c.weekly_budget) - r.weekTotal;
  return text(res, 200, `TeenLedger logged ${money(amount)} at ${r.row.merchant}. This week: ${money(r.weekTotal)} of ${money(c.weekly_budget)}${left >= 0 ? `, ${money(left)} left.` : '.'}`);
}
