// POST /api/admin/upload-url   { filename }
// Returns a Supabase Storage signed upload URL so the admin browser can
// upload the .glb file DIRECTLY to storage (bypasses Vercel's 4.5MB
// serverless body limit and works for files up to 50MB+).
//
// Flow: admin picks file → calls this endpoint → uploads to signedUrl →
// passes the public URL to /api/admin/compress → passes compressed URL
// to /api/admin/dishes for publishing.

import { supabaseAdmin } from '../_db.js';
import { requireAdmin } from '../_auth.js';

const BUCKET = 'dishes';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const original = (body.filename || 'dish.glb').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
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

  return res.status(200).json({
    signed_url: data.signedUrl,
    token: data.token,
    path: data.path,
    public_url: pub.publicUrl
  });
}
