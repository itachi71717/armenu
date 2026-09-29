// Shared marketing header + footer for every public marketing page
// (/, /how /discover /plans /why /faq /contact /dishes /legal).
// Include with:  <script src="/vendor/marketing-chrome.js" defer></script>
// Pages use two placeholders only (no inline header/footer/CSS):
//   <div id="mkNav"></div>     -> full header (logo + nav + mobile menu)
//   <div id="mkFooter"></div>  -> footer
// This file injects its own CSS (high specificity, so page-level bare
// header/nav/footer rules cannot distort it).
(function () {
  if (typeof document === 'undefined') return;

  const YEAR = new Date().getFullYear();
  const WA = 'https://wa.me/27683282991';

  const CSS = `
  html{scroll-padding-top:76px}
  header.ar-hdr{position:fixed;top:0;left:0;right:0;bottom:auto;z-index:100;padding:14px 32px;margin:0;display:flex;justify-content:space-between;align-items:center;gap:16px;background:rgba(10,8,6,.9);backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);border:0;border-bottom:1px solid rgba(245,236,216,.08);font-family:'Inter',system-ui,sans-serif;box-sizing:border-box}
  header.ar-hdr .ar-brand{display:flex;align-items:center;gap:12px;font-weight:800;text-decoration:none;color:#f5ecd8;flex-shrink:0;position:static}
  header.ar-hdr .ar-brand img{width:32px;height:32px;display:block;flex-shrink:0}
  header.ar-hdr .ar-brand-w{display:flex;flex-direction:column;line-height:1;gap:3px}
  header.ar-hdr .ar-brand-n1{font-family:'Instrument Serif',serif;font-style:italic;font-size:19px;color:#f5ecd8;font-weight:400}
  header.ar-hdr .ar-brand-n2{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:8.5px;letter-spacing:.28em;color:#a89d84;text-transform:uppercase;font-weight:500}
  header.ar-hdr .ar-hdr-r{display:flex;align-items:center;gap:8px}
  header.ar-hdr nav.ar-nav{position:static;display:flex;justify-content:flex-start;align-items:center;gap:2px;padding:0;margin:0;background:none;border:0;backdrop-filter:none;-webkit-backdrop-filter:none;width:auto}
  header.ar-hdr nav.ar-nav a{display:inline-block;padding:9px 16px;margin:0;border-radius:9px;font-size:14px;font-weight:500;line-height:1.4;letter-spacing:0;color:#a89d84;text-decoration:none;background:none;transition:color .15s,background .15s}
  header.ar-hdr nav.ar-nav a:hover{color:#f5ecd8;background:rgba(245,236,216,.05)}
  header.ar-hdr nav.ar-nav a.on{color:#f5ecd8}
  header.ar-hdr nav.ar-nav a.ar-cta{background:#f5ecd8;color:#0a0806;padding:11px 22px;border-radius:11px;font-weight:700;margin-left:6px}
  header.ar-hdr nav.ar-nav a.ar-cta:hover{background:#e8c58a;color:#0a0806}
  header.ar-hdr .ar-burger{display:none;width:38px;height:38px;border-radius:10px;background:rgba(245,236,216,.06);border:1px solid rgba(245,236,216,.16);align-items:center;justify-content:center;cursor:pointer;padding:0;color:#f5ecd8}
  header.ar-hdr .ar-burger svg{width:18px;height:18px;stroke:#f5ecd8;fill:none;stroke-width:2;stroke-linecap:round;display:block}
  div.ar-mnav{display:none;position:fixed;top:61px;left:0;right:0;z-index:99;background:rgba(10,8,6,.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(245,236,216,.08);padding:12px 20px 20px;flex-direction:column;gap:2px;font-family:'Inter',system-ui,sans-serif}
  div.ar-mnav.on{display:flex}
  div.ar-mnav a{padding:14px 10px;border-radius:10px;font-size:16px;font-weight:600;color:#a89d84;text-decoration:none;border-bottom:1px solid rgba(245,236,216,.08)}
  div.ar-mnav a:last-child{border-bottom:0}
  div.ar-mnav a:hover{color:#f5ecd8;background:rgba(245,236,216,.05)}
  @media(max-width:820px){
    header.ar-hdr{padding:12px 18px}
    header.ar-hdr nav.ar-nav a:not(.ar-cta){display:none}
    header.ar-hdr nav.ar-nav a.ar-cta{padding:9px 16px;margin-left:0}
    header.ar-hdr .ar-burger{display:inline-flex}
  }
  @media(min-width:821px){div.ar-mnav,div.ar-mnav.on{display:none}}
  footer.ar-ft{position:relative;z-index:3;display:block;grid-template-columns:none;gap:0;max-width:none;width:auto;margin:60px 0 0;border:0;border-top:1px solid rgba(245,236,216,.08);padding:60px 32px 40px;background:rgba(0,0,0,.4);color:#f5ecd8;font-family:'Inter',system-ui,sans-serif;font-size:14px;box-sizing:border-box}
  footer.ar-ft .ar-ft-grid{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:40px}
  @media(max-width:820px){footer.ar-ft .ar-ft-grid{grid-template-columns:1fr 1fr}footer.ar-ft{padding:48px 20px 32px}}
  footer.ar-ft h5{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7a7266;margin:0 0 16px;font-weight:500}
  footer.ar-ft a{display:block;color:#a89d84;font-size:14px;padding:6px 0;text-decoration:none;transition:color .15s}
  footer.ar-ft a:hover{color:#e8c58a}
  footer.ar-ft a.ar-brand{display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:0;color:#f5ecd8}
  footer.ar-ft .ar-brand img{width:32px;height:32px;display:block}
  footer.ar-ft .ar-brand-w{display:flex;flex-direction:column;line-height:1;gap:3px}
  footer.ar-ft .ar-brand-n1{font-family:'Instrument Serif',serif;font-style:italic;font-size:19px;color:#f5ecd8}
  footer.ar-ft .ar-brand-n2{font-family:'JetBrains Mono',monospace;font-size:8.5px;letter-spacing:.28em;color:#a89d84;text-transform:uppercase}
  footer.ar-ft .ar-ft-tag{color:#a89d84;font-size:14px;line-height:1.55;max-width:300px;margin:0}
  footer.ar-ft .ar-ft-legal{max-width:1200px;margin:40px auto 0;padding-top:24px;border-top:1px solid rgba(245,236,216,.08);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a7266}
  `;

  const NAV_LINKS = [
    ['/how', 'How'],
    ['/discover', 'Discover'],
    ['/#features', 'Features'],
    ['/plans', 'Pricing'],
    ['/faq', 'FAQ'],
    ['/portal/', 'Sign in']
  ];
  const linksHtml = NAV_LINKS.map(l => '<a href="' + l[0] + '">' + l[1] + '</a>').join('');

  const NAV_HTML = `
    <header class="ar-hdr" id="hdr">
      <a class="ar-brand" href="/"><img src="/favicon.svg" alt="ARMenu" /><span class="ar-brand-w"><span class="ar-brand-n1">ARMenu</span><span class="ar-brand-n2">South Africa</span></span></a>
      <div class="ar-hdr-r">
        <nav class="ar-nav" aria-label="Main">${linksHtml}<a href="/contact" class="ar-cta">Contact</a></nav>
        <button class="ar-burger" id="arBurger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="arMobileNav"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      </div>
    </header>
    <div class="ar-mnav" id="arMobileNav">${linksHtml}<a href="/contact">Contact</a></div>`;

  const FOOTER_HTML = `
    <footer class="ar-ft">
      <div class="ar-ft-grid">
        <div>
          <a class="ar-brand" href="/"><img src="/favicon.svg" alt="ARMenu" /><span class="ar-brand-w"><span class="ar-brand-n1">ARMenu</span><span class="ar-brand-n2">South Africa</span></span></a>
          <p class="ar-ft-tag">South Africa's immersive AR menu platform for restaurants that plate with pride.</p>
        </div>
        <div><h5>Product</h5><a href="/how">How it works</a><a href="/dishes">Live demo</a><a href="/#features">Features</a><a href="/faq">FAQs</a></div>
        <div><h5>Company</h5><a href="/contact">Contact</a><a href="${WA}" target="_blank" rel="noopener">WhatsApp</a><a href="/plans">Pricing</a><a href="/contact?type=enterprise">Enterprise</a></div>
        <div><h5>Legal</h5><a href="/legal#terms">Terms</a><a href="/legal#privacy">Privacy</a><a href="/legal#refund">Refund</a></div>
      </div>
      <div class="ar-ft-legal">
        <span>&copy; ${YEAR} ARMenu. All rights reserved</span>
        <span>Johannesburg &middot; Cape Town &middot; Durban</span>
      </div>
    </footer>`;

  const nav = document.getElementById('mkNav');
  const ft = document.getElementById('mkFooter');
  if ((nav || ft) && !document.getElementById('mkChromeCss')) {
    const st = document.createElement('style');
    st.id = 'mkChromeCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  if (nav) nav.outerHTML = NAV_HTML;
  if (ft) ft.outerHTML = FOOTER_HTML;

  // Mobile menu toggle
  try {
    const b = document.getElementById('arBurger');
    const m = document.getElementById('arMobileNav');
    if (b && m) {
      b.addEventListener('click', () => {
        const open = m.classList.toggle('on');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      m.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        m.classList.remove('on');
        b.setAttribute('aria-expanded', 'false');
      }));
    }
  } catch {}

  // Highlight the current page's nav link
  try {
    const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    document.querySelectorAll('.ar-nav a, .ar-mnav a').forEach(a => {
      if ((a.getAttribute('href') || '').replace(/\/$/, '') === path) a.classList.add('on');
    });
  } catch {}
})();
