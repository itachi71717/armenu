// GET /api/sentry-dsn → { dsn, env } — public; empty when SENTRY_DSN unset.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    dsn: process.env.SENTRY_DSN || '',
    env: process.env.VERCEL_ENV || 'development'
  });
}
