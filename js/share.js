// ── SHARE PAGE ─────────────────────────────────────────────
// Permanent visitor-facing scheduling page. Calls /api/busy and /api/book
// on the Vercel backend — no credentials ever touch the client.

const CLAUDE_API      = 'https://api.anthropic.com/v1/messages';
const HOUR_PX         = 44;
const WEEK_START_HOUR = 7;
const WEEK_END_HOUR   = 22;

// Set this to your Vercel deployment URL once deployed.
// During local dev, Vercel CLI proxies /api/* so leave as ''.
const API_BASE = typeof SHARE_API_BASE !== 'undefined' ? SHARE_API_BASE : '';

let ownerName         = 'Me';
let ownerEvents       = [];
let pendingSlots      = [];
let shareView         = 'week';
let shareWeekOffset   = 0;
let shareDayDate      = new Date();
let shareMonthOffset  = 0;
let shareRecognition  = null;
let shareIsRecording  = false;
let shareUploadedImage = null;

// ── INIT ───────────────────────────────────────────────────
window.onload = async () => {
  try {
    const res  = await fetch(`${API_BASE}/api/busy`);
    if (!res.ok) throw new Error('Could not load calendar');
    const data = await res.json();
    ownerEvents = data.busy || [];
    ownerName   = data.ownerName || 'Me';
    document.getElementById('share-wordmark').innerHTML = `Schedule with <span>${ownerName}</span>`;
    document.getElementById('share-sub').textContent    = `Browse ${ownerName}'s availability and request a time.`;
    showScreen('main-screen');
    renderShareView();
  } catch (e) {
    document.getElementById('share-sub').textContent = 'Could not load availability. Try again later.';
    showScreen('main-screen');
  }
};

