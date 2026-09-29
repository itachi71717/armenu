// Public guest waitlist for when a restaurant is flagged full.
// POST /api/waitlist { r, guest_name, guest_phone?, party_size, notes?, customer_token? } -> { id, position }
// GET  /api/waitlist?id=<id>  -> { position, est_wait_min, status }
// GET  /api/waitlist?r=<slug> -> { is_full }
// No auth. Lookup misses return HTTP 200 with an `error` field.
import { supabase, supabaseAdmin } from '../_db.js';

const TOKEN_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_PER_PARTY = 8;

// Join throttle: a guest can't spam-join. In-memory per warm instance (same
// caveat as the dispatcher's limiter) + DB-level dedupe below, which holds
// across instances.
const JOIN_LIMIT = 3, JOIN_WINDOW_MS = 10 * 60 * 1000, MAX_ACTIVE = 200;
const joinHits = new Map();
export function _resetJoinLimiter() { joinHits.clear(); }
function joinAllowed(key, now = Date.now()) {
  if (joinHits.size > 5000) joinHits.clear();
  const arr = (joinHits.get(key) || []).filter(t => t > now - JOIN_WINDOW_MS);
  if (arr.length >= JOIN_LIMIT) { joinHits.set(key, arr); return false; }
  arr.push(now); joinHits.set(key, arr);
  return true;
}
function clientIp(req) {
  const h = req.headers || {};
  if (h['x-vercel-forwarded-for']) return String(h['x-vercel-forwarded-for']).split(',')[0].trim();
  const xf = h['x-forwarded-for'];
  if (xf) { const hops = String(xf).split(',').map(s => s.trim()).filter(Boolean); if (hops.length) return hops[hops.length - 1]; }
  return h['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function positionOf(entry) {
  const { data = [] } = await supabase.from('waitlist_entries')
    .select('id, joined_at').eq('restaurant_id', entry.restaurant_id)
    .is('seated_at', null).is('left_at', null)
    .order('joined_at', { ascending: true });
  const idx = (data || []).findIndex(e => e.id === entry.id);
  return idx < 0 ? null : idx + 1;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { id, r } = req.query || {};
      if (r && !id) {
        const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', String(r)).maybeSingle();
        if (!rest) return res.status(200).json({ is_full: false, error: 'not_found' });
        const { data: s } = await supabase.from('restaurant_settings').select('is_full').eq('restaurant_id', rest.id).maybeSingle();
        return res.status(200).json({ is_full: s?.is_full === true });
      }
      if (!id || !UUID_RE.test(String(id))) return res.status(200).json({ error: 'not_found' });
      const { data: entry } = await supabase.from('waitlist_entries').select('*').eq('id', String(id)).maybeSingle();
      if (!entry) return res.status(200).json({ error: 'not_found' });
      if (entry.seated_at) return res.status(200).json({ position: 0, est_wait_min: 0, status: 'seated' });
      if (entry.left_at) return res.status(200).json({ position: 0, est_wait_min: 0, status: 'left' });
      const position = await positionOf(entry);
      if (position === null) return res.status(200).json({ error: 'not_found' });
      return res.status(200).json({ position, est_wait_min: position * MIN_PER_PARTY, status: 'waiting' });
    }

    if (req.method === 'POST') {
      let body = {};
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
      const { r, guest_name, guest_phone, party_size, notes, customer_token } = body;
      const name = String(guest_name || '').trim().slice(0, 80);
      if (!r || !name) return res.status(200).json({ error: 'name_required' });
      const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', String(r)).maybeSingle();
      if (!rest) return res.status(200).json({ error: 'not_found' });

      let customer_id = null;
      if (typeof customer_token === 'string' && TOKEN_RE.test(customer_token)) {
        try {
          let { data: crow } = await supabase.from('customers').select('id, merged_into').eq('token', customer_token).maybeSingle();
          let hops = 0;
          while (crow?.merged_into && hops < 5) {
            const { data: next } = await supabase.from('customers').select('id, merged_into').eq('id', crow.merged_into).maybeSingle();
            if (!next) break;
            crow = next; hops++;
          }
          if (crow) customer_id = crow.id;
        } catch {}
      }

      // Already waiting (same customer or same phone)? Return that spot instead of a second one.
      const phone = guest_phone ? String(guest_phone).trim().slice(0, 30) : null;
      const { data: active = [] } = await supabase.from('waitlist_entries')
        .select('id, restaurant_id, customer_id, guest_phone, joined_at').eq('restaurant_id', rest.id)
        .is('seated_at', null).is('left_at', null);
      const dupe = (active || []).find(e => (customer_id && e.customer_id === customer_id) || (phone && e.guest_phone === phone));
      if (dupe) return res.status(200).json({ id: dupe.id, position: (await positionOf(dupe)) || 1, duplicate: true });
      if ((active || []).length >= MAX_ACTIVE) return res.status(200).json({ error: 'waitlist_full' });
      if (!joinAllowed(clientIp(req) + '|' + rest.id)) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({ error: 'rate_limited', message: 'Too many waitlist requests, try again later.' });
      }

      const size = Math.max(1, Math.min(50, parseInt(party_size) || 2));
      const { data: entry, error } = await supabaseAdmin.from('waitlist_entries').insert({
        restaurant_id: rest.id,
        customer_id,
        guest_name: name,
        guest_phone: phone,
        party_size: size,
        notes: notes ? String(notes).trim().slice(0, 300) : null
      }).select().single();
      if (error || !entry) return res.status(200).json({ error: 'could_not_join' });
      const position = (await positionOf(entry)) || 1;
      return res.status(200).json({ id: entry.id, position });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(200).json({ error: 'unavailable' });
  }
}
