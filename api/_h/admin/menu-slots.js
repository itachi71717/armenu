// Time-of-day menu slots (Breakfast / Lunch / Dinner rotation).
// GET    ?slug=r                    -> { slots, dish_slots:{dish_id:slot_id}, open_now:[slot_id], timezone }
// POST   ?slug=r  { name, starts_time, ends_time, days_of_week?, active? }   create
// POST   ?slug=r  { action:'assign', dish_slug|dish_id, menu_slot_id|null }  set a dish's "Available during"
// PATCH  ?id      { name?, starts_time?, ends_time?, days_of_week?, active? }
// DELETE ?id                        (dishes on the slot fall back to always-visible)
// Times are local wall-clock HH:MM; end <= start spans midnight. days_of_week: 0=Sun..6=Sat.
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';
import { isSlotOpen, localDayMinutes } from '../dish.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = t => String(t == null ? '' : t).slice(0, 5);
const shape = s => ({ id: s.id, name: s.name, starts_time: hhmm(s.starts_time), ends_time: hhmm(s.ends_time), days_of_week: Array.isArray(s.days_of_week) ? s.days_of_week : [0, 1, 2, 3, 4, 5, 6], active: s.active !== false });

function readBody(req) {
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return null; }
  return body && typeof body === 'object' ? body : {};
}
function cleanDays(v) {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b);
  return out.length ? out : null;
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return res.status(404).json({ error: 'not found' });
    const g = assertScope(req, r.id);
    if (g) return res.status(g.status).json({ error: g.error });
    const [sq, dq, st] = await Promise.all([
      supabase.from('menu_slots').select('id, name, starts_time, ends_time, days_of_week, active, created_at').eq('restaurant_id', r.id).order('starts_time'),
      supabase.from('dishes').select('id, menu_slot_id').eq('restaurant_id', r.id),
      supabase.from('restaurant_settings').select('timezone').eq('restaurant_id', r.id).maybeSingle()
    ]);
    if (sq.error) return res.status(200).json({ slots: [], dish_slots: {}, open_now: [], migrated: false });
    const slots = sq.data || [];
    const dish_slots = {};
    for (const d of (dq.data || [])) if (d.menu_slot_id) dish_slots[d.id] = d.menu_slot_id;
    const timezone = st?.data?.timezone || null;
    const { wd, mins } = localDayMinutes(timezone);
    return res.status(200).json({
      slots: slots.map(shape), dish_slots,
      open_now: slots.filter(s => s.active !== false && isSlotOpen(s, wd, mins)).map(s => s.id),
      timezone
    });
  }

  if (req.method === 'POST') {
    const body = readBody(req);
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });
    const slug = req.query.slug || body.slug;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return res.status(404).json({ error: 'not found' });
    const g = assertScope(req, r.id);
    if (g) return res.status(g.status).json({ error: g.error });

    if (body.action === 'assign') {
      // Set (or clear) which slot a dish belongs to. Lives here so the dish PATCH route stays untouched.
      let dish = null;
      if (body.dish_id) ({ data: dish } = await supabase.from('dishes').select('id, slug, restaurant_id').eq('id', body.dish_id).maybeSingle());
      else if (body.dish_slug) ({ data: dish } = await supabase.from('dishes').select('id, slug, restaurant_id').eq('restaurant_id', r.id).eq('slug', body.dish_slug).maybeSingle());
      if (!dish || String(dish.restaurant_id) !== String(r.id)) return res.status(404).json({ error: 'dish not found' });
      let slotId = null;
      if (body.menu_slot_id) {
        const { data: sl } = await supabase.from('menu_slots').select('id, restaurant_id, name').eq('id', body.menu_slot_id).maybeSingle();
        if (!sl || String(sl.restaurant_id) !== String(r.id)) return res.status(400).json({ error: 'invalid menu_slot_id' });
        slotId = sl.id;
      }
      const { error } = await supabaseAdmin.from('dishes').update({ menu_slot_id: slotId }).eq('id', dish.id);
      if (error) return res.status(400).json({ error: error.message });
      auditLog(req, r.id, 'menu_slot.assign', { target: dish.slug, metadata: { menu_slot_id: slotId } }).catch(() => {});
      return res.status(200).json({ ok: true, menu_slot_id: slotId });
    }

    const name = String(body.name || '').trim().slice(0, 60);
    const starts_time = String(body.starts_time || '').trim();
    const ends_time = String(body.ends_time || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!TIME_RE.test(starts_time) || !TIME_RE.test(ends_time)) return res.status(400).json({ error: 'starts_time and ends_time must be HH:MM (24h)' });
    if (starts_time === ends_time) return res.status(400).json({ error: 'Start and end time must differ' });
    const days = body.days_of_week === undefined ? [0, 1, 2, 3, 4, 5, 6] : cleanDays(body.days_of_week);
    if (!days) return res.status(400).json({ error: 'Pick at least one day (0=Sun..6=Sat)' });
    const { data, error } = await supabaseAdmin.from('menu_slots').insert({
      restaurant_id: r.id, name, starts_time, ends_time, days_of_week: days, active: body.active === false ? false : true
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'menu_slot.create', { target: name, metadata: { starts_time, ends_time, days_of_week: days } }).catch(() => {});
    return res.status(201).json({ slot: shape(data) });
  }

  if (req.method === 'PATCH' || req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabase.from('menu_slots').select('id, restaurant_id, name, starts_time, ends_time').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const g = assertScope(req, row.restaurant_id);
    if (g) return res.status(g.status).json({ error: g.error });

    if (req.method === 'DELETE') {
      const { error } = await supabaseAdmin.from('menu_slots').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      auditLog(req, row.restaurant_id, 'menu_slot.delete', { target: row.name || id }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    const body = readBody(req);
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });
    const patch = {};
    if ('name' in body) {
      const n = String(body.name || '').trim().slice(0, 60);
      if (!n) return res.status(400).json({ error: 'name required' });
      patch.name = n;
    }
    for (const k of ['starts_time', 'ends_time']) {
      if (k in body) {
        const t = String(body[k] || '').trim();
        if (!TIME_RE.test(t)) return res.status(400).json({ error: k + ' must be HH:MM (24h)' });
        patch[k] = t;
      }
    }
    if (('starts_time' in patch || 'ends_time' in patch) && (patch.starts_time || hhmm(row.starts_time)) === (patch.ends_time || hhmm(row.ends_time))) {
      return res.status(400).json({ error: 'Start and end time must differ' });
    }
    if ('days_of_week' in body) {
      const d = cleanDays(body.days_of_week);
      if (!d) return res.status(400).json({ error: 'Pick at least one day (0=Sun..6=Sat)' });
      patch.days_of_week = d;
    }
    if ('active' in body) patch.active = !!body.active;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const { error } = await supabaseAdmin.from('menu_slots').update(patch).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, row.restaurant_id, 'menu_slot.update', { target: row.name || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
