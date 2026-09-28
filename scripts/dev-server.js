#!/usr/bin/env node
// Zero-dependency local preview server.
//   node scripts/dev-server.js            → http://localhost:5173
//   PORT=8080 PROXY_TARGET=https://armenu.co.za node scripts/dev-server.js
// Serves the repo's static files, applies the rewrites from vercel.json
// (so /m/:slug, /t/:slug/:table, /how, /pricing … behave like production),
// and proxies /api/* to PROXY_TARGET so local frontend changes can be
// exercised against a real backend without `vercel dev` or local secrets.
import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = parseInt(process.env.PORT || '5173', 10);
const TARGET = new URL(process.env.PROXY_TARGET || 'https://armenu.co.za');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2',
};

const rewrites = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    return (cfg.rewrites || []).filter(r => !r.source.startsWith('/api')).map(r => {
      const names = [];
      const rx = new RegExp('^' + r.source.replace(/:([a-zA-Z_]+)\*?/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
      return { rx, names, destination: r.destination };
    });
  } catch { return []; }
})();

function rewrite(pathname) {
  for (const r of rewrites) {
    const m = pathname.match(r.rx);
    if (!m) continue;
    let dest = r.destination;
    r.names.forEach((n, i) => { dest = dest.replace(':' + n, encodeURIComponent(decodeURIComponent(m[i + 1]))); });
    return dest;
  }
  return null;
}

function proxy(req, res) {
  const opts = {
    protocol: TARGET.protocol, hostname: TARGET.hostname, port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
    method: req.method, path: req.url,
    headers: { ...req.headers, host: TARGET.host, 'x-forwarded-host': req.headers.host },
  };
  const lib = TARGET.protocol === 'https:' ? https : http;
  const up = lib.request(opts, u => {
    const headers = { ...u.headers };
    // Let prod cookies (Secure; SameSite) stick on localhost for admin preview
    if (headers['set-cookie']) headers['set-cookie'] = [].concat(headers['set-cookie']).map(c => c.replace(/;\s*Domain=[^;]+/i, ''));
    res.writeHead(u.statusCode || 502, headers);
    u.pipe(res);
  });
  up.on('error', e => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'proxy_failed', message: e.message })); });
  req.pipe(up);
}

function serveFile(res, file) {
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return proxy(req, res);

  let pathname = url.pathname;
  const target = rewrite(pathname);
  let search = url.search;
  if (target) {
    const t = new URL(target, 'http://localhost');
    pathname = t.pathname;
    // merge rewrite query (e.g. ?r=slug) with the original query
    const merged = new URLSearchParams(t.search);
    for (const [k, v] of url.searchParams) if (!merged.has(k)) merged.set(k, v);
    search = merged.toString() ? '?' + merged.toString() : '';
    req.url = pathname + search;
  }

  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (safe.startsWith('..')) { res.writeHead(403); return res.end('forbidden'); }
  let file = join(ROOT, safe);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(file + '.html')) file += '.html';
  if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + pathname); }
  serveFile(res, file);
}).listen(PORT, () => console.log(`ARMenu preview on http://localhost:${PORT}  (api → ${TARGET.origin})`));
