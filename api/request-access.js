// POST /api/request-access
// Body: { email, name }
// Sends an email to the owner notifying them someone wants access.
// Uses Resend (resend.com) — free tier, no SMTP setup needed.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { email, name, note } = req.body;
  if (!email) { res.status(400).json({ error: 'Email required' }); return; }

  const resendKey  = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!resendKey || !ownerEmail) {
    // Graceful fallback if Resend isn't configured — still return success
    // so the user sees a confirmation, but log it
    console.log(`Access request from: ${name || 'unknown'} <${email}>`);
    res.status(200).json({ success: true }); return;
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     `Scheduler <onboarding@resend.dev>`,
        to:       ownerEmail,
        reply_to: email,
        subject:  `Access request: ${name || email} (${new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })})`,
        html:     `
          <p><strong>${name || 'Someone'}</strong> (<a href="mailto:${email}">${email}</a>) just tried to sign in to your Scheduler app but isn't a test user yet.</p>
          ${note ? `<p><strong>Their note:</strong> ${note}</p>` : ''}
          <p>To give them access:</p>
          <ol>
            <li>Go to <a href="https://console.cloud.google.com/apis/credentials/consent">Google Cloud Console → OAuth consent screen</a></li>
            <li>Scroll to Test Users → Add Users</li>
            <li>Add <strong>${email}</strong></li>
          </ol>
          <p>Once added, <strong>just reply to this email</strong> — your reply will go directly to ${name || 'them'} at ${email}.</p>
        `,
      }),
    });

    if (!r.ok) throw new Error(await r.text());
    res.status(200).json({ success: true });
  } catch (e) {
    console.error('Resend error:', e.message);
    // Still return success — don't block the user on email failure
    res.status(200).json({ success: true });
  }
}
