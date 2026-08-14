// POST /api/portal/pending-signup
// Authenticated Clerk user (already signed up) but not yet linked to a restaurant.
// Captures their restaurant info so the owner can follow up and link them.

import { supabaseAdmin } from '../_db.js';
import { requireManager } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const restaurant_name = (body.restaurant_name || '').trim();
  const phone = (body.phone || '').trim();
  const message = (body.message || '').trim();

  if (!restaurant_name) return res.status(400).json({ error: 'Restaurant name required' });

  // Manual upsert (avoids depending on a specific unique-constraint name)
  const email = auth.email.toLowerCase();
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('pending_signups')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (lookupErr) {
    console.error('portal/pending-signup.js lookup failed:', lookupErr);
    return res.status(502).json({ error: 'Backend temporarily unavailable' });
  }

  if (existing) {
    const { error } = await supabaseAdmin
      .from('pending_signups')
      .update({ restaurant_name, phone: phone || null, message: message || null, status: 'pending' })
      .eq('id', existing.id);
    if (error) return res.status(400).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin
      .from('pending_signups')
      .insert({ email, restaurant_name, phone: phone || null, message: message || null, status: 'pending' });
    if (error) return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
}
