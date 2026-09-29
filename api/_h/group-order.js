// /api/group-order — shared table cart. GUEST route (no admin auth); every call is
// scoped by invite_code and identified by the guest's customer token.
//   POST   {restaurant_slug, table_slug?, token, display_name}        start (host)
//   POST   ?code=X&join=1   {token, display_name}                     join
//   GET    ?code=X[&token=T]                                          group state
//   POST   ?code=X&item=1   {token, dish_slug, qty, modifiers?}       add item
//   DELETE ?code=X&item=<order_item_id>  {token}                      remove item
//   POST   ?code=X&place=1  {token, name, phone, email, tip_cents?, table}  host places
// Pending cart lines live in order_items with order_id NULL + group_order_id set;
// /api/order re-prices them authoritatively at place time and then deletes them.
import { randomBytes } from 'node:crypto';
import { supabase } from '../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './customer/hello.js';
import orderHandler from './order.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
const MAX_PARTICIPANTS = 30;
const MAX_LINES = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newCode() {
  const b = randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}
function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
}
function readBody(req) {
  try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}; } catch { return {}; }
}
function qparam(req, name) {
  let v = req.query ? req.query[name] : undefined;
  if (v === undefined) {
    try { v = new URL(req.url || '', 'http://x').searchParams.get(name); } catch {}
  }
  if (Array.isArray(v)) v = v[0];
  return v == null ? null : String(v);
}

// Token -> customers row (created when the first /hello hasn't landed yet).
async function customerFor(token) {
  if (!isValidToken(token)) return null;
  let row = await resolveCustomerRowByToken(token);
  if (!row) {
    await supabase.from('customers').insert({ token, last_seen_at: new Date().toISOString() });
    row = await resolveCustomerRowByToken(token);
  }
  return row || null;
}

async function loadGroup(code) {
  if (!code || !/^[A-Za-z0-9]{4,12}$/.test(code)) return null;
  const { data } = await supabase.from('group_orders').select('*').eq('invite_code', code.toUpperCase()).maybeSingle();
  return data || null;
}

async function groupState(group, viewerId) {
  const [pr, ir, rr] = await Promise.all([
    supabase.from('group_order_participants').select('customer_id, display_name, joined_at')
      .eq('group_order_id', group.id).order('joined_at', { ascending: true }),
    supabase.from('order_items').select('id, dish_id, dish_name, qty, price_cents, modifiers, note, added_by_customer_id')
      .eq('group_order_id', group.id).order('id', { ascending: true }),
    supabase.from('restaurants').select('slug').eq('id', group.restaurant_id).maybeSingle()
  ]);
  const parts = pr.data || [];
  const items = ir.data || [];
  const names = Object.fromEntries(parts.map(p => [p.customer_id, p.display_name]));
  return {
    group_id: group.id,
    invite_code: group.invite_code,
    restaurant_slug: rr.data?.slug || null,
    table_slug: group.table_slug,
    status: group.status,
    is_host: !!viewerId && viewerId === group.host_customer_id,
    participants: parts.map(p => ({
      display_name: p.display_name,
      is_host: p.customer_id === group.host_customer_id,
      is_you: !!viewerId && p.customer_id === viewerId
    })),
    items: items.map(i => ({
      id: i.id,
      dish_name: i.dish_name,
      qty: i.qty,
      price_cents: i.price_cents,
      modifiers: Array.isArray(i.modifiers) ? i.modifiers.map(m => ({ group: m.group, name: m.name })) : [],
      added_by_name: names[i.added_by_customer_id] || 'Guest',
      mine: !!viewerId && i.added_by_customer_id === viewerId
    })),
    subtotal_cents: items.reduce((s, i) => s + (i.price_cents || 0) * (i.qty || 0), 0)
  };
}

async function addParticipant(group, customer, displayName) {
  const { data: existing } = await supabase.from('group_order_participants')
    .select('id').eq('group_order_id', group.id).eq('customer_id', customer.id).maybeSingle();
  if (existing) {
    if (displayName) await supabase.from('group_order_participants').update({ display_name: displayName }).eq('id', existing.id);
    return true;
  }
  const { data: cnt } = await supabase.raw('select count(*)::int as n from group_order_participants where group_order_id = $1', [group.id]);
  if ((cnt?.[0]?.n || 0) >= MAX_PARTICIPANTS) return false;
  await supabase.from('group_order_participants')
    .insert({ group_order_id: group.id, customer_id: customer.id, display_name: displayName || 'Guest' });
  return true;
}

