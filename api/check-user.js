// POST /api/check-user
// Body: { email }
// Checks if the email is in the ALLOWED_EMAILS env var (comma-separated).
// If yes, returns { allowed: true } and the client proceeds to sign in.
// If no, the client shows the request-access form without ever hitting Google.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { email } = req.body || {};
  if (!email) { res.status(400).json({ error: 'Email required' }); return; }

  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  // Owner is always allowed
  const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (ownerEmail) allowed.push(ownerEmail);

  const isAllowed = allowed.includes(email.trim().toLowerCase());
  res.status(200).json({ allowed: isAllowed });
}
