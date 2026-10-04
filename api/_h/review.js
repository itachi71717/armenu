// POST /api/review  { r, stars, comment?, table? }
// Public — gated by restaurant_settings.reviews_enabled.
// 4-5★ responses receive the Google Review URL so the diner can copy praise there.
// 1-3★ stays private for the owner.
import { supabase } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { r, stars, comment, table } = body || {};
  if (!r || !stars) return res.status(400).json({ error: 'Missing r or stars' });
  const n = parseInt(stars);
  if (!(n >= 1 && n <= 5)) return res.status(400).json({ error: 'stars must be 1-5' });

  // Single round-trip: join restaurants + restaurant_settings.
  const { data: rows } = await supabase.raw(`
    select r.id, rs.reviews_enabled, rs.google_review_url
    from restaurants r
    left join restaurant_settings rs on rs.restaurant_id = r.id
    where r.slug = $1 limit 1
  `, [r]);
  const row = rows?.[0];
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  if (row.reviews_enabled === false) return res.status(403).json({ error: 'Reviews disabled' });

  let table_id = null;
  if (table) {
    const { data: t } = await supabase.from('restaurant_tables')
      .select('id').eq('restaurant_id', row.id).eq('label', table).maybeSingle();
    if (t) table_id = t.id;
  }

  const google = n >= 4 ? row.google_review_url || null : null;

  await supabase.from('reviews').insert({
    restaurant_id: row.id,
    table_id,
    stars: n,
    comment: String(comment || '').slice(0, 1000) || null,
    routed_to_google: !!google
  });

  return res.status(200).json({ ok: true, google_review_url: google });
}
