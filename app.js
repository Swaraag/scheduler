// =============================================================
// app.js — Scheduler
// Sections: Config · Google Auth · Calendar · Cal Views ·
//           Voice · Text · Image · Claude API ·
//           Proposals · Calendar Write · UI Helpers
// =============================================================

// ── CONSTANTS ──────────────────────────────────────────────
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

const CAL_API    = 'https://www.googleapis.com/calendar/v3';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL      = 'claude-haiku-4-5-20251001';

// Hours shown in the week view (7am – 9pm)
const WEEK_START_HOUR = 7;
const WEEK_END_HOUR   = 21;
const HOUR_HEIGHT_PX  = 40;

// ── STATE ──────────────────────────────────────────────────
let config            = {};
let gapiToken         = null;
let recognition       = null;
let isRecording       = false;
let transcript        = '';
let uploadedImage     = null;   // { base64, mediaType, filename }
let calendarEvents    = [];
let proposedEvents    = [];     // mutated in-place by inline edits
let selectedProposals = new Set();
let currentCalView    = 'list'; // 'list' | 'week'

// ── INIT ───────────────────────────────────────────────────
window.onload = () => {
  const saved = localStorage.getItem('scheduler_config');
  if (saved) {
    config = JSON.parse(saved);
    showApp();
  }
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

function resetConfig() {
  localStorage.removeItem('scheduler_config');
  location.reload();
}

function showApp() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'flex';
  initGoogleAuth();
}

// ── GOOGLE AUTH ────────────────────────────────────────────
function initGoogleAuth() {
  const script  = document.createElement('script');
  script.src    = 'https://accounts.google.com/gsi/client';
  script.onload = startAuth;
  document.head.appendChild(script);
}

function startAuth() {
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope:     GOOGLE_SCOPES,
    callback:  (resp) => {
      if (resp.error) { setCalStatus(false, 'auth failed'); return; }
      gapiToken = resp.access_token;
      setCalStatus(true, 'calendar connected');
      loadCalendarEvents();
    },
  });
  window._tokenClient = tokenClient;
  tokenClient.requestAccessToken({ prompt: '' });
}

