// End to end test of every customer and business flow against the local server.
import crypto from 'node:crypto';
import { start } from './server.js';

let pass = 0;
let fail = 0;
const log = [];
function ok(cond, name, extra = '') {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`);
}

async function call(base, path, { method = 'GET', json, form, text, headers = {}, redirect = 'follow' } = {}) {
  const opts = { method, headers: { ...headers }, redirect };
  if (json !== undefined) { opts.body = JSON.stringify(json); opts.headers['Content-Type'] = 'application/json'; }
  if (form !== undefined) { opts.body = new URLSearchParams(form).toString(); opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (text !== undefined) { opts.body = text; opts.headers['Content-Type'] = 'text/plain'; }
  const r = await fetch(base + path, opts);
  const raw = await r.text();
  let body = raw;
  try { body = JSON.parse(raw); } catch {}
  return { status: r.status, body, headers: r.headers };
}

function twilioSig(url, params, token) {
  const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
  return crypto.createHmac('sha1', token).update(data).digest('base64');
}

async function liveMode() {
  const s = await start({ live: true });
  const B = s.base;
  const admin = { 'x-admin-key': 'dev-admin-key' };

  const home = await call(B, '/');
  ok(home.status === 200 && String(home.body).includes('Know where your money goes'), 'Landing page loads');
  ok(String(home.body).includes('href="/login"'), 'Landing page has a Log in button');
  for (const p of ['/welcome', '/privacy', '/terms', '/admin', '/login', '/u/abcdefghijklmnop']) {
    const r = await call(B, p);
    ok(r.status === 200, `Page ${p} loads`);
  }
  const h = await call(B, '/api/health');
  ok(h.body.database === 'connected' && h.body.payments === 'test' && h.body.texting === 'connected', 'Health shows database, Stripe, Twilio connected', JSON.stringify(h.body));

  const badAdmin = await call(B, '/api/admin', { headers: { 'x-admin-key': 'nope' } });
  ok(badAdmin.status === 401, 'Admin rejects wrong key');
  const rep = await call(B, '/api/admin', { method: 'POST', headers: admin, json: { action: 'add_rep', name: 'Maya P.', code: 'Maya', territory: '10th grade' } });
  ok(rep.status === 200 && rep.body.link.endsWith('/join/maya') && rep.body.kit.endsWith('/rep/maya'), 'Admin adds sales rep with join link and rep kit');
  const kit0 = await call(B, '/api/rep?code=maya');
  ok(kit0.status === 200 && kit0.body.name === 'Maya P.' && kit0.body.qrSvg.startsWith('<svg') && kit0.body.stats.signups === 0, 'Rep kit returns name, QR code and zero stats');
  const kitBad = await call(B, '/api/rep?code=nobody');
  ok(kitBad.status === 404, 'Unknown rep code is rejected');
  for (const p of ['/join/maya', '/rep/maya']) { const r = await call(B, p); ok(r.status === 200 && String(r.body).includes('TeenLedger'), `Page ${p} loads`); }

  const bad1 = await call(B, '/api/signup', { method: 'POST', json: { firstName: 'Sam', phone: '123', consent: true } });
  ok(bad1.status === 400, 'Signup rejects bad phone');
  const bad2 = await call(B, '/api/signup', { method: 'POST', json: { firstName: 'Sam', phone: '6145550123', consent: false } });
  ok(bad2.status === 400, 'Signup requires text consent');

  const su = await call(B, '/api/signup', { method: 'POST', json: { firstName: 'Sam', phone: '(614) 555-0123', grade: '11th', weeklyBudget: '50', plan: 'monthly', consent: true, ref: 'maya' } });
  ok(su.status === 200 && su.body.url.includes('/__mock/checkout'), 'Signup opens Stripe Checkout', JSON.stringify(su.body));
  const sess = [...s.mock.sessions.values()][0];
  ok(sess && sess.mode === 'subscription' && sess.amount === '300' && sess.interval === 'month' && sess.trialDays === '7', 'Checkout is a $3/month subscription with 7 day free trial');

  const early = await call(B, '/api/confirm?session_id=' + sess.id);
  ok(early.status === 402, 'Confirm refuses before payment');

  const pay = await call(B, su.body.url.replace(B, ''), { redirect: 'manual' });
  ok(pay.status === 303 && pay.headers.get('location').includes('/welcome?session_id=' + sess.id), 'After payment Stripe returns to welcome page', pay.headers.get('location'));

  const conf = await call(B, '/api/confirm?session_id=' + sess.id);
  ok(conf.status === 200 && conf.body.token && conf.body.firstName === 'Sam', 'Confirm verifies payment and activates', JSON.stringify(conf.body));
  const token = conf.body.token;
  await call(B, '/api/confirm?session_id=' + sess.id);
  const welcomes = s.mock.sms.filter((m) => m.Body.includes('welcome to TeenLedger'));
  ok(welcomes.length === 1 && welcomes[0].To === '+16145550123' && welcomes[0].From === '+16145550100', 'Exactly one welcome text sent', JSON.stringify(welcomes));
  ok(welcomes[0] && welcomes[0].Body.includes('/u/' + token), 'Welcome text contains money page link');

  let me = await call(B, '/api/me?t=' + token);
  ok(me.status === 200 && me.body.connected === false && me.body.ingestUrl.endsWith('/api/tx?t=' + token), 'Money page data loads, not connected yet');

  const ping = await call(B, '/api/tx?t=' + token, { method: 'POST', json: {} });
  ok(ping.status === 200 && String(ping.body).includes('connected'), 'Shortcut test run marks account connected', ping.body);
  me = await call(B, '/api/me?t=' + token);
  ok(me.body.connected === true, 'Setup page sees connected status');
  await call(B, '/api/tx?t=' + token, { method: 'POST', json: {} });
  const connectedTexts = s.mock.sms.filter((m) => m.Body.includes("You're connected"));
  ok(connectedTexts.length === 1, 'Exactly one "you are connected" text, even if setup runs twice', String(connectedTexts.length));
  ok(connectedTexts[0] && connectedTexts[0].MediaUrl === B + '/api/vcard', 'Connected text attaches the TeenLedger contact card', JSON.stringify(connectedTexts[0] || {}));
  ok(connectedTexts[0] && connectedTexts[0].Body.includes('TeenLedger Sunday check, Sam:') && connectedTexts[0].Body.includes('/u/' + token), 'Connected text includes a sample Sunday report', (connectedTexts[0] || {}).Body);
  const vc = await call(B, '/api/vcard');
  ok(vc.status === 200 && vc.headers.get('content-type').includes('text/vcard') && String(vc.body).includes('FN:TeenLedger') && String(vc.body).includes('+16145550100'), 'Contact card has the TeenLedger name and number');

  // Login by texted code
  const lUnknown = await call(B, '/api/login', { method: 'POST', json: { action: 'send', phone: '6145559999' } });
  ok(lUnknown.status === 404, 'Login: unknown number is told to sign up');
  const lSend = await call(B, '/api/login', { method: 'POST', json: { action: 'send', phone: '(614) 555-0123' } });
  const codeMsg = s.mock.sms.filter((m) => m.Body.includes('login code')).pop();
  const code = codeMsg && codeMsg.Body.slice(0, 6);
  ok(lSend.status === 200 && /^\d{6}$/.test(code || '') && codeMsg.Body.includes('@teenledger.app #' + code), 'Login: 6 digit code texted with iPhone autofill line', codeMsg && codeMsg.Body);
  const lAgain = await call(B, '/api/login', { method: 'POST', json: { action: 'send', phone: '6145550123' } });
  ok(lAgain.status === 429, 'Login: resend is rate limited for 30 seconds');
  const lBad = await call(B, '/api/login', { method: 'POST', json: { action: 'verify', phone: '6145550123', code: code === '000000' ? '111111' : '000000' } });
  ok(lBad.status === 400, 'Login: wrong code rejected');
  const lOk = await call(B, '/api/login', { method: 'POST', json: { action: 'verify', phone: '6145550123', code } });
  ok(lOk.status === 200 && lOk.body.token === token, 'Login: right code opens the same account');
  const lReuse = await call(B, '/api/login', { method: 'POST', json: { action: 'verify', phone: '6145550123', code } });
  ok(lReuse.status === 400, 'Login: a code works only once');

  // Feedback
  const fbEmpty = await call(B, '/api/feedback', { method: 'POST', json: { t: token } });
  ok(fbEmpty.status === 400, 'Feedback: empty note rejected');
  const fbOk = await call(B, '/api/feedback', { method: 'POST', json: { t: token, rating: 4, message: 'Love it. Add a savings goal.', page: 'money' } });
  ok(fbOk.status === 200, 'Feedback saved from the money page');
  const fbAnon = await call(B, '/api/feedback', { method: 'POST', json: { rating: 2, page: 'setup' } });
  ok(fbAnon.status === 200, 'Feedback saved without an account');
  const adm = await call(B, '/api/admin', { headers: admin });
  ok(adm.body.feedback.length === 2 && adm.body.feedback.some((f) => f.first_name === 'Sam' && f.rating === 4) && adm.body.stats.avgRating === 3, 'Admin shows feedback with name and average rating', JSON.stringify(adm.body.stats));

  const t1 = await call(B, '/api/tx?t=' + token, { method: 'POST', json: { amount: '$5.45', merchant: 'Starbucks', card: 'Apple Card' } });
  ok(t1.status === 200 && String(t1.body).includes('$5.45') && String(t1.body).includes('Starbucks'), 'Shortcut JSON tap logged', t1.body);
  const dup = await call(B, '/api/tx?t=' + token, { method: 'POST', json: { amount: '$5.45', merchant: 'Starbucks' } });
  ok(String(dup.body).includes('already logged'), 'Duplicate tap within a minute ignored');
  const t2 = await call(B, '/api/tx?t=' + token, { method: 'POST', form: { amount: '12.00', merchant: 'Chipotle' } });
  ok(t2.status === 200, 'Form encoded tap logged');
  const t3 = await call(B, '/api/tx?t=' + token, { method: 'POST', text: 'Target $18.99' });
  ok(t3.status === 200 && String(t3.body).includes('$18.99'), 'Plain text tap logged', t3.body);
  const t4 = await call(B, '/api/tx?t=' + token + '&a=4.25&m=Dunkin');
  ok(t4.status === 200, 'Query string tap logged');
  const alert80 = s.mock.sms.find((m) => m.Body.includes('80%'));
  ok(Boolean(alert80), '80% budget alert texted', JSON.stringify(s.mock.sms.map((m) => m.Body.slice(0, 40))));
  const t5 = await call(B, '/api/tx?t=' + token, { method: 'POST', json: { amount: 9.5, merchant: 'Steam' } });
  ok(t5.status === 200, 'Numeric amount logged');
  const alert100 = s.mock.sms.find((m) => m.Body.includes('hit your $50 weekly budget'));
  ok(Boolean(alert100), '100% budget alert texted');
  const badAmt = await call(B, '/api/tx?t=' + token, { method: 'POST', json: { amount: '99999', merchant: 'x' } });
  ok(badAmt.status === 400, 'Silly amount rejected');
  const badTok = await call(B, '/api/tx?t=notarealtoken123', { method: 'POST', json: { amount: 3, merchant: 'x' } });
  ok(badTok.status === 404, 'Unknown link rejected');

  const cash = await call(B, '/api/me?t=' + token, { method: 'POST', json: { action: 'cash', amount: '6', merchant: 'lunch' } });
  ok(cash.status === 200 && cash.body.transactions.some((t) => t.merchant === 'lunch' && t.source === 'cash' && t.category === 'Food & Drinks'), 'Cash buy added from money page');
  const bud = await call(B, '/api/me?t=' + token, { method: 'POST', json: { action: 'budget', weeklyBudget: 75 } });
  ok(bud.body.weeklyBudget === 75, 'Budget changed to $75');
  const del = cash.body.transactions.find((t) => t.merchant === 'Dunkin');
  const afterDel = await call(B, '/api/me?t=' + token, { method: 'POST', json: { action: 'delete_tx', id: del.id } });
  ok(!afterDel.body.transactions.some((t) => t.merchant === 'Dunkin'), 'Transaction removed');
  const summary = afterDel.body.summary;
  ok(summary.total === 51.94 && summary.count === 5, 'Weekly total is correct ($51.94 over 5 buys)', JSON.stringify(summary));
  const food = summary.byCategory.find((c) => c.category === 'Food & Drinks');
  ok(food && food.total === 23.45, 'Food & Drinks category total correct', JSON.stringify(summary.byCategory));
  ok(afterDel.body.tips.length > 0, 'Tips generated: ' + (afterDel.body.tips[0] || {}).text);

  // Inbound texts
  const smsUrl = B + '/api/sms';
  const inbound = async (Body, sig) => {
    const params = { From: '+16145550123', To: '+16145550100', Body };
    return call(B, '/api/sms', { method: 'POST', form: params, headers: { 'x-twilio-signature': sig || twilioSig(smsUrl, params, 'mock-token') } });
  };
  const sms1 = await inbound('7.50 movie snacks');
  ok(String(sms1.body).includes('logged $7.50'), 'Texting "7.50 movie snacks" logs cash', sms1.body);
  const sms2 = await inbound('TOTAL');
  ok(String(sms2.body).includes("$59.44"), 'Texting TOTAL returns the week', sms2.body);
  const sms3 = await inbound('BUDGET 60');
  ok(String(sms3.body).includes('$60'), 'Texting BUDGET 60 sets budget');
  const sms4 = await inbound('6 lunch', 'badsignature');
  ok(sms4.status === 403, 'Fake Twilio request rejected');

  // Weekly report
  const cronNo = await call(B, '/api/cron/weekly');
  ok(cronNo.status === 401, 'Cron rejects requests without secret');
  const dry = await call(B, '/api/cron/weekly?dry=1', { headers: { authorization: 'Bearer dev-cron-secret' } });
  ok(dry.status === 200 && dry.body.results[0].body.startsWith('TeenLedger Sunday check, Sam:'), 'Weekly report preview built', JSON.stringify(dry.body));
  const before = s.mock.sms.length;
  const run = await call(B, '/api/cron/weekly', { headers: { authorization: 'Bearer dev-cron-secret' } });
  const weekly = s.mock.sms.slice(before).find((m) => m.Body.startsWith('TeenLedger Sunday check'));
  ok(run.status === 200 && weekly && weekly.To === '+16145550123', 'Sunday report texted');
  log.push('      Sample Sunday text:\n' + (weekly ? weekly.Body.split('\n').map((l) => '        ' + l).join('\n') : ''));

  // Yearly signup, admin numbers, cancel, delete
  const su2 = await call(B, '/api/signup', { method: 'POST', json: { firstName: 'Lee', phone: '6145550199', plan: 'yearly', consent: true } });
  const sess2 = [...s.mock.sessions.values()][1];
  ok(sess2 && sess2.amount === '3000' && sess2.interval === 'year', 'Yearly plan is $30/year');
  await call(B, su2.body.url.replace(B, ''), { redirect: 'manual' });
  const conf2 = await call(B, '/api/confirm?session_id=' + sess2.id);
  const tok2 = conf2.body.token;

  const a = await call(B, '/api/admin', { headers: admin });
  ok(a.body.stats.trialing === 2 && a.body.stats.paying === 0 && a.body.stats.mrr === 0, 'Admin shows 2 in free trial, $0 revenue yet', JSON.stringify(a.body.stats));
  const repRow = a.body.reps.find((r) => r.code === 'maya');
  ok(repRow && repRow.trialCustomers === 1 && repRow.monthlyEarnings === 0, 'Rep Maya credited 1 trial customer, pay starts after trial');
  const kit1 = await call(B, '/api/rep?code=maya');
  ok(kit1.body.stats.signups === 1 && kit1.body.stats.trialing === 1 && kit1.body.stats.earns === 0, 'Rep kit shows the rep their own signup', JSON.stringify(kit1.body.stats));
  ok(a.body.customers.every((c) => /^\(\*\*\*\) \*\*\*-\d{4}$/.test(c.phone)), 'Admin masks phone numbers');
  ok(a.body.messages.length > 0, 'Admin shows text log');

  const cancel = await call(B, '/api/me?t=' + tok2, { method: 'POST', json: { action: 'cancel' } });
  ok(cancel.status === 200 && s.mock.subs.get(sess2.subscription).cancel_at_period_end === true, 'Cancel stops Stripe renewal');
  const txCanceled = await call(B, '/api/tx?t=' + tok2, { method: 'POST', json: { amount: 3, merchant: 'x' } });
  ok(txCanceled.status === 403, 'Canceled account stops logging');
  const delAcct = await call(B, '/api/me?t=' + tok2, { method: 'POST', json: { action: 'delete_account' } });
  const gone = await call(B, '/api/me?t=' + tok2);
  ok(delAcct.status === 200 && gone.status === 404 && s.mock.subs.get(sess2.subscription).status === 'canceled', 'Delete my data removes account and subscription');

  // Stripe webhook
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const evt = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: sess.subscription } } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${ts}.${evt}`).digest('hex');
  const wbad = await call(B, '/api/stripe-webhook', { method: 'POST', text: evt, headers: { 'stripe-signature': `t=${ts},v1=deadbeef` } });
  ok(wbad.status === 400, 'Webhook rejects bad signature');
  const wok = await call(B, '/api/stripe-webhook', { method: 'POST', text: evt, headers: { 'stripe-signature': `t=${ts},v1=${sig}` } });
  const me3 = await call(B, '/api/me?t=' + token);
  ok(wok.status === 200 && me3.body.status === 'canceled', 'Webhook cancels subscription in database');
  delete process.env.STRIPE_WEBHOOK_SECRET;

  await s.close();
}

