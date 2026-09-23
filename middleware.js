// Vercel Edge Middleware — wildcard subdomain routing.
// <restaurant>.armenu.co.za/*  →  /m/<restaurant>/*
// Set up:
//   1. In Vercel dashboard → Project → Domains → add `*.armenu.co.za`
//   2. In your DNS (Host Africa or Cloudflare) add:
//        CNAME  *   cname.vercel-dns.com
//   3. Deploy. Middleware picks it up automatically.
//
// Reserved subdomains bypass the rewrite so www/api/admin still resolve normally.
export const config = { matcher: ['/((?!api|_next|_vercel|assets|vendor|favicon|robots|sitemap|.*\\..*).*)'] };

const RESERVED = new Set(['www', 'api', 'admin', 'portal', 'staff', 'app', 'preview', 'staging']);
const APEX = 'armenu.co.za';

export default function middleware(request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || '').toLowerCase().replace(/:\d+$/, '');

  if (!host.endsWith(APEX)) return;
  const sub = host.slice(0, -APEX.length - 1); // "restaurant" for restaurant.armenu.co.za
  if (!sub || RESERVED.has(sub)) return;

  const path = url.pathname;
  // Root → guest menu; /t/<label> on the subdomain → table-pinned menu.
  let target;
  if (path === '/' || path === '') target = `/menu.html?r=${encodeURIComponent(sub)}`;
  else if (path.startsWith('/t/')) {
    const label = path.slice(3).split('/')[0];
    target = `/menu.html?r=${encodeURIComponent(sub)}&t=${encodeURIComponent(label)}`;
  } else if (path.startsWith('/d/')) {
    const dish = path.slice(3).split('/')[0];
    target = `/view.html?r=${encodeURIComponent(sub)}&d=${encodeURIComponent(dish)}`;
  } else {
    // Pass through anything else as-is (still scoped to the subdomain host).
    return;
  }

  const rewritten = new URL(target, url.origin);
  return Response.redirect(rewritten, 307).clone
    ? new Response(null, { status: 307, headers: { location: rewritten.pathname + rewritten.search } })
    : undefined;
}
