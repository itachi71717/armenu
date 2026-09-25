// Usage quotas + cost caps. Called by any handler that spends money on an
// external API (Meshy, Anthropic). Reads limits from env with sensible defaults.
//
//   const gate = await enforceQuota(restaurant_id, 'meshy_generate');
//   if (!gate.ok) return res.status(429).json({ error: gate.reason, message: gate.message });
//   ... make the paid call ...
//   await logUsage(restaurant_id, 'meshy_generate', 20); // 20 cents
//
// Limits (env, all optional):
//   QUOTA_MESHY_PER_DAY         (default 20)  — per restaurant / day
//   QUOTA_MESHY_MONTHLY_USD     (default 100) — platform-wide / month
//   QUOTA_AI_READER_PER_MONTH   (default 5)   — per restaurant / month
//   QUOTA_AI_READER_MONTHLY_USD (default 50)  — platform-wide / month
//
// Master admin bypass: if the request carries x-admin-secret == ADMIN_SECRET
// (checked at handler level), you can skip enforceQuota entirely.

import { supabase, supabaseAdmin } from '../_db.js';

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

const LIMITS = {
  meshy_generate: {
    per_restaurant_per_day: parseInt(process.env.QUOTA_MESHY_PER_DAY || '20'),
    platform_monthly_usd:   parseInt(process.env.QUOTA_MESHY_MONTHLY_USD || '100'),
    est_cost_cents:         20,   // 20¢ per generation (rough Meshy pricing)
  },
  ai_menu_reader: {
    per_restaurant_per_month: parseInt(process.env.QUOTA_AI_READER_PER_MONTH || '5'),
    platform_monthly_usd:     parseInt(process.env.QUOTA_AI_READER_MONTHLY_USD || '50'),
    est_cost_cents:           10,
  },
};

export async function enforceQuota(restaurant_id, kind) {
  const lim = LIMITS[kind];
  if (!lim) return { ok: true };
  const now = Date.now();

  // Per-restaurant window
  try {
    if (lim.per_restaurant_per_day) {
      const since = new Date(now - DAY_MS).toISOString();
      const { data = [] } = await supabase.from('usage_events')
        .select('id').eq('restaurant_id', restaurant_id).eq('kind', kind).gte('created_at', since);
      if (data.length >= lim.per_restaurant_per_day) {
        return { ok: false, reason: 'daily_quota_exceeded',
          message: `Daily limit reached for ${kind} (${lim.per_restaurant_per_day}/day). Try tomorrow or contact ARMenu support.` };
      }
    }
    if (lim.per_restaurant_per_month) {
      const since = new Date(now - MONTH_MS).toISOString();
      const { data = [] } = await supabase.from('usage_events')
        .select('id').eq('restaurant_id', restaurant_id).eq('kind', kind).gte('created_at', since);
      if (data.length >= lim.per_restaurant_per_month) {
        return { ok: false, reason: 'monthly_quota_exceeded',
          message: `Monthly limit reached for ${kind} (${lim.per_restaurant_per_month}/month). Contact ARMenu support.` };
      }
    }
  } catch (e) {
    // On DB error, fail-open (don't block paying customers over infra hiccup)
    console.warn('quota per-restaurant check failed:', e.message);
  }

  // Platform-wide monthly USD ceiling
  try {
    if (lim.platform_monthly_usd) {
      const since = new Date(now - MONTH_MS).toISOString();
      const { data = [] } = await supabase.from('usage_events')
        .select('cost_cents').eq('kind', kind).gte('created_at', since);
      const totalCents = data.reduce((s, r) => s + (r.cost_cents || 0), 0);
      const limitCents = lim.platform_monthly_usd * 100;
      if (totalCents >= limitCents) {
        return { ok: false, reason: 'platform_budget_exceeded',
          message: `Platform-wide monthly budget for ${kind} is reached. Contact ARMenu support.` };
      }
    }
  } catch (e) {
    console.warn('quota platform check failed:', e.message);
  }
  return { ok: true };
}

export async function logUsage(restaurant_id, kind, cost_cents = null, metadata = {}) {
  const cents = cost_cents ?? LIMITS[kind]?.est_cost_cents ?? 0;
  try {
    await supabaseAdmin.from('usage_events').insert({
      restaurant_id, kind, cost_cents: cents, metadata
    });
  } catch (e) {
    console.warn('usage log failed:', e.message);
  }
}
