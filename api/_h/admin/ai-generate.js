// POST /api/admin/ai-generate  { image_url, dish_name?, mode? }
// Turns a food photo into a 3D .glb via Meshy image-to-3D API.
// Returns a Meshy task id — the client polls GET ?task=<id> until done.
// Requires env: MESHY_API_KEY   (get one at meshy.ai)
import { requireAdmin } from '../../_auth.js';

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

async function meshy(path, opts = {}) {
  const res = await fetch(MESHY_BASE + path, {
    ...opts,
    headers: {
      'authorization': 'Bearer ' + process.env.MESHY_API_KEY,
      'content-type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.message || `Meshy ${res.status}`);
  return data;
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.MESHY_API_KEY) return res.status(500).json({ error: 'MESHY_API_KEY not set on server' });

  try {
    if (req.method === 'GET' && req.query.task) {
      const data = await meshy('/image-to-3d/' + encodeURIComponent(req.query.task));
      // Meshy returns { status: PENDING|IN_PROGRESS|SUCCEEDED|FAILED, model_urls: { glb, ... }, progress }
      return res.status(200).json({
        status: data.status,
        progress: data.progress || 0,
        glb: data.model_urls?.glb || null,
        usdz: data.model_urls?.usdz || null,
        thumbnail: data.thumbnail_url || null,
        error: data.task_error?.message || null
      });
    }

    if (req.method === 'POST') {
      let body = {};
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
      const { image_url } = body || {};
      if (!image_url) return res.status(400).json({ error: 'image_url required' });

      const created = await meshy('/image-to-3d', {
        method: 'POST',
        body: JSON.stringify({
          image_url,
          enable_pbr: true,
          should_remesh: true,
          should_texture: true,
          ai_model: 'meshy-4'
        })
      });
      return res.status(200).json({ task_id: created.result || created.id || created.task_id });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
