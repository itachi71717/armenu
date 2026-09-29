// Guest dish photo reviews (compressed, moderated).
//
//  POST /api/customer/dish-photo   { token, rating_id? | (restaurant_slug, dish_slug, order_id?), image_base64 }
//       Public. image <= 200KB. EXIF stripped (sharp re-encode), stored on R2 as
//       reviews/<YYYY-MM>/<rating_id>.webp. photo_approved stays NULL (pending).
//  GET  /api/customer/dish-photo?restaurant_slug=r
//       Public. Approved photos grouped by dish slug: { counts:{slug:n}, photos:{slug:[url]} }
//
// The SAME module is also registered as admin/dish-photos (moderation):
//  GET  /api/admin/dish-photos?slug=r            pending photos
//  POST /api/admin/dish-photos { slug, rating_id, action:'approve'|'reject' }  (audited)
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin, assertScope } from '../../_auth.js';
import { auditLog } from '../_audit.js';
import { isValidToken, resolveCustomerRowByToken } from './hello.js';

const MAX_BYTES = 200 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_DISH_LIMIT = 12;

function parseBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch { return {}; }
}
function isAdminRoute(req) {
  let key = '';
  if (Array.isArray(req.query?.path)) key = req.query.path.join('/');
  else if (req.query?.path) key = String(req.query.path);
  if (!key) key = (req.url || '').split('?')[0].replace(/^\/api\/?/, '');
  return key.startsWith('admin/');
}
function sniff(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;                                        // jpeg
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;  // png
  return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';  // webp
}
function keyFromUrl(url) {
  const m = String(url || '').match(/(reviews\/\d{4}-\d{2}\/[0-9a-f-]{36}\.webp)$/i);
  return m ? m[1] : null;
}

async function guestUpload(req, res) {
  const ok = () => res.status(200).json({ ok: true });
  try {
    const { token, rating_id, restaurant_slug, dish_slug, order_id, image_base64 } = parseBody(req);
    if (!isValidToken(token) || typeof image_base64 !== 'string') return ok();
    // Cheap pre-check before decoding (base64 inflates by ~4/3).
    if (image_base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) return res.status(413).json({ error: 'too_large' });
    const customer = await resolveCustomerRowByToken(token);
    if (!customer) return ok();

    // Locate the guest's OWN thumbs-up rating.
    let rating = null;
    if (typeof rating_id === 'string' && UUID_RE.test(rating_id)) {
      const { data } = await supabase.from('customer_dish_ratings').select('id, rating, photo_url')
        .eq('id', rating_id).eq('customer_id', customer.id).maybeSingle();
      rating = data;
    } else if (typeof restaurant_slug === 'string' && typeof dish_slug === 'string') {
      const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', restaurant_slug).maybeSingle();
      if (!rest) return ok();
      const { data: dish } = await supabase.from('dishes').select('id').eq('restaurant_id', rest.id).eq('slug', dish_slug).maybeSingle();
      if (!dish) return ok();
      const oid = typeof order_id === 'string' && UUID_RE.test(order_id) ? order_id : null;
      const { data } = await supabase.raw(
        `select id, rating, photo_url from customer_dish_ratings
          where customer_id = $1 and dish_id = $2 and (($3::uuid is null and order_id is null) or order_id = $3::uuid)
          order by created_at desc limit 1`, [customer.id, dish.id, oid]);
      rating = (data || [])[0] || null;
    }
    if (!rating || rating.rating !== 1) return ok();
    if (rating.photo_url) return ok(); // one photo per rating

    const buf = Buffer.from(image_base64.replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length || buf.length > MAX_BYTES || !sniff(buf)) return res.status(400).json({ error: 'bad_image' });

    let sharp;
    try { ({ default: sharp } = await import('sharp')); } catch { return res.status(503).json({ error: 'unavailable' }); }
    // sharp drops all metadata (EXIF/GPS) unless withMetadata() is called; rotate() bakes in orientation first.
    const out = await sharp(buf, { failOn: 'none', limitInputPixels: 24e6 }).rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 }).toBuffer();

    const ym = new Date().toISOString().slice(0, 7);
    const path = `${ym}/${rating.id}.webp`;
    const up = await supabaseAdmin.storage.from('reviews').upload(path, out, { contentType: 'image/webp' });
    if (up.error) return res.status(502).json({ error: 'upload_failed' });
    const { data: pub } = supabaseAdmin.storage.from('reviews').getPublicUrl(path);
    await supabase.raw(
      'update customer_dish_ratings set photo_url = $2, photo_approved = null where id = $1 and photo_url is null',
      [rating.id, pub.publicUrl]);
  } catch (e) { console.error('dish-photo upload failed', e?.message); return res.status(500).json({ error: 'failed' }); }
  return ok();
}

