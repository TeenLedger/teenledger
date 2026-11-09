import QRCode from 'qrcode';
import { q, one, dbConfigured } from '../lib/db.js';
import { json, getQuery, baseUrl } from '../lib/util.js';
import { TRIAL_DAYS } from '../lib/stripe.js';

const REP_PAY_PER_CUSTOMER = 1; // dollars per paying customer per month, same as admin

// Public rep kit: the rep's name, their join QR code and their own numbers. No customer details.
export default async function handler(req, res) {
  if (!dbConfigured()) return json(res, 503, { error: 'TeenLedger is finishing setup.' });
  const code = String(getQuery(req).code || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  const rep = code ? await one('select code, name from tl_reps where code = $1', [code]) : null;
  if (!rep) return json(res, 404, { error: 'Rep code not found. Ask your Sales Lead for your link.' });

  const joinLink = `${baseUrl(req)}/join/${rep.code}`;
  if (getQuery(req).name) return json(res, 200, { name: rep.name, code: rep.code });

  const rows = await q(`select status, test, activated_at, connected_at from tl_customers where ref_code = $1`, [rep.code]);
  const real = rows.filter((c) => c.status === 'active' && !c.test);
  const inTrial = (c) => c.activated_at && Date.now() - new Date(c.activated_at).getTime() < TRIAL_DAYS * 864e5;
  const paying = real.filter((c) => !inTrial(c)).length;
  const qrSvg = await QRCode.toString(joinLink, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b1b33', light: '#ffffff' } });

  return json(res, 200, {
    name: rep.name,
    code: rep.code,
    joinLink,
    qrSvg,
    stats: {
      signups: real.length,
      trialing: real.length - paying,
      paying,
      connected: real.filter((c) => c.connected_at).length,
      notConnected: real.filter((c) => !c.connected_at).length,
      earns: paying * REP_PAY_PER_CUSTOMER,
    },
  });
}
