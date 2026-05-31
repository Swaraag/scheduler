// GET /api/callback
// Google redirects here after the user signs in.
// Exchanges the authorization code for tokens, stores refresh token in a
// secure httpOnly cookie, then redirects the user back to the app with the
// access token and expiry in the URL hash (read by the app, never logged).

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  const returnTo = state ? decodeURIComponent(state) : '/index.html';

  if (error) {
    res.redirect(`${returnTo}#error=${encodeURIComponent(error)}`); return;
  }
  if (!code) {
    res.redirect(`${returnTo}#error=no_code`); return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  process.env.OAUTH_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const { access_token, refresh_token, expires_in } = await tokenRes.json();

    // Store refresh token in a secure httpOnly cookie (never accessible to JS)
    // If Google didn't return a new refresh token, keep the existing one from cookie
    if (refresh_token) {
      res.setHeader('Set-Cookie',
        `scheduler_refresh=${refresh_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`
      );
    }

    // Send access token back to the app via URL hash — readable by JS but not logged by servers
    res.redirect(`${returnTo}#access_token=${access_token}&expires_in=${expires_in || 3600}`);
  } catch (e) {
    res.redirect(`${returnTo}#error=${encodeURIComponent(e.message)}`);
  }
}
