// GET  /api/portal/credits           → { balance, packs, recent }
// POST /api/portal/credits/checkout  { pack_id } → { checkout_url }
//   Creates a Paddle checkout for the given credit pack. On webhook success,
//   the fulfilment step (in paddle/webhook.js) calls grantCredits().
//
// Auth: Clerk manager token (Bearer) — restaurant resolved by email.

import { supabase } from '../../_db.js';
import { requireManager } from '../../_auth.js';
import { CREDIT_PACKS } from '../_quota.js';
import { auditLog } from '../_audit.js';

export default async function handler(req, res) {
  const auth = await requireManager(req);
  if (!auth) return res.status(401).json({ error: 'Sign-in required' });

  const { data: rest } = await supabase.from('restaurants').select('id, slug, name, meshy_credits, email').ilike('email', auth.email).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'no_restaurant_linked' });

  if (req.method === 'GET') {
    // Return balance, available packs, and recent tx log
    const { data: recent = [] } = await supabase.from('credit_transactions')
      .select('kind, delta, balance_after, metadata, created_at')
      .eq('restaurant_id', rest.id).order('created_at', { ascending: false }).limit(20);
    return res.status(200).json({
      restaurant: { slug: rest.slug, name: rest.name },
      balance: rest.meshy_credits || 0,
      packs: CREDIT_PACKS,
      recent
    });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const pack = CREDIT_PACKS.find(p => p.id === body.pack_id);
    if (!pack) return res.status(400).json({ error: 'unknown pack' });

    // If Paddle isn't configured yet, return a placeholder + WhatsApp fallback
    // so managers know how to buy for now.
    if (!process.env.PADDLE_API_KEY) {
      const wa = 'https://wa.me/27683282991?text=' + encodeURIComponent(
        `Hi ARMenu, I'd like to buy the "${pack.label}" credit pack for ${rest.name}. (R${pack.price_zar})`
      );
      auditLog(req, rest.id, 'credits.checkout_requested', { target: pack.id, metadata: { fallback: 'whatsapp', price_zar: pack.price_zar } }).catch(() => {});
      return res.status(200).json({
        checkout_url: null,
        whatsapp_url: wa,
        message: 'Paddle billing isn\'t live yet — for now, tap "Buy on WhatsApp" and ARMenu support will invoice + top up your account within 1 business day.'
      });
    }
    auditLog(req, rest.id, 'credits.checkout_started', { target: pack.id, metadata: { price_zar: pack.price_zar } }).catch(() => {});

    // TODO: full Paddle checkout URL when PADDLE_API_KEY is set. For now stub.
    return res.status(200).json({
      checkout_url: 'https://pay.paddle.com/checkout/PLACEHOLDER',
      pack
    });
  }

  return res.status(405).end();
}
