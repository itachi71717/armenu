// Shared auth helpers for AR Menu API.
//   requireAdmin(req)   -> true if x-admin-secret header matches env ADMIN_SECRET
//                          OR a valid manager portal_token is present (scoped
//                          to that manager's restaurant only)
//   requireManager(req) -> { email } from a verified Clerk session token, or null
//   getScopedRestaurantId(req) -> uuid | null — set when a portal_token is used

import { createClerkClient, verifyToken } from '@clerk/backend';
import { verifyManagerToken } from './_h/portal/manager-token.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export function requireAdmin(req) {
  if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) return true;
  // Accept a portal_token issued via /api/portal/manager-token — it grants
  // admin rights SCOPED to the manager's own restaurant. Callers that mutate
  // rows should check getScopedRestaurantId(req) and enforce the scope.
  const tok = req.headers['x-portal-token'] || req.query?.portal_token;
  if (tok && verifyManagerToken(tok)) return true;
  return false;
}

export function getScopedRestaurantId(req) {
  // If the caller authenticated with the master ADMIN_SECRET, no scope.
  if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) return null;
  const tok = req.headers['x-portal-token'] || req.query?.portal_token;
  if (!tok) return null;
  const v = verifyManagerToken(tok);
  return v ? v.restaurant_id : null;
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
