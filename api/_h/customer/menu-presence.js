// POST /api/customer/menu-presence { token, restaurant_slug } → heartbeat (upsert)
// GET  /api/customer/menu-presence?r=<slug> → { viewer_count }
// Public, guest-facing. Distinct tokens seen in the last 90s.
import { supabase, supabaseAdmin } from '../../_db.js';
import { isValidToken } from './hello.js';

const MIN_VIEWERS = 3;
let ensured = null;
function ensureTable() {
  if (!ensured) {
    ensured = (async () => {
      const a = await supabaseAdmin.raw('create table if not exists menu_presence (token text primary key, restaurant_slug text, last_seen timestamptz default now())');
      if (a.error) throw new Error(a.error.message);
      await supabaseAdmin.raw('create index if not exists menu_presence_slug_seen on menu_presence (restaurant_slug, last_seen)');
    })().catch(e => { ensured = null; throw e; });
  }
  return ensured;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');
  try { await ensureTable(); } catch { return res.status(200).json({ viewer_count: 0 }); }

  if (req.method === 'GET') {
    const slug = String(req.query.r || '').slice(0, 100);
    if (!slug) return res.status(400).json({ error: 'r required' });
    const { data } = await supabase.raw(
      "select count(distinct token)::int as n from menu_presence where restaurant_slug = $1 and last_seen > now() - interval '90 seconds'",
      [slug]);
    // Privacy: never reveal small counts (1-2 viewers) — report 0 below the threshold.
    const n = data?.[0]?.n || 0;
    return res.status(200).json({ viewer_count: n >= MIN_VIEWERS ? n : 0 });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const { token, restaurant_slug } = body || {};
    if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
    if (!restaurant_slug || typeof restaurant_slug !== 'string') return res.status(400).json({ error: 'restaurant_slug required' });
    await supabaseAdmin.raw(
      'insert into menu_presence (token, restaurant_slug, last_seen) values ($1, $2, now()) on conflict (token) do update set restaurant_slug = excluded.restaurant_slug, last_seen = now()',
      [token, restaurant_slug.slice(0, 100)]);
    // Opportunistic cleanup of stale rows (~2% of beats).
    if (Math.random() < 0.02) {
      Promise.resolve(supabaseAdmin.raw("delete from menu_presence where last_seen < now() - interval '1 day'")).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
