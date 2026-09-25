// Sentry init for serverless — imported once by the dispatcher. Silent no-op
// when SENTRY_DSN is not set, so it's always safe to import.
//
// Set SENTRY_DSN in Vercel env vars to activate. Errors caught by the
// dispatcher (Handler load failed) auto-report; handlers can also call
// captureException(err) directly.

let inited = false;
let Sentry = null;

async function ensureInit() {
  if (inited) return;
  inited = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      tracesSampleRate: 0,          // no perf tracing — keeps free tier alive
      profilesSampleRate: 0,
      // Serverless: drain the queue before the function exits
      integrations: (defaults) => defaults.filter(i => !['Http', 'Modules', 'Console'].includes(i.name))
    });
  } catch (e) {
    console.error('Sentry init failed:', e.message);
  }
}

export async function captureException(err, context = {}) {
  await ensureInit();
  if (!Sentry) return;
  try {
    Sentry.withScope(scope => {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      Sentry.captureException(err);
    });
    await Sentry.flush(1500);
  } catch {}
}

export async function captureMessage(msg, level = 'info', context = {}) {
  await ensureInit();
  if (!Sentry) return;
  try {
    Sentry.withScope(scope => {
      scope.setLevel(level);
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      Sentry.captureMessage(msg);
    });
    await Sentry.flush(1500);
  } catch {}
}
