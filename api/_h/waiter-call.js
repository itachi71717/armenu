// POST /api/waiter-call  { r, table?, reason? }
// Public — gated by restaurant_settings.waiter_call_enabled.
import { supabase } from '../_db.js';
import { sendPush } from './push/_send.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { r, table, reason } = body || {};
  if (!r) return res.status(400).json({ error: 'Missing r' });

  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', r).single();
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  const { data: s } = await supabase.from('restaurant_settings')
    .select('waiter_call_enabled').eq('restaurant_id', restaurant.id).maybeSingle();
  if (!s?.waiter_call_enabled) return res.status(403).json({ error: 'Waiter-call is not enabled' });

  let table_id = null, table_label = table || null;
  if (table) {
    const { data: t } = await supabase.from('restaurant_tables')
      .select('id, label').eq('restaurant_id', restaurant.id).eq('label', table).maybeSingle();
    if (t) { table_id = t.id; table_label = t.label; }
  }

  // Anti-spam: dedup by (restaurant_id, table_label) within a 60s window,
  // and cap total open calls per restaurant to 5 per minute. Without this,
  // a guest hammering the button (or an attacker) can push-storm every
  // staff device.
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  if (table_label) {
    const { data: recent = [] } = await supabase.from('waiter_calls')
      .select('id').eq('restaurant_id', restaurant.id).eq('table_label', table_label)
      .gte('created_at', oneMinAgo).limit(1);
    if (recent.length) {
      return res.status(200).json({ ok: true, deduped: true, message: 'A waiter is already on their way to your table.' });
    }
  }
  const { data: perRest = [] } = await supabase.from('waiter_calls')
    .select('id').eq('restaurant_id', restaurant.id).gte('created_at', oneMinAgo);
  if (perRest.length >= 5) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited', message: 'Too many calls right now. A waiter is on their way.' });
  }

  await supabase.from('waiter_calls').insert({
    restaurant_id: restaurant.id,
    table_id, table_label,
    reason: String(reason || 'help').slice(0, 40)
  });

  sendPush(restaurant.id, {
    title: 'Guest calling waiter',
    body: table_label ? `Table ${table_label}${reason ? ' · ' + reason : ''}` : (reason || 'Help requested'),
    url: '/staff/',
    tag: 'call-' + Math.random().toString(36).slice(2, 8)
  }).catch(() => {});

  return res.status(200).json({ ok: true });
}
