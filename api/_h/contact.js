// POST /api/contact  { name, email, restaurant?, message, type, utm_source? }
// Public (no auth). Saves contact form submissions to pending_signups so the
// admin panel surfaces them, then responds 200 so the form shows its confirmation.
import { supabaseAdmin } from '../_db.js';

const RATE = new Map(); // IP → { count, reset }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Simple per-IP rate limit: 5 submissions per 10 minutes.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const bucket = RATE.get(ip) || { count: 0, reset: now + 600_000 };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + 600_000; }
  bucket.count++;
  RATE.set(ip, bucket);
  if (bucket.count > 5) return res.status(429).json({ error: 'Too many submissions — try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const name    = (body.name    || '').trim().slice(0, 200);
  const email   = (body.email   || '').trim().toLowerCase().slice(0, 200);
  const rest    = (body.restaurant || '').trim().slice(0, 200);
  const message = (body.message || '').trim().slice(0, 2000);
  const type    = ['general','billing','enterprise'].includes(body.type) ? body.type : 'general';
  const utm     = (body.utm_source || 'direct').slice(0, 100);

  if (!email || !message) return res.status(400).json({ error: 'Email and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  // Build the full message string that appears in the admin panel.
  const fullMessage = `[${type}] [utm:${utm}] ${name}: ${message}`;

  // Upsert into pending_signups (unique on lower(email)).
  const { data: existing } = await supabaseAdmin
    .from('pending_signups').select('id').eq('email', email).maybeSingle();

  if (existing) {
    await supabaseAdmin.from('pending_signups').update({
      restaurant_name: rest || undefined,
      message: fullMessage,
      status: 'pending'
    }).eq('id', existing.id);
  } else {
    await supabaseAdmin.from('pending_signups').insert({
      email,
      restaurant_name: rest || null,
      phone: null,
      message: fullMessage,
      status: 'pending'
    });
  }

  return res.status(200).json({ ok: true });
}
