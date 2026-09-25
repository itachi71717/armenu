// ARMenu cookie / privacy consent banner (POPI + GDPR).
// Zero dependencies. Uses localStorage to remember the choice. Shows once.
// Include on every HTML page:
//   <script src="/vendor/cookie-consent.js" defer></script>
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var KEY = 'armenu_cookie_consent_v1';
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  function inject() {
    var css = document.createElement('style');
    css.textContent = ''
      + '.armenu-cc-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:520px;margin-left:auto;margin-right:auto;background:rgba(18,16,11,.97);color:#f5efe6;border:1px solid rgba(232,197,138,.3);border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.6);backdrop-filter:blur(14px);padding:16px 18px;font-family:Inter,system-ui,sans-serif;font-size:13.5px;line-height:1.55;animation:armenuCcSlide .3s ease-out}'
      + '@keyframes armenuCcSlide{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}'
      + '.armenu-cc-banner b{color:#e8c58a;font-weight:700}'
      + '.armenu-cc-banner a{color:#e8c58a;text-decoration:underline}'
      + '.armenu-cc-banner p{margin:0 0 10px 0}'
      + '.armenu-cc-banner .row{display:flex;gap:8px;flex-wrap:wrap}'
      + '.armenu-cc-banner button{flex:1;min-width:110px;padding:9px 12px;border-radius:8px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid transparent;transition:transform .1s}'
      + '.armenu-cc-banner button:active{transform:scale(.98)}'
      + '.armenu-cc-accept{background:linear-gradient(135deg,#e8c58a,#d4a574);color:#0a0806}'
      + '.armenu-cc-essential{background:rgba(245,239,220,.06);color:#a89d84;border-color:rgba(245,239,220,.14)}'
      + '@media(max-width:520px){.armenu-cc-banner{left:8px;right:8px;bottom:8px;padding:14px 16px;font-size:13px}}';
    document.head.appendChild(css);

    var wrap = document.createElement('div');
    wrap.className = 'armenu-cc-banner';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Cookie consent');
    wrap.innerHTML = ''
      + '<p><b>Cookies &amp; privacy.</b> We use a few browser-storage items to keep you signed in, remember your cart, and improve the app. No cross-site ad tracking, no third-party marketing pixels.</p>'
      + '<p style="color:#a89d84;font-size:12.5px">Learn more in our <a href="/legal#privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>'
      + '<div class="row">'
      + '<button class="armenu-cc-essential" data-cc="essential">Essential only</button>'
      + '<button class="armenu-cc-accept" data-cc="all">Accept all</button>'
      + '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      var t = e.target && e.target.closest('[data-cc]');
      if (!t) return;
      var choice = t.getAttribute('data-cc');
      try {
        localStorage.setItem(KEY, JSON.stringify({ choice: choice, ts: new Date().toISOString() }));
      } catch (err) { /* ignore */ }
      wrap.style.animation = 'armenuCcSlide .2s ease-in reverse';
      setTimeout(function () { wrap.remove(); }, 200);
      // Broadcast so future analytics/marketing scripts can respect the choice.
      try { window.dispatchEvent(new CustomEvent('armenu:consent', { detail: { choice: choice } })); } catch (e) {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
