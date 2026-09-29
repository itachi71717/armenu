// Restaurant-side waitlist management.
// GET   /api/admin/waitlist?slug=<r>            -> { entries, is_full }
// PATCH /api/admin/waitlist?id=<id>&slug=<r>    { action: 'seat'|'leave' }
// POST  /api/admin/waitlist                     { slug, is_full: bool }
// Auth: master admin, manager portal token (scoped), or staff PIN token (own restaurant).
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { verifyToken as verifyStaffToken } from '../staff/login.js';
import { auditLog } from '../_audit.js';

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

export default async function handler(req, res) {
  let scopeRid = null;
  if (requireAdmin(req)) {
    scopeRid = getScopedRestaurantId(req);
  } else {
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const s = t ? verifyStaffToken(t) : null;
    if (!s) return res.status(401).json({ error: 'unauthorized' });
    scopeRid = s.restaurant_id;
  }

  const body = parseBody(req);
  const slug = req.query.slug || body.slug;

  let restId = null;
  if (slug) {
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return res.status(404).json({ error: 'not found' });
    if (scopeRid && String(r.id) !== String(scopeRid)) return res.status(403).json({ error: 'out_of_scope' });
    restId = r.id;
  } else {
    restId = scopeRid;
  }
  if (!restId) return res.status(404).json({ error: 'not found' });

  if (req.method === 'GET') {
    const [{ data: entries = [] }, { data: s }] = await Promise.all([
      supabase.from('waitlist_entries').select('*').eq('restaurant_id', restId)
        .is('seated_at', null).is('left_at', null).order('joined_at', { ascending: true }),
      supabase.from('restaurant_settings').select('is_full').eq('restaurant_id', restId).maybeSingle()
    ]);
    return res.status(200).json({ entries: entries || [], is_full: s?.is_full === true });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    const action = body.action;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (action !== 'seat' && action !== 'leave') return res.status(400).json({ error: 'action must be seat or leave' });
    const { data: entry } = await supabase.from('waitlist_entries').select('id, restaurant_id, guest_name').eq('id', id).maybeSingle();
    if (!entry || String(entry.restaurant_id) !== String(restId)) return res.status(404).json({ error: 'not found' });
    const patch = action === 'seat' ? { seated_at: new Date().toISOString() } : { left_at: new Date().toISOString() };
    await supabaseAdmin.from('waitlist_entries').update(patch).eq('id', id);
    auditLog(req, restId, 'waitlist.' + action, { target: entry.guest_name, metadata: { id } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    if (typeof body.is_full !== 'boolean') return res.status(400).json({ error: 'is_full boolean required' });
    const { data: existing } = await supabaseAdmin.from('restaurant_settings').select('restaurant_id').eq('restaurant_id', restId).maybeSingle();
    if (existing) await supabaseAdmin.from('restaurant_settings').update({ is_full: body.is_full }).eq('restaurant_id', restId);
    else await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: restId, is_full: body.is_full });
    auditLog(req, restId, 'waitlist.full_toggle', { target: slug || null, metadata: { is_full: body.is_full } }).catch(() => {});
    return res.status(200).json({ ok: true, is_full: body.is_full });
  }

  return res.status(405).end();
}
