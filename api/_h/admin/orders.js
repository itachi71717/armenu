// GET  /api/admin/orders?slug=r&status=new|prep|ready|served&limit=50
// PATCH /api/admin/orders?id=<id>  { status }
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

const VALID = ['new','prep','ready','served','cancelled'];

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug, status, limit } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    let q = supabase.from('orders')
      .select('*, order_items(*)')
      .eq('restaurant_id', r.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) || 50);
    if (status && VALID.includes(status)) q = q.eq('status', status);
    const { data = [] } = await q;
    return res.status(200).json({ orders: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (!VALID.includes(body.status)) return res.status(400).json({ error: 'bad status' });
    await supabaseAdmin.from('orders').update({
      status: body.status,
      updated_at: new Date().toISOString()
    }).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
