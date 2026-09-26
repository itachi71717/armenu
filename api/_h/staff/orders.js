// GET   /api/staff/orders                   → list this restaurant's active orders
// POST  /api/staff/orders                   → create staff-taken order { table, items, note?, complimentary? }
// PATCH /api/staff/orders?id=<id>           → { status }
// Auth: Authorization: Bearer <staff-token>
import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyToken } from './login.js';
import { auditLog } from '../_audit.js';

const VALID = ['new','prep','ready','served','cancelled'];

function auth(req) {
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return verifyToken(tok);
}

export default async function handler(req, res) {
  const session = auth(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { data: orders = [] } = await supabase.from('orders')
      .select('*')
      .eq('restaurant_id', session.restaurant_id)
      .in('status', ['new','prep','ready'])
      .order('created_at', { ascending: true })
      .limit(100);
    if (orders.length) {
      const { data: items = [] } = await supabase.from('order_items')
        .select('*').in('order_id', orders.map(o => o.id));
      const byOrder = {};
      for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
      for (const o of orders) o.order_items = byOrder[o.id] || [];
    }
    return res.status(200).json({ orders });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const { table, items, note } = body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'no items' });

    let table_id = null, table_label = table || null;
    if (table) {
      const { data: t } = await supabase.from('restaurant_tables')
        .select('id, label').eq('restaurant_id', session.restaurant_id).eq('label', table).maybeSingle();
      if (t) { table_id = t.id; table_label = t.label; }
    }

    const slugs = items.map(i => i.dish_slug).filter(Boolean);
    const { data: dishes = [] } = await supabase.from('dishes')
      .select('id, slug, name, price, price_cents')
      .eq('restaurant_id', session.restaurant_id)
      .in('slug', slugs);
    const bySlug = Object.fromEntries(dishes.map(d => [d.slug, d]));

    const rows = [];
    let subtotal = 0;
    for (const it of items) {
      const d = bySlug[it.dish_slug];
      if (!d) continue;
      const qty = Math.max(1, Math.min(99, parseInt(it.qty || 1)));
      const price = it.complimentary ? 0 : (d.price_cents ?? parsePrice(d.price));
      rows.push({
        dish_id: d.id, dish_name: d.name, qty,
        price_cents: price,
        note: String(it.note || '').slice(0, 200) || null,
        complimentary: !!it.complimentary
      });
      subtotal += price * qty;
    }
    if (!rows.length) return res.status(400).json({ error: 'no valid dishes' });

    const { data: order } = await supabaseAdmin.from('orders').insert({
      restaurant_id: session.restaurant_id,
      table_id, table_label,
      taken_by: session.staff_id,
      source: 'staff',
      status: 'new',
      subtotal_cents: subtotal, total_cents: subtotal,
      guest_note: String(note || '').slice(0, 500) || null
    }).select().single();

    await supabaseAdmin.from('order_items').insert(rows.map(r => ({ ...r, order_id: order.id })));
    return res.status(200).json({ ok: true, order_id: order.id });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (!VALID.includes(body.status)) return res.status(400).json({ error: 'bad status' });
    // Confirm order belongs to this staff's restaurant
    const { data: order } = await supabase.from('orders').select('restaurant_id, total_cents, tip_cents, status').eq('id', id).single();
    if (!order || order.restaurant_id !== session.restaurant_id) return res.status(404).json({ error: 'not found' });
    const patch = { status: body.status, updated_at: new Date().toISOString() };
    if (body.status === 'cancelled') {
      patch.cancelled_at = new Date().toISOString();
      patch.cancel_reason = String(body.reason || '').slice(0, 500) || null;
    }
    await supabaseAdmin.from('orders').update(patch).eq('id', id);
    // Refund tracking: audit-log the amount the restaurant loses on a
    // cancellation so it shows up in analytics + master-admin audit view.
    if (body.status === 'cancelled' && order.status !== 'cancelled') {
      auditLog(req, session.restaurant_id, 'order.cancelled', {
        target: id,
        metadata: {
          total_cents: order.total_cents || 0,
          tip_cents:   order.tip_cents   || 0,
          prior_status: order.status,
          reason: patch.cancel_reason
        }
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}

function parsePrice(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
