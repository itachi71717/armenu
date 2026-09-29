// POST /api/order
// Body: { r: slug, table: label|null, items: [{dish_slug, qty, note} | {combo_id, qty}], note? }
// Public — gated by restaurant_settings.orders_enabled.

import { supabase } from '../_db.js';
import { sendPush } from './push/_send.js';
import { loyaltyConfig, rewardDishAvailable } from './customer/loyalty.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { r, table, items, note, tip_cents, client_order_id, customer_token, redeem_loyalty } = body || {};
  if (!r) return res.status(400).json({ error: 'Missing r' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items' });

  // Optional customer_token → customer_id. Resolves through any merge chain
  // (see docs/customer-profiles.md). Unresolvable/omitted token is silent —
  // orders.customer_id just stays null, no error, no behavior change.
  let customer_id = null;
  const TOKEN_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  if (typeof customer_token === 'string' && TOKEN_RE.test(customer_token)) {
    try {
      let { data: crow } = await supabase.from('customers').select('id, merged_into').eq('token', customer_token).maybeSingle();
      let hops = 0;
      while (crow?.merged_into && hops < 5) {
        const { data: next } = await supabase.from('customers').select('id, merged_into').eq('id', crow.merged_into).maybeSingle();
        if (!next) break;
        crow = next;
        hops++;
      }
      if (!crow) {
        // Token is well-formed but /hello hasn't created the row yet (parallel
        // page-load race, or first order before the profile call landed). Create it
        // so this order is linked and "order ready" pushes can find the guest.
        await supabase.from('customers').insert({ token: customer_token, last_seen_at: new Date().toISOString() });
        const { data: again } = await supabase.from('customers').select('id, merged_into').eq('token', customer_token).maybeSingle();
        crow = again;
      }
      if (crow) customer_id = crow.id;
    } catch {}
  }

  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', r).single();
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  // Idempotency — if the guest's client sent the same client_order_id in the
  // last 15 min (network drop → retry pattern) return the existing order id
  // rather than creating a duplicate. Bounded window so an old id can be
  // reused for a legitimate new order later in the day.
  if (client_order_id && typeof client_order_id === 'string') {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: dup } = await supabase.from('orders')
      .select('id').eq('restaurant_id', restaurant.id)
      .eq('client_order_id', String(client_order_id).slice(0, 60))
      .gte('created_at', cutoff).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (dup) return res.status(200).json({ ok: true, order_id: dup.id, duplicate: true });
  }

  // Default to orders-enabled when the settings row hasn't been created yet
  // (brand-new restaurant). Managers can still disable via the portal.
  const { data: settings } = await supabase.from('restaurant_settings')
    .select('orders_enabled, default_currency').eq('restaurant_id', restaurant.id).maybeSingle();
  const ordersEnabled = settings ? (settings.orders_enabled !== false) : true;
  if (!ordersEnabled) return res.status(403).json({ error: 'Ordering is not enabled for this restaurant' });
  // Opening hours are informational only: restaurants may run specials outside
  // listed hours, so is_open never gates ordering.

  // Resolve table
  let table_id = null, table_label = table || null;
  if (table) {
    const { data: t } = await supabase.from('restaurant_tables')
      .select('id, label').eq('restaurant_id', restaurant.id).eq('label', table).maybeSingle();
    if (t) { table_id = t.id; table_label = t.label; }
  }

  // Resolve dishes and snapshot prices
  const slugs = items.map(i => String(i.dish_slug || '').trim()).filter(Boolean);
  const { data: dishes = [] } = await supabase.from('dishes')
    .select('id, slug, name, price_cents, price, stock_count, modifiers')
    .eq('restaurant_id', restaurant.id)
    .in('slug', slugs);

  // Active offers RIGHT NOW (mirror of the logic in /api/dish so the price
  // the guest is charged matches the discounted price they saw on the menu).
  let activeOffers = [];
  try {
    const { data: off = [] } = await supabase.from('offers').select('discount_pct, starts_at, ends_at, days_of_week, dish_ids, active').eq('restaurant_id', restaurant.id);
    const sa = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const dow = sa.getUTCDay();
    const mins = sa.getUTCHours() * 60 + sa.getUTCMinutes();
    const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    activeOffers = off.filter(o => {
      if (o.active === false) return false;
      const days = Array.isArray(o.days_of_week) && o.days_of_week.length ? o.days_of_week : [0,1,2,3,4,5,6];
      if (!days.includes(dow)) return false;
      const s = toMin(o.starts_at), e = toMin(o.ends_at);
      if (s === e) return false;
      return s < e ? (mins >= s && mins < e) : (mins >= s || mins < e);
    });
  } catch {}
  const discountPctFor = (dishId) => {
    let best = 0;
    for (const o of activeOffers) {
      const scoped = Array.isArray(o.dish_ids) && o.dish_ids.length > 0;
      if (scoped && (!dishId || !o.dish_ids.includes(dishId))) continue;
      if (o.discount_pct > best) best = o.discount_pct;
    }
    return best;
  };

  const bySlug = Object.fromEntries(dishes.map(d => [d.slug, d]));
  const resolved = items.map(i => {
    const d = bySlug[String(i.dish_slug || '').trim()];
    if (!d) return null;
    const qty = Math.max(1, Math.min(99, parseInt(i.qty || 1)));
    const baseCents = d.price_cents ?? parsePrice(d.price);
    const pct = discountPctFor(d.id);
    // Re-derive modifier deltas from the AUTHORITATIVE dishes.modifiers on the
    // server row. The client's price_cents_delta is entirely discarded —
    // otherwise a guest could send -R500 on 12 mods and drop total to negative.
    // Dish modifiers shape (from portal/index.html parseModifiersText, stored
    // verbatim by admin/dishes.js and returned by dish.js) is a NESTED list of
    // groups, each with options — NOT a flat list of options:
    //   [{ label, required, multi, options: [{ name, price_cents_delta }, …] }]
    // The client (menu.html:780) sends picks keyed as { id: 'gi-oi', group: g.label, ... }
    // so we build the lookup by walking group index + option index in that order.
    const dishMods = Array.isArray(d.modifiers) ? d.modifiers : [];
    const modLookup = new Map();
    for (let gi = 0; gi < dishMods.length; gi++) {
      const g = dishMods[gi];
      const opts = Array.isArray(g?.options) ? g.options : [];
      for (let oi = 0; oi < opts.length; oi++) {
        const o = opts[oi];
        const key = String(g.label || '') + '::' + gi + '-' + oi;
        modLookup.set(key, {
          id: gi + '-' + oi,
          group: String(g.label || '').slice(0, 60),
          name: String(o?.name || '').slice(0, 60),
          price_cents_delta: Math.max(-50000, Math.min(50000, parseInt(o?.price_cents_delta) || 0))
        });
      }
    }
    const rawPicks = Array.isArray(i.modifiers) ? i.modifiers.slice(0, 12) : [];
    const mods = [];
    for (const pick of rawPicks) {
      const key = String(pick.group || '') + '::' + String(pick.id || '');
      const authoritative = modLookup.get(key);
      if (authoritative) mods.push(authoritative);
      // Unknown mods are silently dropped — they'd only get here if the client
      // sent a modifier the dish doesn't offer (stale menu / tamper).
    }
    const modCents = mods.reduce((s, m) => s + m.price_cents_delta, 0);
    const withMods = (baseCents || 0) + modCents;
    // Guard: a mispriced dish (modifiers that net negative deeper than base)
    // must never result in a negative charge.
    const finalCents = Math.max(0, pct ? Math.round(withMods * (100 - pct) / 100) : withMods);
    return {
      dish_id: d.id,
      dish_name: d.name,
      qty,
      stock_count: d.stock_count,
      price_cents: finalCents,
      modifiers: mods,
      note: String(i.note || '').slice(0, 200) || null
    };
  }).filter(Boolean);

  // Combo line items: expand into one row per constituent dish, storing combo_id
  // on each. The combo's set price is spread across the rows (proportional to
  // each dish's current price) so the order total equals the combo price.
  const comboItems = items.filter(i => i && i.combo_id);
  if (comboItems.length) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const comboIds = [...new Set(comboItems.map(i => String(i.combo_id)).filter(id => UUID_RE.test(id)))];
    const { data: combos = [] } = comboIds.length
      ? await supabase.from('combos').select('id, name, item_ids, price_cents, active').eq('restaurant_id', restaurant.id).in('id', comboIds)
      : { data: [] };
    const comboById = Object.fromEntries((combos || []).map(c => [c.id, c]));
    const allIds = [...new Set((combos || []).flatMap(c => Array.isArray(c.item_ids) ? c.item_ids : []))];
    const { data: cdishes = [] } = allIds.length
      ? await supabase.from('dishes').select('id, name, price_cents, price, stock_count, active').eq('restaurant_id', restaurant.id).in('id', allIds)
      : { data: [] };
    const dishById = Object.fromEntries((cdishes || []).map(d => [d.id, d]));
    for (const ci of comboItems) {
      const c = comboById[String(ci.combo_id)];
      const ids = Array.isArray(c?.item_ids) ? c.item_ids : [];
      const ds = ids.map(id => dishById[id]);
      if (!c || c.active === false || !ids.length || ds.some(d => !d || d.active === false)) {
        return res.status(409).json({ error: 'combo_unavailable', message: 'A combo in your cart is no longer available. Please update your cart.' });
      }
      const qty = Math.max(1, Math.min(99, parseInt(ci.qty || 1) || 1));
      const bases = ds.map(d => d.price_cents ?? parsePrice(d.price) ?? 0);
      const baseSum = bases.reduce((a, b) => a + b, 0);
      const target = Math.max(0, c.price_cents || 0);
      let assigned = 0;
      ds.forEach((d, idx) => {
        let cents;
        if (idx === ds.length - 1) cents = target - assigned;
        else cents = baseSum > 0 ? Math.round(target * bases[idx] / baseSum) : Math.floor(target / ds.length);
        cents = Math.max(0, cents);
        assigned += cents;
        resolved.push({
          dish_id: d.id, dish_name: d.name, qty, stock_count: d.stock_count,
          price_cents: cents, modifiers: [],
          note: String(ci.note || '').slice(0, 200) || null,
          combo_id: c.id
        });
      });
    }
  }

  if (!resolved.length) return res.status(400).json({ error: 'No valid dishes in cart' });

  // Stock check — reject if any tracked item can't be fulfilled
  // Aggregate per dish: the same dish on two cart lines (different modifiers) must be
  // checked against stock as one total, not line by line.
  const qtyByDish = {};
  for (const x of resolved) qtyByDish[x.dish_id] = (qtyByDish[x.dish_id] || 0) + x.qty;
  const outOfStock = resolved.filter((x, idx, arr) => x.stock_count != null && x.stock_count < qtyByDish[x.dish_id]
    && arr.findIndex(y => y.dish_id === x.dish_id) === idx);
  if (outOfStock.length) {
    return res.status(409).json({
      error: 'out_of_stock',
      message: `Sorry, ${outOfStock.map(x => `${x.dish_name} (only ${x.stock_count} left)`).join(', ')}. Please update your cart.`,
      items: outOfStock.map(x => ({ dish_id: x.dish_id, name: x.dish_name, available: x.stock_count }))
    });
  }

  const subtotal = resolved.reduce((s, it) => s + (it.price_cents || 0) * it.qty, 0);
  const currency = settings?.default_currency || 'ZAR';
  const tipC = Math.max(0, Math.min(500_00, parseInt(tip_cents) || 0));   // cap at R500 to prevent runaway typos

  // Loyalty + referral discounts. All best-effort: if the loyalty tables/columns
  // are not migrated yet the order simply proceeds with no discount.
  const REFERRAL_PCT = 10, REFERRAL_CAP_CENTS = 5000, REFERRAL_BONUS_STAMPS = 2;
  let loyaltyCfg = { enabled: false, threshold: 10, reward_value_cents: 0 };
  let loyaltyDiscount = 0, referralDiscount = 0, referrerId = null, loyaltyRewardDish = null;
  if (customer_id) {
    try {
      const { data: ls } = await supabase.from('restaurant_settings')
        .select('loyalty_threshold, loyalty_reward_cents, loyalty_opted_in, loyalty_reward_dish_id').eq('restaurant_id', restaurant.id).maybeSingle();
      loyaltyCfg = loyaltyConfig(ls);
      if (redeem_loyalty === true && loyaltyCfg.enabled) {
        // A configured reward dish takes priority over the legacy cash reward.
        let rewardDish = null;
        if (loyaltyCfg.reward_dish_id) {
          const { data: rd } = await supabase.from('dishes')
            .select('id, name, active, stock_count').eq('id', loyaltyCfg.reward_dish_id).eq('restaurant_id', restaurant.id).maybeSingle();
          if (rewardDishAvailable(rd)) rewardDish = rd;
        }
        if (rewardDish || (!loyaltyCfg.reward_dish_id && loyaltyCfg.reward_value_cents > 0)) {
          const { data: cnt } = await supabase.raw(
            'select count(*)::int as n from loyalty_stamps where customer_id = $1 and restaurant_id = $2', [customer_id, restaurant.id]);
          if ((cnt?.[0]?.n || 0) >= loyaltyCfg.threshold) {
            if (rewardDish) loyaltyRewardDish = rewardDish;
            else loyaltyDiscount = Math.min(loyaltyCfg.reward_value_cents, subtotal);
          }
        }
      }
    } catch {}
    try {
      const { data: rc } = await supabase.from('customers').select('referred_by').eq('id', customer_id).maybeSingle();
      if (rc?.referred_by && rc.referred_by !== customer_id) {
        const { data: prior } = await supabase.raw(
          'select 1 from orders where customer_id = $1 limit 1', [customer_id]);
        if (!prior?.length) {
          referrerId = rc.referred_by;
          referralDiscount = Math.min(Math.round((subtotal - loyaltyDiscount) * REFERRAL_PCT / 100), REFERRAL_CAP_CENTS);
        }
      }
    } catch {}
  }
  const totalC = Math.max(0, subtotal - loyaltyDiscount - referralDiscount) + tipC;

  const { data: order, error: oerr } = await supabase.from('orders').insert({
    restaurant_id: restaurant.id,
    table_id, table_label,
    source: 'guest',
    status: 'new',
    subtotal_cents: subtotal,
    tip_cents: tipC,
    total_cents: totalC,
    currency,
    guest_note: String(note || '').slice(0, 500) || null,
    client_order_id: client_order_id ? String(client_order_id).slice(0, 60) : null,
    customer_id,
    ...(loyaltyDiscount > 0 ? { loyalty_redeemed: true, loyalty_discount_cents: loyaltyDiscount } : {}),
    ...(loyaltyRewardDish ? { loyalty_redeemed: true } : {}),
    ...(referralDiscount > 0 ? { referral_discount_cents: referralDiscount } : {})
  }).select().single();
  if (oerr) return res.status(500).json({ error: 'Could not save order' });

  // Concurrent double-submit guard. The read-then-insert idempotency check above
  // can't stop two simultaneous requests with the same client_order_id (no unique
  // index). After inserting, the earliest row for the key wins; any later one
  // deletes itself and returns the winner, so the kitchen never sees a duplicate.
  if (client_order_id && typeof client_order_id === 'string') {
    try {
      const { data: first } = await supabase.from('orders')
        .select('id').eq('restaurant_id', restaurant.id)
        .eq('client_order_id', String(client_order_id).slice(0, 60))
        .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .limit(1).maybeSingle();
      if (first && first.id && first.id !== order.id) {
        await supabase.from('orders').delete().eq('id', order.id);
        return res.status(200).json({ ok: true, order_id: first.id, duplicate: true });
      }
    } catch {}
  }

  const rows = resolved.map(it => ({
    order_id: order.id,
    dish_id: it.dish_id,
    dish_name: it.dish_name,
    qty: it.qty,
    price_cents: it.price_cents,
    modifiers: it.modifiers || [],
    note: it.note,
    ...(it.combo_id ? { combo_id: it.combo_id } : {})
  }));
  // Loyalty free dish: a zero-price complimentary line, tagged in metadata.
  if (loyaltyRewardDish) {
    rows.push({
      order_id: order.id, dish_id: loyaltyRewardDish.id, dish_name: loyaltyRewardDish.name,
      qty: 1, price_cents: 0, modifiers: [], note: null, complimentary: true,
      metadata: { loyalty_reward: true }
    });
  }
  const itemsRes = await supabase.from('order_items').insert(rows);
  if (itemsRes.error) {
    // Roll back the parent order — otherwise the kitchen sees an empty ghost order
    console.error('order_items insert failed:', itemsRes.error);
    await supabase.from('orders').delete().eq('id', order.id);
    return res.status(500).json({ error: 'Could not save order items — please try again' });
  }

  // Loyalty: consume stamps on redemption, then award this order's stamp.
  // Referral: first order at this restaurant clears referred_by (single use)
  // and gives the referrer bonus stamps. Best-effort, never fails the order.
  if (customer_id) {
    try {
      if (loyaltyDiscount > 0 || loyaltyRewardDish) {
        await supabase.raw(
          `delete from loyalty_stamps where id in (
             select id from loyalty_stamps where customer_id = $1 and restaurant_id = $2
             order by earned_at desc limit $3)`,
          [customer_id, restaurant.id, loyaltyCfg.threshold]);
      }
      if (loyaltyCfg.enabled) {
        await supabase.from('loyalty_stamps').insert({ customer_id, restaurant_id: restaurant.id, order_id: order.id });
      }
      if (referrerId) {
        const { data: cleared } = await supabase.raw(
          'update customers set referred_by = null where id = $1 and referred_by is not null returning id', [customer_id]);
        if (cleared?.length && loyaltyCfg.enabled) {
          await supabase.from('loyalty_stamps').insert(
            Array.from({ length: REFERRAL_BONUS_STAMPS }, () => ({ customer_id: referrerId, restaurant_id: restaurant.id, order_id: order.id })));
        }
      }
    } catch (e) { console.warn('loyalty/referral bookkeeping failed:', e.message); }
  }

  // Decrement stock for tracked dishes (best-effort — but LOG when it fails so
  // we notice stock-drift rather than silently leaving stock at yesterday's number).
  // Race-safe: single conditional UPDATE that only succeeds if the CURRENT
  // stock at commit time is still >= qty. Prevents overselling when two
  // orders for the last plate hit the API simultaneously.
  for (const it of resolved) {
    if (it.stock_count != null) {
      try {
        const r = await supabase.raw(
          `update dishes
             set stock_count = stock_count - $1,
                 stock_updated_at = now()
           where id = $2
             and stock_count >= $1
           returning id`,
          [it.qty, it.dish_id]
        );
        if (!r.data || r.data.length === 0) {
          console.warn('stock decrement blocked (would go negative):', it.dish_name);
        }
      } catch (e) {
        console.warn('stock decrement failed for', it.dish_name, e.message);
      }
    }
  }

  // Fire-and-forget push to kitchen + manager
  const itemCount = resolved.reduce((s, i) => s + i.qty, 0);
  const pushBody = `${itemCount} item${itemCount === 1 ? '' : 's'}${table_label ? ' · Table ' + table_label : ''}`;
  sendPush(restaurant.id, {
    title: 'New order',
    body: pushBody,
    url: '/kitchen/',
    tag: 'order-' + order.id
  }).catch(() => {});

  return res.status(200).json({ ok: true, order_id: order.id, total_cents: totalC, loyalty_discount_cents: loyaltyDiscount, loyalty_reward_dish: loyaltyRewardDish ? loyaltyRewardDish.name : null, referral_discount_cents: referralDiscount });
}

function parsePrice(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
