// POST /api/customer/rate-dish  { token, restaurant_slug, dish_slug, order_id?, rating: 1|-1 }
// Public, guest-facing, fire-and-forget: any lookup miss returns a silent 200.
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  const ok = () => res.status(200).json({ ok: true });

  try {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const { token, restaurant_slug, dish_slug, order_id, rating } = body || {};
    const score = Number(rating);
    if (!isValidToken(token) || (score !== 1 && score !== -1)) return ok();
    if (typeof restaurant_slug !== 'string' || typeof dish_slug !== 'string') return ok();

    const customer = await resolveCustomerRowByToken(token);
    if (!customer) return ok();
    const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', restaurant_slug).maybeSingle();
    if (!restaurant) return ok();
    const { data: dish } = await supabase.from('dishes').select('id')
      .eq('restaurant_id', restaurant.id).eq('slug', dish_slug).maybeSingle();
    if (!dish) return ok();

    // Only link the order if it exists AND belongs to this customer + restaurant.
    let orderId = null;
    if (typeof order_id === 'string' && UUID_RE.test(order_id)) {
      const { data: ord } = await supabase.from('orders').select('id')
        .eq('id', order_id).eq('restaurant_id', restaurant.id).eq('customer_id', customer.id).maybeSingle();
      if (ord) orderId = ord.id;
    }

    // unique(customer_id, dish_id, order_id) treats NULL order_ids as distinct,
    // so the no-order case is an explicit update-or-insert.
    if (orderId) {
      await supabase.raw(
        `insert into customer_dish_ratings (customer_id, dish_id, restaurant_id, order_id, rating)
         values ($1, $2, $3, $4, $5)
         on conflict (customer_id, dish_id, order_id) do update set rating = excluded.rating, created_at = now()`,
        [customer.id, dish.id, restaurant.id, orderId, score]
      );
    } else {
      const upd = await supabase.raw(
        `update customer_dish_ratings set rating = $3, created_at = now()
          where customer_id = $1 and dish_id = $2 and order_id is null returning id`,
        [customer.id, dish.id, score]
      );
      if (!(upd.data || []).length) {
        await supabase.raw(
          `insert into customer_dish_ratings (customer_id, dish_id, restaurant_id, order_id, rating)
           values ($1, $2, $3, null, $4)`,
          [customer.id, dish.id, restaurant.id, score]
        );
      }
    }
  } catch {}
  return ok();
}
