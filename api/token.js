// GET /api/token
// Returns a fresh access token using the refresh token stored in the httpOnly cookie.
// Called by the app whenever it needs to make a Google API call.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Parse refresh token from cookie
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
  const refreshToken = cookies['scheduler_refresh'];

  if (!refreshToken) {
    res.status(401).json({ error: 'not_authenticated' }); return;
  }

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    });
    if (!r.ok) { res.status(401).json({ error: 'refresh_failed' }); return; }
    const { access_token, expires_in } = await r.json();
    res.status(200).json({ access_token, expires_in: expires_in || 3600 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
