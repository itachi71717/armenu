// GET /api/admin/audit?slug=<r>&limit=100  → recent audit events for one restaurant
// Master admin (or scoped manager token via the dispatcher's scope guard) only.
import { supabase } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  const scopeRid = getScopedRestaurantId(req);
  let rid = scopeRid;
  if (!rid) {
    const slug = req.query.slug;
    if (!slug) {
      // Master admin, no slug → platform-wide feed
      const { data = [] } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
      return res.status(200).json({ events: data });
    }
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return res.status(404).json({ error: 'restaurant not found' });
    rid = r.id;
  }
  const { data = [] } = await supabase.from('audit_log')
    .select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(limit);
  return res.status(200).json({ events: data });
}
