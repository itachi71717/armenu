// POST /api/admin/upload-url   { filename }
// Returns a Supabase Storage signed upload URL so the admin browser can
// upload the .glb file DIRECTLY to storage (bypasses Vercel's 4.5MB
// serverless body limit and works for files up to 50MB+).
//
// Flow: admin picks file → calls this endpoint → uploads to signedUrl →
// passes the public URL to /api/admin/compress → passes compressed URL
// to /api/admin/dishes for publishing.

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';
import { auditLog } from '../_audit.js';

const BUCKET = 'dishes';

// Images above this size get server-side compression after upload.
const COMPRESS_THRESHOLD = 500 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 2000;

// POST /api/admin/compress-image?url=<public url>  (also accepts {url} body)
// Client flow: upload the raw file to the signed URL, then call this. The
// object is fetched from R2, recompressed with sharp and written back to the
// SAME key, so the public URL never changes. No-ops (compressed:false) when
// the result would not be smaller. Sharp failures leave the original intact.
async function compressImage(req, res) {
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const url = req.query?.url || body.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  // SSRF guard: only our own public R2 host, bucket-namespaced key.
  let key;
  try {
    const pub = new URL(process.env.R2_PUBLIC_URL || '');
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return res.status(400).json({ error: 'invalid url' });
    if (u.host.toLowerCase() !== pub.host.toLowerCase()) return res.status(400).json({ error: 'url must point at ARMenu storage' });
    const base = pub.pathname.replace(/\/$/, '');
    const path = decodeURIComponent(u.pathname);
    if (!path.startsWith(base + '/' + BUCKET + '/')) return res.status(400).json({ error: 'url must be in the dishes bucket' });
    key = path.slice((base + '/' + BUCKET + '/').length);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }
  const ext = (key.match(/\.(jpg|jpeg|png|webp|avif)$/i) || [])[1]?.toLowerCase();
  if (!ext) return res.status(400).json({ error: 'not_an_image' });

  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort('download timeout'), 20_000);
    let dl;
    try { dl = await fetch(url, { signal: ac.signal, redirect: 'error' }); } finally { clearTimeout(to); }
    if (!dl.ok) return res.status(400).json({ error: `Could not download image (HTTP ${dl.status})` });
    const input = Buffer.from(await dl.arrayBuffer());
    if (input.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'image too large (>25MB)' });
    if (input.length <= COMPRESS_THRESHOLD) {
      return res.status(200).json({ url, compressed: false, reason: 'below_threshold', original_size: input.length });
    }

    let sharp;
    try { ({ default: sharp } = await import('sharp')); }
    catch { return res.status(200).json({ url, compressed: false, reason: 'sharp_unavailable', original_size: input.length }); }
    let img = sharp(input, { failOn: 'none' }).rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
    let contentType;
    if (ext === 'png') { img = img.png({ compressionLevel: 9, palette: true }); contentType = 'image/png'; }
    else if (ext === 'webp') { img = img.webp({ quality: 80 }); contentType = 'image/webp'; }
    else if (ext === 'avif') { img = img.avif({ quality: 55 }); contentType = 'image/avif'; }
    else { img = img.jpeg({ quality: 82, mozjpeg: true }); contentType = 'image/jpeg'; }
    const out = await img.toBuffer();

    if (out.length >= input.length) {
      return res.status(200).json({ url, compressed: false, reason: 'no_gain', original_size: input.length });
    }
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(key, out, { contentType, cacheControl: '31536000', upsert: true });
    if (upErr) return res.status(500).json({ error: `Storage upload failed: ${upErr.message}` });

    auditLog(req, req.__scope_restaurant_id || null, 'image.compress', {
      target: key, metadata: { original_size: input.length, compressed_size: out.length }
    }).catch(() => {});
    return res.status(200).json({
      url, compressed: true, original_size: input.length, compressed_size: out.length,
      saved_pct: Math.round((1 - out.length / input.length) * 100)
    });
  } catch (e) {
    console.error('compress-image failed:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const routed = Array.isArray(req.query?.path) ? req.query.path.join('/') : String(req.query?.path || req.url || '');
  if (/admin\/compress-image/.test(routed)) return compressImage(req, res);

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const original = (body.filename || 'dish.glb').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  // Extension whitelist — only 3D-asset formats and image thumbnails may land
  // in the public `dishes` bucket. Blocks .html/.svg/.js payloads that would
  // otherwise be servable as XSS from an armenu.co.za origin.
  const ALLOWED_EXT = /\.(glb|gltf|usdz|obj|fbx|jpg|jpeg|png|webp|avif)$/i;
  if (!ALLOWED_EXT.test(original)) {
    return res.status(400).json({ error: 'unsupported_file_type', message: 'Only 3D models (.glb, .gltf, .usdz, .obj, .fbx) and images (.jpg, .png, .webp, .avif) are allowed.' });
  }
  const path = `originals/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${original}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error) {
    return res.status(500).json({
      error: `Could not create upload URL: ${error.message}. Make sure the "${BUCKET}" bucket exists in Supabase Storage and is set to PUBLIC.`
    });
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

  // Hint: raw image uploads over 500KB should be followed by a POST to
  // /api/admin/compress-image?url=<public_url> (URL stays the same).
  const size = Number(body.size) || 0;
  const isImage = /^image\//i.test(String(body.content_type || '')) || /\.(jpg|jpeg|png|webp|avif)$/i.test(original);
  const shouldCompress = isImage && size > COMPRESS_THRESHOLD;

  return res.status(200).json({
    signed_url: data.signedUrl,
    token: data.token,
    path: data.path,
    public_url: pub.publicUrl,
    ...(shouldCompress ? { compression: 'server', compress_endpoint: '/api/admin/compress-image' } : {})
  });
}
