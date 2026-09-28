// GET  /api/admin/clients          — list all restaurants
// POST /api/admin/clients          — create a new restaurant
// Your private boss panel only — protected by ADMIN_SECRET header

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  // NOTE: this route is master-admin only (see MASTER_ONLY in api/index.js),
  // so requireAdmin's portal_token branch can never actually authenticate a
  // scoped manager here — the dispatcher already rejects those before the
  // handler runs. Using requireAdmin (instead of checking only the legacy
  // x-admin-secret header) is what lets the signed admin-cookie login flow
  // (/api/admin/login) work on this page, same as every other admin/* route.
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('restaurants')
      .select('id, slug, name, email, created_at')
      .order('name');
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, slug } = body;
    const email = body.email ? String(body.email).trim().toLowerCase() : '';

    if (!name || !email || !slug) {
      return res.status(400).json({ error: 'name, email and slug required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const { data, error } = await supabaseAdmin
      .from('restaurants')
      .insert({ name, email, slug })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // If this email had a pending sign-up, auto-clear it now that they're linked.
    await supabaseAdmin.from('pending_signups').delete().eq('email', email);

    auditLog(req, data.id, 'restaurant.create', { target: data.slug, metadata: { name, email } }).catch(() => {});

    return res.status(201).json(data);
  }

  return res.status(405).end();
}
