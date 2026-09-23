// POST /api/paddle/webhook   Paddle Billing (v2) webhook receiver.
// Verifies the signature, updates restaurant_settings.subscription_status / plan.
// Set the endpoint in Paddle dashboard → Notifications → Add destination.
// Requires env:
//   PADDLE_WEBHOOK_SECRET   (Paddle-signed webhook secret from the dashboard)
//   PADDLE_PRICE_STARTER, PADDLE_PRICE_PRO, PADDLE_PRICE_PREMIUM  (price IDs)
import crypto from 'node:crypto';
import { supabaseAdmin } from '../_db.js';

export const config = { api: { bodyParser: false } };

async function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function verify(raw, header) {
  if (!header || !process.env.PADDLE_WEBHOOK_SECRET) return false;
  // Header format: ts=<unix>;h1=<hex>
  const parts = Object.fromEntries(header.split(';').map(kv => kv.split('=')));
  if (!parts.ts || !parts.h1) return false;
  const signed = parts.ts + ':' + raw;
  const expected = crypto.createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1));
}

function planFromPrice(priceId) {
  if (priceId === process.env.PADDLE_PRICE_PRO) return 'pro';
  if (priceId === process.env.PADDLE_PRICE_PREMIUM) return 'premium';
  if (priceId === process.env.PADDLE_PRICE_STARTER) return 'starter';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const raw = await readRaw(req);
  const sig = req.headers['paddle-signature'];
  if (!verify(raw, sig)) return res.status(400).json({ error: 'bad signature' });

  let evt = {};
  try { evt = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad json' }); }

  const kind = evt.event_type;
  const data = evt.data || {};
  const restaurantId = data.custom_data?.restaurant_id;   // set this when you create the checkout
  if (!restaurantId) return res.status(200).json({ ok: true, skipped: 'no restaurant_id in custom_data' });

  const patch = { updated_at: new Date().toISOString() };
  const priceId = data.items?.[0]?.price?.id;
  const plan = planFromPrice(priceId);
  if (plan) patch.plan = plan;

  if (kind === 'subscription.created' || kind === 'subscription.activated') {
    patch.subscription_status = 'active';
    patch.paddle_subscription_id = data.id;
  } else if (kind === 'subscription.canceled') {
    patch.subscription_status = 'cancelled';
  } else if (kind === 'subscription.past_due') {
    patch.subscription_status = 'past_due';
  } else if (kind === 'subscription.paused') {
    patch.subscription_status = 'paused';
  } else if (kind === 'transaction.completed') {
    patch.subscription_status = 'active';
  }

  await supabaseAdmin.from('restaurant_settings').update(patch).eq('restaurant_id', restaurantId);
  return res.status(200).json({ ok: true });
}
