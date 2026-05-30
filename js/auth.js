// Google auth, calendar list, and event fetching — all "talking to Google"

// ── AUTH-AWARE FETCH ───────────────────────────────────────
async function apiFetch(url, options = {}) {
  const doFetch = () => fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${gapiToken}`, ...options.headers },
  });

  let res = await doFetch();
  if (res.status !== 401) return res;

  const refreshed = await _silentRefresh();
  if (!refreshed) {
    setCalOverlay(true, 'Session expired — sign in again', false, true);
    setCalStatus(false, 'session expired');
    throw new Error('Session expired');
  }

  res = await doFetch();
  if (res.status === 401) {
    setCalOverlay(true, 'Session expired — sign in again', false, true);
    setCalStatus(false, 'session expired');
    throw new Error('Session expired');
  }
  return res;
}

function _silentRefresh() {
  return new Promise(resolve => {
    if (!window.google?.accounts?.oauth2 || !config.clientId) { resolve(false); return; }
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope:     GOOGLE_SCOPES,
      callback:  (resp) => {
        if (resp.error) { resolve(false); return; }
        saveToken(resp.access_token);
        resolve(true);
      },
    });
    tc.requestAccessToken({ prompt: '' });
  });
}

// ── REDIRECT AUTH (popup-blocked fallback) ─────────────────
// Saves view state, then redirects the whole page to Google's auth endpoint.
// Google redirects back with #access_token in the hash — handled in initGoogleAuth.
function startGoogleAuthRedirect() {
  if (!config.clientId) return;
  localStorage.setItem('scheduler_auth_return', JSON.stringify({
    view: currentView, weekOffset: currentWeekOffset,
    monthOffset: currentMonthOffset, yearOffset: currentYearOffset,
  }));
  const params = new URLSearchParams({
    client_id:     config.clientId,
    redirect_uri:  location.origin + location.pathname,
    response_type: 'token',
    scope:         GOOGLE_SCOPES,
  });
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function _handleRedirectToken() {
  if (!location.hash || !location.hash.includes('access_token')) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const token  = params.get('access_token');
  const expiry = parseInt(params.get('expires_in') || '3600', 10);
  history.replaceState(null, '', location.pathname);
  if (!token) return false;
  saveToken(token, expiry);
  return true;
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

// ── AUTH SUCCESS ───────────────────────────────────────────
function onAuthSuccess() {
  setCalOverlay(false);
  setCalStatus(true, 'calendar connected');
  fetchCalendarList().then(() => { fetchEvents7(); fetchEventsYear(); });
}

// ── INIT ───────────────────────────────────────────────────
function initGoogleAuth() {
  // Check if we just came back from a redirect-based auth (popup-blocked fallback)
  if (_handleRedirectToken()) {
    try {
      const ret = JSON.parse(localStorage.getItem('scheduler_auth_return') || 'null');
      if (ret) {
        localStorage.removeItem('scheduler_auth_return');
        currentWeekOffset = ret.weekOffset || 0;
        currentMonthOffset = ret.monthOffset || 0;
        currentYearOffset = ret.yearOffset || 0;
      }
    } catch {}
    onAuthSuccess();
    return;
  }

  const loadGIS = (onload) => {
    if (window.google?.accounts?.oauth2) { onload(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = onload;
    s.onerror = () => {
      setCalOverlay(true, 'Failed to load Google auth', true);
      setCalStatus(false, 'network error');
    };
    document.head.appendChild(s);
  };

  const authCallback = (resp) => {
    if (!resp.error) {
      saveToken(resp.access_token);
      onAuthSuccess();
      return;
    }
    if (resp.error === 'access_denied') {
      setCalOverlay(true, 'Access denied — check Google Cloud test users', true);
      setCalStatus(false, 'access denied');
    } else if (resp.error === 'popup_blocked' || resp.error === 'popup_failed_to_open') {
      // Chrome blocked the popup — offer a redirect-based sign-in instead
      setCalOverlay(true, 'Popup blocked by browser', false, false, true);
      setCalStatus(false, 'popup blocked');
    } else {
      // interaction_required, login_required, etc. — user needs to sign in
      setCalOverlay(true, 'Tap to connect Google Calendar', false, true);
      setCalStatus(false, 'sign in required');
    }
  };

  const makeTC = () => google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope:     GOOGLE_SCOPES,
    callback:  authCallback,
  });

  if (loadSavedToken()) {
    onAuthSuccess();
    loadGIS(() => { window._tokenClient = makeTC(); });
    return;
  }

  // Show connecting overlay immediately with a sign-in button visible from the start.
  // The silent auth attempt runs in the background — if it succeeds the overlay
  // disappears. If Chrome blocks the popup, the button is already there to click.
  requestAnimationFrame(() => setCalOverlay(true, 'Connecting to Google Calendar...', false, true));
  loadGIS(() => {
    window._tokenClient = makeTC();
    window._tokenClient.requestAccessToken({ prompt: '' });
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
