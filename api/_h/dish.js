// Guest menu / single-dish lookup.
import { supabase } from '../_db.js';

export default async function handler(req, res) {
  const { r, d } = req.query;
  if (!r) return res.status(400).json({ error: 'Missing r param' });

  // Resolve restaurant (use maybeSingle so no-rows returns null instead of erroring)
  const rest = await supabase.from('restaurants').select('id, name, slug').eq('slug', r).maybeSingle();
  if (rest.error) {
    return res.status(502).json({ error: 'Backend temporarily unavailable — please retry in a moment' });
  }
  if (!rest.data) return res.status(404).json({ error: 'Restaurant not found' });
  const restaurant = rest.data;

  // Column sets — try new (v2/v3) first, fall back to old if columns missing
  const NEW_LIST = 'slug, name, price, price_cents, description, thumb_url, glb_url, category_id, translations, allergens, sort_order, stock_count';
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
  let q = await supabase.from('dishes').select(NEW_LIST + ', id')
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

  // Active offers RIGHT NOW (in SA time — offers.starts_at/ends_at are `time`
  // local wall-clock, days_of_week uses 0=Sun..6=Sat).
  // We fetch every offer, then filter in JS so we can short-circuit cleanly.
  let activeOffers = [];
  try {
    const { data: offers = [] } = await supabase.from('offers').select('id, name, discount_pct, starts_at, ends_at, days_of_week, dish_ids, active').eq('restaurant_id', restaurant.id);
    // SA wall-clock: UTC+2, no DST
    const now = new Date();
    const sa = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const dow = sa.getUTCDay();                                 // 0=Sun..6=Sat
    const mins = sa.getUTCHours() * 60 + sa.getUTCMinutes();
    const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    activeOffers = offers.filter(o => {
      if (o.active === false) return false;
      const days = Array.isArray(o.days_of_week) && o.days_of_week.length ? o.days_of_week : [0,1,2,3,4,5,6];
      if (!days.includes(dow)) return false;
      const s = toMin(o.starts_at), e = toMin(o.ends_at);
      if (s === e) return false;
      if (s < e) return mins >= s && mins < e;
      // Overnight window (e.g. 22:00–02:00) — spans midnight
      return mins >= s || mins < e;
    });
  } catch {}

  // Pick the best (highest %) matching offer per dish.
  // If a dish has no id (old-schema fallback path), only unscoped offers apply.
  const bestOfferFor = (dishId) => {
    let best = null;
    for (const o of activeOffers) {
      const scoped = Array.isArray(o.dish_ids) && o.dish_ids.length > 0;
      if (scoped) {
        if (!dishId || !o.dish_ids.includes(dishId)) continue;
      }
      if (!best || o.discount_pct > best.discount_pct) best = o;
    }
    return best;
  };
  const parsePrice = (s) => {
    if (typeof s !== 'string') return null;
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const formatPrice = (cents, template) => {
    const rand = (cents / 100);
    // Preserve original currency symbol / decimals from the string form
    if (template) {
      const sym = (String(template).match(/[^\d.,\s]+/) || [''])[0].trim();
      const hasDec = /[.,]\d{2}/.test(template);
      return `${sym ? sym + ' ' : ''}${hasDec ? rand.toFixed(2) : Math.round(rand)}`;
    }
    return `R ${rand.toFixed(0)}`;
  };

  return res.status(200).json({
    restaurant: { name: restaurant.name, slug: restaurant.slug },
    dishes: dishes.map(x => {
      const off = bestOfferFor(x.id);
      let discounted_price = null, discounted_price_cents = null, discount_pct = null, offer_name = null, original_price = null, original_price_cents = null;
      if (off) {
        const baseCents = x.price_cents ?? parsePrice(x.price);
        if (baseCents) {
          const newCents = Math.round(baseCents * (100 - off.discount_pct) / 100);
          discount_pct = off.discount_pct;
          offer_name = off.name;
          original_price = x.price;
          original_price_cents = baseCents;
          discounted_price_cents = newCents;
          discounted_price = formatPrice(newCents, x.price);
        }
      }
      return {
        slug: x.slug, name: x.name,
        price: discounted_price ?? x.price,
        price_cents: discounted_price_cents ?? x.price_cents,
        original_price, original_price_cents,
        discount_pct, offer_name,
        description: x.description,
        thumb: x.thumb_url,
        allergens: x.allergens,
        translations: x.translations || {},
        category:      x.category_id ? catById[x.category_id]?.slug || null : null,
        category_name: x.category_id ? catById[x.category_id]?.name || null : null,
        stock: x.stock_count == null ? null : x.stock_count,
        sold_out: x.stock_count === 0
      };
    })
  });
}
