// GET /api/discover — public directory of every active restaurant.
// No auth. Cached at the edge for 5 minutes.
// cuisine / city / enabled are read defensively via to_jsonb() so the query
// keeps working on databases where those optional columns haven't been added.
import { supabase } from '../_db.js';

const MAX_RESTAURANTS = 500;
const NEW_DAYS = 30;
const MIN_RATINGS = 5;

export function priceRange(medianCents) {
  const m = Number(medianCents);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m < 8000) return '$';
  if (m <= 20000) return '$$';
  return '$$$';
}

// Positive share of all votes mapped onto a 0-5 star scale (1 dp).
// Null when fewer than MIN_RATINGS votes.
export function starRating(pos, neg) {
  const p = Number(pos) || 0, n = Number(neg) || 0, total = p + n;
  if (total < MIN_RATINGS) return null;
  return Math.round((p / total) * 50) / 10;
}

const SQL = `
  with base as (
    select r.id, r.slug, r.name, r.created_at,
           coalesce(nullif(to_jsonb(r)->>'cuisine',''), nullif(to_jsonb(rs)->>'cuisine',''))  as cuisine,
           coalesce(nullif(to_jsonb(r)->>'city',''),    nullif(to_jsonb(rs)->>'city',''))     as city,
           coalesce(nullif(to_jsonb(rs)->>'cover_url',''), nullif(to_jsonb(r)->>'cover_image_url','')) as cover_url
      from restaurants r
      left join restaurant_settings rs on rs.restaurant_id = r.id
     where coalesce(to_jsonb(rs)->>'enabled','true') <> 'false'
  ),
  d as (
    select restaurant_id, count(*)::int as dish_count,
           percentile_cont(0.5) within group (order by price_cents)
             filter (where price_cents > 0) as median_cents,
           (array_agg(thumb_url order by sort_order nulls last, name) filter (where thumb_url is not null))[1] as any_thumb
      from dishes where active is not false group by restaurant_id
  ),
  rt as (
    select dish_id,
           count(*) filter (where rating > 0)::int as pos,
           count(*) filter (where rating < 0)::int as neg
      from customer_dish_ratings group by dish_id
  ),
  rr as (
    select restaurant_id, sum(pos)::int as pos, sum(neg)::int as neg
      from (select dd.restaurant_id, rt.pos, rt.neg from rt join dishes dd on dd.id = rt.dish_id where dd.active is not false) x
     group by restaurant_id
  ),
  pop as (
    select distinct on (dd.restaurant_id) dd.restaurant_id, dd.name, dd.slug
      from dishes dd left join rt on rt.dish_id = dd.id
     where dd.active is not false
     order by dd.restaurant_id, (coalesce(rt.pos,0) - coalesce(rt.neg,0)) desc, dd.sort_order nulls last, dd.name
  )
  select b.slug, b.name, b.created_at, b.cuisine, b.city,
         coalesce(b.cover_url, d.any_thumb) as cover_image_url,
         d.dish_count, d.median_cents,
         coalesce(rr.pos,0) as pos, coalesce(rr.neg,0) as neg,
         pop.name as pop_name, pop.slug as pop_slug
    from base b
    join d on d.restaurant_id = b.id
    left join rr on rr.restaurant_id = b.id
    left join pop on pop.restaurant_id = b.id
   where d.dish_count >= 1
   limit ${MAX_RESTAURANTS * 2}
`;

export function shapeRows(rows, now = Date.now()) {
  const cutoff = now - NEW_DAYS * 86400000;
  const out = (rows || []).map(r => {
    const created = r.created_at ? new Date(r.created_at).getTime() : NaN;
    return {
      slug: r.slug,
      name: r.name,
      cover_image_url: r.cover_image_url || null,
      cuisine: r.cuisine || null,
      city: r.city || null,
      dish_count: Number(r.dish_count) || 0,
      avg_rating: starRating(r.pos, r.neg),
      popular_dish: r.pop_slug ? { name: r.pop_name, slug: r.pop_slug } : null,
      is_new: Number.isFinite(created) && created >= cutoff,
      price_range: priceRange(r.median_cents)
    };
  });
  out.sort((a, b) => (Number(b.is_new) - Number(a.is_new)) || (b.dish_count - a.dish_count) || String(a.name).localeCompare(String(b.name)));
  return out.slice(0, MAX_RESTAURANTS);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).json({ error: 'method_not_allowed' }); }

  const { data, error } = await supabase.raw(SQL, []);
  if (error) {
    console.error('discover query failed:', error.message);
    return res.status(500).json({ error: 'discover_failed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ restaurants: shapeRows(data) });
}
