// GET /api/admin/analytics?slug=r&days=30
// Returns: totals, per-day scans/orders/reviews, top dishes, peak hours, avg rating.
import { supabase } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

const DEFAULT_TZ = 'Africa/Johannesburg';
function validTz(tz) {
  if (!tz || typeof tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
}

// GET ?slug=r&range=7d|30d|90d — timezone-aware server-computed analytics.
// Read-only, so no auditLog. Five aggregate queries; no row sets fetched.
async function rangeAnalytics(req, res) {
  const { slug } = req.query;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[req.query.range];
  if (!days) return res.status(400).json({ error: 'range must be 7d, 30d or 90d' });
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const { data: st } = await supabase.raw('select timezone from restaurant_settings where restaurant_id = $1 limit 1', [r.id]);
  const tz = validTz(st?.[0]?.timezone) || DEFAULT_TZ;
  // Local-day window start as timestamptz, shared by every query.
  const from = "(((now() at time zone $2)::date - ($3::int - 1))::timestamp at time zone $2)";
  const P = [r.id, tz, days];
  const okOrders = "o.restaurant_id = $1 and o.status <> 'cancelled'";

  const [series, heat, dishes, cats, cohort] = await Promise.all([
    supabase.raw(`
      with d as (select generate_series((now() at time zone $2)::date - ($3::int - 1), (now() at time zone $2)::date, interval '1 day')::date as day),
      o as (select (created_at at time zone $2)::date as day, count(*)::int as c, coalesce(sum(total_cents),0)::bigint as rev
            from orders o where ${okOrders} and created_at >= ${from} group by 1)
      select to_char(d.day,'YYYY-MM-DD') as date, coalesce(o.rev,0)::int as revenue_cents, coalesce(o.c,0)::int as orders_count
      from d left join o on o.day = d.day order by d.day`, P),
    supabase.raw(`
      select extract(isodow from created_at at time zone $2)::int as dow, extract(hour from created_at at time zone $2)::int as hr, count(*)::int as c
      from orders o where ${okOrders} and created_at >= ${from} group by 1, 2`, P),
    supabase.raw(`
      select oi.dish_name, sum(oi.qty)::int as count, coalesce(sum(case when oi.complimentary then 0 else oi.qty * oi.price_cents end),0)::int as revenue_cents
      from order_items oi join orders o on o.id = oi.order_id
      where ${okOrders} and o.created_at >= ${from}
      group by oi.dish_name order by revenue_cents desc, count desc limit 20`, P),
    supabase.raw(`
      select coalesce(c.name, 'Uncategorised') as category_name, sum(oi.qty)::int as count,
             coalesce(sum(case when oi.complimentary then 0 else oi.qty * oi.price_cents end),0)::int as revenue_cents
      from order_items oi join orders o on o.id = oi.order_id
      left join dishes dsh on dsh.id = oi.dish_id left join categories c on c.id = dsh.category_id
      where ${okOrders} and o.created_at >= ${from}
      group by 1 order by revenue_cents desc`, P),
    supabase.raw(`
      with f as (select customer_id, min(created_at) as fa from orders o where ${okOrders} and customer_id is not null group by 1),
      c as (select customer_id, date_trunc('week', fa at time zone $2)::date as wk from f
            where fa >= ((date_trunc('week', now() at time zone $2)::date - 21)::timestamp at time zone $2)),
      r as (select c.wk, c.customer_id, ((o.created_at at time zone $2)::date - c.wk) / 7 as k
            from c join orders o on o.customer_id = c.customer_id and ${okOrders})
      select to_char(wk,'YYYY-MM-DD') as cohort_week, ((date_trunc('week', now() at time zone $2)::date - wk) / 7)::int as age,
             count(distinct customer_id)::int as size,
             (count(distinct customer_id) filter (where k = 1))::int as w1,
             (count(distinct customer_id) filter (where k = 2))::int as w2,
             (count(distinct customer_id) filter (where k = 3))::int as w3
      from r group by wk order by wk`, [r.id, tz])
  ]);
  const err = [series, heat, dishes, cats, cohort].find(q => q.error);
  if (err) return res.status(500).json({ error: 'analytics_failed', detail: err.error.message });

  // Average per weekday x hour: total orders / how many of that weekday fall in the window.
  const dowDays = Array(8).fill(0);
  for (const p of series.data) dowDays[new Date(p.date + 'T00:00:00Z').getUTCDay() || 7]++;
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const h of heat.data) if (dowDays[h.dow]) grid[h.dow - 1][h.hr] = +(h.c / dowDays[h.dow]).toFixed(2);
  const hour_heatmap = grid.map((row, i) => ({ day: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i], hours: row.map(orders_count => ({ orders_count })) }));

  // A return window only counts once that week has started; otherwise null (not yet measurable).
  const cohort_retention = cohort.data.map(c => ({
    cohort_week: c.cohort_week, size: c.size,
    w1_return: c.age >= 1 ? c.w1 : null, w2_return: c.age >= 2 ? c.w2 : null, w3_return: c.age >= 3 ? c.w3 : null
  }));

  return res.status(200).json({
    range: req.query.range, timezone: tz,
    revenue_series: series.data, hour_heatmap,
    dish_leaderboard: dishes.data, category_performance: cats.data, cohort_retention
  });
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  if (req.query.range) return rangeAnalytics(req, res);

  const { slug } = req.query;
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });
  const legacyGuard = assertScope(req, r.id);
  if (legacyGuard) return res.status(legacyGuard.status).json({ error: legacyGuard.error });

  // Bucket by the restaurant's own calendar day / hour. Slicing the UTC ISO string put an order
  // placed at 00:30 Johannesburg time on the previous day; getHours() used the server's zone.
  const { data: stRows } = await supabase.raw('select timezone from restaurant_settings where restaurant_id = $1 limit 1', [r.id]);
  const tz = validTz(stRows?.[0]?.timezone) || DEFAULT_TZ;
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
  const localDay = v => dayFmt.format(new Date(v));
  const localHour = v => (parseInt(hourFmt.format(new Date(v)), 10) || 0) % 24;

  const [scansQ, ordersQ, reviewsQ, dishesQ] = await Promise.all([
    supabase.from('scans')
      .select('scanned_at, dish_id, user_agent')
      .eq('restaurant_id', r.id).gte('scanned_at', since),
    supabase.from('orders')
      .select('id, created_at, total_cents, status, source')
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

  // Fetch order_items separately (shim doesn't understand embedded relations)
  if (orders.length) {
    const { data: items = [] } = await supabase.from('order_items')
      .select('order_id, dish_id, dish_name, qty, price_cents')
      .in('order_id', orders.map(o => o.id));
    const byOrder = {};
    for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
    for (const o of orders) o.order_items = byOrder[o.id] || [];
  }

  // Per-day buckets
  const dayKey = ts => localDay(ts);
  const byDay = {};
  for (let i = 0; i < days; i++) {
    const d = localDay(Date.now() - i * 86400_000);
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
  for (const s of scans) hourly[localHour(s.scanned_at)].scans++;
  for (const o of orders) hourly[localHour(o.created_at)].orders++;

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
