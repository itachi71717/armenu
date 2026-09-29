import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes, filterVal } from './_fakeDb.js';

let fake, dupRow, ordersInserted;
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));
vi.mock('../api/_h/push/_send.js', () => ({ sendPush: vi.fn(async () => {}) }));

const { default: handler } = await import('../api/_h/order.js');

function setup() {
  dupRow = null; ordersInserted = [];
  fake = makeFakeDb({
    restaurants: () => ({ data: { id: 'r1' } }),
    restaurant_settings: () => ({ data: { orders_enabled: true, default_currency: 'ZAR' } }),
    dishes: () => ({ data: [{ id: 'd1', slug: 'burger', name: 'Burger', price_cents: 5000, stock_count: null, modifiers: [] }] }),
    offers: () => ({ data: [] }),
    orders: (q) => {
      if (q.op === 'insert') { ordersInserted.push(q.payload); return { data: { id: 'new-order' } }; }
      if (q.op === 'select') return { data: dupRow };
      return { data: null };
    },
    order_items: () => ({ data: null }),
  });
}
const post = (extra = {}) => ({
  method: 'POST', headers: {},
  body: { r: 'a', items: [{ dish_slug: 'burger', qty: 1 }], ...extra },
});

beforeEach(setup);

describe('POST /api/order idempotency', () => {
  it('returns the existing order (no insert) when client_order_id matches in window', async () => {
    dupRow = { id: 'existing-1' };
    const res = makeRes();
    await handler(post({ client_order_id: 'abc-123' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, order_id: 'existing-1', duplicate: true });
    expect(ordersInserted).toHaveLength(0);
  });

  it('looks up the duplicate scoped to the restaurant with a ~15 min cutoff', async () => {
    dupRow = { id: 'existing-1' };
    const before = Date.now();
    await handler(post({ client_order_id: 'abc-123' }), makeRes());
    const q = fake.log.find(l => l.table === 'orders' && l.op === 'select');
    expect(filterVal(q, 'eq', 'restaurant_id')).toBe('r1');
    expect(filterVal(q, 'eq', 'client_order_id')).toBe('abc-123');
    const cutoff = new Date(filterVal(q, 'gte', 'created_at')).getTime();
    const age = before - cutoff;
    expect(age).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(age).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
  });

  it('creates a new order when the client_order_id is unseen and stores it', async () => {
    dupRow = null;
    const res = makeRes();
    await handler(post({ client_order_id: 'fresh-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBe('new-order');
    expect(res.body.duplicate).toBeUndefined();
    expect(ordersInserted).toHaveLength(1);
    expect(ordersInserted[0].client_order_id).toBe('fresh-1');
  });

  it('truncates client_order_id to 60 chars for both lookup and insert', async () => {
    const long = 'x'.repeat(100);
    await handler(post({ client_order_id: long }), makeRes());
    const q = fake.log.find(l => l.table === 'orders' && l.op === 'select');
    expect(filterVal(q, 'eq', 'client_order_id')).toHaveLength(60);
    expect(ordersInserted[0].client_order_id).toHaveLength(60);
  });

  it('skips the idempotency lookup entirely when client_order_id is missing', async () => {
    dupRow = { id: 'should-not-be-used' };
    const res = makeRes();
    await handler(post(), res);
    expect(res.body.order_id).toBe('new-order');
    expect(fake.log.some(l => l.table === 'orders' && l.op === 'select')).toBe(false);
    expect(ordersInserted[0].client_order_id).toBeNull();
  });

  it('ignores a non-string client_order_id for the lookup', async () => {
    const res = makeRes();
    await handler(post({ client_order_id: 12345 }), res);
    expect(res.body.duplicate).toBeUndefined();
    expect(fake.log.some(l => l.table === 'orders' && l.op === 'select')).toBe(false);
  });
});
