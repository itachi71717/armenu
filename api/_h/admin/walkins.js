// Walk-in / waitlist queue — piggybacks on the reservations table with is_walkin=true.
// GET    /api/admin/walkins?slug=<r>   → pending walk-ins ordered oldest first
// POST   /api/admin/walkins?slug=<r>   { guest_name, party_size?, notes? }
// PATCH  /api/admin/walkins?id=<id>    { status: 'seated'|'left'|'no_show' }
// DELETE /api/admin/walkins?id=<id>
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  const scopeRid = getScopedRestaurantId(req);

  async function rid() {
    if (scopeRid) return scopeRid;
    const slug = req.query.slug;
    if (!slug) return null;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    return r?.id || null;
  }

  if (req.method === 'GET') {
    const restId = await rid();
    if (!restId) return res.status(404).json({ error: 'not found' });
    const { data = [] } = await supabase.from('reservations')
      .select('*').eq('restaurant_id', restId).eq('is_walkin', true)
      .in('status', ['pending', 'confirmed'])
      .order('reserved_at', { ascending: true });
    return res.status(200).json({ walkins: data });
  }

  if (req.method === 'POST') {
    const restId = await rid();
    if (!restId) return res.status(404).json({ error: 'not found' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { guest_name, party_size, notes } = body;
    if (!guest_name) return res.status(400).json({ error: 'guest_name required' });
    const size = Math.max(1, Math.min(50, parseInt(party_size) || 2));
    const { data, error } = await supabaseAdmin.from('reservations').insert({
      restaurant_id: restId,
      guest_name, party_size: size,
      notes: notes || null,
      reserved_at: new Date().toISOString(),
      is_walkin: true,
      status: 'pending'
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, restId, 'walkin.create', { target: guest_name, metadata: { party_size: size } }).catch(() => {});
    return res.status(201).json({ walkin: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const status = ['seated','left','no_show','confirmed'].includes(body.status) ? body.status : null;
    if (!status) return res.status(400).json({ error: 'status must be seated/left/no_show' });
    if (scopeRid) {
      const { data: r } = await supabase.from('reservations').select('restaurant_id').eq('id', id).maybeSingle();
      if (!r || r.restaurant_id !== scopeRid) return res.status(403).json({ error: 'out of scope' });
    }
    await supabaseAdmin.from('reservations').update({ status }).eq('id', id);
    const { data: row } = await supabase.from('reservations').select('restaurant_id, guest_name').eq('id', id).maybeSingle();
    auditLog(req, row?.restaurant_id, 'walkin.update', { target: row?.guest_name, metadata: { status } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (scopeRid) {
      const { data: r } = await supabase.from('reservations').select('restaurant_id').eq('id', id).maybeSingle();
      if (!r || r.restaurant_id !== scopeRid) return res.status(403).json({ error: 'out of scope' });
    }
    await supabaseAdmin.from('reservations').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
