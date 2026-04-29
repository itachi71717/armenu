/**
 * AR Menu — Cloudflare Workers API
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/dish/:restaurant/:dish          — public, used by view.html
 *   POST /api/scan                            — public, fire-and-forget scan logging
 *
 *   (auth: owner — requires Clerk session)
 *   GET  /api/admin/clients                   — list all restaurants
 *   GET  /api/admin/clients/:slug             — drill-down for one client
 *   POST /api/admin/clients                   — create restaurant
 *   POST /api/admin/dishes                    — upload dish (.glb file)
 *   GET  /api/admin/report/:slug/:period      — monthly report PDF
 *
 *   (auth: manager — restaurant-scoped Clerk session)
 *   GET  /api/portal/me                       — current restaurant + stats
 *   GET  /api/portal/dishes                   — own restaurant's dishes
 *   GET  /api/portal/qr/:dish                 — own dish QR PDF
 *   POST /api/portal/request                  — submit a change request
 */

import { generateQRCode, generateQRPDF } from './qr.js';
import { verifyClerkJWT, getOwner, getManager } from './auth.js';

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...(init.headers || {}) }
  });

const error = (msg, status = 400) => json({ error: msg }, { status });

const cors = () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type'
    }
  });

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return cors();
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      // Health
      if (path === '/api/health') return json({ ok: true, ts: Date.now() });

      // ============ PUBLIC ============
      // GET /api/dish/:r/:d  — used by view.html
      let m = path.match(/^\/api\/dish\/([^\/]+)\/([^\/]+)$/);
      if (m && request.method === 'GET') return handleDishLookup(m[1], m[2], env);

      // POST /api/scan
      if (path === '/api/scan' && request.method === 'POST') return handleScan(request, env, ctx);

      // ============ OWNER (admin) ============
      if (path.startsWith('/api/admin/')) {
        const owner = await getOwner(request, env);
        if (!owner) return error('unauthorized', 401);

        if (path === '/api/admin/clients' && request.method === 'GET') return handleAdminClients(env);
        m = path.match(/^\/api\/admin\/clients\/([^\/]+)$/);
        if (m && request.method === 'GET') return handleAdminClient(m[1], env);
        if (path === '/api/admin/clients' && request.method === 'POST') return handleAdminCreateClient(request, env);
        if (path === '/api/admin/dishes' && request.method === 'POST') return handleAdminUploadDish(request, env);
        m = path.match(/^\/api\/admin\/report\/([^\/]+)\/([^\/]+)$/);
        if (m && request.method === 'GET') return handleAdminReport(m[1], m[2], env);
      }

      // ============ MANAGER (portal) ============
      if (path.startsWith('/api/portal/')) {
        const mgr = await getManager(request, env);
        if (!mgr) return error('unauthorized', 401);

        if (path === '/api/portal/me' && request.method === 'GET') return handlePortalMe(mgr, env);
        if (path === '/api/portal/dishes' && request.method === 'GET') return handlePortalDishes(mgr, env);
        m = path.match(/^\/api\/portal\/qr\/([^\/]+)$/);
        if (m && request.method === 'GET') return handlePortalQR(m[1], mgr, env);
        if (path === '/api/portal/request' && request.method === 'POST') return handlePortalRequest(request, mgr, env);
      }

      return error('not found', 404);
    } catch (e) {
      console.error(e);
      return error('server error: ' + e.message, 500);
    }
  }
};

// ============== HANDLERS ==============

async function handleDishLookup(rSlug, dSlug, env) {
  const row = await env.DB.prepare(
    `SELECT d.id, d.name AS dish, d.price_text AS price, d.slug AS dish_slug,
            d.glb_key, d.usdz_key, d.camera_orbit AS orbit,
            r.name AS venue, r.slug AS r_slug, r.status AS r_status
     FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id
     WHERE r.slug = ? AND d.slug = ? AND d.status = 'live' AND r.status = 'live'`
  ).bind(rSlug, dSlug).first();
  if (!row) return error('dish not found', 404);

  const base = env.PUBLIC_BASE || '';
  return json({
    dish: row.dish,
    venue: row.venue,
    price: row.price,
    glb: `${base}/assets/${row.glb_key}`,
    usdz: row.usdz_key ? `${base}/assets/${row.usdz_key}` : null,
    orbit: row.orbit
  });
}

