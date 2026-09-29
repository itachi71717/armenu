import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes } from './_fakeDb.js';

// Drives the REAL api/_h/order.js handler (tests/order-modifiers.test.js only
// exercises a local copy of the lookup logic).
let fake, dish, itemsInserted, ordersInserted;
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));
vi.mock('../api/_h/push/_send.js', () => ({ sendPush: vi.fn(async () => {}) }));
const { default: handler } = await import('../api/_h/order.js');

const NESTED = [
  { label: 'Cook', required: true, multi: false, options: [
    { name: 'Rare', price_cents_delta: 0 }, { name: 'Medium', price_cents_delta: 0 } ] },
  { label: 'Add-ons', required: false, multi: true, options: [
    { name: 'Bacon', price_cents_delta: 1500 }, { name: 'Discount', price_cents_delta: -99999 } ] },
];

beforeEach(() => {
  itemsInserted = null; ordersInserted = null;
  dish = { id: 'd1', slug: 'burger', name: 'Burger', price_cents: 10000, stock_count: null, modifiers: NESTED };
  fake = makeFakeDb({
    restaurants: () => ({ data: { id: 'r1' } }),
    restaurant_settings: () => ({ data: { orders_enabled: true } }),
    dishes: () => ({ data: [dish] }),
    offers: () => ({ data: [] }),
    orders: (q) => { if (q.op === 'insert') { ordersInserted = q.payload; return { data: { id: 'o1' } }; } return { data: null }; },
    order_items: (q) => { if (q.op === 'insert') itemsInserted = q.payload; return { data: null }; },
  });
});
const order = (mods, extra = {}) => ({
  method: 'POST', headers: {},
  body: { r: 'a', items: [{ dish_slug: 'burger', qty: 2, modifiers: mods, ...extra }] },
});

describe('POST /api/order modifier pricing', () => {
  it('ignores client-sent price_cents_delta and uses the server row', async () => {
    const res = makeRes();
    await handler(order([{ id: '1-0', group: 'Add-ons', price_cents_delta: -50000 }]), res);
    expect(res.statusCode).toBe(200);
    expect(itemsInserted[0].price_cents).toBe(11500);
    expect(itemsInserted[0].modifiers[0]).toMatchObject({ name: 'Bacon', price_cents_delta: 1500 });
    expect(ordersInserted.subtotal_cents).toBe(23000);
  });

  it('matches picks by nested {label, options[]} index key (group + gi-oi)', async () => {
    await handler(order([{ id: '0-1', group: 'Cook' }, { id: '1-0', group: 'Add-ons' }]), makeRes());
    expect(itemsInserted[0].modifiers.map(m => m.name)).toEqual(['Medium', 'Bacon']);
  });

  it('drops picks whose group/id do not exist on the dish (tamper / stale menu)', async () => {
    await handler(order([{ id: '0-1', group: 'Nope' }, { id: '9-9', group: 'Cook' }, { id: '1-0', group: 'Cook' }]), makeRes());
    expect(itemsInserted[0].modifiers).toEqual([]);
    expect(itemsInserted[0].price_cents).toBe(10000);
  });

  it('clamps deltas to +/-50000 and never charges below zero', async () => {
    await handler(order([{ id: '1-1', group: 'Add-ons' }]), makeRes());
    expect(itemsInserted[0].modifiers[0].price_cents_delta).toBe(-50000);
    expect(itemsInserted[0].price_cents).toBe(0);
  });

  it('dish with no modifier data ignores every client pick', async () => {
    dish.modifiers = null;
    await handler(order([{ id: '0-0', group: 'Cook', price_cents_delta: -5000 }]), makeRes());
    expect(itemsInserted[0].modifiers).toEqual([]);
    expect(itemsInserted[0].price_cents).toBe(10000);
  });

  it('flat (non-nested) modifier data on the dish yields no matches', async () => {
    dish.modifiers = [{ name: 'Bacon', price_cents_delta: 1500 }];
    await handler(order([{ id: '0-0', group: '' }]), makeRes());
    expect(itemsInserted[0].modifiers).toEqual([]);
  });

  it('caps picks at 12 per item', async () => {
    dish.modifiers = [{ label: 'G', options: Array.from({ length: 20 }, (_, i) => ({ name: 'o' + i, price_cents_delta: 100 })) }];
    const picks = Array.from({ length: 20 }, (_, i) => ({ id: '0-' + i, group: 'G' }));
    await handler(order(picks), makeRes());
    expect(itemsInserted[0].modifiers).toHaveLength(12);
    expect(itemsInserted[0].price_cents).toBe(11200);
  });

  it('rejects the order when no cart line resolves to a real dish', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { r: 'a', items: [{ dish_slug: 'ghost', qty: 1 }] } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('No valid dishes in cart');
    expect(ordersInserted).toBeNull();
  });
});
