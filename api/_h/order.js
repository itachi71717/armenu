// POST /api/order
// Body: { r: slug, table: label|null, items: [{dish_slug, qty, note}], note? }
// Public — gated by restaurant_settings.orders_enabled.

import { supabase } from '../_db.js';
import { sendPush } from './push/_send.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { r, table, items, note } = body || {};
  if (!r) return res.status(400).json({ error: 'Missing r' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items' });

  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', r).single();
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  const { data: settings } = await supabase.from('restaurant_settings')
    .select('orders_enabled, default_currency').eq('restaurant_id', restaurant.id).maybeSingle();
  if (!settings?.orders_enabled) return res.status(403).json({ error: 'Ordering is not enabled for this restaurant' });

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
    .select('id, slug, name, price_cents, price, stock_count')
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
    const finalCents = pct ? Math.round((baseCents || 0) * (100 - pct) / 100) : baseCents;
    return {
      dish_id: d.id,
      dish_name: d.name,
      qty,
      stock_count: d.stock_count,
      price_cents: finalCents,
      note: String(i.note || '').slice(0, 200) || null
    };
  }).filter(Boolean);

  if (!resolved.length) return res.status(400).json({ error: 'No valid dishes in cart' });

  // Stock check — reject if any tracked item can't be fulfilled
  const outOfStock = resolved.filter(x => x.stock_count != null && x.stock_count < x.qty);
  if (outOfStock.length) {
    return res.status(409).json({
      error: 'out_of_stock',
      message: `Sorry, ${outOfStock.map(x => `${x.dish_name} (only ${x.stock_count} left)`).join(', ')}. Please update your cart.`,
      items: outOfStock.map(x => ({ dish_id: x.dish_id, name: x.dish_name, available: x.stock_count }))
    });
  }

  const subtotal = resolved.reduce((s, it) => s + (it.price_cents || 0) * it.qty, 0);
  const currency = settings.default_currency || 'ZAR';

  const { data: order, error: oerr } = await supabase.from('orders').insert({
    restaurant_id: restaurant.id,
    table_id, table_label,
    source: 'guest',
    status: 'new',
    subtotal_cents: subtotal,
    total_cents: subtotal,
    currency,
    guest_note: String(note || '').slice(0, 500) || null
  }).select().single();
  if (oerr) return res.status(500).json({ error: 'Could not save order' });

  const rows = resolved.map(it => ({
    order_id: order.id,
    dish_id: it.dish_id,
    dish_name: it.dish_name,
    qty: it.qty,
    price_cents: it.price_cents,
    note: it.note
  }));
  await supabase.from('order_items').insert(rows);

  // Decrement stock for tracked dishes (fire-and-forget — best-effort)
  for (const it of resolved) {
    if (it.stock_count != null) {
      const next = Math.max(0, it.stock_count - it.qty);
      supabase.from('dishes').update({ stock_count: next, stock_updated_at: new Date().toISOString() }).eq('id', it.dish_id).catch(() => {});
    }
  }

  // Fire-and-forget push to kitchen + manager
  const itemCount = resolved.reduce((s, i) => s + i.qty, 0);
  const body = `${itemCount} item${itemCount === 1 ? '' : 's'}${table_label ? ' · Table ' + table_label : ''}`;
  sendPush(restaurant.id, {
    title: 'New order',
    body,
    url: '/kitchen/',
    tag: 'order-' + order.id
  }).catch(() => {});

  return res.status(200).json({ ok: true, order_id: order.id });
}

function parsePrice(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
