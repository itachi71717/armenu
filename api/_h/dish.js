// GET /api/dish?r=restaurant-slug              -> full menu (restaurant + categorised dishes)
// GET /api/dish?r=restaurant-slug&d=dish-slug  -> single dish (used by view.html)
// Defensive: falls back to a smaller column set if the v2/v3 columns are not
// yet in the DB (unmigrated deploys still get a working menu, without the
// new features).
import { supabase } from '../_db.js';

const NEW_COLS_SINGLE = 'name, price, price_cents, description, glb_url, usdz_url, camera_orbit, translations, allergens, scale';
const OLD_COLS_SINGLE = 'name, price, glb_url, usdz_url, camera_orbit';
const NEW_COLS_LIST   = 'slug, name, price, price_cents, description, thumb_url, glb_url, category_id, translations, allergens, sort_order';
const OLD_COLS_LIST   = 'slug, name, price, thumb_url, glb_url';

function isColumnMissing(err) {
  const msg = String(err?.message || err?.details || '');
  return /column .* does not exist/i.test(msg) || err?.code === '42703';
}
function isMissingTable(err) {
  const msg = String(err?.message || err?.details || '');
  return /relation .* does not exist/i.test(msg) || err?.code === '42P01';
}
function isReal(err) { return err && err.code !== 'PGRST116'; }

function nowInWindow(schedule, now) {
  const dow = now.getDay();
  if (!schedule.days_of_week?.includes(dow)) return false;
  const hm = now.toTimeString().slice(0, 8);
  return hm >= schedule.starts_at && hm <= schedule.ends_at;
}

export default async function handler(req, res) {
  const { r, d } = req.query;
  if (!r) return res.status(400).json({ error: 'Missing r (restaurant) param', query: req.query, url: req.url });

  const { data: restaurant, error: restErr } = await supabase
    .from('restaurants').select('id, name, slug').eq('slug', r).maybeSingle();
  if (restErr) return res.status(502).json({ error: 'Backend temporarily unavailable', debug: restErr.message, code: restErr.code });
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  // === SINGLE DISH ===
  if (d) {
    let dish, err;
    ({ data: dish, error: err } = await supabase.from('dishes')
      .select(NEW_COLS_SINGLE)
      .eq('restaurant_id', restaurant.id).eq('slug', d).eq('active', true).single());
    if (err && isColumnMissing(err)) {
      ({ data: dish, error: err } = await supabase.from('dishes')
        .select(OLD_COLS_SINGLE)
        .eq('restaurant_id', restaurant.id).eq('slug', d).eq('active', true).single());
    }
    if (isReal(err)) return res.status(502).json({ error: 'Backend temporarily unavailable' });
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
  let dishes, err;
  ({ data: dishes, error: err } = await supabase.from('dishes')
    .select(NEW_COLS_LIST)
    .eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order').order('name'));
  if (err && isColumnMissing(err)) {
    ({ data: dishes, error: err } = await supabase.from('dishes')
      .select(OLD_COLS_LIST)
      .eq('restaurant_id', restaurant.id).eq('active', true).order('name'));
  }
  if (isReal(err)) return res.status(502).json({ error: 'Backend temporarily unavailable' });
  dishes = dishes || [];

  // Optional secondary lookups — degrade silently if tables don't exist yet
  let cats = [], schedules = [];
  try {
    const c = await supabase.from('categories').select('id, slug, name, sort_order').eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order');
    if (!isMissingTable(c.error)) cats = c.data || [];
  } catch {}
  try {
    const s = await supabase.from('menu_schedules').select('*').eq('restaurant_id', restaurant.id).eq('active', true);
    if (!isMissingTable(s.error)) schedules = s.data || [];
  } catch {}

  const catById = Object.fromEntries(cats.map(c => [c.id, c]));
  const now = new Date();
  let allowedCatIds = null;
  if (schedules.length) {
    allowedCatIds = new Set();
    for (const sc of schedules) if (nowInWindow(sc, now)) for (const cid of (sc.category_ids || [])) allowedCatIds.add(cid);
  }
  const filtered = dishes.filter(x => !(allowedCatIds && x.category_id && !allowedCatIds.has(x.category_id)));

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
