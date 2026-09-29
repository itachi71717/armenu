// POST /api/chat { token, restaurant_slug, table_slug?, body } -> start/reuse open thread + insert message
// GET  /api/chat?token=<>&restaurant_slug=<>                   -> { thread_id, status, messages, unread_by_guest }
// Public, guest-facing, token-based (same customer token as the rest of the menu).
import { supabase, supabaseAdmin } from '../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './customer/hello.js';
import { sendPush } from './push/_send.js';

const MAX_BODY = 500;
const MAX_MESSAGES = 50;
const RATE_PER_MIN = 10;

// Rate limit applies to sends (POST); 5s guest polling is covered by the dispatcher limiter.
// Per warm instance sliding window keyed on token (same caveat as the dispatcher limiter).
const rate = new Map();
function limited(token) {
  const now = Date.now();
  const arr = (rate.get(token) || []).filter(t => t > now - 60_000);
  arr.push(now);
  rate.set(token, arr);
  if (rate.size > 5000) rate.clear();
  return arr.length > RATE_PER_MIN;
}

async function findOpenThread(restaurantId, customerId) {
  const { data } = await supabase.from('chat_threads').select('*')
    .eq('restaurant_id', restaurantId).eq('customer_id', customerId).eq('status', 'open')
    .order('created_at', { ascending: false }).limit(1);
  return (data && data[0]) || null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  }
  const src = req.method === 'POST' ? body : (req.query || {});
  const token = src.token;
  const slug = String(src.restaurant_slug || '').slice(0, 100);
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
  if (!slug) return res.status(400).json({ error: 'restaurant_slug required' });
  if (req.method === 'POST' && limited(token)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited' });
  }

  const { data: rest } = await supabase.from('restaurants').select('id, name').eq('slug', slug).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

  let customer = await resolveCustomerRowByToken(token);
  if (!customer) {
    if (req.method === 'GET') return res.status(200).json({ thread_id: null, status: null, messages: [], unread_by_guest: 0 });
    await supabaseAdmin.from('customers').upsert({ token });
    customer = await resolveCustomerRowByToken(token);
    if (!customer) return res.status(500).json({ error: 'customer_unavailable' });
  }

  if (req.method === 'GET') {
    // Open thread preferred; otherwise the latest closed one so it stays readable.
    let thread = await findOpenThread(rest.id, customer.id);
    if (!thread) {
      const { data } = await supabase.from('chat_threads').select('*')
        .eq('restaurant_id', rest.id).eq('customer_id', customer.id)
        .order('created_at', { ascending: false }).limit(1);
      thread = (data && data[0]) || null;
    }
    if (!thread) return res.status(200).json({ thread_id: null, status: null, messages: [], unread_by_guest: 0 });
    const { data: msgs = [] } = await supabase.from('chat_messages')
      .select('id, from_role, from_name, body, created_at').eq('thread_id', thread.id)
      .order('created_at', { ascending: false }).limit(MAX_MESSAGES);
    const unread = thread.unread_by_guest || 0;
    if (unread > 0 && !src.peek) await supabaseAdmin.from('chat_threads').update({ unread_by_guest: 0 }).eq('id', thread.id);
    return res.status(200).json({
      thread_id: thread.id, status: thread.status,
      messages: (msgs || []).slice().reverse(), unread_by_guest: unread
    });
  }

  // POST
  const text = String(body.body ?? '').trim().slice(0, MAX_BODY);
  if (!text) return res.status(400).json({ error: 'body required' });
  const tableSlug = body.table_slug ? String(body.table_slug).slice(0, 60) : null;

  let thread = await findOpenThread(rest.id, customer.id);
  if (!thread) {
    const { data: created, error } = await supabaseAdmin.from('chat_threads').insert({
      restaurant_id: rest.id, customer_id: customer.id, table_slug: tableSlug,
      status: 'open', unread_by_staff: 0, unread_by_guest: 0,
      last_message_at: new Date().toISOString()
    }).select('*').single();
    if (error || !created) return res.status(500).json({ error: 'thread_create_failed' });
    thread = created;
  } else {
    const { data: cnt } = await supabase.raw('select count(*)::int as n from chat_messages where thread_id = $1', [thread.id]);
    if ((cnt?.[0]?.n || 0) >= MAX_MESSAGES) {
      return res.status(429).json({ error: 'thread_full', message: 'This chat is full. Please ask a staff member in person.' });
    }
  }

  const now = new Date().toISOString();
  const { error: mErr } = await supabaseAdmin.from('chat_messages').insert({
    thread_id: thread.id, from_role: 'guest',
    from_name: customer.name ? String(customer.name).slice(0, 60) : 'Guest',
    body: text, created_at: now
  });
  if (mErr) return res.status(500).json({ error: 'message_failed' });
  await supabase.raw(
    'update chat_threads set unread_by_staff = coalesce(unread_by_staff,0) + 1, last_message_at = $2, table_slug = coalesce($3, table_slug) where id = $1',
    [thread.id, now, tableSlug]);

  sendPush(rest.id, {
    title: 'Guest message',
    body: (tableSlug ? 'Table ' + tableSlug + ': ' : '') + text.slice(0, 80),
    url: '/staff/', tag: 'chat-' + thread.id
  }).catch(() => {});

  return res.status(200).json({ ok: true, thread_id: thread.id });
}
