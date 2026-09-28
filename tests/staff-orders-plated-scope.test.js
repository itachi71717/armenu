import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the DB shim so the PATCH ?item= branch (server-side "plated" toggle)
// can be exercised without a real database, and to verify the scope check:
// an order_item belonging to a DIFFERENT restaurant than the staff token
// must be rejected with 404, and the update must never be attempted.
let itemRow = null;
let orderRow = null;
const updateSpy = vi.fn();

vi.mock('../api/_db.js', () => {
  const makeChain = (getResult) => ({
    select: () => makeChain(getResult),
    eq: () => makeChain(getResult),
    in: () => makeChain(getResult),
    order: () => makeChain(getResult),
    limit: () => makeChain(getResult),
    maybeSingle: async () => getResult(),
    update: (...args) => { updateSpy(...args); return makeChain(getResult); },
    insert: () => makeChain(getResult),
    single: async () => getResult(),
  });
  const supabase = {
    from: (table) => {
      if (table === 'order_items') return makeChain(() => ({ data: itemRow }));
      if (table === 'orders') return makeChain(() => ({ data: orderRow }));
      return makeChain(() => ({ data: null }));
    }
  };
  return { supabase, supabaseAdmin: supabase };
});

vi.mock('../api/_h/staff/login.js', () => ({
  verifyToken: (tok) => tok === 'good-token' ? { staff_id: 'staff-1', restaurant_id: 'rest-A' } : null
}));

vi.mock('../api/_h/_audit.js', () => ({
  auditLog: vi.fn(async () => {})
}));

const { default: handler } = await import('../api/_h/staff/orders.js');

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return res;
}

describe('PATCH /api/staff/orders?item=<id>&plated=1 scope check', () => {
  beforeEach(() => {
    updateSpy.mockClear();
    itemRow = null;
    orderRow = null;
  });

  it('rejects with 404 and never updates when the item belongs to a different restaurant', async () => {
    itemRow = { id: 'item-1', order_id: 'order-1' };
    orderRow = { id: 'order-1', restaurant_id: 'rest-B' }; // NOT session's restaurant

    const req = {
      method: 'PATCH',
      query: { item: 'item-1', plated: '1' },
      headers: { authorization: 'Bearer good-token' },
      body: {},
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the item does not exist at all', async () => {
    itemRow = null;
    orderRow = null;

    const req = {
      method: 'PATCH',
      query: { item: 'nope', plated: '1' },
      headers: { authorization: 'Bearer good-token' },
      body: {},
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('allows the update when the item belongs to the staff token\'s own restaurant', async () => {
    itemRow = { id: 'item-1', order_id: 'order-1' };
    orderRow = { id: 'order-1', restaurant_id: 'rest-A' }; // matches session

    const req = {
      method: 'PATCH',
      query: { item: 'item-1', plated: '1' },
      headers: { authorization: 'Bearer good-token' },
      body: {},
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.plated).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [patch] = updateSpy.mock.calls[0];
    expect(patch.plated_at).toEqual(expect.any(String));
  });

  it('clears plated_at (sets null) when plated=0', async () => {
    itemRow = { id: 'item-1', order_id: 'order-1' };
    orderRow = { id: 'order-1', restaurant_id: 'rest-A' };

    const req = {
      method: 'PATCH',
      query: { item: 'item-1', plated: '0' },
      headers: { authorization: 'Bearer good-token' },
      body: {},
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.plated).toBe(false);
    const [patch] = updateSpy.mock.calls[0];
    expect(patch.plated_at).toBeNull();
  });

  it('rejects unauthenticated requests with 401 before any DB lookup', async () => {
    const req = {
      method: 'PATCH',
      query: { item: 'item-1', plated: '1' },
      headers: {},
      body: {},
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
