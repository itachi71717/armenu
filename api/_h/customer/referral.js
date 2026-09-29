// GET  /api/customer/referral?token=<>  -> { referral_code } (generated on first call)
// POST /api/customer/referral { token, code } -> link this customer as referred by the code's owner.
//   Only allowed while the customer has no orders. Invalid / self / late -> 400 { error: 'invalid' }.
import { randomBytes } from 'node:crypto';
import { supabase } from '../../_db.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_RE = /^[A-Z2-9]{6}$/;

function genCode() {
  const b = randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += B32[b[i] % B32.length];
  return s;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    body = body || {};
  }
  const token = String(req.method === 'GET' ? (req.query?.token || '') : (body.token || ''));
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
  const cust = await resolveCustomerRowByToken(token);
  if (!cust) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (cust.referral_code) return res.status(200).json({ referral_code: cust.referral_code });
    for (let i = 0; i < 5; i++) {
      const code = genCode();
      const { data, error } = await supabase.raw(
        'update customers set referral_code = $1 where id = $2 and referral_code is null returning referral_code',
        [code, cust.id]);
      if (!error && data?.length) return res.status(200).json({ referral_code: code });
      if (!error) { // set concurrently by another request
        const { data: cur } = await supabase.from('customers').select('referral_code').eq('id', cust.id).maybeSingle();
        if (cur?.referral_code) return res.status(200).json({ referral_code: cur.referral_code });
      }
      // unique-violation on the code -> retry with a fresh one
    }
    return res.status(500).json({ error: 'could_not_generate' });
  }

  const invalid = () => res.status(400).json({ error: 'invalid' });
  const code = String(body.code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return invalid();
  if (cust.referred_by) return invalid();
  const { data: owner } = await supabase.from('customers').select('id, merged_into').eq('referral_code', code).maybeSingle();
  if (!owner || owner.merged_into || owner.id === cust.id) return invalid();
  const { data: prior } = await supabase.raw('select 1 from orders where customer_id = $1 limit 1', [cust.id]);
  if (prior?.length) return invalid();
  const { error } = await supabase.from('customers').update({ referred_by: owner.id }).eq('id', cust.id);
  if (error) return invalid();
  return res.status(200).json({ ok: true });
}
