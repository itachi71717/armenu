// Credit-based usage caps that MIRROR Meshy's 10-credits-per-generation model
// so our billing is 1:1 with our supplier cost. Restaurants get 100 credits
// on onboarding (10 free generations). Beyond that they must buy credit packs.
//
//   const gate = await enforceCredits(restaurant_id, 'meshy_generate');
//   if (!gate.ok) return res.status(402).json({ error: gate.reason, message: gate.message, credits_needed: gate.needed });
//   ... make the paid call ...
//   await consumeCredits(restaurant_id, 'meshy_generate', 10, { job_id });
//
// Retries: same call but pass consume=false to enforce without charging (Meshy
// gives retries free too).
//
// AI Menu Reader still uses the flat monthly cap since it's cheap + onboarding-only.

import { supabase, supabaseAdmin } from '../_db.js';

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

const COST_CREDITS = {
  meshy_generate: 10,       // matches Meshy's 10 credits / image-to-3D
  meshy_retexture: 5,
};

// Platform-wide safety ceiling — protects Ian even if a restaurant somehow
// spends its credits impossibly fast (bug / abuse).
const PLATFORM_CAPS = {
  meshy_generate: {
    monthly_generations: parseInt(process.env.QUOTA_MESHY_PLATFORM_MONTHLY || '2000'),
  },
  ai_menu_reader: {
    per_restaurant_per_month: parseInt(process.env.QUOTA_AI_READER_PER_MONTH || '5'),
    platform_monthly: parseInt(process.env.QUOTA_AI_READER_MONTHLY || '500'),
  },
};

// ============================================================
// enforceCredits — checks balance; returns { ok, needed?, message? }
// ============================================================
export async function enforceCredits(restaurant_id, kind) {
  const cost = COST_CREDITS[kind] || 0;
  if (!cost) return { ok: true };

  // Platform safety cap first
  const cap = PLATFORM_CAPS[kind];
  if (cap?.monthly_generations) {
    const since = new Date(Date.now() - MONTH_MS).toISOString();
    const { data = [] } = await supabase.from('credit_transactions')
      .select('id').eq('kind', 'consume').gte('created_at', since);
    if (data.length >= cap.monthly_generations) {
      return { ok: false, reason: 'platform_capacity_reached',
        message: `Platform generation capacity for this month is temporarily exhausted. ARMenu support has been alerted.` };
    }
  }

  // Restaurant balance
  const { data: rest } = await supabase.from('restaurants').select('meshy_credits').eq('id', restaurant_id).maybeSingle();
  const bal = rest?.meshy_credits ?? 0;
  if (bal < cost) {
    return {
      ok: false, reason: 'insufficient_credits',
      needed: cost - bal, balance: bal, cost,
      message: `This dish needs ${cost} credits but you only have ${bal}. Top up in the portal to keep generating.`
    };
  }
  return { ok: true, balance: bal, cost };
}

// ============================================================
// consumeCredits — atomically debit + log the transaction
// ============================================================
export async function consumeCredits(restaurant_id, kind, credits = null, metadata = {}) {
  const cost = credits ?? COST_CREDITS[kind] ?? 0;
  if (!cost) return { ok: true, balance: null };
  try {
    // Atomic debit via raw SQL to avoid race conditions
    const rows = await supabaseAdmin.raw(
      `update restaurants set meshy_credits = meshy_credits - $1 where id = $2 and meshy_credits >= $1 returning meshy_credits`,
      [cost, restaurant_id]
    );
    const after = rows?.data?.[0]?.meshy_credits;
    if (after == null) return { ok: false, reason: 'insufficient_credits' };
    await supabaseAdmin.from('credit_transactions').insert({
      restaurant_id, kind: 'consume', delta: -cost, balance_after: after,
      metadata: { source: kind, ...metadata }
    });
    return { ok: true, balance: after };
  } catch (e) {
    console.warn('consumeCredits failed:', e.message);
    return { ok: false, reason: 'debit_failed' };
  }
}

// ============================================================
// grantCredits — for onboarding grants + purchase fulfilment
// ============================================================
export async function grantCredits(restaurant_id, credits, reason = 'grant', metadata = {}) {
  try {
    const rows = await supabaseAdmin.raw(
      `update restaurants set meshy_credits = meshy_credits + $1 where id = $2 returning meshy_credits`,
      [credits, restaurant_id]
    );
    const after = rows?.data?.[0]?.meshy_credits;
    if (after == null) return { ok: false };
    await supabaseAdmin.from('credit_transactions').insert({
      restaurant_id, kind: reason, delta: credits, balance_after: after,
      metadata
    });
    return { ok: true, balance: after };
  } catch (e) {
    console.warn('grantCredits failed:', e.message);
    return { ok: false };
  }
}

// ============================================================
// Legacy flat quota kept for AI Menu Reader (cheap, onboarding-only)
// ============================================================
export async function enforceQuota(restaurant_id, kind) {
  const cap = PLATFORM_CAPS[kind];
  if (!cap) return { ok: true };
  const now = Date.now();
  try {
    if (cap.per_restaurant_per_month) {
      const since = new Date(now - MONTH_MS).toISOString();
      const { data = [] } = await supabase.from('usage_events')
        .select('id').eq('restaurant_id', restaurant_id).eq('kind', kind).gte('created_at', since);
      if (data.length >= cap.per_restaurant_per_month) {
        return { ok: false, reason: 'monthly_quota_exceeded',
          message: `Monthly limit reached for ${kind} (${cap.per_restaurant_per_month}/month). Contact ARMenu support.` };
      }
    }
    if (cap.platform_monthly) {
      const since = new Date(now - MONTH_MS).toISOString();
      const { data = [] } = await supabase.from('usage_events')
        .select('id').eq('kind', kind).gte('created_at', since);
      if (data.length >= cap.platform_monthly) {
        return { ok: false, reason: 'platform_budget_exceeded',
          message: `Platform-wide monthly budget for ${kind} is reached. Contact ARMenu support.` };
      }
    }
  } catch (e) {
    console.warn('quota check failed:', e.message);
  }
  return { ok: true };
}

export async function logUsage(restaurant_id, kind, cost_cents = 0, metadata = {}) {
  try {
    await supabaseAdmin.from('usage_events').insert({ restaurant_id, kind, cost_cents, metadata });
  } catch (e) { console.warn('usage log failed:', e.message); }
}

// ============================================================
// CREDIT PACKS — retail prices (ZAR). Change here to reprice.
// ============================================================
export const CREDIT_PACKS = [
  { id: 'starter', credits: 50,    price_zar: 149,  label: '50 credits · 5 dishes',   badge: null },
  { id: 'grow',    credits: 200,   price_zar: 499,  label: '200 credits · 20 dishes', badge: 'Most popular' },
  { id: 'bulk',    credits: 1000,  price_zar: 1999, label: '1,000 credits · 100 dishes', badge: 'Best value' },
];
