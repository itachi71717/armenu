// Tables: GET list | POST create | PATCH (status/label/seats) | DELETE
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

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
    await supabaseAdmin.from('restaurant_tables').update(patch).eq('id', id);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    await supabaseAdmin.from('restaurant_tables').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
