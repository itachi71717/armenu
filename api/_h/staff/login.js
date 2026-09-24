// POST /api/staff/login  { r: slug, pin: '1234' }
// Returns a signed opaque token: base64(staffId:restaurantId:expires:sig)
// where sig = sha256(payload + STAFF_SECRET). Client stores in localStorage.
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyManagerToken } from '../portal/manager-token.js';

const SECRET = process.env.STAFF_SECRET || process.env.ADMIN_SECRET || 'dev-staff-secret';
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
  const target = hashPin(pin, rest.id);
  const { data: pinStaff } = await supabase.from('staff')
    .select('id, name, role, active').eq('restaurant_id', rest.id).eq('pin_hash', target).maybeSingle();
  if (!pinStaff || !pinStaff.active) return res.status(401).json({ error: 'wrong PIN' });
  staff = pinStaff;

  await supabaseAdmin.from('staff').update({ last_login_at: new Date().toISOString() }).eq('id', staff.id);
  const token = issueToken(staff.id, rest.id);
  return res.status(200).json({
    token,
    staff: { id: staff.id, name: staff.name, role: staff.role },
    restaurant: { id: rest.id, slug: r, name: rest.name }
  });
}
