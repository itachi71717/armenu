import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes, filterVal } from './_fakeDb.js';

let fake, recent, perRest, calls, settings, scope, staffSession;
const auditLog = vi.fn(async () => {});
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));
vi.mock('../api/_h/push/_send.js', () => ({ sendPush: vi.fn(async () => {}) }));
vi.mock('../api/_h/_audit.js', () => ({ auditLog: (...a) => auditLog(...a) }));
vi.mock('../api/_auth.js', () => ({
  requireAdmin: () => true,
  assertScope: (req, rid) => (scope && scope !== rid ? { status: 403, error: 'out_of_scope' } : null),
}));
vi.mock('../api/_h/staff/login.js', () => ({ verifyToken: () => staffSession }));

const { default: publicCall } = await import('../api/_h/waiter-call.js');
const { default: adminCalls } = await import('../api/_h/admin/waiter-calls.js');
const { default: staffCalls } = await import('../api/_h/staff/calls.js');

beforeEach(() => {
  recent = []; perRest = []; calls = {}; scope = null; staffSession = { staff_id: 's', restaurant_id: 'rA' };
  settings = { waiter_call_enabled: true };
  auditLog.mockClear();
  fake = makeFakeDb({
    restaurants: () => ({ data: { id: 'rA' } }),
    restaurant_settings: () => ({ data: settings }),
    restaurant_tables: () => ({ data: { id: 't1', label: '5' } }),
    waiter_calls: (q) => {
      if (q.op === 'insert') return { data: null };
      if (q.op === 'update') return { data: null };
      if (q.op === 'select') {
        const id = filterVal(q, 'eq', 'id');
        if (id) return { data: calls[id] ?? null };
        // dedup query has table_label filter, per-restaurant one does not
        return { data: filterVal(q, 'eq', 'table_label') !== undefined ? recent : perRest };
      }
    },
  });
});
const pub = (body) => ({ method: 'POST', headers: {}, body: { r: 'a', table: '5', ...body } });
const inserts = () => fake.log.filter(l => l.table === 'waiter_calls' && l.op === 'insert');

describe('POST /api/waiter-call bill vs help', () => {
  it('help is the default type; reason is stored trimmed to 40 chars', async () => {
    const res = makeRes();
    await publicCall(pub({ reason: 'x'.repeat(80) }), res);
    expect(res.statusCode).toBe(200);
    expect(inserts()[0].payload).toMatchObject({ type: 'help', restaurant_id: 'rA', table_label: '5' });
    expect(inserts()[0].payload.reason).toHaveLength(40);
  });

  it('type=bill forces reason=bill regardless of client reason', async () => {
    await publicCall(pub({ type: 'bill', reason: 'hacked' }), makeRes());
    expect(inserts()[0].payload).toMatchObject({ type: 'bill', reason: 'bill' });
  });

  it('unknown type collapses to help', async () => {
    await publicCall(pub({ type: 'weird' }), makeRes());
    expect(inserts()[0].payload.type).toBe('help');
  });

  it('dedup query for bill uses eq reason=bill; help uses neq reason=bill', async () => {
    await publicCall(pub({ type: 'bill' }), makeRes());
    let q = fake.log.find(l => l.table === 'waiter_calls' && filterVal(l, 'eq', 'table_label') !== undefined);
    expect(filterVal(q, 'eq', 'reason')).toBe('bill');
    fake.log.length = 0;
    await publicCall(pub({}), makeRes());
    q = fake.log.find(l => l.table === 'waiter_calls' && filterVal(l, 'eq', 'table_label') !== undefined);
    expect(filterVal(q, 'neq', 'reason')).toBe('bill');
  });
});

