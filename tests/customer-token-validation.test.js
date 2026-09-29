import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes } from './_fakeDb.js';

let fake, customerRow;
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
  PG_ARRAY_COLS: ['allergies', 'dietary_prefs'],
  toPgArrayLiteral: (a) => '{' + a.join(',') + '}',
}));

const { default: hello, isValidToken } = await import('../api/_h/customer/hello.js');
const { default: favourite } = await import('../api/_h/customer/favourite.js');
const { default: me } = await import('../api/_h/customer/me.js');

const HEX32 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const UUID = 'a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90';

beforeEach(() => {
  customerRow = null;
  fake = makeFakeDb({
    customers: (q) => {
      if (q.op === 'insert') return { data: { id: 'c-new', merged_into: null, ...q.payload } };
      if (q.op === 'select') return { data: customerRow };
      return { data: null };
    },
  });
});

const INVALID = [
  ['empty string', ''],
  ['undefined', undefined],
  ['null', null],
  ['number', 12345678901234567890123456789012],
  ['array', [HEX32]],
  ['too short (31)', HEX32.slice(0, 31)],
  ['too short (8)', 'abcd1234'],
  ['too long (33)', HEX32 + 'a'],
  ['non-hex (g)', 'g'.repeat(32)],
  ['non-hex mid-string', HEX32.slice(0, 10) + 'zz' + HEX32.slice(12)],
  ['whitespace padded', ' ' + HEX32],
  ['sql-ish', "' or 1=1 --"],
];

describe('isValidToken', () => {
  it.each(INVALID)('rejects %s', (_n, t) => { expect(isValidToken(t)).toBe(false); });
  it('accepts 32-char hex', () => { expect(isValidToken(HEX32)).toBe(true); });
  it('accepts uppercase hex', () => { expect(isValidToken(HEX32.toUpperCase())).toBe(true); });
  it('accepts dashed UUID form', () => { expect(isValidToken(UUID)).toBe(true); });
});

describe('customer endpoints answer 400 invalid_token', () => {
  it.each(INVALID)('hello: %s', async (_n, token) => {
    const res = makeRes();
    await hello({ method: 'POST', headers: {}, body: { token } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_token' });
    expect(fake.log).toHaveLength(0);
  });

  it.each(INVALID)('favourite: %s', async (_n, token) => {
    const res = makeRes();
    await favourite({ method: 'POST', headers: {}, body: { token, restaurant_slug: 'a', dish_slug: 'b' } }, res);
    expect(res.statusCode).toBe(400);
    expect(fake.log).toHaveLength(0);
  });

  it('me GET rejects a bad query token without touching the DB', async () => {
    const res = makeRes();
    await me({ method: 'GET', headers: {}, query: { token: 'short' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_token');
    expect(fake.log).toHaveLength(0);
  });

  it('hello with a missing body is 400', async () => {
    const res = makeRes();
    await hello({ method: 'POST', headers: {}, body: undefined }, res);
    expect(res.statusCode).toBe(400);
  });

  it('hello with malformed JSON string body is 400', async () => {
    const res = makeRes();
    await hello({ method: 'POST', headers: {}, body: '{nope' }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('valid tokens are accepted', () => {
  it('hello creates a customer for an unseen 32-char hex token', async () => {
    const res = makeRes();
    await hello({ method: 'POST', headers: {}, body: { token: HEX32 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.customer.customer_token).toBe(HEX32);
    expect(fake.log.some(l => l.op === 'insert' && l.payload.token === HEX32)).toBe(true);
  });

  it('hello never leaks internal id / merged_into', async () => {
    customerRow = { id: 'secret-id', merged_into: null, token: HEX32, name: 'A' };
    const res = makeRes();
    await hello({ method: 'POST', headers: {}, body: { token: HEX32 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.customer).not.toHaveProperty('id');
    expect(res.body.customer).not.toHaveProperty('merged_into');
  });

  it('favourite with a valid token gets past validation (404 when customer unknown)', async () => {
    const res = makeRes();
    await favourite({ method: 'POST', headers: {}, body: { token: HEX32, restaurant_slug: 'a', dish_slug: 'b' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('405 for non-POST on hello', async () => {
    const res = makeRes();
    await hello({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
