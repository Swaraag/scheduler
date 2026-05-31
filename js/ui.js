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

  if (window.innerWidth <= 600) currentView = 'day';

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
    const active = document.activeElement;
    if (active?.id === 'main-input')   { e.preventDefault(); handlePropose(); }
    if (active?.id === 'revise-input') { e.preventDefault(); handleRevise(); }
  });

  // Load Anthropic key from env (via API) — no longer need client-side config
  const savedKey = localStorage.getItem('scheduler_anth_key');
  if (savedKey) config.apiKey = savedKey;

  showApp();
};

function showApp() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'flex';
  initGoogleAuth();
  // Fetch Anthropic key from server if we don't have it cached
  if (!config.apiKey) {
    fetch('/api/claude-key', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.key) { config.apiKey = d.key; localStorage.setItem('scheduler_anth_key', d.key); } })
      .catch(() => {});
  }
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

async function resetConfig() {
  // Sign out server-side (clears httpOnly cookie + revokes Google token)
  try { await fetch('/api/signout', { method: 'POST', credentials: 'include' }); } catch {}
  // Clear all client-side state
  ['scheduler_token', 'scheduler_has_session', 'scheduler_config',
   'scheduler_anth_key', 'scheduler_enabled_cals', 'scheduler_memory',
   'scheduler_theme', 'scheduler_auth_return'].forEach(k => localStorage.removeItem(k));
  gapiToken = null;
  document.getElementById('settings-btn')?.classList.add('hidden');
  location.reload();
}

function copyShareLink() {
  if (!gapiToken) { showToast('Connect your calendar first', 'error'); return; }
  const primary = allCalendars.find(c => c.primary) || allCalendars[0];
  if (!primary) { showToast('Calendar not loaded yet', 'error'); return; }
  // Embed token, calendarId, owner name, anthropic key, and expiry in the hash
  // Token expires in ~50 min so the link is short-lived
  const payload = {
    token:   gapiToken,
    calId:   primary.id,
    name:    (primary.summary || '').replace(/@.*/, '') || 'Me',
    anthKey: config.apiKey || null,
    expiry:  Date.now() + 48 * 60 * 1000, // 48 min (slightly under the 50-min token expiry)
  };
  const hash = btoa(JSON.stringify(payload));
  const shareUrl = `${location.origin}${location.pathname.replace('index.html', '')}share.html#${hash}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    showToast('Share link copied — valid for ~48 min', 'success');
  }).catch(() => {
    // Fallback for browsers that block clipboard without HTTPS
    prompt('Copy this link:', shareUrl);
  });
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
  if (!gapiToken) { startGoogleSignIn(); return; }
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

function setCalOverlay(show, text = '', showRetry = false, showSignIn = false, showRedirect = false) {
  const overlay = document.getElementById('cal-loading-overlay');
  if (!overlay) return;
  const textEl = document.getElementById('cal-loading-text');
  const inner  = overlay.querySelector('.cal-loading-inner');
  if (!show) { if (!overlay.dataset.claudeLoading) overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');
  if (text) textEl.textContent = text;
  // Hide spinner when showing a sign-in or retry button — it's not loading, it's waiting for user action
  const spinner = inner.querySelector('.spinner-lg');
  if (spinner) spinner.style.display = (showSignIn || showRedirect || showRetry) ? 'none' : '';
  inner.querySelectorAll('.overlay-action-btn').forEach(b => b.remove());
  if (showRetry) {
    const btn = document.createElement('button');
    btn.className = 'overlay-action-btn retry-btn'; btn.textContent = 'Retry';
    btn.onclick = () => location.reload();
    inner.appendChild(btn);
  }
  if (showSignIn || showRedirect) {
    const btn = document.createElement('button');
    btn.className = 'overlay-action-btn'; btn.textContent = 'Sign in with Google';
    btn.onclick = () => startGoogleSignIn();
    inner.appendChild(btn);
  }
}

function setLoading(show, text = '') {
  const overlay = document.getElementById('cal-loading-overlay');
  if (show) {
    overlay.dataset.claudeLoading = '1';
    overlay.querySelectorAll('.overlay-action-btn').forEach(b => b.remove());
    const spinner = overlay.querySelector('.spinner-lg');
    if (spinner) spinner.style.display = '';
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
