// GET /api/portal/dashboard → { orders_today, bookings_tonight, walkins_active, low_stock, revenue_today_cents }
// Manager-auth. One round-trip instead of three from the browser.
import { supabase } from '../../_db.js';
import { requireManager } from '../../_auth.js';

export default async function handler(req, res) {
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const { data: rest } = await supabase.from('restaurants').select('id, slug, name').ilike('email', auth.email).order('name').limit(1).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'no_restaurant_linked' });

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const tonightEnd = new Date(); tonightEnd.setHours(24, 0, 0, 0);
  const nowIso = new Date().toISOString();
  const todayIso = todayStart.toISOString();
  const tonightIso = tonightEnd.toISOString();

  try {
    const rows = await supabase.raw(`
      select
        (select count(*)::int from orders where restaurant_id = $1 and created_at >= $2) as orders_today,
        (select coalesce(sum(total_cents), 0)::bigint from orders where restaurant_id = $1 and created_at >= $2) as revenue_today_cents,
        (select count(*)::int from reservations where restaurant_id = $1 and reserved_at >= $3 and reserved_at < $4 and status in ('pending', 'confirmed') and (is_walkin is not true)) as bookings_tonight,
        (select count(*)::int from reservations where restaurant_id = $1 and is_walkin = true and status in ('pending','confirmed')) as walkins_active,
        (select count(*)::int from dishes where restaurant_id = $1 and active = true and stock_count is not null and stock_count <= 3) as low_stock
    `, [rest.id, todayIso, nowIso, tonightIso]);
    const r = rows.data?.[0] || {};
    return res.status(200).json({
      restaurant: { slug: rest.slug, name: rest.name },
      orders_today: r.orders_today || 0,
      revenue_today_cents: Number(r.revenue_today_cents || 0),
      bookings_tonight: r.bookings_tonight || 0,
      walkins_active: r.walkins_active || 0,
      low_stock: r.low_stock || 0
    });
  } catch (e) {
    console.error('dashboard failed:', e);
    return res.status(500).json({ error: 'Dashboard load failed' });
  }
}
