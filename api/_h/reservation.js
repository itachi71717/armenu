// POST /api/reservation  { r:slug, guest_name, guest_phone?, guest_email?,
//                          party_size, reserved_at(iso), notes? }
// Public. Creates a pending reservation and pushes a notification to the
// restaurant's managers.

import { supabase, supabaseAdmin } from '../_db.js';
import { sendPush } from './push/_send.js';
import { auditLog } from './_audit.js';
import { sendMail, buildIcs } from '../_lib/mailer.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { r, guest_name, guest_phone, guest_email, party_size, reserved_at, notes, preferences } = body;
  // Sanitise preferences: array of short strings (e.g. ["window","quiet"])
  const cleanPrefs = Array.isArray(preferences)
    ? preferences.filter(p => typeof p === 'string' && p.length < 40).slice(0, 8)
    : [];

  if (!r || !guest_name || !reserved_at) {
    return res.status(400).json({ error: 'restaurant slug, guest_name and reserved_at required' });
  }
  const when = new Date(reserved_at);
  // 5-minute forward buffer for clock skew, but no past bookings.
  if (isNaN(when) || when.getTime() < Date.now() - 5 * 60 * 1000) {
    return res.status(400).json({ error: 'reserved_at must be a valid future ISO datetime' });
  }
  const size = Math.max(1, Math.min(50, parseInt(party_size) || 2));
  // Own duration for this booking (default 90 min). Used for both the
  // overlap window search and the .ics event length.
  const newDurMin = Math.max(30, Math.min(240, parseInt(body.duration_minutes) || 90));
  const newDurMs = newDurMin * 60 * 1000;
  // Server-side email validation — the frontend regex is optional and
  // can be bypassed. If invalid we drop it entirely (store null, omit
  // replyTo) so Resend never sees a malformed To/replyTo header.
  const rawEmail = guest_email ? String(guest_email).trim().toLowerCase() : null;
  const validEmail = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;

  const { data: rest } = await supabase.from('restaurants').select('id, name, email, slug').eq('slug', r).single();
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
        .gte('reserved_at', new Date(when.getTime() - Math.max(newDurMs, 90 * 60 * 1000)).toISOString())
        .lte('reserved_at', new Date(when.getTime() + Math.max(newDurMs, 90 * 60 * 1000)).toISOString())
    ]);
    const capacity = Math.max(1, tbls.length || 20);
    // Count reservations whose window overlaps THIS booking's actual window
    // (not a hard-coded 90 min — a tasting-menu booking may run 120+).
    const targetStart = when.getTime();
    const targetEnd = targetStart + newDurMs;
    const overlapping = nearby.filter(x => {
      const s = new Date(x.reserved_at).getTime();
      const durMs = (x.duration_minutes || 90) * 60 * 1000;
      return targetStart < s + durMs && targetEnd > s;
    });
    if (overlapping.length >= capacity) {
      return res.status(409).json({
        error: 'slot_full',
        message: `Sorry — ${rest.name} is fully booked around ${when.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' })}. Try a different time.`
      });
    }
  } catch {}

  const { data: created, error } = await supabaseAdmin.from('reservations').insert({
    restaurant_id: rest.id,
    guest_name,
    guest_phone: guest_phone || null,
    guest_email: validEmail,
    party_size: size,
    reserved_at: when.toISOString(),
    duration_minutes: newDurMin,
    notes: notes || null,
    preferences: cleanPrefs,
    status: 'pending'
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Format times in the RESTAURANT's local timezone (not the Vercel node
  // process's UTC) so a 7pm CPT booking shows as "7:00 PM" in the push and
  // email, not "5:00 PM". Falls back to Africa/Johannesburg — restaurants
  // can set restaurant_settings.timezone (IANA) to override.
  const { data: settings } = await supabase.from('restaurant_settings')
    .select('timezone').eq('restaurant_id', rest.id).maybeSingle();
  const tz = settings?.timezone || 'Africa/Johannesburg';
  const local = when.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  sendPush(rest.id, {
    title: 'New reservation',
    body: `${guest_name} · party of ${size} · ${local}`,
    url: '/portal/',
    tag: 'reservation-' + created.id
  }, { role_filter: 'manager' }).catch(() => {});

  auditLog(req, rest.id, 'reservation.create', { target: guest_name, metadata: { party_size: size, when: created.reserved_at } }).catch(() => {});

  // Build a downloadable .ics so the guest can add the booking to their
  // calendar even if we can't send them an email.
  const ics = buildIcs({
    uid: created.id,
    title: `Reservation at ${rest.name}`,
    description: `Party of ${size} in the name of ${guest_name}. Booking status: pending — the restaurant will confirm shortly.`,
    location: rest.name,
    startISO: created.reserved_at,
    durationMinutes: newDurMin
  });
  const icsDataUrl = 'data:text/calendar;charset=utf-8;base64,' + Buffer.from(ics, 'utf8').toString('base64');

  // Fire-and-forget confirmation email — silent no-op unless RESEND_API_KEY
  // is set. We send to the guest AND cc the restaurant so the manager has a
  // record independent of the portal.
  // Portal URL from the incoming request host so preview deploys and any
  // future white-label subdomain point to themselves, not prod.
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host  = req.headers['x-forwarded-host'] || req.headers.host || (process.env.VERCEL_URL || 'armenu.co.za');
  const portalUrl = `${proto}://${host}/portal/`;
  // Track the guest send result so we can be honest about email_sent
  // in the response. Manager send stays fire-and-forget.
  let guestSendResult = null;
  const emailPromises = [];
  if (created.guest_email) {
    const guestHtml = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:22px;margin:0 0 12px;color:#8b6b2f">Booking received ✓</h1>
      <p>Hi ${escapeHtml(guest_name)},</p>
      <p>Your table request at <b>${escapeHtml(rest.name)}</b> has been received. Here's what you booked:</p>
      <div style="background:#f7f2e8;border-radius:12px;padding:16px;margin:16px 0;line-height:1.7">
        <div><b>When:</b> ${escapeHtml(local)}</div>
        <div><b>Party size:</b> ${size} ${size === 1 ? 'guest' : 'guests'}</div>
        ${notes ? `<div><b>Notes:</b> ${escapeHtml(notes)}</div>` : ''}
      </div>
      <p><b>Status:</b> pending — ${escapeHtml(rest.name)} will confirm shortly. If you don't hear back within a few hours and you're worried, give them a call.</p>
      <p style="margin-top:24px"><a href="${icsDataUrl}" download="reservation-${created.id}.ics" style="display:inline-block;padding:12px 20px;background:#e8c58a;color:#0a0806;border-radius:8px;text-decoration:none;font-weight:700">Add to calendar</a></p>
      <p style="color:#888;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">Sent by ARMenu on behalf of ${escapeHtml(rest.name)}. Reply to this email to reach them directly.</p>
    </body></html>`;
    // Await this one — we need the truthful outcome for email_sent.
    guestSendResult = await sendMail({
      to: created.guest_email,
      subject: `Booking received — ${rest.name}, ${local}`,
      html: guestHtml,
      replyTo: safeHeader(rest.email)
    });
  }
  if (rest.email) {
    const mgrHtml = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 12px;color:#8b6b2f">New booking request</h1>
      <div style="background:#f7f2e8;border-radius:12px;padding:16px;margin:12px 0;line-height:1.7">
        <div><b>Guest:</b> ${escapeHtml(guest_name)}</div>
        <div><b>When:</b> ${escapeHtml(local)}</div>
        <div><b>Party size:</b> ${size}</div>
        ${guest_phone ? `<div><b>Phone:</b> ${escapeHtml(guest_phone)}</div>` : ''}
        ${created.guest_email ? `<div><b>Email:</b> ${escapeHtml(created.guest_email)}</div>` : ''}
        ${notes ? `<div><b>Notes:</b> ${escapeHtml(notes)}</div>` : ''}
      </div>
      <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:10px 18px;background:#e8c58a;color:#0a0806;border-radius:8px;text-decoration:none;font-weight:700">Open portal</a></p>
    </body></html>`;
    emailPromises.push(sendMail({
      to: rest.email,
      subject: `New booking — ${guest_name}, ${local}`,
      html: mgrHtml,
      replyTo: safeHeader(created.guest_email)
    }));
  }
  Promise.allSettled(emailPromises).then(results => {
    const failed = results.filter(x => x.status === 'rejected' || (x.value && x.value.ok === false && !x.value.skipped));
    if (failed.length) console.warn('reservation email send failed:', failed);
  });

  return res.status(201).json({
    ok: true,
    reservation_id: created.id,
    ics_data_url: icsDataUrl,
    // Honest — reflects actual Resend outcome, not just "we tried".
    email_sent: !!(guestSendResult && guestSendResult.ok)
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Defence in depth: strip CR/LF from any string routed into an email header
// (replyTo, from, to). Resend does its own sanitisation; this closes the
// injection door regardless.
function safeHeader(s) {
  if (!s) return undefined;
  const cleaned = String(s).replace(/[\r\n\t]+/g, ' ').trim();
  return cleaned || undefined;
}
