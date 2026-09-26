// Menu schedules — GET ?slug=r  · POST ?slug=r · PATCH ?id · DELETE ?id
// Table: menu_schedules(id, restaurant_id, name, starts_at time, ends_at time,
//   days_of_week int[], category_ids uuid[], active bool)
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const { data = [] } = await supabase.from('menu_schedules').select('*').eq('restaurant_id', r.id).order('starts_at');
    return res.status(200).json({ schedules: data });
  }
  if (req.method === 'POST') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!body.name || !body.starts_at || !body.ends_at) return res.status(400).json({ error: 'name, starts_at, ends_at required' });
    const { data, error } = await supabaseAdmin.from('menu_schedules').insert({
      restaurant_id: r.id,
      name: body.name,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      days_of_week: Array.isArray(body.days_of_week) ? body.days_of_week : [0,1,2,3,4,5,6],
      category_ids: Array.isArray(body.category_ids) ? body.category_ids : [],
      active: body.active !== false
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'schedule.create', { target: data?.name }).catch(() => {});
    return res.status(200).json({ schedule: data });
  }
  if (req.method === 'PATCH') {
    const { id } = req.query;
    const { data: row } = await supabase.from('menu_schedules').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const patch = {};
    for (const k of ['name','starts_at','ends_at','days_of_week','category_ids','active']) if (k in body) patch[k] = body[k];
    await supabaseAdmin.from('menu_schedules').update(patch).eq('id', id);
    auditLog(req, row.restaurant_id, 'schedule.update', { target: row.name || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { data: row } = await supabase.from('menu_schedules').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await supabaseAdmin.from('menu_schedules').delete().eq('id', id);
    auditLog(req, row.restaurant_id, 'schedule.delete', { target: row.name || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
