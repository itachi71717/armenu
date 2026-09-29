// Global error handler — surfaces uncaught JS errors as a subtle bottom bar so
// the diner/manager isn't left staring at a broken UI wondering what happened.
// Auto-reports to Sentry when configured (via the client already loaded).
// Never blocks — silent for expected AbortError / ResizeObserver noise.
//
// Failed /api/ fetches (network error or 5xx) are recorded in a retry queue
// and shown as a friendly "Something didn't load properly. Tap to try again"
// pill. Tapping replays the failed idempotent requests (GET/HEAD) and, once
// they succeed, reloads the page so the UI re-renders with the data.
// Non-idempotent requests (POST etc.) are never replayed automatically — the
// pill falls back to a reload. Every failure is also logged via console.error.
(function () {
  if (typeof window === 'undefined') return;
  const IGNORE = /ResizeObserver|AbortError|The play\(\) request|Load failed|NetworkError when|Failed to fetch/i;
  const MSG = 'Something went wrong — refresh if the page seems stuck.';
  let bar = null;
  let hideTimer = null;
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
    console.error('[armenu-errorbar] uncaught error:', e.error || m);
    show(MSG);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const m = (e.reason?.message || String(e.reason || '')).toString();
    if (IGNORE.test(m)) return;
    // Only show for user-visible failures (network 500s etc.)
    if (m.length > 4 && m.length < 300) {
      console.error('[armenu-errorbar] unhandled rejection:', e.reason);
      show(MSG);
    }
  });

  // ---- Failed-fetch retry queue ----
  const queue = []; // { id, url, init, replay } — capped, de-duplicated by method+url
  const MAX_QUEUE = 20;
  const origFetch = window.fetch;
  let pill = null;

  function showPill() {
    if (pill || !document.body) return;
    pill = document.createElement('button');
    pill.type = 'button';
    pill.setAttribute('role', 'alert');
    pill.textContent = "Something didn't load properly. Tap to try again";
    pill.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;max-width:calc(100vw - 32px);padding:10px 18px;border-radius:999px;border:1px solid rgba(248,113,113,.5);background:#1c1917;color:#fca5a5;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)';
    pill.onclick = retry;
    document.body.appendChild(pill);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePill, 15000);
  }
  function hidePill() {
    clearTimeout(hideTimer);
    if (pill) { pill.remove(); pill = null; }
  }
  // Background pollers/heartbeats retry on their own — a failure there is not user-facing.
  const QUIET = new RegExp("/api/(customer/menu-presence|order-status|events)([?]|$)");
  function record(url, init, why) {
    console.error('[armenu-errorbar] request failed:', url, why);
    if (QUIET.test(String(url))) return;
    const method = ((init && init.method) || 'GET').toUpperCase();
    const id = method + ' ' + url;
    if (!queue.some(q => q.id === id)) {
      if (queue.length >= MAX_QUEUE) queue.shift();
      // Only replay idempotent requests; body-carrying ones are not safe to repeat.
      queue.push({
        id, url,
        init: init ? { method: init.method, headers: init.headers } : undefined,
        replay: method === 'GET' || method === 'HEAD'
      });
    }
    showPill();
  }
  async function retry() {
    hidePill();
    const items = queue.splice(0, queue.length);
    for (const q of items) {
      if (!q.replay) continue;
      try {
        const r = await origFetch.call(window, q.url, q.init);
        if (r.status >= 500) throw new Error('HTTP ' + r.status);
      } catch (err) {
        record(q.url, q.init, err);
      }
    }
    // Page code owns rendering, so reload to re-run it once data is reachable.
    if (queue.length === 0) location.reload();
  }

  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const isApi = /^(https?:)?\/\/[^/]+\/api\//.test(url) || url.indexOf('/api/') === 0;
      const p = origFetch.apply(this, arguments);
      if (!isApi) return p;
      const meta = init || (typeof input === 'object' && input ? { method: input.method } : undefined);
      return p.then((r) => {
        if (r.status >= 500) record(url, meta, 'HTTP ' + r.status);
        return r;
      }, (err) => {
        if (!(err && err.name === 'AbortError')) record(url, meta, err);
        throw err; // never swallow — callers still see the failure
      });
    };
  }
})();
