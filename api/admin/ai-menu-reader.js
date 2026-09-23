// POST /api/admin/ai-menu-reader  { pdf_url | image_url, slug }
// Sends a menu PDF/image to Claude Vision, returns structured dishes as JSON.
// Optionally bulk-inserts into the restaurant's `dishes` table (body.insert = true).
// Requires env: ANTHROPIC_API_KEY
import { supabase, supabaseAdmin } from '../_db.js';
import { requireAdmin } from '../_auth.js';

const MODEL = 'claude-opus-4-7';
const SYS = `You are extracting a restaurant menu from an image or PDF. Return STRICT JSON only, no prose.
Schema:
{
  "categories": ["Starters", "Mains", ...],
  "dishes": [
    { "name": "string", "category": "one of the categories above", "price": "string, keep the currency symbol as printed", "description": "string, may be empty" }
  ]
}
Rules:
- Include every dish visible.
- Preserve prices exactly as printed (e.g. "R 129", "€12.50").
- Category is the section header the dish appears under; if unsure, "Menu".
- If a dish has no description, use "".
- Output nothing except the JSON object.`;

async function claude(content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYS,
      messages: [{ role: 'user', content }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
  const text = data.content?.[0]?.text || '';
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const parseCents = s => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { slug, image_url, pdf_url, insert } = body;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  if (!image_url && !pdf_url) return res.status(400).json({ error: 'image_url or pdf_url required' });

  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
  if (!restaurant) return res.status(404).json({ error: 'restaurant not found' });

  try {
    const content = [];
    if (image_url) content.push({ type: 'image', source: { type: 'url', url: image_url } });
    if (pdf_url) content.push({ type: 'document', source: { type: 'url', url: pdf_url } });
    content.push({ type: 'text', text: 'Extract this menu. Output the JSON only.' });

    const parsed = await claude(content);
    if (!parsed || !Array.isArray(parsed.dishes)) throw new Error('AI did not return a valid menu');

    let inserted = { categories: 0, dishes: 0 };
    if (insert) {
      // Insert categories first
      const catMap = {};
      for (const name of parsed.categories || []) {
        const cs = slugify(name);
        const { data } = await supabaseAdmin.from('categories').upsert(
          { restaurant_id: restaurant.id, name, slug: cs, active: true },
          { onConflict: 'restaurant_id,slug' }
        ).select().single();
        if (data) { catMap[name] = data.id; inserted.categories++; }
      }
      // Insert dishes (glb_url required by NOT NULL — use placeholder, admin uploads later)
      const rows = parsed.dishes.map(d => ({
        restaurant_id: restaurant.id,
        slug: slugify(d.name) + '-' + Math.random().toString(36).slice(2, 6),
        name: d.name,
        price: d.price || null,
        price_cents: parseCents(d.price),
        description: d.description || null,
        glb_url: 'PENDING',            // sentinel — admin uploads or AI-generates the .glb next
        category_id: catMap[d.category] || null,
        active: false                  // hidden until a real .glb is attached
      }));
      if (rows.length) {
        await supabaseAdmin.from('dishes').insert(rows);
        inserted.dishes = rows.length;
      }
    }
    return res.status(200).json({ menu: parsed, inserted });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
