// Single catch-all dispatcher — consolidates every /api/* route into ONE
// Vercel serverless function so we stay under the Hobby-plan 12-function cap.
// Handlers live in api/_h/ (Vercel ignores _-prefixed paths). This file just
// maps URL → handler module and calls its default export.
//
// Route table below; add a new endpoint by dropping a file in api/_h/ and
// adding one line here.
import dish        from './_h/dish.js';
import scan        from './_h/scan.js';
import settings    from './_h/settings.js';
import order       from './_h/order.js';
import waiterCall  from './_h/waiter-call.js';
import review      from './_h/review.js';
import events      from './_h/events.js';

import adminSettings   from './_h/admin/settings.js';
import adminCategories from './_h/admin/categories.js';
import adminTables     from './_h/admin/tables.js';
import adminStaff      from './_h/admin/staff.js';
import adminOrders     from './_h/admin/orders.js';
import adminCalls      from './_h/admin/waiter-calls.js';
import adminReviews    from './_h/admin/reviews.js';
import adminOffers     from './_h/admin/offers.js';
import adminAnalytics  from './_h/admin/analytics.js';
import adminAiGenerate from './_h/admin/ai-generate.js';
import adminAiReader   from './_h/admin/ai-menu-reader.js';
import adminBilling    from './_h/admin/billing.js';
import adminClient     from './_h/admin/client.js';
import adminClients    from './_h/admin/clients.js';
import adminCompress   from './_h/admin/compress.js';
import adminDishes     from './_h/admin/dishes.js';
import adminOverview   from './_h/admin/overview.js';
import adminPending    from './_h/admin/pending.js';
import adminUploadUrl  from './_h/admin/upload-url.js';

import staffLogin   from './_h/staff/login.js';
import staffOrders  from './_h/staff/orders.js';
import staffTables  from './_h/staff/tables.js';
import staffCalls   from './_h/staff/calls.js';

import portalMe          from './_h/portal/me.js';
import portalPending     from './_h/portal/pending-signup.js';
import portalRequest     from './_h/portal/request.js';

import paddleWebhook from './_h/paddle/webhook.js';

// URL suffix (after /api/) → handler
const ROUTES = {
  'dish':          dish,
  'scan':          scan,
  'settings':      settings,
  'order':         order,
  'waiter-call':   waiterCall,
  'review':        review,
  'events':        events,

  'admin/settings':     adminSettings,
  'admin/categories':   adminCategories,
  'admin/tables':       adminTables,
  'admin/staff':        adminStaff,
  'admin/orders':       adminOrders,
  'admin/waiter-calls': adminCalls,
  'admin/reviews':      adminReviews,
  'admin/offers':       adminOffers,
  'admin/analytics':    adminAnalytics,
  'admin/ai-generate':  adminAiGenerate,
  'admin/ai-menu-reader': adminAiReader,
  'admin/billing':      adminBilling,
  'admin/client':       adminClient,
  'admin/clients':      adminClients,
  'admin/compress':     adminCompress,
  'admin/dishes':       adminDishes,
  'admin/overview':     adminOverview,
  'admin/pending':      adminPending,
  'admin/upload-url':   adminUploadUrl,

  'staff/login':  staffLogin,
  'staff/orders': staffOrders,
  'staff/tables': staffTables,
  'staff/calls':  staffCalls,

  'portal/me':               portalMe,
  'portal/pending-signup':   portalPending,
  'portal/request':          portalRequest,

  'paddle/webhook': paddleWebhook
};

export default async function handler(req, res) {
  // Prefer Vercel's [...path] param; fall back to parsing req.url directly.
  let key = '';
  if (Array.isArray(req.query.path)) key = req.query.path.join('/');
  else if (req.query.path) key = String(req.query.path);
  if (!key) {
    const pathname = (req.url || '').split('?')[0];
    key = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  }
  const fn = ROUTES[key];
  if (!fn) return res.status(404).json({ error: 'not found: /api/' + key });
  return fn(req, res);
}
