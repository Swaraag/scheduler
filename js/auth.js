// Google auth — server-side OAuth flow via Vercel API functions.
// No GIS script, no popups. Works on Safari iOS and all browsers.

const API_BASE = ''; // empty = same origin (works for both vercel dev and production)

// ── AUTH-AWARE FETCH ───────────────────────────────────────
async function apiFetch(url, options = {}) {
  const doFetch = () => fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${gapiToken}`, ...options.headers },
  });

  let res = await doFetch();
  if (res.status !== 401) return res;

  // Token expired — try to refresh silently via server
  const refreshed = await _silentRefresh();
  if (!refreshed) {
    setCalOverlay(true, 'Session expired', false, true);
    setCalStatus(false, 'session expired');
    throw new Error('Session expired');
  }

  res = await doFetch();
  if (res.status === 401) {
    setCalOverlay(true, 'Session expired', false, true);
    setCalStatus(false, 'session expired');
    throw new Error('Session expired');
  }
  return res;
}

async function _silentRefresh() {
  try {
    const res = await fetch(`${API_BASE}/api/token`, { credentials: 'include' });
    if (!res.ok) return false;
    const { access_token, expires_in } = await res.json();
    saveToken(access_token, expires_in);
    return true;
  } catch { return false; }
}

// ── TOKEN STORAGE ──────────────────────────────────────────
function saveToken(token, expiresInSecs = 3600) {
  gapiToken = token;
  localStorage.setItem('scheduler_token', JSON.stringify({
    token, expiry: Date.now() + (Math.min(expiresInSecs, 3600) - 60) * 1000,
  }));
}

function loadSavedToken() {
  try {
    const saved = localStorage.getItem('scheduler_token');
    if (!saved) return false;
    const { token, expiry } = JSON.parse(saved);
    if (Date.now() < expiry && token) { gapiToken = token; return true; }
    localStorage.removeItem('scheduler_token');
  } catch { localStorage.removeItem('scheduler_token'); }
  return false;
}

// ── SIGN IN ────────────────────────────────────────────────
function startGoogleSignIn() {
  // Redirect to /api/auth which redirects to Google — no popup needed
  const returnTo = location.pathname + location.search;
  location.href = `${API_BASE}/api/auth?return=${encodeURIComponent(returnTo)}`;
}

// ── REQUEST ACCESS ─────────────────────────────────────────
function _showRequestAccess() {
  setCalStatus(false, 'access denied');
  const overlay = document.getElementById('cal-loading-overlay');
  const textEl  = document.getElementById('cal-loading-text');
  const inner   = overlay.querySelector('.cal-loading-inner');
  overlay.classList.remove('hidden');
  textEl.textContent = 'Your Google account isn\'t approved yet';
  inner.querySelectorAll('.overlay-action-btn, .request-access-form').forEach(e => e.remove());

  const form = document.createElement('div');
  form.className = 'request-access-form';
  form.innerHTML = `
    <p style="font-size:12px;color:var(--soft);text-align:center;margin-bottom:12px">
      Request access and the owner will be notified.
    </p>
    <input id="req-name"  type="text"  placeholder="Your name"  style="margin-bottom:8px" />
    <input id="req-email" type="email" placeholder="Your email" style="margin-bottom:10px" />
    <button class="overlay-action-btn" id="req-submit-btn" onclick="submitAccessRequest()">Request Access</button>
  `;
  inner.appendChild(form);
}

async function submitAccessRequest() {
  const name  = document.getElementById('req-name')?.value.trim();
  const email = document.getElementById('req-email')?.value.trim();
  if (!email) { return; }
  const btn = document.getElementById('req-submit-btn');
  btn.textContent = 'Sending...';
  btn.disabled = true;
  try {
    await fetch('/api/request-access', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email }),
    });
  } catch {}
  const textEl = document.getElementById('cal-loading-text');
  textEl.textContent = 'Request sent!';
  const form = document.querySelector('.request-access-form');
  if (form) form.innerHTML = `<p style="font-size:12px;color:var(--soft);text-align:center">The owner has been notified. You'll be able to sign in once approved.</p>`;
}

// ── AUTH SUCCESS ───────────────────────────────────────────
function onAuthSuccess() {
  setCalOverlay(false);
  setCalStatus(true, 'calendar connected');
  fetchCalendarList().then(() => { fetchEvents7(); fetchEventsYear(); });
}

