// Claude API, proposals UI, event popup edit/delete, calendar write, revise

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
    const data    = await res.json();
    const raw     = data.content?.[0]?.text?.trim();
    if (!raw) throw new Error('Empty response from Claude');
    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
    proposedEvents = JSON.parse(cleaned);
    if (!Array.isArray(proposedEvents) || proposedEvents.length === 0)
      throw new Error('No events could be scheduled. Try being more specific.');
    setLoading(false);
    renderProposals();
  } catch (e) { setLoading(false); showError('Error: ' + e.message); }
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
            <input class="extra-field-input" type="text" placeholder="e.g. RRULE:FREQ=WEEKLY;BYDAY=MO"
              value="${ev.recurrence||''}"
              onchange="updateProposal(${i},'recurrence',this.value||null)" />
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('proposals-section').classList.add('visible');
  document.getElementById('revise-area').classList.add('hidden');
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
  _refreshCalWithProposals();
}

function acceptProposal(i) {
  proposedEvents[i]._state = proposedEvents[i]._state === 'accepted' ? 'pending' : 'accepted';
  renderProposals();
}

function rejectProposal(i) {
  proposedEvents[i]._state = proposedEvents[i]._state === 'rejected' ? 'pending' : 'rejected';
  renderProposals();
}

function updateProposal(i, field, value) {
  proposedEvents[i][field] = value;
  _refreshCalWithProposals();
}

function _refreshCalWithProposals() {
  const visible = proposedEvents.filter(e => e._state !== 'rejected');
  if (currentView === 'week')  renderWeekView(visible);
  if (currentView === 'month') renderMonthView(visible);
}

// ── CALENDAR WRITE ─────────────────────────────────────────
async function confirmEvents() {
  const toAdd = proposedEvents.filter(e => e._state !== 'rejected');
  if (toAdd.length === 0) { showToast('Nothing to add — reject fewer events', 'error'); return; }
  setLoading(true, `adding ${toAdd.length} event${toAdd.length>1?'s':''}...`);
  document.getElementById('proposals-section').classList.remove('visible');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const COLOR_MAP = { tomato:'11',flamingo:'4',tangerine:'6',banana:'5',sage:'2',basil:'10',peacock:'7',blueberry:'9',lavender:'1',grape:'3',graphite:'8' };
  let added = 0;
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
      const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(targetCal)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gapiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      added++;
    } catch (e) { console.error('Failed to add:', ev.title, e); }
  }
  setLoading(false);
  await fetchEvents7();
  resetUI();
  showToast(`${added} event${added>1?'s':''} added to Google Calendar ✓`, 'success');
  updateMemoryAfterConfirm(toAdd);
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
let _popupEventData = null;

function showEventPopup(mouseEvent, encodedData) {
  mouseEvent.stopPropagation();
  _renderPopup(JSON.parse(decodeURIComponent(encodedData)), mouseEvent.clientX, mouseEvent.clientY);
}

function showEventPopupFromEl(mouseEvent, jsonStr) {
  mouseEvent.stopPropagation();
  _renderPopup(JSON.parse(jsonStr), mouseEvent.clientX, mouseEvent.clientY);
}

function _renderPopup(data, cx, cy) {
  _popupEventData = data;
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

  document.getElementById('event-popup').classList.remove('hidden');
  document.getElementById('popup-overlay').classList.remove('hidden');

  const vw = window.innerWidth, vh = window.innerHeight;
  let left = cx + 12, top = cy + 12;
  if (left + 320 > vw - 10) left = cx - 332;
  if (top  + 220 > vh - 10) top  = cy - 232;
  const popup = document.getElementById('event-popup');
  popup.style.left = `${Math.max(10, left)}px`;
  popup.style.top  = `${Math.max(10, top)}px`;
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
    const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${gapiToken}`, 'Content-Type': 'application/json' },
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
    const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${gapiToken}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(await res.text());
    closeEventPopup(); await fetchEvents7(); showToast('Event deleted', 'success');
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

function closeEventPopup() {
  document.getElementById('event-popup').classList.add('hidden');
  document.getElementById('popup-overlay').classList.add('hidden');
  _popupEventData = null;
}

window.addEventListener('scroll', closeEventPopup, { passive: true });
document.addEventListener('scroll', closeEventPopup, { capture: true, passive: true });

// ── REVISE ─────────────────────────────────────────────────
function toggleRevise() {
  const area = document.getElementById('revise-area');
  area.classList.toggle('hidden');
  if (!area.classList.contains('hidden')) document.getElementById('revise-input').focus();
}

async function handleRevise() {
  const revision = document.getElementById('revise-input').value.trim();
  if (!revision) { showError('Describe what you want to change.'); return; }
  const currentProposals = proposedEvents.map(e => `- "${e.title}" from ${e.start} to ${e.end}`).join('\n');
  document.getElementById('revise-input').value = '';
  proposedEvents = [];
  await callClaude([{ role: 'user', content: `I previously asked you to schedule some things and you proposed:\n${currentProposals}\n\nI want to make the following changes: ${revision}` }]);
}
