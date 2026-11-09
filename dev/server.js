// Local stand-in for Vercel: serves /public with clean URLs, runs /api handlers,
// uses an in-memory Postgres (PGlite) and fake Stripe and Twilio endpoints.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

export async function start({ port = 0, live = true } = {}) {
  const db = new PGlite();
  globalThis.__TL_DB = { query: (sql, params) => db.query(sql, params) };
  const mock = { sessions: new Map(), sms: [], subs: new Map() };
  let base = '';

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, base);
      const p = u.pathname;

      // Fake Stripe
      if (p.startsWith('/__mock/stripe/v1/')) return mockStripe(req, res, p.slice('/__mock/stripe/v1'.length), mock, base);
      if (p === '/__mock/checkout') {
        const s = mock.sessions.get(u.searchParams.get('session'));
        s.status = 'complete';
        s.payment_status = 'paid';
        s.customer = 'cus_mock_' + s.client_reference_id;
        s.subscription = 'sub_mock_' + s.client_reference_id;
        mock.subs.set(s.subscription, { id: s.subscription, status: 'active' });
        res.writeHead(303, { Location: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id).replace('%7BCHECKOUT_SESSION_ID%7D', s.id) });
        return res.end();
      }
      // Fake Twilio
      if (p.startsWith('/__mock/twilio/')) {
        const body = await readAll(req);
        const params = Object.fromEntries(new URLSearchParams(body));
        mock.sms.push(params);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ sid: 'SM' + mock.sms.length, status: 'queued' }));
      }
      if (p === '/__mock/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ sms: mock.sms, subs: [...mock.subs.values()] }));
      }

      // API routes
      if (p.startsWith('/api/')) {
        const file = path.join(root, p + '.js');
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        const mod = await import(pathToFileURL(file).href);
        req.query = Object.fromEntries(u.searchParams.entries());
        return await mod.default(req, res);
      }

      // Static with clean URLs and the /u/:token rewrite
      let rel = p === '/' ? '/index.html' : p.startsWith('/u/') ? '/me.html' : p;
      let file = path.join(root, 'public', rel);
      if (!path.extname(file)) file += '.html';
      if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(root, 'public/404.html'))); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.SITE_URL = base;
  process.env.ADMIN_KEY = 'dev-admin-key';
  process.env.CRON_SECRET = 'dev-cron-secret';
  if (live) {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    process.env.STRIPE_API_BASE = base + '/__mock/stripe';
    process.env.TWILIO_ACCOUNT_SID = 'ACmock';
    process.env.TWILIO_AUTH_TOKEN = 'mock-token';
    process.env.TWILIO_PHONE_NUMBER = '+16145550100';
    process.env.TWILIO_API_BASE = base + '/__mock/twilio';
  } else {
    for (const k of ['STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER']) delete process.env[k];
  }
  return { base, server, db, mock, close: () => new Promise((r) => server.close(r)) };
}

async function mockStripe(req, res, p, mock, base) {
  const body = Object.fromEntries(new URLSearchParams(await readAll(req)));
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== 'Bearer sk_test_mock') return send(401, { error: { message: 'Invalid API key' } });
  if (req.method === 'POST' && p === '/checkout/sessions') {
    if (body['line_items[0][price_data][unit_amount]'] !== '300' && body['line_items[0][price_data][unit_amount]'] !== '3000') return send(400, { error: { message: 'bad amount' } });
    const id = 'cs_test_' + (mock.sessions.size + 1);
    const s = { id, object: 'checkout.session', url: `${base}/__mock/checkout?session=${id}`, status: 'open', payment_status: 'unpaid', client_reference_id: body.client_reference_id, metadata: { tl_customer: body['metadata[tl_customer]'] }, success_url: body.success_url, mode: body.mode, amount: body['line_items[0][price_data][unit_amount]'], interval: body['line_items[0][price_data][recurring][interval]'] };
    mock.sessions.set(id, s);
    return send(200, s);
  }
  let m;
  if (req.method === 'GET' && (m = p.match(/^\/checkout\/sessions\/(.+)$/))) {
    const s = mock.sessions.get(decodeURIComponent(m[1]));
    return s ? send(200, s) : send(404, { error: { message: 'No such session' } });
  }
  if ((m = p.match(/^\/subscriptions\/(.+)$/))) {
    const sub = mock.subs.get(decodeURIComponent(m[1]));
    if (!sub) return send(404, { error: { message: 'No such subscription' } });
    if (req.method === 'POST') sub.cancel_at_period_end = body.cancel_at_period_end === 'true';
    if (req.method === 'DELETE') sub.status = 'canceled';
    return send(200, sub);
  }
  return send(404, { error: { message: 'mock: unknown route ' + p } });
}

function readAll(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start({ port: Number(process.env.PORT || 3000), live: process.env.LIVE !== '0' });
  console.log('TeenLedger dev server on ' + s.base);
}
