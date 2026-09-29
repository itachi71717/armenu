import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes, filterVal } from './_fakeDb.js';

// Manager B must never see or mutate manager A's kitchen stations, and staff
// login must not bind to a station belonging to a different restaurant.
let fake, stations, restaurants, scope;
const auditLog = vi.fn(async () => {});
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));
vi.mock('../api/_auth.js', () => ({
  requireAdmin: () => true,
  assertScope: (req, rid) => (scope && scope !== rid ? { status: 403, error: 'out_of_scope' } : null),
}));
vi.mock('../api/_h/_audit.js', () => ({ auditLog: (...a) => auditLog(...a) }));
vi.mock('../api/_h/portal/manager-token.js', () => ({ verifyManagerToken: () => null }));

const { default: stationsHandler } = await import('../api/_h/admin/kitchen-stations.js');
const { default: staffLogin, verifyToken } = await import('../api/_h/staff/login.js');

beforeEach(() => {
  auditLog.mockClear();
  scope = null;
  restaurants = { a: { id: 'rA', name: 'A' }, b: { id: 'rB', name: 'B' } };
  stations = [
    { id: 'sA1', restaurant_id: 'rA', name: 'Grill', slug: 'grill', is_expo: false, sort_order: 0 },
    { id: 'sB1', restaurant_id: 'rB', name: 'Bar', slug: 'bar', is_expo: false, sort_order: 0 },
  ];
  fake = makeFakeDb({
    restaurants: (q) => ({ data: restaurants[filterVal(q, 'eq', 'slug')] ?? null }),
    staff_login_attempts: () => ({ data: [] }),
    staff: () => ({ data: null }),
    kitchen_stations: (q) => {
      const id = filterVal(q, 'eq', 'id');
      const rid = filterVal(q, 'eq', 'restaurant_id');
      const slug = filterVal(q, 'eq', 'slug');
      if (q.op === 'insert') return { data: { id: 'new', ...q.payload } };
      let rows = stations;
      if (id) rows = rows.filter(s => s.id === id);
      if (rid) rows = rows.filter(s => s.restaurant_id === rid);
      if (slug) rows = rows.filter(s => s.slug === slug);
      return { data: rows };
    },
  });
});

const mgrB = { headers: {} };
const mutations = () => fake.log.filter(l => l.table === 'kitchen_stations' && (l.op === 'update' || l.op === 'delete'));

