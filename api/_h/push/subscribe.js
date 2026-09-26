// POST /api/push/subscribe   { subscription, role?, user_label? }
//   Auth: Bearer <staff token> OR ?portal_token= OR admin secret.
//   Saves a PushSubscription tied to the caller's restaurant.
// DELETE /api/push/subscribe  { endpoint }   removes a subscription.

import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyToken as verifyStaffToken } from '../staff/login.js';
import { verifyManagerToken } from '../portal/manager-token.js';

function callerRestaurantId(req) {
  const auth = req.headers.authorization || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (tok) {
    const s = verifyStaffToken(tok);
    if (s) return { restaurant_id: s.restaurant_id, role: 'staff' };
  }
  const pt = req.headers['x-portal-token'] || req.query?.portal_token;
  if (pt) {
    const m = verifyManagerToken(pt);
    if (m) return { restaurant_id: m.restaurant_id, role: 'manager' };
  }
  return null;
}

export default async function handler(req, res) {
  const caller = callerRestaurantId(req);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  if (req.method === 'DELETE') {
    const endpoint = body.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    // Scope by caller's restaurant so any authenticated staff/manager
    // can't wipe another restaurant's subscription just by knowing the
    // endpoint URL.
    await supabaseAdmin.from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('restaurant_id', caller.restaurant_id);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { subscription, role, user_label } = body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'subscription required' });
  }

  // Race-safe: single upsert keyed on endpoint. Two concurrent subscribe
  // calls for the same endpoint no longer both insert.
  await supabaseAdmin.from('push_subscriptions').upsert({
    restaurant_id: caller.restaurant_id,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    role: role || caller.role,
    user_label: user_label || null,
    active: true
  }, { onConflict: 'endpoint' });
  return res.status(200).json({ ok: true });
}
