// Single catch-all API dispatcher.
// Uses DYNAMIC imports so a heavy handler (image processing, PDF, etc.) does
// not slow down cold-start for a lightweight one like /api/dish or /api/settings.
// Each URL suffix → the module path under _h/ to load on demand.
const ROUTES = {
  'dish':         'dish',
  'scan':         'scan',
  'settings':     'settings',
  'order':        'order',
  'order-status': 'order-status',
  'waiter-call':  'waiter-call',
  'review':       'review',
  'events':       'events',
  'reservation':  'reservation',
  'reservation-capacity': 'reservation-capacity',
  'waitlist':     'waitlist',
  'chat':         'chat',

  'customer/hello':     'customer/hello',
  'customer/me':        'customer/me',
  'customer/favourite': 'customer/favourite',
  'customer/rate-dish': 'customer/rate-dish',
  'customer/dish-photo': 'customer/dish-photo',
  'customer/recommendations': 'customer/recommendations',
  'customer/loyalty':   'customer/loyalty',
  'customer/my-usual':  'customer/my-usual',
  'customer/referral':  'customer/referral',
  'customer/menu-presence': 'customer/menu-presence',

  'push/subscribe': 'push/subscribe',
  'push/vapid-key': 'push/vapid-key',
  'sentry-dsn':     'sentry-dsn',
  'health':         'health',
  'status':         'status',
  'sitemap':        'sitemap',
  'og':             'og',
  'features':       'features',
  'discover':       'discover',
  'contact':        'contact',

  'admin/settings':      'admin/settings',
  'admin/categories':    'admin/categories',
  'admin/tables':        'admin/tables',
  'admin/kitchen-stations': 'admin/kitchen-stations',
  'admin/staff':         'admin/staff',
  'admin/orders':        'admin/orders',
  'admin/waiter-calls':  'admin/waiter-calls',
  'admin/reviews':       'admin/reviews',
  'admin/offers':        'admin/offers',
  'admin/combos':        'admin/combos',
  'admin/analytics':     'admin/analytics',
  'admin/menu-heatmap':  'admin/menu-heatmap',
  'admin/menu-slots':    'admin/menu-slots',
  'admin/bulk-staff':    'admin/bulk-staff',
  'admin/duplicate-restaurant': 'admin/duplicate-restaurant',
  'admin/dish-photos':   'customer/dish-photo',
  'group-order':         'group-order',
  'admin/benchmarks':    'admin/benchmarks',
  'admin/ai-generate':   'admin/ai-generate',
  'admin/ai-menu-reader':'admin/ai-menu-reader',
  'admin/billing':       'admin/billing',
  'admin/client':        'admin/client',
  'admin/clients':       'admin/clients',
  'admin/compress':      'admin/compress',
  'admin/dishes':        'admin/dishes',
  'admin/overview':      'admin/overview',
  'admin/pending':       'admin/pending',
  'admin/upload-url':    'admin/upload-url',
  'admin/compress-image':'admin/upload-url',
  'admin/backup-cron':   'admin/backup-cron',
  'admin/reservations':  'admin/reservations',
  'admin/schedules':     'admin/schedules',
  'admin/categories/reorder': 'admin/categories-reorder',
  'admin/dishes/reorder':     'admin/dishes-reorder',
  'admin/audit':              'admin/audit',
  'admin/badges':             'admin/badges',
  'admin/push-test':          'admin/push-test',
  'admin/walkins':            'admin/walkins',
  'admin/waitlist':           'admin/waitlist',
  'admin/live':               'admin/live',
  'admin/login':              'admin/login',
  'admin/migrate':            'admin/migrate',
  'admin/shifts':             'admin/shifts',
  'admin/prep-sheet':         'admin/prep-sheet',
  'admin/bulk-import':        'admin/bulk-import',
  'admin/bulk-price':         'admin/bulk-price',
  'admin/duplicate-dish':     'admin/duplicate-dish',
  'admin/menu-templates':     'admin/menu-templates',
  'admin/staff-performance':  'admin/staff-performance',
  'admin/daily-summary-cron': 'admin/daily-summary-cron',

  'staff/login':  'staff/login',
  'staff/orders': 'staff/orders',
  'staff/tables': 'staff/tables',
  'staff/calls':  'staff/calls',
  'staff/chat':   'staff/chat',

  'portal/me':             'portal/me',
  'portal/pending-signup': 'portal/pending-signup',
  'portal/request':        'portal/request',
  'portal/manager-token':  'portal/manager-token',
  'portal/credits':        'portal/credits',
  'portal/translate':      'portal/translate',
  'portal/dashboard':      'portal/dashboard',
  'portal/team':           'portal/team',
  'portal/transfer':       'portal/transfer',
  'portal/menu-preview':   'portal/menu-preview',
  'portal/badges':         'portal/badges',

  'paddle/webhook': 'paddle/webhook'
};

const cache = {};

// Simple in-memory rate limiter: 60 req/min per (ip, path-prefix).
// Map is wiped wholesale every 60s so it can never grow unbounded.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
// Per-invocation Map: on Vercel serverless the runtime freezes between calls
// so this only rate-limits requests that share a warm instance. Good enough
// as a spam floor; distributed Redis limit remains a future TODO
// (see NOTES_TODO.md "Rate limit needs Redis" — blocked on Upstash creds).
const rateMap = new Map();

