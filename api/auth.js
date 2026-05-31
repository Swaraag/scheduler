// GET /api/auth
// Redirects the browser to Google's OAuth consent screen.
// Uses authorization code flow (server-side) — no popups, works everywhere.

export default function handler(req, res) {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).send('OAuth not configured'); return;
  }

  const returnTo = req.query.return || '/index.html';

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
    access_type:   'offline',
    prompt:        'consent',
    state:         encodeURIComponent(returnTo),
  });
  if (req.query.login_hint) params.set('login_hint', req.query.login_hint);

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
