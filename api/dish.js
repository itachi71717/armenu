// GET /api/dish?r=restaurant-slug              -> full menu (restaurant + all active dishes)
// GET /api/dish?r=restaurant-slug&d=dish-slug  -> single dish (used by view.html)

import { supabase } from './_db.js';

// .single()/.maybeSingle() report "no rows" as error code PGRST116 — that's a
// real "not found", not a failure. Any other error means the query itself
// broke (e.g. Supabase unreachable) and must not be reported as "not found".
function isRealError(error) {
  return error && error.code !== 'PGRST116';
}

export default async function handler(req, res) {
  const { r, d } = req.query;

  if (!r) {
    return res.status(400).json({ error: 'Missing r (restaurant) param' });
  }

  const { data: restaurant, error: restErr } = await supabase
    .from('restaurants')
    .select('id, name, slug')
    .eq('slug', r)
    .single();

  if (isRealError(restErr)) {
    console.error('dish.js restaurant lookup failed:', restErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  // === FULL MENU (no dish slug provided) ===
  if (!d) {
    const { data: dishes = [], error: dishesErr } = await supabase
      .from('dishes')
      .select('slug, name, price, thumb_url, glb_url')
      .eq('restaurant_id', restaurant.id)
      .eq('active', true)
      .order('name');

    if (isRealError(dishesErr)) {
      console.error('dish.js menu lookup failed:', dishesErr);
      return res.status(502).json({ error: 'Backend temporarily unavailable' });
    }

    return res.status(200).json({
      restaurant: { name: restaurant.name, slug: restaurant.slug },
      dishes: dishes.map(x => ({
        slug: x.slug,
        name: x.name,
        price: x.price,
        thumb: x.thumb_url
      }))
    });
  }

  // === SINGLE DISH ===
  const { data: dish, error: dishErr } = await supabase
    .from('dishes')
    .select('name, price, glb_url, usdz_url, camera_orbit')
    .eq('restaurant_id', restaurant.id)
    .eq('slug', d)
    .eq('active', true)
    .single();

  if (isRealError(dishErr)) {
    console.error('dish.js single-dish lookup failed:', dishErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }
  if (!dish) {
    return res.status(404).json({ error: 'Dish not found' });
  }

  return res.status(200).json({
    dish: dish.name,
    venue: restaurant.name,
    price: dish.price,
    glb: dish.glb_url,
    usdz: dish.usdz_url,
    orbit: dish.camera_orbit
  });
}
