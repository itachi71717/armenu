// POST /api/customer/hello  { token }
// Public, guest-facing. Upserts a `customers` row keyed on the browser's
// client-generated token (see docs/customer-profiles.md). Called on every
// menu.html page load to get-or-create the customer profile.
import { supabase } from '../../_db.js';

const TOKEN_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export function isValidToken(t) {
  return typeof t === 'string' && TOKEN_RE.test(t);
}

// Follows `merged_into` (bounded — chains should never exceed 1-2 hops in
// practice, but a hard cap keeps a corrupt/cyclic chain from looping forever).
export async function resolveCustomerRowByToken(token) {
  const { data: row } = await supabase.from('customers').select('*').eq('token', token).maybeSingle();
  if (!row) return null;
  let cur = row, hops = 0;
  while (cur.merged_into && hops < 5) {
    const { data: next } = await supabase.from('customers').select('*').eq('id', cur.merged_into).maybeSingle();
    if (!next) break;
    cur = next;
    hops++;
  }
  return cur;
}

// Never expose internal `id` / `merged_into` — externally a customer is
// identified only by their token.
export function toExternalCustomer(row) {
  if (!row) return null;
  return {
    customer_token: row.token,
    name: row.name || null,
    phone: row.phone || null,
    email: row.email || null,
    allergies: row.allergies || [],
    dietary_prefs: row.dietary_prefs || []
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  const { token } = body || {};
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });

  let row = await resolveCustomerRowByToken(token);
  const now = new Date().toISOString();

  if (!row) {
    const { data: created, error } = await supabase.from('customers')
      .insert({ token, last_seen_at: now })
      .select().single();
    if (error) {
      // Unique-violation race (two tabs firing /hello simultaneously) — just
      // re-read the row another request already created.
      row = await resolveCustomerRowByToken(token);
      if (!row) return res.status(500).json({ error: 'Could not create customer' });
    } else {
      row = created;
    }
  } else {
    await supabase.from('customers').update({ last_seen_at: now }).eq('id', row.id);
  }

  return res.status(200).json({ customer: toExternalCustomer(row) });
}
