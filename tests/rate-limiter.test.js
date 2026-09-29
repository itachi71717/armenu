import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRes } from './_fakeDb.js';

// Dispatcher-level limiter (api/index.js). Handlers are stubbed so only the
// limiter itself is exercised. rateMap is module-level, so every test uses a
// unique IP to stay independent.
vi.mock('../api/_h/health.js', () => ({ default: async (req, res) => res.status(200).json({ ok: true }) }));
vi.mock('../api/_h/status.js', () => ({ default: async (req, res) => res.status(200).json({ ok: true }) }));
vi.mock('../api/_h/features.js', () => ({ default: async (req, res) => res.status(200).json({ ok: true }) }));

const { default: dispatch } = await import('../api/index.js');

let n = 0;
const uniqueIp = () => `10.0.${Math.floor(++n / 250)}.${n % 250}`;
const req = (path, ip, extraHeaders = {}) => ({
  method: 'GET', url: '/api/' + path, query: { path }, headers: { 'x-vercel-forwarded-for': ip, ...extraHeaders },
});
async function hit(path, ip) { const res = makeRes(); await dispatch(req(path, ip), res); return res; }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('dispatcher rate limiter', () => {
  it('allows 60 requests per minute and 429s the 61st with Retry-After', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 60; i++) expect((await hit('health', ip)).statusCode).toBe(200);
    const over = await hit('health', ip);
    expect(over.statusCode).toBe(429);
    expect(over.headers['Retry-After']).toBe('60');
    expect(over.body.error).toBe('rate_limited');
  });

  it('keeps counting rejected attempts (still blocked on the 62nd)', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 62; i++) await hit('health', ip);
    expect((await hit('health', ip)).statusCode).toBe(429);
  });

  it('different IPs have separate buckets', async () => {
    const a = uniqueIp(), b = uniqueIp();
    for (let i = 0; i < 61; i++) await hit('health', a);
    expect((await hit('health', a)).statusCode).toBe(429);
    expect((await hit('health', b)).statusCode).toBe(200);
  });

  it('different path prefixes have separate buckets for the same IP', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 61; i++) await hit('health', ip);
    expect((await hit('health', ip)).statusCode).toBe(429);
    expect((await hit('status', ip)).statusCode).toBe(200);
  });

  it('sliding window: old timestamps are pruned so requests resume after 60s', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 61; i++) await hit('health', ip);
    expect((await hit('health', ip)).statusCode).toBe(429);
    vi.setSystemTime(Date.now() + 60_001);
    expect((await hit('health', ip)).statusCode).toBe(200);
  });

  it('sliding window is gradual, not a wholesale reset', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 30; i++) await hit('health', ip);         // t=0
    vi.setSystemTime(Date.now() + 40_000);
    for (let i = 0; i < 30; i++) await hit('health', ip);         // t=40s -> 60 in window
    expect((await hit('health', ip)).statusCode).toBe(429);       // 61st
    vi.setSystemTime(Date.now() + 25_000);                         // t=65s: first 30 expired
    for (let i = 0; i < 28; i++) expect((await hit('health', ip)).statusCode).toBe(200);
  });

  it('unknown routes 404 before consuming any limiter budget', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 70; i++) expect((await hit('nope', ip)).statusCode).toBe(404);
    expect((await hit('health', ip)).statusCode).toBe(200);
  });

  it('uses the first x-vercel-forwarded-for value, not a spoofable x-forwarded-for', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 61; i++) {
      const res = makeRes();
      await dispatch(req('health', ip, { 'x-forwarded-for': 'spoof' + i }), res);
    }
    const res = makeRes();
    await dispatch(req('health', ip, { 'x-forwarded-for': 'fresh' }), res);
    expect(res.statusCode).toBe(429);
  });

  it('without vercel header falls back to the LAST x-forwarded-for hop', async () => {
    const real = uniqueIp();
    const mk = (lead) => ({ method: 'GET', url: '/api/health', query: { path: 'health' }, headers: { 'x-forwarded-for': `${lead}, ${real}` } });
    for (let i = 0; i < 61; i++) await dispatch(mk('lead' + i), makeRes());
    const res = makeRes();
    await dispatch(mk('another-lead'), res);
    expect(res.statusCode).toBe(429);
  });

  it('exhausting one prefix (features) does not affect another (health)', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 61; i++) await hit('features', ip);
    expect((await hit('features', ip)).statusCode).toBe(429);
    expect((await hit('health', ip)).statusCode).toBe(200);
  });
});
