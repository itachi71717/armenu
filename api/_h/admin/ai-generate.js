// AR Studio — dish generator.
// White-labelled: the UI and responses never reference the upstream provider.
// This route:
//   POST  { image_url, dish_id?, restaurant_slug? }
//     -> submits a job, returns { job_id }
//   GET   ?job=<id>
//     -> { status, progress, previewGlb (temporary CDN url), thumbnail }
//   POST  { finalize: true, job_id, restaurant_slug, dish_id?, name?, price? }
//     -> downloads the .glb + .usdz + thumbnail from the upstream, uploads
//        each to our own Supabase Storage bucket `dishes/<restaurant>/<uid>/`,
//        and either updates the specified dish OR inserts a new one.
//        Returns { glb_url, usdz_url, thumbnail_url, dish_id }
//   POST  { retry: true, previous_job_id }
//     -> re-runs generation on the same image (upstream refund/retry policy).
//
// Env: MESHY_API_KEY   (kept server-side, never leaked to clients)
import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '../../_db.js';
import { requireAdmin } from '../../_auth.js';

const UPSTREAM = 'https://api.meshy.ai/openapi/v1';
const BUCKET = 'dishes';

async function upstream(path, opts = {}) {
  if (!process.env.MESHY_API_KEY) throw new Error('AR generation not configured');
  const res = await fetch(UPSTREAM + path, {
    ...opts,
    headers: {
      'authorization': 'Bearer ' + process.env.MESHY_API_KEY,
      'content-type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(scrub(data.error?.message || data.message || `Generation service error ${res.status}`));
  return data;
}

// Strip any brand names from user-facing error strings
function scrub(s) {
  return String(s || '').replace(/meshy(\.ai)?/gi, 'AR Studio');
}

const slugify = s => String(s || 'dish').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dish';

// Track past jobs so retry can look up original image + preserve linkage.
// Stored in `requests` table as a JSON blob under a fake type — quick + reuses
// existing infra without adding a new table.
async function saveJobMeta(rest_id, job_id, image_url, dish_id) {
  await supabaseAdmin.from('requests').insert({
    restaurant_id: rest_id,
    message: JSON.stringify({ ar_job: true, job_id, image_url, dish_id }),
    status: 'ar_pending'
  });
}
async function findJobMeta(job_id) {
  const { data } = await supabase.from('requests')
    .select('id, restaurant_id, message')
    .eq('status', 'ar_pending').order('created_at', { ascending: false }).limit(50);
  for (const r of data || []) {
    try {
      const m = JSON.parse(r.message);
      if (m.ar_job && m.job_id === job_id) return { row_id: r.id, restaurant_id: r.restaurant_id, ...m };
    } catch {}
  }
  return null;
}

async function downloadTo(bucket, path, url, contentType) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not fetch generated asset');
  const buf = Buffer.from(await r.arrayBuffer());
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buf, {
    contentType, upsert: true, cacheControl: '31536000, immutable'
  });
  if (error) throw new Error(scrub(error.message));
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    // ---- POLL ----
    if (req.method === 'GET' && req.query.job) {
      const data = await upstream('/image-to-3d/' + encodeURIComponent(req.query.job));
      const status = String(data.status || '').toUpperCase();
      return res.status(200).json({
        status,                            // PENDING | IN_PROGRESS | SUCCEEDED | FAILED
        progress: data.progress || 0,
        // These URLs are TEMPORARY (CDN-hosted upstream) — used only for the
        // preview <model-viewer> in the admin UI. Finalize step rehosts them.
        previewGlb: data.model_urls?.glb || null,
        thumbnail:  data.thumbnail_url || null,
        canFinalize: status === 'SUCCEEDED',
        error: data.task_error?.message ? scrub(data.task_error.message) : null
      });
    }

    let body = {};
    if (req.method === 'POST') {
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    }

    // ---- RETRY (rerun same image) ----
    if (body.retry && body.previous_job_id) {
      const prev = await findJobMeta(body.previous_job_id);
      if (!prev) return res.status(404).json({ error: 'Original job not found' });
      const created = await upstream('/image-to-3d', {
        method: 'POST',
        body: JSON.stringify({
          image_url: prev.image_url,
          enable_pbr: true, should_remesh: true, should_texture: true, ai_model: 'meshy-4'
        })
      });
      const newJobId = created.result || created.id || created.task_id;
      await saveJobMeta(prev.restaurant_id, newJobId, prev.image_url, prev.dish_id);
      return res.status(200).json({ job_id: newJobId });
    }

    // ---- FINALIZE (download all assets → Supabase Storage → attach to dish) ----
    if (body.finalize && body.job_id) {
      const data = await upstream('/image-to-3d/' + encodeURIComponent(body.job_id));
      if (String(data.status || '').toUpperCase() !== 'SUCCEEDED') {
        return res.status(400).json({ error: 'Generation not finished yet' });
      }
      const glbUrl  = data.model_urls?.glb;
      const usdzUrl = data.model_urls?.usdz;
      const thumbUrl = data.thumbnail_url;
      if (!glbUrl) return res.status(500).json({ error: 'Generated model missing .glb' });

      const slug = body.restaurant_slug;
      if (!slug) return res.status(400).json({ error: 'restaurant_slug required to finalize' });
      const { data: restaurant } = await supabase.from('restaurants').select('id').eq('slug', slug).single();
      if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

      // Every generation gets its OWN folder under dishes/<slug>/<uid>/ so a
      // regen of the same dish doesn't overwrite an earlier version — the
      // owner can roll back by pointing dish.glb_url at a previous version.
      const uid = crypto.randomBytes(6).toString('hex');
      const nameHint = body.name || 'dish';
      const base = `${slug}/${slugify(nameHint)}-${uid}`;

      const [outGlb, outUsdz, outThumb] = await Promise.all([
        downloadTo(BUCKET, base + '/model.glb', glbUrl, 'model/gltf-binary'),
        usdzUrl  ? downloadTo(BUCKET, base + '/model.usdz', usdzUrl, 'model/vnd.usdz+zip') : Promise.resolve(null),
        thumbUrl ? downloadTo(BUCKET, base + '/thumb.jpg', thumbUrl, 'image/jpeg')          : Promise.resolve(null)
      ]);

      // Either UPDATE an existing dish or CREATE a new one.
      let dish_id = body.dish_id;
      if (dish_id) {
        await supabaseAdmin.from('dishes').update({
          glb_url: outGlb, usdz_url: outUsdz, thumb_url: outThumb, active: true
        }).eq('id', dish_id);
      } else {
        const dishSlug = slugify(body.name) + '-' + uid.slice(0, 4);
        const priceCents = body.price ? Math.round(parseFloat(String(body.price).replace(/[^0-9.]/g, '')) * 100) : null;
        const { data: newDish } = await supabaseAdmin.from('dishes').insert({
          restaurant_id: restaurant.id,
          slug: dishSlug,
          name: body.name || 'New dish',
          price: body.price || null,
          price_cents: priceCents,
          glb_url: outGlb, usdz_url: outUsdz, thumb_url: outThumb,
          active: true
        }).select('id').single();
        dish_id = newDish?.id;
      }

      // Mark the pending job row as finalized so the retry hunt won't find it
      await supabaseAdmin.from('requests').update({ status: 'ar_done' })
        .eq('status', 'ar_pending').ilike('message', `%"job_id":"${body.job_id}"%`);

      return res.status(200).json({
        dish_id,
        glb_url: outGlb,
        usdz_url: outUsdz,
        thumbnail_url: outThumb
      });
    }

    // ---- SUBMIT NEW JOB ----
    if (req.method === 'POST') {
      const { image_url, restaurant_slug, dish_id } = body || {};
      if (!image_url) return res.status(400).json({ error: 'image_url required' });
      let restaurant_id = null;
      if (restaurant_slug) {
        const { data } = await supabase.from('restaurants').select('id').eq('slug', restaurant_slug).single();
        restaurant_id = data?.id || null;
      }
      const created = await upstream('/image-to-3d', {
        method: 'POST',
        body: JSON.stringify({
          image_url, enable_pbr: true, should_remesh: true, should_texture: true, ai_model: 'meshy-4'
        })
      });
      const job_id = created.result || created.id || created.task_id;
      if (restaurant_id) await saveJobMeta(restaurant_id, job_id, image_url, dish_id || null);
      return res.status(200).json({ job_id });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: scrub(e.message) });
  }
}
