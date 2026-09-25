// POST   /api/admin/dishes                    → create dish
// PATCH  /api/admin/dishes?id=<id>            → { name?, price?, scale?, active?, thumb_url?, glb_url?, usdz_url?, description?, category_id?, camera_orbit? }
// DELETE /api/admin/dishes?id=<id>
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

const slugify = s => String(s || 'dish').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'dish';
const parseCents = s => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const { restaurant_slug, name, price, glb_url, usdz_url, thumb_url, camera_orbit, description, scale, ar_source, stock_count, modifiers, translations, category_id } = body;
    if (!restaurant_slug || !name || !glb_url) return res.status(400).json({ error: 'restaurant_slug, name, and glb_url required' });

    const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', restaurant_slug).single();
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const { data, error } = await supabaseAdmin.from('dishes').insert({
      restaurant_id: restaurant.id,
      slug: slugify(name),
      name,
      price: price || null,
      price_cents: parseCents(price),
      description: description || null,
      glb_url, usdz_url: usdz_url || null, thumb_url: thumb_url || null, camera_orbit: camera_orbit || null,
      scale: scale != null ? parseFloat(scale) : 1,
      ar_source: ar_source || 'upload',
      stock_count: stock_count == null || stock_count === '' ? null : Math.max(0, parseInt(stock_count)),
      modifiers: Array.isArray(modifiers) ? modifiers : [],
      translations: translations && typeof translations === 'object' ? translations : {},
      category_id: category_id || null,
      active: true
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(data);
  }

  // Resolve target dish id — either directly from ?id=<uuid> OR by
  // (restaurant_slug + dish_slug) which is what the portal manager UI uses.
  async function resolveDishId() {
    if (req.query.id) return req.query.id;
    const restSlug = req.query.slug;
    const dishSlug = req.query.dish_slug;
    if (!restSlug || !dishSlug) return null;
    const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', restSlug).maybeSingle();
    if (!rest) return null;
    const { data: d } = await supabase.from('dishes').select('id').eq('restaurant_id', rest.id).eq('slug', dishSlug).maybeSingle();
    return d?.id || null;
  }

  if (req.method === 'PATCH') {
    const id = await resolveDishId();
    if (!id) return res.status(404).json({ error: 'dish not found' });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = {};
    for (const k of ['name','price','description','glb_url','usdz_url','thumb_url','camera_orbit','active','category_id','allergens','stock_count','modifiers','translations','sort_order']) {
      if (k in body) patch[k] = body[k];
    }
    if ('price' in body) patch.price_cents = parseCents(body.price);
    if ('scale' in body) patch.scale = Math.max(0.1, Math.min(5, parseFloat(body.scale) || 1));
    await supabaseAdmin.from('dishes').update(patch).eq('id', id);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = await resolveDishId();
    if (!id) return res.status(404).json({ error: 'dish not found' });
    await supabaseAdmin.from('dishes').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
