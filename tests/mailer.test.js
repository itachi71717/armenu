import { describe, it, expect } from 'vitest';
import { buildIcs, sendMail } from '../api/_lib/mailer.js';

describe('buildIcs', () => {
  const base = {
    uid: 'abc-123',
    title: 'Reservation at Ocean Basket',
    description: 'Party of 4',
    location: 'Ocean Basket',
    startISO: '2026-10-15T18:30:00.000Z',
    durationMinutes: 90
  };
  const ics = buildIcs(base);

  it('produces a valid VCALENDAR wrapper', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
  });
  it('includes exactly one VEVENT', () => {
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
    expect((ics.match(/END:VEVENT/g) || []).length).toBe(1);
  });
  it('encodes DTSTART/DTEND as UTC compact form', () => {
    expect(ics).toMatch(/DTSTART:20261015T183000Z/);
    expect(ics).toMatch(/DTEND:20261015T200000Z/);
  });
  it('escapes commas, semicolons and backslashes in text fields', () => {
    const out = buildIcs({ ...base, title: 'a,b;c\\d', description: 'x' });
    expect(out).toMatch(/SUMMARY:a\\,b\\;c\\\\d/);
  });
  it('uses CRLF line endings (RFC 5545)', () => {
    expect(ics.includes('\r\n')).toBe(true);
  });
  it('namespaces UID under armenu.co.za', () => {
    expect(ics).toMatch(/UID:abc-123@armenu\.co\.za/);
  });
});

describe('sendMail', () => {
  it('returns skipped when RESEND_API_KEY is not set', async () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const r = await sendMail({ to: 'x@y.co', subject: 's', html: '<p>h</p>' });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeTruthy();
    if (prev) process.env.RESEND_API_KEY = prev;
  });
});
