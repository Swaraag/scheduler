// GET /api/busy?start=ISO&end=ISO
// Returns anonymized busy blocks (no titles/details) from the owner's calendar.
// Requires GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET env vars.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const token = await getAccessToken();
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const now  = new Date(); now.setHours(0,0,0,0);
    const endD = new Date(now); endD.setDate(now.getDate() + 60); // 60 days ahead
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: endD.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '500',
    });

    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!gcalRes.ok) throw new Error(`Calendar API error: ${gcalRes.status}`);
    const data = await gcalRes.json();

    // Strip all details — only return start/end times
    const busy = (data.items || [])
      .filter(e => e.start)
      .map(e => ({
        start: e.start.dateTime || e.start.date,
        end:   e.end?.dateTime  || e.end?.date || e.start.dateTime || e.start.date,
        allDay: !!e.start.date && !e.start.dateTime,
      }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ busy, ownerName: process.env.OWNER_NAME || 'Me' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error('Failed to refresh Google token');
  const { access_token } = await r.json();
  return access_token;
}