async function handleScan(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const { r, d } = body || {};
  if (!r || !d) return json({ ok: true });   // silently accept malformed; never break the diner

  // Look up ids
  const dish = await env.DB.prepare(
    `SELECT d.id AS dish_id, d.restaurant_id
     FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id
     WHERE r.slug = ? AND d.slug = ?`
  ).bind(r, d).first();
  if (!dish) return json({ ok: true });

  const ua = (body.ua || request.headers.get('user-agent') || '').slice(0, 240);
  const country = request.headers.get('cf-ipcountry') || null;
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = await sha256(ip + (env.IP_SALT || 'armenu'));

  // Insert (don't await for diner perceived speed)
  const stmt = env.DB.prepare(
    `INSERT INTO scans (dish_id, restaurant_id, ua, ip_hash, country, is_ar_capable, ar_activated)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(dish.dish_id, dish.restaurant_id, ua, ipHash, country, body.ar_capable ? 1 : 0, body.ar_activated ? 1 : 0);
  ctx.waitUntil(stmt.run());
  return json({ ok: true });
}

async function handleAdminClients(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.slug, r.name, r.plan, r.mrr_cents, r.status,
            (SELECT COUNT(*) FROM dishes d WHERE d.restaurant_id = r.id AND d.status='live') AS dishes_count,
            (SELECT COUNT(*) FROM scans s WHERE s.restaurant_id = r.id AND s.ts >= strftime('%s','now','-30 days')) AS scans_30d
     FROM restaurants r ORDER BY r.created_at DESC`
  ).all();
  return json({ clients: results });
}

async function handleAdminClient(slug, env) {
  const r = await env.DB.prepare(`SELECT * FROM restaurants WHERE slug = ?`).bind(slug).first();
  if (!r) return error('not found', 404);
  const { results: dishes } = await env.DB.prepare(
    `SELECT d.*, COALESCE(v.scans_30d,0) AS scans_30d
     FROM dishes d
     LEFT JOIN v_dish_stats_30d v ON v.dish_id = d.id
     WHERE d.restaurant_id = ? ORDER BY scans_30d DESC, d.created_at DESC`
  ).bind(r.id).all();
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS scans_30d
     FROM scans WHERE restaurant_id = ? AND ts >= strftime('%s','now','-30 days')`
  ).bind(r.id).first();
  return json({ client: r, dishes, stats });
}

async function handleAdminCreateClient(request, env) {
  const body = await request.json();
  const { slug, name, plan = 'starter', contact_email, contact_phone } = body;
  if (!slug || !name) return error('slug and name required');
  await env.DB.prepare(
    `INSERT INTO restaurants (slug, name, plan, contact_email, contact_phone, status)
     VALUES (?,?,?,?,?, 'pending')`
  ).bind(slug, name, plan, contact_email || null, contact_phone || null).run();
  return json({ ok: true });
}

async function handleAdminUploadDish(request, env) {
  // Multipart upload: glb file + JSON metadata
  const form = await request.formData();
  const file = form.get('file');
  const restaurant_slug = form.get('restaurant_slug');
  const dish_slug = form.get('dish_slug');
  const name = form.get('name');
  const price_text = form.get('price') || '';
  if (!file || !restaurant_slug || !dish_slug || !name) return error('missing fields');

  const r = await env.DB.prepare(`SELECT id FROM restaurants WHERE slug = ?`).bind(restaurant_slug).first();
  if (!r) return error('restaurant not found', 404);

  // Store .glb in R2
  const glbKey = `glb/${restaurant_slug}/${dish_slug}-${Date.now()}.glb`;
  await env.ASSETS.put(glbKey, file.stream(), { httpMetadata: { contentType: 'model/gltf-binary' } });

  // Insert dish
  await env.DB.prepare(
    `INSERT INTO dishes (restaurant_id, slug, name, price_text, glb_key, status)
     VALUES (?,?,?,?,?, 'live')
     ON CONFLICT(restaurant_id, slug) DO UPDATE SET
       name=excluded.name, price_text=excluded.price_text, glb_key=excluded.glb_key,
       status='live', updated_at=strftime('%s','now')`
  ).bind(r.id, dish_slug, name, price_text, glbKey).run();

  // Generate QR PDF and store
  const url = `${env.PUBLIC_BASE}/v?r=${restaurant_slug}&d=${dish_slug}`;
  const pdf = await generateQRPDF(url, name);
  const qrKey = `qr/${restaurant_slug}/${dish_slug}.pdf`;
  await env.ASSETS.put(qrKey, pdf, { httpMetadata: { contentType: 'application/pdf' } });
  await env.DB.prepare(`UPDATE dishes SET qr_pdf_key = ? WHERE restaurant_id = ? AND slug = ?`)
    .bind(qrKey, r.id, dish_slug).run();

  return json({ ok: true, qr_url: `${env.PUBLIC_BASE}/assets/${qrKey}` });
}

async function handleAdminReport(slug, period, env) {
  // period = 'YYYY-MM'
  const r = await env.DB.prepare(`SELECT * FROM restaurants WHERE slug = ?`).bind(slug).first();
  if (!r) return error('not found', 404);
  // Collect data, render PDF (delegated to report.js — kept simple here for clarity)
  const { renderMonthlyReport } = await import('./report.js');
  const pdf = await renderMonthlyReport(r, period, env);
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="armenu-${slug}-${period}.pdf"`
    }
  });
}

