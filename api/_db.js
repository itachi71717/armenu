// Neon Postgres + Cloudflare R2 backend, with a supabase-js–compatible shim
// so existing handlers keep working without change. Falls back to real Supabase
// automatically if DATABASE_URL is not set (safe migration).
//
// Supports the surface actually used across handlers: from/select/eq/neq/gt/gte/
// lt/lte/like/ilike/in/is/order/limit/range/single/maybeSingle/insert/update/
// upsert/delete/match, plus .storage.from(bucket).createSignedUploadUrl / .upload
// / .getPublicUrl / .createSignedUrl / .remove.

import { neon, neonConfig } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const HAS_NEON = !!process.env.DATABASE_URL;
const HAS_R2   = !!process.env.R2_ENDPOINT && !!process.env.R2_ACCESS_KEY_ID;

// ============================================================
// Neon HTTP client — single connection per request via fetch.
// ============================================================
neonConfig.fetchConnectionCache = true;
const sql = HAS_NEON ? neon(process.env.DATABASE_URL) : null;

// R2 (S3-compatible) client
const r2 = HAS_R2 ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
}) : null;

const R2_BUCKET = process.env.R2_BUCKET || 'armenu-media';
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

// ============================================================
// Query builder — collects filters/order/etc, executes on `await` (thenable).
// ============================================================
function ident(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
function cols(list) {
  if (!list || list === '*') return '*';
  return String(list).split(',').map(s => s.trim()).map(c => c === '*' ? '*' : ident(c)).join(', ');
}

// Column-name suffix tells us the Postgres type.  _ids/days_of_week/enabled_languages
// are Postgres native arrays (text[]/int[]/uuid[]) — pg wants the '{a,b,c}' literal.
// modifiers/translations/keys are jsonb — pg accepts JSON strings.
// Everything else stringifies via the default driver.
const PG_ARRAY_COLS = new Set([
  'days_of_week', 'dish_ids', 'category_ids', 'enabled_languages'
]);
export function toPgArrayLiteral(arr) {
  // Empty array → {}
  if (!arr.length) return '{}';
  // Escape each element for PG array syntax. Numbers pass through; strings wrapped in "..."
  const parts = arr.map(v => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    // Strings and UUIDs — wrap in double quotes, escape internal quotes/backslashes.
    const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${s}"`;
  });
  return '{' + parts.join(',') + '}';
}
// Columns typed jsonb — arrays legitimately serialize as JSON here. If a
// column is neither in PG_ARRAY_COLS nor JSONB_ARRAY_COLS and receives an
// array, we log a warning (dev-time signal that PG_ARRAY_COLS is stale).
const JSONB_ARRAY_COLS = new Set(['modifiers', 'translations', 'metadata', 'keys']);
export function encodeVal(colName, v) {
  if (v == null) return v;
  if (v instanceof Date) return v;
  // Postgres native array column?
  if (PG_ARRAY_COLS.has(colName) && Array.isArray(v)) return toPgArrayLiteral(v);
  if (Array.isArray(v) && !JSONB_ARRAY_COLS.has(colName)) {
    // Not fatal — some jsonb columns legitimately take arrays — but flag any
    // column not on either list so PG_ARRAY_COLS can be extended when a new
    // text[]/int[]/uuid[] column is added.
    console.warn(`[_db] Array value on column '${colName}' — not in PG_ARRAY_COLS or JSONB_ARRAY_COLS. If this is a Postgres array column, add it to PG_ARRAY_COLS in api/_db.js.`);
  }
  // jsonb / object / anything object-like
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

class Query {
  constructor(table) {
    this._table = table;
    this._op = 'select';       // select | insert | update | delete | upsert
    this._sel = '*';
    this._filters = [];        // {op, col, val}
    this._orders = [];         // {col, asc, nullsFirst}
    this._limit = null;
    this._offset = null;
    this._data = null;         // for insert/update/upsert
    this._returning = false;   // .select() after write → RETURNING *
    this._single = 0;          // 0 = many, 1 = .single (error if !=1), 2 = .maybeSingle
    this._onConflict = null;   // for upsert
    this._resolve = null;
  }
  // Filters
  eq(col, val)  { this._filters.push({ op: '=',  col, val }); return this; }
  neq(col, val) { this._filters.push({ op: '<>', col, val }); return this; }
  gt(col, val)  { this._filters.push({ op: '>',  col, val }); return this; }
  gte(col, val) { this._filters.push({ op: '>=', col, val }); return this; }
  lt(col, val)  { this._filters.push({ op: '<',  col, val }); return this; }
  lte(col, val) { this._filters.push({ op: '<=', col, val }); return this; }
  like(col, v)  { this._filters.push({ op: 'LIKE',  col, val: v }); return this; }
  ilike(col, v) { this._filters.push({ op: 'ILIKE', col, val: v }); return this; }
  in(col, arr)  { this._filters.push({ op: 'IN',  col, val: arr }); return this; }
  is(col, val)  { this._filters.push({ op: 'IS',  col, val }); return this; }
  not(col, opName, val) {
    const map = { eq: '<>', in: 'NOT IN', is: 'IS NOT' };
    this._filters.push({ op: map[opName] || 'IS NOT', col, val });
    return this;
  }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }

  // Order / paging
  order(col, opts = {}) {
    this._orders.push({ col, asc: opts.ascending !== false, nullsFirst: !!opts.nullsFirst });
    return this;
  }
  limit(n) { this._limit = Number(n); return this; }
  range(from, to) { this._offset = Number(from); this._limit = Number(to) - Number(from) + 1; return this; }

  // Writes
  select(sel) {
    // If called on a chained write, this signals RETURNING *; otherwise sets projection.
    if (this._op === 'select') this._sel = sel || '*';
    else this._returning = true;
    return this;
  }
  insert(data) { this._op = 'insert'; this._data = Array.isArray(data) ? data : [data]; return this; }
  update(data) { this._op = 'update'; this._data = data; return this; }
  upsert(data, opts = {}) {
    this._op = 'upsert';
    this._data = Array.isArray(data) ? data : [data];
    this._onConflict = opts.onConflict || null;
    return this;
  }
  delete() { this._op = 'delete'; return this; }

  single()      { this._single = 1; return this; }
  maybeSingle() { this._single = 2; return this; }

  // Thenable — allows `await query` AND `.then(...).then(...)` chains
  then(resolve, reject) {
    return this._exec().then(resolve, reject);
  }
  catch(reject) { return this.then(undefined, reject); }
  finally(fn) { return this.then().finally(fn); }

  async _exec() {
    try {
      const { text, params } = this._buildSql();
      const rows = await sql(text, params);
      return this._shape(rows);
    } catch (e) {
      // List queries get data:[] so `const { data = [] }` callers can still
      // iterate. Single-row queries MUST get null — `[]` is truthy, so an
      // `if (!row) return 404` guard would pass on a DB error and callers
      // would carry on with row.id === undefined.
      const error = { message: e.message, details: e.detail || null, code: e.code || null };
      return { data: this._single ? null : [], error };
    }
  }

  _whereClause(startIdx) {
    if (!this._filters.length) return { clause: '', params: [], nextIdx: startIdx };
    const parts = []; const params = []; let i = startIdx;
    for (const f of this._filters) {
      const c = ident(f.col);
      if (f.op === 'IN' || f.op === 'NOT IN') {
        const arr = f.val || [];
        if (!arr.length) { parts.push('FALSE'); continue; }
        const ph = arr.map(() => `$${i++}`).join(',');
        parts.push(`${c} ${f.op} (${ph})`);
        params.push(...arr);
      } else if (f.op === 'IS' || f.op === 'IS NOT') {
        // val can be null / true / false
        const lit = f.val === null ? 'NULL' : (f.val === true ? 'TRUE' : (f.val === false ? 'FALSE' : `$${i++}`));
        parts.push(`${c} ${f.op} ${lit}`);
        if (lit.startsWith('$')) params.push(f.val);
      } else {
        parts.push(`${c} ${f.op} $${i++}`);
        params.push(f.val);
      }
    }
    return { clause: 'WHERE ' + parts.join(' AND '), params, nextIdx: i };
  }

  _orderLimit() {
    let out = '';
    if (this._orders.length) {
      out += ' ORDER BY ' + this._orders.map(o => `${ident(o.col)} ${o.asc ? 'ASC' : 'DESC'}${o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`).join(', ');
    }
    if (this._limit != null) out += ` LIMIT ${this._limit}`;
    if (this._offset != null) out += ` OFFSET ${this._offset}`;
    return out;
  }

  _buildSql() {
    const T = ident(this._table);
    if (this._op === 'select') {
      const w = this._whereClause(1);
      return { text: `SELECT ${cols(this._sel)} FROM ${T} ${w.clause}${this._orderLimit()}`, params: w.params };
    }
    if (this._op === 'delete') {
      const w = this._whereClause(1);
      const ret = this._returning ? ' RETURNING *' : '';
      return { text: `DELETE FROM ${T} ${w.clause}${ret}`, params: w.params };
    }
    if (this._op === 'insert' || this._op === 'upsert') {
      // Union of keys across all rows
      const keys = [...new Set(this._data.flatMap(r => Object.keys(r || {})))];
      if (!keys.length) throw new Error('insert: no columns');
      const params = [];
      let i = 1;
      const valuesSql = this._data.map(row => {
        const parts = keys.map(k => {
          const v = row[k];
          if (v === undefined) return 'DEFAULT';
          params.push(encodeVal(k, v));
          return `$${i++}`;
        });
        return '(' + parts.join(',') + ')';
      }).join(',');
      let conflict = '';
      if (this._op === 'upsert') {
        const conflictCols = String(this._onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!conflictCols.length) {
          // No conflict target = ON CONFLICT DO NOTHING (whole row)
          conflict = ' ON CONFLICT DO NOTHING';
        } else {
          const target = `(${conflictCols.map(ident).join(',')})`;
          const updates = keys.filter(k => !conflictCols.includes(k))
            .map(k => `${ident(k)} = EXCLUDED.${ident(k)}`).join(', ');
          conflict = updates ? ` ON CONFLICT ${target} DO UPDATE SET ${updates}` : ` ON CONFLICT ${target} DO NOTHING`;
        }
      }
      const ret = this._returning || this._single ? ' RETURNING *' : '';
      return {
        text: `INSERT INTO ${T} (${keys.map(ident).join(',')}) VALUES ${valuesSql}${conflict}${ret}`,
        params
      };
    }
    if (this._op === 'update') {
      const keys = Object.keys(this._data || {});
      if (!keys.length) throw new Error('update: no columns');
      const params = []; let i = 1;
      const set = keys.map(k => {
        const v = this._data[k];
        params.push(encodeVal(k, v));
        return `${ident(k)} = $${i++}`;
      }).join(', ');
      const w = this._whereClause(i);
      const ret = this._returning || this._single ? ' RETURNING *' : '';
      return { text: `UPDATE ${T} SET ${set} ${w.clause}${ret}`, params: [...params, ...w.params] };
    }
    throw new Error('Unsupported op: ' + this._op);
  }

  _shape(rows) {
    // supabase-js contract: { data, error }, where data is array for many, object for .single/.maybeSingle
    if (this._single === 1) {
      if (rows.length === 0) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
      return { data: rows[0], error: null };
    }
    if (this._single === 2) {
      return { data: rows[0] || null, error: null };
    }
    // .select() after insert/update/upsert with array data → still an array
    return { data: rows, error: null, count: rows.length };
  }
}