function clientIp(req) {
  // Vercel sets x-vercel-forwarded-for with the true client IP (not spoofable
  // by the client). Prefer it. Fallback: LAST hop of x-forwarded-for — behind
  // Vercel the chain is "client, edge1, edge2..." and only the trailing hops
  // are proxies we control; the LEADING value is client-supplied so anyone
  // could inject a fake IP there to bypass rate limits by cycling values.
  const vercel = req.headers['x-vercel-forwarded-for'];
  if (vercel) return String(vercel).split(',')[0].trim();
  const xf = req.headers['x-forwarded-for'];
  if (xf) {
    const hops = String(xf).split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  // Resolve URL path — either from Vercel [...path] or from req.url directly
  let key = '';
  if (Array.isArray(req.query.path)) key = req.query.path.join('/');
  else if (req.query.path) key = String(req.query.path);
  if (!key) {
    const pathname = (req.url || '').split('?')[0];
    key = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  }
  const modPath = ROUTES[key];
  if (!modPath) return res.status(404).json({ error: 'not found: /api/' + key });

  // Rate limit by (ip, top-level prefix) — e.g. all admin/* share a bucket per ip.
  const prefix = key.split('/')[0] || key;
  const rlKey = clientIp(req) + '|' + prefix;
  // Sliding-window counter: prune anything older than the window on read,
  // then push this timestamp on. Bounded per warm instance.
  const now = Date.now();
  const arr = (rateMap.get(rlKey) || []).filter(t => t > now - RATE_WINDOW_MS);
  arr.push(now);
  rateMap.set(rlKey, arr);
  if (arr.length > RATE_LIMIT) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited', message: 'Too many requests, slow down.' });
  }

  // ============================================================
  // Global scope guard for /api/admin/* routes.
  //
  // When a manager comes through the portal, they carry a portal_token that
  // is bound to ONE restaurant. If they hit an admin route with a `slug` (or
  // `restaurant_slug`) that isn't theirs, we reject with 403 BEFORE the
  // handler runs — so no admin/*.js has to think about it individually.
  //
  // Master admin (x-admin-secret == ADMIN_SECRET) bypasses this check.
  // ============================================================
  // backup-cron authenticates itself with CRON_SECRET (Vercel Cron has no admin session).
  if (key.startsWith('admin/') && key !== 'admin/backup-cron') {
    // Master-admin can arrive via signed cookie (new) OR the legacy header.
    // Guard the header comparison so undefined===undefined can never grant.
    const _adminSecret = process.env.ADMIN_SECRET;
    let isMasterAdmin = !!(_adminSecret && req.headers['x-admin-secret'] === _adminSecret);
    if (!isMasterAdmin) {
      try {
        const { readAdminCookie } = await import('./_h/admin/login.js');
        if (readAdminCookie(req)) isMasterAdmin = true;
      } catch {}
    }
    if (!isMasterAdmin) {
      const portalTok = req.headers['x-portal-token'] || req.query?.portal_token;
      if (portalTok) {
        try {
          const [{ verifyManagerToken }, { supabase }] = await Promise.all([
            import('./_h/portal/manager-token.js'),
            import('./_db.js')
          ]);
          const v = verifyManagerToken(portalTok);
          if (!v) return res.status(401).json({ error: 'invalid_portal_token' });

          // If the request names a slug, verify it maps to the token's restaurant.
          // Body inspection is safe here because Vercel has already buffered
          // req.body (a string or parsed object) BEFORE handler dispatch — this
          // does NOT consume a stream. Handlers that need raw-stream access must
          // require slug in the query string (or bypass admin/*), because their
          // config:{bodyParser:false} leaves req.body === undefined.
          let requestedSlug = req.query?.slug;
          if (!requestedSlug && req.body !== undefined) {
            let body = {};
            try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
            requestedSlug = body?.restaurant_slug || body?.slug;
          }
          if (requestedSlug) {
            const { data: r } = await supabase.from('restaurants').select('id').eq('slug', requestedSlug).maybeSingle();
            if (!r || String(r.id) !== String(v.restaurant_id)) {
              return res.status(403).json({ error: 'out_of_scope', message: 'That restaurant is not yours.' });
            }
          }
          // Cross-restaurant admin routes are master-admin only — a scoped
          // manager token can never call them, even without a slug.
          const MASTER_ONLY = new Set(['admin/clients', 'admin/overview', 'admin/pending', 'admin/client', 'admin/migrate']);
          if (MASTER_ONLY.has(key)) {
            return res.status(403).json({ error: 'out_of_scope', message: 'This endpoint is master-admin only.' });
          }
          // Attach scope so handlers can read it without re-parsing
          req.__scope_restaurant_id = v.restaurant_id;
        } catch (e) {
          console.error('scope guard failed:', e);
          return res.status(500).json({ error: 'scope_check_failed' });
        }
      }
    }
  }

  try {
    let mod = cache[modPath];
    if (!mod) {
      mod = await import('./_h/' + modPath + '.js');
      cache[modPath] = mod;
    }
    const fn = mod.default;
    if (!fn) return res.status(500).json({ error: 'Handler has no default export: ' + modPath });
    return fn(req, res);
  } catch (e) {
    console.error('Dispatcher error for', key, e);
    // Fire-and-forget report to Sentry (no-op if SENTRY_DSN unset)
    try {
      const { captureException } = await import('./_sentry.js');
      await captureException(e, { route: key, method: req.method, ip: clientIp(req) });
    } catch {}
    return res.status(500).json({ error: 'Handler load failed' });
  }
}
