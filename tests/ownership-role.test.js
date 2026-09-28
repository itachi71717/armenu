import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitSql } from '../api/_h/admin/migrate.js';

describe('manager_users ownership-role migration', () => {
  const stmts = splitSql(readFileSync('backend/schema.sql', 'utf8'));

  it('adds the role column and check constraint guarded (idempotent)', () => {
    expect(stmts.some(s =>
      /^alter table manager_users add column if not exists role text/i.test(s)
    )).toBe(true);
    expect(stmts.some(s =>
      /manager_users_role_check/.test(s) && /pg_constraint/.test(s)
    )).toBe(true);
  });

  it('back-fills an owner manager_users row per restaurant, idempotently', () => {
    expect(stmts.some(s =>
      /^do \$\$/i.test(s) &&
      /from restaurants/.test(s) &&
      /role = 'owner'/.test(s) &&
      /insert into manager_users/.test(s)
    )).toBe(true);
  });

  it('enforces at most one owner per restaurant via a partial unique index', () => {
    expect(stmts.some(s =>
      /^create unique index if not exists manager_users_one_owner/i.test(s) &&
      /where role = 'owner'/.test(s)
    )).toBe(true);
  });

  it('parses cleanly alongside the rest of schema.sql', () => {
    expect(stmts.length).toBeGreaterThan(30);
    for (const s of stmts) expect(s).toMatch(/^(create|alter|insert|update|do|drop|comment)\b/i);
  });
});
