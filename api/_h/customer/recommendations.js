// GET /api/customer/recommendations?token=<>&r=<restaurant slug>&limit=6
// Public, guest-facing, read-only. Cross-restaurant collaborative filtering:
// "neighbours" are customers sharing >= 2 signals (favourite / thumbs-up /
// ordered dish) with this customer; we rank dishes they endorsed
// (favourited / thumbs-up) that this customer hasn't already favourited or
// ordered. Any lookup miss returns a silent 200 with an empty array.
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,100}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'private, no-store');
  const empty = () => res.status(200).json({ recommendations: [] });

  try {
    const q = req.query || {};
    const token = q.token;
    const slug = typeof q.r === 'string' && SLUG_RE.test(q.r) ? q.r : '';
    const limit = Math.max(1, Math.min(12, parseInt(q.limit, 10) || 6));
    if (!isValidToken(token)) return empty();

    const customer = await resolveCustomerRowByToken(token);
    if (!customer) return empty();

    // Signals are unioned once; `mine` is this customer's dish set.
    const { data: rows, error } = await supabase.raw(
      `with signals as (
         select customer_id, dish_id, 'fav' as kind from customer_favourites where customer_id is not null
         union all
         select customer_id, dish_id, 'like' as kind from customer_dish_ratings where rating = 1 and customer_id is not null
       ),
       mine as (
         select dish_id from customer_favourites where customer_id = $1
         union select dish_id from customer_dish_ratings where customer_id = $1 and rating = 1
         union select oi.dish_id from order_items oi join orders o on o.id = oi.order_id
                where o.customer_id = $1 and oi.dish_id is not null
       ),
       neighbours as (
         select s.customer_id
           from (select customer_id, dish_id from signals
                 union select o.customer_id, oi.dish_id from order_items oi join orders o on o.id = oi.order_id
                        where o.customer_id is not null and oi.dish_id is not null) s
           join mine m on m.dish_id = s.dish_id
          where s.customer_id <> $1
          group by s.customer_id
         having count(distinct s.dish_id) >= 2
          order by count(distinct s.dish_id) desc
          limit 200
       ),
       cand as (
         select s.dish_id, count(distinct s.customer_id) as endorsements
           from signals s
           join neighbours n on n.customer_id = s.customer_id
          where s.dish_id not in (select dish_id from mine)
          group by s.dish_id
          order by endorsements desc
          limit 100
       )
       select d.slug as dish_slug, d.name as dish_name, d.price_cents, d.thumb_url,
              r.slug as restaurant_slug, r.name as restaurant_name, c.endorsements
         from cand c
         join dishes d on d.id = c.dish_id
         join restaurants r on r.id = d.restaurant_id
        where d.active is not false
          and coalesce((to_jsonb(d)->>'stock_count')::int, 1) > 0
          and (r.slug = $2 or coalesce((to_jsonb(r)->>'public')::boolean, true) is not false)
        order by c.endorsements desc, d.name asc
        limit $3`,
      [customer.id, slug, limit]
    );
    if (error || !Array.isArray(rows)) return empty();

    return res.status(200).json({
      recommendations: rows.map(x => ({
        dish_slug: x.dish_slug,
        restaurant_slug: x.restaurant_slug,
        restaurant_name: x.restaurant_name,
        dish_name: x.dish_name,
        price_cents: x.price_cents == null ? null : Number(x.price_cents),
        thumb_url: x.thumb_url || null,
        endorsements: Number(x.endorsements) || 0
      }))
    });
  } catch {
    return empty();
  }
}
