// Shared auth helpers for AR Menu API.
//   requireAdmin(req)   -> true if x-admin-secret header matches env ADMIN_SECRET
//                          OR a valid manager portal_token is present (scoped
//                          to that manager's restaurant only)
//   requireManager(req) -> { email } from a verified Clerk session token, or null
//   getScopedRestaurantId(req) -> uuid | null — set when a portal_token is used

import { createClerkClient, verifyToken } from '@clerk/backend';
import { verifyManagerToken } from './_h/portal/manager-token.js';
import { readAdminCookie } from './_h/admin/login.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export function requireAdmin(req) {
  // New path: signed httpOnly cookie (issued by /api/admin/login)
  if (readAdminCookie(req)) return true;
  // Legacy path: raw password in x-admin-secret header. GUARD against the
  // undefined===undefined trap: if ADMIN_SECRET isn't set, no header value
  // should ever authenticate.
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers['x-admin-secret'] === secret) return true;
  // Accept a portal_token issued via /api/portal/manager-token — it grants
  // admin rights SCOPED to the manager's own restaurant. Callers that mutate
  // rows should check getScopedRestaurantId(req) and enforce the scope.
  const tok = req.headers['x-portal-token'] || req.query?.portal_token;
  if (tok && verifyManagerToken(tok)) return true;
  return false;
}

export function getScopedRestaurantId(req) {
  // If the caller authenticated with the master ADMIN_SECRET (cookie or
  // legacy header), no scope enforced.
  if (readAdminCookie(req)) return null;
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers['x-admin-secret'] === secret) return null;
  const tok = req.headers['x-portal-token'] || req.query?.portal_token;
  if (!tok) return null;
  const v = verifyManagerToken(tok);
  return v ? v.restaurant_id : null;
}

// One-shot scope guard for admin handlers. Call it right after resolving a
// restaurant by slug — if a manager portal_token is in play AND the resolved
// restaurant isn't theirs, we return a 403-shaped object. Master admin
// (ADMIN_SECRET) bypasses the check.
//   const guard = assertScope(req, restaurant.id);
//   if (guard) return res.status(guard.status).json({ error: guard.error });
export function assertScope(req, restaurant_id) {
  const scope = getScopedRestaurantId(req);
  if (scope === null) return null;          // master admin, no scope enforced
  if (!restaurant_id) return null;          // nothing to check
  if (String(scope) !== String(restaurant_id)) {
    return { status: 403, error: 'out_of_scope' };
  }
  return null;
}

export async function requireManager(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    if (!payload?.sub) return null;
    const user = await clerk.users.getUser(payload.sub);
    const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();
    if (!email) return null;
    return { email, userId: payload.sub };
  } catch {
    return null;
  }
}
