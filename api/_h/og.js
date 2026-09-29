// GET /api/og?r=<slug> — 1200x630 SVG social card. Pure SVG, no image libs.
import { supabase } from '../_db.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function safeColor(c, fallback) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(c || '').trim()) ? String(c).trim() : fallback;
}

// Greedy word-wrap into at most maxLines lines.
function wrap(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,1}$/, '…');
  }
  return lines;
}

export default async function handler(req, res) {
  const slug = String(req.query.r || '').slice(0, 80);
  let name = 'ARMenu';
  let tagline = 'See every dish in augmented reality';
  let primary = '#d4a574';
  let bg = '#0a0806';

  if (slug) {
    try {
      const rq = await supabase.from('restaurants').select('id, name').eq('slug', slug).maybeSingle();
      if (rq.data) {
        name = rq.data.name || name;
        tagline = 'View the menu in augmented reality';
        try {
          const sq = await supabase.from('restaurant_settings').select('*').eq('restaurant_id', rq.data.id).maybeSingle();
          const s = sq.data || {};
          if (s.tagline) tagline = s.tagline;
          primary = safeColor(s.theme_primary, primary);
          bg = safeColor(s.theme_bg, bg);
        } catch {}
      }
    } catch {}
  }

  const nameLines = wrap(name, 22, 3);
  const size = nameLines.length > 2 ? 84 : nameLines.length > 1 ? 100 : 120;
  const lh = size * 1.1;
  const startY = 270 - ((nameLines.length - 1) * lh) / 2;
  const nameSvg = nameLines.map((l, i) =>
    `<text x="90" y="${Math.round(startY + i * lh)}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${size}" fill="#f5efe6">${esc(l)}</text>`).join('');
  const tagLines = wrap(tagline, 52, 2);
  const tagY = Math.round(startY + (nameLines.length - 1) * lh + 80);
  const tagSvg = tagLines.map((l, i) =>
    `<text x="90" y="${tagY + i * 44}" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#c9c1b4">${esc(l)}</text>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#000"/></linearGradient>
<radialGradient id="glow" cx="0.85" cy="0.1" r="0.8"><stop offset="0" stop-color="${primary}" stop-opacity="0.45"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1200" height="630" fill="url(#g)"/>
<rect width="1200" height="630" fill="url(#glow)"/>
<rect x="90" y="90" width="120" height="8" rx="4" fill="${primary}"/>
${nameSvg}
${tagSvg}
<text x="1110" y="570" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="30" letter-spacing="4" fill="${primary}">ARMENU</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(svg);
}
