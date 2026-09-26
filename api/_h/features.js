// GET /api/features → { meshy, anthropic, paddle, sentry, push }
// Public. Booleans only — never leaks the actual keys. Client uses these to
// hide/show optional tabs and buttons so managers don't hit dead-ends.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    meshy:     !!process.env.MESHY_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    paddle:    !!process.env.PADDLE_API_KEY,
    sentry:    !!process.env.SENTRY_DSN,
    push:      !!process.env.VAPID_PUBLIC_KEY,
    env:       process.env.VERCEL_ENV || 'development'
  });
}