function showScreen(id) {
  ['main-screen','success-screen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

// ── VIEW NAVIGATION ────────────────────────────────────────
function shareNav(view) {
  shareView = view; shareWeekOffset = 0; shareMonthOffset = 0;
  ['day','week','month'].forEach(v => {
    document.getElementById(`pill-${v}`).classList.toggle('active', v === view);
    document.getElementById(`cal-${v}-view`).classList.toggle('hidden', v !== view);
  });
  renderShareView();
}

function shareToday() {
  shareDayDate = new Date(); shareWeekOffset = 0; shareMonthOffset = 0;
  shareNav(shareView);
}

function navigateShareDay(delta)   { shareDayDate.setDate(shareDayDate.getDate() + delta); renderShareView(); }
function navigateShareWeek(delta)  { shareWeekOffset  += delta; renderShareView(); }
function navigateShareMonth(delta) { shareMonthOffset += delta; renderShareView(); }

function renderShareView() {
  switch (shareView) {
    case 'day':   renderShareDay();   break;
    case 'week':  renderShareWeek();  break;
    case 'month': renderShareMonth(); break;
  }
}

// ── CALENDAR RENDERING ─────────────────────────────────────
function _busyBlock(ev) {
  const start  = new Date(ev.start);
  const end    = new Date(ev.end);
  const startH = start.getHours() + start.getMinutes() / 60;
  const endH   = end.getHours()   + end.getMinutes()   / 60;
  const top    = Math.max(0, startH - WEEK_START_HOUR) * HOUR_PX;
  const height = Math.max(8, (endH - startH) * HOUR_PX);
  return `<div class="tg-event share-busy" style="top:${top}px;height:${height}px"></div>`;
}

function _pendingBlock(ev) {
  const start  = new Date(ev.start);
  const end    = new Date(ev.end);
  const top    = Math.max(0, start.getHours() + start.getMinutes()/60 - WEEK_START_HOUR) * HOUR_PX;
  const height = Math.max(18, (end.getHours() + end.getMinutes()/60 - start.getHours() - start.getMinutes()/60) * HOUR_PX);
  return `<div class="tg-event proposed proposed-pending" style="top:${top}px;height:${height}px">
    <div class="tg-event-title">${ev.title}</div>
  </div>`;
}

function _buildShareGrid(cols, mode) {
  const totalHours = WEEK_END_HOUR - WEEK_START_HOUR;
  const gridCols   = `44px repeat(${cols.length}, 1fr)`;
  const prevFn = mode === 'day' ? `navigateShareDay(-1)` : `navigateShareWeek(-1)`;
  const nextFn = mode === 'day' ? `navigateShareDay(1)`  : `navigateShareWeek(1)`;
  const navCorner = `<div class="tg-corner tg-nav-corner">
    <button class="tg-nav-btn" onclick="${prevFn}">‹</button>
    <button class="tg-nav-btn" onclick="${nextFn}">›</button>
  </div>`;
  const headerCells = cols.map(c => {
    const clickable = mode !== 'day'
      ? `clickable" onclick="shareNav('day');shareDayDate=new Date(${c.date.getFullYear()},${c.date.getMonth()},${c.date.getDate()});renderShareView();void("`
      : ``;
    return `<div class="tg-day-label ${c.isToday?'today':''} ${clickable}">${c.label}<span class="day-num">${c.date.getDate()}</span></div>`;
  }).join('');
  const timeLabels = Array.from({length: totalHours}, (_, i) => {
    const h = WEEK_START_HOUR + i;
    return `<div class="tg-time-label">${h > 12 ? h-12 : h}${h >= 12 ? 'pm' : 'am'}</div>`;
  }).join('');
  const dayCols = cols.map(c => {
    const dayStr  = `${c.date.getFullYear()}-${String(c.date.getMonth()+1).padStart(2,'0')}-${String(c.date.getDate()).padStart(2,'0')}`;
    const busy    = ownerEvents.filter(e => !e.allDay && e.start.slice(0,10) === dayStr).map(_busyBlock).join('');
    const pending = pendingSlots.filter(e => (e.start||'').slice(0,10) === dayStr).map(_pendingBlock).join('');
    const now = new Date();
    const nowLine = c.isToday ? `<div class="now-line" style="top:${(now.getHours()+now.getMinutes()/60-WEEK_START_HOUR)*HOUR_PX}px"></div>` : '';
    return `<div class="tg-day-col">${busy}${pending}${nowLine}</div>`;
  }).join('');
  return `<div class="time-grid">
    <div class="tg-header" style="grid-template-columns:${gridCols}">${navCorner}${headerCells}</div>
    <div class="tg-body" style="grid-template-columns:${gridCols}"><div class="tg-time-col">${timeLabels}</div>${dayCols}</div>
  </div>`;
}

function renderShareDay() {
  const el     = document.getElementById('cal-day-view');
  const target = new Date(shareDayDate); target.setHours(0,0,0,0);
  const today  = new Date(); today.setHours(0,0,0,0);
  const DAY_NAMES  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  el.innerHTML = _buildShareGrid([{
    date: target, isToday: target.toDateString() === today.toDateString(),
    label: `${DAY_NAMES[target.getDay()]}, ${MONTH_ABBR[target.getMonth()]} ${target.getDate()}`,
  }], 'day');
  const body = el.querySelector('.tg-body');
  if (body) body.scrollTop = Math.max(0, (new Date().getHours() - WEEK_START_HOUR - 1)) * HOUR_PX;
}

function renderShareWeek() {
  const el     = document.getElementById('cal-week-view');
  const today  = new Date(); today.setHours(0,0,0,0);
  const anchor = new Date(today); anchor.setDate(today.getDate() + shareWeekOffset * 7);
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const cols = Array.from({length: 7}, (_, i) => {
    const d = new Date(anchor); d.setDate(anchor.getDate() + i);
    return { date: d, label: DAY_ABBR[d.getDay()], isToday: d.toDateString() === today.toDateString() };
  });
  el.innerHTML = _buildShareGrid(cols, 'week');
  const body = el.querySelector('.tg-body');
  if (body) body.scrollTop = Math.max(0, (new Date().getHours() - WEEK_START_HOUR - 1)) * HOUR_PX;
}

function renderShareMonth() {
  const el    = document.getElementById('cal-month-view');
  const today = new Date();
  const base  = new Date(today.getFullYear(), today.getMonth() + shareMonthOffset, 1);
  const year  = base.getFullYear(), month = base.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const navHtml = `<div class="month-nav-header">
    <button class="tg-nav-btn" onclick="navigateShareMonth(-1)">‹</button>
    <span class="month-nav-title">${MONTH_NAMES[month]} ${year}</span>
    <button class="tg-nav-btn" onclick="navigateShareMonth(1)">›</button>
  </div>`;
  let cells = Array(firstDay.getDay()).fill({empty: true});
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const count   = ownerEvents.filter(e => !e.allDay && e.start.slice(0,10) === dateStr).length;
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    cells.push({ d, dateStr, isToday, count });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  cells = cells.concat(Array(trailing).fill({empty: true}));
  const cellsHtml = cells.map(c => {
    if (c.empty) return `<div class="month-cell other-month"></div>`;
    const dots = c.count > 0
      ? `<div class="share-busy-dots">${Array(Math.min(c.count, 4)).fill('<span class="share-busy-dot"></span>').join('')}</div>`
      : '';
    return `<div class="month-cell ${c.isToday?'today':''}" onclick="shareNav('day');shareDayDate=new Date(${year},${month},${c.d});renderShareView()">
      <div class="month-cell-num">${c.d}</div>${dots}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="month-grid">${navHtml}
    <div class="month-header-row">${DAY_NAMES.map(d => `<div class="month-day-name">${d}</div>`).join('')}</div>
    <div class="month-body">${cellsHtml}</div>
  </div>`;
}

// ── VOICE ──────────────────────────────────────────────────
function shareToggleRecording() {
  shareIsRecording ? shareStopRecording() : shareStartRecording();
}

function shareStartRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showShareError('Voice not supported. Try Chrome.'); return; }
  shareRecognition = new SR();
  shareRecognition.continuous = true; shareRecognition.interimResults = true; shareRecognition.lang = 'en-US';
  const input = document.getElementById('share-input');
  const existing = input.value.trim();
  let finalPart = '';
  shareRecognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalPart += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    input.value = (existing ? existing + ' ' : '') + finalPart + interim;
  };
  shareRecognition.onerror = (e) => { shareStopRecording(); if (e.error !== 'no-speech') showShareError('Voice error: ' + e.error); };
  shareRecognition.onend   = () => { if (shareIsRecording) shareRecognition.start(); };
  shareRecognition.start();
  shareIsRecording = true;
  document.getElementById('share-mic-btn').classList.add('recording');
  document.getElementById('share-mic-label').textContent = 'tap to stop';
}

function shareStopRecording() {
  if (shareRecognition) { shareRecognition.onend = null; shareRecognition.stop(); }
  shareIsRecording = false;
  document.getElementById('share-mic-btn').classList.remove('recording');
  document.getElementById('share-mic-label').textContent = 'tap to speak';
}

// ── IMAGE ──────────────────────────────────────────────────
function shareHandleImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    shareUploadedImage = { base64: dataUrl.split(',')[1], mediaType: file.type };
    document.getElementById('share-image-thumb').src = dataUrl;
    document.getElementById('share-image-strip').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function shareClearImage() {
  shareUploadedImage = null;
  document.getElementById('share-image-input').value = '';
  document.getElementById('share-image-thumb').src = '';
  document.getElementById('share-image-strip').classList.add('hidden');
}

// ── MANUAL FORM ────────────────────────────────────────────
function shareShowManual() {
  document.getElementById('share-manual-area').classList.remove('hidden');
}
function shareHideManual() {
  document.getElementById('share-manual-area').classList.add('hidden');
}

// ── CLAUDE PROPOSE ─────────────────────────────────────────
async function handleSharePropose() {
  const text = document.getElementById('share-input').value.trim();
  if (!text && !shareUploadedImage) { showShareError("Describe or speak what you'd like to schedule."); return; }
  if (shareIsRecording) shareStopRecording();
  showShareError('');
  const btn = document.querySelector('.propose-btn');
  const origText = btn.innerHTML;
  btn.textContent = 'Finding a time...';

  const now = new Date();
  const calContext = ownerEvents.slice(0, 80).map(e => `- busy from ${e.start} to ${e.end}`).join('\n') || '(no events)';
  const system = `You are a scheduling assistant. Today is ${now.toISOString()}.
The calendar owner's busy times:
${calContext}

Find ONE free slot for the visitor's request that doesn't conflict.
Respond ONLY with a JSON array with one object: { "title", "start" (ISO 8601), "end" (ISO 8601), "description" }`;

  try {
    const keyRes = await fetch(`${API_BASE}/api/claude-key`);
    if (!keyRes.ok) throw new Error('Claude not available');
    const { key } = await keyRes.json();

    let userContent;
    if (shareUploadedImage) {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: shareUploadedImage.mediaType, data: shareUploadedImage.base64 } },
        { type: 'text', text: text ? `Schedule info from image. Additional context: ${text}` : 'Extract scheduling info from this image and find a free slot.' },
      ];
    } else {
      userContent = text;
    }

    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system, messages: [{ role: 'user', content: userContent }] }),
    });
    const data = await res.json();
    const raw  = data.content?.[0]?.text?.trim();
    if (!raw) throw new Error('No response');
    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
    pendingSlots = JSON.parse(cleaned);
    if (!Array.isArray(pendingSlots) || !pendingSlots.length) throw new Error('No slots');
    renderShareProposals();
  } catch {
    showShareError('Could not find a time. Try being more specific or use + Manual.');
  } finally {
    btn.innerHTML = origText;
  }
}

