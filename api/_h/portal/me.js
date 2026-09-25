// GET /api/portal/me
// Authenticated restaurant manager — returns ALL restaurants linked to their
// Clerk email (multi-location support). The primary/first restaurant is
// exposed at the top level for legacy clients; the full array is returned as
// `locations` with per-location dish counts + 7-day metrics.
// Auth: Authorization: Bearer <Clerk session token>

import { supabase, supabaseAdmin } from '../../_db.js';
import { requireManager } from '../../_auth.js';

export default async function handler(req, res) {
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const { data: rests = [], error: restErr } = await supabaseAdmin
    .from('restaurants')
    .select('id, slug, name, email')
    .ilike('email', auth.email)
    .order('name');

  if (restErr) {
    console.error('portal/me.js restaurant lookup failed:', restErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }
  if (!rests.length) {
    return res.status(404).json({
      error: 'no_restaurant_linked',
      message: `No restaurant is linked to ${auth.email}. Contact AR Menu support.`
    });
  }

  // Load dishes + last-7d metrics for each linked restaurant in parallel
  const sevenAgoIso = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const locations = await Promise.all(rests.map(async (r) => {
    const [{ data: dishes = [] }, { data: scans = [] }, { data: orders = [] }, { data: revs = [] }] = await Promise.all([
      supabase.from('dishes').select('id, slug, name, price, thumb_url, active, stock_count').eq('restaurant_id', r.id).eq('active', true).order('name'),
      supabase.from('scans').select('id').eq('restaurant_id', r.id).gte('scanned_at', sevenAgoIso),
      supabase.from('orders').select('id, total_cents').eq('restaurant_id', r.id).gte('created_at', sevenAgoIso),
      supabase.from('reviews').select('rating').eq('restaurant_id', r.id).gte('created_at', sevenAgoIso)
    ]);
    const revenue_cents_7d = orders.reduce((s, o) => s + (o.total_cents || 0), 0);
    const avg_rating_7d = revs.length ? (revs.reduce((s, x) => s + (x.rating || 0), 0) / revs.length) : null;
    return {
      id: r.id, slug: r.slug, name: r.name, email: r.email,
      dishes,
      metrics_7d: {
        scans: scans.length,
        orders: orders.length,
        revenue_cents: revenue_cents_7d,
        avg_rating: avg_rating_7d
      }
    };
  }));

  // Legacy shape: expose the first as `restaurant` + `dishes` so existing UI
  // that only knows about a single location keeps working.
  const primary = locations[0];
  return res.status(200).json({
    restaurant: { slug: primary.slug, name: primary.name, email: primary.email },
    dishes: primary.dishes,
    scans_7d: primary.metrics_7d.scans,
    locations,
    is_multi: locations.length > 1
  });
}