// ============================================================
// Storage shim → R2
// ============================================================
function storage() {
  return {
    from(bucket) {
      // We ignore bucket name and use one R2 bucket ($R2_BUCKET) namespaced by
      // path prefix. Supabase's `dishes/foo` bucket becomes `dishes/foo` key.
      const prefix = bucket ? bucket.replace(/\/$/, '') + '/' : '';
      return {
        async upload(path, body, opts = {}) {
          if (!r2) return { data: null, error: { message: 'R2 not configured' } };
          try {
            const Key = prefix + path.replace(/^\//, '');
            const ContentType = opts.contentType || guessType(path);
            await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key, Body: body, ContentType }));
            return { data: { path }, error: null };
          } catch (e) { return { data: null, error: { message: e.message } }; }
        },
        async createSignedUploadUrl(path) {
          if (!r2) return { data: null, error: { message: 'R2 not configured' } };
          try {
            const Key = prefix + path.replace(/^\//, '');
            const url = await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key }), { expiresIn: 3600 });
            return { data: { signedUrl: url, path, token: '' }, error: null };
          } catch (e) { return { data: null, error: { message: e.message } }; }
        },
        async createSignedUrl(path, expiresIn = 3600) {
          if (!r2) return { data: null, error: { message: 'R2 not configured' } };
          try {
            const Key = prefix + path.replace(/^\//, '');
            const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key }), { expiresIn });
            return { data: { signedUrl: url }, error: null };
          } catch (e) { return { data: null, error: { message: e.message } }; }
        },
        getPublicUrl(path) {
          const Key = prefix + path.replace(/^\//, '');
          return { data: { publicUrl: `${R2_PUBLIC}/${Key}` } };
        },
        async remove(paths) {
          if (!r2) return { data: null, error: { message: 'R2 not configured' } };
          const list = Array.isArray(paths) ? paths : [paths];
          try {
            for (const p of list) {
              const Key = prefix + p.replace(/^\//, '');
              await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key }));
            }
            return { data: {}, error: null };
          } catch (e) { return { data: null, error: { message: e.message } }; }
        }
      };
    }
  };
}

