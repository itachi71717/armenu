// Shared marketing nav + footer for /contact /faq /how /plans /why /legal etc.
// Include with:  <script src="/vendor/marketing-chrome.js" defer></script>
// The script replaces any element with id="mkNav" or id="mkFooter" with the
// canonical markup, so a page can either drop those two placeholders in or
// keep its inline copy — but new pages should use placeholders only.
(function () {
  if (typeof document === 'undefined') return;

  const YEAR = new Date().getFullYear();

  const NAV_HTML = `
    <nav class="ar-nav">
      <a href="/how">How</a>
      <a href="/discover">Discover</a>
      <a href="/#features">Features</a>
      <a href="/plans">Pricing</a>
      <a href="/faq">FAQ</a>
      <a href="/contact">Contact</a>
      <a href="/portal/">Sign in</a>
      <a href="/contact" class="ar-cta">Enquire &rarr;</a>
    </nav>`;

  const FOOTER_HTML = `
    <footer class="ar-ft">
      <div class="ar-ft-grid">
        <div>
          <a class="ar-brand" href="/"><img src="/favicon.svg" alt="ARMenu" /><span class="ar-brand-w"><span class="ar-brand-n1">ARMenu</span><span class="ar-brand-n2">South Africa</span></span></a>
          <p class="ar-ft-tag">South Africa's immersive AR menu platform for restaurants that plate with pride.</p>
        </div>
        <div><h5>Product</h5><a href="/how">How it works</a><a href="/dishes">Live demo</a><a href="/#features">Features</a><a href="/faq">FAQs</a></div>
        <div><h5>Company</h5><a href="/contact">Contact</a><a href="/plans">Pricing</a><a href="/contact?type=enterprise">Enterprise</a></div>
        <div><h5>Legal</h5><a href="/legal#terms">Terms</a><a href="/legal#privacy">Privacy</a><a href="/legal#refund">Refund</a></div>
      </div>
      <div class="ar-ft-legal">
        <span>&copy; ${YEAR} ARMenu. All rights reserved</span>
        <span>Johannesburg &middot; Cape Town &middot; Durban</span>
      </div>
    </footer>`;

  const nav = document.getElementById('mkNav');
  if (nav) nav.outerHTML = NAV_HTML;
  const ft = document.getElementById('mkFooter');
  if (ft) ft.outerHTML = FOOTER_HTML;

  // Highlight the current page's nav link
  try {
    const path = location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.ar-nav a').forEach(a => {
      if (a.getAttribute('href') === path) a.classList.add('on');
    });
  } catch {}
})();