async function publicList(req, res) {
  const slug = req.query?.restaurant_slug;
  if (typeof slug !== 'string' || !slug) return res.status(400).json({ error: 'restaurant_slug required' });
  const { data: rest } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!rest) return res.status(200).json({ counts: {}, photos: {} });
  const { data, error } = await supabase.raw(
    `select d.slug, cdr.photo_url from customer_dish_ratings cdr join dishes d on d.id = cdr.dish_id
      where cdr.restaurant_id = $1 and cdr.photo_approved = true and cdr.photo_url is not null
      order by cdr.created_at desc limit 500`, [rest.id]);
  if (error) return res.status(200).json({ counts: {}, photos: {} });
  const counts = {}, photos = {};
  for (const row of data || []) {
    counts[row.slug] = (counts[row.slug] || 0) + 1;
    const a = (photos[row.slug] = photos[row.slug] || []);
    if (a.length < PER_DISH_LIMIT) a.push(row.photo_url);
  }
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json({ counts, photos });
}

async function adminModeration(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  const body = req.method === 'POST' ? parseBody(req) : {};
  const slug = req.query?.slug || body.slug || body.restaurant_slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const { data: r } = await supabase.from('restaurants').select('id').eq('slug', slug).maybeSingle();
  if (!r) return res.status(404).json({ error: 'not found' });
  const guard = assertScope(req, r.id);
  if (guard) return res.status(guard.status).json({ error: guard.error });

  if (req.method === 'GET') {
    const { data, error } = await supabase.raw(
      `select cdr.id, cdr.photo_url, cdr.created_at, d.name as dish_name
         from customer_dish_ratings cdr join dishes d on d.id = cdr.dish_id
        where cdr.restaurant_id = $1 and cdr.photo_url is not null and cdr.photo_approved is null
        order by cdr.created_at desc limit 100`, [r.id]);
    if (error) return res.status(500).json({ error: 'load_failed' });
    return res.status(200).json({ pending: data || [] });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { rating_id, action } = body;
  if (typeof rating_id !== 'string' || !UUID_RE.test(rating_id) || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'rating_id and action (approve|reject) required' });
  }
  const { data: row } = await supabase.raw(
    'select id, photo_url from customer_dish_ratings where id = $1 and restaurant_id = $2', [rating_id, r.id]);
  const cur = (row || [])[0];
  if (!cur || !cur.photo_url) return res.status(404).json({ error: 'photo not found' });

  if (action === 'approve') {
    await supabase.raw('update customer_dish_ratings set photo_approved = true where id = $1', [cur.id]);
  } else {
    // Rejected photos are deleted from R2 to keep storage minimal.
    const key = keyFromUrl(cur.photo_url);
    if (key) { try { await supabaseAdmin.storage.from('reviews').remove([key.replace(/^reviews\//, '')]); } catch {} }
    await supabase.raw('update customer_dish_ratings set photo_approved = false, photo_url = null where id = $1', [cur.id]);
  }
  await auditLog(req, r.id, action === 'approve' ? 'dish_photo.approve' : 'dish_photo.reject', { target: cur.id });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (isAdminRoute(req)) return adminModeration(req, res);
  if (req.method === 'GET') return publicList(req, res);
  if (req.method === 'POST') return guestUpload(req, res);
  return res.status(405).end();
}
