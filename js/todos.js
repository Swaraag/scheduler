// ── TODOS ──────────────────────────────────────────────────

function loadTodos() {
  try {
    const saved = localStorage.getItem('scheduler_todos');
    if (saved) todos = JSON.parse(saved);
  } catch { todos = []; }
}

function saveTodos() {
  localStorage.setItem('scheduler_todos', JSON.stringify(todos));
}

function addTodo(text) {
  const todo = { id: Date.now() + Math.random(), text, done: false, scheduled: false, createdAt: Date.now() };
  todos.push(todo);
  saveTodos();
  renderTodos();
}

function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  saveTodos();
  renderTodos();
}

function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  saveTodos();
  renderTodos();
}

function markTodoScheduled(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) { todo.scheduled = true; saveTodos(); renderTodos(); }
}

function renderTodos() {
  const list    = document.getElementById('todo-list');
  const empty   = document.getElementById('todo-empty');
  const schedBtn = document.getElementById('todo-schedule-btn');
  if (!list) return;

  const pending   = todos.filter(t => !t.done && !t.scheduled);
  const scheduled = todos.filter(t => !t.done && t.scheduled);
  const done      = todos.filter(t => t.done);

  if (schedBtn) schedBtn.style.display = pending.length > 0 ? '' : 'none';
  if (empty)    empty.style.display    = todos.length === 0 ? '' : 'none';

  const renderItem = (t) => {
    const label = t.scheduled
      ? `<span class="todo-scheduled-badge">scheduled</span>`
      : '';
    const dragHandle = (!t.done && !t.scheduled)
      ? `<button class="todo-drag-handle" title="Drag to calendar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
          </svg>
        </button>`
      : '';
    const rightBtns = (!t.done && !t.scheduled)
      ? `<button class="todo-schedule-one-btn" onclick="openScheduleOnePopup(${t.id})" title="Schedule this todo">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </button>`
      : '';
    return `<li class="todo-item ${t.done ? 'done' : ''} ${t.scheduled ? 'scheduled' : ''}" data-id="${t.id}">
      <button class="todo-check" onclick="toggleTodo(${t.id})" title="${t.done ? 'Mark undone' : 'Mark done'}">
        ${t.done ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </button>
      ${dragHandle}
      <span class="todo-text" ondblclick="startEditTodo(${t.id}, this)" onclick="_todoTextTap(${t.id}, this)" title="Double-click to edit">${escapeHtml(t.text)}${label}</span>
      ${rightBtns}
      <button class="todo-delete" onclick="deleteTodo(${t.id})" title="Delete">×</button>
    </li>`;
  };

  let html = pending.map(renderItem).join('');
  if (scheduled.length) {
    html += `<li class="todo-section-label">Scheduled</li>` + scheduled.map(renderItem).join('');
  }
  if (done.length) {
    html += `<li class="todo-section-label">Done</li>` + done.map(renderItem).join('');
  }
  list.innerHTML = html;
  attachTodoDragToCalendar();
  if (typeof _updateTodoBadge !== 'undefined') _updateTodoBadge();
}

function _markMatchingTodoScheduled(title) {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normTitle = normalize(title);
  const match = todos.find(t => !t.done && !t.scheduled && normalize(t.text).includes(normTitle));
  if (match) { match.scheduled = true; saveTodos(); renderTodos(); }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// On touch devices, single tap on todo text opens edit. On desktop, double-click handles it.
let _todoTapTimer = null;
let _todoLastTapId = null;
function _todoTextTap(id, spanEl) {
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!isTouch) return; // desktop: let ondblclick handle it
  clearTimeout(_todoTapTimer);
  if (_todoLastTapId === id) {
    _todoLastTapId = null;
    startEditTodo(id, spanEl);
    return;
  }
  _todoLastTapId = id;
  // Capture the live element reference before the timer fires
  const capturedEl = spanEl;
  _todoTapTimer = setTimeout(() => {
    _todoLastTapId = null;
    // Re-find the span in case it's still in DOM
    const li = document.querySelector(`.todo-item[data-id="${id}"]`);
    const span = li?.querySelector('.todo-text');
    if (span && !li.classList.contains('editing')) startEditTodo(id, span);
  }, 300);
}

