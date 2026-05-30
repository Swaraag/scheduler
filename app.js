// =============================================================
// app.js — Scheduler
// Sections: Config · Auth · Calendar Fetch · Cal Views (Day/
//   Week/Month/Year) · Input (Voice+Text+Image) · Claude API ·
//   Proposals · Calendar Write · Event Popup · Settings · UI
// =============================================================

// ── CONSTANTS ──────────────────────────────────────────────
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

const CAL_API         = 'https://www.googleapis.com/calendar/v3';
const CLAUDE_API      = 'https://api.anthropic.com/v1/messages';
const MODEL           = 'claude-haiku-4-5-20251001';
const WEEK_START_HOUR = 7;
const WEEK_END_HOUR   = 22;
const HOUR_PX         = 44;

// ── STATE ──────────────────────────────────────────────────
let config            = {};
let gapiToken         = null;
let recognition       = null;
let isRecording       = false;
let uploadedImage     = null;
let calEvents7        = [];   // fast: next 7 days
let calEventsYear     = null; // null = still loading
let proposedEvents    = [];
let selectedProposals = new Set();
let currentView       = 'week';

// ── INIT ───────────────────────────────────────────────────
window.onload = () => {
  const saved = localStorage.getItem('scheduler_config');
  if (saved) { config = JSON.parse(saved); showApp(); }
};

// ── CONFIG ─────────────────────────────────────────────────
function saveConfig() {
  const clientId = document.getElementById('input-client-id').value.trim();
  const apiKey   = document.getElementById('input-api-key').value.trim();
  if (!clientId || !apiKey) { showToast('Fill in both fields', 'error'); return; }
  config = { clientId, apiKey };
  localStorage.setItem('scheduler_config', JSON.stringify(config));
  showApp();
}

function showApp() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'flex';
  // Show a loading placeholder in the calendar until first fetch completes
  document.getElementById('cal-week-view').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:40px;justify-content:center;color:var(--muted);font-size:13px;">
      <div class="spinner"></div>connecting to calendar...
    </div>`;
  initGoogleAuth();
}

// ── SETTINGS MODAL ─────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('reset-confirm-area').classList.add('hidden');
  document.getElementById('reset-initial-area').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}
function showResetConfirm() {
  document.getElementById('reset-initial-area').classList.add('hidden');
  document.getElementById('reset-confirm-area').classList.remove('hidden');
}
function resetConfig() {
  localStorage.removeItem('scheduler_config');
  location.reload();
}

// ── GOOGLE AUTH ────────────────────────────────────────────
function saveToken(token) {
  gapiToken = token;
  localStorage.setItem('scheduler_token', JSON.stringify({
    token,
    expiry: Date.now() + 55 * 60 * 1000, // 55 min (tokens last 1hr, expire early for safety)
  }));
}

function loadSavedToken() {
  try {
    const saved = localStorage.getItem('scheduler_token');
    if (!saved) return false;
    const { token, expiry } = JSON.parse(saved);
    if (Date.now() < expiry) { gapiToken = token; return true; }
  } catch {}
  return false;
}

function onAuthSuccess() {
  setCalStatus(true, 'calendar connected');
  fetchEvents7();
  fetchEventsYear();
}

function initGoogleAuth() {
  const loadGIS = (onload) => {
    const s = document.createElement('script');
    s.src   = 'https://accounts.google.com/gsi/client';
    s.onload = onload;
    document.head.appendChild(s);
  };

  const makeTokenClient = () => google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope:     GOOGLE_SCOPES,
    callback:  (resp) => {
      if (resp.error) { setCalStatus(false, 'auth failed'); return; }
      saveToken(resp.access_token);
      onAuthSuccess();
    },
  });

  // If a valid cached token exists, use it immediately — no popup
  if (loadSavedToken()) {
    onAuthSuccess();
    // Load GIS silently in background so re-auth works when token eventually expires
    loadGIS(() => { window._tokenClient = makeTokenClient(); });
    return;
  }

  // No valid token — load GIS and trigger auth
  loadGIS(() => {
    window._tokenClient = makeTokenClient();
    window._tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ── CALENDAR FETCH ─────────────────────────────────────────
async function fetchEvents7() {
  if (!gapiToken) return;
  try {
    const now = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const url = `${CAL_API}/calendars/primary/events?timeMin=${now}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=50`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gapiToken}` } });
    if (!res.ok) throw new Error();
    const d   = await res.json();
    calEvents7 = (d.items || []).filter(e => e.start);
    renderCurrentView();
  } catch { setCalStatus(false, 'calendar error'); }
}

