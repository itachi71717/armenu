// POST /api/push/subscribe   { subscription, role?, user_label? }
//   Auth: Bearer <staff token> OR ?portal_token= OR admin secret.
//   Saves a PushSubscription tied to the caller's restaurant.
//   Guest variant: no auth, body { subscription, customer_token, r } -> stored
//   with role 'guest' and linked to customer_id (for "order ready" pushes).
// DELETE /api/push/subscribe  { endpoint }   removes a subscription.

import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyToken as verifyStaffToken } from '../staff/login.js';
import { verifyManagerToken } from '../portal/manager-token.js';

async function callerContext(req) {
  const auth = req.headers.authorization || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (tok) {
    const s = verifyStaffToken(tok);
    if (s) {
      // Manager hand-off (staff/login.js) issues a synthetic staff id of
      // form 'manager-<restaurant_uuid>' with no matching staff row — trust
      // the id prefix here so the manager kiosk keeps its 'manager' role.
      if (typeof s.staff_id === 'string' && s.staff_id.startsWith('manager-')) {
        return { restaurant_id: s.restaurant_id, role: 'manager' };
      }
      // Real staff: resolve the AUTHORITATIVE role from the staff row —
      // client body is ignored so a waiter can't self-elevate to manager.
      const { data: st } = await supabase.from('staff')
        .select('role').eq('id', s.staff_id).maybeSingle();
      const role = ['manager', 'waiter', 'kitchen'].includes(st?.role) ? st.role : 'waiter';
      return { restaurant_id: s.restaurant_id, role };
    }
  }
  const pt = req.headers['x-portal-token'] || req.query?.portal_token;
  if (pt) {
    const m = verifyManagerToken(pt);
    if (m) return { restaurant_id: m.restaurant_id, role: 'manager' };
  }
  return null;
}

const TOKEN_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// customer_token -> customer_id, following any merge chain (mirrors order.js).
async function resolveCustomerId(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  try {
    let { data: crow } = await supabase.from('customers').select('id, merged_into').eq('token', token).maybeSingle();
    let hops = 0;
    while (crow?.merged_into && hops < 5) {
      const { data: next } = await supabase.from('customers').select('id, merged_into').eq('id', crow.merged_into).maybeSingle();
      if (!next) break;
      crow = next;
      hops++;
    }
    return crow ? crow.id : null;
  } catch { return null; }
}

// Guest (diner) variant: no staff auth, identified by customer_token.
async function handleGuestSubscribe(req, res, body) {
  if (req.method !== 'POST') return res.status(401).json({ error: 'Unauthorized' });
  const { subscription, r } = body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'subscription required' });
  }
  const customer_id = await resolveCustomerId(body.customer_token);
  if (!customer_id) return res.status(401).json({ error: 'Unauthorized' });
  if (!r || typeof r !== 'string') return res.status(400).json({ error: 'r required' });
  const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', r).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'restaurant not found' });
  // Never rebind an endpoint that already belongs to staff/manager.
  const { data: existing } = await supabase.from('push_subscriptions')
    .select('restaurant_id, role').eq('endpoint', subscription.endpoint).maybeSingle();
  if (existing && existing.role !== 'guest') {
    return res.status(409).json({ error: 'endpoint_already_subscribed_elsewhere' });
  }
  await supabaseAdmin.from('push_subscriptions').upsert({
    restaurant_id: rest.id,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    role: 'guest',
    customer_id,
    user_label: null,
    active: true
  }, { onConflict: 'endpoint' });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const caller = await callerContext(req);
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  if (!caller) {
    if (body && body.customer_token) return handleGuestSubscribe(req, res, body);
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  const { subscription, user_label } = body; // client-supplied role deliberately ignored
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'subscription required' });
  }

  // Refuse to steal a subscription that already belongs to another
  // restaurant (endpoint upsert would otherwise silently rebind it).
  const { data: existing } = await supabase.from('push_subscriptions')
    .select('restaurant_id').eq('endpoint', subscription.endpoint).maybeSingle();
  if (existing && existing.restaurant_id !== caller.restaurant_id) {
    return res.status(409).json({ error: 'endpoint_already_subscribed_elsewhere' });
  }
  await supabaseAdmin.from('push_subscriptions').upsert({
    restaurant_id: caller.restaurant_id,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    role: caller.role, // authoritative role — client body ignored
    user_label: user_label || null,
    active: true
  }, { onConflict: 'endpoint' });
  return res.status(200).json({ ok: true });
}
