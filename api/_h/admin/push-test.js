// POST /api/admin/push-test?slug=<r>
// Sends a "ARMenu test — push is working" notification to every subscription
// registered under this restaurant. Master admin OR scoped manager token only.
import { supabase } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { sendPush } from '../push/_send.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const scopeRid = getScopedRestaurantId(req);
  let rid = scopeRid;
  if (!rid) {
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return res.status(404).json({ error: 'not found' });
    rid = r.id;
  }
  const result = await sendPush(rid, {
    title: 'ARMenu test 🔔',
    body: 'Push notifications are working on this device.',
    url: '/portal/',
    tag: 'test-' + Math.random().toString(36).slice(2, 8)
  });
  auditLog(req, rid, 'push.test', { metadata: result }).catch(() => {});
  return res.status(200).json(result);
}
