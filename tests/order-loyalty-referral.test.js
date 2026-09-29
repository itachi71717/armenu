import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes } from './_fakeDb.js';

let fake, cfg;
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));
vi.mock('../api/_h/push/_send.js', () => ({ sendPush: vi.fn(async () => {}) }));

const { default: handler } = await import('../api/_h/order.js');

const TOKEN = '11111111-1111-4111-8111-111111111111';

function setup(over = {}) {
  cfg = { price: 20000, stamps: 10, referredBy: null, priorOrders: 0, hours: undefined, tz: undefined, ...over };
  const inserted = { orders: [], stamps: [] };
  const rawCalls = [];
  fake = makeFakeDb({
    restaurants: () => ({ data: { id: 'r1' } }),
    restaurant_settings: () => ({ data: {
      orders_enabled: true, default_currency: 'ZAR',
      loyalty_threshold: 10, loyalty_reward_cents: 5000, loyalty_enabled: true,
      opening_hours: cfg.hours, timezone: cfg.tz,
    } }),
    dishes: () => ({ data: [{ id: 'd1', slug: 'steak', name: 'Steak', price_cents: cfg.price, stock_count: null, modifiers: [] }] }),
    offers: () => ({ data: [] }),
    customers: (q) => {
      if (q.filters.some(f => f[1] === 'token')) return { data: { id: 'c1', merged_into: null } };
      return { data: { referred_by: cfg.referredBy } };
    },
    orders: (q) => {
      if (q.op === 'insert') { inserted.orders.push(q.payload); return { data: { id: 'o1' } }; }
      return { data: null };
    },
    order_items: () => ({ data: null }),
    loyalty_stamps: (q) => { if (q.op === 'insert') inserted.stamps.push(q.payload); return { data: null }; },
    __raw: (sql, args) => {
      rawCalls.push({ sql, args });
      if (/count\(\*\)::int as n from loyalty_stamps/.test(sql)) return { data: [{ n: cfg.stamps }] };
      if (/from orders where customer_id/.test(sql)) return { data: cfg.priorOrders ? [{ '?column?': 1 }] : [] };
      if (/update customers set referred_by = null/.test(sql)) return { data: [{ id: 'c1' }] };
      return { data: [{ id: 'x' }] };
    },
  });
  return { inserted, rawCalls };
}
const post = (extra = {}) => ({
  method: 'POST', headers: {},
  body: { r: 'a', customer_token: TOKEN, items: [{ dish_slug: 'steak', qty: 1 }], ...extra },
});

describe('loyalty redemption on POST /api/order', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('redeems at exactly the threshold: discounts the reward and consumes 10 stamps, then awards 1 for this order', async () => {
    const res = makeRes();
    await handler(post({ redeem_loyalty: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.loyalty_discount_cents).toBe(5000);
    expect(res.body.total_cents).toBe(20000 - 5000);
    expect(ctx.inserted.orders[0]).toMatchObject({ loyalty_redeemed: true, loyalty_discount_cents: 5000 });
    const del = ctx.rawCalls.find(c => /delete from loyalty_stamps/.test(c.sql));
    expect(del.args).toEqual(['c1', 'r1', 10]); // consumes 10, not 11
    expect(ctx.inserted.stamps).toHaveLength(1);
    expect(ctx.inserted.stamps[0]).toMatchObject({ customer_id: 'c1', restaurant_id: 'r1', order_id: 'o1' });
  });

  it('does not discount when the guest is one stamp short', async () => {
    ctx = setup({ stamps: 9 });
    const res = makeRes();
    await handler(post({ redeem_loyalty: true }), res);
    expect(res.body.loyalty_discount_cents).toBe(0);
    expect(res.body.total_cents).toBe(20000);
    expect(ctx.rawCalls.some(c => /delete from loyalty_stamps/.test(c.sql))).toBe(false);
    expect(ctx.inserted.stamps).toHaveLength(1); // still earns this order's stamp
  });

  it('never redeems unless redeem_loyalty === true', async () => {
    const res = makeRes();
    await handler(post({ redeem_loyalty: 'yes' }), res);
    expect(res.body.loyalty_discount_cents).toBe(0);
    expect(ctx.rawCalls.some(c => /delete from loyalty_stamps/.test(c.sql))).toBe(false);
  });

  it('caps the discount at the subtotal', async () => {
    ctx = setup({ price: 3000 }); // reward is 5000
    const res = makeRes();
    await handler(post({ redeem_loyalty: true }), res);
    expect(res.body.loyalty_discount_cents).toBe(3000);
    expect(res.body.total_cents).toBe(0);
  });
});

describe('referral discount on POST /api/order', () => {
  it('applies 10% once on the referred customer\'s first order and clears referred_by', async () => {
    const ctx = setup({ stamps: 0, referredBy: 'ref1', priorOrders: 0 });
    const res = makeRes();
    await handler(post(), res);
    expect(res.body.referral_discount_cents).toBe(2000);
    expect(res.body.total_cents).toBe(18000);
    expect(ctx.inserted.orders[0].referral_discount_cents).toBe(2000);
    expect(ctx.rawCalls.some(c => /update customers set referred_by = null/.test(c.sql))).toBe(true);
    const bonus = ctx.inserted.stamps.find(p => Array.isArray(p));
    expect(bonus).toHaveLength(2);
    expect(bonus.every(s => s.customer_id === 'ref1')).toBe(true);
  });

  it('gives no discount when the customer has ordered before', async () => {
    const ctx = setup({ stamps: 0, referredBy: 'ref1', priorOrders: 1 });
    const res = makeRes();
    await handler(post(), res);
    expect(res.body.referral_discount_cents).toBe(0);
    expect(res.body.total_cents).toBe(20000);
    expect(ctx.rawCalls.some(c => /update customers set referred_by = null/.test(c.sql))).toBe(false);
  });

  it('gives no discount when the customer was not referred', async () => {
    setup({ stamps: 0, referredBy: null });
    const res = makeRes();
    await handler(post(), res);
    expect(res.body.referral_discount_cents).toBe(0);
  });

  it('ignores a self-referral', async () => {
    setup({ stamps: 0, referredBy: 'c1' });
    const res = makeRes();
    await handler(post(), res);
    expect(res.body.referral_discount_cents).toBe(0);
  });
});

describe('opening hours gate on POST /api/order', () => {
  it('rejects with 403 closed outside opening hours (restaurant timezone, not UTC)', async () => {
    // A slot that never contains "now" in any timezone: 1 minute long, at an arbitrary time.
    // Build hours for every day from a 1-minute window that is not the current minute.
    const d = new Date();
    const hhmm = (dt) => dt.toISOString().slice(11, 16);
    const start = new Date(d.getTime() + 6 * 3600 * 1000), end = new Date(start.getTime() + 60 * 1000);
    // Use UTC as the restaurant timezone so the window maths above is exact.
    const slot = [[hhmm(start), hhmm(end)]];
    const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(k => [k, slot]));
    setup({ hours, tz: 'UTC' });
    const res = makeRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('closed');
  });

  it('accepts orders when opening_hours is empty (always open)', async () => {
    setup({ hours: {} });
    const res = makeRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
  });
});
