// GET /api/push/vapid-key → { publicKey }
// Public — no auth needed. Client calls this before subscribing.
export default function handler(req, res) {
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
}