async function fetchEventsYear() {
  if (!gapiToken) return;
  try {
    const now    = new Date(); now.setMonth(0, 1); now.setHours(0,0,0,0);
    const start  = now.toISOString();
    const endD   = new Date(now); endD.setFullYear(endD.getFullYear() + 1);
    const end    = endD.toISOString();
    // Google max 2500 per request — good enough for a year
    const url    = `${CAL_API}/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=2500`;
    const res    = await fetch(url, { headers: { Authorization: `Bearer ${gapiToken}` } });
    if (!res.ok) throw new Error();
    const d      = await res.json();
    calEventsYear = (d.items || []).filter(e => e.start);
    // If user is already on year view, render it
    if (currentView === 'year') renderYearView();
  } catch { calEventsYear = []; if (currentView === 'year') renderYearView(); }
}

// ── VIEW SWITCHER ──────────────────────────────────────────
function switchCalView(view) {
  currentView = view;
  ['day','week','month','year'].forEach(v => {
    document.getElementById(`pill-${v}`).classList.toggle('active', v === view);
    document.getElementById(`cal-${v}-view`).classList.toggle('hidden', v !== view);
  });
  renderCurrentView();
}

function renderCurrentView() {
  switch (currentView) {
    case 'day':   renderDayView();   break;
    case 'week':  renderWeekView();  break;
    case 'month': renderMonthView(); break;
    case 'year':  renderYearView();  break;
  }
}

// ── DAY VIEW ───────────────────────────────────────────────
function renderDayView() {
  const el    = document.getElementById('cal-day-view');
  const today = new Date(); today.setHours(0,0,0,0);
  const dayStr = today.toISOString().slice(0,10);

  const events = calEvents7.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dayStr);
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  el.innerHTML = buildTimeGrid(
    [{ date: today, label: DAY_NAMES[today.getDay()], events, isToday: true }],
    'single'
  );
  scrollToNow(el);
}

// ── WEEK VIEW ──────────────────────────────────────────────
function renderWeekView(extra = []) {
  const el    = document.getElementById('cal-week-view');
  const today = new Date(); today.setHours(0,0,0,0);
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const cols = Array.from({ length: 7 }, (_, i) => {
    const d      = new Date(today); d.setDate(today.getDate() + i);
    const dayStr = d.toISOString().slice(0,10);
    const events = calEvents7.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dayStr);
    const proposed = extra.filter(e => (e.start || '').slice(0,10) === dayStr);
    return { date: d, label: DAY_ABBR[d.getDay()], events, proposed, isToday: i === 0 };
  });

  el.innerHTML = buildTimeGrid(cols, 'multi');
  scrollToNow(el);
}

// ── SHARED TIME GRID BUILDER ───────────────────────────────
function buildTimeGrid(cols, mode) {
  const totalHours = WEEK_END_HOUR - WEEK_START_HOUR;
  const colCount   = cols.length;
  const gridCols   = `44px repeat(${colCount}, 1fr)`;

  const headerCells = cols.map(c => `
    <div class="tg-day-label ${c.isToday ? 'today' : ''}">
      ${c.label}
      <span class="day-num">${c.date.getDate()}</span>
    </div>`).join('');

  const timeLabels = Array.from({ length: totalHours }, (_, i) => {
    const h = WEEK_START_HOUR + i;
    return `<div class="tg-time-label">${h > 12 ? h-12 : h}${h >= 12 ? 'pm' : 'am'}</div>`;
  }).join('');

  const dayCols = cols.map(c => {
    const dayStr = c.date.toISOString().slice(0,10);
    const blocks = (c.events || []).map(e => eventBlock(e, false)).join('');
    const proposed = (c.proposed || []).map(e => proposedBlock(e)).join('');
    const now = new Date();
    const nowLine = c.isToday
      ? `<div class="now-line" style="top:${(now.getHours() + now.getMinutes()/60 - WEEK_START_HOUR) * HOUR_PX}px"></div>`
      : '';
    return `<div class="tg-day-col">${blocks}${proposed}${nowLine}</div>`;
  }).join('');

  return `<div class="time-grid">
    <div class="tg-header" style="grid-template-columns:${gridCols}">
      <div class="tg-corner" style="width:44px"></div>
      ${headerCells}
    </div>
    <div class="tg-body" style="grid-template-columns:${gridCols}">
      <div class="tg-time-col">${timeLabels}</div>
      ${dayCols}
    </div>
  </div>`;
}

