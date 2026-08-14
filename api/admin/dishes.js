// POST /api/admin/dishes
// You upload a dish (glb URL, name, price) and it goes live immediately

import { supabaseAdmin } from '../_db.js';

function isAdmin(req) {
  return req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { restaurant_slug, name, price, glb_url, usdz_url, thumb_url, camera_orbit } = body;

  if (!restaurant_slug || !name || !glb_url) {
    return res.status(400).json({ error: 'restaurant_slug, name, and glb_url required' });
  }

  const { data: restaurant } = await supabaseAdmin
    .from('restaurants')
    .select('id')
    .eq('slug', restaurant_slug)
    .single();

  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const { data, error } = await supabaseAdmin
    .from('dishes')
    .insert({
      restaurant_id: restaurant.id,
      slug,
      name,
      price: price || null,
      glb_url,
      usdz_url: usdz_url || null,
      thumb_url: thumb_url || null,
      camera_orbit: camera_orbit || null,
      active: true
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
}
