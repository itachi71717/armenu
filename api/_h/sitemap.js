// GET /sitemap.xml (rewritten) — dynamic sitemap: marketing pages + every restaurant menu.
import { supabase } from '../_db.js';

const BASE = 'https://armenu.co.za';
const PAGES = [
  ['/', 'weekly', '1.0'],
  ['/how.html', 'monthly', '0.8'],
  ['/why.html', 'monthly', '0.8'],
  ['/dishes.html', 'weekly', '0.8'],
  ['/discover', 'daily', '0.7'],
  ['/faq.html', 'monthly', '0.7'],
  ['/plans.html', 'monthly', '0.8'],
  ['/contact.html', 'monthly', '0.9'],
  ['/status', 'daily', '0.3'],
  ['/legal.html', 'yearly', '0.3']
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export default async function handler(req, res) {
  let slugs = [];
  try {
    const q = await supabase.from('restaurants').select('slug').limit(5000);
    if (!q.error && Array.isArray(q.data)) slugs = q.data.map(r => r.slug).filter(Boolean);
  } catch {}

  const urls = PAGES.map(([p, cf, pr]) =>
    `  <url><loc>${BASE}${p}</loc><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`);
  for (const s of slugs) {
    urls.push(`  <url><loc>${BASE}/m/${esc(encodeURIComponent(s))}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600');
  res.status(200).send(xml);
}
