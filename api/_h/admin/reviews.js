// GET /api/admin/reviews?slug=r
import { supabase } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  const { slug } = req.query;
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });
  const { data = [] } = await supabase.from('reviews')
    .select('*').eq('restaurant_id', r.id)
    .order('created_at', { ascending: false }).limit(200);
  return res.status(200).json({ reviews: data });
}
