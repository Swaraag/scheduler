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

    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerName  = process.env.OWNER_NAME || 'Swaraag';

    // Create the event without attendees so Google doesn't send any RSVP emails —
    // we control all notifications via Resend below.
    const body = {
      summary:     title,
      description: [description, `Requested by: ${attendeeName || 'visitor'} <${attendeeEmail || 'no email'}>`].filter(Boolean).join('\n\n'),
      start:       { dateTime: start },
      end:         { dateTime: end },
      guestsCanModifyEvent: false,
      guestsCanInviteOthers: false,
    };

    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=none`,
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

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const fmtDt = iso => new Date(iso).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      const timeStr = `${fmtDt(start)} – ${fmtDt(end)}`;

      // Email 1: notify the owner
      if (ownerEmail) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:     'Scheduler <onboarding@resend.dev>',
            to:       ownerEmail,
            reply_to: attendeeEmail || undefined,
            subject:  `New booking: ${title}`,
            html: `
              <p><strong>${attendeeName || 'Someone'}</strong>${attendeeEmail ? ` (<a href="mailto:${attendeeEmail}">${attendeeEmail}</a>)` : ''} has booked a meeting with you.</p>
              <p><strong>Event:</strong> ${title}</p>
              <p><strong>Time:</strong> ${timeStr}</p>
              ${description ? `<p><strong>Description:</strong> ${description}</p>` : ''}
              <p>The event has been added to your Google Calendar.</p>
            `,
          }),
        }).catch(e => console.error('Resend error (owner):', e.message));
      }

      // Email 2: confirm to the visitor
      if (attendeeEmail) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:     'Scheduler <onboarding@resend.dev>',
            to:       attendeeEmail,
            reply_to: ownerEmail || undefined,
            subject:  `Your meeting with ${ownerName} is confirmed`,
            html: `
              <p>Hi ${attendeeName || 'there'},</p>
              <p>Your meeting has been booked!</p>
              <p><strong>Event:</strong> ${title}</p>
              <p><strong>Time:</strong> ${timeStr}</p>
              ${description ? `<p><strong>Description:</strong> ${description}</p>` : ''}
              <p>You'll be meeting with <strong>${ownerName}</strong>. Reply to this email if you need to make any changes.</p>
            `,
          }),
        }).catch(e => console.error('Resend error (visitor):', e.message));
      }
    }

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