function eventBlock(ev, isProposed) {
  const start  = new Date(ev.start?.dateTime || ev.start?.date || ev.start);
  const end    = new Date(ev.end?.dateTime   || ev.end?.date   || ev.end || ev.start?.dateTime || ev.start);
  const startH = start.getHours() + start.getMinutes() / 60;
  const endH   = end.getHours()   + end.getMinutes()   / 60;
  const top    = Math.max(0, startH - WEEK_START_HOUR) * HOUR_PX;
  const height = Math.max(18, (endH - startH) * HOUR_PX);
  const title  = ev.summary || ev.title || 'Event';
  const data   = encodeURIComponent(JSON.stringify({ title, start: start.toISOString(), end: end.toISOString(), desc: ev.description || '', loc: ev.location || '' }));
  return `<div class="tg-event${isProposed?' proposed':''}" style="top:${top}px;height:${height}px" onclick="showEventPopup(event,'${data}')">
    <div class="tg-event-title">${title}</div>
  </div>`;
}

function proposedBlock(ev) {
  const start  = new Date(ev.start);
  const end    = new Date(ev.end);
  const startH = start.getHours() + start.getMinutes() / 60;
  const endH   = end.getHours()   + end.getMinutes()   / 60;
  const top    = Math.max(0, startH - WEEK_START_HOUR) * HOUR_PX;
  const height = Math.max(18, (endH - startH) * HOUR_PX);
  const data   = encodeURIComponent(JSON.stringify({ title: ev.title, start: ev.start, end: ev.end, desc: ev.description || '', loc: '' }));
  return `<div class="tg-event proposed" style="top:${top}px;height:${height}px" onclick="showEventPopup(event,'${data}')">
    <div class="tg-event-title">${ev.title}</div>
  </div>`;
}

function scrollToNow(el) {
  const body = el.querySelector('.tg-body');
  if (body) body.scrollTop = Math.max(0, (new Date().getHours() - WEEK_START_HOUR - 1)) * HOUR_PX;
}

