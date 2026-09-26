import { describe, it, expect } from 'vitest';
import { toPgArrayLiteral, encodeVal } from '../api/_db.js';

describe('toPgArrayLiteral', () => {
  it('empty array → {}', () => {
    expect(toPgArrayLiteral([])).toBe('{}');
  });
  it('numbers pass through unquoted', () => {
    expect(toPgArrayLiteral([1, 2, 3])).toBe('{1,2,3}');
  });
  it('strings get double-quoted', () => {
    expect(toPgArrayLiteral(['a', 'b'])).toBe('{"a","b"}');
  });
  it('nulls encoded as NULL', () => {
    expect(toPgArrayLiteral([1, null, 3])).toBe('{1,NULL,3}');
  });
  it('escapes embedded quotes and backslashes', () => {
    expect(toPgArrayLiteral(['a"b', 'c\\d'])).toBe('{"a\\"b","c\\\\d"}');
  });
  it('handles uuid-shaped strings', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    expect(toPgArrayLiteral([uuid])).toBe(`{"${uuid}"}`);
  });
});

describe('encodeVal', () => {
  it('null/undefined pass through', () => {
    expect(encodeVal('anything', null)).toBe(null);
    expect(encodeVal('anything', undefined)).toBe(undefined);
  });
  it('Date pass through', () => {
    const d = new Date('2026-01-01');
    expect(encodeVal('created_at', d)).toBe(d);
  });
  it('whitelisted array columns get PG literal, not JSON', () => {
    expect(encodeVal('days_of_week', [1, 2, 3])).toBe('{1,2,3}');
    expect(encodeVal('dish_ids', ['a', 'b'])).toBe('{"a","b"}');
    expect(encodeVal('category_ids', [])).toBe('{}');
    expect(encodeVal('enabled_languages', ['en', 'zu'])).toBe('{"en","zu"}');
  });
  it('non-whitelisted array columns fall through to JSON', () => {
    expect(encodeVal('some_random_col', [1, 2, 3])).toBe('[1,2,3]');
  });
  it('objects get JSON-stringified (jsonb columns)', () => {
    expect(encodeVal('modifiers', { foo: 'bar' })).toBe('{"foo":"bar"}');
    expect(encodeVal('translations', { en: { name: 'Steak' } })).toBe('{"en":{"name":"Steak"}}');
  });
  it('scalars pass through unchanged', () => {
    expect(encodeVal('name', 'Beef Wellington')).toBe('Beef Wellington');
    expect(encodeVal('price_cents', 19500)).toBe(19500);
    expect(encodeVal('active', true)).toBe(true);
  });
});
