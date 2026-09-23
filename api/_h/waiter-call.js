// POST /api/waiter-call  { r, table?, reason? }
// Public — gated by restaurant_settings.waiter_call_enabled.
import { supabase } from '../_db.js';

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

  await supabase.from('waiter_calls').insert({
    restaurant_id: restaurant.id,
    table_id, table_label,
    reason: String(reason || 'help').slice(0, 40)
  });

  return res.status(200).json({ ok: true });
}
