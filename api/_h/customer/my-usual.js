// "My usual" — saved combos per guest per restaurant (max 5).
//   GET    /api/customer/my-usual?token=<>&r=<slug>
//            -> { saved: [{ id, name, items: [{ dish_name, dish_slug, price_cents, sold_out }] }] }
//   POST   /api/customer/my-usual  { token, restaurant_slug, name?, item_slugs: [] }
//            -> { ok, id }   (409 limit_reached when the guest already has 5 here)
//   DELETE /api/customer/my-usual?token=<>&id=<uuid>
//            -> { ok }
// Public, guest-facing; identified by the customer token (merge chain resolved).
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

export const MAX_SAVED_COMBOS = 5;
const MAX_ITEMS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dishPrice(d) {
  if (d.price_cents != null) return d.price_cents;
  const n = parseFloat(String(d.price || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  }
  const token = String(req.method === 'POST' ? (body.token || '') : (req.query?.token || ''));
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
  const cust = await resolveCustomerRowByToken(token);
  if (!cust) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'DELETE') {
    const id = String(req.query?.id || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { data: row } = await supabase.from('customer_saved_combos').select('id').eq('id', id).eq('customer_id', cust.id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not_found' });
    await supabase.from('customer_saved_combos').delete().eq('id', id).eq('customer_id', cust.id);
    return res.status(200).json({ ok: true });
  }

  const slug = String((req.method === 'POST' ? body.restaurant_slug : req.query?.r) || '').slice(0, 80);
  if (!slug) return res.status(400).json({ error: 'Missing restaurant' });
  const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'restaurant_not_found' });

  if (req.method === 'GET') {
    const { data: rows = [] } = await supabase.from('customer_saved_combos')
      .select('id, name, item_slugs, created_at').eq('customer_id', cust.id).eq('restaurant_id', rest.id)
      .order('created_at', { ascending: true });
    const allSlugs = [...new Set((rows || []).flatMap(x => Array.isArray(x.item_slugs) ? x.item_slugs : []))];
    let bySlug = {};
    if (allSlugs.length) {
      const { data: ds = [] } = await supabase.from('dishes')
        .select('slug, name, price_cents, price, stock_count, active').eq('restaurant_id', rest.id).in('slug', allSlugs);
      bySlug = Object.fromEntries((ds || []).map(d => [d.slug, d]));
    }
    const saved = (rows || []).map(x => ({
      id: x.id,
      name: x.name || 'My usual',
      items: (Array.isArray(x.item_slugs) ? x.item_slugs : []).map(s => {
        const d = bySlug[s];
        if (!d) return null;
        return {
          dish_name: d.name, dish_slug: d.slug, price_cents: dishPrice(d),
          sold_out: d.active === false || (typeof d.stock_count === 'number' && d.stock_count <= 0)
        };
      }).filter(Boolean)
    })).filter(x => x.items.length);
    return res.status(200).json({ saved });
  }

  // POST
  const rawSlugs = Array.isArray(body.item_slugs) ? body.item_slugs : [];
  const wanted = rawSlugs.map(s => String(s || '').trim().slice(0, 120)).filter(Boolean).slice(0, MAX_ITEMS);
  if (!wanted.length) return res.status(400).json({ error: 'No items to save' });
  const { data: ds = [] } = await supabase.from('dishes')
    .select('slug').eq('restaurant_id', rest.id).in('slug', [...new Set(wanted)]);
  const valid = new Set((ds || []).map(d => d.slug));
  const item_slugs = wanted.filter(s => valid.has(s));
  if (!item_slugs.length) return res.status(400).json({ error: 'No valid dishes to save' });

  const { data: cnt } = await supabase.raw(
    'select count(*)::int as n from customer_saved_combos where customer_id = $1 and restaurant_id = $2', [cust.id, rest.id]);
  if ((cnt?.[0]?.n || 0) >= MAX_SAVED_COMBOS) {
    return res.status(409).json({ error: 'limit_reached', message: `You can save up to ${MAX_SAVED_COMBOS} usuals here. Delete one first.` });
  }
  const name = String(body.name || '').trim().slice(0, 40) || 'My usual';
  const notes = body.notes ? String(body.notes).slice(0, 300) : null;
  const { data: ins, error } = await supabase.from('customer_saved_combos')
    .insert({ customer_id: cust.id, restaurant_id: rest.id, name, item_slugs, notes }).select('id').single();
  if (error) return res.status(500).json({ error: 'Could not save' });
  return res.status(200).json({ ok: true, id: ins?.id });
}
