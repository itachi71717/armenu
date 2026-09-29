// Staff shifts: GET ?slug=&from=&to= | POST {slug,staff_id,role,starts_at,ends_at,notes}
//               PATCH ?id=&slug= | DELETE ?id=&slug=
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

function parseBody(req) {
  try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}; } catch { return {}; }
}
const validIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).end();
  const body = req.method === 'POST' || req.method === 'PATCH' ? parseBody(req) : {};
  const slug = req.query?.slug || body.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  if (req.method === 'GET') {
    let from = validIso(req.query?.from);
    let to = validIso(req.query?.to);
    if (!from) from = new Date(Date.now() - 7 * 864e5).toISOString();
    if (!to) to = new Date(new Date(from).getTime() + 14 * 864e5).toISOString();
    const { data, error } = await supabase.raw(
      `select s.id, s.staff_id, s.role, s.starts_at, s.ends_at, s.notes,
              st.name as staff_name, st.role as staff_role
         from shifts s left join staff st on st.id = s.staff_id
        where s.restaurant_id = $1 and s.starts_at >= $2 and s.starts_at < $3
        order by s.starts_at`, [r.id, from, to]);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ shifts: data || [] });
  }

  if (req.method === 'POST') {
    const starts_at = validIso(body.starts_at);
    const ends_at = validIso(body.ends_at);
    if (!body.staff_id) return res.status(400).json({ error: 'staff_id required' });
    if (!starts_at || !ends_at || new Date(ends_at) <= new Date(starts_at)) {
      return res.status(400).json({ error: 'valid starts_at / ends_at required' });
    }
    const { data: st } = await supabase.from('staff').select('id, restaurant_id, name').eq('id', body.staff_id).maybeSingle();
    if (!st || String(st.restaurant_id) !== String(r.id)) return res.status(404).json({ error: 'staff not found' });
    const { data, error } = await supabaseAdmin.from('shifts').insert({
      restaurant_id: r.id, staff_id: st.id,
      role: body.role ? String(body.role).trim().slice(0, 60) : null,
      starts_at, ends_at,
      notes: body.notes ? String(body.notes).trim().slice(0, 300) : null,
      created_by: req.headers?.['x-portal-token'] ? 'portal' : 'admin'
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'shift.create', { target: st.name || st.id, metadata: { starts_at, ends_at } }).catch(() => {});
    return res.status(200).json({ shift: data });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  const { data: row } = await supabase.from('shifts')
    .select('id, restaurant_id, staff_id').eq('id', id).maybeSingle();
  if (!row || String(row.restaurant_id) !== String(r.id)) return res.status(404).json({ error: 'not found' });

  if (req.method === 'PATCH') {
    const patch = {};
    if ('role' in body) patch.role = body.role ? String(body.role).trim().slice(0, 60) : null;
    if ('notes' in body) patch.notes = body.notes ? String(body.notes).trim().slice(0, 300) : null;
    if ('starts_at' in body) {
      patch.starts_at = validIso(body.starts_at);
      if (!patch.starts_at) return res.status(400).json({ error: 'invalid starts_at' });
    }
    if ('ends_at' in body) {
      patch.ends_at = validIso(body.ends_at);
      if (!patch.ends_at) return res.status(400).json({ error: 'invalid ends_at' });
    }
    if ('staff_id' in body) {
      const { data: st } = await supabase.from('staff').select('id, restaurant_id').eq('id', body.staff_id).maybeSingle();
      if (!st || String(st.restaurant_id) !== String(r.id)) return res.status(404).json({ error: 'staff not found' });
      patch.staff_id = st.id;
    }
    if (patch.starts_at && patch.ends_at && new Date(patch.ends_at) <= new Date(patch.starts_at)) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' });
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const { error } = await supabaseAdmin.from('shifts').update(patch).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'shift.update', { target: id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  await supabaseAdmin.from('shifts').delete().eq('id', id);
  auditLog(req, r.id, 'shift.delete', { target: id }).catch(() => {});
  return res.status(200).json({ ok: true });
}