// ====== Portal (manager) ======

async function handlePortalMe(mgr, env) {
  const r = await env.DB.prepare(`SELECT * FROM restaurants WHERE id = ?`).bind(mgr.restaurant_id).first();
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS scans_30d FROM scans
     WHERE restaurant_id = ? AND ts >= strftime('%s','now','-30 days')`
  ).bind(mgr.restaurant_id).first();
  return json({ restaurant: r, stats });
}

async function handlePortalDishes(mgr, env) {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.slug, d.name, d.price_text, d.qr_pdf_key,
            COALESCE(v.scans_30d,0) AS scans_30d
     FROM dishes d
     LEFT JOIN v_dish_stats_30d v ON v.dish_id = d.id
     WHERE d.restaurant_id = ? AND d.status='live'
     ORDER BY scans_30d DESC`
  ).bind(mgr.restaurant_id).all();
  return json({ dishes: results });
}

async function handlePortalQR(dishSlug, mgr, env) {
  const dish = await env.DB.prepare(
    `SELECT qr_pdf_key FROM dishes WHERE restaurant_id = ? AND slug = ?`
  ).bind(mgr.restaurant_id, dishSlug).first();
  if (!dish?.qr_pdf_key) return error('not found', 404);
  const obj = await env.ASSETS.get(dish.qr_pdf_key);
  if (!obj) return error('not found', 404);
  return new Response(obj.body, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="qr-${dishSlug}.pdf"` }
  });
}

async function handlePortalRequest(request, mgr, env) {
  const body = await request.json();
  const { kind = 'other', body: reqBody = '' } = body;
  if (!reqBody.trim()) return error('body required');
  await env.DB.prepare(
    `INSERT INTO requests (restaurant_id, manager_id, kind, body, status) VALUES (?,?,?,?, 'open')`
  ).bind(mgr.restaurant_id, mgr.id, kind, reqBody.slice(0, 2000)).run();

  // Optional: notify owner via WhatsApp link or email — left as a hook
  return json({ ok: true });
}

// ====== utils ======

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