// ── MANUAL PROPOSE ─────────────────────────────────────────
function handleManualSharePropose() {
  const title = document.getElementById('manual-title').value.trim();
  const date  = document.getElementById('manual-date').value;
  const start = document.getElementById('manual-start').value;
  const end   = document.getElementById('manual-end').value;
  const desc  = document.getElementById('manual-desc').value.trim();
  if (!title || !date || !start || !end) { showShareError('Fill in title, date, and times.'); return; }
  showShareError('');
  pendingSlots = [{
    title,
    start: `${date}T${start}:00`,
    end:   `${date}T${end}:00`,
    description: desc || '',
  }];
  shareHideManual();
  renderShareProposals();
}

// ── RENDER PROPOSALS ───────────────────────────────────────
function renderShareProposals() {
  renderShareView();
  const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  const fmtTime = iso => iso.includes('T') ? new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '';
  document.getElementById('share-proposals-list').innerHTML = pendingSlots.map(ev => `
    <div class="event-card pending">
      <div class="event-info">
        <div style="font-family:'Syne',sans-serif;font-weight:600;font-size:14px;margin-bottom:6px">${ev.title}</div>
        <div style="font-size:12px;color:var(--accent)">${fmtDate(ev.start)}  ·  ${fmtTime(ev.start)} – ${fmtTime(ev.end)}</div>
        ${ev.description ? `<div class="event-desc">${ev.description}</div>` : ''}
      </div>
    </div>`).join('');
  document.getElementById('share-proposals-section').style.display = '';
}

