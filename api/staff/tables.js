// GET   /api/staff/tables                → list restaurant's tables
// PATCH /api/staff/tables?id=<id>        → { status } (available|occupied|reserved|vip|cleaning)
import { supabase, supabaseAdmin } from '../_db.js';
import { verifyToken } from './login.js';

const OK = new Set(['available','occupied','reserved','vip','cleaning']);

function auth(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return verifyToken(t);
}

export default async function handler(req, res) {
  const s = auth(req);
  if (!s) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { data = [] } = await supabase.from('restaurant_tables')
      .select('*').eq('restaurant_id', s.restaurant_id).order('label');
    return res.status(200).json({ tables: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (!OK.has(body.status)) return res.status(400).json({ error: 'bad status' });
    const { data: t } = await supabase.from('restaurant_tables').select('restaurant_id').eq('id', id).single();
    if (!t || t.restaurant_id !== s.restaurant_id) return res.status(404).json({ error: 'not found' });
    await supabaseAdmin.from('restaurant_tables').update({
      status: body.status, updated_at: new Date().toISOString()
    }).eq('id', id);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET' && req.query.calls === '1') {
    const { data = [] } = await supabase.from('waiter_calls')
      .select('*').eq('restaurant_id', s.restaurant_id).eq('status', 'open').order('created_at');
    return res.status(200).json({ calls: data });
  }
  return res.status(405).end();
}