// ── MONTH VIEW ─────────────────────────────────────────────
function renderMonthView(extra = []) {
  const el    = document.getElementById('cal-month-view');
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth();

  const firstDay  = new Date(year, month, 1);
  const lastDay   = new Date(year, month + 1, 0);
  const startPad  = firstDay.getDay(); // 0=Sun
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const headerCells = DAY_NAMES.map(d => `<div class="month-day-name">${d}</div>`).join('');

  // Build cells array: padding + actual days + trailing padding
  let cells = [];
  // Leading empty cells
  for (let i = 0; i < startPad; i++) cells.push({ empty: true, otherMonth: true });
  // Actual days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date    = new Date(year, month, d);
    const dateStr = date.toISOString().slice(0,10);
    const evs     = calEvents7.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dateStr);
    const prop    = extra.filter(e => (e.start || '').slice(0,10) === dateStr);
    cells.push({ d, date, dateStr, events: evs, proposed: prop, isToday: d === today.getDate() });
  }
  // Trailing
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells.push({ empty: true, otherMonth: true });

  const cellsHtml = cells.map(c => {
    if (c.empty) return `<div class="month-cell other-month"></div>`;
    const pills = c.events.slice(0,3).map(e =>
      `<span class="month-pill" onclick="event.stopPropagation();showEventPopupFromEl(event,${JSON.stringify(JSON.stringify({title:e.summary||'Event',start:e.start.dateTime||e.start.date,end:e.end?.dateTime||e.end?.date||'',desc:e.description||'',loc:e.location||''}))})">${e.summary||'Event'}</span>`
    ).join('');
    const propPills = c.proposed.map(e =>
      `<span class="month-pill proposed">${e.title}</span>`
    ).join('');
    const overflow = c.events.length > 3 ? `<div class="month-overflow">+${c.events.length-3} more</div>` : '';
    return `<div class="month-cell ${c.isToday?'today':''}" onclick="switchCalView('day')">
      <div class="month-cell-num">${c.d}</div>
      ${pills}${propPills}${overflow}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="month-grid">
      <div style="padding:12px 16px 8px;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--soft);border-bottom:1px solid var(--border)">
        ${MONTH_NAMES[month]} ${year}
      </div>
      <div class="month-header-row">${headerCells}</div>
      <div class="month-body">${cellsHtml}</div>
    </div>`;
}

// ── YEAR VIEW ──────────────────────────────────────────────
function renderYearView() {
  const loadingEl = document.getElementById('year-loading');
  const gridEl    = document.getElementById('year-grid');

  if (calEventsYear === null) {
    // Still loading — show spinner
    loadingEl.classList.remove('hidden');
    gridEl.classList.add('hidden');
    return;
  }

  loadingEl.classList.add('hidden');
  gridEl.classList.remove('hidden');

  const today = new Date();
  const year  = today.getFullYear();
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build event count map: { 'YYYY-MM-DD': count }
  const countMap = {};
  calEventsYear.forEach(e => {
    const d = (e.start.dateTime || e.start.date || '').slice(0,10);
    if (d) countMap[d] = (countMap[d] || 0) + 1;
  });

  const monthsHtml = MONTH_NAMES.map((name, mi) => {
    const firstDay = new Date(year, mi, 1);
    const lastDay  = new Date(year, mi + 1, 0);
    const pad      = firstDay.getDay();
    let cells      = Array(pad).fill('<div class="year-day other-month"></div>');
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(mi+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const count   = countMap[dateStr] || 0;
      const level   = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
      const isToday = today.getFullYear() === year && today.getMonth() === mi && today.getDate() === d;
      cells.push(`<div class="year-day has-events-${level} ${isToday?'today':''}" title="${count} event${count!==1?'s':''}"></div>`);
    }
    return `<div class="year-month" onclick="switchCalView('month')">
      <div class="year-month-name">${name}</div>
      <div class="year-month-grid">${cells.join('')}</div>
    </div>`;
  }).join('');

  gridEl.innerHTML = `<div class="year-grid-wrap"><div class="year-months">${monthsHtml}</div></div>`;
}

// ── EVENT POPUP ────────────────────────────────────────────
function showEventPopup(mouseEvent, encodedData) {
  mouseEvent.stopPropagation();
  const data = JSON.parse(decodeURIComponent(encodedData));
  _renderPopup(data, mouseEvent.clientX, mouseEvent.clientY);
}
function showEventPopupFromEl(mouseEvent, jsonStr) {
  mouseEvent.stopPropagation();
  const data = JSON.parse(jsonStr);
  _renderPopup(data, mouseEvent.clientX, mouseEvent.clientY);
}

function _renderPopup(data, cx, cy) {
  const popup = document.getElementById('event-popup');
  document.getElementById('popup-title').textContent = data.title || 'Event';

  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
      + (iso.includes('T') ? ' · ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '');
  };
  const timeStr = data.end ? `${fmt(data.start)} – ${fmt(data.end)}` : fmt(data.start);
  document.getElementById('popup-time').textContent = timeStr;
  document.getElementById('popup-desc').textContent = data.desc || '';
  document.getElementById('popup-loc').textContent  = data.loc  ? `📍 ${data.loc}` : '';

  popup.classList.remove('hidden');
  document.getElementById('popup-overlay').classList.remove('hidden');

  // Position near click, keep on screen
  const vw = window.innerWidth, vh = window.innerHeight;
  let   left = cx + 12, top = cy + 12;
  if (left + 320 > vw - 10) left = cx - 332;
  if (top  + 160 > vh - 10) top  = cy - 172;
  popup.style.left = `${Math.max(10, left)}px`;
  popup.style.top  = `${Math.max(10, top)}px`;
}

function closeEventPopup() {
  document.getElementById('event-popup').classList.add('hidden');
  document.getElementById('popup-overlay').classList.add('hidden');
}

// ── VOICE INPUT ────────────────────────────────────────────
function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError("Voice not supported. Try Chrome on desktop or Android."); return; }

  recognition                = new SR();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  const input         = document.getElementById('main-input');
  const existingText  = input.value.trim();
  let   finalPart     = '';

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalPart += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    input.value = (existingText ? existingText + ' ' : '') + finalPart + interim;
  };

  recognition.onerror = (e) => { stopRecording(); if (e.error !== 'no-speech') showError('Voice error: ' + e.error); };
  recognition.onend   = () => { if (isRecording) recognition.start(); };
  recognition.start();
  isRecording = true;

  const btn = document.getElementById('mic-btn');
  btn.classList.add('recording');
  btn.title = 'Tap to stop recording';
  hideError();
}

