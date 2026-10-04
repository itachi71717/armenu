// GET /api/admin/staff-performance?slug=<r>&range=7d|30d
// → { range, attribution, staff: [{ staff_id, staff_name, role, orders_handled,
//      avg_time_to_ready_min, tables_served, tips_collected_cents }] }
// Attribution: orders.taken_by (and orders.served_by when that column exists).
// When no order carries staff attribution, falls back to waiter_calls
// responded_by counts (if that column exists) as a weaker signal.
// Read-only, so no auditLog call.
import { supabase } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

async function hasColumn(table, col) {
  try {
    const { data } = await supabase.raw(
      `select 1 from information_schema.columns where table_name = $1 and column_name = $2 limit 1`, [table, col]);
    return !!(data && data.length);
  } catch { return false; }
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const range = req.query.range === '7d' ? '7d' : '30d';
  const days = range === '7d' ? 7 : 30;

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  try {
    const [hasServedBy, hasTip] = await Promise.all([
      hasColumn('orders', 'served_by'),
      hasColumn('orders', 'tip_cents')
    ]);
    const who = hasServedBy ? 'coalesce(o.served_by, o.taken_by)' : 'o.taken_by';
    const tip = hasTip ? 'coalesce(o.tip_cents, 0)' : '0';

    const { data: rows, error } = await supabase.raw(`
      select s.id as staff_id, s.name as staff_name, s.role,
        count(o.id)::int as orders_handled,
        avg(extract(epoch from (o.updated_at - o.created_at)) / 60.0)
          filter (where o.status in ('ready', 'served')) as avg_time_to_ready_min,
        count(distinct coalesce(o.table_id::text, o.table_label))
          filter (where coalesce(o.table_id::text, o.table_label) is not null)::int as tables_served,
        coalesce(sum(${tip}), 0)::bigint as tips_collected_cents
      from staff s
      join orders o on ${who} = s.id
        and o.restaurant_id = $1
        and o.status <> 'cancelled'
        and o.created_at >= now() - ($2::int * interval '1 day')
      where s.restaurant_id = $1
      group by s.id, s.name, s.role
      order by orders_handled desc, s.name
    `, [r.id, days]);
    if (error) throw new Error(error.message);

    let staff = (rows || []).map(x => ({
      staff_id: x.staff_id,
      staff_name: x.staff_name,
      role: x.role,
      orders_handled: Number(x.orders_handled) || 0,
      avg_time_to_ready_min: x.avg_time_to_ready_min == null ? null : Math.round(Number(x.avg_time_to_ready_min) * 10) / 10,
      tables_served: Number(x.tables_served) || 0,
      tips_collected_cents: Number(x.tips_collected_cents) || 0
    }));
    let attribution = 'orders';

    if (!staff.length && await hasColumn('waiter_calls', 'responded_by')) {
      const { data: calls } = await supabase.raw(`
        select s.id as staff_id, s.name as staff_name, s.role,
          count(w.id)::int as calls_handled,
          count(distinct coalesce(w.table_id::text, w.table_label))::int as tables_served
        from staff s
        join waiter_calls w on w.responded_by = s.id
          and w.restaurant_id = $1
          and w.created_at >= now() - ($2::int * interval '1 day')
        where s.restaurant_id = $1
        group by s.id, s.name, s.role
        order by calls_handled desc, s.name
      `, [r.id, days]);
      staff = (calls || []).map(x => ({
        staff_id: x.staff_id,
        staff_name: x.staff_name,
        role: x.role,
        orders_handled: Number(x.calls_handled) || 0,
        avg_time_to_ready_min: null,
        tables_served: Number(x.tables_served) || 0,
        tips_collected_cents: 0
      }));
      attribution = 'waiter_calls';
    } else if (!staff.length) {
      attribution = 'none';
    }

    return res.status(200).json({ range, attribution, staff });
  } catch (e) {
    console.error('staff-performance failed:', e);
    return res.status(500).json({ error: 'staff_performance_failed' });
  }
}
