// GET    /api/admin/reservations?r=<slug>[&status=]  → list upcoming
// PATCH  /api/admin/reservations?id=<id>  { status?, table_id?, notes? }
// DELETE /api/admin/reservations?id=<id>
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const scopeRid = getScopedRestaurantId(req);

  if (req.method === 'GET') {
    const slug = req.query.r;
    let rid = scopeRid;
    if (!rid) {
      if (!slug) return res.status(400).json({ error: 'r (restaurant slug) required' });
      const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
      if (!rest) return res.status(404).json({ error: 'restaurant not found' });
      rid = rest.id;
    }
    let q = supabase.from('reservations').select('*').eq('restaurant_id', rid).order('reserved_at', { ascending: true });
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data } = await q;
    return res.status(200).json({ reservations: data || [] });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const ALLOWED_STATUS = new Set(['pending', 'confirmed', 'declined', 'seated', 'left', 'no_show', 'cancelled']);
    const patch = {};
    for (const k of ['table_id', 'notes', 'party_size', 'reserved_at']) if (k in body) patch[k] = body[k];
    if ('status' in body) {
      if (!ALLOWED_STATUS.has(body.status)) return res.status(400).json({ error: 'bad status' });
      patch.status = body.status;
    }
    // Enforce scope: if a manager token is in play, verify the reservation belongs to them.
    if (scopeRid) {
      const { data: r } = await supabase.from('reservations').select('restaurant_id').eq('id', id).maybeSingle();
      if (!r || r.restaurant_id !== scopeRid) return res.status(403).json({ error: 'out of scope' });
    }
    await supabaseAdmin.from('reservations').update(patch).eq('id', id);
    const { data: row } = await supabase.from('reservations').select('restaurant_id, guest_name').eq('id', id).maybeSingle();
    auditLog(req, row?.restaurant_id, 'reservation.update', { target: row?.guest_name || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (scopeRid) {
      const { data: r } = await supabase.from('reservations').select('restaurant_id').eq('id', id).maybeSingle();
      if (!r || r.restaurant_id !== scopeRid) return res.status(403).json({ error: 'out of scope' });
    }
    const { data: row } = await supabase.from('reservations').select('restaurant_id, guest_name').eq('id', id).maybeSingle();
    await supabaseAdmin.from('reservations').delete().eq('id', id);
    auditLog(req, row?.restaurant_id, 'reservation.delete', { target: row?.guest_name || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
