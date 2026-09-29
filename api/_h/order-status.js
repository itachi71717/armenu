// GET /api/order-status?id=<order uuid>&token=<customer_token>
//   -> { status, updated_at }
// Public, guest-facing, read-only. The order must belong to the customer the
// token resolves to (merge chain followed); anything else is a 404 so order
// ids can't be probed.
import { supabase } from '../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './customer/hello.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 'no-store');

  const id = String(req.query?.id || '');
  const token = String(req.query?.token || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });

  try {
    const cust = await resolveCustomerRowByToken(token);
    if (!cust) return res.status(404).json({ error: 'not_found' });
    const { data: order } = await supabase.from('orders').select('id, status, customer_id, created_at, updated_at').eq('id', id).maybeSingle();
    if (!order || !order.customer_id || order.customer_id !== cust.id) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ status: order.status, updated_at: order.updated_at || order.created_at || null });
  } catch {
    return res.status(500).json({ error: 'lookup_failed' });
  }
}
