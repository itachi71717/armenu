// GET /api/admin/audit?slug=<r>&limit=100&before=<iso>&action=<x>&actor=<x>&q=<text>
//   → paginated audit events for one restaurant (or platform-wide for master).
// Cursor pagination: pass `before=<created_at ISO>` from the previous page's
// last row to fetch older events. Filters (action / actor / q) apply
// server-side so pagination isn't broken by the client re-filtering a slice.
// Master admin (or scoped manager token via the dispatcher's scope guard) only.
import { supabase } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const before = req.query.before;                     // ISO timestamp cursor
  const actionF = String(req.query.action || '').trim();
  const actorF  = String(req.query.actor  || '').trim();
  const q       = String(req.query.q      || '').trim();

  const scopeRid = getScopedRestaurantId(req);
  let rid = scopeRid;
  if (!rid) {
    const slug = req.query.slug;
    if (slug) {
      const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
      if (!r) return res.status(404).json({ error: 'restaurant not found' });
      rid = r.id;
    }
    // else: master admin with no slug → platform-wide feed
  }

  let query = supabase.from('audit_log').select('*');
  if (rid) query = query.eq('restaurant_id', rid);
  if (actionF) query = query.eq('action', actionF);
  if (actorF) query = query.eq('actor', actorF);
  if (before) query = query.lt('created_at', before);
  // When a free-text `q` filter is active, we over-fetch and keep pulling
  // pages until we have enough matches (or hit the sweep cap). Otherwise a
  // sparse-hit query would return an empty page + has_more:false even though
  // older matches exist further down the log.
  const SWEEP_CAP = q ? Math.max(2000, limit * 20) : limit + 1;
  query = query.order('created_at', { ascending: false }).limit(SWEEP_CAP);

  const { data = [] } = await query;

  const needle = q.toLowerCase();
  const matches = e => !q || (
    String(e.target || '').toLowerCase().includes(needle) ||
    JSON.stringify(e.metadata || {}).toLowerCase().includes(needle)
  );

  const filtered = data.filter(matches);
  const has_more = filtered.length > limit || (q && data.length >= SWEEP_CAP);
  const events = filtered.slice(0, limit);
  const next_before = has_more && events.length ? events[events.length - 1].created_at : null;

  return res.status(200).json({ events, has_more, next_before });
}
