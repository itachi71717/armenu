// Staff CRUD. PIN is hashed with sha256(pin + restaurant_id).
// GET  ?slug=r
// POST ?slug=r     { name, pin, role? }
// PATCH ?id        { name?, pin?, active?, role? }
// DELETE ?id
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const hashPin = (pin, rid) => crypto.createHash('sha256').update(String(pin) + ':' + rid).digest('hex');
// The portal offers waiter / kitchen / manager; kitchen used to be silently stored as waiter.
const normRole = (r) => (r === 'manager' || r === 'kitchen') ? r : 'waiter';
// Login looks staff up by (restaurant, pin_hash) with maybeSingle(), so two people sharing a PIN
// would both be locked out with "wrong PIN". Refuse duplicates up front.
async function pinTaken(restaurant_id, pin_hash, exceptId) {
  const { data = [] } = await supabase.from('staff').select('id').eq('restaurant_id', restaurant_id).eq('pin_hash', pin_hash);
  return (data || []).some(x => String(x.id) !== String(exceptId || ''));
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const gGet = assertScope(req, r.id);
    if (gGet) return res.status(gGet.status).json({ error: gGet.error });
    const { data = [] } = await supabase.from('staff')
      .select('id, name, role, active, last_login_at, created_at')
      .eq('restaurant_id', r.id).order('created_at', { ascending: false });
    return res.status(200).json({ staff: data });
  }

  if (req.method === 'POST') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const gPost = assertScope(req, r.id);
    if (gPost) return res.status(gPost.status).json({ error: gPost.error });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    body = body || {};
    const name = String(body.name || '').trim();
    const pin  = String(body.pin || '').trim();
    if (!name || !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'name and 4-6 digit PIN required' });
    if (await pinTaken(r.id, hashPin(pin, r.id))) return res.status(400).json({ error: 'That PIN is already used by another staff member - pick a different one' });
    const { data, error } = await supabaseAdmin.from('staff').insert({
      restaurant_id: r.id, name,
      pin_hash: hashPin(pin, r.id),
      role: normRole(body.role)
    }).select('id, name, role').single();
    if (error) return res.status(400).json({ error: /duplicate|unique/i.test(error.message || '') ? 'A staff member with that name already exists' : error.message });
    auditLog(req, r.id, 'staff.create', { target: data?.name || name, metadata: { role: data?.role } }).catch(() => {});
    return res.status(200).json({ staff: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const { data: existing } = await supabase.from('staff').select('restaurant_id, name').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: 'not found' });
    // Scope: a manager portal_token can only touch staff in their restaurant.
    // Without this, anyone with a valid portal_token could PATCH pin= against
    // another restaurant's staff row (silently resetting the PIN) then log in
    // via /api/staff/login. Highest-impact of the audit findings.
    const guard = assertScope(req, existing.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    const patch = {};
    if ('name' in body) patch.name = String(body.name).trim();
    if ('active' in body) patch.active = !!body.active;
    if ('role' in body) patch.role = normRole(body.role);
    if ('pin' in body && /^\d{4,6}$/.test(body.pin)) {
      const h = hashPin(body.pin, existing.restaurant_id);
      if (await pinTaken(existing.restaurant_id, h, id)) return res.status(400).json({ error: 'That PIN is already used by another staff member - pick a different one' });
      patch.pin_hash = h;
    }
    await supabaseAdmin.from('staff').update(patch).eq('id', id);
    // PIN changes are sensitive — log them but redact the hash
    auditLog(req, existing.restaurant_id, 'staff.update', { target: existing.name, metadata: { fields: Object.keys(patch).map(f => f === 'pin_hash' ? 'pin' : f) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { data: row } = await supabase.from('staff').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await supabaseAdmin.from('staff').delete().eq('id', id);
    auditLog(req, row.restaurant_id, 'staff.delete', { target: row.name || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
