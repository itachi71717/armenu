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

  // lastOrders/lastCalls start as null so the first tick ALWAYS emits, even
  // when both counts are zero — otherwise clients that rely on the first
  // event to seed their badges see nothing until state changes.
  let lastOrders = null, lastCalls = null, closed = false;

  async function tick() {
    if (closed) return;
    try {
      // Use raw COUNT — much cheaper than loading rows just to get length.
      // The shim exposes .raw() for exactly this.
      const [oR, cR] = await Promise.all([
        supabase.raw(
          "select count(*)::int as n from orders where restaurant_id = $1 and status in ('new','prep','ready')",
          [session.restaurant_id]
        ),
        supabase.raw(
          "select count(*)::int as n from waiter_calls where restaurant_id = $1 and status <> 'closed'",
          [session.restaurant_id]
        )
      ]);
      const o = oR.data?.[0]?.n || 0, c = cR.data?.[0]?.n || 0;
      if (o !== lastOrders) { lastOrders = o; res.write(`event: orders\ndata: ${o}\n\n`); }
      if (c !== lastCalls)  { lastCalls  = c; res.write(`event: calls\ndata: ${c}\n\n`);  }
    } catch (e) { console.warn('SSE tick failed:', e.message); }
  }
  await tick();
  const iv = setInterval(tick, 3000);
  const hb = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 25000);
  // Single teardown path — flip closed, clear both intervals, clear the
  // stop timer, end the response. Runs once whether the trigger is client
  // disconnect or the 270s max-duration timeout.
  const teardown = () => {
    if (closed) return;
    closed = true;
    clearInterval(iv);
    clearInterval(hb);
    clearTimeout(stop);
    try { res.end(); } catch {}
  };
  const stop = setTimeout(teardown, 270_000);
  req.on('close', teardown);
}