function parsePrice(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Authoritative unit price (base + modifier deltas) with sanitised picks.
function priceWithMods(dish, rawPicks) {
  const base = dish.price_cents ?? parsePrice(dish.price);
  const groups = Array.isArray(dish.modifiers) ? dish.modifiers : [];
  const lookup = new Map();
  groups.forEach((g, gi) => (Array.isArray(g?.options) ? g.options : []).forEach((o, oi) => {
    lookup.set(String(g.label || '') + '::' + gi + '-' + oi, {
      id: gi + '-' + oi,
      group: String(g.label || '').slice(0, 60),
      name: String(o?.name || '').slice(0, 60),
      price_cents_delta: Math.max(-50000, Math.min(50000, parseInt(o?.price_cents_delta) || 0))
    });
  }));
  const mods = [];
  for (const p of (Array.isArray(rawPicks) ? rawPicks.slice(0, 12) : [])) {
    const m = lookup.get(String(p?.group || '') + '::' + String(p?.id || ''));
    if (m) mods.push(m);
  }
  return { mods, cents: Math.max(0, (base || 0) + mods.reduce((s, m) => s + m.price_cents_delta, 0)) };
}
const modSig = (mods) => JSON.stringify((Array.isArray(mods) ? mods : []).map(m => m.group + '::' + m.id).sort());

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');
  const body = readBody(req);
  const code = qparam(req, 'code');

  try {
    // ---- Start a group order -------------------------------------------------
    if (req.method === 'POST' && !code) {
      const { restaurant_slug, table_slug, token } = body;
      if (!restaurant_slug) return res.status(400).json({ error: 'Missing restaurant_slug' });
      const cust = await customerFor(token);
      if (!cust) return res.status(400).json({ error: 'invalid_token' });
      const { data: rest } = await supabase.from('restaurants').select('id, slug').eq('slug', String(restaurant_slug)).maybeSingle();
      if (!rest) return res.status(404).json({ error: 'Restaurant not found' });
      const { data: st } = await supabase.from('restaurant_settings').select('orders_enabled').eq('restaurant_id', rest.id).maybeSingle();
      if (st && st.orders_enabled === false) return res.status(403).json({ error: 'Ordering is not enabled for this restaurant' });
      const tableSlug = table_slug ? String(table_slug).slice(0, 60) : null;
      const display_name = cleanName(body.display_name) || 'Host';

      let group = null;
      for (let attempt = 0; attempt < 5 && !group; attempt++) {
        const { data, error } = await supabase.from('group_orders').insert({
          restaurant_id: rest.id, table_slug: tableSlug, host_customer_id: cust.id,
          status: 'open', invite_code: newCode()
        }).select().single();
        if (!error && data) group = data;   // unique violation on invite_code -> retry
      }
      if (!group) return res.status(500).json({ error: 'Could not start group order' });
      await addParticipant(group, cust, display_name);
      const invite_url = `/m/${encodeURIComponent(rest.slug)}?join=${group.invite_code}` + (tableSlug ? `&t=${encodeURIComponent(tableSlug)}` : '');
      return res.status(200).json({ ok: true, group_id: group.id, invite_code: group.invite_code, invite_url });
    }

    // Everything below is scoped by invite code.
    const group = await loadGroup(code);
    if (!group) return res.status(404).json({ error: 'Group order not found' });

    // ---- State ---------------------------------------------------------------
    if (req.method === 'GET') {
      let viewerId = null;
      const t = qparam(req, 'token');
      if (t && isValidToken(t)) viewerId = (await resolveCustomerRowByToken(t))?.id || null;
      return res.status(200).json(await groupState(group, viewerId));
    }

    const cust = await customerFor(body.token);
    if (!cust) return res.status(400).json({ error: 'invalid_token' });

    // ---- Join ----------------------------------------------------------------
    if (req.method === 'POST' && qparam(req, 'join')) {
      if (group.status !== 'open') return res.status(409).json({ error: 'group_closed', message: 'This group order is no longer open.' });
      const ok = await addParticipant(group, cust, cleanName(body.display_name) || 'Guest');
      if (!ok) return res.status(409).json({ error: 'group_full', message: 'This group is full.' });
      return res.status(200).json({ ok: true, ...(await groupState(group, cust.id)) });
    }

    // Anyone acting below must be a participant.
    const { data: me } = await supabase.from('group_order_participants')
      .select('id').eq('group_order_id', group.id).eq('customer_id', cust.id).maybeSingle();
    if (!me) return res.status(403).json({ error: 'not_in_group', message: 'Join the group first.' });
    const isHost = cust.id === group.host_customer_id;

    // ---- Add item ------------------------------------------------------------
    if (req.method === 'POST' && qparam(req, 'item')) {
      if (group.status !== 'open') return res.status(409).json({ error: 'group_closed', message: 'This group order is no longer open.' });
      const slug = String(body.dish_slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Missing dish_slug' });
      const qty = Math.max(1, Math.min(99, parseInt(body.qty) || 1));
      const { data: dish } = await supabase.from('dishes')
        .select('id, name, price_cents, price, modifiers, active').eq('restaurant_id', group.restaurant_id).eq('slug', slug).maybeSingle();
      if (!dish || dish.active === false) return res.status(404).json({ error: 'Dish not found' });
      const { mods, cents } = priceWithMods(dish, body.modifiers);
      const { data: all } = await supabase.from('order_items')
        .select('id, dish_id, qty, modifiers, added_by_customer_id').eq('group_order_id', group.id);
      const lines = all || [];
      const sig = modSig(mods);
      const match = lines.find(e => e.added_by_customer_id === cust.id && e.dish_id === dish.id && modSig(e.modifiers) === sig);
      if (match) {
        await supabase.from('order_items').update({ qty: Math.min(99, (match.qty || 1) + qty) }).eq('id', match.id);
      } else {
        if (lines.length >= MAX_LINES) return res.status(409).json({ error: 'cart_full', message: 'The group cart is full.' });
        const { error } = await supabase.from('order_items').insert({
          order_id: null, group_order_id: group.id, added_by_customer_id: cust.id,
          dish_id: dish.id, dish_name: dish.name, qty, price_cents: cents, modifiers: mods
        });
        if (error) return res.status(500).json({ error: 'Could not add item' });
      }
      return res.status(200).json({ ok: true, ...(await groupState(group, cust.id)) });
    }

    // ---- Remove item ---------------------------------------------------------
    if (req.method === 'DELETE') {
      const itemId = qparam(req, 'item');
      if (!itemId || !UUID_RE.test(itemId)) return res.status(400).json({ error: 'Bad item id' });
      if (group.status !== 'open') return res.status(409).json({ error: 'group_closed' });
      const { data: it } = await supabase.from('order_items').select('id, added_by_customer_id')
        .eq('id', itemId).eq('group_order_id', group.id).maybeSingle();
      if (!it) return res.status(404).json({ error: 'Item not found' });
      if (it.added_by_customer_id !== cust.id && !isHost) return res.status(403).json({ error: 'Not your item' });
      await supabase.from('order_items').delete().eq('id', itemId).eq('group_order_id', group.id);
      return res.status(200).json({ ok: true, ...(await groupState(group, cust.id)) });
    }

    // ---- Place (host only) ---------------------------------------------------
    if (req.method === 'POST' && qparam(req, 'place')) {
      if (!isHost) return res.status(403).json({ error: 'host_only', message: 'Only the host can place the order.' });
      if (group.status === 'placed') return res.status(409).json({ error: 'already_placed', message: 'This group order was already placed.' });
      if (group.status !== 'open') return res.status(409).json({ error: 'group_closed' });
      const { data: lineRows } = await supabase.from('order_items')
        .select('dish_id, qty, modifiers, added_by_customer_id').eq('group_order_id', group.id).order('id', { ascending: true });
      const lines = lineRows || [];
      if (!lines.length) return res.status(400).json({ error: 'Group cart is empty' });
      const ids = [...new Set(lines.map(l => l.dish_id).filter(Boolean))];
      const { data: dishRows } = ids.length ? await supabase.from('dishes').select('id, slug').in('id', ids) : { data: [] };
      const slugById = Object.fromEntries((dishRows || []).map(d => [d.id, d.slug]));
      const items = lines.filter(l => slugById[l.dish_id]).map(l => ({
        dish_slug: slugById[l.dish_id], qty: l.qty, modifiers: Array.isArray(l.modifiers) ? l.modifiers : [],
        added_by: l.added_by_customer_id || null
      }));
      if (!items.length) return res.status(400).json({ error: 'No valid dishes in group cart' });

      // Save the host's contact details on their profile (never overwrite with blanks).
      const patch = {};
      const nm = cleanName(body.name), ph = String(body.phone || '').trim().slice(0, 30), em = String(body.email || '').trim().slice(0, 120);
      if (nm) patch.name = nm;
      if (ph) patch.phone = ph;
      if (em && /^[^@\s]+@[^@\s]+$/.test(em)) patch.email = em;
      if (Object.keys(patch).length) { try { await supabase.from('customers').update(patch).eq('id', cust.id); } catch {} }

      const { data: rest } = await supabase.from('restaurants').select('slug').eq('id', group.restaurant_id).maybeSingle();
      const inner = {
        r: rest?.slug, table: body.table || group.table_slug || null, items,
        tip_cents: body.tip_cents, customer_token: body.token,
        client_order_id: 'grp-' + group.id, group_order_id: group.id,
        note: body.note
      };
      let status = 200, out = null;
      const fakeRes = {
        status(n) { status = n; return this; },
        json(o) { out = o; return this; },
        end() { return this; },
        setHeader() { return this; }
      };
      await orderHandler({ method: 'POST', body: inner, headers: req.headers || {}, query: {}, url: '/api/order' }, fakeRes);
      return res.status(status).json(out || { error: 'Could not place order' });
    }

    return res.status(405).end();
  } catch (e) {
    console.error('group-order failed:', e);
    return res.status(500).json({ error: 'Group order error' });
  }
}
