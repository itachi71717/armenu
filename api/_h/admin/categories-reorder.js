// POST /api/admin/categories/reorder?slug=<r>  { order: [id, id, id, ...] }
// Rewrites the sort_order column so the array position becomes the new order.
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  const { slug } = req.query;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const order = Array.isArray(body.order) ? body.order : [];
  if (!order.length) return res.status(400).json({ error: 'order[] required' });

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'restaurant not found' });

  // Update each row's sort_order; keep it simple with a sequential loop (dozens of categories max)
  for (let i = 0; i < order.length; i++) {
    await supabaseAdmin.from('categories').update({ sort_order: i * 10 }).eq('id', order[i]).eq('restaurant_id', r.id);
  }
  return res.status(200).json({ ok: true, count: order.length });
}
