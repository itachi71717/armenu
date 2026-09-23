// GET /api/admin/billing?slug=<r>&plan=<starter|pro|premium>
// Returns { checkout_url } — a Paddle-hosted checkout with the restaurant_id
// embedded in custom_data so the webhook can attribute the subscription.
// Requires env: PADDLE_VENDOR_ID, PADDLE_API_KEY,
//               PADDLE_PRICE_STARTER, PADDLE_PRICE_PRO, PADDLE_PRICE_PREMIUM,
//               PADDLE_ENV ("sandbox" | "production")
import { supabase } from '../_db.js';
import { requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const { slug, plan } = req.query;
  const priceId =
    plan === 'pro'      ? process.env.PADDLE_PRICE_PRO :
    plan === 'premium'  ? process.env.PADDLE_PRICE_PREMIUM :
    process.env.PADDLE_PRICE_STARTER;
  if (!priceId) return res.status(400).json({ error: 'plan not configured on server' });

  const { data: r } = await supabase.from('restaurants').select('id, email').eq('slug', slug).single();
  if (!r) return res.status(404).json({ error: 'not found' });

  const base = process.env.PADDLE_ENV === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';

  const body = {
    items: [{ price_id: priceId, quantity: 1 }],
    customer: { email: r.email },
    custom_data: { restaurant_id: r.id, restaurant_slug: slug },
    collection_mode: 'automatic',
    checkout: { url: 'https://armenu.co.za/admin/restaurant.html?slug=' + slug + '&billing=done' }
  };

  const resp = await fetch(base + '/transactions', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer ' + process.env.PADDLE_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) return res.status(500).json({ error: data.error?.detail || 'paddle error' });
  return res.status(200).json({ checkout_url: data.data?.checkout?.url });
}
