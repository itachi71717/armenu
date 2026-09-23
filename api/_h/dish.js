// Guest menu / single-dish lookup.
import { supabase } from '../_db.js';

export default async function handler(req, res) {
  const { r, d } = req.query;
  if (!r) return res.status(400).json({ error: 'Missing r param' });

  // Canary — expose whether Node fetch is broken in this function instance
  if (r === '__canary__') {
    const out = {};
    try { const g = await fetch('https://www.google.com'); out.google = g.status; } catch (e) { out.google_err = e.message; }
    try { const s = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } }); out.supabase = s.status; } catch (e) { out.supabase_err = e.message; }
    out.env_url = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    out.env_key = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return res.status(200).json(out);
  }

  // Resolve restaurant
  const rest = await supabase.from('restaurants').select('id, name, slug').eq('slug', r).single();
  if (rest.error && rest.error.code !== 'PGRST116') {
    return res.status(502).json({ error: 'Backend temporarily unavailable', debug: rest.error.message });
  }
  if (!rest.data) return res.status(404).json({ error: 'Restaurant not found' });
  const restaurant = rest.data;

  // Column sets — try new (v2/v3) first, fall back to old if columns missing
  const NEW_LIST = 'slug, name, price, price_cents, description, thumb_url, glb_url, category_id, translations, allergens, sort_order';
  const OLD_LIST = 'slug, name, price, thumb_url, glb_url';
  const NEW_SINGLE = 'name, price, price_cents, description, glb_url, usdz_url, camera_orbit, translations, allergens, scale';
  const OLD_SINGLE = 'name, price, glb_url, usdz_url, camera_orbit';
  const missing = e => /column .* does not exist/i.test(String(e?.message || '')) || e?.code === '42703';

  // --- SINGLE DISH ---
  if (d) {
    let q = await supabase.from('dishes').select(NEW_SINGLE)
      .eq('restaurant_id', restaurant.id).eq('slug', d).eq('active', true).single();
    if (q.error && missing(q.error)) {
      q = await supabase.from('dishes').select(OLD_SINGLE)
        .eq('restaurant_id', restaurant.id).eq('slug', d).eq('active', true).single();
    }
    if (q.error && q.error.code !== 'PGRST116') return res.status(502).json({ error: 'Backend temporarily unavailable' });
    if (!q.data) return res.status(404).json({ error: 'Dish not found' });
    const x = q.data;
    return res.status(200).json({
      dish: x.name, venue: restaurant.name,
      price: x.price, price_cents: x.price_cents,
      description: x.description,
      translations: x.translations || {},
      allergens: x.allergens,
      glb: x.glb_url, usdz: x.usdz_url, orbit: x.camera_orbit,
      scale: x.scale || 1
    });
  }

  // --- FULL MENU ---
  let q = await supabase.from('dishes').select(NEW_LIST)
    .eq('restaurant_id', restaurant.id).eq('active', true).order('name');
  if (q.error && missing(q.error)) {
    q = await supabase.from('dishes').select(OLD_LIST)
      .eq('restaurant_id', restaurant.id).eq('active', true).order('name');
  }
  if (q.error) return res.status(502).json({ error: 'Backend temporarily unavailable' });
  const dishes = q.data || [];

  // Optional secondary data — degrade silently if missing
  let cats = [];
  try {
    const c = await supabase.from('categories').select('id, slug, name, sort_order')
      .eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order');
    if (!c.error) cats = c.data || [];
  } catch {}
  const catById = Object.fromEntries(cats.map(c => [c.id, c]));

  return res.status(200).json({
    restaurant: { name: restaurant.name, slug: restaurant.slug },
    dishes: dishes.map(x => ({
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
