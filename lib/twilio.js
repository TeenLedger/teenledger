import crypto from 'node:crypto';

const apiBase = () => (process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/$/, '');
const sid = () => process.env.TWILIO_ACCOUNT_SID || '';
const token = () => process.env.TWILIO_AUTH_TOKEN || '';
const from = () => process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER || '';
const service = () => process.env.TWILIO_MESSAGING_SERVICE_SID || '';

export const twilioConfigured = () => Boolean(sid() && token() && (from() || service()));

export async function sendSms(to, body) {
  if (!twilioConfigured()) return { status: 'preview', id: null };
  const params = new URLSearchParams({ To: to, Body: body });
  if (service()) params.set('MessagingServiceSid', service());
  else params.set('From', from());
  const r = await fetch(`${apiBase()}/2010-04-01/Accounts/${sid()}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid()}:${token()}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || `Twilio error ${r.status}`);
  return { status: data.status || 'queued', id: data.sid || null };
}

export function validTwilioSignature(url, params, signature) {
  if (!token() || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', token()).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function twiml(message) {
  const esc = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc}</Message>` : ''}</Response>`;
}
