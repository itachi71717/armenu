// POST /api/admin/compress  { glb_url }
// Downloads a .glb from a public URL and re-uploads it to Supabase Storage
// (the "dishes" bucket) so we control the asset lifecycle.
//
// NOTE: Geometry/texture optimisation is currently disabled — gltf-transform's
// WASM and ESM/CJS interop doesn't play nicely with Vercel's serverless build.
// Once we move heavier processing to a worker (or upload to a single Pro plan),
// we can re-enable Draco / quantize compression here. For now, optimise BEFORE
// upload by exporting at "Medium" quality in Polycam (3-8 MB typical).

import { supabaseAdmin } from '../_db.js';
import { requireAdmin } from '../_auth.js';

const BUCKET = 'dishes';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const glb_url = body.glb_url;
  if (!glb_url) return res.status(400).json({ error: 'glb_url required' });

  try {
    // If the file is ALREADY in our Supabase bucket, skip the re-upload.
    if (typeof glb_url === 'string' && glb_url.includes(`/storage/v1/object/public/${BUCKET}/`)) {
      // Try to read its size for the response, but don't fail if we can't
      let size = 0;
      try {
        const head = await fetch(glb_url, { method: 'HEAD' });
        size = parseInt(head.headers.get('content-length') || '0', 10);
      } catch {}
      return res.status(200).json({
        url: glb_url,
        original_size: size,
        compressed_size: size,
        saved_pct: 0
      });
    }

    // Otherwise: download → re-upload to our bucket
    const dlRes = await fetch(glb_url);
    if (!dlRes.ok) {
      return res.status(400).json({ error: `Could not download .glb (HTTP ${dlRes.status})` });
    }
    const inputBytes = new Uint8Array(await dlRes.arrayBuffer());
    const originalSize = inputBytes.length;

    const filename = `optimised/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.glb`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filename, inputBytes, {
        contentType: 'model/gltf-binary',
        cacheControl: '31536000',
        upsert: false
      });

    if (upErr) {
      return res.status(500).json({
        error: `Storage upload failed: ${upErr.message}. Make sure the "${BUCKET}" bucket exists in Supabase Storage and is set to PUBLIC.`
      });
    }

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filename);
    return res.status(200).json({
      url: pub.publicUrl,
      original_size: originalSize,
      compressed_size: originalSize,
      saved_pct: 0
    });
  } catch (e) {
    console.error('compress failed:', e);
    return res.status(500).json({ error: (e.message || String(e)) });
  }
}
