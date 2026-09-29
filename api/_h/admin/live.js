// GET /api/admin/live?slug=r
// Live "today" numbers for the portal home. Polled every ~45s, so: one raw
// round-trip for the restaurant's settings and one for all aggregates.
// Uses created_at (placed) and updated_at (status change → served); the
// schema has no dedicated placed_at / served_at columns.
import { supabase } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

const DEFAULT_TZ = 'Africa/Johannesburg';
const SLOW_MIN = 30;
const BUSY_MIN = 20;

function validTz(tz) {
  if (!tz || typeof tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  const slug = req.query?.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  try {
    const { data: st } = await supabase.raw(
      'select timezone from restaurant_settings where restaurant_id = $1 limit 1', [r.id]);
    const tz = validTz(st?.[0]?.timezone) || DEFAULT_TZ;

    // Start of the restaurant's local day, as a timestamptz.
    const dayStart = `(date_trunc('day', now() at time zone $2) at time zone $2)`;
    const { data: rows, error } = await supabase.raw(`
      with t as (
        select id, status, total_cents, customer_id, created_at, updated_at
        from orders
        where restaurant_id = $1 and created_at >= ${dayStart}
      )
      select
        (select count(*)::int from t where status <> 'cancelled') as orders_today,
        (select coalesce(sum(total_cents), 0)::bigint from t where status <> 'cancelled') as revenue_today_cents,
        (select count(*)::int from t where status = 'served') as served_count,
        (select percentile_cont(0.5) within group (order by extract(epoch from (updated_at - created_at)))
           from t where status = 'served') as median_prep_sec,
        (select count(distinct customer_id)::int from t where customer_id is not null)
          + (select count(*)::int from t where customer_id is null) as covers_today,
        (select coalesce(json_agg(x), '[]'::json) from (
           select oi.dish_name, sum(oi.qty)::int as count
           from order_items oi join t on t.id = oi.order_id
           where t.status <> 'cancelled'
           group by oi.dish_name
           order by count desc, oi.dish_name
           limit 3
         ) x) as top_dishes
    `, [r.id, tz]);
    if (error) throw new Error(error.message);
    const row = rows?.[0] || {};

    const served = Number(row.served_count || 0);
    const avgPrep = served >= 3 && row.median_prep_sec != null
      ? Math.round((Number(row.median_prep_sec) / 60) * 10) / 10
      : null;
    const kitchen_status = avgPrep == null ? 'ok'
      : avgPrep >= SLOW_MIN ? 'slow'
      : avgPrep >= BUSY_MIN ? 'busy' : 'ok';

    let top = row.top_dishes;
    if (typeof top === 'string') { try { top = JSON.parse(top); } catch { top = []; } }

    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({
      timezone: tz,
      orders_today: Number(row.orders_today || 0),
      revenue_today_cents: Number(row.revenue_today_cents || 0),
      avg_prep_min: avgPrep,
      top_dishes: Array.isArray(top) ? top : [],
      kitchen_status,
      covers_today: Number(row.covers_today || 0)
    });
  } catch (e) {
    console.error('admin/live failed:', e);
    return res.status(500).json({ error: 'live_failed' });
  }
}
