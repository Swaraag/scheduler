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

  const resendKey      = process.env.RESEND_API_KEY;
  const ownerEmail     = process.env.OWNER_EMAIL;
  const currentAllowed = (process.env.ALLOWED_EMAILS || '').trim();

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
          <p><strong>${name || 'Someone'}</strong> (<a href="mailto:${email}">${email}</a>) wants access to your Scheduler app.</p>
          ${note ? `<p><strong>Their note:</strong> ${note}</p>` : ''}
          <p><strong>Step 1</strong> — <a href="https://console.cloud.google.com/apis/credentials/consent">Add them as a Google OAuth test user</a></p>
          <p><strong>Step 2</strong> — Run these in your terminal (from the scheduler project directory):</p>
          <p style="font-size:12px;color:#888;margin-bottom:4px">Remove the old value:</p>
          <pre style="background:#111;color:#c8f135;padding:12px;border-radius:6px;font-size:13px;margin-bottom:8px">vercel env rm ALLOWED_EMAILS production -y</pre>
          <p style="font-size:12px;color:#888;margin-bottom:4px">Add the updated list (current list + new user, already filled in for you):</p>
          <pre style="background:#111;color:#c8f135;padding:12px;border-radius:6px;font-size:13px;margin-bottom:8px">echo "${currentAllowed ? currentAllowed + ',' : ''}${email}" | vercel env add ALLOWED_EMAILS production</pre>
          <p style="font-size:12px;color:#888;margin-bottom:4px">Redeploy:</p>
          <pre style="background:#111;color:#c8f135;padding:12px;border-radius:6px;font-size:13px">vercel --prod</pre>
          <p><strong>Step 3</strong> — Reply to this email to let them know they're in (reply goes directly to ${email}).</p>
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
