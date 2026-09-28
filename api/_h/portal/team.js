// /api/portal/team
//   GET     ?restaurant_id=…            → [{email, role, invited_at, accepted_at, invited_by}]
//   POST    { restaurant_id, email, role? } → invite a teammate
//   DELETE  ?restaurant_id=…&email=…    → remove a teammate
//
// The signed-in manager must OWN that restaurant (restaurants.email matches
// their Clerk email) — team members themselves can't add or remove others.

import { supabase, supabaseAdmin } from '../../_db.js';
import { requireManager } from '../../_auth.js';
import { auditLog } from '../_audit.js';

async function assertOwner(auth, restaurant_id) {
  const { data: r } = await supabase
    .from('restaurants').select('id, email, name').eq('id', restaurant_id).maybeSingle();
  if (!r) return { err: 'not_found', status: 404 };
  if (String(r.email || '').toLowerCase() !== String(auth.email || '').toLowerCase()) {
    return { err: 'not_owner', status: 403 };
  }
  return { rest: r };
}

export default async function handler(req, res) {
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const rid = req.query?.restaurant_id ||
    (req.body && (typeof req.body === 'string' ? JSON.parse(req.body).restaurant_id : req.body.restaurant_id));
  if (!rid) return res.status(400).json({ error: 'restaurant_id required' });

  const check = await assertOwner(auth, rid);
  if (check.err) return res.status(check.status).json({ error: check.err });

  if (req.method === 'GET') {
    const { data = [] } = await supabase.from('manager_users')
      .select('email, role, invited_at, accepted_at, invited_by')
      .eq('restaurant_id', rid)
      .order('invited_at', { ascending: false });
    return res.status(200).json({ team: data });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    // 'owner' is misleading here — the actual owner lives on restaurants.email
    // and is set via /api/portal/transfer. Teammate roles are only manager or viewer.
    const role = ['manager', 'viewer'].includes(body.role) ? body.role : 'manager';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (email === String(auth.email).toLowerCase()) {
      return res.status(400).json({ error: 'You already own this restaurant.' });
    }
    const { error } = await supabaseAdmin.from('manager_users').insert({
      restaurant_id: rid, email, role, invited_by: auth.email
    });
    if (error) {
      // 23505 = unique_violation (Postgres); more robust than string match
      if (error.code === '23505' || String(error.message).includes('duplicate')) {
        return res.status(409).json({ error: 'already_invited' });
      }
      return res.status(500).json({ error: error.message });
    }
    await auditLog(req, rid, 'team_invited', { target: email, metadata: { role } });
    return res.status(201).json({ ok: true, email, role });
  }

  if (req.method === 'DELETE') {
    const email = String(req.query?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email required' });
    // The sole owner row (role='owner') can't be removed this way — ownership
    // only moves via /api/portal/transfer, which keeps restaurants.email and
    // manager_users in sync and leaves an audit trail.
    const { data: target } = await supabase.from('manager_users')
      .select('role').eq('restaurant_id', rid).eq('email', email).maybeSingle();
    if (target && target.role === 'owner') {
      return res.status(400).json({ error: 'cannot_remove_owner' });
    }
    await supabaseAdmin.from('manager_users')
      .delete().eq('restaurant_id', rid).eq('email', email);
    await auditLog(req, rid, 'team_removed', { target: email });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
