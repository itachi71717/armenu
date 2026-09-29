// POST   /api/admin/dishes                    → create dish
// PATCH  /api/admin/dishes?id=<id>            → { name?, price?, scale?, active?, thumb_url?, glb_url?, usdz_url?, description?, category_id?, camera_orbit? }
// DELETE /api/admin/dishes?id=<id>
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

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
    const { restaurant_slug, name, price, glb_url, usdz_url, thumb_url, camera_orbit, description, scale, ar_source, stock_count, modifiers, translations, category_id, station_id } = body;
    if (!restaurant_slug || !name || !glb_url) return res.status(400).json({ error: 'restaurant_slug, name, and glb_url required' });

    const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', restaurant_slug).single();
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const postGuard = assertScope(req, restaurant.id);
    if (postGuard) return res.status(postGuard.status).json({ error: postGuard.error });

    // Kitchen station must belong to the same restaurant (never trust a client-supplied id).
    let stationId = null;
    if (station_id) {
      const { data: st } = await supabase.from('kitchen_stations').select('id, restaurant_id').eq('id', station_id).maybeSingle();
      if (!st || st.restaurant_id !== restaurant.id) return res.status(400).json({ error: 'invalid station_id' });
      stationId = st.id;
    }

    // dishes are unique on (restaurant_id, slug): two "Burger"s used to fail with a raw Postgres
    // duplicate-key message. Pick the next free suffix instead.
    let dishSlug = slugify(name);
    {
      const { data: taken = [] } = await supabase.from('dishes').select('slug').eq('restaurant_id', restaurant.id);
      const used = new Set((taken || []).map(x => x.slug));
      if (used.has(dishSlug)) {
        let n = 2;
        while (used.has(dishSlug.slice(0, 44) + '-' + n)) n++;
        dishSlug = dishSlug.slice(0, 44) + '-' + n;
      }
    }
    const dishRowIn = {
      restaurant_id: restaurant.id,
      slug: dishSlug,
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
      station_id: stationId,
      active: true
    };
    // inventory_enabled gates the stock countdown in order.js (default false at the DB).
    // Falls back to the legacy insert if the column has not been migrated yet.
    const wantsTrack = 'inventory_enabled' in body ? !!body.inventory_enabled : (stock_count != null && stock_count !== '');
    let { data, error } = await supabaseAdmin.from('dishes').insert({ ...dishRowIn, inventory_enabled: wantsTrack }).select().single();
    if (error && /inventory_enabled/i.test(String(error.message || ''))) {
      ({ data, error } = await supabaseAdmin.from('dishes').insert(dishRowIn).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, restaurant.id, 'dish.create', { target: data?.slug || name, metadata: { price_cents: parseCents(price), ar_source } }).catch(() => {});
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
    // Resolve owner FIRST so a scoped token can't touch a dish from a
    // restaurant that isn't theirs just by guessing the UUID.
    const { data: dishRow } = await supabase.from('dishes').select('restaurant_id, slug').eq('id', id).maybeSingle();
    if (!dishRow) return res.status(404).json({ error: 'dish not found' });
    const guard = assertScope(req, dishRow.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = {};
    for (const k of ['name','price','description','glb_url','usdz_url','thumb_url','camera_orbit','active','category_id','allergens','stock_count','modifiers','translations','sort_order']) {
      if (k in body) patch[k] = body[k];
    }
    if ('station_id' in body) {
      if (body.station_id) {
        const { data: st } = await supabase.from('kitchen_stations').select('id, restaurant_id').eq('id', body.station_id).maybeSingle();
        if (!st || st.restaurant_id !== dishRow.restaurant_id) return res.status(400).json({ error: 'invalid station_id' });
        patch.station_id = st.id;
      } else patch.station_id = null;
    }
    if ('price' in body) patch.price_cents = parseCents(body.price);
    if ('scale' in body) patch.scale = Math.max(0.1, Math.min(5, parseFloat(body.scale) || 1));
    // Stock tracking flag: explicit inventory_enabled wins; otherwise setting a stock_count turns it on.
    if ('inventory_enabled' in body) patch.inventory_enabled = !!body.inventory_enabled;
    else if ('stock_count' in body) patch.inventory_enabled = body.stock_count != null && body.stock_count !== '';
    let upd = await supabaseAdmin.from('dishes').update(patch).eq('id', id);
    if (upd && upd.error && 'inventory_enabled' in patch && /inventory_enabled/i.test(String(upd.error.message || ''))) {
      delete patch.inventory_enabled;   // column not migrated yet
      await supabaseAdmin.from('dishes').update(patch).eq('id', id);
    }
    auditLog(req, dishRow.restaurant_id, 'dish.update', { target: dishRow.slug || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = await resolveDishId();
    if (!id) return res.status(404).json({ error: 'dish not found' });
    const { data: dishRow } = await supabase.from('dishes').select('restaurant_id, slug').eq('id', id).maybeSingle();
    if (!dishRow) return res.status(404).json({ error: 'dish not found' });
    const guard = assertScope(req, dishRow.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await supabaseAdmin.from('dishes').delete().eq('id', id);
    auditLog(req, dishRow.restaurant_id, 'dish.delete', { target: dishRow.slug || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
