// GET /api/portal/menu-preview[?slug=<r>]
// Signed-in manager → { url, slug } where url is /m/<slug>?preview=1&portal_token=<tok>.
// menu.html uses the scoped manager token to show inactive/draft dishes and a
// PREVIEW MODE banner. Read-only (issues a short-lived token), so no auditLog.
import { supabaseAdmin } from '../../_db.js';
import { requireManager } from '../../_auth.js';
import { issueManagerToken } from './manager-token.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });
  const email = String(auth.email || '').toLowerCase();

  const wanted = req.query.slug;
  let rest = null;
  if (wanted) {
    const { data } = await supabaseAdmin.from('restaurants').select('id, slug, email').eq('slug', wanted).maybeSingle();
    rest = data;
  } else {
    const { data } = await supabaseAdmin.from('restaurants').select('id, slug, email').eq('email', email).order('slug').limit(1);
    rest = data && data[0];
    if (!rest) {
      const { data: tm } = await supabaseAdmin.from('manager_users').select('restaurant_id').eq('email', email).limit(1);
      if (tm && tm[0]) {
        const { data } = await supabaseAdmin.from('restaurants').select('id, slug, email').eq('id', tm[0].restaurant_id).maybeSingle();
        rest = data;
      }
    }
  }
  if (!rest) return res.status(404).json({ error: 'no_restaurant_linked' });

  let allowed = String(rest.email || '').toLowerCase() === email;
  if (!allowed) {
    const { data: tm } = await supabaseAdmin.from('manager_users').select('id')
      .eq('restaurant_id', rest.id).eq('email', email).maybeSingle();
    allowed = !!tm;
  }
  if (!allowed) return res.status(403).json({ error: 'not_your_restaurant' });

  const tok = issueManagerToken(rest.id, 1);
  return res.status(200).json({
    slug: rest.slug,
    url: `/m/${encodeURIComponent(rest.slug)}?preview=1&portal_token=${encodeURIComponent(tok)}`
  });
}
