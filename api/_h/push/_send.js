// Shared push-notification helper. Not a route.
//
//   await sendPush(restaurant_id, { title, body, url, tag, role_filter? })
//
// Fetches all active subscriptions for that restaurant (optionally filtered by
// role: 'kitchen' | 'waiter' | 'manager') and sends the payload via web-push.
// Dead endpoints (410/404) are automatically deactivated.

import webpush from 'web-push';
import { supabase, supabaseAdmin } from '../../_db.js';

let CONFIGURED = false;
function configureOnce() {
  if (CONFIGURED) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:hello@armenu.co.za';
  if (!pub || !priv) return;
  webpush.setVapidDetails(subj, pub, priv);
  CONFIGURED = true;
}

export async function sendPush(restaurant_id, payload = {}, opts = {}) {
  configureOnce();
  if (!CONFIGURED) return { sent: 0, error: 'VAPID not configured' };

  let q = supabase.from('push_subscriptions')
    .select('id, endpoint, keys, role').eq('restaurant_id', restaurant_id).eq('active', true);
  if (opts.role_filter) q = q.eq('role', opts.role_filter);
  const { data: subs } = await q;
  if (!subs || !subs.length) return { sent: 0 };

  const body = JSON.stringify({
    title: payload.title || 'ARMenu',
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || 'armenu',
    icon: '/favicon.svg'
  });

  const results = await Promise.allSettled(subs.map(s =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body).catch(err => { throw { id: s.id, err }; })
  ));

  // Deactivate any dead subscriptions
  const dead = results.filter(r => r.status === 'rejected' && r.reason && r.reason.err && [404, 410].includes(r.reason.err.statusCode))
    .map(r => r.reason.id);
  if (dead.length) {
    await supabaseAdmin.from('push_subscriptions').update({ active: false }).in('id', dead);
  }
  return { sent: results.filter(r => r.status === 'fulfilled').length, dead: dead.length };
}
