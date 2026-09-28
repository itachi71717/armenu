// ARMenu service worker — Web Push notifications + guest menu offline resilience.
// Registered by staff/kitchen/portal pages after opt-in, and by menu.html.

const VER = 'v1';
const SHELL_CACHE = 'armenu-shell-' + VER;
const API_CACHE = 'armenu-api-' + VER;
const ASSET_CACHE = 'armenu-assets-' + VER;
const IMG_CACHE = 'armenu-img-' + VER;
const IMG_META_KEY = '/__armenu_img_meta';
const IMG_CAP = 20 * 1024 * 1024;      // 20MB total
const IMG_MAX_ONE = 8 * 1024 * 1024;   // never cache a single file bigger than this
const OPAQUE_EST = 300 * 1024;         // size guess for opaque cross-origin responses
const NET_TIMEOUT_MS = 6000;

const SHELL_URLS = [
  '/menu.html',
  '/vendor/armenu-errorbar.js',
  '/vendor/armenu-sounds.js',
  '/vendor/armenu-a11y.css',
  '/vendor/sentry-client.js',
  '/vendor/cookie-consent.js',
  '/vendor/armenu-fx.css',
  '/vendor/armenu-fx.js',
  '/vendor/armenu-cmdk.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(SHELL_CACHE);
      // Individually, so one missing file doesn't abort install.
      await Promise.all(SHELL_URLS.map(u => c.add(u).catch(() => {})));
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  try {
    const keep = new Set([SHELL_CACHE, API_CACHE, ASSET_CACHE, IMG_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('armenu-') && !keep.has(k)).map(k => caches.delete(k)));
  } catch {}
  await self.clients.claim();
})()));

function isR2(url) { return /(^|\.)r2\.dev$|\.r2\.cloudflarestorage\.com$/.test(url.hostname); }

function markCached(res) {
  const h = new Headers(res.headers);
  h.set('X-Armenu-Cache', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Stale-while-revalidate for /api/dish and /api/settings.
// Requests carrying X-Armenu-Fresh go network-only (still refresh the cache) so the
// page can revalidate and learn whether it is truly online.
async function apiSWR(event) {
  const req = event.request;
  const cache = await caches.open(API_CACHE);
  const key = req.url;
  const fresh = req.headers.get('X-Armenu-Fresh') === '1';
  const netFetch = () => fetch(new Request(req, { headers: stripFresh(req.headers) })).then(res => {
    if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  if (fresh) return netFetch();
  const cached = await cache.match(key);
  if (cached) {
    event.waitUntil(netFetch().catch(() => {}));
    return markCached(cached);
  }
  return netFetch();
}
function stripFresh(h) { const n = new Headers(h); n.delete('X-Armenu-Fresh'); return n; }

// Cache-first for CSS/JS/fonts (same-origin copies refreshed quietly in background).
async function cacheFirst(event, cacheName, refresh) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const hit = (await caches.match(req)) || (await cache.match(req));
  if (hit) {
    if (refresh) event.waitUntil(fetch(req).then(r => { if (r && r.ok) return cache.put(req, r); }).catch(() => {}));
    return hit;
  }
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
  return res;
}

// ---- Image/GLB: network-first, cache fallback, 20MB LRU ----
let metaChain = Promise.resolve();
function withMeta(fn) {
  const run = metaChain.then(async () => {
    const cache = await caches.open(IMG_CACHE);
    let meta = {};
    try { const m = await cache.match(IMG_META_KEY); if (m) meta = await m.json(); } catch {}
    const out = await fn(meta, cache);
    await cache.put(IMG_META_KEY, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
    return out;
  }).catch(() => {});
  metaChain = run;
  return run;
}

async function imgStore(req, res) {
  let size = OPAQUE_EST;
  if (res.type !== 'opaque') {
    const len = parseInt(res.headers.get('content-length') || '', 10);
    size = len > 0 ? len : (await res.clone().blob()).size;
  }
  if (size > IMG_MAX_ONE) return;
  await withMeta(async (meta, cache) => {
    await cache.put(req, res);
    meta[req.url] = { size, t: Date.now() };
    let total = Object.values(meta).reduce((a, m) => a + m.size, 0);
    const order = Object.keys(meta).sort((a, b) => meta[a].t - meta[b].t);
    for (const k of order) {
      if (total <= IMG_CAP) break;
      if (k === req.url) continue;
      total -= meta[k].size;
      delete meta[k];
      await cache.delete(k);
    }
  });
}

async function imgNetworkFirst(event) {
  const req = event.request;
  const cache = await caches.open(IMG_CACHE);
  const touch = () => withMeta(async (meta) => { if (meta[req.url]) meta[req.url].t = Date.now(); });
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque') && res.status !== 206) {
      event.waitUntil(imgStore(req, res.clone()).catch(() => {}));
    }
    return res;
  });
  const cached = await cache.match(req);
  if (!cached) return net;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT_MS));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch {}
  net.catch(() => {});
  event.waitUntil(touch());
  return cached;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    if (url.pathname === '/api/dish' || url.pathname === '/api/settings') {
      event.respondWith(apiSWR(event).catch(() => fetch(req)));
      return;
    }
    if (url.pathname === '/menu.html') {
      // Network-first navigation; fall back to the installed shell when offline.
      event.respondWith((async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) caches.open(SHELL_CACHE).then(c => c.put('/menu.html', res.clone())).catch(() => {});
          return res;
        } catch (err) {
          const c = await caches.open(SHELL_CACHE);
          const hit = await c.match('/menu.html');
          if (hit) return hit;
          throw err;
        }
      })());
      return;
    }
    if (url.pathname.startsWith('/vendor/') && /\.(css|js|woff2?|ttf)$/.test(url.pathname)) {
      event.respondWith(cacheFirst(event, SHELL_CACHE, true).catch(() => fetch(req)));
      return;
    }
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event, ASSET_CACHE, false).catch(() => fetch(req)));
    return;
  }
  if (isR2(url)) {
    event.respondWith(imgNetworkFirst(event).catch(() => fetch(req)));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ARMenu', body: (event.data && event.data.text()) || '' }; }
  const title = data.title || 'ARMenu';
  const opts = {
    body: data.body || '',
    icon: data.icon || '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'armenu',
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If any window is already at the target URL, focus it
    for (const c of clients) {
      if (c.url.endsWith(url)) return c.focus();
    }
    // Otherwise open a new one
    return self.clients.openWindow(url);
  })());
});
