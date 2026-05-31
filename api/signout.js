// POST /api/signout
// Clears the scheduler_refresh cookie and revokes the Google token.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Parse refresh token from cookie so we can revoke it
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
  const refreshToken = cookies['scheduler_refresh'];

  // Revoke the token with Google (best-effort — don't block on failure)
  if (refreshToken) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${refreshToken}`, { method: 'POST' })
      .catch(() => {});
  }

  // Clear the cookie by setting it expired
  res.setHeader('Set-Cookie',
    'scheduler_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  );
  res.status(200).json({ success: true });
}