// ── CONFIRM / BOOK ─────────────────────────────────────────
async function confirmShareEvent() {
  const ev    = pendingSlots[0];
  const name  = document.getElementById('attendee-name').value.trim();
  const email = document.getElementById('attendee-email').value.trim();

  if (!name)  { showShareError('Please enter your name.'); return; }
  if (!email) { showShareError('Please enter your email so the owner can send you a calendar invite.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showShareError('Please enter a valid email address.'); return; }
  showShareError('');

  try {
    const res = await fetch(`${API_BASE}/api/book`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:         ev.title,
        start:         ev.start,
        end:           ev.end,
        description:   ev.description,
        attendeeName:  name,
        attendeeEmail: email,
      }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Booking failed'); }
    document.getElementById('success-detail').textContent =
      `"${ev.title}" has been requested. The owner will receive a notification to confirm.`;
    showScreen('success-screen');
  } catch (e) {
    showShareError('Failed to book: ' + e.message);
  }
}

function resetShareUI() {
  pendingSlots = [];
  shareUploadedImage = null;
  if (shareIsRecording) shareStopRecording();
  document.getElementById('share-proposals-section').style.display = 'none';
  document.getElementById('share-input').value = '';
  document.getElementById('share-image-strip').classList.add('hidden');
  document.getElementById('share-image-input').value = '';
  shareHideManual();
  showShareError('');
  showScreen('main-screen');
  renderShareView();
}

function showShareError(msg) {
  const el = document.getElementById('share-error');
  el.textContent = msg;
  el.className = msg ? 'error-box visible' : 'error-box';
}
