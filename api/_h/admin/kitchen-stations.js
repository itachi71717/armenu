// Kitchen stations: GET ?slug= list | POST {slug,name,is_expo?,sort_order?} | PATCH ?id=&slug= | DELETE ?id=&slug=
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

function parseBody(req) {
  try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}; } catch { return {}; }
}
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).end();
  const body = req.method === 'POST' || req.method === 'PATCH' ? parseBody(req) : {};
  const slug = req.query?.slug || body.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  if (req.method === 'GET') {
    const { data = [] } = await supabase.from('kitchen_stations')
      .select('*').eq('restaurant_id', r.id).order('sort_order');
    return res.status(200).json({ stations: data });
  }

  if (req.method === 'POST') {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name required' });
    const stSlug = slugify(body.station_slug || name);
    if (!stSlug) return res.status(400).json({ error: 'invalid name' });
    const { data, error } = await supabaseAdmin.from('kitchen_stations').insert({
      restaurant_id: r.id, name, slug: stSlug,
      is_expo: !!body.is_expo, sort_order: parseInt(body.sort_order) || 0
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'station.create', { target: name }).catch(() => {});
    return res.status(200).json({ station: data });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  const { data: row } = await supabase.from('kitchen_stations')
    .select('id, restaurant_id, name').eq('id', id).maybeSingle();
  if (!row || row.restaurant_id !== r.id) return res.status(404).json({ error: 'not found' });

  if (req.method === 'PATCH') {
    const patch = {};
    if ('name' in body) {
      const n = String(body.name).trim().slice(0, 80);
      if (!n) return res.status(400).json({ error: 'name required' });
      patch.name = n;
    }
    if ('is_expo' in body) patch.is_expo = !!body.is_expo;
    if ('sort_order' in body) patch.sort_order = parseInt(body.sort_order) || 0;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const { error } = await supabaseAdmin.from('kitchen_stations').update(patch).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    auditLog(req, r.id, 'station.update', { target: row.name || id, metadata: { fields: Object.keys(patch) } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  // DELETE (dishes.station_id is set null via FK)
  await supabaseAdmin.from('kitchen_stations').delete().eq('id', id);
  auditLog(req, r.id, 'station.delete', { target: row.name || id }).catch(() => {});
  return res.status(200).json({ ok: true });
}
