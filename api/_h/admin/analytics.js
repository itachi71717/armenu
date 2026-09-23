// GET /api/admin/analytics?slug=r&days=30
// Returns: totals, per-day scans/orders/reviews, top dishes, peak hours, avg rating.
import { supabase } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const { slug } = req.query;
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });

  const [scansQ, ordersQ, reviewsQ, dishesQ] = await Promise.all([
    supabase.from('scans')
      .select('scanned_at, dish_id, user_agent')
      .eq('restaurant_id', r.id).gte('scanned_at', since),
    supabase.from('orders')
      .select('created_at, total_cents, status, source, order_items(dish_id, dish_name, qty, price_cents)')
      .eq('restaurant_id', r.id).gte('created_at', since),
    supabase.from('reviews')
      .select('created_at, stars, routed_to_google')
      .eq('restaurant_id', r.id).gte('created_at', since),
    supabase.from('dishes').select('id, name, slug').eq('restaurant_id', r.id)
  ]);

  const scans = scansQ.data || [];
  const orders = ordersQ.data || [];
  const reviews = reviewsQ.data || [];
  const dishes = dishesQ.data || [];
  const dishName = Object.fromEntries(dishes.map(d => [d.id, d.name]));

  // Per-day buckets
  const dayKey = ts => ts.slice(0, 10);
  const byDay = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    byDay[d] = { day: d, scans: 0, orders: 0, revenue_cents: 0, reviews: 0 };
  }
  for (const s of scans) if (byDay[dayKey(s.scanned_at)]) byDay[dayKey(s.scanned_at)].scans++;
  for (const o of orders) if (byDay[dayKey(o.created_at)] && o.status !== 'cancelled') {
    byDay[dayKey(o.created_at)].orders++;
    byDay[dayKey(o.created_at)].revenue_cents += o.total_cents || 0;
  }
  for (const rv of reviews) if (byDay[dayKey(rv.created_at)]) byDay[dayKey(rv.created_at)].reviews++;

  // Peak hours (0-23)
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, scans: 0, orders: 0 }));
  for (const s of scans) hourly[new Date(s.scanned_at).getHours()].scans++;
  for (const o of orders) hourly[new Date(o.created_at).getHours()].orders++;

  // Top dishes
  const topScans = {};
  for (const s of scans) if (s.dish_id) topScans[s.dish_id] = (topScans[s.dish_id] || 0) + 1;
  const topOrders = {};
  for (const o of orders) for (const it of (o.order_items || [])) {
    if (!it.dish_id) continue;
    topOrders[it.dish_id] = (topOrders[it.dish_id] || 0) + (it.qty || 0);
  }
  const topScanned = Object.entries(topScans).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, n]) => ({ dish: dishName[id] || 'Unknown', count: n }));
  const topOrdered = Object.entries(topOrders).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, n]) => ({ dish: dishName[id] || 'Unknown', qty: n }));

  // Rating summary
  const rSum = reviews.reduce((s, r) => s + r.stars, 0);
  const avgRating = reviews.length ? +(rSum / reviews.length).toFixed(2) : null;

  return res.status(200).json({
    range_days: days,
    totals: {
      scans: scans.length,
      orders: orders.filter(o => o.status !== 'cancelled').length,
      revenue_cents: orders.reduce((s, o) => s + (o.status !== 'cancelled' ? (o.total_cents || 0) : 0), 0),
      reviews: reviews.length,
      avg_rating: avgRating,
      google_routed: reviews.filter(r => r.routed_to_google).length
    },
    daily: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    hourly,
    top_scanned: topScanned,
    top_ordered: topOrdered
  });
}
