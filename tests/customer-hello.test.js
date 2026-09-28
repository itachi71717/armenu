import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the DB shim so POST /api/customer/hello (upsert-by-token) can be
// exercised without a real database. See docs/customer-profiles.md #3.
let customerRow = null; // existing row keyed by token, or null for "unseen"
const insertSpy = vi.fn();
const updateSpy = vi.fn();

vi.mock('../api/_db.js', () => {
  // A chain that, once .insert()/.update() is called, serves that payload
  // back out of .select().single()/.maybeSingle() — mirroring how the real
  // shim's insert/update builders resolve (see api/_h/order.js).
  const makeChain = (getResult, pending) => ({
    select: () => makeChain(getResult, pending),
    eq: () => makeChain(getResult, pending),
    in: () => makeChain(getResult, pending),
    order: () => makeChain(getResult, pending),
    limit: () => makeChain(getResult, pending),
    maybeSingle: async () => (pending ? { data: pending } : getResult()),
    single: async () => (pending ? { data: pending } : getResult()),
    update: (patch) => {
      updateSpy(patch);
      const merged = { ...(customerRow || {}), ...patch };
      return makeChain(getResult, merged);
    },
    insert: (row) => {
      insertSpy(row);
      const created = { id: 'cust-new', merged_into: null, name: null, phone: null, email: null, allergies: [], dietary_prefs: [], ...row };
      return makeChain(getResult, created);
    },
    delete: () => makeChain(getResult, pending),
  });
  const supabase = {
    from: (table) => {
      if (table === 'customers') return makeChain(() => ({ data: customerRow }));
      return makeChain(() => ({ data: null }));
    }
  };
  return { supabase, supabaseAdmin: supabase, PG_ARRAY_COLS: ['allergies', 'dietary_prefs'] };
});

const { default: handler } = await import('../api/_h/customer/hello.js');

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

const VALID_TOKEN = '11111111-1111-4111-8111-111111111111';

describe('POST /api/customer/hello', () => {
  beforeEach(() => {
    insertSpy.mockClear();
    updateSpy.mockClear();
    customerRow = null;
  });

  it('rejects non-POST with 405', async () => {
    const req = { method: 'GET', body: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects missing token with 400', async () => {
    const req = { method: 'POST', body: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an invalid (non-UUID) token with 400', async () => {
    const req = { method: 'POST', body: { token: 'not-a-uuid' }, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('on a new token, inserts a customer row and returns the created shape', async () => {
    customerRow = null;
    const req = { method: 'POST', body: { token: VALID_TOKEN }, query: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(res.body).toHaveProperty('customer');
    expect(res.body.customer).toEqual(
      expect.objectContaining({
        name: null,
        phone: null,
        allergies: expect.any(Array),
        dietary_prefs: expect.any(Array),
      })
    );
  });

  it('on an existing token, bumps last_seen_at and returns the row unchanged otherwise', async () => {
    customerRow = {
      id: 'cust-1',
      token: VALID_TOKEN,
      name: 'Ian',
      phone: '0821234567',
      allergies: ['peanuts'],
      dietary_prefs: ['vegan'],
      merged_into: null,
    };
    const req = { method: 'POST', body: { token: VALID_TOKEN }, query: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [patch] = updateSpy.mock.calls[0];
    expect(patch).toHaveProperty('last_seen_at');
    expect(res.body.customer.name).toBe('Ian');
    expect(res.body.customer.phone).toBe('0821234567');
  });

  it('follows merged_into when the token resolves to a merged-away row', async () => {
    const winner = {
      id: 'cust-winner',
      token: 'other-token',
      name: 'Winner',
      phone: '0829999999',
      allergies: [],
      dietary_prefs: [],
      merged_into: null,
    };
    let call = 0;
    vi.doMock('../api/_db.js', () => {
      const makeChain = (getResult) => ({
        select: () => makeChain(getResult),
        eq: () => makeChain(getResult),
        maybeSingle: async () => getResult(),
        single: async () => getResult(),
        update: (...args) => { updateSpy(...args); return makeChain(getResult); },
        insert: (...args) => { insertSpy(...args); return makeChain(getResult); },
      });
      const supabase = {
        from: (table) => {
          if (table === 'customers') {
            return makeChain(() => {
              call += 1;
              if (call === 1) {
                return { data: { id: 'cust-loser', token: VALID_TOKEN, merged_into: 'cust-winner' } };
              }
              return { data: winner };
            });
          }
          return makeChain(() => ({ data: null }));
        }
      };
      return { supabase, supabaseAdmin: supabase, PG_ARRAY_COLS: ['allergies', 'dietary_prefs'] };
    });
    vi.resetModules();
    const { default: hello } = await import('../api/_h/customer/hello.js');
    const req = { method: 'POST', body: { token: VALID_TOKEN }, query: {} };
    const res = makeRes();
    await hello(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.customer.name).toBe('Winner');
    vi.doUnmock('../api/_db.js');
    vi.resetModules();
  });

  // The handler's toExternalCustomer() deliberately never exposes the
  // internal `id` or `merged_into` — externally a customer is identified
  // only by their token (see api/_h/customer/hello.js and
  // docs/customer-profiles.md #1: "never trusts a client-sent customer.id").
  it('never returns "id" or "merged_into" in the response', async () => {
    customerRow = {
      id: 'cust-1',
      token: VALID_TOKEN,
      name: 'Ian',
      phone: null,
      allergies: [],
      dietary_prefs: [],
      merged_into: null,
    };
    const req = { method: 'POST', body: { token: VALID_TOKEN }, query: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.body.customer).not.toHaveProperty('id');
    expect(res.body.customer).not.toHaveProperty('merged_into');
  });
});
