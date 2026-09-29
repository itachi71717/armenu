// GET    /api/admin/pending             — list all pending sign-ups
// DELETE /api/admin/pending?id=<uuid>   — dismiss a pending sign-up
// Protected by ADMIN_SECRET header.

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabaseAdmin.from('pending_signups').select('email, restaurant_name').eq('id', id).maybeSingle();
    const { error } = await supabaseAdmin.from('pending_signups').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, null, 'pending.dismiss', { target: row?.email || id, metadata: { restaurant_name: row?.restaurant_name || null } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  const { data = [] } = await supabaseAdmin
    .from('pending_signups')
    .select('id, email, restaurant_name, phone, message, status, created_at')
    .order('created_at', { ascending: false });
  return res.status(200).json(data);
}
