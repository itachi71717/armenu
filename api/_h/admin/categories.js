// GET    /api/admin/categories?slug=<r>       → list
// POST   /api/admin/categories?slug=<r>       → create { name, sort_order? }
// PATCH  /api/admin/categories?id=<id>        → { name?, sort_order?, active? }
// DELETE /api/admin/categories?id=<id>
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const gGet = assertScope(req, r.id);
    if (gGet) return res.status(gGet.status).json({ error: gGet.error });
    const { data = [] } = await supabase.from('categories')
      .select('*').eq('restaurant_id', r.id).order('sort_order').order('name');
    return res.status(200).json({ categories: data });
  }

  if (req.method === 'POST') {
    const { slug } = req.query;
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
    if (!r) return res.status(404).json({ error: 'not found' });
    const gPost = assertScope(req, r.id);
    if (gPost) return res.status(gPost.status).json({ error: gPost.error });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    body = body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const s = slugify(name) || 'cat-' + Date.now().toString(36);
    const { data: catRows = [] } = await supabase.from('categories').select('name, slug').eq('restaurant_id', r.id);
    if ((catRows || []).some(c => c.slug === s || String(c.name).trim().toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'A category with that name already exists' });
    }
    const { data, error } = await supabaseAdmin.from('categories').insert({
      restaurant_id: r.id, name, slug: s, sort_order: body.sort_order || 0
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'category.create', { target: data?.name || name }).catch(() => {});
    return res.status(200).json({ category: data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    // Resolve row FIRST so scope guard can block cross-restaurant mutation
    const { data: row } = await supabase.from('categories').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    const patch = {};
    if ('name' in body) patch.name = String(body.name).trim();
    if ('sort_order' in body) patch.sort_order = parseInt(body.sort_order) || 0;
    if ('active' in body) patch.active = !!body.active;
    await supabaseAdmin.from('categories').update(patch).eq('id', id);
    auditLog(req, row.restaurant_id, 'category.update', { target: row.name || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { data: row } = await supabase.from('categories').select('restaurant_id, name').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, row.restaurant_id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await supabaseAdmin.from('categories').delete().eq('id', id);
    auditLog(req, row.restaurant_id, 'category.delete', { target: row.name || id }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