function stopRecording() {
  if (recognition) { recognition.onend = null; recognition.stop(); }
  isRecording = false;
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('recording');
  btn.title = 'Voice input';
}

// ── IMAGE INPUT ────────────────────────────────────────────
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader  = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    uploadedImage = { base64: dataUrl.split(',')[1], mediaType: file.type, filename: file.name };
    document.getElementById('image-thumb').src = dataUrl;
    document.getElementById('image-strip').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  uploadedImage = null;
  document.getElementById('image-file-input').value = '';
  document.getElementById('image-thumb').src        = '';
  document.getElementById('image-strip').classList.add('hidden');
}

// ── PROPOSE HANDLER ────────────────────────────────────────
function handlePropose() {
  const text = document.getElementById('main-input').value.trim();
  if (!text && !uploadedImage) { showError('Say or type what you want to schedule.'); return; }
  if (!gapiToken) { window._tokenClient.requestAccessToken({ prompt: 'consent' }); return; }
  if (isRecording) stopRecording();
  uploadedImage ? scheduleFromImage(text) : scheduleFromText(text);
}

// ── CLAUDE API ─────────────────────────────────────────────
function buildSystemPrompt() {
  const now        = new Date();
  const calContext = calEvents7.map(e => {
    const s = e.start.dateTime || e.start.date;
    const en = e.end?.dateTime || e.end?.date || s;
    return `- "${e.summary || 'Untitled'}" from ${s} to ${en}`;
  }).join('\n') || '(no existing events)';

  return `You are a scheduling assistant. Today is ${now.toISOString()} \
(${now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}).

User's existing calendar events for the next 7 days:
${calContext}

Your job:
1. Parse all tasks the user wants to schedule.
2. Find FREE slots that don't conflict with existing events.
3. Use reasonable durations if not specified (gym=1hr, homework=1-2hr, etc).
4. Schedule at sensible times (gym=morning/evening, study=afternoon/evening, etc).

Respond ONLY with a valid JSON array. No prose, no markdown, no code fences.

Each object must have exactly:
- "title":       string  (short event name)
- "start":       string  (ISO 8601, e.g. "2025-06-02T09:00:00")
- "end":         string  (ISO 8601)
- "description": string  (1 sentence explaining why this slot)`;
}

async function scheduleFromText(text) {
  setLoading(true, 'finding your free time...');
  await fetchEvents7();
  await callClaude([{ role: 'user', content: `I need to schedule the following: ${text}` }]);
}

async function scheduleFromImage(extraText) {
  setLoading(true, 'reading your image...');
  await fetchEvents7();
  const content = [
    { type: 'image', source: { type: 'base64', media_type: uploadedImage.mediaType, data: uploadedImage.base64 } },
    { type: 'text',  text: extraText
        ? `Here is an image with tasks or schedule info. Additional context: ${extraText}. Please schedule these.`
        : 'Here is an image with tasks or schedule info. Extract and schedule everything schedulable.' },
  ];
  await callClaude([{ role: 'user', content }]);
}

