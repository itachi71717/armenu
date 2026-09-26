// GET  /api/admin/orders?slug=r&status=new|prep|ready|served&limit=50
// PATCH /api/admin/orders?id=<id>  { status }
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

const VALID = ['new','prep','ready','served','cancelled'];

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug, status, limit } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, r.id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    let q = supabase.from('orders')
      .select('*')
      .eq('restaurant_id', r.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) || 50);
    if (status && VALID.includes(status)) q = q.eq('status', status);
    const { data: orders = [] } = await q;
    // Fetch children in one round-trip and stitch back
    if (orders.length) {
      const orderIds = orders.map(o => o.id);
      const { data: items = [] } = await supabase.from('order_items')
        .select('*').in('order_id', orderIds);
      const byOrder = {};
      for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
      for (const o of orders) o.order_items = byOrder[o.id] || [];
    }
    return res.status(200).json({ orders });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (!VALID.includes(body.status)) return res.status(400).json({ error: 'bad status' });
    // Resolve target's restaurant_id so a scoped portal_token can't reach
    // orders from another restaurant just by knowing the UUID.
    const { data: existing } = await supabase.from('orders').select('id, restaurant_id, status').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, existing.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await supabaseAdmin.from('orders').update({
      status: body.status,
      updated_at: new Date().toISOString()
    }).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