describe('admin/kitchen-stations cross-restaurant scope', () => {
  it('list: only the requested restaurant\'s stations are returned', async () => {
    const res = makeRes();
    await stationsHandler({ ...mgrB, method: 'GET', query: { slug: 'b' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.stations.map(s => s.id)).toEqual(['sB1']);
  });

  it('list: manager scoped to B asking for A\'s slug gets 403 and no rows', async () => {
    scope = 'rB';
    const res = makeRes();
    await stationsHandler({ ...mgrB, method: 'GET', query: { slug: 'a' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.stations).toBeUndefined();
  });

  it('update: B\'s manager cannot PATCH A\'s station via B\'s own slug (404, no write)', async () => {
    scope = 'rB';
    const res = makeRes();
    await stationsHandler({ ...mgrB, method: 'PATCH', query: { slug: 'b', id: 'sA1' }, body: { name: 'Hacked' } }, res);
    expect(res.statusCode).toBe(404);
    expect(mutations()).toHaveLength(0);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('update: scoped B cannot use A\'s slug either (403)', async () => {
    scope = 'rB';
    const res = makeRes();
    await stationsHandler({ ...mgrB, method: 'PATCH', query: { slug: 'a', id: 'sA1' }, body: { name: 'Hacked' } }, res);
    expect(res.statusCode).toBe(403);
    expect(mutations()).toHaveLength(0);
  });

  it('delete: B\'s manager cannot DELETE A\'s station (404, no write)', async () => {
    scope = 'rB';
    const res = makeRes();
    await stationsHandler({ ...mgrB, method: 'DELETE', query: { slug: 'b', id: 'sA1' } }, res);
    expect(res.statusCode).toBe(404);
    expect(mutations()).toHaveLength(0);
  });

  it('delete: unknown id is 404', async () => {
    const res = makeRes();
    await stationsHandler({ ...mgrB, method: 'DELETE', query: { slug: 'b', id: 'ghost' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('owner can update and delete their own station, both audited', async () => {
    scope = 'rA';
    const up = makeRes();
    await stationsHandler({ headers: {}, method: 'PATCH', query: { slug: 'a', id: 'sA1' }, body: { name: 'Fry', sort_order: '3' } }, up);
    expect(up.statusCode).toBe(200);
    expect(mutations()[0].payload).toEqual({ name: 'Fry', sort_order: 3 });
    const del = makeRes();
    await stationsHandler({ headers: {}, method: 'DELETE', query: { slug: 'a', id: 'sA1' } }, del);
    expect(del.statusCode).toBe(200);
    const actions = auditLog.mock.calls.map(c => c[2]);
    expect(actions).toEqual(['station.update', 'station.delete']);
    expect(auditLog.mock.calls.every(c => c[1] === 'rA')).toBe(true);
  });

  it('create: inserts under the slug\'s restaurant regardless of any body restaurant_id, and audits', async () => {
    const res = makeRes();
    await stationsHandler({ headers: {}, method: 'POST', query: { slug: 'b' }, body: { name: 'Salad Bar', restaurant_id: 'rA' } }, res);
    expect(res.statusCode).toBe(200);
    const ins = fake.log.find(l => l.op === 'insert');
    expect(ins.payload.restaurant_id).toBe('rB');
    expect(ins.payload.slug).toBe('salad-bar');
    expect(auditLog).toHaveBeenCalledWith(expect.anything(), 'rB', 'station.create', expect.anything());
  });

  it('400 when slug missing, 404 when restaurant unknown, 405 for PUT', async () => {
    const a = makeRes(); await stationsHandler({ headers: {}, method: 'GET', query: {} }, a);
    expect(a.statusCode).toBe(400);
    const b = makeRes(); await stationsHandler({ headers: {}, method: 'GET', query: { slug: 'zzz' } }, b);
    expect(b.statusCode).toBe(404);
    const c = makeRes(); await stationsHandler({ headers: {}, method: 'PUT', query: { slug: 'a' } }, c);
    expect(c.statusCode).toBe(405);
  });
});

describe('staff login station_slug scoping', () => {
  it('rejects a station_slug that exists only in another restaurant', async () => {
    const res = makeRes();
    await staffLogin({ method: 'POST', headers: {}, body: { r: 'a', pin: '1234', station_slug: 'bar' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown station');
  });

  it('station lookup is filtered by the login restaurant id', async () => {
    await staffLogin({ method: 'POST', headers: {}, body: { r: 'a', pin: '1234', station_slug: 'grill' } }, makeRes());
    const q = fake.log.find(l => l.table === 'kitchen_stations');
    expect(filterVal(q, 'eq', 'restaurant_id')).toBe('rA');
    expect(filterVal(q, 'eq', 'slug')).toBe('grill');
  });

  it('a valid own-station slug passes the station check (then fails on the wrong PIN, not on the station)', async () => {
    const res = makeRes();
    // pin lookup returns no staff -> 401 after a small artificial delay
    await staffLogin({ method: 'POST', headers: {}, body: { r: 'a', pin: '0000', station_slug: 'grill' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('wrong PIN');
  }, 10_000);

  it('unknown restaurant is 404 before any station lookup', async () => {
    const res = makeRes();
    await staffLogin({ method: 'POST', headers: {}, body: { r: 'nope', pin: '1234', station_slug: 'grill' } }, res);
    expect(res.statusCode).toBe(404);
    expect(fake.log.some(l => l.table === 'kitchen_stations')).toBe(false);
  });

  it('missing r or credentials is 400', async () => {
    const a = makeRes(); await staffLogin({ method: 'POST', headers: {}, body: { pin: '1' } }, a);
    expect(a.statusCode).toBe(400);
    const b = makeRes(); await staffLogin({ method: 'POST', headers: {}, body: { r: 'a' } }, b);
    expect(b.statusCode).toBe(400);
  });

  it('station-bound token verifies with its station and tampering breaks it', async () => {
    const { issueToken } = await import('../api/_h/staff/login.js');
    const tok = issueToken('s1', 'rA', 1, { station_id: 'sA1', is_expo: false });
    expect(verifyToken(tok)).toEqual({ staff_id: 's1', restaurant_id: 'rA', station_id: 'sA1', is_expo: false });
    const raw = Buffer.from(tok, 'base64url').toString().replace(':rA:', ':rB:');
    expect(verifyToken(Buffer.from(raw).toString('base64url'))).toBeNull();
    const expired = issueToken('s1', 'rA', -1);
    expect(verifyToken(expired)).toBeNull();
  });
});
