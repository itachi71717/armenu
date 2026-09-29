// Reservation capacity preview.
// GET  /api/reservation-capacity?slug=<r>&date=<yyyy-mm-dd>
//        -> [{ time: "18:00", available: 'plenty'|'filling'|'nearly_full'|'full', tables_left }]
//      30-min slots 11:00-22:00 (public, cached 60s).
// GET  /api/reservation-capacity?slug=<r>&flag=1 -> { enabled }
// POST /api/reservation-capacity { slug, enabled: bool } -> toggles
//      restaurant_settings.capacity_preview_enabled (manager / admin, scoped).
import { supabase, supabaseAdmin } from '../_db.js';
import { requireAdmin, getScopedRestaurantId } from '../_auth.js';
import { auditLog } from './_audit.js';

const WINDOW_MS = 90 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');

function parseBody(req) {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body || {};
}

export function availabilityFor(used, total) {
  const ratio = total > 0 ? used / total : 1;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.8) return 'nearly_full';
  if (ratio >= 0.5) return 'filling';
  return 'plenty';
}

// Offset (ms) of the restaurant timezone from UTC at a given instant.
function tzOffsetMs(tz, at) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(at).reduce((a, p) => (a[p.type] = p.value, a), {});
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch { return 0; }
}

export default async function handler(req, res) {
  const body = req.method === 'POST' ? parseBody(req) : {};
  const slug = String(req.query.slug || body.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!rest) return res.status(404).json({ error: 'not found' });

  if (req.method === 'POST') {
    if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
    const scopeRid = getScopedRestaurantId(req);
    if (scopeRid && String(scopeRid) !== String(rest.id)) return res.status(403).json({ error: 'out_of_scope' });
    if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled boolean required' });
    const { data: existing } = await supabaseAdmin.from('restaurant_settings').select('restaurant_id').eq('restaurant_id', rest.id).maybeSingle();
    const { error } = existing
      ? await supabaseAdmin.from('restaurant_settings').update({ capacity_preview_enabled: body.enabled }).eq('restaurant_id', rest.id)
      : await supabaseAdmin.from('restaurant_settings').insert({ restaurant_id: rest.id, capacity_preview_enabled: body.enabled });
    if (error) return res.status(502).json({ error: 'save failed (has the schema migration run?)' });
    auditLog(req, rest.id, 'settings.capacity_preview', { target: slug, metadata: { enabled: body.enabled } }).catch(() => {});
    return res.status(200).json({ ok: true, enabled: body.enabled });
  }

  if (req.method !== 'GET') return res.status(405).end();

  if (req.query.flag === '1') {
    const { data: s } = await supabase.from('restaurant_settings').select('capacity_preview_enabled').eq('restaurant_id', rest.id).maybeSingle();
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({ enabled: s?.capacity_preview_enabled === true });
  }

  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z'))) {
    return res.status(400).json({ error: 'date must be yyyy-mm-dd' });
  }

  const { data: st } = await supabase.from('restaurant_settings').select('timezone').eq('restaurant_id', rest.id).maybeSingle();
  const tz = st?.timezone || 'Africa/Johannesburg';
  const [y, mo, d] = date.split('-').map(Number);
  const localMidnightUtc = Date.UTC(y, mo - 1, d);
  const off = tzOffsetMs(tz, new Date(localMidnightUtc));
  const dayStart = localMidnightUtc - off;   // UTC ms of local midnight

  const [{ data: tbls = [] }, { data: rows = [] }] = await Promise.all([
    supabase.from('restaurant_tables').select('id').eq('restaurant_id', rest.id),
    supabase.from('reservations').select('reserved_at, party_size, status')
      .eq('restaurant_id', rest.id).in('status', ['pending', 'confirmed'])
      .gte('reserved_at', new Date(dayStart + 10 * 3600000).toISOString())
      .lte('reserved_at', new Date(dayStart + 23 * 3600000).toISOString())
  ]);
  const totalTables = Math.max(1, (tbls || []).length || 20);   // same fallback as reservation.js
  const resv = (rows || []).map(x => ({ t: new Date(x.reserved_at).getTime(), n: Math.max(1, parseInt(x.party_size) || 1) }));

  const out = [];
  for (let m = 11 * 60; m <= 22 * 60; m += 30) {
    const centre = dayStart + m * 60000;
    let used = 0;
    for (const x of resv) if (x.t >= centre - WINDOW_MS / 2 && x.t < centre + WINDOW_MS / 2) used += x.n;
    out.push({
      time: pad(Math.floor(m / 60)) + ':' + pad(m % 60),
      available: availabilityFor(used, totalTables),
      tables_left: Math.max(0, totalTables - used)
    });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
  return res.status(200).json(out);
}
