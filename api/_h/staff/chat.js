// GET   /api/staff/chat?slug=<r>&open=1                       -> open threads (with unread_by_staff)
// GET   /api/staff/chat?slug=<r>&thread=<id>                  -> one thread + messages (clears unread_by_staff)
// POST  /api/staff/chat?thread=<id>&slug=<r> {body, from_name} -> reply (bumps unread_by_guest)
// PATCH /api/staff/chat?thread=<id>&slug=<r> {status:'closed'} -> close thread
import { supabase, supabaseAdmin } from '../../_db.js';
import { verifyToken } from './login.js';

const MAX_BODY = 500;
const MAX_MESSAGES = 50;

function auth(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return verifyToken(t);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = auth(req);
  if (!s) return res.status(401).json({ error: 'unauthorized' });

  // Token is bound to one restaurant; a supplied slug must map to it.
  const slug = req.query?.slug;
  if (slug) {
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', String(slug)).maybeSingle();
    if (!r || String(r.id) !== String(s.restaurant_id)) return res.status(403).json({ error: 'out_of_scope' });
  }

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  }

  const threadId = req.query?.thread;
  let thread = null;
  if (threadId) {
    const { data } = await supabase.from('chat_threads').select('*').eq('id', String(threadId)).maybeSingle();
    if (!data || String(data.restaurant_id) !== String(s.restaurant_id)) return res.status(404).json({ error: 'not found' });
    thread = data;
  }

  if (req.method === 'GET') {
    if (thread) {
      const { data: msgs = [] } = await supabase.from('chat_messages')
        .select('id, from_role, from_name, body, created_at').eq('thread_id', thread.id)
        .order('created_at', { ascending: false }).limit(MAX_MESSAGES);
      if ((thread.unread_by_staff || 0) > 0) {
        await supabaseAdmin.from('chat_threads').update({ unread_by_staff: 0 }).eq('id', thread.id);
      }
      return res.status(200).json({ thread: { ...thread, unread_by_staff: 0 }, messages: (msgs || []).slice().reverse() });
    }
    const { data: rows } = await supabase.raw(
      `select t.id, t.table_slug, t.status, t.unread_by_staff, t.created_at, t.last_message_at,
              (select body from chat_messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body
         from chat_threads t
        where t.restaurant_id = $1 and t.status = 'open'
        order by t.last_message_at desc nulls last limit 100`, [s.restaurant_id]);
    return res.status(200).json({ threads: rows || [] });
  }

  if (!thread) return res.status(400).json({ error: 'thread required' });

  if (req.method === 'POST') {
    if (thread.status !== 'open') return res.status(409).json({ error: 'thread_closed' });
    const text = String(body.body ?? '').trim().slice(0, MAX_BODY);
    if (!text) return res.status(400).json({ error: 'body required' });
    const { data: cnt } = await supabase.raw('select count(*)::int as n from chat_messages where thread_id = $1', [thread.id]);
    if ((cnt?.[0]?.n || 0) >= MAX_MESSAGES) return res.status(429).json({ error: 'thread_full' });
    const now = new Date().toISOString();
    const name = String(body.from_name || 'Staff').trim().slice(0, 60) || 'Staff';
    const { error } = await supabaseAdmin.from('chat_messages').insert({
      thread_id: thread.id, from_role: 'staff', from_name: name, body: text, created_at: now
    });
    if (error) return res.status(500).json({ error: 'message_failed' });
    await supabase.raw(
      'update chat_threads set unread_by_guest = coalesce(unread_by_guest,0) + 1, last_message_at = $2 where id = $1',
      [thread.id, now]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    if (body.status !== 'closed') return res.status(400).json({ error: 'bad status' });
    await supabaseAdmin.from('chat_threads').update({ status: 'closed' }).eq('id', thread.id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
