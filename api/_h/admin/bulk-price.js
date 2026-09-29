// POST /api/admin/bulk-price
//   { slug, adjustment: { type:'percent'|'fixed', value:number, target:'all'|<category_id> } }
// percent: +10 => +10%. fixed: value in cents. Results clamped to R1..R10000.
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const MIN_CENTS = 100, MAX_CENTS = 1000000;
const fmtPrice = c => 'R' + (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  body = body || {};
  const slug = body.slug || req.query.slug;
  const adj = body.adjustment || {};
  const value = Number(adj.value);
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (!['percent', 'fixed'].includes(adj.type)) return res.status(400).json({ error: "adjustment.type must be 'percent' or 'fixed'" });
  if (!Number.isFinite(value) || value === 0) return res.status(400).json({ error: 'adjustment.value must be a non-zero number' });
  if (adj.type === 'percent' && (value < -90 || value > 500)) return res.status(400).json({ error: 'percent must be between -90 and 500' });
  const target = adj.target || 'all';

  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  let q = supabase.from('dishes').select('id, price_cents, category_id').eq('restaurant_id', r.id);
  if (target !== 'all') q = q.eq('category_id', target);
  const { data: dishes = [] } = await q;

  let affected = 0, clamped = 0, skipped = 0;
  for (const d of dishes || []) {
    if (d.price_cents == null || !Number.isFinite(d.price_cents)) { skipped++; continue; }
    const raw = adj.type === 'percent' ? Math.round(d.price_cents * (1 + value / 100)) : Math.round(d.price_cents + value);
    const next = Math.max(MIN_CENTS, Math.min(MAX_CENTS, raw));
    if (next !== raw) clamped++;
    if (next === d.price_cents) continue;
    const { error } = await supabaseAdmin.from('dishes').update({ price_cents: next, price: fmtPrice(next) }).eq('id', d.id);
    if (!error) affected++;
  }
  auditLog(req, r.id, 'bulk_price', { target: slug, metadata: { adjustment: { type: adj.type, value, target }, affected, clamped } }).catch(() => {});
  return res.status(200).json({ ok: true, affected, clamped, skipped });
}
