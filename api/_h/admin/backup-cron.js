// POST|GET /api/admin/backup-cron  (Vercel Cron, 03:00 UTC nightly)
// Dumps key tables as JSONL, gzips each (node:zlib) and uploads to the R2
// bucket 'armenu-backups' under 'YYYY-MM-DD/<table>.jsonl.gz'.
//
// Auth: CRON_SECRET via `Authorization: Bearer <secret>` (what Vercel Cron
// sends automatically) or `?token=<secret>`. If CRON_SECRET is unset the call is
// refused (fail closed; set CRON_SECRET in Vercel env). It only writes to R2 and
// returns row counts, never row data.
//
// RETENTION: not handled here. Configure an R2 lifecycle rule on the
// 'armenu-backups' bucket manually (e.g. expire objects after 30 days).
//
// Not master-admin gated: api/index.js exempts this key from the cookie check
// because cron carries no admin session; this handler authenticates itself.

import { gzipSync } from 'node:zlib';
import { timingSafeEqual } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { supabase } from '../../_db.js';
import { auditLog } from '../_audit.js';

export const config = { maxDuration: 300 };

const BACKUP_BUCKET = 'armenu-backups';
const CHUNK = 5000;
const TABLES = [
  'restaurants', 'dishes', 'orders', 'order_items', 'customers', 'reservations',
  'waiter_calls', 'customer_favourites', 'customer_dish_ratings', 'loyalty_stamps',
  'categories', 'restaurant_tables', 'staff', 'manager_users', 'audit_log'
];

function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unauthenticated 300s full-DB dump would be a DoS vector.
    console.error('backup-cron: CRON_SECRET is not set — refusing call');
    return false;
  }
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // Accept either credential (Vercel Cron sends the Bearer header itself).
  return [req.query?.token, bearer].some(t => !!t && safeEq(t, secret));
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID) {
    return res.status(500).json({ error: 'R2 not configured' });
  }

  const t0 = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });

  let tablesBackedUp = 0;
  let totalRows = 0;
  const failed = [];

  for (const table of TABLES) {
    try {
      const lines = [];
      let rows = 0;
      for (let offset = 0; ; offset += CHUNK) {
        // Table names come from the constant whitelist above, never user input.
        const { data, error } = await supabase.raw(
          `select * from "${table}" order by 1 limit ${CHUNK} offset ${offset}`
        );
        if (error) throw new Error(error.message);
        for (const row of data) lines.push(JSON.stringify(row));
        rows += data.length;
        if (data.length < CHUNK) break;
      }
      const body = gzipSync(Buffer.from(lines.join('\n') + (lines.length ? '\n' : '')));
      await r2.send(new PutObjectCommand({
        Bucket: BACKUP_BUCKET,
        Key: `${day}/${table}.jsonl.gz`,
        Body: body,
        ContentType: 'application/gzip'
      }));
      tablesBackedUp++;
      totalRows += rows;
    } catch (e) {
      console.error(`backup-cron: ${table} failed:`, e.message);
      failed.push({ table, error: e.message });
    }
  }

  const ms = Date.now() - t0;
  auditLog(req, null, 'backup.run', {
    target: day, metadata: { tables_backed_up: tablesBackedUp, total_rows: totalRows, failed: failed.length, ms }
  }).catch(() => {});

  const out = { tables_backed_up: tablesBackedUp, total_rows: totalRows, ms };
  if (failed.length) out.failed = failed;
  return res.status(200).json(out);
}
