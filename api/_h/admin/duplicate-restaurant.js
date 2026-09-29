// POST /api/admin/duplicate-restaurant   (MASTER ADMIN ONLY - chain onboarding)
//   { source_slug, new_slug, new_name, new_email }
// Clones the menu setup of one restaurant into a brand-new one so a chain's next
// branch does not have to be rebuilt by hand.
//   COPIED:     restaurants row, restaurant_settings, categories, dishes (slug gets a random suffix),
//               restaurant_tables, kitchen_stations, menu_slots, menu_schedules, combos, offers
//   NOT COPIED: orders, order_items, customers, staff, waiter_calls, reviews, audit_log, reservations,
//               shifts, loyalty stamps, push subscriptions, manager invites, billing subscription ids
// Model files (GLB/thumbnails) are shared by URL, so a duplicate uses no extra storage.
// Ids are generated up front so cross references (dish -> category/station/slot, combo -> dishes,
// offer -> dishes) can be remapped without RETURNING. Any failure deletes the half-built restaurant
// (every child table cascades) so a retry starts clean.
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const RESERVED_SLUGS = new Set(['admin','api','portal','staff','kitchen','www','app','m','t','r','vendor','manifest','sw','favicon','legal','faq','plans','contact','how','why','dishes','robots','sitemap','preview','index','view','test','healthcheck','health','cdn','mail','email','support','help','docs','blog','signup','signin','login','logout','account','settings','pricing','features','about','terms','privacy']);
const uuid = () => crypto.randomUUID();
const suffix = () => crypto.randomBytes(3).toString('hex').slice(0, 4);
const pick = (row, keys) => Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
const strip = (row, keys) => { const o = { ...row }; for (const k of keys) delete o[k]; return o; };

