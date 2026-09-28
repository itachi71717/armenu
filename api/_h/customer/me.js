// GET/PATCH/DELETE /api/customer/me
// Public, guest-facing. See docs/customer-profiles.md for the full contract,
// including the phone-merge rule under PATCH.
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken, toExternalCustomer } from './hello.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+ ]{1,20}$/;

function sanitizeList(arr) {
  if (!Array.isArray(arr)) return undefined;
  return arr
    .slice(0, 20)
    .map(v => String(v).trim().toLowerCase().slice(0, 40))
    .filter(Boolean);
}

// Returns { fields, error } — fields is the sanitized subset of body actually
// present (undefined keys are left untouched, not nulled out).
function sanitizePatch(body) {
  const fields = {};
  if (body.name !== undefined) {
    fields.name = String(body.name || '').trim().slice(0, 80) || null;
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone || '').trim().slice(0, 20);
    if (phone && !PHONE_RE.test(phone)) return { error: 'invalid_phone' };
    fields.phone = phone || null;
  }
  if (body.email !== undefined) {
    const email = String(body.email || '').trim().slice(0, 200);
    if (email && !EMAIL_RE.test(email)) return { error: 'invalid_email' };
    fields.email = email || null;
  }
  if (body.allergies !== undefined) fields.allergies = sanitizeList(body.allergies) || [];
  if (body.dietary_prefs !== undefined) fields.dietary_prefs = sanitizeList(body.dietary_prefs) || [];
  return { fields };
}

async function buildFavourites(customerId) {
  const { data: favs = [] } = await supabase.from('customer_favourites')
    .select('dish_id, restaurant_id').eq('customer_id', customerId);
  if (!favs.length) return [];

  const dishIds = [...new Set(favs.map(f => f.dish_id))];
  const restIds = [...new Set(favs.map(f => f.restaurant_id))];
  const [{ data: dishes = [] }, { data: rests = [] }] = await Promise.all([
    supabase.from('dishes').select('id, slug, name').in('id', dishIds),
    supabase.from('restaurants').select('id, slug').in('id', restIds)
  ]);
  const dishById = Object.fromEntries(dishes.map(d => [d.id, d]));
  const restById = Object.fromEntries(rests.map(r => [r.id, r]));

  return favs.map(f => ({
    dish_id: f.dish_id,
    restaurant_id: f.restaurant_id,
    restaurant_slug: restById[f.restaurant_id]?.slug || null,
    dish_slug: dishById[f.dish_id]?.slug || null,
    dish_name: dishById[f.dish_id]?.name || null
  }));
}

// Phone-merge: the row with the collided phone WINS (canonical, kept), the
// token-only row's favourites are re-pointed to it (deduped), its
// merged_into is set to the winner, and any orders.customer_id pointing at
// it are repointed. Remaining sanitized fields (minus phone, which now
// belongs to the winner) are applied to the winner.
// Recent orders across every restaurant, most recent first. Item count comes
// from a per-order subquery over order_items so we don't fetch full rows.
async function buildRecentOrders(customerId) {
  const { data: rows = [] } = await supabase.raw(
    `select o.id as order_id, o.total_cents, o.created_at as placed_at,
            r.slug as restaurant_slug, r.name as restaurant_name,
            (select coalesce(sum(oi.qty), 0) from order_items oi where oi.order_id = o.id) as item_count
       from orders o
       join restaurants r on r.id = o.restaurant_id
      where o.customer_id = $1
      order by o.created_at desc
      limit 10`,
    [customerId]
  );
  return rows.map(row => ({
    order_id: row.order_id,
    restaurant_slug: row.restaurant_slug,
    restaurant_name: row.restaurant_name,
    placed_at: row.placed_at,
    total_cents: row.total_cents,
    item_count: parseInt(row.item_count, 10) || 0
  }));
}

async function mergeInto(winner, loser, otherFields) {
  // Re-point favourites, skipping any the winner already has.
  await supabase.raw(
    `update customer_favourites set customer_id = $1
       where customer_id = $2
         and not exists (
           select 1 from customer_favourites cf2
           where cf2.customer_id = $1 and cf2.dish_id = customer_favourites.dish_id
         )`,
    [winner.id, loser.id]
  );
  // Any leftover rows are dupes of ones the winner already had — drop them.
  await supabase.from('customer_favourites').eq('customer_id', loser.id).delete();

  await supabase.from('orders').eq('customer_id', loser.id).update({ customer_id: winner.id });
  await supabase.from('customers').eq('id', loser.id).update({ merged_into: winner.id });

  const winnerFields = { ...otherFields };
  delete winnerFields.phone; // phone already belongs to the winner
  winnerFields.last_seen_at = new Date().toISOString();
  const { data: updated } = await supabase.from('customers')
    .eq('id', winner.id).update(winnerFields).select().single();
  return updated || winner;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const token = req.query?.token;
    if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
    const row = await resolveCustomerRowByToken(token);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const favourites = await buildFavourites(row.id);
    const recent_orders = await buildRecentOrders(row.id);
    return res.status(200).json({ customer: toExternalCustomer(row), favourites, recent_orders });
  }

  if (req.method === 'PATCH') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const { token } = body || {};
    if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });

    const row = await resolveCustomerRowByToken(token);
    if (!row) return res.status(400).json({ error: 'unknown_token' });

    const { fields, error } = sanitizePatch(body);
    if (error) return res.status(400).json({ error });

    if (fields.phone && fields.phone !== row.phone) {
      const { data: other } = await supabase.from('customers')
        .select('*').eq('phone', fields.phone).neq('id', row.id).is('merged_into', null).maybeSingle();
      if (other) {
        const winner = await mergeInto(other, row, fields);
        return res.status(200).json({ customer: toExternalCustomer(winner), merged: true });
      }
    }

    fields.last_seen_at = new Date().toISOString();
    const { data: updated, error: uerr } = await supabase.from('customers')
      .eq('id', row.id).update(fields).select().single();
    if (uerr) return res.status(500).json({ error: 'Could not update customer' });
    return res.status(200).json({ customer: toExternalCustomer(updated) });
  }

  if (req.method === 'DELETE') {
    const token = req.query?.token;
    if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });

    const { data: row } = await supabase.from('customers').select('id').eq('token', token).maybeSingle();
    if (!row) return res.status(200).json({ deleted: true }); // idempotent

    await supabase.from('customer_favourites').eq('customer_id', row.id).delete();
    await supabase.from('customers').eq('id', row.id).delete();
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).end();
}
