// GET   /api/staff/orders                   → list this restaurant's active orders
// POST  /api/staff/orders                   → create staff-taken order { table, items, note?, complimentary? }
// PATCH /api/staff/orders?id=<id>           → { status }
//                                            → { assignments: [{item_id, paid_by}], mark_paid? } — split-bill v2
// Auth: Authorization: Bearer <staff-token>
import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyToken } from './login.js';
import { auditLog } from '../_audit.js';

const VALID = ['new','prep','ready','served','cancelled'];
const PAID_BY_MAX = 40;

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
    // Recent served orders (last 2h, max 10) so staff can recall them. Kept out of
    // the main query so old served rows never crowd out active orders under limit(100).
    try {
      const { data: served = [] } = await supabase.from('orders')
        .select('*')
        .eq('restaurant_id', session.restaurant_id)
        .eq('status', 'served')
        .gte('updated_at', new Date(Date.now() - 2 * 3600 * 1000).toISOString())
        .order('updated_at', { ascending: false })
        .limit(10);
      for (const o of served) orders.push(o);
    } catch { /* recall list is best-effort */ }
    let result = orders;
    if (orders.length) {
      const { data: items = [] } = await supabase.from('order_items')
        .select('*').in('order_id', orders.map(o => o.id));
      const byOrder = {};
      for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
      for (const o of orders) o.order_items = byOrder[o.id] || [];

      // Station filtering: a station-bound (non-expo) token only sees orders
      // containing at least one of its dishes; all items are still returned,
      // with this station's flagged mine:true.
      if (session.station_id && !session.is_expo) {
        const dishIds = [...new Set(items.map(i => i.dish_id).filter(Boolean))];
        let mineDishes = new Set();
        if (dishIds.length) {
          const { data: ds = [] } = await supabase.from('dishes')
            .select('id, station_id').in('id', dishIds);
          mineDishes = new Set(ds.filter(d => d.station_id === session.station_id).map(d => d.id));
        }
        result = filterOrdersForStation(orders, mineDishes);
      }
    }

    // Rush detection: >=5 orders in the last 5 minutes for this restaurant.
    try {
      const { data: cnt } = await supabase.raw(
        "select count(*)::int as n from orders where restaurant_id = $1 and created_at > now() - interval '5 minutes'",
        [session.restaurant_id]);
      const rush = (cnt?.[0]?.n || 0) >= 5;
      const toFlip = result.filter(o => o.status !== 'served' && !!o.rush !== rush).map(o => o.id);
      if (toFlip.length) Promise.resolve(supabaseAdmin.from('orders').update({ rush }).in('id', toFlip)).catch(() => {});
      for (const o of result) if (o.status !== 'served') o.rush = rush;
    } catch { /* rush is best-effort */ }
    return res.status(200).json({ orders: result });
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

    const { data: order, error: orderErr } = await supabaseAdmin.from('orders').insert({
      restaurant_id: session.restaurant_id,
      table_id, table_label,
      taken_by: session.staff_id,
      source: 'staff',
      status: 'new',
      subtotal_cents: subtotal, total_cents: subtotal,
      guest_note: String(note || '').slice(0, 500) || null
    }).select().single();
    if (orderErr || !order) return res.status(500).json({ error: 'Could not save order' });

    const itemsRes = await supabaseAdmin.from('order_items').insert(rows.map(r => ({ ...r, order_id: order.id })));
    if (itemsRes.error) {
      // Roll back the parent order — otherwise the kitchen sees an empty ghost order.
      console.error('staff order_items insert failed:', itemsRes.error);
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      return res.status(500).json({ error: 'Could not save order items — please try again' });
    }
    return res.status(200).json({ ok: true, order_id: order.id });
  }

  if (req.method === 'PATCH') {
    let rb = {};
    try { rb = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if ((rb && rb.recall != null && rb.recall !== false) || req.query.recall != null) return handleRecall(req, res, session, rb || {});
  }

  if (req.method === 'PATCH' && req.query.item) {
    const itemId = String(req.query.item);
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const plated = req.query.plated != null ? req.query.plated : body?.plated;
    const wantPlated = plated === '1' || plated === 1 || plated === true || plated === 'true';
    // Confirm the item's order belongs to this staff's restaurant.
    const { data: item } = await supabase.from('order_items')
      .select('id, order_id').eq('id', itemId).maybeSingle();
    if (!item) return res.status(404).json({ error: 'not found' });
    const { data: order } = await supabase.from('orders')
      .select('id, restaurant_id').eq('id', item.order_id).maybeSingle();
    if (!order || order.restaurant_id !== session.restaurant_id) return res.status(404).json({ error: 'not found' });
    await supabaseAdmin.from('order_items').update({ plated_at: wantPlated ? new Date().toISOString() : null }).eq('id', itemId);
    auditLog(req, session.restaurant_id, wantPlated ? 'order_item.plated' : 'order_item.unplated', {
      target: itemId,
      metadata: { order_id: order.id }
    }).catch(() => {});
    return res.status(200).json({ ok: true, item_id: itemId, plated: wantPlated });
  }

  if (req.method === 'PATCH' && req.query.id) {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (Array.isArray(body?.assignments) || typeof body?.mark_paid === 'string') {
      return handleSplitPatch(req, res, session, body);
    }
    const { id } = req.query;
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

// Split-bill v2: per-item payer assignment + partial payment tracking.
// Body: { assignments?: [{ item_id, paid_by }], mark_paid?: label }
// - assignments: sets/clears order_items.paid_by for items on this order.
// - mark_paid: for every item on this order currently assigned to that
//   label (after assignments are applied) and not yet paid, stamps
//   paid_at=now() and bumps orders.paid_cents by their subtotal.
async function handleSplitPatch(req, res, session, body) {
  const { id: orderId } = req.query;
  const { data: order } = await supabase.from('orders')
    .select('id, restaurant_id, total_cents, paid_cents').eq('id', orderId).maybeSingle();
  if (!order || order.restaurant_id !== session.restaurant_id) return res.status(404).json({ error: 'not found' });

  const { data: items = [] } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  const itemIds = new Set(items.map(i => i.id));

  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  for (const a of assignments) {
    if (!a || !itemIds.has(a.item_id)) return res.status(400).json({ error: 'assignment references an item outside this order' });
    if (typeof a.paid_by !== 'string' && a.paid_by !== null) return res.status(400).json({ error: 'paid_by must be a string or null' });
    if (typeof a.paid_by === 'string' && a.paid_by.length > PAID_BY_MAX) return res.status(400).json({ error: `paid_by must be ${PAID_BY_MAX} characters or fewer` });
  }
  for (const a of assignments) {
    const paid_by = a.paid_by === null ? null : String(a.paid_by).slice(0, PAID_BY_MAX) || null;
    await supabaseAdmin.from('order_items').update({ paid_by }).eq('id', a.item_id);
    const local = items.find(i => i.id === a.item_id);
    if (local) local.paid_by = paid_by; // keep the in-memory copy in sync for mark_paid below
  }

  let bumped = 0;
  if (typeof body.mark_paid === 'string' && body.mark_paid) {
    const label = body.mark_paid.slice(0, PAID_BY_MAX);
    const toMark = items.filter(i => i.paid_by === label && !i.paid_at);
    if (toMark.length) {
      const now = new Date().toISOString();
      await supabaseAdmin.from('order_items').update({ paid_at: now }).in('id', toMark.map(i => i.id));
      bumped = toMark.reduce((s, i) => s + (i.price_cents || 0) * (i.qty || 1), 0);
      await supabaseAdmin.from('orders').update({ paid_cents: (order.paid_cents || 0) + bumped }).eq('id', orderId);
      auditLog(req, session.restaurant_id, 'order.split_payment', {
        target: orderId,
        metadata: { paid_by: label, amount_cents: bumped, item_ids: toMark.map(i => i.id) }
      }).catch(() => {});
    }
  }

  return res.status(200).json({
    ok: true,
    order_id: orderId,
    paid_cents: (order.paid_cents || 0) + bumped,
    total_cents: order.total_cents || 0
  });
}

// Pure helper: keep orders with >=1 item in `mineDishes`; flag those items mine:true.
export function filterOrdersForStation(orders, mineDishes) {
  const out = [];
  for (const o of orders) {
    let any = false;
    o.order_items = (o.order_items || []).map(it => {
      const mine = mineDishes.has(it.dish_id);
      if (mine) any = true;
      return { ...it, mine };
    });
    if (any) out.push(o);
  }
  return out;
}

// Recall: PATCH ?id=<order_item_id>[&recall=<reason>] with body { recall: <reason string> | { reason? }, id? }
async function handleRecall(req, res, session, body) {
  const itemId = String(body.id || req.query.item || req.query.id || '');
  if (!itemId) return res.status(400).json({ error: 'item id required' });
  const { data: item } = await supabase.from('order_items')
    .select('id, order_id').eq('id', itemId).maybeSingle();
  if (!item) return res.status(404).json({ error: 'not found' });
  const { data: order } = await supabase.from('orders')
    .select('id, restaurant_id, status').eq('id', item.order_id).maybeSingle();
  if (!order || order.restaurant_id !== session.restaurant_id) return res.status(404).json({ error: 'not found' });
  const rc = body.recall;
  const rawReason = (rc && typeof rc === 'object') ? rc.reason : (typeof rc === 'string' ? rc : req.query.recall);
  const reason = String(rawReason == null || rawReason === true || rawReason === '1' ? '' : rawReason).slice(0, 500) || null;
  // Un-plate so the kitchen sees it as outstanding again.
  await supabaseAdmin.from('order_items').update({ recalled_at: new Date().toISOString(), recall_reason: reason, plated_at: null }).eq('id', itemId);
  // Put a ready/served order back on the kitchen board.
  if (order.status === 'ready' || order.status === 'served') {
    await supabaseAdmin.from('orders').update({ status: 'prep', updated_at: new Date().toISOString() }).eq('id', order.id);
  }
  auditLog(req, session.restaurant_id, 'order_item.recall', {
    target: itemId, metadata: { order_id: order.id, reason }
  }).catch(() => {});
  return res.status(200).json({ ok: true, item_id: itemId, recalled: true });
}

function parsePrice(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
