// GET  /api/admin/clients          — list all restaurants
// POST /api/admin/clients          — create a new restaurant
// Your private boss panel only — protected by ADMIN_SECRET header

import { supabaseAdmin } from '../../_db.js';

function isAdmin(req) {
  return req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('restaurants')
      .select('id, slug, name, email, created_at')
      .order('name');
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, email, slug } = body;

    if (!name || !email || !slug) {
      return res.status(400).json({ error: 'name, email and slug required' });
    }

    const { data, error } = await supabaseAdmin
      .from('restaurants')
      .insert({ name, email, slug })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // If this email had a pending sign-up, auto-clear it now that they're linked.
    await supabaseAdmin.from('pending_signups').delete().ilike('email', email);

    return res.status(201).json(data);
  }

  return res.status(405).end();
}
