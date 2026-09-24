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
    .select('id, slug, name, price_cents, price')
    .eq('restaurant_id', restaurant.id)
    .in('slug', slugs);

  const bySlug = Object.fromEntries(dishes.map(d => [d.slug, d]));
  const resolved = items.map(i => {
    const d = bySlug[String(i.dish_slug || '').trim()];
    if (!d) return null;
    const qty = Math.max(1, Math.min(99, parseInt(i.qty || 1)));
    return {
      dish_id: d.id,
      dish_name: d.name,
      qty,
      price_cents: d.price_cents ?? parsePrice(d.price),
      note: String(i.note || '').slice(0, 200) || null
    };
  }).filter(Boolean);

  if (!resolved.length) return res.status(400).json({ error: 'No valid dishes in cart' });

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

  const rows = resolved.map(it => ({ order_id: order.id, ...it }));
  await supabase.from('order_items').insert(rows);

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
