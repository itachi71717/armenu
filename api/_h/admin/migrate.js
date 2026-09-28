// GET  /api/admin/migrate  → read-only diff: tables/columns the code needs that the DB lacks
// POST /api/admin/migrate  → apply backend/schema.sql statement by statement
// MASTER ADMIN ONLY (cookie or x-admin-secret). Scoped manager tokens are refused.
// schema.sql is idempotent by design (every create/alter is guarded), so
// re-running is safe; each statement runs independently and failures are
// reported without aborting the rest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../../_auth.js';
import { auditLog } from '../_audit.js';

// Columns/tables the current code depends on. Keep in sync when adding schema.
export const REQUIRED = {
  tables: ['restaurants', 'dishes', 'orders', 'order_items', 'reservations', 'restaurant_settings',
    'restaurant_tables', 'staff', 'waiter_calls', 'reviews', 'offers', 'menu_schedules', 'categories',
    'audit_log', 'manager_users', 'push_subscriptions', 'staff_login_attempts'],
  columns: {
    orders: ['client_order_id', 'cancelled_at', 'cancel_reason', 'tip_cents'],
    reservations: ['duration_minutes', 'guest_email'],
    restaurant_settings: ['timezone'],
    dishes: ['modifiers', 'stock_count', 'allergens', 'translations', 'sort_order', 'category_id'],
    restaurant_tables: ['assigned_staff_id'],
  },
};

// Split a SQL script into top-level statements. Respects '…' strings, "…"
// identifiers, -- line comments, /* */ block comments and $tag$…$tag$ bodies.
export function splitSql(src) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '-' && d === '-') { const e = src.indexOf('\n', i); i = e < 0 ? n : e + 1; cur += '\n'; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) { if (src[j] === c) { if (src[j + 1] === c) { j += 2; continue; } break; } j++; }
      cur += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$') {
      const m = src.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (m) {
        const tag = m[0];
        const e = src.indexOf(tag, i + tag.length);
        const end = e < 0 ? n : e + tag.length;
        cur += src.slice(i, end); i = end; continue;
      }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function diff() {
  const { data: cols = [], error } = await supabaseAdmin.raw(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'");
  if (error) throw new Error(error.message);
  const have = new Set(cols.map(c => c.table_name + '.' + c.column_name));
  const haveT = new Set(cols.map(c => c.table_name));
  const missing = [];
  for (const t of REQUIRED.tables) if (!haveT.has(t)) missing.push('table ' + t);
  for (const [t, cs] of Object.entries(REQUIRED.columns)) for (const c of cs) if (!have.has(t + '.' + c)) missing.push(t + '.' + c);
  return missing;
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (getScopedRestaurantId(req) !== null) return res.status(403).json({ error: 'master_admin_only' });

  try {
    if (req.method === 'GET') {
      const missing = await diff();
      return res.status(200).json({ ok: missing.length === 0, missing });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const before = await diff();
    const src = readFileSync(join(process.cwd(), 'backend', 'schema.sql'), 'utf8');
    const statements = splitSql(src);
    const failures = [];
    let applied = 0;
    for (const stmt of statements) {
      let error = null;
      try { ({ error } = await supabaseAdmin.raw(stmt, [])); } catch (e) { error = { message: e.message }; }
      if (error) failures.push({ statement: stmt.slice(0, 160), error: error.message });
      else applied++;
    }
    const after = await diff();
    await auditLog(req, null, 'schema.migrate', { metadata: { applied, failed: failures.length, fixed: before.filter(m => !after.includes(m)) } }).catch(() => {});
    return res.status(after.length ? 207 : 200).json({ ok: after.length === 0, statements: statements.length, applied, failures, missing_before: before, missing_after: after });
  } catch (e) {
    return res.status(500).json({ error: 'migrate_failed', message: e.message });
  }
}
