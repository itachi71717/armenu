// GET  /api/admin/waiter-calls?slug=r → open + recent
// PATCH /api/admin/waiter-calls?id     { status: 'acknowledged'|'closed' }
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const { data = [] } = await supabase.from('waiter_calls')
      .select('*').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(50);
    return res.status(200).json({ calls: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = { status: body.status || 'closed' };
    if (patch.status === 'closed') patch.closed_at = new Date().toISOString();
    await supabaseAdmin.from('waiter_calls').update(patch).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
