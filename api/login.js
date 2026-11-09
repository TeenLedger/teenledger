import crypto from 'node:crypto';
import { q, one, dbConfigured } from '../lib/db.js';
import { json, readBody, normalizePhone } from '../lib/util.js';
import { notify } from '../lib/customers.js';
import { twilioConfigured } from '../lib/twilio.js';

const hash = (code, token) => crypto.createHash('sha256').update(`${code}:${token}`).digest('hex');

// Passwordless login: the customer types their phone number, gets a 6 digit code by text,
// and the code opens their money page. iPhones offer the code above the keyboard automatically.
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  if (!dbConfigured()) return json(res, 503, { error: 'TeenLedger is finishing setup. Try again soon.' });
  const b = await readBody(req);
  const phone = normalizePhone(b.phone);
  if (!phone) return json(res, 400, { error: 'Enter your 10 digit mobile number.' });
  const c = await one(`select * from tl_customers where phone = $1 and status in ('active','canceled') order by (status = 'active') desc, created_at desc limit 1`, [phone]);
  if (!c) return json(res, 404, { error: 'No TeenLedger account uses that number. Check it, or start a free week.' });

  if (b.action === 'send') {
    if (!twilioConfigured()) return json(res, 503, { error: 'Login by text is not switched on yet. Open the link in your welcome text instead.' });
    if (c.login_sent_at && Date.now() - new Date(c.login_sent_at).getTime() < 30000) {
      return json(res, 429, { error: 'Code already sent. Wait 30 seconds to get a new one.' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await q(`update tl_customers set login_code = $2, login_expires = now() + interval '10 minutes', login_tries = 0, login_sent_at = now() where id = $1`, [c.id, hash(code, c.token)]);
    const r = await notify(c, 'login', `${code} is your TeenLedger login code. It expires in 10 minutes.\n\n@teenledger.app #${code}`);
    if (r.status === 'failed') return json(res, 502, { error: 'Could not text you the code. Try again in a minute.' });
    return json(res, 200, { ok: true, sent: true });
  }

  if (b.action === 'verify') {
    const code = String(b.code || '').replace(/\D/g, '');
    if (code.length !== 6) return json(res, 400, { error: 'Enter the 6 digit code from your text.' });
    if (!c.login_code || !c.login_expires || new Date(c.login_expires).getTime() < Date.now()) {
      return json(res, 400, { error: 'That code expired. Tap "Text me a code" again.' });
    }
    if (c.login_tries >= 5) return json(res, 429, { error: 'Too many tries. Tap "Text me a code" for a new one.' });
    if (hash(code, c.token) !== c.login_code) {
      await q('update tl_customers set login_tries = login_tries + 1 where id = $1', [c.id]);
      return json(res, 400, { error: 'That code is not right. Check the text and try again.' });
    }
    await q('update tl_customers set login_code = null, login_expires = null, login_tries = 0 where id = $1', [c.id]);
    return json(res, 200, { ok: true, token: c.token, firstName: c.first_name });
  }

  return json(res, 400, { error: 'Unknown action.' });
}
