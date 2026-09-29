// GET /api/portal/badges[?slug=<r>] → nav badge counts for ONE restaurant.
//   { new_orders, unresponded_calls, waitlist_pending, new_reviews_24h, active_reservations }
// Auth (scope-guarded): x-portal-token (bound to one restaurant), a Clerk
// manager Bearer token (must own / be invited to the slug), or master admin
// (slug required). Raw COUNT queries only — polled every 30s.
import { supabase } from '../../_db.js';
import { requireManager, getScopedRestaurantId } from '../../_auth.js';
import { readAdminCookie } from '../admin/login.js';

async function resolveRestaurantId(req) {
  const slug = req.query?.slug ? String(req.query.slug) : '';
  const scoped = getScopedRestaurantId(req);
  if (scoped) {
    if (slug) {
      const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
      if (!r || String(r.id) !== String(scoped)) return { status: 403, error: 'out_of_scope' };
    }
    return { id: scoped };
  }
  const secret = process.env.ADMIN_SECRET;
  const isMaster = !!(readAdminCookie(req) || (secret && req.headers['x-admin-secret'] === secret));
  if (isMaster) {
    if (!slug) return { status: 400, error: 'slug required' };
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    return r ? { id: r.id } : { status: 404, error: 'restaurant not found' };
  }
  const auth = await requireManager(req);
  if (!auth) return { status: 401, error: 'unauthorized' };
  const email = String(auth.email).toLowerCase();
  const rows = await supabase.raw(`
    select r.id from restaurants r
    where ($2::text = '' or r.slug = $2)
      and (lower(r.email) = $1 or r.id in (select restaurant_id from manager_users where lower(email) = $1))
    order by r.name limit 1
  `, [email, slug]);
  const row = rows.data?.[0];
  return row ? { id: row.id } : { status: slug ? 403 : 404, error: slug ? 'out_of_scope' : 'no_restaurant_linked' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const who = await resolveRestaurantId(req);
    if (!who.id) return res.status(who.status).json({ error: who.error });

    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const rows = await supabase.raw(`
      select
        (select count(*)::int from orders where restaurant_id = $1 and status = 'new') as new_orders,
        (select count(*)::int from waiter_calls where restaurant_id = $1 and status = 'open') as unresponded_calls,
        (select count(*)::int from waitlist_entries where restaurant_id = $1 and seated_at is null and left_at is null) as waitlist_pending,
        (select count(*)::int from reviews where restaurant_id = $1 and created_at >= $2) as new_reviews_24h,
        (select count(*)::int from reservations where restaurant_id = $1 and reserved_at >= now() and status in ('pending','confirmed') and (is_walkin is not true)) as active_reservations
    `, [who.id, since24h]);
    const r = rows.data?.[0] || {};
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      new_orders: r.new_orders || 0,
      unresponded_calls: r.unresponded_calls || 0,
      waitlist_pending: r.waitlist_pending || 0,
      new_reviews_24h: r.new_reviews_24h || 0,
      active_reservations: r.active_reservations || 0
    });
  } catch (e) {
    console.error('portal badges failed:', e);
    return res.status(500).json({ error: 'Badges load failed' });
  }
}
