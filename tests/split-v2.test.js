import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Fake DB fixtures -------------------------------------------------
const RID = '11111111-1111-1111-1111-111111111111';
const OID = '22222222-2222-2222-2222-222222222222';
let orders, orderItems;

function resetFixtures() {
  orders = [{ id: OID, restaurant_id: RID, total_cents: 3000, paid_cents: 0 }];
  orderItems = [
    { id: 'item-1', order_id: OID, dish_name: 'Steak', qty: 1, price_cents: 2000, paid_by: null, paid_at: null },
    { id: 'item-2', order_id: OID, dish_name: 'Fries', qty: 1, price_cents: 1000, paid_by: null, paid_at: null },
  ];
}
resetFixtures();

// Minimal fake of the supabase-shim surface actually used by
// handleSplitPatch: from(table).select().eq().maybeSingle(), plain
// select().eq() (thenable), and update().eq()/.in() (thenable).
function makeQuery(table) {
  const state = { table, filters: [] };
  const rowsFor = () => (table === 'orders' ? orders : orderItems);
  const applyFilters = (rows) => rows.filter(r => state.filters.every(f => {
    if (f.op === 'in') return f.arr.includes(r[f.col]);
    return r[f.col] === f.val;
  }));
  const runUpdate = () => Promise.resolve().then(() => {
    const rows = applyFilters(rowsFor());
    for (const r of rows) Object.assign(r, state.patch);
    return { data: rows, error: null };
  });
  const api = {
    select() { return api; },
    insert: async () => ({ data: null, error: null }), // audit_log writes — not under test here
    eq(col, val) { state.filters.push({ op: 'eq', col, val }); return api; },
    in(col, arr) { state.filters.push({ op: 'in', col, arr }); return api; },
    async maybeSingle() {
      // Clone — a real DB round-trip never hands back a live reference the
      // caller could accidentally mutate via a later .update() on the same row.
      const rows = applyFilters(rowsFor());
      return { data: rows[0] ? { ...rows[0] } : null };
    },
    then(resolve) {
      // Plain select (no maybeSingle) — thenable resolves here, also cloned.
      resolve({ data: applyFilters(rowsFor()).map(r => ({ ...r })) });
    },
    update(patch) {
      state.patch = patch;
      state.isUpdate = true;
      return {
        eq: (col, val) => { state.filters.push({ op: 'eq', col, val }); return runUpdate(); },
        in: (col, arr) => { state.filters.push({ op: 'in', col, arr }); return runUpdate(); },
      };
    },
  };
  return api;
}

vi.mock('../api/_db.js', () => ({
  supabase: { from: (t) => makeQuery(t) },
  supabaseAdmin: { from: (t) => makeQuery(t) },
}));

const { issueToken } = await import('../api/_h/staff/login.js');
const { default: handler } = await import('../api/_h/staff/orders.js');

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

function makeReq(id, body) {
  const token = issueToken('staff-1', RID);
  return {
    method: 'PATCH',
    query: { id },
    headers: { authorization: 'Bearer ' + token },
    body,
  };
}

beforeEach(() => resetFixtures());

describe('split-v2 PATCH /api/staff/orders', () => {
  it('rejects a paid_by label longer than 40 characters', async () => {
    const res = makeRes();
    await handler(makeReq(OID, { assignments: [{ item_id: 'item-1', paid_by: 'x'.repeat(41) }] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/40/);
    expect(orderItems.find(i => i.id === 'item-1').paid_by).toBeNull(); // untouched
  });

  it('rejects an assignment whose item_id is outside the order', async () => {
    const res = makeRes();
    await handler(makeReq(OID, { assignments: [{ item_id: 'item-does-not-exist', paid_by: 'A' }] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/outside this order/);
  });

  it('assigns items to a label without marking paid (no paid_cents change)', async () => {
    const res = makeRes();
    await handler(makeReq(OID, { assignments: [{ item_id: 'item-1', paid_by: 'A' }, { item_id: 'item-2', paid_by: 'A' }] }), res);
    expect(res.statusCode).toBe(200);
    expect(orderItems.find(i => i.id === 'item-1').paid_by).toBe('A');
    expect(orderItems.find(i => i.id === 'item-2').paid_by).toBe('A');
    expect(orders[0].paid_cents).toBe(0);
    expect(res.body.paid_cents).toBe(0);
  });

  it('marking a label paid sums qty*price_cents for that label and bumps orders.paid_cents', async () => {
    orderItems[0].paid_by = 'A';
    orderItems[1].paid_by = 'A';
    const res = makeRes();
    await handler(makeReq(OID, { mark_paid: 'A' }), res);
    expect(res.statusCode).toBe(200);
    expect(orderItems[0].paid_at).not.toBeNull();
    expect(orderItems[1].paid_at).not.toBeNull();
    expect(orders[0].paid_cents).toBe(3000); // 2000 + 1000
    expect(res.body.paid_cents).toBe(3000);
  });

  it('mark_paid only sums items assigned to that label, and skips already-paid items', async () => {
    orderItems[0].paid_by = 'A';
    orderItems[1].paid_by = 'B';
    orders[0].paid_cents = 500; // some prior partial payment
    const res = makeRes();
    await handler(makeReq(OID, { mark_paid: 'A' }), res);
    expect(orders[0].paid_cents).toBe(500 + 2000); // only item-1's 2000, not item-2's 1000
    expect(orderItems[1].paid_at).toBeNull(); // untouched — different label

    // Re-marking the same now-paid label bumps nothing further.
    const res2 = makeRes();
    await handler(makeReq(OID, { mark_paid: 'A' }), res2);
    expect(orders[0].paid_cents).toBe(500 + 2000);
  });

  it('assignments and mark_paid can be combined in one request', async () => {
    const res = makeRes();
    await handler(makeReq(OID, {
      assignments: [{ item_id: 'item-1', paid_by: 'A' }, { item_id: 'item-2', paid_by: 'A' }],
      mark_paid: 'A',
    }), res);
    expect(res.statusCode).toBe(200);
    expect(orders[0].paid_cents).toBe(3000);
    expect(orderItems.every(i => i.paid_at)).toBe(true);
  });

  it('a request for an order belonging to another restaurant is rejected', async () => {
    orders[0].restaurant_id = 'some-other-restaurant';
    const res = makeRes();
    await handler(makeReq(OID, { mark_paid: 'A' }), res);
    expect(res.statusCode).toBe(404);
  });
});
