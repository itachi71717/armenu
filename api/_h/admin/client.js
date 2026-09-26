// GET    /api/admin/client?slug=<restaurant-slug>     -> restaurant + dishes + 30d scans
// DELETE /api/admin/client?slug=<restaurant-slug>     -> remove restaurant (cascades dishes/scans)
// Protected by ADMIN_SECRET header.

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const slug = req.query.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data: restaurant, error: restErr } = await supabaseAdmin
    .from('restaurants')
    .select('id, slug, name, email, created_at')
    .eq('slug', slug)
    .maybeSingle();

  if (restErr) {
    console.error('admin/client.js restaurant lookup failed:', restErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }
  if (!restaurant) return res.status(404).json({ error: 'Not found' });

  if (req.method === 'DELETE') {
    // Master-admin only — a scoped manager token must never be able to
    // nuke their own restaurant (or anyone else's). The dispatcher
    // already refuses cross-tenant, but this route is master-only either
    // way; explicit guard against a same-tenant manager attempting it.
    if (getScopedRestaurantId(req) !== null) {
      return res.status(403).json({ error: 'master_admin_only' });
    }
    // Audit BEFORE the delete cascades — otherwise the cascade wipes
    // audit_log rows for this restaurant along with everything else, so
    // the record of who nuked what is lost.
    await auditLog(req, restaurant.id, 'restaurant.delete', {
      target: restaurant.slug,
      metadata: { name: restaurant.name, email: restaurant.email }
    }).catch(() => {});
    const { error } = await supabaseAdmin.from('restaurants').delete().eq('id', restaurant.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  const [{ data: dishes = [] }, { data: scans = [] }, { data: requests = [] }] = await Promise.all([
    supabaseAdmin
      .from('dishes')
      .select('id, slug, name, price, glb_url, thumb_url, active, created_at, scale, ar_source, description')
      .eq('restaurant_id', restaurant.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('scans')
      .select('dish_id, scanned_at')
      .eq('restaurant_id', restaurant.id)
      .gte('scanned_at', new Date(Date.now() - 30 * 864e5).toISOString()),
    supabaseAdmin
      .from('requests')
      .select('id, message, status, created_at')
      .eq('restaurant_id', restaurant.id)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  const scanMap = {};
  scans.forEach(s => { scanMap[s.dish_id] = (scanMap[s.dish_id] || 0) + 1; });

  return res.status(200).json({
    restaurant,
    dishes: dishes.map(d => ({ ...d, scans_30d: scanMap[d.id] || 0 })),
    total_scans_30d: scans.length,
    requests
  });
}
