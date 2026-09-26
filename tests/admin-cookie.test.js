import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readAdminCookie } from '../api/_h/admin/login.js';
import crypto from 'node:crypto';

const SECRET = 'test-admin-secret-for-unit-tests-only';

beforeAll(() => { process.env.ADMIN_SECRET = SECRET; });
afterAll(() => { delete process.env.ADMIN_SECRET; });

function makeCookie(exp, sig) {
  const value = encodeURIComponent(`${exp}.${sig}`);
  return `armenu_admin=${value}`;
}
function sign(exp) {
  return crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
}

describe('readAdminCookie', () => {
  it('returns null when no cookie header', () => {
    expect(readAdminCookie({ headers: {} })).toBeNull();
  });
  it('returns null for an unsigned/malformed cookie', () => {
    expect(readAdminCookie({ headers: { cookie: 'armenu_admin=broken' } })).toBeNull();
  });
  it('returns null for a wrong signature', () => {
    const exp = Date.now() + 60_000;
    const cookie = makeCookie(exp, 'deadbeef'.repeat(8));
    expect(readAdminCookie({ headers: { cookie } })).toBeNull();
  });
  it('returns null for an expired cookie even with a valid signature', () => {
    const exp = Date.now() - 60_000;
    const cookie = makeCookie(exp, sign(exp));
    expect(readAdminCookie({ headers: { cookie } })).toBeNull();
  });
  it('accepts a valid, non-expired signature', () => {
    const exp = Date.now() + 60_000;
    const cookie = makeCookie(exp, sign(exp));
    expect(readAdminCookie({ headers: { cookie } })).toBe(true);
  });
  it('ignores other cookies mixed in', () => {
    const exp = Date.now() + 60_000;
    const cookie = `other=x; armenu_admin=${encodeURIComponent(exp + '.' + sign(exp))}; more=y`;
    expect(readAdminCookie({ headers: { cookie } })).toBe(true);
  });
});