// ── INIT ───────────────────────────────────────────────────
function initGoogleAuth() {
  // 1. Check if we just came back from Google's OAuth redirect
  if (location.hash) {
    const params = new URLSearchParams(location.hash.slice(1));
    const token  = params.get('access_token');
    const error  = params.get('error');
    const expiry = parseInt(params.get('expires_in') || '3600', 10);
    history.replaceState(null, '', location.pathname);

    if (token) {
      saveToken(token, expiry);
      onAuthSuccess();
      return;
    }
    if (error) {
      if (error === 'access_denied') {
        _showRequestAccess();
      } else {
        setCalOverlay(true, `Sign-in failed: ${error}`, true);
        setCalStatus(false, 'sign-in failed');
      }
      return;
    }
  }

  // 2. Try cached token
  if (loadSavedToken()) {
    onAuthSuccess();
    return;
  }

  // 3. Try silent refresh via cookie (user signed in before, cookie still valid)
  setCalOverlay(true, 'Connecting to Google Calendar...', false, true);
  setCalStatus(false, 'connecting...');
  _silentRefresh().then(ok => {
    if (ok) { onAuthSuccess(); }
    // If not ok, the overlay with "Retry" button is already showing
  });
}

// ── CALENDAR LIST ──────────────────────────────────────────
async function fetchCalendarList() {
  if (!gapiToken) return;
  try {
    const res  = await apiFetch(`${CAL_API}/users/me/calendarList?maxResults=250`);
    if (!res.ok) return;
    const data = await res.json();
    allCalendars = (data.items || []).filter(c => c.accessRole !== 'freeBusyReader');

    const saved = localStorage.getItem('scheduler_enabled_cals');
    if (saved) {
      enabledCalendars = new Set(JSON.parse(saved));
      enabledCalendars.forEach(id => { if (!allCalendars.find(c => c.id === id)) enabledCalendars.delete(id); });
    } else {
      const primary = allCalendars.find(c => c.primary);
      if (primary) enabledCalendars.add(primary.id);
    }

    const primary = allCalendars.find(c => c.primary);
    if (primary) {
      let name = primary.summary || primary.id || '';
      if (name.includes('@')) name = name.split('@')[0];
      if (name) document.querySelectorAll('.wordmark').forEach(el => { el.textContent = `${name}'s Schedule`; });
    }
  } catch {}
}

// ── EVENT FETCHING ─────────────────────────────────────────
function _calIds() {
  const ids = allCalendars.filter(c => enabledCalendars.has(c.id)).map(c => c.id);
  if (ids.length === 0) {
    const primary = allCalendars.find(c => c.primary);
    return primary ? [primary.id] : ['primary'];
  }
  return ids;
}

async function _fetchCalEvents(calId, params) {
  const res = await apiFetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events?${params}`);
  if (!res.ok) return [];
  const d = await res.json();
  return (d.items || []).filter(e => e.start).map(e => ({ ...e, _calId: calId }));
}

async function fetchEvents7() {
  if (!gapiToken) return;
  try {
    const now    = new Date().toISOString();
    const end    = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const params = `timeMin=${now}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=50`;
    const results = await Promise.all(_calIds().map(id => _fetchCalEvents(id, params)));
    calEvents7 = results.flat().sort((a, b) =>
      (a.start.dateTime || a.start.date).localeCompare(b.start.dateTime || b.start.date));
    renderCurrentView();
  } catch { setCalStatus(false, 'calendar error'); }
}

async function fetchEventsYear() {
  if (!gapiToken) return;
  try {
    const now = new Date(); now.setMonth(0, 1); now.setHours(0,0,0,0);
    const endD = new Date(now); endD.setFullYear(endD.getFullYear() + 1);
    const params = `timeMin=${now.toISOString()}&timeMax=${endD.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=2500`;
    const results = await Promise.all(_calIds().map(id => _fetchCalEvents(id, params)));
    calEventsYear = results.flat().sort((a, b) =>
      (a.start.dateTime || a.start.date).localeCompare(b.start.dateTime || b.start.date));
    if (currentView === 'year') renderYearView();
  } catch { calEventsYear = []; if (currentView === 'year') renderYearView(); }
}
