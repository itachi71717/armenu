// Single catch-all API dispatcher.
// Uses DYNAMIC imports so a heavy handler (image processing, PDF, etc.) does
// not slow down cold-start for a lightweight one like /api/dish or /api/settings.
// Each URL suffix → the module path under _h/ to load on demand.
const ROUTES = {
  'dish':         'dish',
  'scan':         'scan',
  'settings':     'settings',
  'order':        'order',
  'waiter-call':  'waiter-call',
  'review':       'review',
  'events':       'events',
  'reservation':  'reservation',

  'push/subscribe': 'push/subscribe',
  'push/vapid-key': 'push/vapid-key',
  'sentry-dsn':     'sentry-dsn',

  'admin/settings':      'admin/settings',
  'admin/categories':    'admin/categories',
  'admin/tables':        'admin/tables',
  'admin/staff':         'admin/staff',
  'admin/orders':        'admin/orders',
  'admin/waiter-calls':  'admin/waiter-calls',
  'admin/reviews':       'admin/reviews',
  'admin/offers':        'admin/offers',
  'admin/analytics':     'admin/analytics',
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
  'admin/reservations':  'admin/reservations',

  'staff/login':  'staff/login',
  'staff/orders': 'staff/orders',
  'staff/tables': 'staff/tables',
  'staff/calls':  'staff/calls',

  'portal/me':             'portal/me',
  'portal/pending-signup': 'portal/pending-signup',
  'portal/request':        'portal/request',
  'portal/manager-token':  'portal/manager-token',

  'paddle/webhook': 'paddle/webhook'
};

const cache = {};

// Simple in-memory rate limiter: 60 req/min per (ip, path-prefix).
// Map is wiped wholesale every 60s so it can never grow unbounded.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
let rateMap = new Map();
setInterval(() => { rateMap = new Map(); }, RATE_WINDOW_MS).unref?.();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
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
  const count = (rateMap.get(rlKey) || 0) + 1;
  rateMap.set(rlKey, count);
  if (count > RATE_LIMIT) {
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
  if (key.startsWith('admin/')) {
    const isMasterAdmin = req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
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

          // If the request names a slug, verify it maps to the token's restaurant
          let requestedSlug = req.query?.slug;
          if (!requestedSlug) {
            // POST /api/admin/dishes uses body.restaurant_slug
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
          const MASTER_ONLY = new Set(['admin/clients', 'admin/overview', 'admin/pending', 'admin/client']);
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
    return res.status(500).json({ error: 'Handler load failed', debug: e.message });
  }
}
