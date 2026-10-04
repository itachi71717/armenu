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

  // Single round-trip: join restaurants + restaurant_settings.
  let restaurant, s = {};
  try {
    const { data, error } = await supabase.raw(`
      select r.id, r.slug, r.name,
             rs.orders_enabled, rs.waiter_call_enabled, rs.reviews_enabled,
             rs.tables_enabled, rs.kitchen_display, rs.logo_url, rs.cover_url,
             rs.theme_primary, rs.theme_bg, rs.tagline, rs.default_currency,
             rs.currency_symbol, rs.default_language, rs.enabled_languages,
             rs.google_review_url, rs.plan
      from restaurants r
      left join restaurant_settings rs on rs.restaurant_id = r.id
      where r.slug = $1
      limit 1
    `, [r]);
    if (error && !isMissingTable(error)) return res.status(404).json({ error: 'Restaurant not found' });
    const row = data?.[0];
    if (!row) return res.status(404).json({ error: 'Restaurant not found' });
    restaurant = { id: row.id, slug: row.slug, name: row.name };
    s = row;
  } catch (e) {
    // If restaurant_settings table doesn't exist, fall back to restaurants-only lookup.
    if (!isMissingTable(e)) throw e;
    const { data: r2, error: rerr } = await supabase
      .from('restaurants').select('id, slug, name').eq('slug', r).single();
    if (rerr || !r2) return res.status(404).json({ error: 'Restaurant not found' });
    restaurant = r2;
  }

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
