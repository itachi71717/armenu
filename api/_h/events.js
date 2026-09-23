// GET /api/events?token=<staff-token>   Server-Sent Events for the staff console.
// Streams { type: 'orders'|'calls', count } every 3s, plus a heartbeat every 25s.
// Cheaper than opening a Supabase Realtime channel from the browser and does not
// require RLS. Long-lived response; Vercel's default max duration is ~300s so
// the client reconnects on EOF (EventSource does this automatically).
import { supabase } from '../_db.js';
import { verifyToken } from './staff/login.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifyToken(token);
  if (!session) { res.status(401).end(); return; }

  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.write(': connected\n\n');

  let lastOrders = 0, lastCalls = 0, closed = false;
  req.on('close', () => { closed = true; });

  async function tick() {
    if (closed) return;
    try {
      const [oQ, cQ] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('restaurant_id', session.restaurant_id).in('status', ['new','prep','ready']),
        supabase.from('waiter_calls').select('id', { count: 'exact', head: true })
          .eq('restaurant_id', session.restaurant_id).neq('status', 'closed')
      ]);
      const o = oQ.count || 0, c = cQ.count || 0;
      if (o !== lastOrders) { lastOrders = o; res.write(`event: orders\ndata: ${o}\n\n`); }
      if (c !== lastCalls)  { lastCalls  = c; res.write(`event: calls\ndata: ${c}\n\n`);  }
    } catch {}
  }
  await tick();
  const iv = setInterval(tick, 3000);
  const hb = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 25000);
  const stop = setTimeout(() => { closed = true; clearInterval(iv); clearInterval(hb); res.end(); }, 270_000);
  req.on('close', () => { clearInterval(iv); clearInterval(hb); clearTimeout(stop); });
}
