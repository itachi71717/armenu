// GET /api/admin/benchmarks?slug=<r>
// Read-only peer benchmarking over the last 30 days (no auditLog: no state change).
// Returns { my_avg_order_cents, platform_avg_order_cents, my_repeat_rate_pct,
//   platform_repeat_rate_pct, my_orders_last_7d, my_ranking_percentile }.
// my_ranking_percentile = % of other restaurants with a lower avg order value
// (higher avg => higher percentile, best = 100); null when there are no peers.
import { supabase } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  const slug = String(req.query.slug || '');
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const W = "created_at > now() - interval '30 days' and status <> 'cancelled'";
  try {
    const [per, rep, last7] = await Promise.all([
      supabase.raw(`select restaurant_id, avg(total_cents)::float as avg_c, count(*)::int as n
        from orders where ${W} group by restaurant_id`),
      supabase.raw(`select restaurant_id, count(*)::int as custs,
          count(*) filter (where n >= 2)::int as repeaters
        from (select restaurant_id, customer_id, count(*) as n from orders
              where ${W} and customer_id is not null group by 1, 2) t group by restaurant_id`),
      supabase.raw(`select count(*)::int as n from orders
        where restaurant_id = $1 and status <> 'cancelled' and created_at > now() - interval '7 days'`, [r.id])
    ]);
    if (per.error || rep.error || last7.error) throw new Error('query failed');
    const rows = per.data || [];
    let totOrders = 0, totCents = 0;
    for (const x of rows) { totOrders += x.n; totCents += x.avg_c * x.n; }
    const mine = rows.find(x => String(x.restaurant_id) === String(r.id));
    const myAvg = mine ? Math.round(mine.avg_c) : 0;
    const platAvg = totOrders ? Math.round(totCents / totOrders) : 0;

    let pc = 0, pr = 0, mc = 0, mr = 0;
    for (const x of rep.data || []) {
      pc += x.custs; pr += x.repeaters;
      if (String(x.restaurant_id) === String(r.id)) { mc = x.custs; mr = x.repeaters; }
    }
    const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;

    let percentile = null;
    if (mine && rows.length > 1) {
      // Share of the OTHER restaurants with a lower avg order: higher avg => higher percentile.
      const below = rows.filter(x => x.avg_c < mine.avg_c).length;
      percentile = Math.round(below * 100 / (rows.length - 1));
    }
    return res.status(200).json({
      my_avg_order_cents: myAvg,
      platform_avg_order_cents: platAvg,
      my_repeat_rate_pct: pct(mr, mc),
      platform_repeat_rate_pct: pct(pr, pc),
      my_orders_last_7d: last7.data?.[0]?.n || 0,
      my_ranking_percentile: percentile
    });
  } catch (e) {
    return res.status(500).json({ error: 'benchmarks_failed' });
  }
}
