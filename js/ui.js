// Init, settings, themes, voice/image input, UI helpers

// ── INIT ───────────────────────────────────────────────────
window.onload = () => {
  try {
    const t = localStorage.getItem('scheduler_token');
    if (t) {
      const { expiry } = JSON.parse(t);
      if (Date.now() >= expiry) localStorage.removeItem('scheduler_token');
    }
  } catch { localStorage.removeItem('scheduler_token'); }

  const savedTheme = localStorage.getItem('scheduler_theme');
  if (savedTheme) { try { applyTheme(JSON.parse(savedTheme), false); } catch {} }

  // On narrow screens default to day view
  if (window.innerWidth <= 600) currentView = 'day';

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
    const active = document.activeElement;
    if (active?.id === 'main-input')   { e.preventDefault(); handlePropose(); }
    if (active?.id === 'revise-input') { e.preventDefault(); handleRevise(); }
  });

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
  document.getElementById('cal-week-view').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:40px;justify-content:center;color:var(--muted);font-size:13px;">
      <div class="spinner"></div>connecting to calendar...
    </div>`;
  initGoogleAuth();
}

// ── COLOR THEMES ───────────────────────────────────────────
const THEMES = [
  { name: 'Lime',    accent: '#c8f135', dim: '#8aaa20' },
  { name: 'Cyan',    accent: '#22d3ee', dim: '#0e9ab0' },
  { name: 'Purple',  accent: '#a78bfa', dim: '#7c5fc7' },
  { name: 'Orange',  accent: '#fb923c', dim: '#c0621a' },
  { name: 'Pink',    accent: '#f472b6', dim: '#bb3f88' },
  { name: 'Blue',    accent: '#60a5fa', dim: '#2d76d4' },
  { name: 'Emerald', accent: '#34d399', dim: '#17a068' },
  { name: 'Red',     accent: '#f87171', dim: '#c73e3e' },
];

function applyTheme(theme, save = true) {
  document.documentElement.style.setProperty('--accent', theme.accent);
  document.documentElement.style.setProperty('--accent-dim', theme.dim);
  if (save) localStorage.setItem('scheduler_theme', JSON.stringify({ accent: theme.accent, dim: theme.dim }));
  renderSwatches();
}

function renderSwatches() {
  const container = document.getElementById('color-swatches');
  if (!container) return;
  const saved = localStorage.getItem('scheduler_theme');
  const activeAccent = saved ? JSON.parse(saved).accent : '#c8f135';
  container.innerHTML = THEMES.map(t => `
    <button class="color-swatch ${t.accent === activeAccent ? 'active' : ''}"
      style="background:${t.accent}" title="${t.name}"
      data-accent="${t.accent}" data-dim="${t.dim}"></button>
  `).join('');
  container.onclick = (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    applyTheme({ accent: btn.dataset.accent, dim: btn.dataset.dim });
  };
}

// ── SETTINGS ───────────────────────────────────────────────
function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal.classList.contains('hidden')) { closeSettings(); return; }
  modal.classList.remove('hidden');
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('reset-confirm-area').classList.add('hidden');
  document.getElementById('reset-initial-area').classList.remove('hidden');
  renderSwatches();
  renderCalendarToggles();
  // Populate memory textarea
  const mem = localStorage.getItem('scheduler_memory') || '';
  document.getElementById('memory-input').value = mem;
  updateMemoryCharCount(mem.length);
}

const MEMORY_MAX = 500;

function onMemoryInput() {
  const el  = document.getElementById('memory-input');
  if (el.value.length > MEMORY_MAX) el.value = el.value.slice(0, MEMORY_MAX);
  updateMemoryCharCount(el.value.length);
}

function updateMemoryCharCount(n) {
  const el = document.getElementById('memory-char-count');
  if (el) el.textContent = `${n}/${MEMORY_MAX}`;
}

function saveMemory() {
  const val = document.getElementById('memory-input').value.slice(0, MEMORY_MAX);
  localStorage.setItem('scheduler_memory', val);
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  document.getElementById('modal-backdrop').classList.add('hidden');
}

function showResetConfirm() {
  document.getElementById('reset-initial-area').classList.add('hidden');
  document.getElementById('reset-confirm-area').classList.remove('hidden');
}

function resetConfig() {
  localStorage.removeItem('scheduler_config');
  location.reload();
}

function renderCalendarToggles() {
  const section   = document.getElementById('calendars-section');
  const container = document.getElementById('calendar-toggles');
  if (!allCalendars.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  container.innerHTML = allCalendars.map(c => {
    const checked = enabledCalendars.has(c.id);
    const dot     = c.backgroundColor || 'var(--accent)';
    return `<div class="cal-toggle-row" onclick="toggleCalendar('${c.id}', ${!checked})">
      <span class="cal-toggle-dot" style="background:${dot}"></span>
      <span class="cal-toggle-name">${c.summary || c.id}${c.primary ? ' <span class="cal-primary-badge">primary</span>' : ''}</span>
      <span class="cal-toggle-pill ${checked ? 'on' : ''}"><span class="cal-toggle-thumb"></span></span>
    </div>`;
  }).join('');
}

function toggleCalendar(id, enabled) {
  if (enabled) enabledCalendars.add(id);
  else         enabledCalendars.delete(id);
  if (enabledCalendars.size === 0) enabledCalendars.add(id);
  localStorage.setItem('scheduler_enabled_cals', JSON.stringify([...enabledCalendars]));

  // Animate the pill in-place — no DOM rebuild so the CSS transition fires
  const row  = document.querySelector(`.cal-toggle-row[onclick*="'${id}'"]`);
  const pill = row?.querySelector('.cal-toggle-pill');
  if (pill) {
    const isOn = enabledCalendars.has(id);
    pill.classList.toggle('on', isOn);
    // Update the onclick for the next click
    row.setAttribute('onclick', `toggleCalendar('${id}', ${!isOn})`);
  }

  fetchEvents7();
  fetchEventsYear();
}

// ── VOICE INPUT ────────────────────────────────────────────
function toggleRecording() { isRecording ? stopRecording() : startRecording(); }

function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError('Voice not supported. Try Chrome on desktop or Android.'); return; }
  recognition = new SR();
  recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
  const input = document.getElementById('main-input');
  const existingText = input.value.trim();
  let finalPart = '';
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
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-label').textContent = 'tap to stop';
  hideError();
}

function stopRecording() {
  if (recognition) { recognition.onend = null; recognition.stop(); }
  isRecording = false;
  document.getElementById('mic-btn').classList.remove('recording');
  document.getElementById('mic-label').textContent = 'tap to speak';
}

// ── IMAGE INPUT ────────────────────────────────────────────
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
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
  document.getElementById('image-thumb').src = '';
  document.getElementById('image-strip').classList.add('hidden');
}

// ── PROPOSE HANDLER ────────────────────────────────────────
function handlePropose() {
  const text = document.getElementById('main-input').value.trim();
  if (!text && !uploadedImage) { showError('Say or type what you want to schedule.'); return; }
  if (!gapiToken) { window._tokenClient?.requestAccessToken({ prompt: 'consent' }); return; }
  if (isRecording) stopRecording();
  uploadedImage ? scheduleFromImage(text) : scheduleFromText(text);
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

function setCalOverlay(show, text = '', showRetry = false, showSignIn = false) {
  const overlay = document.getElementById('cal-loading-overlay');
  if (!overlay) return;
  const textEl = document.getElementById('cal-loading-text');
  const inner  = overlay.querySelector('.cal-loading-inner');
  if (!show) { if (!overlay.dataset.claudeLoading) overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');
  if (text) textEl.textContent = text;
  inner.querySelectorAll('.overlay-action-btn').forEach(b => b.remove());
  if (showRetry) {
    const btn = document.createElement('button');
    btn.className = 'overlay-action-btn retry-btn'; btn.textContent = 'Retry';
    btn.onclick = () => location.reload();
    inner.appendChild(btn);
  }
  if (showSignIn) {
    const btn = document.createElement('button');
    btn.className = 'overlay-action-btn retry-btn'; btn.textContent = 'Sign in with Google';
    btn.onclick = () => window._tokenClient?.requestAccessToken({ prompt: 'consent' });
    inner.appendChild(btn);
  }
}

function setLoading(show, text = '') {
  const overlay = document.getElementById('cal-loading-overlay');
  if (show) {
    overlay.dataset.claudeLoading = '1';
    overlay.querySelectorAll('.overlay-action-btn').forEach(b => b.remove());
    setCalOverlay(true, text);
  } else {
    delete overlay.dataset.claudeLoading;
    setCalOverlay(false);
  }
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
