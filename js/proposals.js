// Claude API, proposals UI, event popup edit/delete, calendar write, revise

// ── JSON REPAIR ────────────────────────────────────────────
function extractJsonArray(raw) {
  // Strip markdown fences
  let text = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/g, '').trim();

  // Try straightforward parse first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {}

  // Find the first '[' and match its closing ']', then parse that substring
  const start = text.indexOf('[');
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {}
    }
  }

  // Last resort: find all {...} objects and parse each individually
  const objects = [];
  let depth = 0, objStart = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) objStart = i; depth++; }
    else if (text[i] === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { objects.push(JSON.parse(text.slice(objStart, i + 1))); } catch {}
        objStart = -1;
      }
    }
  }
  return objects;
}

// ── CALENDAR WRITE HELPER ──────────────────────────────────
async function _postWithRetry(url, body, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // 5xx → retry; anything else (including 4xx) → return immediately
      if (res.status < 500) return res;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ── CLAUDE ─────────────────────────────────────────────────
function buildSystemPrompt() {
  const now        = new Date();
  const calContext = calEvents7.map(e => {
    const s  = e.start.dateTime || e.start.date;
    const en = e.end?.dateTime  || e.end?.date || s;
    return `- "${e.summary || 'Untitled'}" from ${s} to ${en}`;
  }).join('\n') || '(no existing events)';

  const memory = localStorage.getItem('scheduler_memory') || '';
  const memorySection = memory
    ? `\nUser preferences and memory:\n${memory}\n`
    : '';

  return `You are a scheduling assistant. Today is ${now.toISOString()} \
(${now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}).
${memorySection}
User's existing calendar events for the next 7 days:
${calContext}

Your job:
1. Parse all tasks the user wants to schedule.
2. Find FREE slots that don't conflict with existing events.
3. Use reasonable durations if not specified (gym=1hr, homework=1-2hr, etc).
4. Schedule at sensible times (gym=morning/evening, study=afternoon/evening, etc).
5. Extract any additional details mentioned: location, reminders, notes, color.
6. Apply any user preferences from memory when choosing times and durations.

Respond ONLY with a valid JSON array. No prose, no markdown, no code fences.

Each object must have exactly these fields (use null for ones not mentioned):
- "title":          string
- "start":          string   (ISO 8601, e.g. "2025-06-02T09:00:00")
- "end":            string   (ISO 8601)
- "description":    string   (1 sentence explaining why this slot was chosen)
- "location":       string|null
- "notes":          string|null
- "reminderMins":   number|null
- "color":          string|null  (one of: "tomato","flamingo","tangerine","banana","sage","basil","peacock","blueberry","lavender","grape","graphite")
- "recurrence":     string|null  (RRULE string for recurring events, or null for one-off events. Examples: daily="RRULE:FREQ=DAILY", weekdays="RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly="RRULE:FREQ=WEEKLY;BYDAY=MO", biweekly="RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", monthly="RRULE:FREQ=MONTHLY;BYDAY=1MO", N times="RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8", until date="RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20251231T000000Z". Only set this when the user explicitly says recurring/every/each/weekly/daily/etc.)`;
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
    { type: 'text', text: extraText
        ? `Here is an image with tasks or schedule info. Additional context: ${extraText}. Please schedule these.`
        : 'Here is an image with tasks or schedule info. Extract and schedule everything schedulable.' },
  ];
  await callClaude([{ role: 'user', content }]);
}

async function callClaude(messages) {
  setLoading(true, 'claude is proposing a schedule...');
  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type':                              'application/json',
        'x-api-key':                                 config.apiKey,
        'anthropic-version':                         '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: buildSystemPrompt(), messages }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API error'); }
    const data = await res.json();
    const raw  = data.content?.[0]?.text?.trim();
    if (!raw) throw new Error('Empty response from Claude');
    const newEvents = extractJsonArray(raw);
    if (!newEvents.length)
      throw new Error('No events could be scheduled. Try being more specific.');
    // Append new proposals to any existing ones (don't clobber unconfirmed proposals)
    proposedEvents = [...proposedEvents, ...newEvents];
    saveProposedEvents();
    setLoading(false);
    renderProposals();
  } catch (e) { setLoading(false); showError('Error: ' + e.message); }
}

