// GET /api/customer/loyalty?token=<>&r=<slug>
//   -> { enabled, threshold, stamps_current, stamps_needed, reward_value_cents,
//        reward_dish: {slug,name,thumb_url,price_cents}|null, ready_to_redeem }
// GET /api/customer/loyalty?token=<>   (no r)
//   -> { restaurants: [{ slug, name, ...same fields }] } for every restaurant with stamps
// POST (manager/admin) { restaurant_slug, loyalty_opted_in, loyalty_threshold, loyalty_reward_dish_id }
//   -> saves the restaurant's loyalty settings (portal).
// Redemption is requested per order via `redeem_loyalty: true` in POST /api/order.
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

export const DEFAULT_THRESHOLD = 10;
export const DEFAULT_REWARD_CENTS = 10000;

export function loyaltyConfig(s) {
  const threshold = Math.max(1, parseInt(s?.loyalty_threshold) || DEFAULT_THRESHOLD);
  const reward = s?.loyalty_reward_cents == null ? DEFAULT_REWARD_CENTS : Math.max(0, parseInt(s.loyalty_reward_cents) || 0);
  // The restaurant must EXPLICITLY opt in (loyalty_opted_in = true). Off by default.
  return {
    enabled: s?.loyalty_opted_in === true,
    threshold,
    reward_value_cents: reward,
    reward_dish_id: s?.loyalty_reward_dish_id || null
  };
}

export function rewardDishInfo(dish) {
  if (!dish) return null;
  return { slug: dish.slug, name: dish.name, thumb_url: dish.thumb_url || null, price_cents: dish.price_cents ?? 0 };
}
export function rewardDishAvailable(dish) {
  return !!dish && dish.active !== false && !(typeof dish.stock_count === 'number' && dish.stock_count <= 0);
}

export function loyaltyStatus(cfg, count, dish = null) {
  const dishSet = !!cfg.reward_dish_id;
  const rewardOk = dishSet ? rewardDishAvailable(dish) : cfg.reward_value_cents > 0;
  return {
    enabled: cfg.enabled,
    threshold: cfg.threshold,
    stamps_current: Math.min(count, cfg.threshold),
    stamps_needed: Math.max(0, cfg.threshold - count),
    reward_value_cents: dishSet ? 0 : cfg.reward_value_cents,
    reward_dish: dishSet ? rewardDishInfo(dish) : null,
    ready_to_redeem: cfg.enabled && count >= cfg.threshold && rewardOk
  };
}

async function loadDishes(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.from('dishes')
    .select('id, slug, name, thumb_url, price_cents, price, active, stock_count').in('id', uniq);
  return Object.fromEntries((data || []).map(d => [d.id, d]));
}

async function saveSettings(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const slug = String(body?.restaurant_slug || '').slice(0, 80);
  if (!slug) return res.status(400).json({ error: 'restaurant_slug required' });
  const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'not_found' });
  const guard = assertScope(req, rest.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  const patch = { updated_at: new Date().toISOString() };
  if (body.loyalty_opted_in !== undefined) patch.loyalty_opted_in = body.loyalty_opted_in === true;
  if (body.loyalty_threshold !== undefined) {
    const t = parseInt(body.loyalty_threshold);
    if (!Number.isFinite(t) || t < 1 || t > 100) return res.status(400).json({ error: 'Threshold must be between 1 and 100' });
    patch.loyalty_threshold = t;
  }
  if (body.loyalty_reward_dish_id !== undefined) {
    const id = body.loyalty_reward_dish_id;
    if (id === null || id === '') patch.loyalty_reward_dish_id = null;
    else {
      const { data: d } = await supabase.from('dishes').select('id').eq('id', String(id)).eq('restaurant_id', rest.id).maybeSingle();
      if (!d) return res.status(400).json({ error: 'Reward dish not found' });
      patch.loyalty_reward_dish_id = d.id;
    }
  }
  const { data: existing } = await supabaseAdmin.from('restaurant_settings').select('restaurant_id').eq('restaurant_id', rest.id).maybeSingle();
  const r = existing
    ? await supabaseAdmin.from('restaurant_settings').update(patch).eq('restaurant_id', rest.id)
    : await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: rest.id, ...patch });
  if (r?.error) return res.status(500).json({ error: 'Could not save loyalty settings' });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'POST') return saveSettings(req, res);
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
      .select('loyalty_threshold, loyalty_reward_cents, loyalty_opted_in, loyalty_reward_dish_id').eq('restaurant_id', rest.id).maybeSingle();
    const cfg = loyaltyConfig(s);
    const dishMap = await loadDishes([cfg.reward_dish_id]);
    const { data: rows } = await supabase.raw(
      'select count(*)::int as n from loyalty_stamps where customer_id = $1 and restaurant_id = $2', [cust.id, rest.id]);
    return res.status(200).json({ slug, name: rest.name, ...loyaltyStatus(cfg, rows?.[0]?.n || 0, dishMap[cfg.reward_dish_id]) });
  }

  const { data: grouped } = await supabase.raw(
    'select restaurant_id, count(*)::int as n from loyalty_stamps where customer_id = $1 group by restaurant_id', [cust.id]);
  const ids = (grouped || []).map(g => g.restaurant_id);
  if (!ids.length) return res.status(200).json({ restaurants: [] });
  const [{ data: rests = [] }, { data: sets = [] }] = await Promise.all([
    supabase.from('restaurants').select('id, slug, name').in('id', ids),
    supabase.from('restaurant_settings').select('restaurant_id, loyalty_threshold, loyalty_reward_cents, loyalty_opted_in, loyalty_reward_dish_id').in('restaurant_id', ids)
  ]);
  const setBy = Object.fromEntries((sets || []).map(x => [x.restaurant_id, x]));
  const dishMap = await loadDishes((sets || []).map(x => x.loyalty_reward_dish_id));
  const out = (rests || []).map(rt => {
    const n = grouped.find(g => g.restaurant_id === rt.id)?.n || 0;
    const st = setBy[rt.id];
    return { slug: rt.slug, name: rt.name, ...loyaltyStatus(loyaltyConfig(st), n, dishMap[st?.loyalty_reward_dish_id]) };
  }).filter(x => x.enabled);
  return res.status(200).json({ restaurants: out });
}