// ── CALENDAR FETCH ─────────────────────────────────────────
async function loadCalendarEvents() {
  if (!gapiToken) return;
  try {
    const now = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const url = `${CAL_API}/calendars/primary/events?timeMin=${now}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=40`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gapiToken}` } });
    if (!res.ok) throw new Error('calendar fetch failed');
    const data     = await res.json();
    calendarEvents = (data.items || []).filter(e => e.start);
    renderCurrentCalView();
  } catch (e) {
    setCalStatus(false, 'calendar error');
    console.error(e);
  }
}

// ── CALENDAR VIEW SWITCH ───────────────────────────────────
function switchCalView(view) {
  currentCalView = view;
  document.getElementById('toggle-list').classList.toggle('active', view === 'list');
  document.getElementById('toggle-week').classList.toggle('active', view === 'week');
  document.getElementById('cal-list-view').classList.toggle('hidden', view !== 'list');
  document.getElementById('cal-week-view').classList.toggle('hidden', view !== 'week');
  renderCurrentCalView();
}

function renderCurrentCalView() {
  if (currentCalView === 'list') renderListView();
  else renderWeekView();
}

// ── LIST VIEW ──────────────────────────────────────────────
function renderListView() {
  const preview = document.getElementById('cal-list-view');
  if (calendarEvents.length === 0) {
    preview.innerHTML = `
      <div class="cal-header">upcoming events</div>
      <div class="cal-empty">no upcoming events found</div>`;
    return;
  }
  const rows = calendarEvents.slice(0, 8).map(e => {
    const start = e.start.dateTime || e.start.date;
    const d     = new Date(start);
    const label = e.start.dateTime
      ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `<div class="cal-event">
      <span class="cal-event-name">${e.summary || 'Untitled'}</span>
      <span class="cal-event-time">${label}</span>
    </div>`;
  }).join('');
  const overflow = calendarEvents.length > 8
    ? `<div class="cal-empty">+${calendarEvents.length - 8} more</div>` : '';
  preview.innerHTML = `
    <div class="cal-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8"  y1="2" x2="8"  y2="6"/>
        <line x1="3"  y1="10" x2="21" y2="10"/>
      </svg>
      next 7 days (${calendarEvents.length} events)
    </div>${rows}${overflow}`;
}

// ── WEEK VIEW ──────────────────────────────────────────────
function renderWeekView(extra = []) {
  const grid  = document.getElementById('week-grid');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build array of 7 days starting from today
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const totalHours = WEEK_END_HOUR - WEEK_START_HOUR;

  // Header row
  const headerCells = days.map((d, i) => {
    const isToday = i === 0;
    return `<div class="week-day-label ${isToday ? 'today' : ''}">
      ${DAY_NAMES[d.getDay()]}
      <span class="day-num">${d.getDate()}</span>
    </div>`;
  }).join('');

  // Time labels column
  const timeLabels = Array.from({ length: totalHours }, (_, i) => {
    const h    = WEEK_START_HOUR + i;
    const ampm = h >= 12 ? 'pm' : 'am';
    const disp = h > 12 ? h - 12 : h;
    return `<div class="week-time-label">${disp}${ampm}</div>`;
  }).join('');

  // Helper: convert event to positioned block HTML
  function eventBlock(ev, isProposed = false) {
    const start   = new Date(ev.start?.dateTime || ev.start);
    const end     = new Date(ev.end?.dateTime   || ev.end   || ev.start?.dateTime || ev.start);
    const startH  = start.getHours() + start.getMinutes() / 60;
    const endH    = end.getHours()   + end.getMinutes()   / 60;
    const topPct  = Math.max(0, startH - WEEK_START_HOUR) * HOUR_HEIGHT_PX;
    const height  = Math.max(18, (endH - startH) * HOUR_HEIGHT_PX);
    const title   = ev.summary || ev.title || 'Event';
    return `<div class="week-event ${isProposed ? 'proposed' : ''}" style="top:${topPct}px;height:${height}px;" title="${title}">
      <div class="week-event-title">${title}</div>
    </div>`;
  }

  // Day columns
  const dayCols = days.map(d => {
    const dayStr  = d.toISOString().slice(0, 10);
    const blocks  = calendarEvents
      .filter(e => {
        const s = (e.start.dateTime || e.start.date || '').slice(0, 10);
        return s === dayStr;
      })
      .map(e => eventBlock(e, false))
      .join('');
    const proposed = extra
      .filter(e => (e.start || '').slice(0, 10) === dayStr)
      .map(e => eventBlock({ title: e.title, start: e.start, end: e.end }, true))
      .join('');
    // "now" line for today
    const now = new Date();
    const nowLine = d.toDateString() === new Date().toDateString()
      ? `<div class="week-now-line" style="top:${(now.getHours() + now.getMinutes()/60 - WEEK_START_HOUR) * HOUR_HEIGHT_PX}px"></div>`
      : '';
    return `<div class="week-day-col">${blocks}${proposed}${nowLine}</div>`;
  }).join('');

  grid.innerHTML = `
    <div class="week-days-header">
      <div class="week-day-label" style="border-right:1px solid var(--border)"></div>
      ${headerCells}
    </div>
    <div class="week-body">
      <div class="week-time-col">${timeLabels}</div>
      ${dayCols}
    </div>`;

  // Scroll to current hour
  const body    = grid.querySelector('.week-body');
  const nowHour = new Date().getHours();
  if (body) body.scrollTop = Math.max(0, (nowHour - WEEK_START_HOUR - 1)) * HOUR_HEIGHT_PX;
}

// ── INPUT TABS ─────────────────────────────────────────────
function switchTab(mode) {
  ['voice', 'text', 'image'].forEach(m => {
    document.getElementById(`tab-${m}`).classList.toggle('active', m === mode);
    document.getElementById(`panel-${m}`).classList.toggle('hidden', m !== mode);
  });
  resetUI();
}

// ── VOICE INPUT ────────────────────────────────────────────
function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Your browser doesn't support voice input. Try Chrome on desktop or Android.");
    return;
  }
  recognition                = new SpeechRecognition();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';
  let finalTranscript        = '';

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    transcript = finalTranscript + interim;
    showTranscript(transcript);
  };
  recognition.onerror = (e) => {
    stopRecording();
    if (e.error !== 'no-speech') showError('Voice error: ' + e.error);
  };
  recognition.onend = () => { if (isRecording) recognition.start(); };
  recognition.start();
  isRecording = true;
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-label').textContent = 'tap to stop';
  hideError();
}

function stopRecording() {
  if (recognition) { recognition.onend = null; recognition.stop(); }
  isRecording = false;
  document.getElementById('mic-btn').classList.remove('recording');
  document.getElementById('mic-label').textContent = 'tap to speak';
  if (transcript.trim()) document.getElementById('process-btn').classList.add('visible');
}

function processVoice() {
  if (!transcript.trim()) { showError('Nothing was recorded.'); return; }
  scheduleFromText(transcript.trim());
}

// ── TEXT INPUT ─────────────────────────────────────────────
function submitText() {
  const text = document.getElementById('text-input').value.trim();
  if (!text) { showError('Type something first.'); return; }
  scheduleFromText(text);
}

// ── IMAGE INPUT ────────────────────────────────────────────
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader    = new FileReader();
  reader.onload   = (e) => {
    const dataUrl = e.target.result;
    uploadedImage = { base64: dataUrl.split(',')[1], mediaType: file.type, filename: file.name };
    document.getElementById('image-preview').src          = dataUrl;
    document.getElementById('image-filename').textContent = file.name;
    document.getElementById('image-drop-zone').classList.add('hidden');
    document.getElementById('image-preview-wrapper').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  uploadedImage = null;
  document.getElementById('image-file-input').value = '';
  document.getElementById('image-preview').src       = '';
  document.getElementById('image-drop-zone').classList.remove('hidden');
  document.getElementById('image-preview-wrapper').classList.add('hidden');
}

function submitImage() {
  if (!uploadedImage) { showError('Upload an image first.'); return; }
  const context = document.getElementById('image-text-input').value.trim();
  scheduleFromImage(uploadedImage, context);
}

// ── CLAUDE API ─────────────────────────────────────────────
function buildSystemPrompt() {
  const now        = new Date();
  const calContext = calendarEvents.map(e => {
    const start = e.start.dateTime || e.start.date;
    const end   = e.end?.dateTime  || e.end?.date || start;
    return `- "${e.summary || 'Untitled'}" from ${start} to ${end}`;
  }).join('\n') || '(no existing events)';

  return `You are a scheduling assistant. Today is ${now.toISOString()} \
(${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}).

The user's existing Google Calendar events for the next 7 days:
${calContext}

Your job:
1. Parse all tasks/events the user wants to schedule.
2. Find FREE time slots that don't conflict with existing events.
3. Use reasonable durations if not specified (gym = 1hr, homework = 1-2hr, etc).
4. Schedule things at sensible times (gym = morning/evening, study = afternoon/evening, etc).

Respond ONLY with a valid JSON array. No prose, no markdown, no code fences.

Each object must have exactly:
- "title":       string  (short event name)
- "start":       string  (ISO 8601, e.g. "2025-06-02T09:00:00")
- "end":         string  (ISO 8601)
- "description": string  (1 sentence explaining why this slot was chosen)`;
}

async function scheduleFromText(text) {
  if (!gapiToken) { window._tokenClient.requestAccessToken({ prompt: 'consent' }); return; }
  document.getElementById('process-btn').classList.remove('visible');
  setLoading(true, 'finding your free time...');
  await loadCalendarEvents();
  await callClaude([{ role: 'user', content: `I need to schedule the following: ${text}` }]);
}

async function scheduleFromImage(image, context) {
  if (!gapiToken) { window._tokenClient.requestAccessToken({ prompt: 'consent' }); return; }
  setLoading(true, 'reading your image...');
  await loadCalendarEvents();
  const userContent = [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
    { type: 'text',  text: context
        ? `Here is an image with tasks or schedule info. Additional context: ${context}. Please schedule these.`
        : 'Here is an image with tasks or schedule info. Please extract anything schedulable and schedule it.' },
  ];
  await callClaude([{ role: 'user', content: userContent }]);
}

async function callClaude(messages) {
  setLoading(true, 'claude is scheduling...');
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
    document.getElementById('process-btn').classList.add('visible');
  }
}

// ── PROPOSALS (inline-editable) ────────────────────────────
function renderProposals() {
  selectedProposals = new Set(proposedEvents.map((_, i) => i));
  const list        = document.getElementById('proposals-list');

  list.innerHTML = proposedEvents.map((ev, i) => {
    // Convert ISO string to datetime-local value (strip seconds)
    const toLocal = (iso) => iso ? iso.slice(0, 16) : '';

    return `
      <div class="event-card selected" id="card-${i}">
        <div class="event-check" id="check-${i}" onclick="toggleProposal(${i})"></div>
        <div class="event-info">

          <div class="event-title-row">
            <input
              class="event-title-input"
              type="text"
              value="${ev.title}"
              onchange="updateProposal(${i}, 'title', this.value)"
            />
          </div>

          <div class="event-time-row">
            <span class="event-time-label">from</span>
            <input
              class="event-datetime-input"
              type="datetime-local"
              value="${toLocal(ev.start)}"
              onchange="updateProposal(${i}, 'start', this.value + ':00')"
            />
            <span class="event-sep">→</span>
            <input
              class="event-datetime-input"
              type="datetime-local"
              value="${toLocal(ev.end)}"
              onchange="updateProposal(${i}, 'end', this.value + ':00')"
            />
          </div>

          ${ev.description ? `<div class="event-desc">${ev.description}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  document.getElementById('proposals-section').classList.add('visible');

  // If week view is active, overlay proposed events
  if (currentCalView === 'week') renderWeekView(proposedEvents);
}

function toggleProposal(i) {
  if (selectedProposals.has(i)) selectedProposals.delete(i);
  else selectedProposals.add(i);
  document.getElementById('card-' + i).classList.toggle('selected', selectedProposals.has(i));
}

function updateProposal(i, field, value) {
  proposedEvents[i][field] = value;
  // Re-render week view so the block moves live
  if (currentCalView === 'week') renderWeekView(proposedEvents);
}

// ── CALENDAR WRITE ─────────────────────────────────────────
async function confirmEvents() {
  const toAdd = proposedEvents.filter((_, i) => selectedProposals.has(i));
  if (toAdd.length === 0) { showToast('Nothing selected', 'error'); return; }
  setLoading(true, `adding ${toAdd.length} event${toAdd.length > 1 ? 's' : ''}...`);
  document.getElementById('proposals-section').classList.remove('visible');
  const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let   added = 0;
  for (const ev of toAdd) {
    try {
      const body = {
        summary:     ev.title,
        description: ev.description || '',
        start:       { dateTime: ev.start, timeZone: tz },
        end:         { dateTime: ev.end,   timeZone: tz },
        reminders:   { useDefault: true },
      };
      const res = await fetch(`${CAL_API}/calendars/primary/events`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${gapiToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      added++;
    } catch (e) { console.error('Failed to add event:', ev.title, e); }
  }
  setLoading(false);
  await loadCalendarEvents();
  resetUI();
  showToast(`${added} event${added > 1 ? 's' : ''} added to Google Calendar ✓`, 'success');
}

// ── UI HELPERS ─────────────────────────────────────────────
function resetUI() {
  transcript     = '';
  uploadedImage  = null;
  proposedEvents = [];
  selectedProposals.clear();
  document.getElementById('transcript-box').className   = 'transcript-box';
  document.getElementById('transcript-box').textContent = '';
  document.getElementById('process-btn').classList.remove('visible');
  document.getElementById('proposals-section').classList.remove('visible');
  document.getElementById('text-input').value           = '';
  document.getElementById('image-text-input').value     = '';
  clearImage();
  hideError();
  if (currentCalView === 'week') renderWeekView();
}

function showTranscript(text) {
  const box       = document.getElementById('transcript-box');
  box.textContent = text;
  box.className   = 'transcript-box active' + (text ? ' has-text' : '');
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
  const el       = document.getElementById('error-box');
  el.textContent = msg;
  el.className   = 'error-box visible';
}

function hideError() {
  document.getElementById('error-box').className = 'error-box';
}

function showToast(msg, type = '') {
  const t       = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast show ${type}`;
  setTimeout(() => (t.className = 'toast'), 3000);
}
