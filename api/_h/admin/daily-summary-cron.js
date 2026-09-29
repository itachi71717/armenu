// Daily takings summary.
//
//   POST|GET /api/admin/daily-summary-cron?token=<CRON_SECRET>
//       Cron trigger (Vercel cron sends GET with "Authorization: Bearer $CRON_SECRET",
//       which is accepted too). For every restaurant with
//       restaurant_settings.daily_summary_enabled = true, emails today's numbers
//       to the restaurant email + manager_users with role owner/manager.
//       If CRON_SECRET is unset the call is refused (fail closed).
//
//   GET   /api/admin/daily-summary-cron?slug=<r>   (admin / portal token)
//       -> { enabled }
//   PATCH /api/admin/daily-summary-cron?slug=<r>   body { enabled: bool }
//       -> toggles the setting (portal checkbox). Audit-logged.
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';
import { sendMail } from '../../_lib/mailer.js';

const DEFAULT_TZ = 'Africa/Johannesburg';
let columnReady = false;

async function ensureColumn() {
  if (columnReady) return;
  try {
    await supabaseAdmin.raw('alter table restaurant_settings add column if not exists daily_summary_enabled boolean default false');
    columnReady = true;
  } catch (e) { console.warn('daily_summary_enabled ensure failed:', e.message); }
}

