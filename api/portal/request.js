// POST /api/portal/request   { message }
// Authenticated restaurant manager submits a change/new-dish request.

import { supabaseAdmin } from '../_db.js';
import { requireManager } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const message = (body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required' });

  const { data: restaurant } = await supabaseAdmin
    .from('restaurants')
    .select('id')
    .ilike('email', auth.email)
    .maybeSingle();

  if (!restaurant) return res.status(404).json({ error: 'no_restaurant_linked' });

  const { error } = await supabaseAdmin.from('requests').insert({
    restaurant_id: restaurant.id,
    message,
    status: 'pending'
  });

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
