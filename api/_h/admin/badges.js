// GET /api/admin/badges → master-admin sidebar badges.
//   { pending_signups, new_restaurants_7d, audit_events_1h, low_health }
// low_health is true when the audit log shows an error/failure event in the
// last hour, or when the counting query itself fails (DB trouble).
// Master admin only — scoped manager tokens are refused.
import { supabase } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req) || getScopedRestaurantId(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const rows = await supabase.raw(`
      select
        (select count(*)::int from pending_signups where coalesce(status, 'pending') = 'pending') as pending_signups,
        (select count(*)::int from restaurants where created_at >= now() - interval '7 days') as new_restaurants_7d,
        (select count(*)::int from audit_log where created_at >= now() - interval '1 hour') as audit_events_1h,
        (select count(*)::int from audit_log where created_at >= now() - interval '1 hour' and (action ilike '%error%' or action ilike '%fail%')) as error_events_1h
    `);
    const r = rows.data?.[0] || {};
    return res.status(200).json({
      pending_signups: r.pending_signups || 0,
      new_restaurants_7d: r.new_restaurants_7d || 0,
      audit_events_1h: r.audit_events_1h || 0,
      low_health: (r.error_events_1h || 0) > 0
    });
  } catch (e) {
    console.error('admin badges failed:', e);
    return res.status(200).json({ pending_signups: 0, new_restaurants_7d: 0, audit_events_1h: 0, low_health: true });
  }
}
