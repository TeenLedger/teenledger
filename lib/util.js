import crypto from 'node:crypto';

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const u = new URL(req.url, 'http://local');
  return Object.fromEntries(u.searchParams.entries());
}

// Reads the raw request body once. Works with the Vercel runtime and the local dev server.
export async function readRaw(req) {
  if (req.__raw !== undefined) return req.__raw;
  let raw = '';
  try {
    if (req.readable !== false && !req.readableEnded) {
      const chunks = [];
      const done = new Promise((resolve) => {
        req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on('end', resolve);
        req.on('error', resolve);
        setTimeout(resolve, 3000);
      });
      await done;
      raw = Buffer.concat(chunks).toString('utf8');
    }
  } catch {
    raw = '';
  }
  if (!raw && req.body !== undefined && req.body !== null) {
    raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  }
  req.__raw = raw;
  return raw;
}

export async function readBody(req) {
  const raw = await readRaw(req);
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!raw) return {};
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { _text: String(parsed) };
  } catch {
    if (raw.includes('=') && !raw.includes(' ') && raw.includes('&')) {
      return Object.fromEntries(new URLSearchParams(raw).entries());
    }
    return { _text: raw };
  }
}

export function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

export function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

export function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 4 ? '(***) ***-' + d.slice(-4) : '';
}

export function money(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return '$' + v.toFixed(2).replace(/\.00$/, '');
}

export function money2(n) {
  return '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'teenledger.app';
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') || String(host).startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function shortHost(url) {
  return String(url).replace(/^https?:\/\//, '');
}

export function clean(s, max = 80) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseAmount(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(Math.round(v * 100) / 100) : null;
  const m = String(v).replace(/,(?=\d{3}\b)/g, '').match(/-?\$?\s*(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? Math.abs(Math.round(n * 100) / 100) : null;
}
