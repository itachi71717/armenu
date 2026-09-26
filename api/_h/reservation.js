// POST /api/reservation  { r:slug, guest_name, guest_phone?, guest_email?,
//                          party_size, reserved_at(iso), notes? }
// Public. Creates a pending reservation and pushes a notification to the
// restaurant's managers.

import { supabase, supabaseAdmin } from '../_db.js';
import { sendPush } from './push/_send.js';
import { auditLog } from './_audit.js';

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

  // Time-slot capacity check: don't accept a booking if the restaurant already
  // has ≥ their table count of confirmed/pending reservations within a 90-min
  // window around the requested time. Prevents overbooking.
  // The restaurant's TABLE count = ceiling for concurrent bookings. If they
  // haven't set up tables, we fall back to a generous default of 20 slots.
  try {
    const [{ data: tbls = [] }, { data: nearby = [] }] = await Promise.all([
      supabase.from('restaurant_tables').select('id').eq('restaurant_id', rest.id),
      supabase.from('reservations')
        .select('id, reserved_at, duration_minutes, status')
        .eq('restaurant_id', rest.id)
        .in('status', ['pending', 'confirmed'])
        .gte('reserved_at', new Date(when.getTime() - 90 * 60 * 1000).toISOString())
        .lte('reserved_at', new Date(when.getTime() + 90 * 60 * 1000).toISOString())
    ]);
    const capacity = Math.max(1, tbls.length || 20);
    // Count reservations whose window overlaps the requested slot
    const targetT = when.getTime();
    const overlapping = nearby.filter(x => {
      const s = new Date(x.reserved_at).getTime();
      const durMs = (x.duration_minutes || 90) * 60 * 1000;
      return targetT < s + durMs && targetT + 90 * 60 * 1000 > s;
    });
    if (overlapping.length >= capacity) {
      return res.status(409).json({
        error: 'slot_full',
        message: `Sorry — ${rest.name} is fully booked around ${when.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}. Try a different time.`
      });
    }
  } catch {}

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

  auditLog(req, rest.id, 'reservation.create', { target: guest_name, metadata: { party_size: size, when: created.reserved_at } }).catch(() => {});

  return res.status(201).json({ ok: true, reservation_id: created.id });
}
