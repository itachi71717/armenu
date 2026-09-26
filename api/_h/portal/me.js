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

  // Owned restaurants (their email is on the row) PLUS any restaurant they've
  // been invited to as a teammate (manager_users row for their email).
  const email = String(auth.email).toLowerCase();
  const [ownRes, teamRes] = await Promise.all([
    supabaseAdmin.from('restaurants').select('id, slug, name, email').eq('email', email),
    supabaseAdmin.from('manager_users').select('restaurant_id, role').eq('email', email)
  ]);
  if (ownRes.error) {
    console.error('portal/me.js restaurant lookup failed:', ownRes.error);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }
  let rests = ownRes.data || [];
  const ownedIds = new Set(rests.map(r => r.id));
  const inviteIds = (teamRes.data || []).map(t => t.restaurant_id).filter(id => !ownedIds.has(id));
  if (inviteIds.length) {
    const { data: teamRests = [] } = await supabaseAdmin
      .from('restaurants').select('id, slug, name, email').in('id', inviteIds);
    // Mark invited-in restaurants so the UI can hide owner-only actions
    for (const r of teamRests) r._role = 'teammate';
    rests = [...rests, ...teamRests];
  }
  rests.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  // Mark accepted_at on first login for any pending invites this user is on.
  // (Previously guarded by `.some(t => true)` which is always true — but if
  // teamRes.error was set, teamRes.data was null and nothing ran. Now runs
  // unconditionally on every /me call — fast and idempotent.)
  supabaseAdmin.raw(
    "update manager_users set accepted_at = now() where lower(email) = lower($1) and accepted_at is null",
    [auth.email]
  ).catch(() => {});
  if (!rests.length) {
    return res.status(404).json({
      error: 'no_restaurant_linked',
      message: `No restaurant is linked to ${auth.email}. Contact AR Menu support.`
    });
  }

  // Batched load: 4 total queries regardless of location count (was 4×N).
  const sevenAgoIso = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const restIds = rests.map(r => r.id);
  const [dishesQ, scansQ, ordersQ, revsQ] = await Promise.all([
    supabase.from('dishes').select('id, restaurant_id, slug, name, price, thumb_url, active, stock_count, description, category_id, translations').in('restaurant_id', restIds).eq('active', true).order('name'),
    supabase.from('scans').select('restaurant_id').in('restaurant_id', restIds).gte('scanned_at', sevenAgoIso),
    supabase.from('orders').select('restaurant_id, total_cents').in('restaurant_id', restIds).gte('created_at', sevenAgoIso),
    supabase.from('reviews').select('restaurant_id, rating').in('restaurant_id', restIds).gte('created_at', sevenAgoIso)
  ]);
  const groupBy = (rows, key) => {
    const m = {};
    for (const row of rows || []) (m[row[key]] = m[row[key]] || []).push(row);
    return m;
  };
  const dishesByR = groupBy(dishesQ.data, 'restaurant_id');
  const scansByR  = groupBy(scansQ.data,  'restaurant_id');
  const ordersByR = groupBy(ordersQ.data, 'restaurant_id');
  const revsByR   = groupBy(revsQ.data,   'restaurant_id');

  const locations = rests.map(r => {
    const dishes = dishesByR[r.id] || [];
    const scans  = scansByR[r.id]  || [];
    const orders = ordersByR[r.id] || [];
    const revs   = revsByR[r.id]   || [];
    const revenue_cents_7d = orders.reduce((s, o) => s + (o.total_cents || 0), 0);
    const avg_rating_7d = revs.length ? (revs.reduce((s, x) => s + (x.rating || 0), 0) / revs.length) : null;
    return {
      id: r.id, slug: r.slug, name: r.name, email: r.email,
      role: r._role || 'owner',
      dishes,
      metrics_7d: {
        scans: scans.length,
        orders: orders.length,
        revenue_cents: revenue_cents_7d,
        avg_rating: avg_rating_7d
      }
    };
  });

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
