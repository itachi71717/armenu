// POST /api/admin/compress  { glb_url }
// Downloads a .glb from a public URL, grounds it (shifts geometry so the
// model's base sits at Y=0, since AR anchors a model's local origin to the
// detected surface — an ungrounded scan floats or sinks instead of sitting
// flush), generates a real .usdz for Apple Quick Look (iPhone AR — see
// ../_usdz.js for why this needs Three.js's actual exporter, not the
// nonexistent model-viewer generateUSDZ() this app used to assume existed),
// and re-uploads everything to Supabase Storage (the "dishes" bucket) so we
// control the asset lifecycle.
//
// NOTE: Heavier geometry/texture optimisation (Draco, quantize) is still
// disabled — those transforms need WASM codecs that don't play nicely with
// Vercel's serverless build. Grounding only needs @gltf-transform/core's pure
// JS node-transform APIs, so it's safe here. For file-size optimisation,
// export at "Medium" quality in Polycam (3-8 MB typical).

import { supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { glbToUsdz } from '../../_usdz.js';

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

  // SSRF guard: this endpoint is authenticated (any scoped manager can call
  // it) and its response body is uploaded to a PUBLIC bucket whose URL is
  // returned in the JSON. Without this guard a manager could point glb_url
  // at http://169.254.169.254/latest/meta-data/…, loopback, RFC1918,
  // Vercel internals, etc. and read the response back publicly.
  // Only allow http(s) URLs on the Supabase Storage host we just uploaded
  // to — the only legitimate input for this endpoint is a URL the browser
  // just got back from /api/admin/upload-url.
  try {
    const u = new URL(glb_url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return res.status(400).json({ error: 'glb_url must be an http(s) URL' });
    }
    // Reject IP-literal hosts (they'd bypass DNS-based allowlisting)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(':')) {
      return res.status(400).json({ error: 'glb_url host must be a domain, not an IP literal' });
    }
    // Allow only the storage hosts we actually upload to. Derived from env so
    // it tracks whatever R2 public domain is configured (pub-*.r2.dev today,
    // a custom domain later) — a hard-coded list silently broke every upload.
    const allowedHosts = new Set(['armenu.co.za', 'www.armenu.co.za']);
    for (const v of [process.env.R2_PUBLIC_URL, process.env.R2_ENDPOINT, process.env.SUPABASE_URL]) {
      try { if (v) allowedHosts.add(new URL(v).hostname.toLowerCase()); } catch {}
    }
    const host = u.hostname.toLowerCase();
    const bucketHostOk = process.env.R2_ENDPOINT && process.env.R2_BUCKET &&
      (() => { try { return host === `${process.env.R2_BUCKET}.${new URL(process.env.R2_ENDPOINT).hostname}`.toLowerCase(); } catch { return false; } })();
    if (!allowedHosts.has(host) && !bucketHostOk) {
      return res.status(400).json({ error: 'glb_url must point at ARMenu storage' });
    }
    if (u.port && u.port !== '80' && u.port !== '443') {
      return res.status(400).json({ error: 'glb_url port must be default (80/443)' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'glb_url is not a valid URL' });
  }

  try {
    // Always download and ground the model, even if it's already in our
    // bucket — grounding must run on every upload, not just external URLs.
    // 30s timeout + 100MB response cap so a malicious/pathological URL can't
    // hang the function for its full maxDuration or blow memory.
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort('download timeout'), 30_000);
    let dlRes;
    try { dlRes = await fetch(glb_url, { signal: ac.signal, redirect: 'error' }); }
    finally { clearTimeout(to); }
    if (!dlRes.ok) {
      return res.status(400).json({ error: `Could not download .glb (HTTP ${dlRes.status})` });
    }
    const cl = parseInt(dlRes.headers.get('content-length') || '0', 10);
    const MAX_BYTES = 100 * 1024 * 1024;
    if (cl > MAX_BYTES) {
      return res.status(400).json({ error: 'glb too large (>100MB)' });
    }
    const inputBytes = new Uint8Array(await dlRes.arrayBuffer());
    if (inputBytes.length > MAX_BYTES) {
      return res.status(400).json({ error: 'glb too large (>100MB)' });
    }
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

    // Best-effort: a dish is still fully usable on Android/desktop without a
    // .usdz, so a conversion failure here should not fail the whole upload —
    // just come back with usdz_url: null and a warning the admin can see.
    let usdz_url = null;
    let usdzWarning = null;
    try {
      const usdzBuffer = await glbToUsdz(groundedBytes);
      const usdzFilename = `usdz/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.usdz`;
      const { error: usdzUpErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(usdzFilename, usdzBuffer, {
          contentType: 'model/vnd.usdz+zip',
          cacheControl: '31536000',
          upsert: false
        });
      if (usdzUpErr) {
        usdzWarning = `Generated the iPhone AR file but couldn't upload it: ${usdzUpErr.message}`;
      } else {
        usdz_url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(usdzFilename).data.publicUrl;
      }
    } catch (e) {
      console.error('glbToUsdz failed:', e);
      usdzWarning = `Could not generate an iPhone AR file for this model (${e.message}). It'll still show a 3D view on iPhone, just not full room-scale AR.`;
    }

    return res.status(200).json({
      url: pub.publicUrl,
      original_size: originalSize,
      compressed_size: groundedBytes.length,
      saved_pct: 0,
      grounded,
      dimensions,
      sizeWarning,
      usdz_url,
      usdzWarning
    });
  } catch (e) {
    console.error('compress failed:', e);
    return res.status(500).json({ error: (e.message || String(e)) });
  }
}
