import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, makeRes } from './_fakeDb.js';

let fake, entries;
vi.mock('../api/_db.js', () => ({
  get supabase() { return fake.db; },
  get supabaseAdmin() { return fake.db; },
}));

const { default: waitlist, _resetJoinLimiter } = await import('../api/_h/waitlist.js');
const { computeOpenState } = await import('../api/_h/dish.js');

const T = (n) => new Date(Date.UTC(2026, 0, 1, 12, n)).toISOString();
let seq;

function setup(initial = []) {
  entries = initial.slice(); seq = 0;
  _resetJoinLimiter();
  fake = makeFakeDb({
    restaurants: () => ({ data: { id: 'r1' } }),
    restaurant_settings: () => ({ data: { is_full: true } }),
    customers: () => ({ data: null }),
    waitlist_entries: (q) => {
      if (q.op === 'insert') {
        const row = { id: '00000000-0000-4000-8000-00000000000' + (++seq), joined_at: T(30 + seq), seated_at: null, left_at: null, ...q.payload };
        entries.push(row);
        return { data: row };
      }
      const rid = q.filters.find(f => f[1] === 'restaurant_id')?.[2];
      const id = q.filters.find(f => f[1] === 'id')?.[2];
      let rows = entries.filter(e => (!rid || e.restaurant_id === rid) && (!id || e.id === id));
      return { data: rows.sort((a, b) => a.joined_at.localeCompare(b.joined_at)) };
    },
  });
}
const join = (body, ip = '1.1.1.1') => ({ method: 'POST', headers: { 'x-vercel-forwarded-for': ip }, body: { r: 'a', guest_name: 'Sam', ...body } });

describe('waitlist position and joining', () => {
  beforeEach(() => setup());

  it('first joiner is position 1 (1-based), next is 2', async () => {
    const r1 = makeRes(); await waitlist(join({ guest_phone: '111' }), r1);
    const r2 = makeRes(); await waitlist(join({ guest_phone: '222' }), r2);
    expect(r1.body.position).toBe(1);
    expect(r2.body.position).toBe(2);
  });

  it('GET reports the same 1-based position and a wait estimate', async () => {
    const j = makeRes(); await waitlist(join({ guest_phone: '111' }), j);
    const g = makeRes(); await waitlist({ method: 'GET', headers: {}, query: { id: j.body.id } }, g);
    expect(g.body).toMatchObject({ position: 1, status: 'waiting' });
    expect(g.body.est_wait_min).toBeGreaterThan(0);
  });

  it('requires a name', async () => {
    const res = makeRes(); await waitlist(join({ guest_name: '   ' }), res);
    expect(res.body.error).toBe('name_required');
    expect(entries).toHaveLength(0);
  });

  it('clamps party size to 1..50', async () => {
    await waitlist(join({ party_size: 9999, guest_phone: '1' }), makeRes());
    await waitlist(join({ party_size: -4, guest_phone: '2' }), makeRes());
    expect(entries.map(e => e.party_size)).toEqual([50, 1]);
  });
});

describe('waitlist spam protection', () => {
  beforeEach(() => setup());

  it('the same phone re-joining gets its existing spot, not a second row', async () => {
    const a = makeRes(); await waitlist(join({ guest_phone: '0712345678' }), a);
    const b = makeRes(); await waitlist(join({ guest_phone: '0712345678' }, '2.2.2.2'), b);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.duplicate).toBe(true);
    expect(entries).toHaveLength(1);
  });

  it('one IP is throttled to 3 joins per window (429 after that)', async () => {
    const codes = [];
    for (let i = 0; i < 5; i++) { const res = makeRes(); await waitlist(join({ guest_phone: 'p' + i }, '9.9.9.9'), res); codes.push(res.statusCode); }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(entries).toHaveLength(3);
  });

  it('a different IP is not affected by another IP being throttled', async () => {
    for (let i = 0; i < 4; i++) await waitlist(join({ guest_phone: 'p' + i }, '9.9.9.9'), makeRes());
    const res = makeRes(); await waitlist(join({ guest_phone: 'other' }, '8.8.8.8'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBeTruthy();
  });
});

describe('computeOpenState (timezone-aware)', () => {
  const hours = { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], sun: [['18:00', '02:00']] };
  // 2026-01-05 is a Monday.
  const at = (iso) => new Date(iso);

  it('empty / missing hours means always open', () => {
    expect(computeOpenState({}, 'UTC').is_open).toBe(true);
    expect(computeOpenState(null, 'UTC').is_open).toBe(true);
    expect(computeOpenState({ mon: [] }, 'UTC').is_open).toBe(true);
  });

  it('evaluates in the restaurant timezone, not UTC', () => {
    // 2026-01-05T07:30Z = Mon 09:30 in Africa/Johannesburg (UTC+2) -> open there, closed in UTC.
    const now = at('2026-01-05T07:30:00Z');
    expect(computeOpenState(hours, 'Africa/Johannesburg', now).is_open).toBe(true);
    expect(computeOpenState(hours, 'UTC', now).is_open).toBe(false);
  });

  it('crosses the date line correctly (Pacific/Auckland is already Tuesday)', () => {
    // 2026-01-05T21:00Z = Tue 10:00 in Auckland (UTC+13 in January) -> Tuesday slot, open.
    expect(computeOpenState(hours, 'Pacific/Auckland', at('2026-01-05T21:00:00Z')).is_open).toBe(true);
  });

  it('closed reports the next opening slot', () => {
    const s = computeOpenState(hours, 'UTC', at('2026-01-05T20:00:00Z')); // Mon 20:00, after close
    expect(s.is_open).toBe(false);
    expect(s.next_open).toMatchObject({ day: 'tue', time: '09:00', days_ahead: 1 });
  });

  it('a slot that spans midnight stays open into the next day', () => {
    // Sun 18:00-02:00. Mon 2026-01-05 01:00 UTC is still inside Sunday's slot.
    expect(computeOpenState(hours, 'UTC', at('2026-01-05T01:00:00Z')).is_open).toBe(true);
    expect(computeOpenState(hours, 'UTC', at('2026-01-05T03:00:00Z')).is_open).toBe(false);
  });

  it('bad timezone degrades to open rather than throwing', () => {
    expect(computeOpenState(hours, 'Not/AZone', at('2026-01-05T20:00:00Z')).is_open).toBe(true);
  });
});
