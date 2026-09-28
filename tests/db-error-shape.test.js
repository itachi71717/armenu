import { describe, it, expect, vi } from 'vitest';

// Force every SQL call to throw so we exercise the shim's error path.
vi.mock('@neondatabase/serverless', () => ({
  neon: () => async () => { throw Object.assign(new Error('relation "x" does not exist'), { code: '42P01' }); },
  neonConfig: {},
}));

const { supabase } = await import('../api/_db.js');

describe('shim error shape', () => {
  it('list query on error → data [] (iterable) + error', async () => {
    const r = await supabase.from('dishes').select('*').eq('restaurant_id', 'x');
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.error?.code).toBe('42P01');
  });
  it('.single() on error → data null so existence guards fail closed', async () => {
    const r = await supabase.from('restaurants').select('id').eq('slug', 'x').single();
    expect(r.data).toBeNull();
    expect(r.error).toBeTruthy();
  });
  it('.maybeSingle() on error → data null', async () => {
    const r = await supabase.from('orders').select('id').eq('client_order_id', 'k').maybeSingle();
    expect(r.data).toBeNull();
  });
});
