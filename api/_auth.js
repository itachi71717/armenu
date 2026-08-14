// Shared auth helpers for AR Menu API.
//   requireAdmin(req)   -> true if x-admin-secret header matches env ADMIN_SECRET
//   requireManager(req) -> { email } from a verified Clerk session token, or null

import { createClerkClient, verifyToken } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export function requireAdmin(req) {
  return req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
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