function validTz(tz) {
  if (!tz) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = c => 'R' + ((Number(c) || 0) / 100).toFixed(2);

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function hasTipColumn() {
  try {
    const { data } = await supabase.raw(
      `select 1 from information_schema.columns where table_name = 'orders' and column_name = 'tip_cents' limit 1`);
    return !!(data && data.length);
  } catch { return false; }
}

async function computeStats(restaurantId, tz, tipCol) {
  const dayStart = `(date_trunc('day', now() at time zone $2) at time zone $2)`;
  const tipExpr = tipCol ? 'coalesce(tip_cents, 0)' : '0';
  const { data, error } = await supabase.raw(`
    with t as (
      select id, status, total_cents, customer_id, created_at, ${tipExpr} as tip
      from orders where restaurant_id = $1 and created_at >= ${dayStart}
    )
    select
      (select count(*)::int from t where status <> 'cancelled') as orders_today,
      (select coalesce(sum(total_cents), 0)::bigint from t where status <> 'cancelled') as revenue_cents,
      (select coalesce(sum(tip), 0)::bigint from t where status <> 'cancelled') as tips_cents,
      (select count(*)::int from t where status = 'cancelled') as cancellations,
      (select count(distinct customer_id)::int from t where customer_id is not null and status <> 'cancelled')
        + (select count(*)::int from t where customer_id is null and status <> 'cancelled') as guests,
      (select extract(hour from created_at at time zone $2)::int from t where status <> 'cancelled'
         group by 1 order by count(*) desc, 1 limit 1) as busiest_hour,
      (select oi.dish_name from order_items oi join t on t.id = oi.order_id where t.status <> 'cancelled'
         group by oi.dish_name order by sum(oi.qty) desc, oi.dish_name limit 1) as top_dish
  `, [restaurantId, tz]);
  if (error) throw new Error(error.message);
  const s = (data && data[0]) || {};
  const orders = Number(s.orders_today) || 0;
  const revenue = Number(s.revenue_cents) || 0;
  return {
    orders_today: orders,
    revenue_today_cents: revenue,
    avg_order_cents: orders ? Math.round(revenue / orders) : 0,
    top_dish: s.top_dish || null,
    busiest_hour: s.busiest_hour == null ? null : Number(s.busiest_hour),
    guest_count: Number(s.guests) || 0,
    tips_total_cents: Number(s.tips_cents) || 0,
    cancellations: Number(s.cancellations) || 0
  };
}

function renderEmail(name, st) {
  const hh = h => String(h).padStart(2, '0') + ':00';
  const rows = [
    ['Orders', st.orders_today],
    ['Revenue', money(st.revenue_today_cents)],
    ['Average order', money(st.avg_order_cents)],
    ['Top dish', st.top_dish ? esc(st.top_dish) : '-'],
    ['Busiest hour', st.busiest_hour == null ? '-' : hh(st.busiest_hour) + ' - ' + hh((st.busiest_hour + 1) % 24)],
    ['Guests', st.guest_count],
    ['Tips', money(st.tips_total_cents)],
    ['Cancellations', st.cancellations]
  ];
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
    <h2 style="margin:0 0 4px">${esc(name)} - today's summary</h2>
    <p style="color:#666;margin:0 0 16px">Here is how today went.</p>
    <table style="width:100%;border-collapse:collapse">${rows.map(r =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#555">${r[0]}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${r[1]}</td></tr>`).join('')}
    </table>
    <p style="color:#999;font-size:12px;margin-top:16px">You can turn this email off in your ARMenu portal settings.</p></div>`;
  const text = `${name} - today's summary\n` + rows.map(r => `${r[0]}: ${String(r[1]).replace(/&amp;/g, '&')}`).join('\n');
  return { html, text };
}

async function runCron() {
  await ensureColumn();
  const { data: enabled, error } = await supabaseAdmin.from('restaurant_settings')
    .select('restaurant_id, timezone').eq('daily_summary_enabled', true);
  if (error) throw new Error(error.message);
  const tipCol = await hasTipColumn();
  const out = { restaurants: 0, emails_sent: 0, skipped: 0, errors: 0 };
  for (const s of (enabled || [])) {
    try {
      const { data: r } = await supabaseAdmin.from('restaurants').select('id, name, email').eq('id', s.restaurant_id).maybeSingle();
      if (!r) continue;
      out.restaurants++;
      const { data: mgrs } = await supabaseAdmin.from('manager_users').select('email, role').eq('restaurant_id', r.id).in('role', ['owner', 'manager']);
      const to = [...new Set([r.email, ...(mgrs || []).map(m => m.email)]
        .filter(Boolean).map(e => String(e).trim().toLowerCase()))];
      if (!to.length) { out.skipped++; continue; }
      const stats = await computeStats(r.id, validTz(s.timezone) || DEFAULT_TZ, tipCol);
      const { html, text } = renderEmail(r.name, stats);
      const m = await sendMail({ to, subject: `${r.name} - daily summary`, html, text });
      if (m.ok) out.emails_sent += to.length;
      else if (m.skipped) out.skipped++;
      else { out.errors++; console.warn('daily summary mail failed:', r.id, m.error); }
    } catch (e) { out.errors++; console.warn('daily summary failed for', s.restaurant_id, e.message); }
  }
  return out;
}

export default async function handler(req, res) {
  const { slug } = req.query;

  // Manager/admin settings toggle
  if (slug) {
    if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
    const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
    if (!r) return res.status(404).json({ error: 'not found' });
    const guard = assertScope(req, r.id);
    if (guard) return res.status(guard.status).json({ error: guard.error });
    await ensureColumn();
    if (req.method === 'GET') {
      const { data: s } = await supabaseAdmin.from('restaurant_settings').select('daily_summary_enabled').eq('restaurant_id', r.id).maybeSingle();
      return res.status(200).json({ enabled: !!(s && s.daily_summary_enabled) });
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      let body = {};
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
      const enabled = body.enabled === true;
      const { data: existing } = await supabaseAdmin.from('restaurant_settings').select('restaurant_id').eq('restaurant_id', r.id).maybeSingle();
      const q = existing
        ? await supabaseAdmin.from('restaurant_settings').update({ daily_summary_enabled: enabled }).eq('restaurant_id', r.id)
        : await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: r.id, daily_summary_enabled: enabled });
      if (q && q.error) return res.status(500).json({ error: 'save_failed' });
      auditLog(req, r.id, 'settings.daily_summary', { metadata: { enabled } }).catch(() => {});
      return res.status(200).json({ ok: true, enabled });
    }
    return res.status(405).end();
  }

  // Cron trigger
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: this endpoint sends email.
    console.error('daily-summary-cron: CRON_SECRET is not set - refusing call');
    return res.status(401).json({ error: 'unauthorized' });
  }
  const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
  // Accept either credential (Vercel Cron sends the Bearer header itself).
  if (![req.query.token, bearer].some(t => !!t && safeEq(t, secret))) return res.status(401).json({ error: 'unauthorized' });
  try {
    const result = await runCron();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('daily-summary-cron failed:', e);
    return res.status(500).json({ error: 'cron_failed' });
  }
}
