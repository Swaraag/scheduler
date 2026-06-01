// Calendar view renderers: day, week, month, year + shared time grid

function goToToday() {
  currentDayDate     = new Date();
  currentWeekOffset  = 0;
  currentMonthOffset = 0;
  currentYearOffset  = 0;
  switchCalView('day');
}

function navigateDay(delta) {
  currentDayDate.setDate(currentDayDate.getDate() + delta);
  renderDayView();
}

function navigateWeek(delta) {
  currentWeekOffset += delta;
  renderWeekView(proposedEvents.filter(e => e._state !== 'rejected'));
}

function navigateMonth(delta) {
  currentMonthOffset += delta;
  renderMonthView(proposedEvents.filter(e => e._state !== 'rejected'));
}

function navigateYear(delta) {
  currentYearOffset += delta;
  renderYearView();
}

function switchCalView(view, date) {
  if (view !== 'week')  currentWeekOffset  = 0;
  if (view !== 'month') currentMonthOffset = 0;
  if (view !== 'year')  currentYearOffset  = 0;
  currentView = view;
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    currentDayDate = new Date(y, m - 1, d);
  }
  ['day','week','month','year'].forEach(v => {
    document.getElementById(`pill-${v}`).classList.toggle('active', v === view);
    document.getElementById(`cal-${v}-view`).classList.toggle('hidden', v !== view);
  });
  renderCurrentView();
}

function renderCurrentView() {
  const visible = (typeof proposedEvents !== 'undefined')
    ? proposedEvents.filter(e => e._state !== 'rejected')
    : [];
  switch (currentView) {
    case 'day':   renderDayView(visible);   break;
    case 'week':  renderWeekView(visible);  break;
    case 'month': renderMonthView(visible); break;
    case 'year':  renderYearView();         break;
  }
}

