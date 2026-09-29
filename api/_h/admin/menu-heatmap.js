// GET /api/admin/menu-heatmap?slug=r&range=30d|90d
// Read-only (no auditLog). Per local day: total orders, top dish, and dishes
// whose FIRST EVER order landed that day ("launch" markers).
// Returns [{ date, top_dish:{name,count}|null, total_orders, dish_launched:[{name, first_ordered_at}] }]
import { supabase } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

const DEFAULT_TZ = 'Africa/Johannesburg';
function validTz(tz) {
  if (!tz || typeof tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  const { slug } = req.query || {};
  const days = { '30d': 30, '90d': 90 }[req.query?.range];
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (!days) return res.status(400).json({ error: 'range must be 30d or 90d' });

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const { data: st } = await supabase.raw('select timezone from restaurant_settings where restaurant_id = $1 limit 1', [r.id]);
  const tz = validTz(st?.[0]?.timezone) || DEFAULT_TZ;
  const from = "(((now() at time zone $2)::date - ($3::int - 1))::timestamp at time zone $2)";
  const P = [r.id, tz, days];
  const ok = "o.restaurant_id = $1 and o.status <> 'cancelled'";

  const [daily, launches] = await Promise.all([
    supabase.raw(`
      with d as (select generate_series((now() at time zone $2)::date - ($3::int - 1), (now() at time zone $2)::date, interval '1 day')::date as day),
      ord as (select o.id, (o.created_at at time zone $2)::date as day from orders o where ${ok} and o.created_at >= ${from}),
      tot as (select day, count(*)::int as c from ord group by 1),
      dd as (select ord.day, oi.dish_name, sum(oi.qty)::int as cnt from ord join order_items oi on oi.order_id = ord.id group by 1, 2),
      top as (select distinct on (day) day, dish_name, cnt from dd order by day, cnt desc, dish_name)
      select to_char(d.day,'YYYY-MM-DD') as date, coalesce(tot.c,0)::int as total_orders, top.dish_name as top_name, top.cnt as top_count
      from d left join tot on tot.day = d.day left join top on top.day = d.day order by d.day`, P),
    supabase.raw(`
      select oi.dish_name as name, min(o.created_at) as first_ordered_at,
             to_char(min(o.created_at at time zone $2)::date,'YYYY-MM-DD') as day
      from order_items oi join orders o on o.id = oi.order_id
      where ${ok}
      group by oi.dish_name
      having min(o.created_at) >= ${from}
         and min(o.created_at at time zone $2)::date >
             (select min(o2.created_at at time zone $2)::date from orders o2 where o2.restaurant_id = $1 and o2.status <> 'cancelled')
      order by 2`, P)
  ]);
  const err = [daily, launches].find(q => q.error);
  if (err) return res.status(500).json({ error: 'heatmap_failed', detail: err.error.message });

  const byDay = {};
  for (const l of launches.data || []) {
    (byDay[l.day] = byDay[l.day] || []).push({ name: l.name, first_ordered_at: new Date(l.first_ordered_at).toISOString() });
  }
  return res.status(200).json((daily.data || []).map(x => ({
    date: x.date,
    top_dish: x.top_name ? { name: x.top_name, count: x.top_count } : null,
    total_orders: x.total_orders,
    dish_launched: byDay[x.date] || []
  })));
}
