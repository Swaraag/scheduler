// GET /api/auth
// Redirects the browser to Google's OAuth consent screen.
// Uses authorization code flow (server-side) — no popups, works everywhere.

export default function handler(req, res) {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.OAUTH_REDIRECT_URI; // e.g. https://swaraag-scheduler.vercel.app/api/callback
  if (!clientId || !redirectUri) {
    res.status(500).send('OAuth not configured'); return;
  }

  // Store where to send the user after auth (passed as ?return= query param)
  const returnTo = req.query.return || '/index.html';

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
    access_type:   'offline',   // gives us a refresh token
    prompt:        'consent',   // ensures we always get a refresh token
    state:         encodeURIComponent(returnTo),
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
