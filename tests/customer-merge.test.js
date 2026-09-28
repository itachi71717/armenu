import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the DB shim so PATCH /api/customer/me (update + phone-collision merge)
// can be exercised without a real database. See docs/customer-profiles.md #1, #3
// and api/_h/customer/me.js (mergeInto / sanitizePatch).
const CURRENT_TOKEN = '33333333-3333-4333-8333-333333333333';

let currentRow, otherRow, favouritesTable;
const updateSpy = vi.fn();
const rawSpy = vi.fn();
const favouritesDeleteSpy = vi.fn();
const ordersUpdateSpy = vi.fn();

vi.mock('../api/_db.js', () => {
  // Generic filterable chain: each .eq()/.neq()/.is() narrows `filters`,
  // and the terminal .maybeSingle()/.single() resolves against the fake
  // tables below using those filters.
  function rowMatches(row, filters) {
    return Object.entries(filters).every(([k, v]) => {
      if (v && typeof v === 'object' && v.__is__) return (row[k] ?? null) === v.value;
      if (v && typeof v === 'object' && v.__neq__) return row[k] !== v.value;
      return row[k] === v;
    });
  }

  // `pendingOp` defers the actual mutation (and its spy call) until the
  // chain is resolved — either via an explicit .maybeSingle()/.single(), or
  // by being awaited directly (handled via the thenable .then() below).
  // This matches call shapes like `update(x).eq(...)` (awaited directly)
  // and `update(x).eq(...).select().single()` (resolved explicitly).
  function fireOp(table, filters, pendingOp) {
    if (!pendingOp) return;
    if (pendingOp.type === 'update' && table === 'customers') {
      updateSpy(pendingOp.patch, { ...filters });
      if (filters.id === currentRow?.id) currentRow = { ...currentRow, ...pendingOp.patch };
      if (filters.id === otherRow?.id) otherRow = { ...otherRow, ...pendingOp.patch };
    } else if (pendingOp.type === 'update' && table === 'orders') {
      ordersUpdateSpy(pendingOp.patch, { ...filters });
    } else if (pendingOp.type === 'delete' && table === 'customer_favourites') {
      favouritesDeleteSpy({ ...filters });
    }
  }

  const makeChain = (table, filters = {}, pendingOp = null) => ({
    select: () => makeChain(table, filters, pendingOp),
    eq: (col, val) => makeChain(table, { ...filters, [col]: val }, pendingOp),
    neq: (col, val) => makeChain(table, { ...filters, [col]: { __neq__: true, value: val } }, pendingOp),
    is: (col, val) => makeChain(table, { ...filters, [col]: { __is__: true, value: val } }, pendingOp),
    in: () => makeChain(table, filters, pendingOp),
    order: () => makeChain(table, filters, pendingOp),
    limit: () => makeChain(table, filters, pendingOp),
    maybeSingle: async () => {
      fireOp(table, filters, pendingOp);
      if (table === 'customers') {
        const rows = [currentRow, otherRow].filter(Boolean);
        const match = rows.find(r => rowMatches(r, filters));
        return { data: match || null };
      }
      return { data: null };
    },
    single: async function () { return this.maybeSingle(); },
    update: (patch) => makeChain(table, filters, { type: 'update', patch }),
    insert: () => makeChain(table, filters, pendingOp),
    delete: () => makeChain(table, filters, { type: 'delete' }),
    // Makes a bare `await supabase.from(t)...eq(...)` (no explicit
    // maybeSingle/single) resolve and fire the pending op exactly once.
    then: (resolve, reject) => {
      try { fireOp(table, filters, pendingOp); resolve({ data: null, error: null }); }
      catch (e) { reject(e); }
    },
  });

  const supabase = {
    from: (table) => makeChain(table, {}),
    raw: (...args) => { rawSpy(...args); return Promise.resolve({ data: null, error: null }); },
  };
  return { supabase, supabaseAdmin: supabase, PG_ARRAY_COLS: ['allergies', 'dietary_prefs'] };
});

const { default: handler } = await import('../api/_h/customer/me.js');

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

function patchReq(body) {
  return { method: 'PATCH', body: { token: CURRENT_TOKEN, ...body }, query: {} };
}

describe('PATCH /api/customer/me', () => {
  beforeEach(() => {
    updateSpy.mockClear();
    rawSpy.mockClear();
    favouritesDeleteSpy.mockClear();
    ordersUpdateSpy.mockClear();
    currentRow = { id: 'cust-current', token: CURRENT_TOKEN, name: 'Ian', phone: null, email: null, allergies: [], dietary_prefs: [], merged_into: null };
    otherRow = { id: 'cust-other', token: 'other-token', name: 'Other', phone: '0821112222', email: null, allergies: [], dietary_prefs: [], merged_into: null };
  });

  it('merges when phone matches another existing customer: favourites moved, merged_into set, {merged:true, customer:<winner>}', async () => {
    const req = patchReq({ phone: otherRow.phone });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.merged).toBe(true);
    // toExternalCustomer never exposes id — identify the winner by name/phone.
    expect(res.body.customer).toEqual(expect.objectContaining({ name: 'Other', phone: otherRow.phone }));

    // favourites re-pointed to the winner via supabase.raw(), old dupes dropped
    expect(rawSpy).toHaveBeenCalledTimes(1);
    expect(rawSpy.mock.calls[0][1]).toEqual(['cust-other', 'cust-current']);
    expect(favouritesDeleteSpy).toHaveBeenCalledWith({ customer_id: 'cust-current' });

    // orders repointed to the winner
    expect(ordersUpdateSpy).toHaveBeenCalledWith({ customer_id: 'cust-other' }, { customer_id: 'cust-current' });

    // loser (current) row tombstoned with merged_into
    const loserPatchCall = updateSpy.mock.calls.find(([patch, filters]) => filters.id === 'cust-current' && 'merged_into' in patch);
    expect(loserPatchCall).toBeTruthy();
    expect(loserPatchCall[0].merged_into).toBe('cust-other');
  });

  it('updates the current row in place when the phone is new (no collision)', async () => {
    const req = patchReq({ phone: '0827778888' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.merged).toBeFalsy();
    expect(res.body.customer.phone).toBe('0827778888');
    expect(rawSpy).not.toHaveBeenCalled();
  });

  it('caps allergies and dietary_prefs at 20 items and 40 chars each', async () => {
    const longItem = 'x'.repeat(60);
    const manyItems = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const req = patchReq({ allergies: [...manyItems, longItem], dietary_prefs: [...manyItems, longItem] });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.customer.allergies.length).toBeLessThanOrEqual(20);
    expect(res.body.customer.dietary_prefs.length).toBeLessThanOrEqual(20);
    for (const item of res.body.customer.allergies) expect(item.length).toBeLessThanOrEqual(40);
    for (const item of res.body.customer.dietary_prefs) expect(item.length).toBeLessThanOrEqual(40);
  });

  it('caps name at 80 chars', async () => {
    const longName = 'y'.repeat(200);
    const req = patchReq({ name: longName });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.customer.name.length).toBeLessThanOrEqual(80);
  });

  it('rejects an invalid email with 400', async () => {
    const req = patchReq({ email: 'not-an-email' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('400 when token is well-formed but unknown to the DB', async () => {
    const req = { method: 'PATCH', body: { token: '99999999-9999-4999-8999-999999999999', name: 'X' }, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});
