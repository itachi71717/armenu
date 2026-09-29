// GET /api/status — public system status for /status.
// Checks DB (SELECT 1 equivalent), R2 (HEAD on R2_PUBLIC_URL), SSE + Push config.
// History: kept in-memory per warm instance only (24h window). No persistent
// history yet — uptime_pct_24h is null until at least one sample exists.
import { supabase } from '../_db.js';

const WINDOW_MS = 24 * 3600 * 1000;
const samples = []; // { t, ok }
const errors = [];  // { t, msg }

function record(ok, msg) {
  const now = Date.now();
  samples.push({ t: now, ok });
  if (!ok) errors.push({ t: now, msg: String(msg || 'error').slice(0, 160) });
  while (samples.length && samples[0].t < now - WINDOW_MS) samples.shift();
  while (errors.length && errors[0].t < now - WINDOW_MS) errors.shift();
  if (samples.length > 5000) samples.splice(0, samples.length - 5000);
  if (errors.length > 50) errors.splice(0, errors.length - 50);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  let db_ok = false, db_ms = null, dbErr = null;
  try {
    const t0 = Date.now();
    const q = await supabase.from('restaurants').select('id').limit(1);
    if (q && q.error) throw new Error('database query failed');
    db_ms = Date.now() - t0;
    db_ok = true;
  } catch (e) {
    dbErr = 'database unreachable';
  }

  // R2: HEAD on the public base URL. Unconfigured => null (not counted as failure).
  const r2url = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  let r2_ok = null;
  if (r2url) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(r2url, { method: 'HEAD', signal: ctl.signal });
      clearTimeout(timer);
      // Any HTTP answer (even 404 on bucket root) means the edge is reachable.
      r2_ok = r.status < 500;
    } catch {
      r2_ok = false;
    }
  }

  // SSE: the events handler module must load.
  let sse_ok = false;
  try {
    const m = await import('./events.js');
    sse_ok = typeof m.default === 'function';
  } catch {
    sse_ok = false;
  }

  const push_ok = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  const ok = db_ok && r2_ok !== false && sse_ok;
  record(ok, dbErr || (r2_ok === false ? 'r2 unreachable' : (!sse_ok ? 'sse unavailable' : '')));

  const good = samples.filter(s => s.ok).length;
  const uptime_pct_24h = samples.length ? Math.round((good / samples.length) * 1000) / 10 : null;

  res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15');
  res.status(200).json({
    ok,
    db_ok,
    db_ms,
    r2_ok,
    sse_ok,
    push_ok,
    uptime_pct_24h,
    samples_24h: samples.length,
    recent_errors: errors.slice(-10).reverse().map(e => ({ at: new Date(e.t).toISOString(), message: e.msg })),
    timestamp: new Date().toISOString()
  });
}
