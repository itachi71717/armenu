// POST /api/admin/login   { password }
// Verifies against ADMIN_SECRET and sets a signed, httpOnly cookie so the
// admin console no longer needs to stash the master password in
// sessionStorage (where XSS could read it). Cookie: `armenu_admin` with a
// short-lived HMAC signature.
//
// GET  /api/admin/login       → { authenticated: bool }
// POST /api/admin/login       → 200 sets cookie, 401 wrong password
// DELETE /api/admin/login     → clears cookie (logout)

import crypto from 'node:crypto';

const COOKIE = 'armenu_admin';
const TTL_HOURS = 12;

function sign(exp) {
  const secret = process.env.ADMIN_SECRET || '';
  return crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
}

export function readAdminCookie(req) {
  const raw = req.headers.cookie || '';
  const kv = raw.split(';').map(s => s.trim().split('='));
  const found = kv.find(([k]) => k === COOKIE);
  if (!found || !found[1]) return null;
  try {
    const [exp, sig] = decodeURIComponent(found[1]).split('.');
    if (!exp || !sig) return null;
    if (parseInt(exp, 10) < Date.now()) return null;
    if (!process.env.ADMIN_SECRET) return null;
    const expected = sign(exp);
    // Constant-time compare
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? true : null;
  } catch { return null; }
}

function setCookie(res, value, maxAgeSec) {
  const parts = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure'
  ];
  if (maxAgeSec === 0) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${maxAgeSec}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ authenticated: !!readAdminCookie(req) });
  }
  if (req.method === 'DELETE') {
    setCookie(res, '', 0);
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const pw = String(body.password || '');
    const secret = process.env.ADMIN_SECRET;
    if (!secret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
    // Constant-time password compare
    const a = Buffer.from(pw), b = Buffer.from(secret);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'wrong_password' });
    const exp = Date.now() + TTL_HOURS * 3600 * 1000;
    const value = encodeURIComponent(`${exp}.${sign(exp)}`);
    setCookie(res, value, TTL_HOURS * 3600);
    return res.status(200).json({ ok: true, expires: exp });
  }
  return res.status(405).end();
}
