// GET   /api/staff/calls               → open waiter calls
// PATCH /api/staff/calls?id=<id>       → { status: 'acknowledged'|'closed' }
import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyToken } from './login.js';

const OK = new Set(['open','acknowledged','closed']);

function auth(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return verifyToken(t);
}

export default async function handler(req, res) {
  const s = auth(req);
  if (!s) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { data = [] } = await supabase.from('waiter_calls')
      .select('*').eq('restaurant_id', s.restaurant_id)
      .neq('status', 'closed')
      .order('created_at', { ascending: true }).limit(50);
    return res.status(200).json({ calls: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (!OK.has(body.status)) return res.status(400).json({ error: 'bad status' });
    const patch = { status: body.status };
    if (body.status === 'closed') patch.closed_at = new Date().toISOString();
    const { data: c } = await supabase.from('waiter_calls').select('restaurant_id').eq('id', id).single();
    if (!c || c.restaurant_id !== s.restaurant_id) return res.status(404).json({ error: 'not found' });
    await supabaseAdmin.from('waiter_calls').update(patch).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
