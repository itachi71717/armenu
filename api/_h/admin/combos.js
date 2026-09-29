// Menu combos (bundle N dishes at a set price) + opening-hours save.
// GET ?slug=r · POST {slug,name,description,item_ids,price_cents,thumb_url}
// PATCH ?id=&slug=r · DELETE ?id=&slug=r
// POST ?action=hours body {slug, opening_hours} — saves restaurant_settings.opening_hours
// (kept here because admin/settings.js has a strict MANAGER_ALLOWED whitelist).
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseBody(req) {
  try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}; } catch { return {}; }
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'combo';
}
// Returns { ids } or { error }. Every id must be a dish of THIS restaurant.
async function validateItems(restaurantId, raw) {
  if (!Array.isArray(raw)) return { error: 'item_ids must be an array' };
  const ids = raw.map(String).filter(Boolean);
  if (ids.length < 2) return { error: 'A combo needs at least 2 dishes' };
  if (ids.length > 20) return { error: 'A combo can have at most 20 dishes' };
  const unique = [...new Set(ids)];
  const { data, error } = await supabase.from('dishes').select('id').eq('restaurant_id', restaurantId).in('id', unique);
  if (error) return { error: 'Could not validate dishes' };
  const found = new Set((data || []).map(d => d.id));
  if (unique.some(id => !found.has(id))) return { error: 'One or more dishes do not belong to this restaurant' };
  return { ids };
}
function cleanPrice(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) return null;
  return n;
}
export function sanitizeHours(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of DAY_KEYS) {
    const slots = raw[k];
    if (slots === undefined) continue;
    if (!Array.isArray(slots) || slots.length > 4) return null;
    const clean = [];
    for (const s of slots) {
      if (!Array.isArray(s) || s.length !== 2 || !TIME_RE.test(String(s[0])) || !TIME_RE.test(String(s[1]))) return null;
      if (s[0] === s[1]) return null;
      clean.push([String(s[0]), String(s[1])]);
    }
    out[k] = clean;
  }
  return out;
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : parseBody(req);
  const slug = req.query?.slug || body.slug;

  // Resolve restaurant for slug-addressed calls.
  async function resolveRestaurant() {
    if (!slug) return { fail: [400, 'slug required'] };
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return { fail: [404, 'not found'] };
    const guard = assertScope(req, r.id);
    if (guard) return { fail: [guard.status, guard.error] };
    return { r };
  }

  if (req.method === 'GET') {
    const { r, fail } = await resolveRestaurant();
    if (fail) return res.status(fail[0]).json({ error: fail[1] });
    const { data } = await supabase.from('combos').select('*').eq('restaurant_id', r.id).order('sort_order').order('created_at');
    return res.status(200).json({ combos: data || [] });
  }

  if (req.method === 'POST') {
    const { r, fail } = await resolveRestaurant();
    if (fail) return res.status(fail[0]).json({ error: fail[1] });

    if (req.query?.action === 'hours') {
      const hours = sanitizeHours(body.opening_hours);
      if (!hours) return res.status(400).json({ error: 'opening_hours must be {mon:[["09:00","22:00"]], ...} with HH:MM times' });
      const patch = { opening_hours: hours, updated_at: new Date().toISOString() };
      const { data: existing } = await supabaseAdmin.from('restaurant_settings').select('restaurant_id').eq('restaurant_id', r.id).maybeSingle();
      const w = existing
        ? await supabaseAdmin.from('restaurant_settings').update(patch).eq('restaurant_id', r.id)
        : await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: r.id, ...patch });
      if (w.error) return res.status(500).json({ error: 'Could not save opening hours' });
      auditLog(req, r.id, 'settings.opening_hours', { metadata: { days: Object.keys(hours) } }).catch(() => {});
      return res.status(200).json({ ok: true, opening_hours: hours });
    }

    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'name required' });
    const price = cleanPrice(body.price_cents);
    if (price == null) return res.status(400).json({ error: 'price_cents must be a non-negative integer' });
    const v = await validateItems(r.id, body.item_ids);
    if (v.error) return res.status(400).json({ error: v.error });

    // Unique slug per restaurant
    const base = slugify(name);
    const { data: taken } = await supabase.from('combos').select('slug').eq('restaurant_id', r.id);
    const used = new Set((taken || []).map(x => x.slug));
    let cslug = base, n = 2;
    while (used.has(cslug)) cslug = `${base}-${n++}`;

    const { data, error } = await supabaseAdmin.from('combos').insert({
      restaurant_id: r.id,
      name,
      description: body.description ? String(body.description).slice(0, 500) : null,
      slug: cslug,
      item_ids: v.ids,
      price_cents: price,
      thumb_url: body.thumb_url ? String(body.thumb_url).slice(0, 500) : null
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'combo.create', { target: data?.name, metadata: { price_cents: price, items: v.ids.length } }).catch(() => {});
    return res.status(200).json({ combo: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabase.from('combos').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    const patch = {};
    if ('name' in body) {
      const nm = String(body.name || '').trim().slice(0, 120);
      if (!nm) return res.status(400).json({ error: 'name required' });
      patch.name = nm;
    }
    if ('description' in body) patch.description = body.description ? String(body.description).slice(0, 500) : null;
    if ('thumb_url' in body) patch.thumb_url = body.thumb_url ? String(body.thumb_url).slice(0, 500) : null;
    if ('active' in body) patch.active = body.active !== false;
    if ('sort_order' in body) patch.sort_order = parseInt(body.sort_order, 10) || 0;
    if ('price_cents' in body) {
      const p = cleanPrice(body.price_cents);
      if (p == null) return res.status(400).json({ error: 'price_cents must be a non-negative integer' });
      patch.price_cents = p;
    }
    if ('item_ids' in body) {
      const v = await validateItems(row.restaurant_id, body.item_ids);
      if (v.error) return res.status(400).json({ error: v.error });
      patch.item_ids = v.ids;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const { error } = await supabaseAdmin.from('combos').update(patch).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, row.restaurant_id, 'combo.update', { target: patch.name || row.name || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabase.from('combos').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await supabaseAdmin.from('combos').delete().eq('id', id);
    auditLog(req, row.restaurant_id, 'combo.delete', { target: row.name || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
