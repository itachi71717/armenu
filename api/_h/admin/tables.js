// Tables: GET list | POST create | PATCH (status/label/seats) | DELETE
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const { data = [] } = await supabase.from('restaurant_tables')
      .select('*').eq('restaurant_id', r.id).order('label');
    return res.status(200).json({ tables: data });
  }

  if (req.method === 'POST') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const label = String(body.label || '').trim();
    if (!label) return res.status(400).json({ error: 'label required' });
    const { data, error } = await supabaseAdmin.from('restaurant_tables').insert({
      restaurant_id: r.id, label, seats: parseInt(body.seats) || 2
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'table.create', { target: data?.label || label }).catch(() => {});
    return res.status(200).json({ table: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = { updated_at: new Date().toISOString() };
    if ('label' in body)  patch.label  = String(body.label).trim();
    if ('seats' in body)  patch.seats  = parseInt(body.seats) || 2;
    if ('status' in body) patch.status = String(body.status);
    if ('assigned_staff_id' in body) {
      patch.assigned_staff_id = body.assigned_staff_id || null;
      patch.assigned_at = body.assigned_staff_id ? new Date().toISOString() : null;
    }
    await supabaseAdmin.from('restaurant_tables').update(patch).eq('id', id);
    const { data: row } = await supabase.from('restaurant_tables').select('restaurant_id, label').eq('id', id).maybeSingle();
    auditLog(req, row?.restaurant_id, 'table.update', { target: row?.label || id, metadata: { fields: Object.keys(patch).filter(k => k !== 'updated_at') } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { data: row } = await supabase.from('restaurant_tables').select('restaurant_id, label').eq('id', id).maybeSingle();
    await supabaseAdmin.from('restaurant_tables').delete().eq('id', id);
    auditLog(req, row?.restaurant_id, 'table.delete', { target: row?.label || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