function startEditTodo(id, spanEl) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  const li = spanEl.closest('.todo-item');
  li.classList.add('editing');
  // Replace span with inline editor
  spanEl.outerHTML = `
    <span class="todo-edit-wrap">
      <input class="todo-edit-input" id="todo-edit-${id}" value="${escapeHtml(todo.text)}" />
      <span class="todo-edit-actions">
        <button class="todo-edit-save"  onclick="saveEditTodo(${id})">Save</button>
        <button class="todo-edit-cancel" onclick="cancelEditTodo(${id})">Cancel</button>
      </span>
    </span>`;
  const input = li.querySelector(`#todo-edit-${id}`);
  if (input) { input.focus(); input.select(); }
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); saveEditTodo(id); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEditTodo(id); }
  });
}

function saveEditTodo(id) {
  const input = document.getElementById(`todo-edit-${id}`);
  if (!input) return;
  const newText = input.value.trim();
  if (!newText) return; // don't save empty
  const todo = todos.find(t => t.id === id);
  if (todo) { todo.text = newText; saveTodos(); }
  renderTodos();
}

function cancelEditTodo(id) {
  renderTodos();
}

function addTodoFromInput() {
  if (!gapiToken) { startGoogleSignIn(); return; }
  const input = document.getElementById('todo-manual-input');
  const text  = input?.value.trim();
  if (!text) return;
  addTodo(text);
  input.value = '';
}

// ── SCHEDULE ALL POPUP ──────────────────────────────────────
let _scheduleAllRecognition = null;
let _scheduleAllRecording   = false;
let _scheduleAllImage       = null;
let _scheduleOneTodoId      = null; // null = schedule-all mode, id = single todo mode

function openScheduleAllPopup() {
  if (!gapiToken) { startGoogleSignIn(); return; }
  const pending = todos.filter(t => !t.done && !t.scheduled);
  if (!pending.length) { showToast('No pending todos to schedule', 'error'); return; }
  _scheduleOneTodoId = null;
  document.getElementById('schedule-modal-title').textContent = 'Schedule all todos';
  document.getElementById('schedule-modal-desc').textContent = 'Optionally add context for when and how to schedule, then let Claude propose times.';
  document.getElementById('schedule-all-modal').classList.remove('hidden');
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('schedule-all-input').value = '';
  scheduleAllClearImage();
}

function openScheduleOnePopup(todoId) {
  if (!gapiToken) { startGoogleSignIn(); return; }
  const todo = todos.find(t => t.id === todoId);
  if (!todo) return;
  _scheduleOneTodoId = todoId;
  document.getElementById('schedule-modal-title').textContent = 'Schedule todo';
  document.getElementById('schedule-modal-desc').textContent = `Scheduling: "${todo.text}"`;
  document.getElementById('schedule-all-modal').classList.remove('hidden');
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('schedule-all-input').value = '';
  scheduleAllClearImage();
}

function closeScheduleAllPopup() {
  document.getElementById('schedule-all-modal').classList.add('hidden');
  document.getElementById('modal-backdrop').classList.add('hidden');
  if (_scheduleAllRecording) scheduleAllStopRecording();
}

function scheduleAllToggleRecording() {
  _scheduleAllRecording ? scheduleAllStopRecording() : scheduleAllStartRecording();
}

function scheduleAllStartRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError('Voice not supported. Try Chrome.'); return; }
  _scheduleAllRecognition = new SR();
  _scheduleAllRecognition.continuous = true; _scheduleAllRecognition.interimResults = true; _scheduleAllRecognition.lang = 'en-US';
  const input = document.getElementById('schedule-all-input');
  const existing = input.value.trim();
  let finalPart = '';
  _scheduleAllRecognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalPart += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    input.value = (existing ? existing + ' ' : '') + finalPart + interim;
  };
  _scheduleAllRecognition.onerror = () => scheduleAllStopRecording();
  _scheduleAllRecognition.onend   = () => { if (_scheduleAllRecording) _scheduleAllRecognition.start(); };
  _scheduleAllRecognition.start();
  _scheduleAllRecording = true;
  document.getElementById('schedule-all-mic-btn').classList.add('recording');
  document.getElementById('schedule-all-mic-label').textContent = 'tap to stop';
}

function scheduleAllStopRecording() {
  if (_scheduleAllRecognition) { _scheduleAllRecognition.onend = null; _scheduleAllRecognition.stop(); }
  _scheduleAllRecording = false;
  document.getElementById('schedule-all-mic-btn').classList.remove('recording');
  document.getElementById('schedule-all-mic-label').textContent = 'tap to speak';
}

function scheduleAllHandleImage(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    _scheduleAllImage = { base64: dataUrl.split(',')[1], mediaType: file.type };
    document.getElementById('schedule-all-image-thumb').src = dataUrl;
    document.getElementById('schedule-all-image-strip').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function scheduleAllClearImage() {
  _scheduleAllImage = null;
  const inp = document.getElementById('schedule-all-image-input');
  if (inp) inp.value = '';
  const thumb = document.getElementById('schedule-all-image-thumb');
  if (thumb) thumb.src = '';
  document.getElementById('schedule-all-image-strip')?.classList.add('hidden');
}

async function scheduleAllPropose() {
  const context = document.getElementById('schedule-all-input').value.trim();
  const imageData = _scheduleAllImage;
  const todoId = _scheduleOneTodoId;
  closeScheduleAllPopup();
  if (todoId !== null) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    await _runScheduleAll(context, imageData, [todo]);
  } else {
    await _runScheduleAll(context, imageData, null);
  }
}

async function _runScheduleAll(context, imageData, targetTodos) {
  const pending = targetTodos || todos.filter(t => !t.done && !t.scheduled);
  if (!pending.length) { showToast('No pending todos to schedule', 'error'); return; }
  const todoList = pending.map(t => `- ${t.text}`).join('\n');
  const contextNote = context ? `\nContext from user: ${context}` : '';
  const loadingText = pending.length === 1 ? 'scheduling todo...' : 'scheduling your todos...';
  setLoading(true, loadingText);
  await fetchEvents7();
  if (imageData) {
    const content = [
      { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 } },
      { type: 'text', text: `Schedule these todos for this week:${contextNote}\n${todoList}` },
    ];
    await callClaude([{ role: 'user', content }]);
  } else {
    await callClaude([{ role: 'user', content: `Schedule these todos for this week:${contextNote}\n${todoList}` }]);
  }
}

// ── SCHEDULE TODOS VIA CLAUDE (legacy direct call) ──────────
async function scheduleTodos() {
  openScheduleAllPopup();
}

