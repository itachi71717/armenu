// GET /api/dish?r=restaurant-slug              -> full menu (restaurant + categorised dishes)
// GET /api/dish?r=restaurant-slug&d=dish-slug  -> single dish (used by view.html)
// Menu payload now includes: category, category_name, description, price_cents, translations, allergens.
// Time-of-day scheduling: if any menu_schedules exist, only dishes whose category is
// scheduled for the current time+day appear (or all dishes if the category has no schedule).

import { supabase } from '../_db.js';

function isRealError(e) { return e && e.code !== 'PGRST116'; }

function nowInWindow(schedule, now) {
  const dow = now.getDay();
  if (!schedule.days_of_week?.includes(dow)) return false;
  const hm = now.toTimeString().slice(0, 8);
  return hm >= schedule.starts_at && hm <= schedule.ends_at;
}

export default async function handler(req, res) {
  const { r, d } = req.query;
  if (!r) return res.status(400).json({ error: 'Missing r (restaurant) param' });

  const { data: restaurant, error: restErr } = await supabase
    .from('restaurants').select('id, name, slug').eq('slug', r).single();

  if (isRealError(restErr)) return res.status(502).json({ error: 'Backend temporarily unavailable' });
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  // === SINGLE DISH ===
  if (d) {
    const { data: dish, error: dishErr } = await supabase.from('dishes')
      .select('name, price, price_cents, description, glb_url, usdz_url, camera_orbit, translations, allergens, scale')
      .eq('restaurant_id', restaurant.id).eq('slug', d).eq('active', true).single();
    if (isRealError(dishErr)) return res.status(502).json({ error: 'Backend temporarily unavailable' });
    if (!dish) return res.status(404).json({ error: 'Dish not found' });
    return res.status(200).json({
      dish: dish.name, venue: restaurant.name,
      price: dish.price, price_cents: dish.price_cents,
      description: dish.description,
      translations: dish.translations || {},
      allergens: dish.allergens,
      glb: dish.glb_url, usdz: dish.usdz_url, orbit: dish.camera_orbit,
      scale: dish.scale || 1
    });
  }

  // === FULL MENU ===
  const [dishesQ, catsQ, schedQ] = await Promise.all([
    supabase.from('dishes')
      .select('slug, name, price, price_cents, description, thumb_url, glb_url, category_id, translations, allergens, sort_order')
      .eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order').order('name'),
    supabase.from('categories').select('id, slug, name, sort_order').eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order'),
    supabase.from('menu_schedules').select('*').eq('restaurant_id', restaurant.id).eq('active', true)
  ]);

  const dishes = dishesQ.data || [];
  const cats = catsQ.data || [];
  const schedules = schedQ.data || [];
  const now = new Date();

  const catById = Object.fromEntries(cats.map(c => [c.id, c]));
  // If schedules exist, compute allowed category IDs
  let allowedCatIds = null;
  if (schedules.length) {
    allowedCatIds = new Set();
    for (const s of schedules) {
      if (nowInWindow(s, now)) for (const cid of (s.category_ids || [])) allowedCatIds.add(cid);
    }
  }

  const filtered = dishes.filter(x => {
    if (allowedCatIds && x.category_id && !allowedCatIds.has(x.category_id)) return false;
    return true;
  });

  return res.status(200).json({
    restaurant: { name: restaurant.name, slug: restaurant.slug },
    dishes: filtered.map(x => ({
      slug: x.slug, name: x.name,
      price: x.price, price_cents: x.price_cents,
      description: x.description,
      thumb: x.thumb_url,
      allergens: x.allergens,
      translations: x.translations || {},
      category:      x.category_id ? catById[x.category_id]?.slug || null : null,
      category_name: x.category_id ? catById[x.category_id]?.name || null : null
    }))
  });
}