async function testMode() {
  const s = await start({ live: false });
  const B = s.base;
  const h = await call(B, '/api/health');
  ok(h.body.payments === 'off' && h.body.texting === 'preview only', 'Without keys: payments off, texts preview');
  const su = await call(B, '/api/signup', { method: 'POST', json: { firstName: 'Tess', phone: '6145550111', consent: true } });
  ok(su.status === 200 && su.body.test === true && su.body.url.startsWith('/welcome?t='), 'Test mode signup skips payment');
  const t = su.body.url.split('t=')[1];
  const conf = await call(B, '/api/confirm?t=' + t);
  ok(conf.body.test === true && conf.body.status === 'active', 'Test account is active');
  await call(B, '/api/tx?t=' + t, { method: 'POST', json: { amount: '3.25', merchant: 'Sonic' } });
  const a = await call(B, '/api/admin', { headers: { 'x-admin-key': 'dev-admin-key' } });
  ok(a.body.messages.some((m) => m.kind === 'welcome' && m.status === 'preview'), 'Welcome text saved as preview without Twilio');
  ok(a.body.stats.paying === 0 && a.body.stats.test === 1, 'Test accounts not counted as revenue');
  await s.close();
}

try {
  await liveMode();
  await testMode();
} catch (e) {
  fail++;
  log.push('CRASH ' + (e.stack || e));
}
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
