#!/usr/bin/env node
// End-to-end smoke test for public ARMenu flows.
//   node scripts/smoke.mjs                       → https://armenu.co.za
//   BASE=http://localhost:5173 node scripts/smoke.mjs
//   SLUG=demo node scripts/smoke.mjs
// Read-only: never creates orders/reservations. Exits non-zero on failure.
const BASE = (process.env.BASE || 'https://armenu.co.za').replace(/\/$/, '');
const SLUG = process.env.SLUG || 'demo';
const results = [];

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ ok: true, name, ms: Date.now() - t0, detail: detail || '' });
  } catch (e) {
    results.push({ ok: false, name, ms: Date.now() - t0, detail: e.message });
  }
}
async function get(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts, signal: AbortSignal.timeout(20000) });
  return res;
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

let firstDish = null;

await check('health: API + DB reachable', async () => {
  const r = await get('/api/health'); const j = await r.json();
  assert(r.status === 200 && j.ok && j.db_ok, `status ${r.status} ${JSON.stringify(j)}`);
  return `db ${j.db_ms}ms`;
});
await check('features endpoint', async () => {
  const r = await get('/api/features'); const j = await r.json();
  assert(r.status === 200 && typeof j.push === 'boolean', `status ${r.status}`);
  return Object.entries(j).filter(([, v]) => v === true).map(([k]) => k).join(',') || 'none enabled';
});
await check(`menu API returns dishes for "${SLUG}"`, async () => {
  const r = await get('/api/dish?r=' + SLUG); const j = await r.json();
  assert(r.status === 200 && Array.isArray(j.dishes) && j.dishes.length, `status ${r.status}, dishes=${j.dishes?.length}`);
  firstDish = j.dishes[0];
  return `${j.dishes.length} dish(es), restaurant "${j.restaurant?.name}"`;
});
await check('dish detail exposes stock/modifiers for AR add-to-cart gating', async () => {
  assert(firstDish, 'no dish from previous step');
  const r = await get(`/api/dish?r=${SLUG}&d=${encodeURIComponent(firstDish.slug)}`); const j = await r.json();
  assert(r.status === 200 && j.dish, `status ${r.status}`);
  assert('sold_out' in j && Array.isArray(j.modifiers), 'sold_out/modifiers missing (old deploy?)');
  assert(j.glb, 'dish has no glb URL');
  firstDish.glb = j.glb;
  return `glb → ${new URL(j.glb, BASE).host}`;
});
await check('dish 3D model is downloadable with a model content-type', async () => {
  assert(firstDish?.glb, 'no glb');
  const url = new URL(firstDish.glb, BASE).toString();
  const r = await fetch(url, { method: 'HEAD', headers: { Origin: 'https://armenu.co.za' }, signal: AbortSignal.timeout(20000) });
  assert(r.status === 200, `HEAD ${url} → ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  assert(/model\/|octet-stream/.test(ct), `content-type "${ct}"`);
  const cors = r.headers.get('access-control-allow-origin');
  if (!url.startsWith(BASE)) assert(cors, 'cross-origin model has no CORS header');
  return `${ct}${cors ? ', CORS ' + cors : ''}`;
});
await check('unknown restaurant → 404 JSON (not a crash)', async () => {
  const r = await get('/api/dish?r=__nope__'); assert(r.status === 404, `status ${r.status}`);
});
for (const p of [`/m/${SLUG}`, `/t/${SLUG}/1`, `/view.html?r=${SLUG}&d=${firstDish?.slug || ''}`]) {
  await check(`page ${p} serves HTML`, async () => {
    const r = await get(p); const html = await r.text();
    assert(r.status === 200 && /<html/i.test(html), `status ${r.status}`);
    if (p.startsWith('/m/') || p.startsWith('/t/')) assert(html.includes('location.pathname'), 'menu.html lacks path-based slug parsing (QR links would break)');
  });
}
for (const p of ['/', '/how', '/why', '/faq', '/pricing', '/contact', '/legal', '/dishes', '/portal/', '/staff', '/kitchen', '/admin/']) {
  await check(`page ${p}`, async () => { const r = await get(p); assert(r.status === 200, `status ${r.status}`); });
}
for (const p of ['/vendor/armenu-a11y.css', '/vendor/models/dish.glb', '/favicon.svg', '/manifest.json', '/sitemap.xml', '/robots.txt', '/sw.js']) {
  await check(`asset ${p}`, async () => { const r = await get(p, { method: 'HEAD' }); assert(r.status === 200, `status ${r.status}`); });
}
await check('admin API rejects anonymous callers', async () => {
  const r = await get('/api/admin/overview'); assert(r.status === 401, `status ${r.status} (expected 401)`);
});
await check('admin login reports unauthenticated without cookie', async () => {
  const r = await get('/api/admin/login'); const j = await r.json();
  assert(r.status === 200 && j.authenticated === false, JSON.stringify(j));
});
await check('reservation validation rejects empty payload', async () => {
  const r = await get('/api/reservation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert(r.status === 400, `status ${r.status}`);
});
await check('order validation rejects empty cart', async () => {
  const r = await get('/api/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ r: SLUG, items: [] }) });
  assert(r.status === 400, `status ${r.status}`);
});
await check('unknown API route → 404', async () => {
  const r = await get('/api/definitely-not-a-route'); assert(r.status === 404, `status ${r.status}`);
});

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${pad(r.name, 62)} ${pad(r.ms + 'ms', 7)} ${r.detail}`);
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed against ${BASE}`);
process.exit(failed.length ? 1 : 0);
