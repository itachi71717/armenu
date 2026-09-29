// GET /api/customer/loyalty?token=<>&r=<slug>
//   -> { enabled, threshold, stamps_current, stamps_needed, reward_value_cents, ready_to_redeem }
// GET /api/customer/loyalty?token=<>   (no r)
//   -> { restaurants: [{ slug, name, ...same fields }] } for every restaurant with stamps
// Redemption is requested per order via `redeem_loyalty: true` in POST /api/order.
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

export const DEFAULT_THRESHOLD = 10;
export const DEFAULT_REWARD_CENTS = 10000;

export function loyaltyConfig(s) {
  const threshold = Math.max(1, parseInt(s?.loyalty_threshold) || DEFAULT_THRESHOLD);
  const reward = s?.loyalty_reward_cents == null ? DEFAULT_REWARD_CENTS : Math.max(0, parseInt(s.loyalty_reward_cents) || 0);
  return { enabled: s?.loyalty_enabled !== false, threshold, reward_value_cents: reward };
}

export function loyaltyStatus(cfg, count) {
  return {
    enabled: cfg.enabled,
    threshold: cfg.threshold,
    stamps_current: Math.min(count, cfg.threshold),
    stamps_needed: Math.max(0, cfg.threshold - count),
    reward_value_cents: cfg.reward_value_cents,
    ready_to_redeem: cfg.enabled && count >= cfg.threshold && cfg.reward_value_cents > 0
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const token = String(req.query?.token || '');
  const slug = req.query?.r ? String(req.query.r).slice(0, 80) : '';
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });

  const cust = await resolveCustomerRowByToken(token);
  if (!cust) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-store');

  if (slug) {
    const { data: rest } = await supabase.from('restaurants').select('id, name').eq('slug', slug).maybeSingle();
    if (!rest) return res.status(404).json({ error: 'restaurant_not_found' });
    const { data: s } = await supabase.from('restaurant_settings')
      .select('loyalty_threshold, loyalty_reward_cents, loyalty_enabled').eq('restaurant_id', rest.id).maybeSingle();
    const cfg = loyaltyConfig(s);
    const { data: rows } = await supabase.raw(
      'select count(*)::int as n from loyalty_stamps where customer_id = $1 and restaurant_id = $2', [cust.id, rest.id]);
    return res.status(200).json({ slug, name: rest.name, ...loyaltyStatus(cfg, rows?.[0]?.n || 0) });
  }

  const { data: grouped } = await supabase.raw(
    'select restaurant_id, count(*)::int as n from loyalty_stamps where customer_id = $1 group by restaurant_id', [cust.id]);
  const ids = (grouped || []).map(g => g.restaurant_id);
  if (!ids.length) return res.status(200).json({ restaurants: [] });
  const [{ data: rests = [] }, { data: sets = [] }] = await Promise.all([
    supabase.from('restaurants').select('id, slug, name').in('id', ids),
    supabase.from('restaurant_settings').select('restaurant_id, loyalty_threshold, loyalty_reward_cents, loyalty_enabled').in('restaurant_id', ids)
  ]);
  const setBy = Object.fromEntries((sets || []).map(x => [x.restaurant_id, x]));
  const out = (rests || []).map(rt => {
    const n = grouped.find(g => g.restaurant_id === rt.id)?.n || 0;
    return { slug: rt.slug, name: rt.name, ...loyaltyStatus(loyaltyConfig(setBy[rt.id]), n) };
  }).filter(x => x.enabled);
  return res.status(200).json({ restaurants: out });
}
