// GET /api/portal/manager-token
// Manager (Clerk-signed-in) → returns a short-lived HMAC token bound to their
// restaurant. Used to hand-off into /admin/, /staff/, /kitchen/ as if they had
// full admin rights, but SCOPED to their own restaurant only.
//
// Token format: base64url(restaurant_id:role:expires:sig)  role = 'manager'
// Verified server-side by requireManagerToken() in _auth.js.

import crypto from 'node:crypto';
import { supabaseAdmin } from '../../_db.js';
import { requireManager } from '../../_auth.js';

const SECRET = process.env.STAFF_SECRET || process.env.ADMIN_SECRET || 'dev-portal-secret';

export function issueManagerToken(restaurant_id, hours = 12) {
  const exp = Date.now() + hours * 3600 * 1000;
  const payload = `${restaurant_id}:manager:${exp}`;
  const sig = crypto.createHash('sha256').update(payload + SECRET).digest('hex');
  return Buffer.from(payload + ':' + sig).toString('base64url');
}

export function verifyManagerToken(token) {
  try {
    const raw = Buffer.from(String(token), 'base64url').toString();
    const [rid, role, exp, sig] = raw.split(':');
    if (!rid || role !== 'manager' || !exp || !sig) return null;
    if (parseInt(exp) < Date.now()) return null;
    const expected = crypto.createHash('sha256').update(`${rid}:${role}:${exp}` + SECRET).digest('hex');
    if (expected !== sig) return null;
    return { restaurant_id: rid, role };
  } catch { return null; }
}

export default async function handler(req, res) {
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  // Optional ?slug= narrows to a specific restaurant (multi-location case).
  // Without it, we return a token for the primary (alphabetically first) one.
  const wantedSlug = req.query.slug;
  const email = String(auth.email || '').toLowerCase();
  let rest;
  if (wantedSlug) {
    const { data } = await supabaseAdmin.from('restaurants').select('id, slug, email').eq('slug', wantedSlug).maybeSingle();
    if (!data) return res.status(404).json({ error: 'no_restaurant_linked' });
    const isOwner = String(data.email || '').toLowerCase() === email;
    if (!isOwner) {
      // Team member? Check manager_users
      const { data: tm } = await supabaseAdmin.from('manager_users')
        .select('id').eq('restaurant_id', data.id).eq('email', email).maybeSingle();
      if (!tm) return res.status(403).json({ error: 'not your restaurant' });
    }
    rest = data;
  } else {
    const { data } = await supabaseAdmin.from('restaurants').select('id, slug').eq('email', email).order('name').limit(1).maybeSingle();
    if (data) {
      rest = data;
    } else {
      // No owned restaurant — try the first restaurant they've been invited to.
      const { data: tm } = await supabaseAdmin.from('manager_users')
        .select('restaurant_id').eq('email', email).limit(1).maybeSingle();
      if (!tm) return res.status(404).json({ error: 'no_restaurant_linked' });
      const { data: r2 } = await supabaseAdmin.from('restaurants').select('id, slug').eq('id', tm.restaurant_id).maybeSingle();
      if (!r2) return res.status(404).json({ error: 'no_restaurant_linked' });
      rest = r2;
    }
  }

  return res.status(200).json({
    token: issueManagerToken(rest.id),
    restaurant_id: rest.id,
    slug: rest.slug
  });
}
