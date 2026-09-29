import { describe, it, expect, vi, beforeEach } from 'vitest';

let tables = {};
let scopedRestaurant = null;
let rawRows = [];
const rawSpy = vi.fn();
const insertSpy = vi.fn();

vi.mock('../api/_db.js', () => {
  const makeChain = (table) => {
    const c = {
      select: () => c, eq: () => c, order: () => c, limit: () => c,
      insert: (...a) => { insertSpy(table, ...a); return c; },
      update: () => c, delete: () => c,
      maybeSingle: async () => ({ data: tables[table] ?? null }),
      single: async () => ({ data: tables[table] ?? null }),
      then: (res) => res({ data: tables[table] ?? [] }),
    };
    return c;
  };
  const supabase = {
    from: (t) => makeChain(t),
    raw: async (sql, params) => { rawSpy(sql, params); return { data: rawRows, error: null }; },
  };
  return { supabase, supabaseAdmin: supabase };
});

vi.mock('../api/_auth.js', () => ({
  requireAdmin: () => true,
  assertScope: (req, rid) =>
    scopedRestaurant && scopedRestaurant !== rid ? { status: 403, error: 'out_of_scope' } : null,
}));

vi.mock('../api/_h/_audit.js', () => ({ auditLog: vi.fn(async () => {}) }));

const { default: shifts } = await import('../api/_h/admin/shifts.js');

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

beforeEach(() => {
  tables = {}; scopedRestaurant = null; rawRows = [];
  rawSpy.mockClear(); insertSpy.mockClear();
});

describe('admin/shifts', () => {
  it('refuses a scoped token whose restaurant differs from the slug', async () => {
    tables.restaurants = { id: 'rest-B' };
    scopedRestaurant = 'rest-A';
    const res = makeRes();
    await shifts({ method: 'GET', query: { slug: 'b' }, headers: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(rawSpy).not.toHaveBeenCalled();
  });

  it('passes the from/to date filter to the query and joins staff', async () => {
    tables.restaurants = { id: 'rest-A' };
    rawRows = [{ id: 's1', staff_name: 'Thabo', staff_role: 'waiter' }];
    const res = makeRes();
    const from = '2026-09-28T00:00:00.000Z', to = '2026-10-05T00:00:00.000Z';
    await shifts({ method: 'GET', query: { slug: 'a', from, to }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.shifts[0].staff_name).toBe('Thabo');
    const [sql, params] = rawSpy.mock.calls[0];
    expect(sql).toMatch(/join staff|left join staff/i);
    expect(params).toEqual(['rest-A', from, to]);
  });

  it('rejects a shift for staff from another restaurant and never inserts', async () => {
    tables.restaurants = { id: 'rest-A' };
    tables.staff = { id: 'st1', restaurant_id: 'rest-B', name: 'X' };
    const res = makeRes();
    await shifts({ method: 'POST', query: {}, headers: {}, body: {
      slug: 'a', staff_id: 'st1', starts_at: '2026-09-29T08:00:00Z', ends_at: '2026-09-29T16:00:00Z' } }, res);
    expect(res.statusCode).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
