// POST /api/scan
// Called by view.html when a diner scans a dish (fire-and-forget analytics)

import { supabase } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { r, d } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', r)
      .single();

    if (!restaurant) return res.status(200).end();

    const { data: dish } = await supabase
      .from('dishes')
      .select('id')
      .eq('restaurant_id', restaurant.id)
      .eq('slug', d)
      .single();

    await supabase.from('scans').insert({
      restaurant_id: restaurant.id,
      dish_id: dish?.id ?? null,
      user_agent: req.headers['user-agent'] ?? ''
    });
  } catch (e) {
    // never fail a scan — it's analytics, not critical
  }

  return res.status(200).end();
}
