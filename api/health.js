import { dbConfigured, ping } from '../lib/db.js';
import { json, baseUrl } from '../lib/util.js';
import { stripeMode } from '../lib/stripe.js';
import { twilioConfigured } from '../lib/twilio.js';

// Shows which services are connected. Never returns secret values.
export default async function handler(req, res) {
  let db = dbConfigured() ? 'configured' : 'missing';
  if (db === 'configured') {
    try {
      await ping();
      db = 'connected';
    } catch (e) {
      db = 'error: ' + String(e.message).slice(0, 120);
    }
  }
  json(res, 200, {
    ok: db === 'connected',
    site: baseUrl(req),
    database: db,
    payments: stripeMode(),
    webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    texting: twilioConfigured() ? 'connected' : 'preview only',
    weeklyCron: Boolean(process.env.CRON_SECRET),
    admin: Boolean(process.env.ADMIN_KEY),
    shortcutLink: Boolean(process.env.SHORTCUT_URL),
  });
}
