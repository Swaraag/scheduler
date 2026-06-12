// POST /api/check-user
// Body: { email }
// Checks if the email is in the BLOCKED_EMAILS env var (comma-separated).
// Everyone is allowed by default; blocked emails are turned away silently.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { email } = req.body || {};
  if (!email) { res.status(400).json({ error: 'Email required' }); return; }

  const blocked = (process.env.BLOCKED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  const isBlocked = blocked.includes(email.trim().toLowerCase());
  res.status(200).json({ allowed: !isBlocked });
}
