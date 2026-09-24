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
    return res.status(500).json({ error: 'Handler load failed', debug: e.message });
  }
}
