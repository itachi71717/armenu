// Lightweight browser Sentry client — fetches DSN from /api/sentry-dsn.
// Silent no-op when SENTRY_DSN env var isn't set on the server.
// Include on every HTML page:
//   <script src="/vendor/sentry-client.js" defer></script>
(function () {
  if (typeof window === 'undefined') return;
  fetch('/api/sentry-dsn').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg || !cfg.dsn) return;
    var s = document.createElement('script');
    s.src = 'https://browser.sentry-cdn.com/8.42.0/bundle.min.js';
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = function () {
      if (!window.Sentry) return;
      try {
        window.Sentry.init({
          dsn: cfg.dsn,
          environment: cfg.env || 'production',
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
          beforeSend: function (event) {
            var frames = (event.exception && event.exception.values && event.exception.values[0] &&
                          event.exception.values[0].stacktrace && event.exception.values[0].stacktrace.frames) || [];
            var ownError = frames.some(function (f) {
              return f.filename && (f.filename.indexOf('armenu.co.za') !== -1 || f.filename.indexOf(location.host) !== -1);
            });
            return ownError ? event : null;
          }
        });
      } catch (e) { /* silent */ }
    };
    document.head.appendChild(s);
  }).catch(function () { /* silent */ });
})();
