// Lightweight transactional mailer. Uses Resend when RESEND_API_KEY is set,
// silent no-op otherwise (mirrors the Sentry / Meshy / Anthropic pattern).
// One dependency-free HTTP POST — we do NOT pull in the resend SDK.
//
//   await sendMail({ to, subject, html, text?, from?, replyTo? })
//     → { ok: boolean, id?: string, skipped?: string, error?: string }

const DEFAULT_FROM = process.env.RESEND_FROM || 'ARMenu <bookings@armenu.co.za>';

export async function sendMail({ to, subject, html, text, from, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: 'RESEND_API_KEY not configured' };
  if (!to || !subject || !html) return { ok: false, error: 'to, subject, html required' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + key,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: from || DEFAULT_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Build a minimal RFC 5545 iCalendar payload the guest can add to any
// calendar app. Returns a data: URL suitable for a download link.
export function buildIcs({ uid, title, description, location, startISO, durationMinutes = 90 }) {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ARMenu//Reservations//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + esc(uid) + '@armenu.co.za',
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(start),
    'DTEND:' + fmt(end),
    'SUMMARY:' + esc(title),
    'DESCRIPTION:' + esc(description),
    'LOCATION:' + esc(location),
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.join('\r\n');
}
