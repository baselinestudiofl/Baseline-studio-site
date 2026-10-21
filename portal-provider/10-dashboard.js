// ============================================================================
// portal-provider/10-dashboard.js  -  dashboard: widgets, tasks card, availability check, weather chip, stat count-up
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── E: Unified availability checker (both dashboard + equipment page) ────
    function checkAvailability(date, resultElId) {
      const result = document.getElementById(resultElId);
      if (!result) return;
      if (!date) { result.innerHTML = ''; return; }
      const events = getDB('events') || [];
      const inqs = window._inquiries || [];
      const conflictEvents = events.filter(e => e.date === date && ['booked','confirmed'].includes(e.status));
      const conflictInqs = inqs.filter(i => i.event_date === date && i.status === 'booked');
      const allConflicts = [
        ...conflictEvents.map(e => ({ name: e.name, time: e.startTime ? `${e.startTime}–${e.endTime||''}` : '', type: 'event', id: e.id })),
        ...conflictInqs.map(i => ({ name: i.name || i.email || 'Inquiry', type: 'inquiry', id: i.id }))
      ];
      const formatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
      if (!allConflicts.length) {
        result.innerHTML = `<div class="avail-result avail-free">${formatted} is open — no booked events.</div>`;
      } else {
        const links = allConflicts.map(c => {
          const detail = c.time ? ` (${c.time})` : '';
          const action = c.type === 'event' ? `openEventDetail('${c.id}')` : `openInquiry('${c.id}')`;
          return `<a href="#" onclick="event.preventDefault();${action}" style="color:var(--cyan);text-decoration:none;font-weight:600;">${c.name}${detail}</a>`;
        }).join(', ');
        result.innerHTML = `<div class="avail-result avail-busy">Conflict: ${links} already booked on this date.</div>`;
      }
    }

    function dashCheckAvail() {
      const date = document.getElementById('dashAvailDate').value;
      if (!date) return;
      checkAvailability(date, 'dashAvailResult');
    }

    // ── H: Weather chip via Open-Meteo (no API key) ──────────────────────────
    async function attachWeatherChip(event) {
      if (!event || !event.date) return;
      const today = new Date(); today.setHours(0,0,0,0);
      const evDate = new Date(event.date + 'T12:00:00');
      const diffDays = Math.ceil((evDate - today) / 86400000);
      if (diffDays < 0 || diffDays > 16) return;

      const CITY_COORDS = {
        'fort lauderdale': [26.12, -80.14], 'hollywood': [26.01, -80.15],
        'aventura': [25.96, -80.14], 'coral gables': [25.72, -80.27],
        'doral': [25.80, -80.35], 'hialeah': [25.86, -80.28],
        'kendall': [25.68, -80.32], 'miami beach': [25.79, -80.13],
        'brickell': [25.76, -80.19], 'wynwood': [25.80, -80.20],
        'bal harbour': [25.89, -80.12], 'aventura mall': [25.96, -80.14]
      };
      const venue = (event.venueName || '').toLowerCase();
      let lat = 25.76, lon = -80.19;
      for (const [city, coords] of Object.entries(CITY_COORDS)) {
        if (venue.includes(city)) { [lat, lon] = coords; break; }
      }

      const cacheKey = `bs_wx_${event.date}_${lat}`;
      let wx;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try { wx = JSON.parse(cached); } catch { wx = null; }
      }
      if (!wx) {
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York&start_date=${event.date}&end_date=${event.date}`;
          const r = await fetch(url);
          if (!r.ok) return;
          const data = await r.json();
          if (!data.daily || !data.daily.temperature_2m_max) return;
          wx = { hi: Math.round(data.daily.temperature_2m_max[0]), lo: Math.round(data.daily.temperature_2m_min[0]), precip: data.daily.precipitation_probability_max[0] || 0, code: data.daily.weather_code[0] || 0 };
          sessionStorage.setItem(cacheKey, JSON.stringify(wx));
        } catch { return; }
      }

      const c = wx.code;
      let icon = '🌤️';
      if (c === 0) icon = '☀️';
      else if (c <= 3) icon = '⛅';
      else if (c >= 51 && c <= 67) icon = '🌧️';
      else if (c >= 71 && c <= 77) icon = '❄️';
      else if (c >= 80 && c <= 99) icon = '⛈️';

      const dateLabel = evDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      let caption;
      if (wx.precip >= 60) caption = `${dateLabel} — ${wx.hi}° and a solid chance of rain. Worth having a plan.`;
      else if (wx.precip >= 30) caption = `${dateLabel} — ${wx.hi}° and possible showers. Keep an eye on it.`;
      else caption = `${dateLabel} — ${wx.hi}° and clear so far. We'll keep an eye on it.`;

      const chip = document.createElement('div');
      chip.id = 'weatherChip';
      chip.style.cssText = 'background:rgba(31,163,224,0.08);border:1px solid rgba(31,163,224,0.2);border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;font-size:13px;';
      chip.innerHTML = `<span style="font-size:22px;line-height:1;">${icon}</span><div><div style="color:rgba(255,255,255,0.9);font-weight:600;">${wx.hi}° / ${wx.lo}°F &nbsp;·&nbsp; ${wx.precip}% rain chance</div><div style="color:rgba(255,255,255,0.55);font-size:12px;margin-top:2px;">${caption}</div></div>`;

      const tabOverview = document.getElementById('tabOverview');
      if (tabOverview) tabOverview.insertBefore(chip, tabOverview.firstChild);
    }

    // ── Tasks card: shows tasks written by automation rules (key 'tasks') ─────────
    function _renderTasksCard() {
      const all = Array.isArray(getDB('tasks')) ? getDB('tasks') : [];
      const cutoff = Date.now() - 3 * 86400000;
      const open = all.filter(t => !t.completed);
      const done = all.filter(t => t.completed && new Date(t.completedAt || 0).getTime() > cutoff);
      const shown = open.slice(0, 15).concat(done);
      const nameFor = t => t.leadName || t.eventName
        || (((window._inquiries || []).find(i => i.id === t.leadId) || {}).name)
        || (((getDB('events') || []).find(e => e.id === t.eventId) || {}).name) || '';
      let h = '<div class="widget-card" id="dashTasksCard"><div class="widget-title">Tasks' + (open.length ? ' (' + open.length + ')' : '') + '</div>';
      if (!shown.length) h += '<div style="font-size:13px;color:var(--gray);">No open tasks. Automation tasks show up here.</div>';
      shown.forEach(t => {
        const who = nameFor(t);
        h += `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;${t.completed ? 'opacity:.6;' : ''}">
          <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskDone('${t.id}', this.checked)" style="margin-top:3px;">
          <span style="flex:1;${t.completed ? 'text-decoration:line-through;' : ''}">${esc(t.description || 'Task')}${who ? ' <span style="color:var(--gray);font-size:12px;">· ' + esc(who) + '</span>' : ''}</span>
          <span style="font-size:12px;color:var(--gray);white-space:nowrap;">${t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        </label>`;
      });
      if (open.length > 15) h += '<div style="font-size:12px;color:var(--gray);padding-top:8px;">+ ' + (open.length - 15) + ' more</div>';
      return h + '</div>';
    }

    function toggleTaskDone(taskId, done) {
      const tasks = Array.isArray(getDB('tasks')) ? getDB('tasks') : [];
      const t = tasks.find(x => x.id === taskId);
      if (!t) return;
      t.completed = !!done;
      t.completedAt = done ? new Date().toISOString() : null;
      setDB('tasks', tasks);
      const card = document.getElementById('dashTasksCard');
      if (card) card.outerHTML = _renderTasksCard();
    }

    function renderDashboard() {
      const events = getDB('events') || [];
      const clients = getDB('clients') || [];
      const currentUser = BSPortal.getCurrentUser();
      if (!currentUser) return;
      const now = new Date();
      const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

      let dashboardEvents = events;
      if (currentUser.role === 'dj') {
        dashboardEvents = events.filter(e => (e.staff || []).includes(currentUser.id));
      }

      const activeEvents = dashboardEvents.filter(e => ['booked', 'confirmed'].includes(e.status)).length;
      const thisMonthEvents = dashboardEvents.filter(e => e.date.startsWith(thisMonth)).length;
      const openLeads = dashboardEvents.filter(e => ['lead', 'proposal'].includes(e.status)).length;

      let html = '';
      if (currentUser.role !== 'dj') {
        [
          { label: 'Active Events',  value: activeEvents,     section: 'events',   style: 'cursor:pointer;' },
          { label: 'Total Clients',  value: clients.length,   section: 'clients',  style: 'cursor:pointer;' },
          { label: 'This Month',     value: thisMonthEvents,  section: 'events',   style: 'cursor:pointer;' },
          { label: 'Open Leads',     value: openLeads,        section: 'pipeline', style: 'cursor:pointer;' }
        ].forEach(s => {
          html += `<div class="stat-card" role="button" tabindex="0" style="${s.style}" onclick="switchSectionById('${s.section}')" title="View ${s.label}"><div class="stat-label">${s.label}</div><div class="stat-value" data-ticker="${s.value}">0</div><div style="font-size:12px;color:var(--cyan);margin-top:4px;letter-spacing:.05em;">View →</div></div>`;
        });
      }
      document.getElementById('statCards').innerHTML = html;
      // Animate stat values with count-up
      requestAnimationFrame(() => {
        document.querySelectorAll('#statCards .stat-value[data-ticker]').forEach(el => {
          tickerCountUp(el, parseInt(el.dataset.ticker, 10) || 0, 800);
        });
      });

      const upcoming = dashboardEvents.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5);
      let tableHtml = '<table><thead><tr><th>Date</th><th>Event</th><th>Client</th><th>Venue</th><th>Status</th></tr></thead><tbody>';
      upcoming.forEach(e => {
        const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        tableHtml += `<tr onclick="openEventDetail('${e.id}')"><td>${date}</td><td>${e.name}</td><td>${e.clientName}</td><td>${e.venueName}</td><td><span class="badge badge-${e.status}">${e.status}</span></td></tr>`;
      });
      tableHtml += '</tbody></table>';
      document.getElementById('upcomingEventsContainer').innerHTML = upcoming.length ? tableHtml : '<div class="empty-state">No upcoming events. <button type="button" class="btn btn-secondary" style="margin-left:10px;" onclick="openNewEventModal()">Add an event</button></div>';

      let widgets = '';
      if (currentUser.role === 'dj') {
        widgets += '<div class="widget-card"><div class="widget-title">Your Upcoming Shows</div>';
        const nextShows = dashboardEvents.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 3);
        if (nextShows.length) {
          nextShows.forEach(e => {
            const daysAway = Math.ceil((new Date(e.date) - now) / (1000 * 60 * 60 * 24));
            widgets += `<div style="padding: 15px; background: var(--black-4); border-radius: 6px; margin-bottom: 10px; cursor: pointer;" onclick="openEventDetail('${e.id}')">${e.name} - ${daysAway} days away</div>`;
          });
        } else {
          widgets += '<div class="empty-state">No upcoming shows. <button type="button" class="btn btn-secondary" style="margin-left:10px;" onclick="openNewEventModal()">Add an event</button></div>';
        }
        widgets += '</div>';
      } else {
        widgets += _renderTasksCard();
        widgets += '<div class="widget-card"><div class="widget-title">South Florida Weather</div><div class="weather-placeholder">Weather data loads when deployed with API integration. Current conditions for Miami, FL will appear here.</div></div>';
        widgets += `<div class="widget-card"><div class="widget-title">Availability Checker</div>
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
            <div><label style="font-size:12px;color:var(--gray);display:block;margin-bottom:4px;" for="dashAvailDate">Check a Date</label><input type="date" id="dashAvailDate" class="form-input" style="width:auto;"></div>
            <button class="btn btn-secondary" onclick="dashCheckAvail()">Check</button>
          </div>
          <div id="dashAvailResult" style="margin-top:10px;"></div>
        </div>`;
        if (['master', 'admin'].includes(currentUser.role)) {
          widgets += '<div class="widget-card"><div class="widget-title">Industry News</div><div style="list-style: none;"><div style="padding: 10px; border-bottom: 1px solid var(--border);"><a href="#" style="color: var(--cyan); text-decoration: none;">Billboard Hot 100 - Updated Weekly</a></div><div style="padding: 10px; border-bottom: 1px solid var(--border);"><a href="#" style="color: var(--cyan); text-decoration: none;">DJ Mag Top 100 - Annual Rankings</a></div><div style="padding: 10px;"><a href="#" style="color: var(--cyan); text-decoration: none;">Event Industry News - Connect with industry.org</a></div></div></div>';
        }
      }

      const nextEvent = dashboardEvents.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
      if (nextEvent) {
        widgets += '<div class="widget-card"><div class="widget-title">Next Event Checklist</div>';
        widgets += `<div style="margin-bottom: 15px;">Next Up: <strong>${nextEvent.name}</strong> - ${Math.ceil((new Date(nextEvent.date) - now) / (1000 * 60 * 60 * 24))} days away</div>`;
        const checklist = nextEvent.checklist || { soundCheck: false, timelineSent: false, depositReceived: false, equipmentLoaded: false };
        const checks = [
          { key: 'soundCheck', label: 'Sound check confirmed' },
          { key: 'timelineSent', label: 'Timeline sent to client' },
          { key: 'depositReceived', label: 'Deposit received' },
          { key: 'equipmentLoaded', label: 'Equipment loaded' }
        ];
        checks.forEach(c => {
          widgets += `<label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer;"><input type="checkbox" ${checklist[c.key] ? 'checked' : ''} onchange="updateEventChecklist('${nextEvent.id}', '${c.key}', this.checked)">${c.label}</label>`;
        });
        widgets += '</div>';
      }

      document.getElementById('dashboardWidgets').innerHTML = widgets;

      const statuses = ['lead', 'proposal', 'negotiation', 'booked', 'confirmed', 'completed', 'cancelled'];
      let pillsHtml = '';
      statuses.forEach(status => {
        const count = dashboardEvents.filter(e => e.status === status).length;
        pillsHtml += `<div style="padding: 8px 12px; background: var(--black-3); border: 1px solid var(--border); border-radius: 20px; display: flex; gap: 8px; cursor: pointer;" onclick="switchSectionById('pipeline');setTimeout(()=>filterPipeline('${status}'),200)" title="View ${status} events"><span class="badge badge-${status}">${status}</span><strong>${count}</strong></div>`;
      });
      document.getElementById('pipelinePillsContainer').innerHTML = pillsHtml;
      document.getElementById('newEventBtn').style.display = 'block';
    }

    // dashCheckAvail — see unified checkAvailability() added above

    function updateEventChecklist(eventId, key, checked) {
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (event) {
        if (!event.checklist) event.checklist = { soundCheck: false, timelineSent: false, depositReceived: false, equipmentLoaded: false };
        event.checklist[key] = checked;
        setDB('events', events);
      }
    }

    // Count-up ticker for stat values
    function tickerCountUp(el, target, durationMs) {
      if (!el) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target; return; }
      const start = performance.now();
      function step(now) {
        const p = Math.min((now - start) / (durationMs || 800), 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * ease);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
