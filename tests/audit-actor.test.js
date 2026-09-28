import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { actorFor } from '../api/_h/_audit.js';
import { requireAdmin } from '../api/_auth.js';

const SECRET = 'test-admin-secret-for-unit-tests-only';

beforeAll(() => { process.env.ADMIN_SECRET = SECRET; });
afterAll(() => { process.env.ADMIN_SECRET = 'test-admin-secret'; });

function sign(exp) {
  return crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
}
function cookieHeader() {
  const exp = Date.now() + 60_000;
  return `armenu_admin=${encodeURIComponent(exp + '.' + sign(exp))}`;
}

describe('admin cookie login is recognised as a first-class admin, not just the legacy header', () => {
  it('actorFor attributes a cookie-authenticated request to "admin" (previously fell through to "system")', () => {
    const req = { headers: { cookie: cookieHeader() } };
    expect(actorFor(req)).toBe('admin');
  });

  it('actorFor still recognises the legacy x-admin-secret header', () => {
    const req = { headers: { 'x-admin-secret': SECRET } };
    expect(actorFor(req)).toBe('admin');
  });

  it('actorFor falls back to "system" with no credentials', () => {
    const req = { headers: {} };
    expect(actorFor(req)).toBe('system');
  });

  it('requireAdmin (used by api/_h/admin/clients.js) accepts the signed admin cookie', () => {
    const req = { headers: { cookie: cookieHeader() }, query: {} };
    expect(requireAdmin(req)).toBe(true);
  });

  it('requireAdmin rejects a request with no credentials at all', () => {
    const req = { headers: {}, query: {} };
    expect(requireAdmin(req)).toBe(false);
  });
});
