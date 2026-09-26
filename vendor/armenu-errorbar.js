// Global error handler — surfaces uncaught JS errors as a subtle bottom bar so
// the diner/manager isn't left staring at a broken UI wondering what happened.
// Auto-reports to Sentry when configured (via the client already loaded).
// Never blocks — silent for expected AbortError / ResizeObserver noise.
(function () {
  if (typeof window === 'undefined') return;
  const IGNORE = /ResizeObserver|AbortError|The play\(\) request|Load failed|NetworkError when|Failed to fetch/i;
  let bar = null;
  function show(msg) {
    if (bar) { bar.querySelector('.txt').textContent = msg; return; }
    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9998;padding:9px 14px;background:rgba(248,113,113,.14);color:#f87171;border-top:1px solid rgba(248,113,113,.4);font-family:Inter,system-ui,sans-serif;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:10px';
    bar.innerHTML = '<span class="txt"></span><button style="background:none;border:none;color:#f87171;font-size:16px;cursor:pointer;padding:0 4px" aria-label="Dismiss">✕</button>';
    bar.querySelector('.txt').textContent = msg;
    bar.querySelector('button').onclick = () => { bar.remove(); bar = null; };
    document.body.appendChild(bar);
    setTimeout(() => { if (bar) { bar.remove(); bar = null; } }, 8000);
  }
  window.addEventListener('error', (e) => {
    const m = (e.message || e.error?.message || '').toString();
    if (IGNORE.test(m)) return;
    show('Something went wrong — refresh if the page seems stuck.');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const m = (e.reason?.message || String(e.reason || '')).toString();
    if (IGNORE.test(m)) return;
    // Only show for user-visible failures (network 500s etc.)
    if (m.length > 4 && m.length < 300) show('Something went wrong — refresh if the page seems stuck.');
  });
})();