function guessType(path) {
  const p = path.toLowerCase();
  if (p.endsWith('.glb')) return 'model/gltf-binary';
  if (p.endsWith('.gltf')) return 'model/gltf+json';
  if (p.endsWith('.usdz')) return 'model/vnd.usdz+zip';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

// ============================================================
// Public API — supabase-compat object
// ============================================================
function makeClient() {
  return {
    from(table) { return new Query(table); },
    storage: storage(),
    // Handy raw SQL escape hatch for code that wants it
    async rpc() { throw new Error('rpc() not supported by shim; write raw sql instead'); },
    // Same { data, error } contract as the query builder — never throws.
    async raw(text, params = []) {
      try {
        const rows = await sql(text, params);
        return { data: rows, error: null };
      } catch (e) {
        return { data: [], error: { message: e.message, details: e.detail || null, code: e.code || null } };
      }
    }
  };
}

// Fallback: real Supabase if DATABASE_URL isn't wired up yet
function fallbackSupabase(isAdmin = false) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = isAdmin ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Neither DATABASE_URL nor Supabase env vars set');
  return createSupabaseClient(url, key);
}

export const supabase      = HAS_NEON ? makeClient() : fallbackSupabase(false);
export const supabaseAdmin = HAS_NEON ? makeClient() : fallbackSupabase(true);

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
