import { q, one } from './db.js';
import { sendSms } from './twilio.js';
import { summarize, tipsFor, weeklySms, sampleSms, categorize } from './insights.js';
import { money, shortHost } from './util.js';

export const DAY = 24 * 60 * 60 * 1000;

export async function byToken(token) {
  if (!token || String(token).length < 10) return null;
  return one('select * from tl_customers where token = $1', [String(token)]);
}

export function pageLink(siteUrl, c) {
  return `${shortHost(siteUrl)}/u/${c.token}`;
}

export function ingestUrl(siteUrl, c) {
  return `${siteUrl}/api/tx?t=${c.token}`;
}

// Sends a text and records it. Without Twilio keys the message is stored as a preview.
export async function notify(customer, kind, body, { mediaUrl } = {}) {
  let status = 'preview';
  let providerId = null;
  let error = null;
  try {
    let r;
    try {
      r = await sendSms(customer.phone, body, { mediaUrl });
    } catch (e) {
      // A number without picture messaging rejects attachments. Send the text alone instead.
      if (!mediaUrl) throw e;
      r = await sendSms(customer.phone, body);
    }
    status = r.status;
    providerId = r.id;
  } catch (e) {
    status = 'failed';
    error = String(e.message || e).slice(0, 300);
  }
  await q('insert into tl_messages (customer_id, direction, kind, body, status, provider_id, error) values ($1,$2,$3,$4,$5,$6,$7)', [customer.id, 'out', kind, body, status, providerId, error]);
  return { status, error };
}

export async function activate(customer, siteUrl, fields = {}) {
  if (customer.status === 'active') return customer;
  // Only the request that flips the status sends the welcome text, so a refresh cannot send it twice.
  const updated = await one(
    `update tl_customers set status = 'active', activated_at = now(),
       stripe_customer_id = coalesce($2, stripe_customer_id),
       stripe_subscription_id = coalesce($3, stripe_subscription_id)
     where id = $1 and status <> 'active' returning *`,
    [customer.id, fields.stripeCustomerId || null, fields.stripeSubscriptionId || null]
  );
  if (!updated) return one('select * from tl_customers where id = $1', [customer.id]);
  await notify(
    updated,
    'welcome',
    `Hi ${updated.first_name}, welcome to TeenLedger! Finish setup in 2 minutes here: ${pageLink(siteUrl, updated)}\nYour first money check comes Sunday. Reply STOP to opt out.`
  );
  return updated;
}

export async function txSince(customerId, sinceMs, untilMs = Date.now()) {
  return q('select id, amount, merchant, category, card, source, occurred_at from tl_transactions where customer_id = $1 and occurred_at >= $2 and occurred_at < $3 order by occurred_at desc', [customerId, new Date(sinceMs).toISOString(), new Date(untilMs).toISOString()]);
}

export async function weekData(customer) {
  const now = Date.now();
  const week = await txSince(customer.id, now - 7 * DAY, now + 60000);
  const prev = await txSince(customer.id, now - 14 * DAY, now - 7 * DAY);
  const prevTotal = prev.reduce((s, t) => s + Number(t.amount), 0);
  const summary = summarize(week, customer.weekly_budget);
  const tips = tipsFor(summary, prev.length ? prevTotal : null);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(now - i * DAY);
    const label = start.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
    const key = start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const total = week.filter((t) => new Date(t.occurred_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === key).reduce((s, t) => s + Number(t.amount), 0);
    days.push({ label, total: Math.round(total * 100) / 100 });
  }
  return { week, summary, tips, prevTotal: Math.round(prevTotal * 100) / 100, days };
}

export async function addTransaction(customer, { amount, merchant, card, source }, siteUrl) {
  const name = String(merchant || '').trim() || (source === 'cash' ? 'Cash' : 'Apple Pay purchase');
  // Ignore the exact same tap reported twice within a minute.
  const dupe = await one(`select id from tl_transactions where customer_id = $1 and amount = $2 and merchant = $3 and occurred_at > now() - interval '60 seconds'`, [customer.id, amount, name]);
  if (dupe) return { duplicate: true };
  const before = await weekTotal(customer.id);
  const row = await one('insert into tl_transactions (customer_id, amount, merchant, category, card, source) values ($1,$2,$3,$4,$5,$6) returning *', [customer.id, amount, name, categorize(name, source), card || null, source || 'shortcut']);
  if (!customer.connected_at && source !== 'cash') await markConnected(customer, siteUrl);
  const after = before + Number(amount);
  await budgetAlert(customer, before, after, siteUrl);
  return { row, weekTotal: Math.round(after * 100) / 100 };
}

async function weekTotal(customerId) {
  const r = await one(`select coalesce(sum(amount),0) as s from tl_transactions where customer_id = $1 and occurred_at > now() - interval '7 days'`, [customerId]);
  return Number(r?.s || 0);
}

async function budgetAlert(customer, before, after, siteUrl) {
  const budget = Number(customer.weekly_budget || 0);
  if (!budget) return;
  let kind = null;
  if (before < budget && after >= budget) kind = 'alert100';
  else if (before < budget * 0.8 && after >= budget * 0.8) kind = 'alert80';
  if (!kind) return;
  const sent = await one(`select id from tl_messages where customer_id = $1 and kind = $2 and created_at > now() - interval '7 days'`, [customer.id, kind]);
  if (sent) return;
  const body =
    kind === 'alert100'
      ? `TeenLedger heads up: you hit your ${money(budget)} weekly budget (${money(after)} spent). See where it went: ${pageLink(siteUrl, customer)}`
      : `TeenLedger heads up: you have used 80% of your ${money(budget)} weekly budget. ${money(Math.max(0, budget - after))} left for the week.`;
  await notify(customer, kind, body);
}

export async function sendWeeklyReport(customer, siteUrl, { dryRun = false } = {}) {
  const { summary, tips } = await weekData(customer);
  const body = weeklySms(customer.first_name, summary, tips, pageLink(siteUrl, customer));
  if (dryRun) return { body, status: 'dry-run' };
  const r = await notify(customer, 'weekly', body);
  await q('update tl_customers set last_report_at = now() where id = $1', [customer.id]);
  return { body, ...r };
}

// First successful connection: flip connected_at once and send the confirmation text with a
// sample of the Sunday report and a contact card, so the teen can save the TeenLedger number.
export async function markConnected(customer, siteUrl) {
  const flipped = await one('update tl_customers set connected_at = now() where id = $1 and connected_at is null returning *', [customer.id]);
  if (!flipped) return false;
  await notify(flipped, 'connected', sampleSms(flipped.first_name, Number(flipped.weekly_budget), pageLink(siteUrl, flipped)), { mediaUrl: `${siteUrl}/api/vcard` });
  return true;
}
