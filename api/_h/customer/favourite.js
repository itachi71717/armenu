// POST /api/customer/favourite  { token, restaurant_slug, dish_slug }
// Public, guest-facing. Toggles a customer's favourite on one dish.
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { token, restaurant_slug, dish_slug } = body || {};
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
  if (!restaurant_slug || !dish_slug) return res.status(400).json({ error: 'Missing restaurant_slug or dish_slug' });

  const customer = await resolveCustomerRowByToken(token);
  if (!customer) return res.status(404).json({ error: 'not_found' });

  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', restaurant_slug).maybeSingle();
  if (!restaurant) return res.status(404).json({ error: 'not_found' });

  const { data: dish } = await supabase.from('dishes')
    .select('id').eq('restaurant_id', restaurant.id).eq('slug', dish_slug).maybeSingle();
  if (!dish) return res.status(404).json({ error: 'not_found' });

  const { data: existing } = await supabase.from('customer_favourites')
    .select('id').eq('customer_id', customer.id).eq('dish_id', dish.id).maybeSingle();

  if (existing) {
    await supabase.from('customer_favourites').delete().eq('id', existing.id);
    return res.status(200).json({ favourited: false });
  }

  await supabase.from('customer_favourites').insert({
    customer_id: customer.id,
    dish_id: dish.id,
    restaurant_id: restaurant.id
  });
  return res.status(200).json({ favourited: true });
}