// ── DRAG TODO → CALENDAR ────────────────────────────────────
function attachTodoDragToCalendar() {
  // Wire on the stable sidebar container so re-renders don't lose the listener
  const sidebar = document.getElementById('todo-sidebar');
  if (!sidebar || sidebar._todoDragWired) return;
  sidebar._todoDragWired = true;

  // Shared drag logic used by both mouse and touch handlers
  function startTodoDrag(item, todo, startClientX, startClientY, onAttach) {
    const originRect = item.getBoundingClientRect();
    let ghost        = null;
    let snapIndicator = null;
    let dragging     = false;
    let lastCol      = null;

    const activate = (clientX, clientY) => {
      if (currentView !== 'day' && currentView !== 'week') return false;
      dragging = true;
      if (typeof _todoDragging !== 'undefined') _todoDragging = true;
      ghost = document.createElement('div');
      ghost.className = 'todo-drag-ghost';
      ghost.textContent = todo.text.length > 30 ? todo.text.slice(0, 28) + '…' : todo.text;
      document.body.appendChild(ghost);
      ghost.style.left = `${clientX + 6}px`;
      ghost.style.top  = `${clientY - 5}px`;
      item.classList.add('todo-dragging');
      return true;
    };

    const move = (clientX, clientY) => {
      if (!dragging) {
        const dx = clientX - startClientX;
        const dy = clientY - startClientY;
        if (Math.hypot(dx, dy) < 6) return;
        if (!activate(clientX, clientY)) return;
      }

      ghost.style.left = `${clientX + 6}px`;
      ghost.style.top  = `${clientY - 5}px`;

      ghost.style.pointerEvents = 'none';
      const target = document.elementFromPoint(clientX, clientY);
      ghost.style.pointerEvents = '';

      const col = target?.closest('.tg-day-col');
      if (col) {
        ghost.classList.add('over-calendar');
        if (col !== lastCol) {
          lastCol?.querySelector('.todo-drop-indicator')?.remove();
          lastCol = col;
        }
        let ind = col.querySelector('.todo-drop-indicator');
        if (!ind) {
          ind = document.createElement('div');
          ind.className = 'todo-drop-indicator';
          col.appendChild(ind);
        }
        const colRect   = col.getBoundingClientRect();
        const body      = col.closest('.tg-body');
        const scrollTop = body ? body.scrollTop : 0;
        const relY      = clientY - colRect.top + scrollTop;
        const snapped   = Math.round((relY / HOUR_PX) * 4) / 4;
        const clamped   = Math.max(0, Math.min(snapped, WEEK_END_HOUR - WEEK_START_HOUR - 1));
        const snapTopPx = clamped * HOUR_PX;
        ind.style.top   = `${snapTopPx}px`;
        ind._snapHours  = clamped;
        snapIndicator   = ind;
        const snapViewportY = colRect.top - scrollTop + snapTopPx;
        ghost.style.left = `${clientX + 6}px`;
        ghost.style.top  = `${snapViewportY - 5}px`;
      } else {
        ghost.classList.remove('over-calendar');
        lastCol?.querySelector('.todo-drop-indicator')?.remove();
        lastCol = null;
        snapIndicator = null;
      }
    };

    const drop = (clientX, clientY) => {
      item.classList.remove('todo-dragging');
      if (typeof _todoDragging !== 'undefined') _todoDragging = false;

      if (!dragging) return;

      const col       = lastCol;
      const snapHours = snapIndicator?._snapHours ?? null;
      lastCol?.querySelector('.todo-drop-indicator')?.remove();

      if (!col || snapHours == null) {
        if (ghost) {
          ghost.style.transition = 'left 0.25s, top 0.25s, opacity 0.25s';
          ghost.style.left       = `${originRect.left + originRect.width / 2}px`;
          ghost.style.top        = `${originRect.top  + originRect.height / 2}px`;
          ghost.style.opacity    = '0';
          setTimeout(() => ghost?.remove(), 280);
        }
        return;
      }

      ghost.remove();

      const gridBody = col.closest('.tg-body');
      const allCols  = gridBody ? Array.from(gridBody.querySelectorAll('.tg-day-col')) : [];
      const colIndex = allCols.indexOf(col);

      let dropDate;
      if (currentView === 'day') {
        dropDate = new Date(currentDayDate);
      } else {
        const today  = new Date(); today.setHours(0,0,0,0);
        const anchor = new Date(today); anchor.setDate(today.getDate() + currentWeekOffset * 7);
        dropDate = new Date(anchor); dropDate.setDate(anchor.getDate() + colIndex);
      }
      const startH    = WEEK_START_HOUR + snapHours;
      const startDate = new Date(dropDate);
      startDate.setHours(Math.floor(startH), Math.round((startH % 1) * 60), 0, 0);
      const endDate   = new Date(startDate.getTime() + 60 * 60 * 1000);

      const pad = n => String(n).padStart(2, '0');
      const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

      const ev = {
        title: todo.text, start: fmt(startDate), end: fmt(endDate),
        description: '', location: null, notes: null,
        reminderMins: null, color: null, recurrence: null, _state: 'pending',
      };
      proposedEvents.push(ev);
      saveProposedEvents();
      renderProposals();
      _refreshCalWithProposals();
      showToast(`"${todo.text}" added as proposal`, 'success');
    };

    onAttach(move, drop);
  }

  // ── MOUSE handler ──────────────────────────────────────────
  sidebar.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.todo-drag-handle')) return;
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const todoId = parseFloat(item.dataset.id);
    const todo   = todos.find(t => t.id === todoId);
    if (!todo) return;
    e.preventDefault();

    startTodoDrag(item, todo, e.clientX, e.clientY, (move, drop) => {
      const onMove = (me) => move(me.clientX, me.clientY);
      const onUp   = (me) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        drop(me.clientX, me.clientY);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  });

  // ── TOUCH handler (hold-to-activate on mobile) ─────────────
  sidebar.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.todo-drag-handle')) return;
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const todoId = parseFloat(item.dataset.id);
    const todo   = todos.find(t => t.id === todoId);
    if (!todo) return;

    const touch  = e.touches[0];
    const handle = e.target.closest('.todo-drag-handle');
    let holdTimer = null;
    let touchDragActive = false;

    // Visual feedback: highlight handle while holding
    handle.classList.add('hold-active');

    holdTimer = setTimeout(() => {
      touchDragActive = true;
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(40);
      handle.classList.remove('hold-active');

      startTodoDrag(item, todo, touch.clientX, touch.clientY, (move, drop) => {
        const onMove = (te) => {
          te.preventDefault();
          const t = te.touches[0];
          move(t.clientX, t.clientY);
        };
        const onEnd = (te) => {
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend',  onEnd);
          document.removeEventListener('touchcancel', onEnd);
          const t = te.changedTouches[0];
          drop(t ? t.clientX : touch.clientX, t ? t.clientY : touch.clientY);
        };
        document.addEventListener('touchmove',   onMove,  { passive: false });
        document.addEventListener('touchend',    onEnd);
        document.addEventListener('touchcancel', onEnd);
      });
    }, 400); // 400ms hold to activate drag

    const cancelHold = () => {
      clearTimeout(holdTimer);
      handle.classList.remove('hold-active');
      item.removeEventListener('touchend',    cancelHold);
      item.removeEventListener('touchcancel', cancelHold);
      item.removeEventListener('touchmove',   cancelOnMove);
    };
    const cancelOnMove = (te) => {
      // Cancel hold if finger moved more than 8px before timer fires
      if (!touchDragActive) {
        const t = te.touches[0];
        const dx = t.clientX - touch.clientX;
        const dy = t.clientY - touch.clientY;
        if (Math.hypot(dx, dy) > 8) cancelHold();
      }
    };
    item.addEventListener('touchend',    cancelHold);
    item.addEventListener('touchcancel', cancelHold);
    item.addEventListener('touchmove',   cancelOnMove, { passive: true });
  }, { passive: true });
}

