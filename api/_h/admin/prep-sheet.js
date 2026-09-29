// GET /api/admin/prep-sheet?slug=r&date=yyyy-mm-dd  (default: tomorrow, restaurant-local)
// Average quantity per dish on the same weekday over the last 4 weeks.
import { supabase } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';

const DEFAULT_TZ = 'Africa/Johannesburg';
function validTz(tz) {
  if (!tz || typeof tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
}
function localToday(tz) {
  // en-CA formats as yyyy-mm-dd
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  const slug = req.query?.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data: r } = await supabase.from('restaurants').select('id, name').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const { data: st } = await supabase.raw(
    'select timezone from restaurant_settings where restaurant_id = $1 limit 1', [r.id]);
  const tz = validTz(st?.[0]?.timezone) || DEFAULT_TZ;

  let date = req.query?.date;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime()))) {
    return res.status(400).json({ error: 'date must be yyyy-mm-dd' });
  }
  if (!date) date = addDays(localToday(tz), 1);

  // Same weekday, 1-4 weeks back (restaurant-local calendar days).
  const { data: rows, error } = await supabase.raw(`
    select oi.dish_name,
           sum(oi.qty)::float / 4 as avg_qty,
           ks.name as station_name,
           c.name  as category_name
      from orders o
      join order_items oi on oi.order_id = o.id
      left join dishes d on d.id = oi.dish_id
      left join kitchen_stations ks on ks.id = d.station_id
      left join categories c on c.id = d.category_id
     where o.restaurant_id = $1
       and o.status <> 'cancelled'
       and (o.created_at at time zone $2)::date in (
             ($3::date - 7), ($3::date - 14), ($3::date - 21), ($3::date - 28))
     group by oi.dish_name, ks.name, c.name
     order by avg_qty desc, oi.dish_name
     limit 40`, [r.id, tz, date]);
  if (error) return res.status(500).json({ error: error.message });

  const dishes = (rows || []).map(x => ({
    dish_name: x.dish_name,
    avg_qty: Math.round(Number(x.avg_qty) * 10) / 10,
    station_name: x.station_name || null,
    category_name: x.category_name || null
  }));
  return res.status(200).json({ generated_for: date, restaurant_name: r.name, dishes });
}
