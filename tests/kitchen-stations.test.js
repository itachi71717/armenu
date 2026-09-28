import { describe, it, expect, vi, beforeEach } from 'vitest';

let tables = {};
const updateSpy = vi.fn();
const deleteSpy = vi.fn();
let scopedRestaurant = null;

vi.mock('../api/_db.js', () => {
  const makeChain = (table) => {
    const c = {
      select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
      insert: () => c,
      update: (...a) => { updateSpy(table, ...a); return c; },
      delete: () => { deleteSpy(table); return c; },
      maybeSingle: async () => ({ data: tables[table] ?? null }),
      single: async () => ({ data: tables[table] ?? null }),
      then: (res) => res({ data: tables[table] ?? [] }),
    };
    return c;
  };
  const supabase = { from: (t) => makeChain(t), raw: async () => ({ data: [{ n: 0 }] }) };
  return { supabase, supabaseAdmin: supabase };
});

vi.mock('../api/_auth.js', () => ({
  requireAdmin: () => true,
  assertScope: (req, rid) =>
    scopedRestaurant && scopedRestaurant !== rid ? { status: 403, error: 'out_of_scope' } : null,
}));

vi.mock('../api/_h/_audit.js', () => ({ auditLog: vi.fn(async () => {}) }));

vi.mock('../api/_h/staff/login.js', () => ({
  verifyToken: (tok) => tok === 'good' ? { staff_id: 's1', restaurant_id: 'rest-A' } : null,
}));

const { default: stations } = await import('../api/_h/admin/kitchen-stations.js');
const { default: orders, filterOrdersForStation } = await import('../api/_h/staff/orders.js');

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

beforeEach(() => {
  tables = {}; scopedRestaurant = null;
  updateSpy.mockClear(); deleteSpy.mockClear();
});

describe('admin/kitchen-stations scope', () => {
  it('refuses a scoped token whose restaurant differs from the slug', async () => {
    tables.restaurants = { id: 'rest-B' };
    scopedRestaurant = 'rest-A';
    const res = makeRes();
    await stations({ method: 'GET', query: { slug: 'b' }, headers: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  it('404s and never deletes a station that belongs to another restaurant', async () => {
    tables.restaurants = { id: 'rest-A' };
    tables.kitchen_stations = { id: 'st1', restaurant_id: 'rest-B', name: 'Grill' };
    const res = makeRes();
    await stations({ method: 'DELETE', query: { slug: 'a', id: 'st1' }, headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('allows PATCH of own station', async () => {
    tables.restaurants = { id: 'rest-A' };
    tables.kitchen_stations = { id: 'st1', restaurant_id: 'rest-A', name: 'Grill' };
    const res = makeRes();
    await stations({ method: 'PATCH', query: { slug: 'a', id: 'st1' }, headers: {}, body: { name: 'Fry' } }, res);
    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('station filter', () => {
  it('keeps only orders with a station dish and flags mine items', () => {
    const list = [
      { id: 'o1', order_items: [{ id: 'i1', dish_id: 'd1' }, { id: 'i2', dish_id: 'd2' }] },
      { id: 'o2', order_items: [{ id: 'i3', dish_id: 'd2' }] },
    ];
    const out = filterOrdersForStation(list, new Set(['d1']));
    expect(out.map(o => o.id)).toEqual(['o1']);
    expect(out[0].order_items).toHaveLength(2);
    expect(out[0].order_items.map(i => i.mine)).toEqual([true, false]);
  });
});

describe('PATCH recall scope', () => {
  const req = () => ({
    method: 'PATCH', query: {}, headers: { authorization: 'Bearer good' },
    body: { id: 'item-1', recall: { reason: 'wrong temp' } },
  });

  it('404s for an item in another restaurant and does not update', async () => {
    tables.order_items = { id: 'item-1', order_id: 'o1' };
    tables.orders = { id: 'o1', restaurant_id: 'rest-B' };
    const res = makeRes();
    await orders(req(), res);
    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('accepts the staff UI shape: ?id=<item>&recall=<reason> with a string body.recall', async () => {
    tables.order_items = { id: 'item-1', order_id: 'o1' };
    tables.orders = { id: 'o1', restaurant_id: 'rest-A', status: 'served' };
    const res = makeRes();
    await orders({ method: 'PATCH', query: { id: 'item-1', recall: 'cold' }, headers: { authorization: 'Bearer good' }, body: JSON.stringify({ recall: 'cold' }) }, res);
    expect(res.statusCode).toBe(200);
    const [, patch] = updateSpy.mock.calls[0];
    expect(patch.recall_reason).toBe('cold');
    expect(patch.plated_at).toBeNull();
    // served order goes back to prep
    expect(updateSpy.mock.calls.some(([t, p]) => t === 'orders' && p.status === 'prep')).toBe(true);
  });

  it('recalls an item in own restaurant', async () => {
    tables.order_items = { id: 'item-1', order_id: 'o1' };
    tables.orders = { id: 'o1', restaurant_id: 'rest-A' };
    const res = makeRes();
    await orders(req(), res);
    expect(res.statusCode).toBe(200);
    const [, patch] = updateSpy.mock.calls[0];
    expect(patch.recall_reason).toBe('wrong temp');
    expect(patch.recalled_at).toEqual(expect.any(String));
  });
});
