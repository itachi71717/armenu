// GET /api/settings?r=<restaurant-slug>
// Public — features + branding + locale for the guest menu.
// Degrades gracefully when restaurant_settings hasn't been migrated yet
// (returns safe defaults so the AR menu still works).
import { supabase } from '../_db.js';

const isMissingTable = err => {
  const msg = String(err?.message || '');
  return /relation .* does not exist/i.test(msg) || err?.code === '42P01';
};

export default async function handler(req, res) {
  const { r } = req.query;
  if (!r) return res.status(400).json({ error: 'Missing r param' });

  if (r === '__canary__') {
    const out = { where: 'settings' };
    try { const g = await fetch('https://www.google.com'); out.google = g.status; } catch (e) { out.google_err = e.message; }
    try { const s = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } }); out.supabase = s.status; } catch (e) { out.supabase_err = e.message; }
    // Also try via supabase-js client
    try { const q = await supabase.from('restaurants').select('slug').limit(1); out.sdk = { ok: !q.error, count: q.data?.length, err: q.error?.message }; } catch (e) { out.sdk_err = e.message; }
    return res.status(200).json(out);
  }

  const { data: restaurant, error: rerr } = await supabase
    .from('restaurants').select('id, slug, name').eq('slug', r).single();
  if (rerr || !restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  let s = {};
  try {
    const q = await supabase.from('restaurant_settings').select('*').eq('restaurant_id', restaurant.id).maybeSingle();
    if (!isMissingTable(q.error)) s = q.data || {};
  } catch {}

  return res.status(200).json({
    restaurant: { slug: restaurant.slug, name: restaurant.name },
    features: {
      orders:      !!s.orders_enabled,
      waiter_call: !!s.waiter_call_enabled,
      reviews:     s.reviews_enabled !== false,
      tables:      !!s.tables_enabled,
      kitchen:     !!s.kitchen_display
    },
    branding: {
      logo:    s.logo_url || null,
      cover:   s.cover_url || null,
      primary: s.theme_primary || '#ff5722',
      bg:      s.theme_bg || '#0a0806',
      tagline: s.tagline || null
    },
    locale: {
      currency:        s.default_currency || 'ZAR',
      currency_symbol: s.currency_symbol || 'R',
      default_lang:    s.default_language || 'en',
      languages:       s.enabled_languages || ['en']
    },
    google_review_url: s.google_review_url || null,
    plan:              s.plan || 'starter'
  });
}
