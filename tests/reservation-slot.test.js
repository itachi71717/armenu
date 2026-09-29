import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes, filterVal } from './_fakeDb.js';

let fake, tables, nearby, tzSetting, inserted;
const sendPush = vi.fn(async () => {});
const sendMail = vi.fn(async () => ({ ok: true }));
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));
vi.mock('../api/_h/push/_send.js', () => ({ sendPush: (...a) => sendPush(...a) }));
vi.mock('../api/_h/_audit.js', () => ({ auditLog: vi.fn(async () => {}) }));
vi.mock('../api/_lib/mailer.js', () => ({
  sendMail: (...a) => sendMail(...a),
  buildIcs: (o) => 'ICS:' + o.durationMinutes,
}));
const { default: handler } = await import('../api/_h/reservation.js');

const future = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const post = (extra = {}) => ({
  method: 'POST', headers: { host: 'x.test' },
  body: { r: 'a', guest_name: 'Sam', party_size: 2, reserved_at: future(), ...extra },
});
const ms = (m) => m * 60 * 1000;

beforeEach(() => {
  sendPush.mockClear(); sendMail.mockClear();
  tables = [{ id: 't1' }, { id: 't2' }];
  nearby = [];
  tzSetting = null;
  inserted = null;
  fake = makeFakeDb({
    restaurants: () => ({ data: { id: 'r1', name: 'Bistro', email: 'm@x.test', slug: 'a' } }),
    restaurant_tables: () => ({ data: tables }),
    reservations: (q) => {
      if (q.op === 'insert') {
        inserted = q.payload;
        return { data: { id: 'res1', guest_email: q.payload.guest_email, reserved_at: q.payload.reserved_at } };
      }
      return { data: nearby };
    },
    restaurant_settings: () => ({ data: tzSetting ? { timezone: tzSetting } : null }),
  });
});

describe('reservation slot capacity (overlap window)', () => {
  it('rejects with 409 slot_full when overlapping bookings >= table count', async () => {
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    nearby = [
      { id: 'a', reserved_at: new Date(at.getTime() - ms(30)).toISOString(), duration_minutes: 90 },
      { id: 'b', reserved_at: at.toISOString(), duration_minutes: 90 },
    ];
    const res = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('slot_full');
    expect(inserted).toBeNull();
  });

  it('accepts when overlapping bookings < table count', async () => {
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    nearby = [{ id: 'a', reserved_at: at.toISOString(), duration_minutes: 90 }];
    const res = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), res);
    expect(res.statusCode).toBe(201);
    expect(inserted.status).toBe('pending');
  });

  it('does not count back-to-back bookings (existing ends exactly when new starts)', async () => {
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    tables = [{ id: 't1' }];
    nearby = [{ id: 'a', reserved_at: new Date(at.getTime() - ms(90)).toISOString(), duration_minutes: 90 }];
    const res = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), res);
    expect(res.statusCode).toBe(201);
  });

  it('does not count a booking that starts exactly when the new one ends', async () => {
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    tables = [{ id: 't1' }];
    nearby = [{ id: 'a', reserved_at: new Date(at.getTime() + ms(90)).toISOString(), duration_minutes: 90 }];
    const res = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), res);
    expect(res.statusCode).toBe(201);
  });

  it('honours a longer existing duration_minutes when detecting overlap', async () => {
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    tables = [{ id: 't1' }];
    nearby = [{ id: 'a', reserved_at: new Date(at.getTime() - ms(150)).toISOString(), duration_minutes: 200 }];
    const res = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), res);
    expect(res.statusCode).toBe(409);
  });

  it('queries far enough back to catch a 240-min booking that started 200 min earlier', async () => {
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    await handler(post({ reserved_at: at.toISOString() }), makeRes());
    const q = fake.log.find(l => l.table === 'reservations' && l.op === 'select');
    const lower = new Date(filterVal(q, 'gte', 'reserved_at')).getTime();
    expect(at.getTime() - lower).toBeGreaterThanOrEqual(ms(240));
    const statuses = filterVal(q, 'in', 'status');
    expect(statuses).toEqual(['pending', 'confirmed']);
  });

  it('falls back to a capacity of 20 when the restaurant has no tables', async () => {
    tables = [];
    const at = new Date(Date.now() + 24 * 3600 * 1000);
    nearby = Array.from({ length: 19 }, (_, i) => ({ id: 'n' + i, reserved_at: at.toISOString(), duration_minutes: 90 }));
    const ok = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), ok);
    expect(ok.statusCode).toBe(201);
    nearby.push({ id: 'n20', reserved_at: at.toISOString(), duration_minutes: 90 });
    const full = makeRes();
    await handler(post({ reserved_at: at.toISOString() }), full);
    expect(full.statusCode).toBe(409);
  });
});

describe('reservation input validation', () => {
  it.each([
    [10, 30], [30, 30], [90, 90], [240, 240], [999, 240], ['120', 120], [undefined, 90], ['abc', 90], [0, 90], [-5, 30],
  ])('duration_minutes %s -> stored as %s', async (input, expected) => {
    const res = makeRes();
    await handler(post({ duration_minutes: input }), res);
    expect(res.statusCode).toBe(201);
    expect(inserted.duration_minutes).toBe(expected);
    expect(res.body.ics_data_url).toContain('base64,' + Buffer.from('ICS:' + expected).toString('base64'));
  });

  it('clamps party_size to 1..50 with default 2', async () => {
    await handler(post({ party_size: 500 }), makeRes());
    expect(inserted.party_size).toBe(50);
    await handler(post({ party_size: 'x' }), makeRes());
    expect(inserted.party_size).toBe(2);
    await handler(post({ party_size: -3 }), makeRes());
    expect(inserted.party_size).toBe(1);
  });

  it('rejects past and invalid datetimes and missing fields with 400', async () => {
    for (const reserved_at of [new Date(Date.now() - ms(60)).toISOString(), 'not-a-date']) {
      const res = makeRes();
      await handler(post({ reserved_at }), res);
      expect(res.statusCode).toBe(400);
    }
    const res = makeRes();
    await handler(post({ guest_name: '' }), res);
    expect(res.statusCode).toBe(400);
    expect(inserted).toBeNull();
  });

  it('drops an invalid guest_email but keeps the booking', async () => {
    await handler(post({ guest_email: 'nope' }), makeRes());
    expect(inserted.guest_email).toBeNull();
  });
});

describe('reservation timezone-aware formatting', () => {
  const fmt = (iso, tz) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });

  it('defaults to Africa/Johannesburg', async () => {
    const at = future();
    await handler(post({ reserved_at: at }), makeRes());
    expect(sendPush.mock.calls[0][1].body).toContain(fmt(at, 'Africa/Johannesburg'));
  });

  it('uses restaurant_settings.timezone when set', async () => {
    tzSetting = 'America/New_York';
    const at = future();
    await handler(post({ reserved_at: at }), makeRes());
    expect(sendPush.mock.calls[0][1].body).toContain(fmt(at, 'America/New_York'));
    expect(fmt(at, 'America/New_York')).not.toBe(fmt(at, 'Africa/Johannesburg'));
  });

  it('pushes only to managers', async () => {
    await handler(post(), makeRes());
    expect(sendPush.mock.calls[0][2]).toEqual({ role_filter: 'manager' });
  });
});
