// POST /api/book
// Body: { title, start, end, description, attendeeName, attendeeEmail }
// Creates an event on the owner's calendar. Sends an email notification to the owner.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { title, start, end, description, attendeeName, attendeeEmail } = req.body;
    if (!title || !start || !end) {
      res.status(400).json({ error: 'title, start, and end are required' }); return;
    }

    const token = await getAccessToken();
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const tz    = 'America/Los_Angeles'; // server default; client sends its own tz in start/end

    const attendees = [];
    if (attendeeEmail) attendees.push({ email: attendeeEmail, displayName: attendeeName || undefined });

    const body = {
      summary:     title,
      description: description || `Meeting requested by ${attendeeName || 'a visitor'}.`,
      start:       { dateTime: start },
      end:         { dateTime: end },
      attendees,
    };

    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=all`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }
    );
    if (!gcalRes.ok) {
      const err = await gcalRes.text();
      throw new Error(`Calendar API error: ${gcalRes.status} — ${err}`);
    }
    const event = await gcalRes.json();
    res.status(200).json({ success: true, eventId: event.id });
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
