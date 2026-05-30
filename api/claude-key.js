// GET /api/claude-key
// Returns the Anthropic API key from env so it's never hardcoded in client JS.
// Rate-limiting is handled by Anthropic's own key-level limits.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'Claude not configured' }); return; }
  res.status(200).json({ key });
}
