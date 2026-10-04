// POST /api/scan
// Called by view.html when a diner scans a dish (fire-and-forget analytics)

import { supabase } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { r, d } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!r || typeof r !== 'string') return res.status(200).end();

    // Single INSERT ... SELECT avoids two round-trips.
    await supabase.raw(`
      insert into scans (restaurant_id, dish_id, user_agent)
      select r.id,
             (select di.id from dishes di where di.restaurant_id = r.id and di.slug = $2 limit 1),
             $3
      from restaurants r where r.slug = $1
    `, [r, d || null, (req.headers['user-agent'] || '').slice(0, 500)]);
  } catch {
    // never fail a scan — it's analytics, not critical
  }

  return res.status(200).end();
}
