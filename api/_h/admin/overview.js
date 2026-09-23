// GET /api/admin/overview
// Boss panel dashboard data: totals + per-client list with dish counts and 30d scans.
// Protected by ADMIN_SECRET header.

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const [{ data: restaurants = [] }, { data: dishes = [] }, { data: scans = [] }] = await Promise.all([
    supabaseAdmin.from('restaurants').select('id, slug, name, email, created_at').order('name'),
    supabaseAdmin.from('dishes').select('id, restaurant_id, active'),
    supabaseAdmin
      .from('scans')
      .select('id, restaurant_id, dish_id, scanned_at')
      .gte('scanned_at', new Date(Date.now() - 30 * 864e5).toISOString())
  ]);

  const dishCount = {}, scanCount = {};
  dishes.forEach(d => { if (d.active) dishCount[d.restaurant_id] = (dishCount[d.restaurant_id] || 0) + 1; });
  scans.forEach(s => { scanCount[s.restaurant_id] = (scanCount[s.restaurant_id] || 0) + 1; });

  const clients = restaurants.map(r => ({
    slug: r.slug,
    name: r.name,
    email: r.email,
    created_at: r.created_at,
    dishes: dishCount[r.id] || 0,
    scans_30d: scanCount[r.id] || 0
  }));

  return res.status(200).json({
    totals: {
      restaurants: restaurants.length,
      dishes_live: dishes.filter(d => d.active).length,
      scans_30d: scans.length
    },
    clients
  });
}
