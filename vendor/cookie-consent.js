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
    // Tiny slim bar — bottom-corner pill, dismissible in one tap, doesn't cover content
    css.textContent = ''
      + '.armenu-cc-bar{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:440px;margin-left:auto;margin-right:auto;background:rgba(18,16,11,.94);color:#f5efe6;border:1px solid rgba(232,197,138,.22);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);backdrop-filter:blur(10px);padding:8px 12px;font-family:Inter,system-ui,sans-serif;font-size:11.5px;line-height:1.4;display:flex;align-items:center;gap:10px;animation:armenuCcSlide .25s ease-out}'
      + '@keyframes armenuCcSlide{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}'
      + '.armenu-cc-bar span{flex:1;color:#a89d84}'
      + '.armenu-cc-bar a{color:#e8c58a;text-decoration:underline}'
      + '.armenu-cc-bar button{padding:5px 10px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#e8c58a,#d4a574);color:#0a0806;white-space:nowrap}'
      + '.armenu-cc-bar button:active{transform:scale(.97)}';
    document.head.appendChild(css);

    var wrap = document.createElement('div');
    wrap.className = 'armenu-cc-bar';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Cookie notice');
    wrap.innerHTML = ''
      + '<span>We use essential cookies to keep the site working. <a href="/legal#privacy" target="_blank" rel="noopener">Learn more</a></span>'
      + '<button data-cc="all">OK</button>';
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
