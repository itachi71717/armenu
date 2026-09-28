import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitSql } from '../api/_h/admin/migrate.js';

describe('splitSql', () => {
  it('splits simple statements and drops comments', () => {
    expect(splitSql('select 1; -- note; here\nselect 2;')).toEqual(['select 1', 'select 2']);
  });
  it('keeps semicolons inside quotes', () => {
    expect(splitSql("insert into t values ('a;b'); select \"x;y\";")).toEqual(["insert into t values ('a;b')", 'select "x;y"']);
  });
  it('keeps $$ bodies intact', () => {
    const s = 'do $$ begin if true then perform 1; end if; end $$; select 3;';
    expect(splitSql(s)).toEqual(['do $$ begin if true then perform 1; end if; end $$', 'select 3']);
  });
  it('handles tagged dollar quotes and block comments', () => {
    expect(splitSql('/* a; b */ create function f() returns int as $fn$ select 1; $fn$ language sql;'))
      .toEqual(['create function f() returns int as $fn$ select 1; $fn$ language sql']);
  });
  it('parses the real schema.sql into sane statements', () => {
    const stmts = splitSql(readFileSync('backend/schema.sql', 'utf8'));
    expect(stmts.length).toBeGreaterThan(30);
    for (const s of stmts) expect(s).toMatch(/^(create|alter|insert|update|do|drop|comment)\b/i);
    expect(stmts.some(s => /^do \$\$/i.test(s) && /push_subscriptions_endpoint_key/.test(s))).toBe(true);
  });
});
