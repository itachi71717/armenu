// POST /api/admin/bulk-import
//   { slug, csv_text, preview?:true, category_map? }
// Columns (case-insensitive): Name, Price, Description, Category, Allergens, Dietary
// preview:true -> { parsed:[{name, price_cents, category, warnings:[]}], errors:[] } (no writes)
// otherwise    -> inserts validated rows, auto-creating missing categories.
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const MAX_ROWS = 200;
const PLACEHOLDER_GLB = 'https://armenu.co.za/vendor/models/dish.glb';
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// Minimal CSV parser: quotes, escaped quotes, CRLF/LF, delimiter sniffed from header (comma, semicolon, tab).
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

function parsePriceCents(s) {
  let t = String(s == null ? '' : s).trim().replace(/[Rr]\s*/, '').replace(/\s/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
const fmtPrice = c => 'R' + (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));
const tags = s => String(s || '').split(/[|;/,]/).map(x => x.trim().toLowerCase()).filter(Boolean);

export function analyse(csv_text) {
  const errors = [], parsed = [];
  const table = parseCsv(csv_text);
  if (!table.length) { errors.push('CSV is empty'); return { parsed, errors }; }
  const header = table[0].map(h => String(h).trim().toLowerCase());
  const idx = k => header.indexOf(k);
  const col = { name: idx('name'), price: idx('price'), description: idx('description'), category: idx('category'), allergens: idx('allergens'), dietary: idx('dietary') };
  if (col.name < 0) errors.push('Missing required column: Name');
  if (col.price < 0) errors.push('Missing required column: Price');
  if (errors.length) return { parsed, errors };
  let body = table.slice(1);
  if (body.length > MAX_ROWS) {
    errors.push(`Too many rows (${body.length}); max ${MAX_ROWS} per import. Only the first ${MAX_ROWS} are used.`);
    body = body.slice(0, MAX_ROWS);
  }
  const seen = new Set();
  body.forEach((r, i) => {
    const get = k => col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : '';
    const line = i + 2, warnings = [];
    const name = get('name').slice(0, 120);
    if (!name) { errors.push(`Row ${line}: name is empty, skipped`); return; }
    const price_cents = parsePriceCents(get('price'));
    if (price_cents == null) { errors.push(`Row ${line} (${name}): invalid price "${get('price')}", skipped`); return; }
    if (price_cents < 100 || price_cents > 1000000) { errors.push(`Row ${line} (${name}): price must be between R1 and R10000, skipped`); return; }
    const category = get('category') || 'Uncategorised';
    if (!get('category')) warnings.push('No category, will use "Uncategorised"');
    if (seen.has(name.toLowerCase())) warnings.push('Duplicate name in file');
    seen.add(name.toLowerCase());
    if (!get('description')) warnings.push('No description');
    parsed.push({ name, price_cents, category, description: get('description').slice(0, 500), allergens: tags(get('allergens')), dietary: tags(get('dietary')), warnings });
  });
  return { parsed, errors };
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  body = body || {};
  const slug = body.slug || req.query.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (typeof body.csv_text !== 'string' || !body.csv_text.trim()) return res.status(400).json({ error: 'csv_text required' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const { parsed, errors } = analyse(body.csv_text);
  if (body.preview) {
    return res.status(200).json({
      parsed: parsed.map(p => ({ name: p.name, price_cents: p.price_cents, category: p.category, warnings: p.warnings })),
      errors
    });
  }
  if (!parsed.length) return res.status(400).json({ error: 'No valid rows to import', errors });

  // Optional category_map: { "csv category": "existing or new category name" }
  const cmap = body.category_map && typeof body.category_map === 'object' ? body.category_map : {};
  const { data: cats = [] } = await supabase.from('categories').select('id, name, slug, sort_order').eq('restaurant_id', r.id);
  const byName = new Map((cats || []).map(c => [String(c.name).trim().toLowerCase(), c]));
  const usedCatSlugs = new Set((cats || []).map(c => c.slug));
  let nextSort = Math.max(0, ...(cats || []).map(c => c.sort_order || 0)) + 1;
  const { data: taken = [] } = await supabase.from('dishes').select('slug').eq('restaurant_id', r.id);
  const usedDish = new Set((taken || []).map(x => x.slug));

  let created = 0, catsCreated = 0;
  const failed = [];
  for (const p of parsed) {
    const catName = String(cmap[p.category] || p.category).trim();
    let cat = byName.get(catName.toLowerCase());
    if (!cat) {
      let cs = slugify(catName) || 'cat-' + Date.now().toString(36);
      while (usedCatSlugs.has(cs)) cs = cs.slice(0, 44) + '-' + Math.random().toString(36).slice(2, 5);
      const { data: nc, error: ce } = await supabaseAdmin.from('categories').insert({ restaurant_id: r.id, name: catName, slug: cs, sort_order: nextSort++ }).select().single();
      if (ce || !nc) { failed.push(`${p.name}: category failed (${ce?.message || 'unknown'})`); continue; }
      cat = nc; byName.set(catName.toLowerCase(), nc); usedCatSlugs.add(cs); catsCreated++;
    }
    let ds = slugify(p.name) || 'dish';
    if (usedDish.has(ds)) { let n = 2; while (usedDish.has(ds.slice(0, 44) + '-' + n)) n++; ds = ds.slice(0, 44) + '-' + n; }
    const { error } = await supabaseAdmin.from('dishes').insert({
      restaurant_id: r.id, slug: ds, name: p.name,
      price: fmtPrice(p.price_cents), price_cents: p.price_cents,
      description: p.description || null,
      allergens: p.allergens.length ? p.allergens.join(',') : null,
      glb_url: PLACEHOLDER_GLB, ar_source: 'upload', scale: 1,
      // dishes has no dietary column; keep tags in a non-language jsonb key (ignored by the language switcher)
      modifiers: [], translations: p.dietary.length ? { _meta: { dietary: p.dietary } } : {},
      category_id: cat.id, active: true
    });
    if (error) failed.push(`${p.name}: ${error.message}`);
    else { usedDish.add(ds); created++; }
  }
  auditLog(req, r.id, 'bulk_import', { target: slug, metadata: { count: created, categories_created: catsCreated, failed: failed.length } }).catch(() => {});
  return res.status(200).json({ ok: true, count: created, categories_created: catsCreated, errors: errors.concat(failed) });
}