describe('POST /api/waiter-call dedup + gating', () => {
  it('returns deduped:true and inserts nothing when a same-table call is inside 60s', async () => {
    recent = [{ id: 'old' }];
    const res = makeRes();
    await publicCall(pub({}), res);
    expect(res.body).toMatchObject({ ok: true, deduped: true });
    expect(inserts()).toHaveLength(0);
  });

  it('dedup window is 60 seconds', async () => {
    const before = Date.now();
    await publicCall(pub({}), makeRes());
    const q = fake.log.find(l => l.table === 'waiter_calls' && filterVal(l, 'eq', 'table_label') !== undefined);
    const age = before - new Date(filterVal(q, 'gte', 'created_at')).getTime();
    expect(age).toBeGreaterThanOrEqual(59_000);
    expect(age).toBeLessThanOrEqual(65_000);
  });

  it('429s with Retry-After once 5 calls exist for the restaurant in the last minute', async () => {
    perRest = Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i }));
    const res = makeRes();
    await publicCall(pub({}), res);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('60');
    expect(inserts()).toHaveLength(0);
  });

  it('allows the 5th call (4 existing)', async () => {
    perRest = Array.from({ length: 4 }, (_, i) => ({ id: 'c' + i }));
    const res = makeRes();
    await publicCall(pub({}), res);
    expect(res.statusCode).toBe(200);
    expect(inserts()).toHaveLength(1);
  });

  it('403 when waiter_call_enabled is off or settings row is missing', async () => {
    settings = { waiter_call_enabled: false };
    const a = makeRes(); await publicCall(pub({}), a);
    expect(a.statusCode).toBe(403);
    settings = null;
    const b = makeRes(); await publicCall(pub({}), b);
    expect(b.statusCode).toBe(403);
  });

  it('400 without r, 405 for GET', async () => {
    const a = makeRes(); await publicCall({ method: 'POST', headers: {}, body: {} }, a);
    expect(a.statusCode).toBe(400);
    const b = makeRes(); await publicCall({ method: 'GET', headers: {} }, b);
    expect(b.statusCode).toBe(405);
  });

  it('a call without a table skips per-table dedup', async () => {
    recent = [{ id: 'old' }];
    const res = makeRes();
    await publicCall({ method: 'POST', headers: {}, body: { r: 'a' } }, res);
    expect(res.body).toEqual({ ok: true });
    expect(inserts()).toHaveLength(1);
  });
});

describe('admin/waiter-calls scope', () => {
  it('scoped manager cannot acknowledge another restaurant\'s call', async () => {
    calls.c1 = { restaurant_id: 'rB' };
    scope = 'rA';
    const res = makeRes();
    await adminCalls({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { status: 'acknowledged' } }, res);
    expect(res.statusCode).toBe(403);
    expect(fake.log.some(l => l.op === 'update')).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('own restaurant PATCH updates and audits', async () => {
    calls.c1 = { restaurant_id: 'rA' };
    scope = 'rA';
    const res = makeRes();
    await adminCalls({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { status: 'acknowledged' } }, res);
    expect(res.statusCode).toBe(200);
    expect(fake.log.find(l => l.op === 'update').payload).toEqual({ status: 'acknowledged' });
    expect(auditLog).toHaveBeenCalledWith(expect.anything(), 'rA', 'waiter_call.update', expect.anything());
  });

  it('404 for unknown call id', async () => {
    const res = makeRes();
    await adminCalls({ method: 'PATCH', query: { id: 'nope' }, headers: {}, body: { status: 'closed' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('closing sets closed_at', async () => {
    calls.c1 = { restaurant_id: 'rA' };
    await adminCalls({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { status: 'closed' } }, makeRes());
    expect(fake.log.find(l => l.op === 'update').payload.closed_at).toBeTruthy();
  });

  it('rejects an arbitrary status string with 400 and writes nothing', async () => {
    // Bug fix: status was previously written unvalidated.
    calls.c1 = { restaurant_id: 'rA' };
    const res = makeRes();
    await adminCalls({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { status: 'lol; drop' } }, res);
    expect(res.statusCode).toBe(400);
    expect(fake.log.some(l => l.op === 'update')).toBe(false);
  });

  it('GET is scoped: manager for A gets 403 on restaurant B slug', async () => {
    scope = 'rZ';
    const res = makeRes();
    await adminCalls({ method: 'GET', query: { slug: 'a' }, headers: {} }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('staff/calls scope', () => {
  it('401 without a valid staff token', async () => {
    staffSession = null;
    const res = makeRes();
    await staffCalls({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it('staff of restaurant A gets 404 acking restaurant B\'s call', async () => {
    calls.c1 = { restaurant_id: 'rB' };
    const res = makeRes();
    await staffCalls({ method: 'PATCH', headers: {}, query: { id: 'c1' }, body: { status: 'acknowledged' } }, res);
    expect(res.statusCode).toBe(404);
    expect(fake.log.some(l => l.op === 'update')).toBe(false);
  });

  it('staff can ack own call; bad status is 400', async () => {
    calls.c1 = { restaurant_id: 'rA' };
    const ok = makeRes();
    await staffCalls({ method: 'PATCH', headers: {}, query: { id: 'c1' }, body: { status: 'acknowledged' } }, ok);
    expect(ok.statusCode).toBe(200);
    const bad = makeRes();
    await staffCalls({ method: 'PATCH', headers: {}, query: { id: 'c1' }, body: { status: 'nuke' } }, bad);
    expect(bad.statusCode).toBe(400);
  });

  it('GET lists only the session restaurant and excludes closed calls', async () => {
    await staffCalls({ method: 'GET', headers: {}, query: {} }, makeRes());
    const q = fake.log.find(l => l.table === 'waiter_calls');
    expect(filterVal(q, 'eq', 'restaurant_id')).toBe('rA');
    expect(filterVal(q, 'neq', 'status')).toBe('closed');
  });
});
