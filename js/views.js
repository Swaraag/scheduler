// Calendar view renderers: day, week, month, year + shared time grid

function goToToday() {
  currentDayDate = new Date();
  switchCalView(currentView);
}

function switchCalView(view, date) {
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
  switch (currentView) {
    case 'day':   renderDayView();   break;
    case 'week':  renderWeekView();  break;
    case 'month': renderMonthView(); break;
    case 'year':  renderYearView();  break;
  }
}

function renderDayView() {
  const el      = document.getElementById('cal-day-view');
  const target  = new Date(currentDayDate); target.setHours(0,0,0,0);
  const today   = new Date(); today.setHours(0,0,0,0);
  const isToday = target.toDateString() === today.toDateString();
  const dayStr  = target.toISOString().slice(0,10);
  const pool    = calEventsYear || calEvents7;
  const events  = pool.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dayStr);
  const DAY_NAMES  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${DAY_NAMES[target.getDay()]}, ${MONTH_ABBR[target.getMonth()]} ${target.getDate()}`;
  el.innerHTML = buildTimeGrid([{ date: target, label, events, isToday }], 'single');
  scrollToNow(el);
}

function renderWeekView(extra = []) {
  const el    = document.getElementById('cal-week-view');
  const today = new Date(); today.setHours(0,0,0,0);
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const cols = Array.from({ length: 7 }, (_, i) => {
    const d      = new Date(today); d.setDate(today.getDate() + i);
    const dayStr = d.toISOString().slice(0,10);
    return {
      date: d, label: DAY_ABBR[d.getDay()], isToday: i === 0,
      events:   calEvents7.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dayStr),
      proposed: extra.filter(e => (e.start || '').slice(0,10) === dayStr),
    };
  });
  el.innerHTML = buildTimeGrid(cols, 'multi');
  scrollToNow(el);
}

function buildTimeGrid(cols, mode) {
  const totalHours = WEEK_END_HOUR - WEEK_START_HOUR;
  const gridCols   = `44px repeat(${cols.length}, 1fr)`;

  const headerCells = cols.map(c => {
    const ds = `${c.date.getFullYear()}-${String(c.date.getMonth()+1).padStart(2,'0')}-${String(c.date.getDate()).padStart(2,'0')}`;
    return `<div class="tg-day-label ${c.isToday ? 'today' : ''} clickable"
      onclick="switchCalView('day','${ds}')" title="View ${c.label}">
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
      <div class="tg-corner" style="width:44px"></div>${headerCells}
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
  const btns = height >= 48 ? `
    <div class="prop-block-actions">
      <button class="prop-block-btn accept" onclick="event.stopPropagation();acceptProposal(${idx})">✓</button>
      <button class="prop-block-btn reject" onclick="event.stopPropagation();rejectProposal(${idx})">✗</button>
    </div>` : '';
  return `<div class="tg-event proposed ${stateClass}" style="top:${top}px;height:${height}px" id="prop-block-${idx}">
    <div class="tg-event-title">${ev.title}</div>${btns}
  </div>`;
}

function scrollToNow(el) {
  const body = el.querySelector('.tg-body');
  if (body) body.scrollTop = Math.max(0, (new Date().getHours() - WEEK_START_HOUR - 1)) * HOUR_PX;
}

function renderMonthView(extra = []) {
  const el    = document.getElementById('cal-month-view');
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let cells = Array(firstDay.getDay()).fill({ empty: true });
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({
      d, dateStr, isToday: d === today.getDate(),
      events:   calEvents7.filter(e => (e.start.dateTime || e.start.date || '').slice(0,10) === dateStr),
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
    <div style="padding:12px 16px 8px;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--soft);border-bottom:1px solid var(--border)">
      ${MONTH_NAMES[month]} ${year}
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
  const year  = today.getFullYear();
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
    return `<div class="year-month" onclick="switchCalView('month')" title="View ${name}">
      <div class="year-month-name">${name}</div>
      <div class="year-month-grid">${cells.join('')}</div>
    </div>`;
  }).join('');

  gridEl.innerHTML = `<div class="year-grid-wrap"><div class="year-months">${monthsHtml}</div></div>`;
}
