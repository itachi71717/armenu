// Tiny recording fake for the supabase-js-shaped DB shim. Each test supplies a
// resolver per table: (q) => ({ data, error }) where q describes the query
// that was built ({ table, op, filters, payload, single }).
export function makeFakeDb(resolvers = {}) {
  const log = [];
  const build = (table) => {
    const q = { table, op: 'select', filters: [], payload: null, single: false };
    const run = () => {
      log.push(q);
      const fn = resolvers[table];
      let out = fn ? fn(q) : { data: q.single ? null : [] };
      if (out === undefined || out === null) out = { data: q.single ? null : [] };
      if (q.single && Array.isArray(out.data)) out = { ...out, data: out.data[0] ?? null };
      return out;
    };
    const c = {
      select: () => c,
      order: () => c,
      limit: () => c,
      insert: (p) => { q.op = 'insert'; q.payload = p; return c; },
      update: (p) => { q.op = 'update'; q.payload = p; return c; },
      delete: () => { q.op = 'delete'; return c; },
      maybeSingle: async () => { q.single = true; return run(); },
      single: async () => { q.single = true; return run(); },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    for (const f of ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is']) {
      c[f] = (col, val) => { q.filters.push([f, col, val]); return c; };
    }
    return c;
  };
  const db = {
    from: (t) => build(t),
    raw: async (sql, args) => {
      log.push({ table: '__raw', op: 'raw', sql, args, filters: [] });
      const fn = resolvers.__raw;
      return fn ? fn(sql, args) : { data: [{ id: 'x' }] };
    },
  };
  return { db, log };
}

export function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end() { return this; },
  };
}

export const filterVal = (q, type, col) => q.filters.find(f => f[0] === type && f[1] === col)?.[2];
