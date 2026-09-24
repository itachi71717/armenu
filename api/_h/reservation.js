// POST /api/reservation  { r:slug, guest_name, guest_phone?, guest_email?,
//                          party_size, reserved_at(iso), notes? }
// Public. Creates a pending reservation and pushes a notification to the
// restaurant's managers.

import { supabase, supabaseAdmin } from '../_db.js';
import { sendPush } from './push/_send.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { r, guest_name, guest_phone, guest_email, party_size, reserved_at, notes } = body;

  if (!r || !guest_name || !reserved_at) {
    return res.status(400).json({ error: 'restaurant slug, guest_name and reserved_at required' });
  }
  const when = new Date(reserved_at);
  if (isNaN(when) || when.getTime() < Date.now() - 60 * 60 * 1000) {
    return res.status(400).json({ error: 'reserved_at must be a valid future ISO datetime' });
  }
  const size = Math.max(1, Math.min(50, parseInt(party_size) || 2));

  const { data: rest } = await supabase.from('restaurants').select('id, name').eq('slug', r).single();
  if (!rest) return res.status(404).json({ error: 'restaurant not found' });

  const { data: created, error } = await supabaseAdmin.from('reservations').insert({
    restaurant_id: rest.id,
    guest_name,
    guest_phone: guest_phone || null,
    guest_email: guest_email || null,
    party_size: size,
    reserved_at: when.toISOString(),
    notes: notes || null,
    status: 'pending'
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Fire-and-forget push to the manager
  const local = when.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
  sendPush(rest.id, {
    title: 'New reservation',
    body: `${guest_name} · party of ${size} · ${local}`,
    url: '/portal/',
    tag: 'reservation-' + created.id
  }, { role_filter: 'manager' }).catch(() => {});

  return res.status(201).json({ ok: true, reservation_id: created.id });
}
