// Offers (happy hour, weekend specials).
// GET ?slug=r · POST ?slug=r · PATCH ?id · DELETE ?id
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const { data = [] } = await supabase.from('offers').select('*').eq('restaurant_id', r.id).order('created_at', { ascending: false });
    return res.status(200).json({ offers: data });
  }

  if (req.method === 'POST') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (!body.name || !body.starts_at || !body.ends_at || !body.discount_pct)
      return res.status(400).json({ error: 'name, starts_at, ends_at, discount_pct required' });
    const { data, error } = await supabaseAdmin.from('offers').insert({
      restaurant_id: r.id,
      name: body.name,
      discount_pct: parseInt(body.discount_pct),
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      days_of_week: Array.isArray(body.days_of_week) ? body.days_of_week : [0,1,2,3,4,5,6],
      dish_ids: Array.isArray(body.dish_ids) ? body.dish_ids : []
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ offer: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = {};
    for (const k of ['name','discount_pct','starts_at','ends_at','days_of_week','dish_ids','active']) {
      if (k in body) patch[k] = body[k];
    }
    await supabaseAdmin.from('offers').update(patch).eq('id', id);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    await supabaseAdmin.from('offers').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
