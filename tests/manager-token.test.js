import { describe, it, expect, beforeAll } from 'vitest';
import { issueManagerToken, verifyManagerToken } from '../api/_h/portal/manager-token.js';

beforeAll(() => {
  process.env.STAFF_SECRET = 'test-staff-secret';
});

describe('manager token round-trip', () => {
  it('a freshly issued token verifies to the same restaurant', () => {
    const rid = '11111111-2222-3333-4444-555555555555';
    const tok = issueManagerToken(rid, 12);
    const v = verifyManagerToken(tok);
    expect(v).not.toBeNull();
    expect(v.restaurant_id).toBe(rid);
    expect(v.role).toBe('manager');
  });

  it('an expired token fails verification', () => {
    const tok = issueManagerToken('abc', -1);
    expect(verifyManagerToken(tok)).toBeNull();
  });

  it('a tampered signature fails verification', () => {
    const tok = issueManagerToken('abc', 12);
    const bad = tok.slice(0, -4) + 'xxxx';
    expect(verifyManagerToken(bad)).toBeNull();
  });

  it('garbage input returns null, not throws', () => {
    expect(verifyManagerToken('not-a-real-token')).toBeNull();
    expect(verifyManagerToken('')).toBeNull();
  });
});