function renderDayView(extra = []) {
  const el      = document.getElementById('cal-day-view');
  const target  = new Date(currentDayDate); target.setHours(0,0,0,0);
  const today   = new Date(); today.setHours(0,0,0,0);
  const isToday = target.toDateString() === today.toDateString();
  const dayStr  = `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(target.getDate()).padStart(2,'0')}`;
  const pool    = calEventsYear || calEvents7;
  const events  = pool.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dayStr);
  const proposed = extra.filter(e => (e.start || '').slice(0,10) === dayStr);
  const DAY_NAMES  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${DAY_NAMES[target.getDay()]}, ${MONTH_ABBR[target.getMonth()]} ${target.getDate()}`;
  el.innerHTML = buildTimeGrid([{ date: target, label, events, proposed, isToday }], 'day');
  scrollToNow(el);
}

function renderWeekView(extra = []) {
  if (window.innerWidth <= 600) { switchCalView('day'); return; }
  const el    = document.getElementById('cal-week-view');
  const today = new Date(); today.setHours(0,0,0,0);
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // Anchor to today + offset
  const anchor = new Date(today); anchor.setDate(today.getDate() + currentWeekOffset * 7);
  // Use year events pool when available (covers past/future weeks outside the 7-day window)
  const pool = calEventsYear || calEvents7;
  const cols = Array.from({ length: 7 }, (_, i) => {
    const d      = new Date(anchor); d.setDate(anchor.getDate() + i);
    const dayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return {
      date: d, label: DAY_ABBR[d.getDay()],
      isToday: d.toDateString() === today.toDateString(),
      events:   pool.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dayStr),
      proposed: extra.filter(e => (e.start || '').slice(0,10) === dayStr),
    };
  });
  el.innerHTML = buildTimeGrid(cols, 'week');
  scrollToNow(el);
}

function buildTimeGrid(cols, mode) {
  const totalHours = WEEK_END_HOUR - WEEK_START_HOUR;
  const gridCols   = `44px repeat(${cols.length}, 1fr)`;

  // Nav arrows: day view navigates by 1 day, week view by 1 week
  const prevFn = mode === 'day' ? `navigateDay(-1)` : `navigateWeek(-1)`;
  const nextFn = mode === 'day' ? `navigateDay(1)`  : `navigateWeek(1)`;
  const navCorner = `
    <div class="tg-corner tg-nav-corner">
      <button class="tg-nav-btn" onclick="${prevFn}" title="Previous">‹</button>
      <button class="tg-nav-btn" onclick="${nextFn}" title="Next">›</button>
    </div>`;

  const headerCells = cols.map(c => {
    const ds = `${c.date.getFullYear()}-${String(c.date.getMonth()+1).padStart(2,'0')}-${String(c.date.getDate()).padStart(2,'0')}`;
    const clickable = mode !== 'day' ? `clickable" onclick="switchCalView('day','${ds}')" title="View ${c.label}` : ``;
    return `<div class="tg-day-label ${c.isToday ? 'today' : ''} ${clickable}">
      ${c.label}<span class="day-num">${c.date.getDate()}</span>
    </div>`;
  }).join('');

  const timeLabels = Array.from({ length: totalHours }, (_, i) => {
    const h = WEEK_START_HOUR + i;
    return `<div class="tg-time-label">${h > 12 ? h-12 : h}${h >= 12 ? 'pm' : 'am'}</div>`;
  }).join('');

  const dayCols = cols.map(c => {
    const blocks   = (c.events || []).map(e => eventBlock(e)).join('');
    const proposed = (c.proposed || []).map((e, pi) => proposedBlock(e, e._idx !== undefined ? e._idx : pi)).join('');
    const now = new Date();
    const nowLine = c.isToday
      ? `<div class="now-line" style="top:${(now.getHours() + now.getMinutes()/60 - WEEK_START_HOUR) * HOUR_PX}px"></div>`
      : '';
    return `<div class="tg-day-col">${blocks}${proposed}${nowLine}</div>`;
  }).join('');

  return `<div class="time-grid">
    <div class="tg-header" style="grid-template-columns:${gridCols}">
      ${navCorner}${headerCells}
    </div>
    <div class="tg-body" style="grid-template-columns:${gridCols}">
      <div class="tg-time-col">${timeLabels}</div>${dayCols}
    </div>
  </div>`;
}

function eventBlock(ev) {
  const start  = new Date(ev.start?.dateTime || ev.start?.date || ev.start);
  const end    = new Date(ev.end?.dateTime   || ev.end?.date   || ev.end || ev.start?.dateTime || ev.start);
  const top    = Math.max(0, start.getHours() + start.getMinutes()/60 - WEEK_START_HOUR) * HOUR_PX;
  const height = Math.max(18, (end.getHours() + end.getMinutes()/60 - start.getHours() - start.getMinutes()/60) * HOUR_PX);
  const title  = ev.summary || ev.title || 'Event';
  const data   = encodeURIComponent(JSON.stringify({
    id: ev.id || '', calId: ev._calId || 'primary',
    title, start: start.toISOString(), end: end.toISOString(),
    desc: ev.description || '', loc: ev.location || '',
  }));
  return `<div class="tg-event" style="top:${top}px;height:${height}px" onclick="showEventPopup(event,'${data}')">
    <div class="tg-event-title">${title}</div>
  </div>`;
}

function proposedBlock(ev, idx) {
  const start  = new Date(ev.start);
  const end    = new Date(ev.end);
  const top    = Math.max(0, start.getHours() + start.getMinutes()/60 - WEEK_START_HOUR) * HOUR_PX;
  const height = Math.max(18, (end.getHours() + end.getMinutes()/60 - start.getHours() - start.getMinutes()/60) * HOUR_PX);
  const state  = ev._state || 'pending';
  if (state === 'rejected') return '';
  const stateClass = state === 'accepted' ? 'proposed-accepted' : 'proposed-pending';
  const data = encodeURIComponent(JSON.stringify({
    title: ev.title, start: ev.start, end: ev.end,
    desc: ev.description || '', loc: ev.location || '',
    isProposed: true, idx,
  }));
  return `<div class="tg-event proposed ${stateClass}" style="top:${top}px;height:${height}px" id="prop-block-${idx}"
    onclick="showEventPopup(event,'${data}')">
    <div class="prop-block-top">
      <div class="prop-block-actions">
        <button class="prop-block-btn accept" onclick="event.stopPropagation();acceptProposal(${idx})">✓</button>
        <button class="prop-block-btn reject" onclick="event.stopPropagation();rejectProposal(${idx})">✗</button>
      </div>
      <div class="tg-event-title">${ev.title}</div>
    </div>
    <div class="prop-resize-handle"></div>
  </div>`;
}

function scrollToNow(el) {
  const body = el.querySelector('.tg-body');
  if (body) {
    body.scrollTop = Math.max(0, (new Date().getHours() - WEEK_START_HOUR - 1)) * HOUR_PX;
    attachGridInteractions(body);
  }
}

// ── HOVER-TO-OPEN + DRAG-TO-RESCHEDULE ────────────────────
let _hoverTimer      = null;
let _hoverLeaveTimer = null;
let _todoDragging    = false; // set true while a todo→calendar drag is active

function attachGridInteractions(gridBody) {
  // Use mouseover/mouseout (they bubble) so entering from any side/child works
  gridBody.addEventListener('mouseover', (e) => {
    const block = e.target.closest('.tg-event');
    if (!block) return;
    if (block.contains(e.relatedTarget)) return;
    if (block.classList.contains('proposed')) block.style.zIndex = '20';
    clearTimeout(_hoverTimer);
    clearTimeout(_hoverLeaveTimer);
    // If this block's popup is already open (from hover-into-popup), de-solidify back to grayed
    if (!_popupClickOpened && _popupEventData) {
      const popup = document.getElementById('event-popup');
      _popupHoverOnly = true;
      popup.classList.remove('solidified');
      document.getElementById('popup-overlay').classList.add('hidden');
    }
    _hoverTimer = setTimeout(() => {
      if (block.dataset.dragging) return;
      if (_todoDragging) return;
      const r = block.getBoundingClientRect();
      const encoded = block.getAttribute('onclick')?.match(/showEventPopup\(event,'([^']+)'\)/)?.[1];
      if (!encoded) return;
      const data = JSON.parse(decodeURIComponent(encoded));
      _renderPopup(data, r.right, r.top, true);
    }, 300);
  });

  gridBody.addEventListener('mouseout', (e) => {
    const block = e.target.closest('.tg-event');
    if (!block) return;
    if (block.contains(e.relatedTarget)) return;
    if (block.classList.contains('proposed')) block.style.zIndex = '';
    clearTimeout(_hoverTimer);
    _hoverLeaveTimer = setTimeout(() => _closeHoverPopup(), 200);
  });

  // Wire popup interactions once globally
  if (!window._popupHoverWired) {
    window._popupHoverWired = true;
    const popup = document.getElementById('event-popup');
    // Entering popup: solidify visually but not permanently (not click-opened)
    popup.addEventListener('mouseenter', () => {
      clearTimeout(_hoverLeaveTimer);
      _popupHoverOnly = false;
      popup.classList.add('solidified');
    });
    // Leaving popup: close unless a real click opened it
    popup.addEventListener('mouseleave', () => {
      _hoverLeaveTimer = setTimeout(() => _closeHoverPopup(), 150);
    });
    // Clicking popup: make it truly persistent
    popup.addEventListener('mousedown', () => {
      clearTimeout(_hoverLeaveTimer);
      _popupClickOpened = true;
      popup.classList.add('solidified');
      document.getElementById('popup-overlay').classList.remove('hidden');
    });
  }

  // Resize: drag the bottom handle of a proposed block
  gridBody.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.prop-resize-handle')) return;
    e.stopPropagation();
    e.preventDefault();

    const block = e.target.closest('.tg-event.proposed');
    if (!block) return;
    const idx = parseInt(block.id.replace('prop-block-', ''));
    if (isNaN(idx)) return;

    const ev      = proposedEvents[idx];
    const col     = block.closest('.tg-day-col');
    if (!col) return;

    const origHeight = parseFloat(block.style.height);
    const startY     = e.clientY;
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

    clearTimeout(_hoverTimer);
    block.dataset.dragging = '1';

    const onMove = (me) => {
      const dy = me.clientY - startY;
      // Snap to 15-min increments, min 15 min (HOUR_PX/4)
      const deltaMins   = Math.round((dy / HOUR_PX) * 60 / 15) * 15;
      const newHeightPx = Math.max(HOUR_PX / 4, origHeight + (deltaMins / 60) * HOUR_PX);
      block.style.height = `${newHeightPx}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      delete block.dataset.dragging;

      const newHeightPx = parseFloat(block.style.height);
      const newDurMins  = Math.round((newHeightPx / HOUR_PX) * 60 / 15) * 15;
      const newEndDate  = new Date(ev.start);
      newEndDate.setMinutes(newEndDate.getMinutes() + newDurMins);

      proposedEvents[idx].end = fmt(newEndDate);
      saveProposedEvents();
      _refreshCalWithProposals();
      renderProposals();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Move drag: only on proposed blocks (not on buttons or resize handle)
  gridBody.addEventListener('mousedown', (e) => {
    const block = e.target.closest('.tg-event.proposed');
    if (!block) return;
    if (e.target.closest('.prop-block-btn')) return;
    if (e.target.closest('.prop-resize-handle')) return;

    const idx = parseInt(block.id.replace('prop-block-', ''));
    if (isNaN(idx)) return;

    const ev         = proposedEvents[idx];
    const col        = block.closest('.tg-day-col');
    if (!col) return;

    const startMs    = new Date(ev.start).getTime();
    const endMs      = new Date(ev.end).getTime();
    const durationMs = endMs - startMs;

    const startY     = e.clientY;
    let   ghost      = null;
    let   dragging   = false;

    const onMove = (me) => {
      const dy = me.clientY - startY;
      if (!dragging && Math.abs(dy) < 6) return;

      if (!dragging) {
        dragging = true;
        clearTimeout(_hoverTimer);
        block.dataset.dragging = '1';
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.height = block.style.height;
        col.appendChild(ghost);
        block.style.opacity = '0.3';
      }

      const deltaMins = Math.round((dy / HOUR_PX) * 60 / 15) * 15;
      const newTopPx  = Math.max(0, parseFloat(block.style.top) + (deltaMins / 60) * HOUR_PX);
      ghost.style.top = `${newTopPx}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      if (!dragging) { delete block.dataset.dragging; return; }

      const newTopPx     = parseFloat(ghost.style.top);
      const newStartH    = newTopPx / HOUR_PX + WEEK_START_HOUR;
      const newStartDate = new Date(ev.start);
      newStartDate.setHours(Math.floor(newStartH), Math.round((newStartH % 1) * 60), 0, 0);
      const newEndDate   = new Date(newStartDate.getTime() + durationMs);

      const pad = n => String(n).padStart(2, '0');
      const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

      proposedEvents[idx].start = fmt(newStartDate);
      proposedEvents[idx].end   = fmt(newEndDate);

      ghost.remove();
      delete block.dataset.dragging;
      block.style.opacity = '';

      saveProposedEvents();
      _refreshCalWithProposals();
      renderProposals();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function renderMonthView(extra = []) {
  const el    = document.getElementById('cal-month-view');
  const today = new Date();
  // Apply offset: shift month, let Date handle year rollovers
  const base  = new Date(today.getFullYear(), today.getMonth() + currentMonthOffset, 1);
  const year  = base.getFullYear();
  const month = base.getMonth();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Use year events if available (covers non-current months), fall back to 7-day pool
  const pool = calEventsYear || calEvents7;

  let cells = Array(firstDay.getDay()).fill({ empty: true });
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({
      d, dateStr,
      isToday: isCurrentMonth && d === today.getDate(),
      events:   pool.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dateStr),
      proposed: extra.filter(e => (e.start || '').slice(0,10) === dateStr),
    });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  cells = cells.concat(Array(trailing).fill({ empty: true }));

  const cellsHtml = cells.map(c => {
    if (c.empty) return `<div class="month-cell other-month"></div>`;
    const pills = c.events.slice(0,3).map(e => {
      const payload = JSON.stringify({ id: e.id||'', calId: e._calId||'primary', title: e.summary||'Event',
        start: e.start.dateTime||e.start.date, end: e.end?.dateTime||e.end?.date||'',
        desc: e.description||'', loc: e.location||'' });
      return `<span class="month-pill" onclick="event.stopPropagation();showEventPopupFromEl(event,${JSON.stringify(payload)})">${e.summary||'Event'}</span>`;
    }).join('');
    const propPills = c.proposed.map(e => `<span class="month-pill proposed">${e.title}</span>`).join('');
    const overflow  = c.events.length > 3 ? `<div class="month-overflow">+${c.events.length-3} more</div>` : '';
    return `<div class="month-cell ${c.isToday?'today':''}" onclick="switchCalView('day','${c.dateStr}')">
      <div class="month-cell-num">${c.d}</div>${pills}${propPills}${overflow}
    </div>`;
  }).join('');

  el.innerHTML = `<div class="month-grid">
    <div class="month-nav-header">
      <button class="tg-nav-btn" onclick="navigateMonth(-1)">‹</button>
      <span class="month-nav-title">${MONTH_NAMES[month]} ${year}</span>
      <button class="tg-nav-btn" onclick="navigateMonth(1)">›</button>
    </div>
    <div class="month-header-row">${DAY_NAMES.map(d => `<div class="month-day-name">${d}</div>`).join('')}</div>
    <div class="month-body">${cellsHtml}</div>
  </div>`;
}

function renderYearView() {
  const loadingEl = document.getElementById('year-loading');
  const gridEl    = document.getElementById('year-grid');
  if (calEventsYear === null) { loadingEl.classList.remove('hidden'); gridEl.classList.add('hidden'); return; }
  loadingEl.classList.add('hidden'); gridEl.classList.remove('hidden');

  const today = new Date();
  const year  = today.getFullYear() + currentYearOffset;
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const countMap = {};
  calEventsYear.forEach(e => {
    const d = (e.start.dateTime || e.start.date || '').slice(0,10);
    if (d) countMap[d] = (countMap[d] || 0) + 1;
  });

  const monthsHtml = MONTH_NAMES.map((name, mi) => {
    const firstDay = new Date(year, mi, 1);
    const lastDay  = new Date(year, mi + 1, 0);
    let cells = Array(firstDay.getDay()).fill('<div class="year-day other-month"></div>');
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(mi+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const count   = countMap[dateStr] || 0;
      const level   = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
      const isToday = today.getFullYear() === year && today.getMonth() === mi && today.getDate() === d;
      cells.push(`<div class="year-day has-events-${level} ${isToday?'today':''}" title="${count} event${count!==1?'s':''}"></div>`);
    }
    return `<div class="year-month" onclick="switchCalView('month');currentMonthOffset=${(year - today.getFullYear()) * 12 + mi - today.getMonth()};renderMonthView()" title="View ${name} ${year}">
      <div class="year-month-name">${name}</div>
      <div class="year-month-grid">${cells.join('')}</div>
    </div>`;
  }).join('');

  gridEl.innerHTML = `<div class="year-grid-wrap">
    <div class="year-nav-header">
      <button class="tg-nav-btn" onclick="navigateYear(-1)">‹</button>
      <span class="year-nav-title">${year}</span>
      <button class="tg-nav-btn" onclick="navigateYear(1)">›</button>
    </div>
    <div class="year-months">${monthsHtml}</div>
  </div>`;
}