async function callClaude(messages) {
  setLoading(true, 'claude is proposing a schedule...');
  try {
    const res = await fetch(CLAUDE_API, {
      method:  'POST',
      headers: {
        'Content-Type':                              'application/json',
        'x-api-key':                                 config.apiKey,
        'anthropic-version':                         '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: buildSystemPrompt(), messages }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API error'); }
    const data    = await res.json();
    const raw     = data.content?.[0]?.text?.trim();
    if (!raw) throw new Error('Empty response from Claude');
    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
    proposedEvents = JSON.parse(cleaned);
    if (!Array.isArray(proposedEvents) || proposedEvents.length === 0)
      throw new Error('No events could be scheduled. Try being more specific.');
    setLoading(false);
    renderProposals();
  } catch (e) {
    setLoading(false);
    showError('Error: ' + e.message);
  }
}

// ── PROPOSALS ──────────────────────────────────────────────
function renderProposals() {
  selectedProposals = new Set(proposedEvents.map((_, i) => i));
  const list = document.getElementById('proposals-list');
  const toLocal = iso => iso ? iso.slice(0,16) : '';

  list.innerHTML = proposedEvents.map((ev, i) => `
    <div class="event-card selected" id="card-${i}">
      <div class="event-check" id="check-${i}" onclick="toggleProposal(${i})"></div>
      <div class="event-info">
        <input class="event-title-input" type="text" value="${ev.title}"
          onchange="updateProposal(${i},'title',this.value)" />
        <div class="event-time-row">
          <span class="event-time-label">from</span>
          <input class="event-datetime-input" type="datetime-local" value="${toLocal(ev.start)}"
            onchange="updateProposal(${i},'start',this.value+':00')" />
          <span class="event-sep">→</span>
          <input class="event-datetime-input" type="datetime-local" value="${toLocal(ev.end)}"
            onchange="updateProposal(${i},'end',this.value+':00')" />
        </div>
        ${ev.description ? `<div class="event-desc">${ev.description}</div>` : ''}
      </div>
    </div>`).join('');

  document.getElementById('proposals-section').classList.add('visible');
  if (currentView === 'week') renderWeekView(proposedEvents);
  if (currentView === 'month') renderMonthView(proposedEvents);
}

function toggleProposal(i) {
  if (selectedProposals.has(i)) selectedProposals.delete(i);
  else selectedProposals.add(i);
  document.getElementById('card-' + i).classList.toggle('selected', selectedProposals.has(i));
}

function updateProposal(i, field, value) {
  proposedEvents[i][field] = value;
  if (currentView === 'week')  renderWeekView(proposedEvents);
  if (currentView === 'month') renderMonthView(proposedEvents);
}

// ── CALENDAR WRITE ─────────────────────────────────────────
async function confirmEvents() {
  const toAdd = proposedEvents.filter((_, i) => selectedProposals.has(i));
  if (toAdd.length === 0) { showToast('Nothing selected', 'error'); return; }
  setLoading(true, `adding ${toAdd.length} event${toAdd.length>1?'s':''}...`);
  document.getElementById('proposals-section').classList.remove('visible');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let added = 0;
  for (const ev of toAdd) {
    try {
      const res = await fetch(`${CAL_API}/calendars/primary/events`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${gapiToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          summary:     ev.title,
          description: ev.description || '',
          start:       { dateTime: ev.start, timeZone: tz },
          end:         { dateTime: ev.end,   timeZone: tz },
          reminders:   { useDefault: true },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      added++;
    } catch (e) { console.error('Failed to add:', ev.title, e); }
  }
  setLoading(false);
  await fetchEvents7();
  resetUI();
  showToast(`${added} event${added>1?'s':''} added to Google Calendar ✓`, 'success');
}

// ── UI HELPERS ─────────────────────────────────────────────
function resetUI() {
  proposedEvents = [];
  selectedProposals.clear();
  document.getElementById('main-input').value = '';
  document.getElementById('proposals-section').classList.remove('visible');
  clearImage();
  hideError();
  renderCurrentView();
}

function setCalStatus(ok, msg) {
  document.getElementById('cal-dot').className      = 'status-dot' + (ok ? '' : ' red');
  document.getElementById('cal-status').textContent = msg;
}

function setLoading(show, text = '') {
  document.getElementById('loading-state').className = show ? 'visible' : '';
  if (text) document.getElementById('loading-text').textContent = text;
}

function showError(msg) {
  const el = document.getElementById('error-box');
  el.textContent = msg; el.className = 'error-box visible';
}

function hideError() { document.getElementById('error-box').className = 'error-box'; }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast show ${type}`;
  setTimeout(() => (t.className = 'toast'), 3000);
}
