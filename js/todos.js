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
    return `<li class="todo-item ${t.done ? 'done' : ''} ${t.scheduled ? 'scheduled' : ''}" data-id="${t.id}">
      <button class="todo-check" onclick="toggleTodo(${t.id})" title="${t.done ? 'Mark undone' : 'Mark done'}">
        ${t.done ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </button>
      <span class="todo-text">${escapeHtml(t.text)}${label}</span>
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

function addTodoFromInput() {
  if (!gapiToken) { startGoogleSignIn(); return; }
  const input = document.getElementById('todo-manual-input');
  const text  = input?.value.trim();
  if (!text) return;
  addTodo(text);
  input.value = '';
}

// ── SCHEDULE TODOS VIA CLAUDE ───────────────────────────────
async function scheduleTodos() {
  const pending = todos.filter(t => !t.done && !t.scheduled);
  if (!pending.length) { showToast('No pending todos to schedule', 'error'); return; }
  const todoList = pending.map(t => `- ${t.text}`).join('\n');
  const input    = `Schedule my pending todos for this week:\n${todoList}`;
  // Feed into normal scheduling pipeline
  setLoading(true, 'scheduling your todos...');
  await fetchEvents7();
  await callClaude([{ role: 'user', content: input }], true);
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
    return `- "${e.summary || 'Untitled'}" from ${s} to ${en}`;
  }).join('\n') || '(no existing events)';
  const memory = localStorage.getItem('scheduler_memory') || '';

  const routingSystem = `You are a smart assistant that manages both a calendar and a todo list.
Today is ${now.toISOString()} (${now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}).
${memory ? `User preferences:\n${memory}\n` : ''}
User's existing calendar for the next 7 days:
${calContext}

User's current pending todos:
${todoList}

Your job: analyze the user's input and split it into:
1. "calendar" items — concrete events with a specific or implied time/date ("dentist Friday", "gym tomorrow morning", "meeting at 3pm")
2. "todo" items — fuzzy tasks with no committed time ("buy groceries", "email professor", "finish chapter 4", "pack bag")

Some inputs may produce BOTH (e.g. "schedule gym tomorrow and remind me to pack my bag").
If the user asks to schedule their todos, treat all pending todos as calendar items.

Respond ONLY with a valid JSON object with exactly these two fields:
{
  "calendar": ["item 1", "item 2"],  // items to schedule on the calendar (empty array if none)
  "todos":    ["item 1", "item 2"]   // items to add to the todo list (empty array if none)
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
    const raw  = extractJsonArray(data.content?.[0]?.text?.trim() || '');

    // extractJsonArray returns array — we need the object directly
    let routed;
    try {
      const rawText = data.content?.[0]?.text?.trim() || '';
      const cleaned = rawText.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/g,'').trim();
      routed = JSON.parse(cleaned);
    } catch {
      // Fallback: treat everything as a calendar item
      routed = { calendar: [text], todos: [] };
    }

    const calItems  = routed.calendar || [];
    const todoItems = routed.todos    || [];

    // Add todos immediately
    if (todoItems.length) {
      todoItems.forEach(t => addTodo(t));
      showToast(`Added ${todoItems.length} todo${todoItems.length > 1 ? 's' : ''}`, 'success');
    }

    // Schedule calendar items
    if (calItems.length) {
      const calText = calItems.join('. ');
      await callClaude([{ role: 'user', content: `I need to schedule the following: ${calText}` }]);
    } else {
      setLoading(false);
      if (!todoItems.length) showError('Nothing to add. Try being more specific.');
    }

  } catch (e) {
    setLoading(false);
    showError('Error: ' + e.message);
  }
}
