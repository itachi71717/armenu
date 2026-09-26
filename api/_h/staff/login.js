// POST /api/staff/login  { r: slug, pin: '1234' }
// Returns a signed opaque token: base64(staffId:restaurantId:expires:sig)
// where sig = sha256(payload + STAFF_SECRET). Client stores in localStorage.
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyManagerToken } from '../portal/manager-token.js';

const SECRET = process.env.STAFF_SECRET || process.env.ADMIN_SECRET || 'dev-staff-secret';

// Uses the same IP resolution logic as the dispatcher so lockouts key
// against the true client, not a spoofed x-forwarded-for.
function clientIp(req) {
  const vercel = req.headers['x-vercel-forwarded-for'];
  if (vercel) return String(vercel).split(',')[0].trim();
  const xf = req.headers['x-forwarded-for'];
  if (xf) {
    const hops = String(xf).split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
const hashPin = (pin, rid) => crypto.createHash('sha256').update(String(pin) + ':' + rid).digest('hex');

export function issueToken(staff_id, restaurant_id, hours = 12) {
  const exp = Date.now() + hours * 3600 * 1000;
  const payload = `${staff_id}:${restaurant_id}:${exp}`;
  const sig = crypto.createHash('sha256').update(payload + SECRET).digest('hex');
  return Buffer.from(payload + ':' + sig).toString('base64url');
}

export function verifyToken(token) {
  try {
    const raw = Buffer.from(String(token), 'base64url').toString();
    const [sid, rid, exp, sig] = raw.split(':');
    if (!sid || !rid || !exp || !sig) return null;
    if (parseInt(exp) < Date.now()) return null;
    const expected = crypto.createHash('sha256').update(`${sid}:${rid}:${exp}` + SECRET).digest('hex');
    if (expected !== sig) return null;
    return { staff_id: sid, restaurant_id: rid };
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { r, pin, portal_token } = body || {};
  if (!r || (!pin && !portal_token)) return res.status(400).json({ error: 'restaurant slug + pin (or portal_token) required' });

  const { data: rest } = await supabase.from('restaurants').select('id, name').eq('slug', r).single();
  if (!rest) return res.status(404).json({ error: 'restaurant not found' });

  let staff;
  if (portal_token) {
    // Manager hand-off: valid portal token for this restaurant → grant a
    // virtual manager-kiosk staff record with role 'manager'. No PIN needed.
    const v = verifyManagerToken(portal_token);
    if (!v || v.restaurant_id !== rest.id) return res.status(401).json({ error: 'invalid portal token' });
    staff = { id: 'manager-' + rest.id, name: 'Manager', role: 'manager', active: true };
    const token = issueToken(staff.id, rest.id);
    return res.status(200).json({ token, staff, restaurant: { id: rest.id, slug: r, name: rest.name } });
  }
  // Brute-force guard: PIN is only 4-6 digits, so 10k-1M candidate space.
  // Persist failed attempts and lock a (restaurant, ip) for 15 minutes after
  // 8 failures within 10 minutes. Also count global per-restaurant failures
  // to catch IP-rotation (25 within 10 min → lock the restaurant for 15 min).
  const ip = clientIp(req);
  const nowIso = new Date().toISOString();
  const windowStartIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  try {
    const { data: byIp = [] } = await supabase.from('staff_login_attempts')
      .select('id').eq('restaurant_id', rest.id).eq('ip', ip).gte('created_at', windowStartIso);
    if (byIp.length >= 8) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: 'locked_out', message: 'Too many wrong attempts. Try again in 15 minutes.' });
    }
    const { data: byRest = [] } = await supabase.from('staff_login_attempts')
      .select('id').eq('restaurant_id', rest.id).gte('created_at', windowStartIso);
    if (byRest.length >= 25) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: 'restaurant_locked_out', message: 'This restaurant is temporarily locked from PIN sign-in. Ask your manager.' });
    }
  } catch { /* table may not exist yet in dev — fall through */ }

  const target = hashPin(pin, rest.id);
  const { data: pinStaff } = await supabase.from('staff')
    .select('id, name, role, active').eq('restaurant_id', rest.id).eq('pin_hash', target).maybeSingle();
  if (!pinStaff || !pinStaff.active) {
    // Log the miss (best-effort) with a small artificial delay so timing
    // attacks can't distinguish "wrong PIN" from "no such restaurant".
    try {
      await supabaseAdmin.from('staff_login_attempts').insert({ restaurant_id: rest.id, ip, created_at: nowIso });
    } catch {}
    await new Promise(r => setTimeout(r, 250 + Math.floor(Math.random() * 250)));
    return res.status(401).json({ error: 'wrong PIN' });
  }
  staff = pinStaff;

  await supabaseAdmin.from('staff').update({ last_login_at: new Date().toISOString() }).eq('id', staff.id);
  const token = issueToken(staff.id, rest.id);
  return res.status(200).json({
    token,
    staff: { id: staff.id, name: staff.name, role: staff.role },
    restaurant: { id: rest.id, slug: r, name: rest.name }
  });
}
