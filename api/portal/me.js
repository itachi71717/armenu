// GET /api/portal/me
// Authenticated restaurant manager — returns their restaurant + dishes.
// Scan analytics are intentionally NOT returned — managers only see those in
// the monthly performance report sent by AR Menu.
// Auth: Authorization: Bearer <Clerk session token>
// Restaurant matched by Clerk email == restaurants.email

import { supabaseAdmin } from '../_db.js';
import { requireManager } from '../_auth.js';

export default async function handler(req, res) {
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const { data: restaurant, error: restErr } = await supabaseAdmin
    .from('restaurants')
    .select('id, slug, name, email')
    .ilike('email', auth.email)
    .maybeSingle();

  if (restErr) {
    console.error('portal/me.js restaurant lookup failed:', restErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }
  if (!restaurant) {
    return res.status(404).json({
      error: 'no_restaurant_linked',
      message: `No restaurant is linked to ${auth.email}. Contact AR Menu support.`
    });
  }

  const { data: dishes = [], error: dishesErr } = await supabaseAdmin
    .from('dishes')
    .select('slug, name, price, thumb_url, active')
    .eq('restaurant_id', restaurant.id)
    .eq('active', true)
    .order('name');

  if (dishesErr) {
    console.error('portal/me.js dishes lookup failed:', dishesErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }

  return res.status(200).json({
    restaurant: { slug: restaurant.slug, name: restaurant.name, email: restaurant.email },
    dishes
  });
}
