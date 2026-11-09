import { q, one } from '../lib/db.js';
import { text, readBody, normalizePhone, parseAmount, money, baseUrl } from '../lib/util.js';
import { validTwilioSignature, twiml } from '../lib/twilio.js';
import { addTransaction, weekData, pageLink } from '../lib/customers.js';

// Twilio inbound SMS webhook. Lets customers text cash buys ("6 lunch"), TOTAL, BUDGET 60, or HELP.
export default async function handler(req, res) {
  const params = await readBody(req);
  const siteUrl = baseUrl(req);
  const signature = req.headers['x-twilio-signature'];
  if (process.env.TWILIO_AUTH_TOKEN && !validTwilioSignature(`${siteUrl}/api/sms`, params, signature)) {
    return text(res, 403, twiml(''), 'text/xml');
  }
  const phone = normalizePhone(params.From);
  const msg = String(params.Body || '').trim();
  const c = phone ? await one(`select * from tl_customers where phone = $1 and status = 'active' order by id desc limit 1`, [phone]) : null;
  if (!c) return text(res, 200, twiml('TeenLedger: we could not find an active account for this number. Sign up at teenledger.app'), 'text/xml');
  await q('insert into tl_messages (customer_id, direction, kind, body, status) values ($1,$2,$3,$4,$5)', [c.id, 'in', 'inbound', msg.slice(0, 500), 'received']);

  const upper = msg.toUpperCase();
  // Twilio handles STOP and START itself, so those get no reply from us.
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|START|UNSTOP|YES)$/.test(upper)) return text(res, 200, twiml(''), 'text/xml');
  let reply;
  if (/^(HELP|INFO)$/.test(upper)) {
    reply = 'TeenLedger: text an amount and what it was (example: 6 lunch) to log cash. TOTAL shows this week. BUDGET 60 sets your weekly budget. STOP to opt out.';
  } else if (/^(TOTAL|WEEK|BALANCE)$/.test(upper)) {
    const { summary } = await weekData(c);
    reply = `TeenLedger: ${money(summary.total)} spent in the last 7 days on ${summary.count} buys. Budget ${money(summary.budget)}. Details: ${pageLink(siteUrl, c)}`;
  } else if (/^BUDGET\s+\$?\d+/.test(upper)) {
    const v = Math.min(1000, Math.max(5, Math.round(parseAmount(msg) || 50)));
    await q('update tl_customers set weekly_budget = $1 where id = $2', [v, c.id]);
    reply = `TeenLedger: weekly budget set to ${money(v)}.`;
  } else {
    const amount = parseAmount(msg);
    if (amount && amount <= 5000) {
      const what = msg.replace(/-?\$?\s*\d+(?:[.,]\d{1,2})?/, '').trim() || 'Cash';
      const r = await addTransaction(c, { amount, merchant: what.slice(0, 60), source: 'cash' }, siteUrl);
      reply = r.duplicate ? 'TeenLedger: already logged.' : `TeenLedger logged ${money(amount)} for ${r.row.merchant}. This week: ${money(r.weekTotal)}.`;
    } else {
      reply = 'TeenLedger: text an amount and what it was, like 6 lunch. Text HELP for more.';
    }
  }
  await q('insert into tl_messages (customer_id, direction, kind, body, status) values ($1,$2,$3,$4,$5)', [c.id, 'out', 'reply', reply, 'reply']);
  return text(res, 200, twiml(reply), 'text/xml');
}
