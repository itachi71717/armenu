// Audit log helper. Fire-and-forget — never blocks the caller, never throws.
//
//   await auditLog(req, restaurant_id, 'dish.update', { target: dishSlug, metadata: {...} })
//
// Determines actor from headers:
//   x-admin-secret matching ADMIN_SECRET → 'admin'
//   x-portal-token OR ?portal_token       → 'manager:<restaurant_id>'
//   Bearer <staff token>                  → 'staff:<staff_id>'
//   otherwise                             → 'system'
import { supabaseAdmin } from '../_db.js';
import { verifyManagerToken } from './portal/manager-token.js';
import { verifyToken as verifyStaffToken } from './staff/login.js';

function actorFor(req) {
  if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) return 'admin';
  const pt = req.headers['x-portal-token'] || req.query?.portal_token;
  if (pt) { const v = verifyManagerToken(pt); if (v) return 'manager:' + v.restaurant_id; }
  const auth = req.headers.authorization || '';
  const st = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (st) { const v = verifyStaffToken(st); if (v) return 'staff:' + v.staff_id; }
  return 'system';
}
function ipFor(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || null;
}
export async function auditLog(req, restaurant_id, action, { target = null, metadata = {} } = {}) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      restaurant_id: restaurant_id || null,
      actor: actorFor(req),
      action, target,
      metadata,
      ip: ipFor(req)
    });
  } catch (e) {
    // Never let audit failures break the caller
    console.warn('auditLog failed:', e.message);
  }
}
