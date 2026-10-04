// GET /api/admin/overview
// Boss panel dashboard data: totals + per-client list with dish counts and 30d scans.
// Protected by ADMIN_SECRET header.

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const since30d = new Date(Date.now() - 30 * 864e5).toISOString();

  const [{ data: restaurants = [] }, dishCounts, scanCounts] = await Promise.all([
    supabaseAdmin.from('restaurants').select('id, slug, name, email, created_at').order('name'),
    // Aggregate in Postgres instead of fetching every row.
    supabaseAdmin.raw(
      `select restaurant_id, count(*) filter (where active) as active_count, count(*) as total_count
       from dishes group by restaurant_id`
    ),
    supabaseAdmin.raw(
      `select restaurant_id, count(*)::int as scan_count
       from scans where scanned_at >= $1 group by restaurant_id`,
      [since30d]
    )
  ]);

  const dishMap = {}, scanMap = {};
  for (const r of dishCounts.data || []) dishMap[r.restaurant_id] = { active: Number(r.active_count) || 0 };
  for (const r of scanCounts.data || []) scanMap[r.restaurant_id] = Number(r.scan_count) || 0;

  const clients = restaurants.map(r => ({
    slug: r.slug,
    name: r.name,
    email: r.email,
    created_at: r.created_at,
    dishes: dishMap[r.id]?.active || 0,
    scans_30d: scanMap[r.id] || 0
  }));

  const totalsActive = Object.values(dishMap).reduce((s, x) => s + x.active, 0);
  const totalScans = Object.values(scanMap).reduce((s, x) => s + x, 0);

  return res.status(200).json({
    totals: {
      restaurants: restaurants.length,
      dishes_live: totalsActive,
      scans_30d: totalScans
    },
    clients
  });
}