function saveProposedEvents() {
  try { localStorage.setItem('scheduler_proposals', JSON.stringify(proposedEvents)); } catch {}
}

function loadProposedEvents() {
  try {
    const saved = localStorage.getItem('scheduler_proposals');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) proposedEvents = parsed;
    }
  } catch {}
}

// ── MANUAL ENTRY ───────────────────────────────────────────
function handleManualEntry() {
  if (!gapiToken) { startGoogleSignIn(); return; }
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  const fmt = (date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
  const end = new Date(d); end.setHours(10);
  const blank = { title: '', start: fmt(d), end: fmt(end), description: '', location: null, notes: null, reminderMins: null, color: null, recurrence: null, _state: 'pending' };
  proposedEvents.push(blank);
  document.getElementById('proposals-section').classList.add('visible');
  renderProposals();
  // Scroll to and focus the new card's title input
  setTimeout(() => {
    const idx = proposedEvents.length - 1;
    const card = document.getElementById(`card-${idx}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.querySelector('.event-title-input')?.focus();
  }, 50);
}

// ── PROPOSALS UI ───────────────────────────────────────────
function renderProposals() {
  proposedEvents.forEach((ev, i) => { ev._idx = i; if (!ev._state) ev._state = 'pending'; });

  const toDate = iso => iso ? iso.slice(0,10) : '';
  const toTime = iso => iso && iso.includes('T') ? iso.slice(11,16) : '';

  const COLOR_OPTIONS = [
    ['','None'],['tomato','🔴 Tomato'],['flamingo','🌸 Flamingo'],['tangerine','🟠 Tangerine'],
    ['banana','🟡 Banana'],['sage','🌿 Sage'],['basil','🌲 Basil'],['peacock','🔵 Peacock'],
    ['blueberry','🫐 Blueberry'],['lavender','💜 Lavender'],['grape','🍇 Grape'],['graphite','⬛ Graphite'],
  ];

  const primaryId = (allCalendars.find(c => c.primary) || allCalendars[0] || {}).id || 'primary';

  document.getElementById('proposals-list').innerHTML = proposedEvents.map((ev, i) => {
    const state = ev._state || 'pending';

    // ── DELETION CARD ─────────────────────────────────────────
    if (ev._action === 'delete') {
      const fmtDT = iso => {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) +
          (iso.includes('T') ? '  ·  ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '');
      };
      const scope = ev._deleteScope || 'single';
      const recurringToggle = ev._recurringEventId ? `
        <div class="delete-scope-row">
          <button class="delete-scope-btn ${scope==='single'?'active':''}" onclick="setDeleteScope(${i},'single')">This event only</button>
          <button class="delete-scope-btn ${scope==='series'?'active':''}" onclick="setDeleteScope(${i},'series')">Entire series</button>
        </div>` : '';
      return `<div class="event-card delete-card ${state}" id="card-${i}">
        <div class="event-card-actions">
          <button class="card-action-btn accept ${state==='accepted'?'active':''}" onclick="acceptProposal(${i})" title="Confirm deletion">✓</button>
          <button class="card-action-btn reject ${state==='rejected'?'active':''}" onclick="rejectProposal(${i})" title="Keep event">✗</button>
        </div>
        <div class="event-info">
          <div class="delete-card-badge">${ev._recurringEventId ? 'Recurring event' : 'Remove from calendar'}</div>
          <div class="event-title-delete">${ev.title}</div>
          <div class="event-desc" style="margin-top:6px">${fmtDT(ev.start)}${ev.end && ev.end !== ev.start ? ' → ' + fmtDT(ev.end) : ''}</div>
          ${recurringToggle}
        </div>
      </div>`;
    }

    // ── ADD CARD (existing) ───────────────────────────────────
    if (!ev._calendarId) ev._calendarId = primaryId;
    const colorOpts = COLOR_OPTIONS.map(([v,l]) => `<option value="${v}" ${ev.color===v?'selected':''}>${l}</option>`).join('');
    const hasExtras = ev.location || ev.notes || ev.reminderMins || ev.color || ev.recurrence;
    const calPickerRow = allCalendars.length > 1 ? `
      <div class="extra-field-row">
        <span class="extra-field-label">Calendar</span>
        <select class="extra-field-select" onchange="updateProposal(${i},'_calendarId',this.value)">
          ${allCalendars.map(c => `<option value="${c.id}" ${ev._calendarId===c.id?'selected':''}>${c.summary||c.id}</option>`).join('')}
        </select>
      </div>` : '';

    return `<div class="event-card ${state}" id="card-${i}">
      <div class="event-card-actions">
        <button class="card-action-btn accept ${state==='accepted'?'active':''}" onclick="acceptProposal(${i})" title="Accept">✓</button>
        <button class="card-action-btn reject ${state==='rejected'?'active':''}" onclick="rejectProposal(${i})" title="Reject">✗</button>
      </div>
      <div class="event-info">
        <input class="event-title-input" type="text" value="${ev.title}" onchange="updateProposal(${i},'title',this.value)" />
        <div class="event-dt-group">
          <span class="event-dt-label">from</span>
          <input class="event-date-input" type="date" value="${toDate(ev.start)}" onchange="updateProposalDT(${i},'start','date',this.value)" />
          <input class="event-time-input" type="time" value="${toTime(ev.start)}" onchange="updateProposalDT(${i},'start','time',this.value)" />
          <span class="event-dt-sep">→</span>
          <input class="event-date-input" type="date" value="${toDate(ev.end)}" onchange="updateProposalDT(${i},'end','date',this.value)" />
          <input class="event-time-input" type="time" value="${toTime(ev.end)}" onchange="updateProposalDT(${i},'end','time',this.value)" />
        </div>
        ${ev.description ? `<div class="event-desc">${ev.description}</div>` : ''}
        <button class="extra-fields-toggle ${hasExtras?'open':''}" id="extras-toggle-${i}" onclick="toggleExtras(${i})">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          ${hasExtras ? 'Details added' : 'Add details'}
        </button>
        <div class="extra-fields ${hasExtras?'open':''}" id="extras-${i}">
          ${calPickerRow}
          <div class="extra-field-row">
            <span class="extra-field-label">Location</span>
            <input class="extra-field-input" type="text" placeholder="e.g. ELH 100 or Gym" value="${ev.location||''}" onchange="updateProposal(${i},'location',this.value)" />
          </div>
          <div class="extra-field-row">
            <span class="extra-field-label">Notes</span>
            <input class="extra-field-input" type="text" placeholder="Any extra context" value="${ev.notes||''}" onchange="updateProposal(${i},'notes',this.value)" />
          </div>
          <div class="extra-field-row">
            <span class="extra-field-label">Reminder</span>
            <div class="reminder-row">
              <input class="extra-field-input" type="number" placeholder="30" min="0" value="${ev.reminderMins!=null?ev.reminderMins:''}" onchange="updateProposal(${i},'reminderMins',this.value?parseInt(this.value):null)" />
              <span style="font-size:12px;color:var(--muted)">minutes before</span>
            </div>
          </div>
          <div class="extra-field-row">
            <span class="extra-field-label">Color</span>
            <select class="extra-field-select" onchange="updateProposal(${i},'color',this.value)">${colorOpts}</select>
          </div>
          <div class="extra-field-row">
            <span class="extra-field-label">Repeat</span>
            <select class="extra-field-select" onchange="updateProposal(${i},'recurrence',this.value||null)">
              <option value="" ${!ev.recurrence?'selected':''}>Does not repeat</option>
              <option value="RRULE:FREQ=DAILY" ${ev.recurrence==='RRULE:FREQ=DAILY'?'selected':''}>Every day</option>
              <option value="RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" ${ev.recurrence==='RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'?'selected':''}>Every weekday (Mon–Fri)</option>
              <option value="RRULE:FREQ=WEEKLY" ${ev.recurrence?.startsWith('RRULE:FREQ=WEEKLY') && !ev.recurrence?.includes('INTERVAL=2') && !ev.recurrence?.includes('BYDAY=MO,TU')?'selected':''}>Every week</option>
              <option value="RRULE:FREQ=WEEKLY;INTERVAL=2" ${ev.recurrence==='RRULE:FREQ=WEEKLY;INTERVAL=2'?'selected':''}>Every 2 weeks</option>
              <option value="RRULE:FREQ=MONTHLY" ${ev.recurrence==='RRULE:FREQ=MONTHLY'?'selected':''}>Every month</option>
              <option value="RRULE:FREQ=YEARLY" ${ev.recurrence==='RRULE:FREQ=YEARLY'?'selected':''}>Every year</option>
            </select>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('proposals-section').classList.add('visible');
  document.getElementById('revise-area').classList.add('hidden');

  // Update confirm button label to reflect mix of adds and deletes
  const confirmBtn = document.querySelector('.btn-confirm');
  if (confirmBtn) {
    const adds    = proposedEvents.filter(e => e._state !== 'rejected' && e._action !== 'delete').length;
    const deletes = proposedEvents.filter(e => e._state !== 'rejected' && e._action === 'delete').length;
    if (adds && deletes)     confirmBtn.textContent = `Confirm All (${adds} add, ${deletes} delete) →`;
    else if (deletes)        confirmBtn.textContent = `Confirm ${deletes} Deletion${deletes>1?'s':''} →`;
    else                     confirmBtn.textContent = 'Confirm All →';
  }

  _refreshCalWithProposals();
}

function toggleExtras(i) {
  const toggle = document.getElementById(`extras-toggle-${i}`);
  const panel  = document.getElementById(`extras-${i}`);
  toggle.classList.toggle('open');
  panel.classList.toggle('open');
  toggle.childNodes[2].textContent = panel.classList.contains('open') ? ' Collapse' : ' Add details';
}

function updateProposalDT(i, field, part, value) {
  const current = proposedEvents[i][field] || '';
  const date = current.slice(0,10);
  const time = current.slice(11,16) || '00:00';
  proposedEvents[i][field] = part === 'date' ? `${value}T${time}:00` : `${date}T${value}:00`;
  saveProposedEvents();
  _refreshCalWithProposals();
}

function acceptProposal(i) {
  proposedEvents[i]._state = proposedEvents[i]._state === 'accepted' ? 'pending' : 'accepted';
  saveProposedEvents();
  renderProposals();
  _refreshCalWithProposals();
}

function rejectProposal(i) {
  proposedEvents[i]._state = proposedEvents[i]._state === 'rejected' ? 'pending' : 'rejected';
  saveProposedEvents();
  renderProposals();
  _refreshCalWithProposals();
}

function updateProposal(i, field, value) {
  proposedEvents[i][field] = value;
  saveProposedEvents();
  _refreshCalWithProposals();
}

function setDeleteScope(i, scope) {
  proposedEvents[i]._deleteScope = scope;
  saveProposedEvents();
  renderProposals();
}

function _refreshCalWithProposals() {
  const visible    = proposedEvents.filter(e => e._state !== 'rejected');
  const deleteIds  = proposedEvents
    .filter(e => e._action === 'delete' && e._state !== 'rejected')
    .map(e => e._existingId);
  if (currentView === 'day')      renderDayView(visible, deleteIds);
  if (currentView === 'threeday') renderThreeDayView(visible, deleteIds);
  if (currentView === 'week')     renderWeekView(visible, deleteIds);
  if (currentView === 'month')    renderMonthView(visible, deleteIds);
}

// ── CALENDAR WRITE ─────────────────────────────────────────
async function confirmEvents() {
  const accepted = proposedEvents.filter(e => e._state !== 'rejected');
  if (accepted.length === 0) { showToast('Nothing to confirm — reject fewer events', 'error'); return; }

  const toAdd    = accepted.filter(e => e._action !== 'delete');
  const toDelete = accepted.filter(e => e._action === 'delete');

  const totalOps = toAdd.length + toDelete.length;
  setLoading(true, `applying ${totalOps} change${totalOps>1?'s':''}...`);
  document.getElementById('proposals-section').classList.remove('visible');

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const COLOR_MAP = { tomato:'11',flamingo:'4',tangerine:'6',banana:'5',sage:'2',basil:'10',peacock:'7',blueberry:'9',lavender:'1',grape:'3',graphite:'8' };

  let added = 0, deleted = 0;
  const deletedIds = new Set();

  // Handle deletions first
  for (const ev of toDelete) {
    try {
      const calId  = ev._calId || 'primary';
      // For series scope, delete the master recurring event; otherwise delete just this instance
      const idToDelete = (ev._deleteScope === 'series' && ev._recurringEventId)
        ? ev._recurringEventId
        : ev._existingId;
      const res = await apiFetch(
        `${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(idToDelete)}`,
        { method: 'DELETE' }
      );
      if (!res.ok && res.status !== 204) throw new Error(await res.text());
      deleted++;
      deletedIds.add(ev._existingId);
      if (ev._recurringEventId) deletedIds.add(ev._recurringEventId);
    } catch (e) { console.error('Failed to delete:', ev.title, e); }
  }

  // Handle additions
  const addedGcalEvents = [];
  for (const ev of toAdd) {
    try {
      const body = {
        summary:     ev.title,
        description: [ev.description, ev.notes].filter(Boolean).join('\n'),
        location:    ev.location || '',
        start:       { dateTime: ev.start, timeZone: tz },
        end:         { dateTime: ev.end,   timeZone: tz },
        reminders:   ev.reminderMins != null
          ? { useDefault: false, overrides: [{ method: 'popup', minutes: ev.reminderMins }] }
          : { useDefault: true },
      };
      if (ev.color && COLOR_MAP[ev.color]) body.colorId = COLOR_MAP[ev.color];
      if (ev.recurrence) body.recurrence = [ev.recurrence];
      const targetCal = ev._calendarId || 'primary';
      const res = await _postWithRetry(
        `${CAL_API}/calendars/${encodeURIComponent(targetCal)}/events`,
        body
      );
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      addedGcalEvents.push({ ...created, _calId: targetCal });
      added++;
      _markMatchingTodoScheduled(ev.title);
    } catch (e) { console.error('Failed to add:', ev.title, e); }
  }

  // Optimistically update calEvents7 so the view reflects changes immediately
  // without racing against GCal's eventual consistency on re-fetch
  if (deletedIds.size) {
    calEvents7 = calEvents7.filter(e => !deletedIds.has(e.id));
    if (calEventsYear) calEventsYear = calEventsYear.filter(e => !deletedIds.has(e.id));
  }
  if (addedGcalEvents.length) {
    const now7end = Date.now() + 7 * 86_400_000;
    const within7 = addedGcalEvents.filter(e => {
      const t = new Date(e.start?.dateTime || e.start?.date).getTime();
      return t >= Date.now() && t <= now7end;
    });
    calEvents7 = [...calEvents7, ...within7].sort((a, b) =>
      (a.start.dateTime || a.start.date).localeCompare(b.start.dateTime || b.start.date));
    if (calEventsYear) calEventsYear = [...calEventsYear, ...addedGcalEvents].sort((a, b) =>
      (a.start.dateTime || a.start.date).localeCompare(b.start.dateTime || b.start.date));
  }

  setLoading(false);
  resetUI();
  localStorage.removeItem('scheduler_proposals');

  const parts = [];
  if (added)   parts.push(`${added} event${added>1?'s':''} added`);
  if (deleted) parts.push(`${deleted} event${deleted>1?'s':''} deleted`);
  showToast(parts.join(', ') + ' ✓', 'success');

  if (toAdd.length) updateMemoryAfterConfirm(toAdd);
}

async function updateMemoryAfterConfirm(addedEvents) {
  try {
    const current = localStorage.getItem('scheduler_memory') || '';
    const summary = addedEvents.map(e => `- "${e.title}" at ${e.start}`).join('\n');
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type':                              'application/json',
        'x-api-key':                                 config.apiKey,
        'anthropic-version':                         '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: `You maintain a short memory string (max 500 chars) of a user's scheduling preferences and habits.
Extract any durable preferences from the events they just scheduled — preferred times, typical durations, patterns.
Do NOT record one-off events as preferences. Only write preferences that would help schedule future events.
Current memory: "${current}"
Rewrite the entire memory string incorporating any new insights. If nothing new is worth remembering, return the current memory unchanged.
Respond with ONLY the new memory string. No quotes, no labels, no explanation.`,
        messages: [{ role: 'user', content: `User just scheduled:\n${summary}` }],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const newMem = (data.content?.[0]?.text || '').trim().slice(0, 500);
    if (newMem) localStorage.setItem('scheduler_memory', newMem);
  } catch {}
}

// ── EVENT POPUP ────────────────────────────────────────────
let _popupEventData    = null;
let _popupHoverOnly    = false; // true = still purely hover (semi-transparent, closes on any leave)
let _popupClickOpened  = false; // true = real click, stays open until explicit dismiss
let _popupCloseTimer   = null;

function showEventPopup(mouseEvent, encodedData, hoverOpened = false) {
  mouseEvent.stopPropagation();
  _renderPopup(JSON.parse(decodeURIComponent(encodedData)), mouseEvent.clientX, mouseEvent.clientY, hoverOpened);
}

function showEventPopupFromEl(mouseEvent, jsonStr) {
  mouseEvent.stopPropagation();
  _renderPopup(JSON.parse(jsonStr), mouseEvent.clientX, mouseEvent.clientY, false);
}

function _renderPopup(data, cx, cy, hoverOpened = false) {
  const popup   = document.getElementById('event-popup');
  const overlay = document.getElementById('popup-overlay');

  // If popup is already showing the same event and we're clicking, just solidify in-place
  if (_popupEventData && !_popupClickOpened && !hoverOpened &&
      _popupEventData.title === data.title && _popupEventData.start === data.start) {
    _popupHoverOnly   = false;
    _popupClickOpened = true;
    popup.classList.add('solidified');
    overlay.classList.remove('hidden');
    return;
  }

  _popupEventData   = data;
  _popupHoverOnly   = hoverOpened;
  _popupClickOpened = !hoverOpened;
  clearTimeout(_popupCloseTimer);

  document.getElementById('popup-read-view').classList.remove('hidden');
  document.getElementById('popup-edit-view').classList.add('hidden');
  document.getElementById('popup-title').textContent = data.title || 'Event';

  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : '';
  const fmtTime = iso => iso && iso.includes('T') ? new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '';
  let timeStr = '';
  if (data.start) {
    const dl = fmtDate(data.start), st = fmtTime(data.start), et = fmtTime(data.end);
    timeStr = st && et ? `${dl}  ·  ${st} – ${et}` : st ? `${dl}  ·  ${st}` : dl;
  }
  document.getElementById('popup-time').textContent = timeStr;
  document.getElementById('popup-desc').textContent = data.desc || '';
  document.getElementById('popup-loc').textContent  = data.loc ? `📍 ${data.loc}` : '';

  if (data.isProposed) {
    document.getElementById('popup-actions').innerHTML =
      `<button class="popup-edit-btn" onclick="closeEventPopup();document.getElementById('card-${data.idx}')?.scrollIntoView({behavior:'smooth',block:'center'})">View card ↓</button>`;
  } else {
    document.getElementById('popup-actions').innerHTML = data.id ? `
      <button class="popup-edit-btn"   onclick="openEventEdit()">Edit</button>
      <button class="popup-delete-btn" onclick="deleteEvent()">Delete</button>` : '';
  }

  const vw = window.innerWidth, vh = window.innerHeight;
  let left = cx + 12, top = cy + 12;
  if (left + 320 > vw - 10) left = cx - 332;
  if (top  + 220 > vh - 10) top  = cy - 232;
  popup.style.left = `${Math.max(10, left)}px`;
  popup.style.top  = `${Math.max(10, top)}px`;

  // Overlay blocks background clicks — only for solidified (click-opened) popups
  if (hoverOpened) {
    overlay.classList.add('hidden');
  } else {
    overlay.classList.remove('hidden');
  }

  // Reset state, show, then transition in on next two frames so CSS picks up initial opacity:0
  popup.classList.remove('visible', 'solidified');
  popup.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.classList.add('visible');
    if (!hoverOpened) popup.classList.add('solidified');
  }));
}

function openEventEdit() {
  if (!_popupEventData) return;
  const d = _popupEventData;
  document.getElementById('popup-read-view').classList.add('hidden');
  document.getElementById('popup-edit-view').classList.remove('hidden');
  document.getElementById('popup-edit-title').value      = d.title || '';
  document.getElementById('popup-edit-start-date').value = d.start ? d.start.slice(0,10) : '';
  document.getElementById('popup-edit-start-time').value = d.start?.includes('T') ? d.start.slice(11,16) : '';
  document.getElementById('popup-edit-end-date').value   = d.end   ? d.end.slice(0,10)   : '';
  document.getElementById('popup-edit-end-time').value   = d.end?.includes('T')   ? d.end.slice(11,16)   : '';
}

function cancelEventEdit() {
  document.getElementById('popup-read-view').classList.remove('hidden');
  document.getElementById('popup-edit-view').classList.add('hidden');
}

async function saveEventEdit() {
  if (!_popupEventData?.id) return;
  const { id, calId = 'primary' } = _popupEventData;
  const title     = document.getElementById('popup-edit-title').value.trim();
  const startDate = document.getElementById('popup-edit-start-date').value;
  const startTime = document.getElementById('popup-edit-start-time').value;
  const endDate   = document.getElementById('popup-edit-end-date').value;
  const endTime   = document.getElementById('popup-edit-end-time').value;
  if (!title || !startDate || !startTime || !endDate || !endTime) { showToast('Fill in all fields', 'error'); return; }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const res = await apiFetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: title,
        start: { dateTime: `${startDate}T${startTime}:00`, timeZone: tz },
        end:   { dateTime: `${endDate}T${endTime}:00`,     timeZone: tz },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    closeEventPopup(); await fetchEvents7(); showToast('Event updated', 'success');
  } catch (e) { showToast('Update failed: ' + e.message, 'error'); }
}

async function deleteEvent() {
  if (!_popupEventData?.id) return;
  const id = _popupEventData.id;
  document.getElementById('popup-actions').innerHTML = `
    <span class="popup-delete-confirm-text">Delete this event?</span>
    <button class="popup-edit-btn"   onclick="restorePopupActions()">Cancel</button>
    <button class="popup-delete-btn" onclick="confirmDeleteEvent('${id}')">Yes, delete</button>`;
}

function restorePopupActions() {
  document.getElementById('popup-actions').innerHTML = `
    <button class="popup-edit-btn"   onclick="openEventEdit()">Edit</button>
    <button class="popup-delete-btn" onclick="deleteEvent()">Delete</button>`;
}

async function confirmDeleteEvent(id) {
  const calId = _popupEventData?.calId || 'primary';
  try {
    const res = await apiFetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) throw new Error(await res.text());
    closeEventPopup(); await fetchEvents7(); showToast('Event deleted', 'success');
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

function closeEventPopup() {
  const popup = document.getElementById('event-popup');
  popup.classList.remove('visible', 'solidified');
  document.getElementById('popup-overlay').classList.add('hidden');
  _popupCloseTimer = setTimeout(() => popup.classList.add('hidden'), 180);
  _popupEventData   = null;
  _popupHoverOnly   = false;
  _popupClickOpened = false;
}

function _closeHoverPopup() {
  if (_popupClickOpened) return;
  closeEventPopup();
}

window.addEventListener('scroll', closeEventPopup, { passive: true });
document.addEventListener('scroll', closeEventPopup, { capture: true, passive: true });

// ── REVISE ─────────────────────────────────────────────────
function toggleRevise() {
  const area = document.getElementById('revise-area');
  const btn  = document.querySelector('.btn-revise');
  const isHidden = area.classList.toggle('hidden');
  if (btn) btn.textContent = isHidden ? 'Revise' : 'Cancel Revision';
  if (!isHidden) document.getElementById('revise-input').focus();
}

async function handleRevise() {
  const revision = document.getElementById('revise-input').value.trim();
  if (!revision) { showError('Describe what you want to change.'); return; }
  const currentProposals = proposedEvents.map(e => `- "${e.title}" from ${e.start} to ${e.end}`).join('\n');
  document.getElementById('revise-input').value = '';
  // Clear proposals before revising so callClaude replaces them cleanly
  proposedEvents = [];
  saveProposedEvents();
  await callClaude([{ role: 'user', content: `I previously asked you to schedule some things and you proposed:\n${currentProposals}\n\nI want to make the following changes: ${revision}` }]);
}
