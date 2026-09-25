// GET /api/health — public uptime probe. Verifies DB reachable + shim wired.
// Response is small + cacheable for 5s to avoid hammering the DB on aggressive pings.
import { supabase } from '../_db.js';

export default async function handler(req, res) {
  const start = Date.now();
  let db_ok = false, db_ms = null, err = null;
  try {
    // Cheapest possible query — pings the connection + wakes Neon if idle
    const t0 = Date.now();
    await supabase.from('restaurants').select('id').limit(1);
    db_ms = Date.now() - t0;
    db_ok = true;
  } catch (e) {
    err = e.message;
  }
  res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
  res.status(db_ok ? 200 : 503).json({
    ok: db_ok,
    db_ok,
    db_ms,
    total_ms: Date.now() - start,
    env: process.env.VERCEL_ENV || 'development',
    region: process.env.VERCEL_REGION || 'unknown',
    error: err || undefined,
    timestamp: new Date().toISOString()
  });
}
