// Guest menu / single-dish lookup.
import { supabase } from '../_db.js';

// ---- Opening hours ---------------------------------------------------------
// hours: {mon:[["09:00","22:00"]], ...}. Empty/absent (or no slots anywhere)
// => always open. A slot whose close <= open spans midnight into the next day.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const toMinutes = t => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export function computeOpenState(hours, timezone, now = new Date()) {
  const open = { is_open: true, next_open: null };
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return open;
  const hasSlots = DAY_KEYS.some(k => Array.isArray(hours[k]) && hours[k].length);
  if (!hasSlots) return open;
  let wd, mins;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'Africa/Johannesburg', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const get = t => parts.find(p => p.type === t)?.value;
    wd = DAY_KEYS.indexOf(String(get('weekday')).toLowerCase().slice(0, 3));
    mins = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
  } catch { return open; }
  if (wd < 0 || !Number.isFinite(mins)) return open;
  const slotsOf = d => (Array.isArray(hours[DAY_KEYS[(d + 7) % 7]]) ? hours[DAY_KEYS[(d + 7) % 7]] : [])
    .filter(s => Array.isArray(s) && s.length === 2)
    .map(([o, c]) => { const a = toMinutes(o); let b = toMinutes(c); if (b <= a) b += 1440; return [a, b]; });
  // Currently inside a slot today, or a slot that spilled over from yesterday?
  for (const [a, b] of slotsOf(wd)) if (mins >= a && mins < b) return open;
  for (const [, b] of slotsOf(wd - 1)) if (b > 1440 && mins < b - 1440) return open;
  // Find the next slot start within the coming week.
  for (let off = 0; off <= 7; off++) {
    const starts = slotsOf(wd + off).map(([a]) => a).filter(a => off > 0 || a > mins).sort((x, y) => x - y);
    if (starts.length) {
      const a = starts[0];
      const hh = String(Math.floor(a / 60)).padStart(2, '0'), mm = String(a % 60).padStart(2, '0');
      return { is_open: false, next_open: { day: DAY_KEYS[(wd + off) % 7], time: `${hh}:${mm}`, days_ahead: off } };
    }
  }
  return { is_open: false, next_open: null };
}

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
  const NEW_LIST = 'slug, name, price, price_cents, description, thumb_url, glb_url, category_id, translations, allergens, sort_order, stock_count, modifiers';
  const OLD_LIST = 'slug, name, price, thumb_url, glb_url';
  const NEW_SINGLE = 'name, price, price_cents, description, glb_url, usdz_url, camera_orbit, translations, allergens, scale, stock_count, modifiers, thumb_url, slug, id';
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
      price: x.price,
      // Dishes priced only via the legacy text `price` column have null price_cents;
      // fall back to parsing it (same as order.js) so cart totals aren't R0.00.
      price_cents: x.price_cents ?? (typeof x.price === 'string' && Number.isFinite(parseFloat(x.price.replace(/[^0-9.]/g, '')))
        ? Math.round(parseFloat(x.price.replace(/[^0-9.]/g, '')) * 100) : null),
      description: x.description,
      translations: x.translations || {},
      allergens: x.allergens,
      glb: x.glb_url, usdz: x.usdz_url, orbit: x.camera_orbit,
      scale: x.scale || 1,
      // Extra fields so view.html can gate the +Add button correctly
      // (sold-out check + required-modifier group check).
      slug: x.slug, id: x.id, thumb_url: x.thumb_url,
      stock_count: x.stock_count,
      sold_out: typeof x.stock_count === 'number' && x.stock_count <= 0,
      modifiers: Array.isArray(x.modifiers) ? x.modifiers : []
    });
  }

  // --- FULL MENU ---
  let q = await supabase.from('dishes').select(NEW_LIST + ', id')
    .eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order').order('name');
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

  // ============================================================
  // Menu schedule enforcement — a dish whose category_id is targeted by ONE
  // OR MORE schedules is only visible when at least one of those schedules is
  // currently active (SA time UTC+2). Dishes whose category isn't in any
  // schedule stay always-visible. Dishes without a category are always-visible.
  // ============================================================
  let scheduledCategoryIds = new Set();   // categories that have at least one schedule
  let activeCategoryIds = new Set();      // categories currently unlocked by an active schedule
  try {
    const { data: schedules = [] } = await supabase.from('menu_schedules')
      .select('starts_at, ends_at, days_of_week, category_ids, active').eq('restaurant_id', restaurant.id);
    const sa = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const dow = sa.getUTCDay();
    const mins = sa.getUTCHours() * 60 + sa.getUTCMinutes();
    const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    for (const s of schedules) {
      if (s.active === false) continue;
      const targets = Array.isArray(s.category_ids) ? s.category_ids : [];
      for (const cid of targets) scheduledCategoryIds.add(cid);
      const days = Array.isArray(s.days_of_week) && s.days_of_week.length ? s.days_of_week : [0,1,2,3,4,5,6];
      if (!days.includes(dow)) continue;
      const st = toMin(s.starts_at), en = toMin(s.ends_at);
      if (st === en) continue;
      const inWindow = st < en ? (mins >= st && mins < en) : (mins >= st || mins < en);
      if (inWindow) for (const cid of targets) activeCategoryIds.add(cid);
    }
  } catch {}
  const dishVisible = (dish) => {
    if (!dish.category_id) return true;
    if (!scheduledCategoryIds.has(dish.category_id)) return true;
    return activeCategoryIds.has(dish.category_id);
  };

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

  const visibleDishes = dishes.filter(dishVisible);

  // Popularity (last 7d) + wait estimate: optional, run in parallel, degrade silently.
  const popCounts = {};
  let popMax = 0, orders7d = 0;
  let wait_estimate = null;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await Promise.all([
    (async () => {
      const pc = await supabase.raw(
        `select oi.dish_id, count(distinct o.id)::int as n
           from order_items oi join orders o on o.id = oi.order_id
          where o.restaurant_id = $1 and o.created_at >= $2 and o.status <> 'cancelled' and oi.dish_id is not null
          group by oi.dish_id`, [restaurant.id, since]);
      for (const row of (pc.data || [])) { const n = parseInt(row.n, 10) || 0; popCounts[row.dish_id] = n; if (n > popMax) popMax = n; }
      const tc = await supabase.raw(
        `select count(*)::int as n from orders where restaurant_id = $1 and created_at >= $2 and status <> 'cancelled'`, [restaurant.id, since]);
      orders7d = parseInt(tc.data?.[0]?.n, 10) || 0;
    })().catch(() => {}),
    (async () => {
      const [served, q] = await Promise.all([
        supabase.raw(
          `select extract(epoch from (updated_at - created_at)) / 60.0 as mins
             from orders where restaurant_id = $1 and status = 'served' and updated_at is not null
            order by updated_at desc limit 20`, [restaurant.id]),
        supabase.raw(
          `select count(*)::int as n from orders where restaurant_id = $1 and status in ('new', 'prep')`, [restaurant.id])
      ]);
      const mins = (served.data || []).map(x => Number(x.mins)).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
      if (mins.length) {
        const mid = Math.floor(mins.length / 2);
        const med = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
        wait_estimate = { p50_min: Math.min(45, Math.max(1, Math.round(med))), current_queue: parseInt(q.data?.[0]?.n, 10) || 0 };
      }
    })().catch(() => {})
  ]);

  // Combos + open/closed state — optional, degrade silently if tables/columns missing.
  let combos = [];
  try {
    const cq = await supabase.from('combos').select('id, slug, name, description, item_ids, price_cents, thumb_url')
      .eq('restaurant_id', restaurant.id).eq('active', true).order('sort_order').order('created_at');
    if (!cq.error) {
      const allDishes = await supabase.from('dishes').select('id, name, price_cents, price, active').eq('restaurant_id', restaurant.id);
      const byId = Object.fromEntries((allDishes.data || []).map(x => [x.id, x]));
      combos = (cq.data || []).map(c => {
        const ids = Array.isArray(c.item_ids) ? c.item_ids : [];
        const items = ids.map(id => byId[id]);
        // Hide a combo whose dishes were deleted or deactivated — it can't be ordered.
        if (!ids.length || items.some(x => !x || x.active === false)) return null;
        const sum = items.reduce((s, x) => s + (x.price_cents ?? parsePrice(x.price) ?? 0), 0);
        return {
          id: c.id, slug: c.slug, name: c.name, description: c.description,
          item_ids: ids, item_names: items.map(x => x.name),
          price_cents: c.price_cents, thumb_url: c.thumb_url,
          savings_cents: Math.max(0, sum - (c.price_cents || 0))
        };
      }).filter(Boolean);
    }
  } catch {}
  let openState = { is_open: true, next_open: null }, openingHours = {}, timezone = null;
  try {
    const st = await supabase.from('restaurant_settings').select('opening_hours, timezone').eq('restaurant_id', restaurant.id).maybeSingle();
    if (!st.error && st.data) {
      openingHours = st.data.opening_hours || {};
      timezone = st.data.timezone || null;
      openState = computeOpenState(openingHours, timezone);
    }
  } catch {}

  return res.status(200).json({
    restaurant: { name: restaurant.name, slug: restaurant.slug },
    is_open: openState.is_open,
    next_open: openState.next_open,
    timezone,
    combos,
    orders_7d: orders7d,
    wait_estimate,
    dishes: visibleDishes.map(x => {
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
        price_cents: discounted_price_cents ?? x.price_cents ?? parsePrice(x.price),
        original_price, original_price_cents,
        discount_pct, offer_name,
        description: x.description,
        thumb: x.thumb_url,
        allergens: x.allergens,
        translations: x.translations || {},
        category:      x.category_id ? catById[x.category_id]?.slug || null : null,
        category_name: x.category_id ? catById[x.category_id]?.name || null : null,
        // Gate on the server too: no badge scores until the venue has 20+ orders in
        // 7d, and a dish needs at least 3 orders itself (otherwise a dish with a
        // single order can read as "100% of the top seller" and show Trending).
        popularity_score: (popMax > 0 && orders7d >= 20 && (popCounts[x.id] || 0) >= 3)
          ? Math.round(((popCounts[x.id] || 0) / popMax) * 100) : 0,
        stock: x.stock_count == null ? null : x.stock_count,
        sold_out: typeof x.stock_count === 'number' && x.stock_count <= 0,
        modifiers: Array.isArray(x.modifiers) ? x.modifiers : []
      };
    })
  });
}
