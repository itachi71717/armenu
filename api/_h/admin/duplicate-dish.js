// POST /api/admin/duplicate-dish?id=<dish_id>&slug=<restaurant_slug>
// Clones a dish (modifiers, allergens, dietary, category, station, price, media).
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  const { id, slug } = req.query;
  if (!id || !slug) return res.status(400).json({ error: 'id and slug required' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });
  const { data: src } = await supabase.from('dishes').select('*').eq('id', id).maybeSingle();
  if (!src || src.restaurant_id !== r.id) return res.status(404).json({ error: 'dish not found' });

  const row = { ...src };
  for (const k of ['id', 'created_at', 'updated_at']) delete row[k];
  // Guarantee a unique slug within the restaurant (unique(restaurant_id, slug)).
  const { data: existing } = await supabase.from('dishes').select('slug').eq('restaurant_id', r.id);
  const taken = new Set((existing || []).map(x => x.slug));
  const baseSlug = String(src.slug || 'dish').replace(/-copy-[a-z0-9]+$/, '').slice(0, 38);
  let slugCandidate;
  do { slugCandidate = baseSlug + '-copy-' + Math.random().toString(36).slice(2, 6); } while (taken.has(slugCandidate));
  row.slug = slugCandidate;
  row.name = String(src.name || 'Dish').replace(/ \(copy\)$/, '') + ' (copy)';
  row.restaurant_id = r.id;
  const { data, error } = await supabaseAdmin.from('dishes').insert(row).select().single();
  if (error) return res.status(400).json({ error: error.message });
  auditLog(req, r.id, 'dish.duplicate', { target: data?.slug, metadata: { source_id: id, source_slug: src.slug } }).catch(() => {});
  return res.status(201).json(data);
}
