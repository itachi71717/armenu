// POST /api/admin/compress  { glb_url }
// Downloads a .glb from a public URL, grounds it (shifts geometry so the
// model's base sits at Y=0, since AR anchors a model's local origin to the
// detected surface — an ungrounded scan floats or sinks instead of sitting
// flush), and re-uploads it to Supabase Storage (the "dishes" bucket) so we
// control the asset lifecycle.
//
// NOTE: Heavier geometry/texture optimisation (Draco, quantize) is still
// disabled — those transforms need WASM codecs that don't play nicely with
// Vercel's serverless build. Grounding only needs @gltf-transform/core's pure
// JS node-transform APIs, so it's safe here. For file-size optimisation,
// export at "Medium" quality in Polycam (3-8 MB typical).

import { supabaseAdmin } from '../_db.js';
import { requireAdmin } from '../_auth.js';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';

const BUCKET = 'dishes';

export const config = { maxDuration: 60 };

// A plate of food should land somewhere in this range. Outside it, the scan
// almost certainly wasn't calibrated to real-world scale during capture
// (this is exactly what happened with the "Test2" dish: a ~1m cube).
const PLAUSIBLE_MIN_M = 0.02;
const PLAUSIBLE_MAX_M = 0.7;

// Shifts every top-level node in the default scene up/down so the model's
// lowest point sits exactly at Y=0 (AR anchors a model's local origin to the
// detected surface, so an ungrounded scan floats or sinks instead of sitting
// flush), and reports the resulting dimensions so the caller can flag scans
// that clearly weren't scale-calibrated at capture time.
//
// Returns { bytes, grounded, dimensions, sizeWarning }. On any processing
// failure, returns the original bytes with grounded:false and an explicit
// warning — never fails silently, so a bad scan is visible to the admin
// instead of only surfacing later when a diner scans the QR.
async function groundModel(bytes) {
  try {
    const io = new NodeIO();
    const doc = await io.readBinary(bytes);
    const scene = doc.getRoot().listScenes()[0];
    if (!scene) {
      return { bytes, grounded: false, dimensions: null, sizeWarning: 'No scene found in .glb — could not verify placement or scale.' };
    }

    const before = getBounds(scene);
    const deltaY = -before.min[1];
    if (Math.abs(deltaY) > 0.001) {
      for (const node of scene.listChildren()) {
        const t = node.getTranslation();
        node.setTranslation([t[0], t[1] + deltaY, t[2]]);
      }
    }

    const after = getBounds(scene);
    const dimensions = {
      width: after.max[0] - after.min[0],
      height: after.max[1] - after.min[1],
      depth: after.max[2] - after.min[2]
    };
    const outOfRange = Object.values(dimensions).some(v => v < PLAUSIBLE_MIN_M || v > PLAUSIBLE_MAX_M);
    const sizeWarning = outOfRange
      ? `This model is ${(dimensions.width * 100).toFixed(0)}×${(dimensions.height * 100).toFixed(0)}×${(dimensions.depth * 100).toFixed(0)}cm (W×H×D) — that's an implausible size for a dish. The scan likely wasn't scale-calibrated at capture (e.g. missing/incorrect reference object in Polycam). Recommend re-scanning before publishing.`
      : null;

    const outBytes = Math.abs(deltaY) > 0.001 ? await io.writeBinary(doc) : bytes;
    return { bytes: outBytes, grounded: true, dimensions, sizeWarning };
  } catch (e) {
    console.error('groundModel failed, uploading original file:', e.message);
    return { bytes, grounded: false, dimensions: null, sizeWarning: 'Could not process this .glb to verify it sits correctly in AR — check it manually before relying on it.' };
  }
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const glb_url = body.glb_url;
  if (!glb_url) return res.status(400).json({ error: 'glb_url required' });

  try {
    // Always download and ground the model, even if it's already in our
    // bucket — grounding must run on every upload, not just external URLs.
    const dlRes = await fetch(glb_url);
    if (!dlRes.ok) {
      return res.status(400).json({ error: `Could not download .glb (HTTP ${dlRes.status})` });
    }
    const inputBytes = new Uint8Array(await dlRes.arrayBuffer());
    const originalSize = inputBytes.length;

    const { bytes: groundedBytes, grounded, dimensions, sizeWarning } = await groundModel(inputBytes);

    const filename = `optimised/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.glb`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filename, groundedBytes, {
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
      compressed_size: groundedBytes.length,
      saved_pct: 0,
      grounded,
      dimensions,
      sizeWarning
    });
  } catch (e) {
    console.error('compress failed:', e);
    return res.status(500).json({ error: (e.message || String(e)) });
  }
}