// ── ROUTING: CLAUDE DECIDES CALENDAR VS TODO ────────────────
async function routeAndProcess(text, imageData) {
  setLoading(true, 'thinking...');
  await fetchEvents7();

  const now        = new Date();
  const todoList   = todos.filter(t => !t.done && !t.scheduled).map(t => `- ${t.text}`).join('\n') || '(none)';
  const calContext = calEvents7.map(e => {
    const s  = e.start.dateTime || e.start.date;
    const en = e.end?.dateTime  || e.end?.date || s;
    return `- id:${e.id} "${e.summary || 'Untitled'}" from ${s} to ${en}`;
  }).join('\n') || '(no existing events)';
  const memory = localStorage.getItem('scheduler_memory') || '';

  const routingSystem = `You are a smart assistant that manages both a calendar and a todo list.
Today is ${now.toISOString()} (${now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}).
${memory ? `User preferences:\n${memory}\n` : ''}
User's existing calendar for the next 7 days (each event has an id):
${calContext}

User's current pending todos:
${todoList}

Your job: analyze the user's input and split it into:
1. "calendar" items — concrete events to ADD with a specific or implied time/date ("dentist Friday", "gym tomorrow morning", "meeting at 3pm")
2. "todos" items — fuzzy tasks with no committed time ("buy groceries", "email professor", "finish chapter 4", "pack bag")
3. "delete" items — requests to REMOVE/CANCEL/DELETE existing calendar events. Words like "remove", "delete", "cancel", "take off", "get rid of" targeting an existing event → delete. Match against the existing calendar list above by title similarity (fuzzy match is fine). Return the event id of each matched event.

IMPORTANT: If the user says to remove/cancel/delete something that matches an existing event, it MUST go in "delete", never in "calendar". Do not add deletion requests as new calendar items.
Some inputs may produce multiple types (e.g. "cancel dentist and add gym tomorrow and remind me to pack").
If the user asks to schedule their todos, treat all pending todos as calendar items.
For deletions: only include events you are confident the user wants deleted. If ambiguous, do not include.

Respond ONLY with a valid JSON object with exactly these three fields:
{
  "calendar": ["item 1", "item 2"],    // items to schedule (empty array if none)
  "todos":    ["item 1", "item 2"],    // items to add to todo list (empty array if none)
  "delete":   ["eventId1", "eventId2"] // ids of existing events to delete (empty array if none)
}
No prose, no markdown, no code fences.`;

  try {
    let userContent;
    if (imageData) {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 } },
        { type: 'text', text: text ? `${text}` : 'Extract all tasks and events from this image.' },
      ];
    } else {
      userContent = text;
    }

    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      MODEL_SMART,
        max_tokens: 500,
        system:     routingSystem,
        messages:   [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API error'); }
    const data = await res.json();

    // extractJsonArray returns array — we need the object directly
    let routed;
    try {
      const rawText = data.content?.[0]?.text?.trim() || '';
      console.log('[route] calContext:', calContext);
      console.log('[route] raw response:', rawText);
      const cleaned = rawText.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/g,'').trim();
      routed = JSON.parse(cleaned);
      console.log('[route] parsed:', routed);
    } catch {
      // Fallback: treat everything as a calendar item
      routed = { calendar: [text], todos: [] };
    }

    const calItems    = routed.calendar || [];
    const todoItems   = routed.todos    || [];
    const deleteIds   = routed.delete   || [];

    // Add todos immediately
    if (todoItems.length) {
      todoItems.forEach(t => addTodo(t));
      showToast(`Added ${todoItems.length} todo${todoItems.length > 1 ? 's' : ''}`, 'success');
    }

    // Build deletion proposals from matched event IDs
    if (deleteIds.length) {
      const matched = deleteIds
        .map(id => calEvents7.find(e => e.id === id))
        .filter(Boolean);
      if (matched.length) {
        matched.forEach(e => {
          proposedEvents.push({
            _action:           'delete',
            _existingId:       e.id,
            _recurringEventId: e.recurringEventId || null,
            _deleteScope:      'single', // 'single' | 'series'
            _calId:            e._calId || 'primary',
            title:             e.summary || 'Untitled',
            start:             e.start.dateTime || e.start.date,
            end:               e.end?.dateTime  || e.end?.date || e.start.dateTime || e.start.date,
            description: null, location: null, notes: null,
            reminderMins: null, color: null, recurrence: null,
            _state: 'pending',
          });
        });
        saveProposedEvents();
        renderProposals();
      }
    }

    // Schedule calendar items
    if (calItems.length) {
      const calText = calItems.join('. ');
      await callClaude([{ role: 'user', content: `I need to schedule the following: ${calText}` }]);
    } else {
      setLoading(false);
      if (!todoItems.length && !deleteIds.length) showError('Nothing to add. Try being more specific.');
    }

  } catch (e) {
    setLoading(false);
    showError('Error: ' + e.message);
  }
}
