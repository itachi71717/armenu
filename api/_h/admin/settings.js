// GET  /api/admin/settings?slug=<r>   → current settings for a restaurant
// PATCH /api/admin/settings?slug=<r>  → body: partial fields to update
// Admin-only.

import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const ALLOWED = new Set([
  'orders_enabled','waiter_call_enabled','kitchen_display','reviews_enabled','tables_enabled',
  'logo_url','cover_url','theme_primary','theme_bg','tagline',
  'default_currency','currency_symbol','default_language','enabled_languages',
  'google_review_url','plan','subscription_status','trial_ends_at','paddle_subscription_id'
]);

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });

  if (req.method === 'GET') {
    let { data: s } = await supabase.from('restaurant_settings').select('*').eq('restaurant_id', r.id).maybeSingle();
    if (!s) {
      // Seed default row on first read
      const ins = await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: r.id }).select().single();
      s = ins.data;
    }
    return res.status(200).json({ settings: s });
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = { updated_at: new Date().toISOString() };
    for (const k of Object.keys(body || {})) if (ALLOWED.has(k)) patch[k] = body[k];

    // Upsert
    const { data: existing } = await supabaseAdmin.from('restaurant_settings').select('restaurant_id').eq('restaurant_id', r.id).maybeSingle();
    if (existing) {
      await supabaseAdmin.from('restaurant_settings').update(patch).eq('restaurant_id', r.id);
    } else {
      await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: r.id, ...patch });
    }
    auditLog(req, r.id, 'settings.update', { metadata: { fields: Object.keys(patch).filter(k => k !== 'updated_at') } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
