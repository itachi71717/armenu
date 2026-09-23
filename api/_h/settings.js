// GET /api/settings?r=<restaurant-slug>
// Public — used by the guest menu to know which optional modules are enabled
// (orders, waiter-call, reviews, tables), plus branding + currency + languages.

import { supabase } from '../_db.js';

export default async function handler(req, res) {
  const { r } = req.query;
  if (!r) return res.status(400).json({ error: 'Missing r param' });

  const { data: restaurant, error: rerr } = await supabase
    .from('restaurants').select('id, slug, name').eq('slug', r).single();
  if (rerr || !restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  const { data: s } = await supabase
    .from('restaurant_settings').select('*').eq('restaurant_id', restaurant.id).maybeSingle();

  // Fall back to defaults if no row (older restaurants)
  const settings = s || {};
  return res.status(200).json({
    restaurant: { slug: restaurant.slug, name: restaurant.name },
    features: {
      orders:       !!settings.orders_enabled,
      waiter_call:  !!settings.waiter_call_enabled,
      reviews:      settings.reviews_enabled !== false,
      tables:       !!settings.tables_enabled,
      kitchen:      !!settings.kitchen_display
    },
    branding: {
      logo:    settings.logo_url || null,
      cover:   settings.cover_url || null,
      primary: settings.theme_primary || '#ff5722',
      bg:      settings.theme_bg || '#0a0806',
      tagline: settings.tagline || null
    },
    locale: {
      currency:        settings.default_currency || 'ZAR',
      currency_symbol: settings.currency_symbol || 'R',
      default_lang:    settings.default_language || 'en',
      languages:       settings.enabled_languages || ['en']
    },
    google_review_url: settings.google_review_url || null,
    plan:              settings.plan || 'starter'
  });
}
