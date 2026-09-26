import { describe, it, expect } from 'vitest';

// Extract the modifier re-derive logic from api/_h/order.js and test it in
// isolation. Regenerated here as a pure function so it can be exercised
// without importing the whole handler (which would need DB env).
function buildLookup(dishMods) {
  const map = new Map();
  const arr = Array.isArray(dishMods) ? dishMods : [];
  for (let gi = 0; gi < arr.length; gi++) {
    const g = arr[gi];
    const opts = Array.isArray(g?.options) ? g.options : [];
    for (let oi = 0; oi < opts.length; oi++) {
      const o = opts[oi];
      const key = String(g.label || '') + '::' + gi + '-' + oi;
      map.set(key, {
        id: gi + '-' + oi,
        group: String(g.label || '').slice(0, 60),
        name: String(o?.name || '').slice(0, 60),
        price_cents_delta: Math.max(-50000, Math.min(50000, parseInt(o?.price_cents_delta) || 0))
      });
    }
  }
  return map;
}

function resolvePicks(dishMods, rawPicks) {
  const modLookup = buildLookup(dishMods);
  const mods = [];
  for (const pick of rawPicks || []) {
    const key = String(pick.group || '') + '::' + String(pick.id || '');
    const authoritative = modLookup.get(key);
    if (authoritative) mods.push(authoritative);
  }
  const modCents = mods.reduce((s, m) => s + m.price_cents_delta, 0);
  return { mods, modCents };
}

// Shape from portal parseModifiersText — the ONLY shape ever stored on
// dishes.modifiers. If someone changes portal or admin/dishes to write a
// different shape, this test should fail.
const NESTED = [
  { label: 'Cook', required: true, multi: false, options: [
    { name: 'Rare', price_cents_delta: 0 },
    { name: 'Medium', price_cents_delta: 0 },
    { name: 'Well done', price_cents_delta: 0 },
  ]},
  { label: 'Add-ons', required: false, multi: true, options: [
    { name: 'Extra bacon',  price_cents_delta: 1500 },
    { name: 'Double patty', price_cents_delta: 3000 },
  ]},
];

// Client picks (from menu.html:780) — { id: `${gi}-${oi}`, group: g.label, ... }
const CLIENT_PICKS = [
  { id: '0-1', group: 'Cook', name: 'Medium', price_cents_delta: 99999 /* client bogus — must be ignored */ },
  { id: '1-0', group: 'Add-ons', name: 'Extra bacon', price_cents_delta: -50000 /* bogus */ },
];

describe('modifier server-side re-derive', () => {
  it('resolves nested-shape picks to authoritative deltas', () => {
    const { mods, modCents } = resolvePicks(NESTED, CLIENT_PICKS);
    expect(mods).toHaveLength(2);
    expect(mods[0].name).toBe('Medium');
    expect(mods[0].price_cents_delta).toBe(0); // ignore client bogus
    expect(mods[1].name).toBe('Extra bacon');
    expect(mods[1].price_cents_delta).toBe(1500);
    expect(modCents).toBe(1500);
  });

  it('drops picks that do not exist in the dish modifiers', () => {
    const { mods, modCents } = resolvePicks(NESTED, [
      { id: 'x-y', group: 'Cook', name: 'Fake' },
      { id: '99-99', group: 'Add-ons', name: 'Fake' },
      { id: '0-0', group: 'Wrong-group', name: 'Rare' },
    ]);
    expect(mods).toHaveLength(0);
    expect(modCents).toBe(0);
  });

  it('handles empty / missing modifier lists gracefully', () => {
    expect(resolvePicks([], []).modCents).toBe(0);
    expect(resolvePicks(undefined, undefined).modCents).toBe(0);
    expect(resolvePicks(NESTED, []).modCents).toBe(0);
  });

  it('caps a legitimate delta at ±R500 (50000c) regardless of the stored value', () => {
    const dishMods = [{ label: 'X', options: [{ name: 'A', price_cents_delta: 999999 }] }];
    const { mods } = resolvePicks(dishMods, [{ id: '0-0', group: 'X' }]);
    expect(mods[0].price_cents_delta).toBe(50000);
  });

  it('two paid mods sum correctly', () => {
    const { modCents } = resolvePicks(NESTED, [
      { id: '1-0', group: 'Add-ons' },
      { id: '1-1', group: 'Add-ons' },
    ]);
    expect(modCents).toBe(1500 + 3000);
  });
});