async function insertAll(table, rows) {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabaseAdmin.from(table).insert(rows.slice(i, i + 100));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function fetchAll(table, restaurantId, order) {
  let q = supabase.from(table).select('*').eq('restaurant_id', restaurantId);
  if (order) q = q.order(order);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}
// Optional tables (older databases may not have them yet) never block a duplicate.
async function fetchOptional(table, restaurantId, order) {
  try { return await fetchAll(table, restaurantId, order); } catch (e) {
    if (/does not exist|relation/i.test(String(e.message))) return [];
    throw e;
  }
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  // requireAdmin also accepts a manager portal token, which is scoped to one restaurant. Cloning is master only.
  if (getScopedRestaurantId(req) !== null) return res.status(403).json({ error: 'out_of_scope', message: 'This endpoint is master-admin only.' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  body = body || {};
  const source_slug = String(body.source_slug || '').trim().toLowerCase();
  const new_slug = String(body.new_slug || '').trim().toLowerCase();
  const new_name = String(body.new_name || '').trim().slice(0, 120);
  const new_email = String(body.new_email || '').trim().toLowerCase();
  if (!source_slug || !new_slug || !new_name || !new_email) return res.status(400).json({ error: 'source_slug, new_slug, new_name and new_email required' });
  if (new_name.length < 2) return res.status(400).json({ error: 'Name too short (min 2 chars)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) return res.status(400).json({ error: 'Invalid email address' });
  if (new_slug.length < 2 || new_slug.length > 60 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(new_slug)) {
    return res.status(400).json({ error: 'Slug can only have lowercase letters, numbers and dashes (min 2 chars)' });
  }
  if (RESERVED_SLUGS.has(new_slug)) return res.status(400).json({ error: 'That slug is reserved - pick another' });
  if (new_slug === source_slug) return res.status(400).json({ error: 'New slug must differ from the source slug' });

  const { data: src } = await supabase.from('restaurants').select('*').eq('slug', source_slug).maybeSingle();
  if (!src) return res.status(404).json({ error: 'source restaurant not found' });
  const { data: clash } = await supabase.from('restaurants').select('id').eq('slug', new_slug).maybeSingle();
  if (clash) return res.status(409).json({ error: 'That slug is already taken' });

  const newId = uuid();
  let created = false;
  try {
    // 1. restaurants row (fresh id, slug, name, email; any other columns carried over)
    const base = { ...strip(src, ['id', 'created_at', 'updated_at']), id: newId, slug: new_slug, name: new_name, email: new_email };
    let ins = await supabaseAdmin.from('restaurants').insert(base);
    if (ins.error && !/slug/i.test(String(ins.error.message))) {
      // An unexpected extra column (e.g. a per-restaurant unique token) must not block the clone.
      ins = await supabaseAdmin.from('restaurants').insert({ id: newId, slug: new_slug, name: new_name, email: new_email });
    }
    if (ins.error) {
      const dup = /duplicate|unique/i.test(String(ins.error.message));
      return res.status(dup ? 409 : 400).json({ error: dup ? 'That slug is already taken' : ins.error.message });
    }
    created = true;
    await supabaseAdmin.from('pending_signups').delete().eq('email', new_email);

    // 2. categories / kitchen stations / menu slots (dishes point at these)
    const catMap = new Map(), stationMap = new Map(), slotMap = new Map(), dishMap = new Map();
    const cats = await fetchAll('categories', src.id, 'sort_order');
    await insertAll('categories', cats.map(c => { const id = uuid(); catMap.set(c.id, id); return { id, restaurant_id: newId, ...pick(c, ['name', 'slug', 'sort_order', 'active']) }; }));
    const stations = await fetchOptional('kitchen_stations', src.id, 'sort_order');
    await insertAll('kitchen_stations', stations.map(s => { const id = uuid(); stationMap.set(s.id, id); return { id, restaurant_id: newId, ...pick(s, ['name', 'slug', 'is_expo', 'sort_order']) }; }));
    const slots = await fetchOptional('menu_slots', src.id);
    await insertAll('menu_slots', slots.map(s => { const id = uuid(); slotMap.set(s.id, id); return { id, restaurant_id: newId, ...pick(s, ['name', 'starts_time', 'ends_time', 'days_of_week', 'active']) }; }));

    // 3. dishes (slug + random suffix; category/station/slot remapped; live stock carried as configured)
    const dishes = await fetchAll('dishes', src.id, 'sort_order');
    const usedSlugs = new Set();
    await insertAll('dishes', dishes.map(d => {
      const id = uuid(); dishMap.set(d.id, id);
      let slug;
      do { slug = String(d.slug || 'dish').slice(0, 44) + '-' + suffix(); } while (usedSlugs.has(slug));
      usedSlugs.add(slug);
      const row = strip(d, ['id', 'created_at', 'updated_at', 'restaurant_id']);
      row.id = id; row.restaurant_id = newId; row.slug = slug;
      if ('category_id' in row) row.category_id = catMap.get(d.category_id) || null;
      if ('station_id' in row) row.station_id = stationMap.get(d.station_id) || null;
      if ('menu_slot_id' in row) row.menu_slot_id = slotMap.get(d.menu_slot_id) || null;
      return row;
    }));

    // 4. settings (billing links reset; the new restaurant subscribes on its own)
    const { data: st } = await supabase.from('restaurant_settings').select('*').eq('restaurant_id', src.id).maybeSingle();
    if (st) {
      const row = strip(st, ['updated_at']);
      row.restaurant_id = newId;
      if ('paddle_subscription_id' in row) row.paddle_subscription_id = null;
      if ('subscription_status' in row) row.subscription_status = 'inactive';
      if ('is_full' in row) row.is_full = false;
      if ('loyalty_reward_dish_id' in row) row.loyalty_reward_dish_id = dishMap.get(st.loyalty_reward_dish_id) || null;
      await insertAll('restaurant_settings', [row]);
    }

    // 5. tables (labels + seats only: waiter assignments and live status belong to the old floor)
    const tables = await fetchOptional('restaurant_tables', src.id);
    await insertAll('restaurant_tables', tables.map(t => ({ restaurant_id: newId, ...pick(t, ['label', 'seats']), status: 'available' })));

    // 6. combos / offers / schedules, with dish + category ids remapped. An entry whose dishes are all gone is
    //    skipped: an offer with an empty dish list would silently become a whole-menu discount.
    const combos = await fetchOptional('combos', src.id);
    const comboRows = [];
    for (const c of combos) {
      const items = (Array.isArray(c.item_ids) ? c.item_ids : []).map(i => dishMap.get(i)).filter(Boolean);
      if (!items.length) continue;
      comboRows.push({ restaurant_id: newId, ...pick(c, ['name', 'description', 'slug', 'price_cents', 'thumb_url', 'active', 'sort_order']), item_ids: items });
    }
    await insertAll('combos', comboRows);
    const offers = await fetchOptional('offers', src.id);
    const offerRows = [];
    for (const o of offers) {
      const scoped = Array.isArray(o.dish_ids) && o.dish_ids.length > 0;
      const ids = scoped ? o.dish_ids.map(i => dishMap.get(i)).filter(Boolean) : [];
      if (scoped && !ids.length) continue;
      offerRows.push({ restaurant_id: newId, ...pick(o, ['name', 'discount_pct', 'starts_at', 'ends_at', 'days_of_week', 'active']), dish_ids: ids });
    }
    await insertAll('offers', offerRows);
    const scheds = await fetchOptional('menu_schedules', src.id);
    await insertAll('menu_schedules', scheds.map(s => ({
      restaurant_id: newId, ...pick(s, ['name', 'starts_at', 'ends_at', 'days_of_week', 'active']),
      category_ids: (Array.isArray(s.category_ids) ? s.category_ids : []).map(i => catMap.get(i)).filter(Boolean)
    })));

    const copied = {
      categories: cats.length, dishes: dishes.length, tables: tables.length, kitchen_stations: stations.length,
      menu_slots: slots.length, combos: comboRows.length, offers: offerRows.length, menu_schedules: scheds.length
    };
    auditLog(req, newId, 'restaurant.duplicate', { target: new_slug, metadata: { source_slug, source_id: src.id, new_name, new_email, copied } }).catch(() => {});
    return res.status(201).json({ restaurant: { id: newId, slug: new_slug, name: new_name, email: new_email }, copied });
  } catch (e) {
    if (created) {
      // Every child table cascades from restaurants, so this removes the partial copy.
      try { await supabaseAdmin.from('restaurants').delete().eq('id', newId); } catch { /* best effort */ }
    }
    console.error('duplicate-restaurant failed:', e.message);
    return res.status(500).json({ error: 'Duplicate failed and was rolled back: ' + e.message });
  }
}
