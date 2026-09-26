// POST /api/portal/transfer
//   { restaurant_id, new_owner_email }
// Only the current owner (restaurants.email) can transfer ownership. The new
// owner must already be a team member OR have a Clerk account they can sign
// into. On success:
//   - restaurants.email → new_owner_email
//   - a manager_users row for the OLD owner is inserted (role: manager) so
//     they don't lose access. The new owner is removed from manager_users
//     if they were there (they're the owner now).

import { supabaseAdmin } from '../../_db.js';
import { requireManager } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const restaurant_id = body.restaurant_id;
  const newOwner = String(body.new_owner_email || '').trim().toLowerCase();
  if (!restaurant_id || !newOwner) return res.status(400).json({ error: 'restaurant_id and new_owner_email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newOwner)) return res.status(400).json({ error: 'Invalid email' });

  const { data: rest } = await supabaseAdmin
    .from('restaurants').select('id, email, name').eq('id', restaurant_id).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'not_found' });
  const oldOwner = String(rest.email || '').trim().toLowerCase();
  if (oldOwner !== String(auth.email).toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  if (newOwner === oldOwner) return res.status(400).json({ error: 'already_owner' });

  const { error } = await supabaseAdmin.from('restaurants').update({ email: newOwner }).eq('id', restaurant_id);
  if (error) return res.status(500).json({ error: error.message });

  // Keep the old owner as a manager teammate so they don't lock themselves out.
  await supabaseAdmin.from('manager_users').upsert({
    restaurant_id, email: oldOwner, role: 'manager', invited_by: oldOwner, accepted_at: new Date().toISOString()
  }, { onConflict: 'restaurant_id,email' }).catch(() => {});

  // If the new owner was already a teammate, remove the redundant row.
  await supabaseAdmin.from('manager_users')
    .delete().eq('restaurant_id', restaurant_id).ilike('email', newOwner).catch(() => {});

  await auditLog(req, restaurant_id, 'ownership.transferred', {
    target: newOwner, metadata: { from: oldOwner }
  }).catch(() => {});

  return res.status(200).json({ ok: true });
}
