import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the DB shim so POST /api/customer/favourite (toggle) can be
// exercised without a real database. See docs/customer-profiles.md #3.
let customerRow = { id: 'cust-1', token: 'good-token', merged_into: null };
let restaurantRow = null;
let dishRow = null;
let existingFavourite = null; // set to simulate "already favourited"
const insertSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('../api/_db.js', () => {
  const makeChain = (getResult) => ({
    select: () => makeChain(getResult),
    eq: () => makeChain(getResult),
    in: () => makeChain(getResult),
    order: () => makeChain(getResult),
    limit: () => makeChain(getResult),
    maybeSingle: async () => getResult(),
    single: async () => getResult(),
    update: () => makeChain(getResult),
    insert: (...args) => { insertSpy(...args); return makeChain(getResult); },
    delete: (...args) => { deleteSpy(...args); return makeChain(getResult); },
  });
  const supabase = {
    from: (table) => {
      if (table === 'customers') return makeChain(() => ({ data: customerRow }));
      if (table === 'restaurants') return makeChain(() => ({ data: restaurantRow }));
      if (table === 'dishes') return makeChain(() => ({ data: dishRow }));
      if (table === 'customer_favourites') return makeChain(() => ({ data: existingFavourite }));
      return makeChain(() => ({ data: null }));
    }
  };
  return { supabase, supabaseAdmin: supabase, PG_ARRAY_COLS: ['allergies', 'dietary_prefs'] };
});

const { default: handler } = await import('../api/_h/customer/favourite.js');

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

const VALID_TOKEN = '22222222-2222-4222-8222-222222222222';

function baseReq(overrides = {}) {
  return {
    method: 'POST',
    body: { token: VALID_TOKEN, restaurant_slug: 'demo', dish_slug: 'pizza', ...overrides },
    query: {},
  };
}

describe('POST /api/customer/favourite', () => {
  beforeEach(() => {
    insertSpy.mockClear();
    deleteSpy.mockClear();
    customerRow = { id: 'cust-1', token: VALID_TOKEN, merged_into: null };
    restaurantRow = { id: 'rest-1', slug: 'demo' };
    dishRow = { id: 'dish-1', slug: 'pizza', restaurant_id: 'rest-1' };
    existingFavourite = null;
  });

  it('rejects non-POST with 405', async () => {
    const req = { ...baseReq(), method: 'GET' };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects unknown restaurant_slug with 404', async () => {
    restaurantRow = null;
    const req = baseReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects unknown dish_slug with 404', async () => {
    dishRow = null;
    const req = baseReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('first call with valid input returns {favourited: true} and inserts a row', async () => {
    existingFavourite = null;
    const req = baseReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ favourited: true });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('second call with same input returns {favourited: false} and deletes the row', async () => {
    existingFavourite = { customer_id: 'cust-1', dish_id: 'dish-1', restaurant_id: 'rest-1' };
    const req = baseReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ favourited: false });
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an unresolvable token with 404', async () => {
    customerRow = null;
    const req = baseReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
