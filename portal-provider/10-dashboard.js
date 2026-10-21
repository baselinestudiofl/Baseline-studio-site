// ============================================================================
// portal-provider/10-dashboard.js  -  Home: Needs me, This week, Money, pipeline strip, tasks, availability check, weather chip
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A); Home redesigned by lane P1 (UI-PLAN 3.1).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// Only function declarations here (scope-check): helpers are prefixed _home / _needs so they cannot collide with other lanes.
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
        ...conflictEvents.map(e => ({ name: e.name, time: e.startTime ? `${e.startTime} to ${e.endTime||''}` : '', type: 'event', id: e.id })),
        ...conflictInqs.map(i => ({ name: i.name || i.email || 'Inquiry', type: 'inquiry', id: i.id }))
      ];
      const formatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
      if (!allConflicts.length) {
        result.innerHTML = `<div class="avail-result avail-free">${formatted} is open. No booked events.</div>`;
      } else {
        const links = allConflicts.map(c => {
          const detail = c.time ? ` (${c.time})` : '';
          const action = c.type === 'event' ? `openEventDetail('${c.id}')` : `openInquiry('${c.id}')`;
          return `<a href="#" onclick="event.preventDefault();${action}" style="color:var(--cyan);text-decoration:none;font-weight:600;">${esc(c.name)}${detail}</a>`;
        }).join(', ');
        result.innerHTML = `<div class="avail-result avail-busy">Conflict: ${links} already booked on this date.</div>`;
      }
    }

    function dashCheckAvail() {
      const el = document.getElementById('dashAvailDate');
      if (!el || !el.value) return;
      checkAvailability(el.value, 'dashAvailResult');
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

      const dateLabel = evDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      let caption;
      if (wx.precip >= 60) caption = `${dateLabel}: ${wx.hi}° and a solid chance of rain. Worth having a plan.`;
      else if (wx.precip >= 30) caption = `${dateLabel}: ${wx.hi}° and possible showers. Keep an eye on it.`;
      else caption = `${dateLabel}: ${wx.hi}° and clear so far. We'll keep an eye on it.`;
      const tone = wx.precip >= 60 ? 'pill-danger' : wx.precip >= 30 ? 'pill-warn' : 'pill-ok';

      const chip = document.createElement('div');
      chip.id = 'weatherChip';
      chip.className = 'wx-chip';
      chip.innerHTML = `<div class="wx-main"><span class="wx-temp num">${wx.hi}° / ${wx.lo}°F</span><span class="pill ${tone} pill-sm" data-ui="pill">${wx.precip}% rain chance</span></div><div class="wx-cap">${esc(caption)}</div>`;

      const tabOverview = document.getElementById('tabOverview');
      if (tabOverview) tabOverview.insertBefore(chip, tabOverview.firstChild);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  HOME (UI-PLAN 3.1)
    //  Pure helpers first (no DOM, no globals except what is passed in) so harness/tests/needsme.test.mjs can run them in node.
    // ═════════════════════════════════════════════════════════════════════════

    // Whole days from today (local) to an ISO 'YYYY-MM-DD'. Negative = in the past. null when the date is missing or unparseable.
    function _homeDaysTo(iso, now) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      if (!m) return null;
      const n = now ? new Date(now) : new Date();
      const a = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      const b = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
      return Math.round((a - b) / 86400000);
    }

    // Milliseconds from a number, a numeric string, or a date string. NaN when it is none of those.
    function _homeMs(v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && /^\d{9,}$/.test(v.trim())) return Number(v);
      return v ? Date.parse(v) : NaN;
    }

    // '5m', '3h', '2d' (age or duration)
    function _homeAge(ms) {
      const m = Math.max(0, Math.floor(ms / 60000));
      if (m < 60) return Math.max(1, m) + 'm';
      const h = Math.floor(m / 60);
      if (h < 48) return h + 'h';
      return Math.floor(h / 24) + 'd';
    }

    // '$4,250.00' (L7). cents:false drops the cents for column headers.
    function _homeMoney(n, cents) {
      const v = Number(n);
      if (!isFinite(v)) return '$0.00';
      const withCents = cents !== false;
      return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: withCents ? 2 : 0, maximumFractionDigits: withCents ? 2 : 0 });
    }

    function _homeFirst(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }

    function _homeInvOpen(inv) {
      const s = String((inv && inv.status) || '').toLowerCase();
      return !!inv && s !== 'paid' && s !== 'void' && s !== 'cancelled' && s !== 'draft';
    }

    function _homeInvKind(inv) {
      const d = String(((inv.lines || [])[0] || {}).desc || '');
      if (/deposit/i.test(d)) return 'Deposit';
      if (/balance/i.test(d)) return 'Balance';
      return 'Invoice';
    }

    function _homeEventLive(e) {
      return !!e && !e.archived && ['cancelled', 'completed', 'ghosted'].indexOf(e.status) < 0;
    }

    // Four things that make an event ready: signed contract, deposit in, timeline built, planning form done.
    function _homeReadiness(ev, invoices) {
      const docs = (ev && ev.docs) || [];
      const signed = docs.some(d => d && d.requiresSignature && (d.clientSignature || d.clientSignedAt));
      const paid = !!(ev && ev.depositPaid === true) || (invoices || []).some(i => i && i.eventId === ev.id && i.status === 'paid' && /deposit/i.test(String(((i.lines || [])[0] || {}).desc || '')));
      const timeline = !!(ev && (ev.timeline || []).length);
      const form = !!(ev && ev.onboardingComplete === true);
      const checks = [['Contract', signed], ['Deposit', paid], ['Timeline', timeline], ['Form', form]];
      return { done: checks.filter(c => c[1]).length, total: checks.length, missing: checks.filter(c => !c[1]).map(c => c[0]) };
    }

    // The ranked list behind "Needs me" (UI-PLAN 3.1). Pure. Returns items sorted by tier (now, today, week), then date.
    // Each item: { kind, tier, key, who, title, sub, action, eventId, invoiceId, inquiryId, taskId, when }
    // kinds: inquiry, overdue, due, payment, contract, form, timeline, messages, task. Rules 1 to 4 are owner side only (opts.role 'dj' skips them).
    function _needsMe(events, invoices, inquiries, tasks, opts) {
      opts = opts || {};
      const now = opts.now ? new Date(opts.now) : new Date();
      const nowMs = now.getTime();
      const dj = opts.role === 'dj';
      const notes = opts.notes || {};
      const evById = {};
      (events || []).forEach(e => { if (e) evById[e.id] = e; });
      const out = [];
      const push = it => { it.key = it.kind + ':' + (it.invoiceId || it.inquiryId || it.taskId || it.eventId); out.push(it); };
      const dateMs = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Infinity; };

      // Rule 1: a new inquiry nobody has answered
      if (!dj) (inquiries || []).forEach(inq => {
        if (!inq || (inq.status && inq.status !== 'new')) return;
        if (inq.repliedAt || String(notes[inq.id] || inq.notes || '').trim()) return;
        const born = _homeMs(inq.created_at);
        const age = isNaN(born) ? 0 : Math.max(0, nowMs - born);
        const type = inq.event_type ? ' · ' + inq.event_type : '';
        push({ kind: 'inquiry', tier: age > 3600000 ? 'now' : 'today', who: inq.name || 'New inquiry',
               title: (inq.name || 'New inquiry') + type, lead: inq.name || 'New inquiry', ctx: inq.event_type || '', sub: isNaN(born) ? 'No reply yet' : 'No reply for ' + _homeAge(age),
               action: 'Quote', inquiryId: inq.id, eventId: null, when: isNaN(born) ? nowMs : born });
      });

      // Rule 2b first: a client says they paid. It wins over the overdue/due row for the same invoice.
      const claimed = {};
      if (!dj) (events || []).forEach(ev => {
        const pr = ev && ev.clientNotes && ev.clientNotes.paymentReported;
        if (!pr || pr.confirmedAt || !_homeEventLive(ev)) return;
        // Only the invoice the client named counts. No guessing: an unnamed or unknown invoice becomes a "Review" row.
        const key = String(pr.invoice || '');
        const inv = key ? (invoices || []).find(i => i && i.eventId === ev.id && _homeInvOpen(i) && (String(i.invoiceNum || '') === key || String(i.id) === key)) : null;
        const at = _homeMs(pr.at);
        const rep = Number(pr.amount) > 0 ? Number(pr.amount) : 0;
        const who = _homeFirst(ev.clientName) || 'Client';
        const age = isNaN(at) ? '' : ', reported ' + _homeAge(nowMs - at) + ' ago';
        if (!inv) {
          if (key && (invoices || []).some(i => i && i.eventId === ev.id && String(i.invoiceNum || '') === key && !_homeInvOpen(i))) return; // that invoice is already settled
          push({ kind: 'payment', tier: 'today', who: ev.clientName || '', title: who + ' says ' + (rep ? _homeMoney(rep) + ' was sent' : 'a payment was sent'),
                 sub: 'Which invoice? Open Money to match it' + age, action: 'Review', eventId: ev.id, invoiceId: null, reported: rep, total: 0, exact: false, when: isNaN(at) ? nowMs : at });
          return;
        }
        claimed[inv.id] = true;
        const total = Number(inv.total) || 0;
        const exact = rep > 0 && Math.round(rep * 100) === Math.round(total * 100);
        push({ kind: 'payment', tier: 'today', who: ev.clientName || '', title: who + ' says ' + (rep ? _homeMoney(rep) + ' was sent' : 'a payment was sent'),
               sub: (inv.invoiceNum || 'Invoice') + (exact ? ': confirm it arrived' : ' is ' + _homeMoney(total) + '. Check the amount') + age,
               action: 'Confirm', eventId: ev.id, invoiceId: inv.id, reported: rep, total: total, exact: exact, when: isNaN(at) ? nowMs : at });
      });

      // Rule 2: unpaid invoices that are late or due inside 7 days
      if (!dj) (invoices || []).forEach(inv => {
        if (!_homeInvOpen(inv) || claimed[inv.id] || !inv.dueDate) return;
        const ev = evById[inv.eventId];
        if (ev && !_homeEventLive(ev)) return;
        const d = _homeDaysTo(inv.dueDate, now);
        if (d === null || d > 7) return;
        const label = _homeInvKind(inv), amt = _homeMoney(inv.total);
        const who = inv.clientName || (ev && ev.clientName) || 'Client';
        const ctx = inv.eventName || (ev && ev.name) || '';
        if (d < 0) push({ kind: 'overdue', tier: 'now', who: who, title: who + (ctx ? ' · ' + ctx : ''), lead: who, ctx: ctx, sub: label + ' ' + amt + ' late ' + (-d) + 'd',
                          action: 'Mark paid', eventId: inv.eventId || null, invoiceId: inv.id, when: dateMs(inv.dueDate) });
        else push({ kind: 'due', tier: d === 0 ? 'today' : 'week', who: who, title: who + (ctx ? ' · ' + ctx : ''), lead: who, ctx: ctx, sub: label + ' ' + amt + (d === 0 ? ' due today' : ' due in ' + d + 'd'),
                   action: 'Remind', eventId: inv.eventId || null, invoiceId: inv.id, when: dateMs(inv.dueDate) });
      });

      (events || []).forEach(ev => {
        if (!_homeEventLive(ev)) return;
        const d = _homeDaysTo(ev.date, now);
        if (d === null || d < 0) return;
        const bookedOrConfirmed = ev.status === 'booked' || ev.status === 'confirmed';
        const ctx = (ev.clientName || 'Client') + ' · ' + (ev.name || 'Event');
        const lead = ev.clientName || 'Client', evName = ev.name || 'Event';
        // Rule 3: a shared contract that needs a signature and has none, event inside 60 days
        if (!dj && d <= 60 && (ev.docs || []).some(x => x && x.sharedWithClient && x.requiresSignature && !(x.clientSignature || x.clientSignedAt))) {
          push({ kind: 'contract', tier: d <= 14 ? 'today' : 'week', who: ev.clientName || '', title: ctx, lead: lead, ctx: evName, sub: 'Contract unsigned, event in ' + d + 'd', action: 'Resend', eventId: ev.id, when: dateMs(ev.date) });
        }
        // Rule 4: planning form not started, event inside 30 days
        if (!dj && bookedOrConfirmed && d <= 30 && ev.onboardingComplete !== true) {
          push({ kind: 'form', tier: d <= 14 ? 'today' : 'week', who: ev.clientName || '', title: ctx, lead: lead, ctx: evName, sub: 'Planning form not started, event in ' + d + 'd', action: 'Nudge', eventId: ev.id, when: dateMs(ev.date) });
        }
        // Rule 5: nothing on the timeline, event inside 14 days
        if (bookedOrConfirmed && d <= 14 && !(ev.timeline || []).length) {
          push({ kind: 'timeline', tier: 'today', who: ev.clientName || '', title: ctx, lead: lead, ctx: evName, sub: 'No timeline, event in ' + d + 'd', action: 'Open', eventId: ev.id, when: dateMs(ev.date) });
        }
        // Rule 6: client messages nobody has read
        const unread = (ev.messages || []).filter(m => m && m.from === 'client' && !m.read);
        if (unread.length) {
          const first = unread.reduce((a, m) => { const t = _homeMs(m.ts); return isNaN(t) ? a : Math.min(a, t); }, nowMs);
          push({ kind: 'messages', tier: 'today', who: ev.clientName || '', title: ctx, lead: lead, ctx: evName, sub: unread.length + ' unread message' + (unread.length === 1 ? '' : 's'), action: 'Reply', eventId: ev.id, when: first });
        }
      });

      // Rule 7: open tasks (the automation engine writes these)
      (tasks || []).forEach(t => {
        if (!t || t.completed) return;
        const evt = t.eventId ? evById[t.eventId] : null;
        const who = t.leadName || t.eventName || (evt && evt.name) || '';
        const made = _homeMs(t.createdAt);
        push({ kind: 'task', tier: 'week', who: who, title: t.description || 'Task', sub: who, action: 'Done', taskId: t.id, eventId: t.eventId || null, when: isNaN(made) ? nowMs : made });
      });

      const tierRank = { now: 0, today: 1, week: 2 };
      const kindRank = { payment: 0, overdue: 1, inquiry: 2, due: 3, messages: 4, contract: 5, timeline: 6, form: 7, task: 8 };
      out.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (a.when - b.when) || ((kindRank[a.kind] || 9) - (kindRank[b.kind] || 9)));
      return out;
    }

    // Money numbers for the side card: received this month, due in the next 30 days, outstanding (with how many are late).
    function _homeMoneyStats(invoices, transactions, now) {
      const n = now ? new Date(now) : new Date();
      const y = n.getFullYear(), mo = n.getMonth();
      const inMonth = v => { const t = _homeMs(v); if (isNaN(t)) return false; const d = new Date(t); return d.getFullYear() === y && d.getMonth() === mo; };
      let received = 0;
      const seen = {};
      (transactions || []).forEach(t => {
        if (!t || !inMonth(t.date !== undefined ? t.date : t.createdAt)) return;
        received += Number(t.amount) || 0;
        if (t.invoiceId) seen[t.invoiceId] = true;
        if (t.invoiceNum) seen[t.invoiceNum] = true;
        if (t.note) seen[t.note] = true;
      });
      (invoices || []).forEach(i => {
        if (!i || i.status !== 'paid' || !inMonth(i.paidAt) || seen[i.id] || seen[i.invoiceNum]) return;
        received += Number(i.total) || 0;
      });
      let due30 = 0, outstanding = 0, late = 0;
      (invoices || []).forEach(i => {
        if (!_homeInvOpen(i)) return;
        const total = Number(i.total) || 0;
        outstanding += total;
        const d = _homeDaysTo(i.dueDate, n);
        if (d !== null && d < 0) late++;
        else if (d !== null && d <= 30) due30 += total;
      });
      return { received: received, due30: due30, outstanding: outstanding, late: late };
    }

    // Median minutes from an inquiry arriving to the first sign of a reply. Uses repliedAt when a row has it, else the moment the
    // recorded stage left 'new' (inquiryStages), ignoring first sightings (those are stamped with created_at, so they read as zero).
    function _homeFirstReply(inquiries, stageMap, now) {
      const nowMs = now ? new Date(now).getTime() : Date.now();
      const spans = [];
      (inquiries || []).forEach(i => {
        if (!i) return;
        const born = _homeMs(i.created_at);
        if (isNaN(born) || nowMs - born > 60 * 86400000) return;
        let at = _homeMs(i.repliedAt);
        if (isNaN(at)) {
          const rec = (stageMap || {})[i.id];
          if (rec && rec.status && rec.status !== 'new') at = _homeMs(rec.at);
        }
        if (!isNaN(at) && at - born > 60000) spans.push(at - born);
      });
      if (!spans.length) return null;
      spans.sort((a, b) => a - b);
      const mid = spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2;
      return { ms: mid, n: spans.length };
    }

    function _homeSpan(ms) {
      const m = Math.round(ms / 60000);
      if (m < 60) return m + ' min';
      const h = Math.floor(m / 60), r = m % 60;
      if (h < 24) return h + 'h' + (r ? ' ' + r + 'm' : '');
      return Math.round(h / 24) + ' days';
    }

    // ── Home: rendering ───────────────────────────────────────────────────────
    function _homeIcon(name, size) { return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(name, size || 20) : ''; }
    function _homeActive() { const s = document.getElementById('dashboard'); return !!(s && s.classList.contains('active')); }

    // Tasks written by automation rules (key 'tasks'). Kept by name: simulate-dedupe reads text + linked name from this output,
    // and the automation engine swaps #dashTasksCard with this function's result. Rendered as the rule-7 rows of Needs me.
    function _renderTasksCard() {
      const all = Array.isArray(getDB('tasks')) ? getDB('tasks') : [];
      let open = all.filter(t => !t.completed);
      // A DJ only sees tasks that belong to an event they work. Lead tasks and tasks with no event stay with the owner.
      const me = (typeof BSPortal !== 'undefined' && BSPortal.getCurrentUser) ? BSPortal.getCurrentUser() : null;
      if (me && me.role === 'dj') {
        const mine = {};
        (getDB('events') || []).forEach(e => { if (e && (e.staff || []).includes(me.id)) mine[e.id] = true; });
        open = open.filter(t => t.eventId && mine[t.eventId]);
      }
      const nameFor = t => t.leadName || t.eventName
        || (((window._inquiries || []).find(i => i.id === t.leadId) || {}).name)
        || (((getDB('events') || []).find(e => e.id === t.eventId) || {}).name) || '';
      if (!open.length) return '<div id="dashTasksCard" class="home-tasks" hidden></div>';
      const SHOW = 5;
      const shown = open.slice(0, SHOW);
      let h = '<div id="dashTasksCard" class="home-tasks"><div class="section-label home-sub">Tasks (' + open.length + ')</div><div class="row-list">';
      shown.forEach(t => {
        const who = nameFor(t);
        const when = t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        h += `<div class="row row-task" data-needs="task" data-task="${esc(t.id)}">
          <span class="row-ic">${(window.CRMUI && CRMUI.icon) ? CRMUI.icon('circle', 20) : ''}</span>
          <div class="row-main"><span class="row-title task-text" data-user-content>${esc(t.description || 'Task')}</span><span class="row-sub">${who ? esc(who) : ''}${who && when ? ' · ' : ''}${esc(when)}</span></div>
          <div class="row-trail"><button type="button" class="btn btn-secondary btn-sm row-action" onclick="_homeTaskDone('${esc(t.id)}')">Done</button><span class="row-more-slot" aria-hidden="true"></span></div>
        </div>`;
      });
      h += '</div>';
      if (open.length > SHOW) h += '<div class="t-meta home-more">+ ' + (open.length - SHOW) + ' more tasks</div>';
      return h + '</div>';
    }

    // Optimistic: mark done now, undo from the toast.
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

    function _homeTaskDone(taskId) {
      toggleTaskDone(taskId, true);
      showUndoToast('Task done.', function() { toggleTaskDone(taskId, false); });
    }

    function _homeNeedsRow(it) {
      const urgent = it.tier === 'now';
      const ic = urgent ? ['circle-alert', 'is-danger'] : it.tier === 'today' ? ['clock', 'is-warn'] : ['circle', ''];
      const attrs = ' data-needs="' + it.kind + '"' + (it.eventId ? ' data-event="' + esc(it.eventId) + '"' : '') + (it.invoiceId ? ' data-inv="' + esc(it.invoiceId) + '"' : '') + (it.inquiryId ? ' data-inq="' + esc(it.inquiryId) + '"' : '') + (it.kind === 'payment' ? ' data-reported="' + (it.reported || 0) + '" data-exact="' + (it.exact ? '1' : '0') + '"' : '');
      const more = it.kind === 'overdue'
        ? `<button type="button" class="btn btn-ghost btn-icon row-more" aria-label="More for ${esc(it.who)}" aria-haspopup="menu" onclick="_homeAct(this,'more')">${_homeIcon('ellipsis-vertical', 20)}</button>` : '<span class="row-more-slot" aria-hidden="true"></span>';
      return `<div class="row row-task${urgent ? ' is-urgent' : ''}"${attrs}>
        <span class="row-ic ${ic[1]}">${_homeIcon(ic[0], 20)}</span>
        <button type="button" class="row-link row-main" onclick="_homeAct(this,'open')"><span class="row-title" data-user-content>${esc(it.lead || it.title)}${it.ctx ? `<span class="row-ctx"> · ${esc(it.ctx)}</span>` : ''}</span><span class="row-sub">${esc(it.sub)}</span></button>
        <div class="row-trail"><button type="button" class="btn btn-secondary btn-sm row-action" onclick="_homeAct(this,'primary')">${esc(it.action)}</button>${more}</div>
      </div>`;
    }

    function _homeNeedsCard(items, tasksHtml, openTasks, nextEvent, canAdd) {
      const ranked = items.filter(i => i.kind !== 'task');
      const CAP = 7;
      const all = !!window._homeNeedsAll;
      const shown = all ? ranked : ranked.slice(0, CAP);
      let body = '';
      if (ranked.length > 5) {
        const groups = [['now', 'Now'], ['today', 'Today'], ['week', 'This week']];
        groups.forEach(g => {
          const rows = shown.filter(i => i.tier === g[0]);
          if (rows.length) body += `<div class="section-label home-sub">${g[1]}</div><div class="row-list">${rows.map(_homeNeedsRow).join('')}</div>`;
        });
      } else if (shown.length) {
        body += `<div class="row-list">${shown.map(_homeNeedsRow).join('')}</div>`;
      }
      if (ranked.length > CAP) body += `<button type="button" class="btn btn-ghost btn-sm home-seeall" onclick="_homeToggleAll()">${all ? 'Show fewer' : 'See all ' + ranked.length}</button>`;
      if (!ranked.length && !openTasks) {
        const when = nextEvent ? 'Next event: ' + nextEvent.name + ', ' + _homeLongDate(nextEvent.date) + ', ' + (nextEvent._d === 0 ? 'today' : nextEvent._d === 1 ? 'tomorrow' : 'in ' + nextEvent._d + ' days') + '.' : 'No events on the calendar yet.';
        body += `<div class="empty home-empty">${_homeIcon('circle-check', 32)}<p class="empty-title">Nothing needs you right now</p><p class="empty-text" data-user-content>${esc(when)}</p>${canAdd ? '<button type="button" class="btn btn-secondary" onclick="openNewInquiry()">New inquiry</button>' : ''}</div>`;
      }
      body += tasksHtml;
      return `<section class="card home-card" id="homeNeeds" aria-labelledby="homeNeedsT"><div class="card-head"><h2 class="card-title" id="homeNeedsT">Needs me</h2>${ranked.length ? `<span class="home-count num">${ranked.length}</span>` : ''}</div>${body}</section>`;
    }

    function _homeLongDate(iso) {
      const d = new Date(String(iso || '') + 'T12:00:00');
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function _homeToggleAll() { window._homeNeedsAll = !window._homeNeedsAll; renderDashboard(); }

    // This week (next 7 days). When nothing is that close, the next four events, headed "Coming up".
    function _homeUpcoming(events, now) {
      const live = (events || []).filter(_homeEventLive).map(e => ({ e: e, d: _homeDaysTo(e.date, now) })).filter(x => x.d !== null && x.d >= 0).sort((a, b) => a.d - b.d || String(a.e.startTime || '').localeCompare(String(b.e.startTime || '')));
      const week = live.filter(x => x.d <= 6);
      return week.length ? { label: 'This week', list: week.slice(0, 8) } : { label: 'Coming up', list: live.slice(0, 4) };
    }

    function _homeWeekCard(x, invoices, showReady) {
      const e = x.e;
      const dt = new Date(String(e.date) + 'T12:00:00');
      const dow = dt.toLocaleDateString('en-US', { weekday: 'short' }), day = dt.getDate();
      const r = _homeReadiness(e, invoices);
      const cls = r.done === r.total ? 'chip-ok' : r.done === 0 ? 'chip-none' : 'chip-part';
      const rel = x.d === 0 ? 'Today' : x.d === 1 ? 'Tomorrow' : 'In ' + x.d + ' days';
      return `<div class="week-card" data-week-card data-event="${esc(e.id)}">
        <div class="week-top"><div class="date-block"><span class="dow">${esc(dow)}</span><span class="day">${day}</span></div><span class="week-rel">${esc(rel)}</span></div>
        <button type="button" class="row-link week-main" onclick="openEventDetail('${esc(e.id)}')"><span class="week-title" data-user-content>${esc(e.name || 'Event')}</span><span class="row-sub" data-user-content>${esc(e.venueName || e.clientName || '')}</span></button>
        ${showReady === false ? '' : `<span class="chip ${cls}" title="${r.missing.length ? 'Still needed: ' + esc(r.missing.join(', ')) : 'Everything is in'}">${r.done} of ${r.total} ready</span>
        <span class="t-meta week-need">${r.missing.length ? 'Needs ' + esc(r.missing.join(', ').toLowerCase()) : 'All set'}</span>`}
        <button type="button" class="btn btn-secondary btn-sm btn-dayof" onclick="_homeDayOf('${esc(e.id)}')">Day-of</button>
      </div>`;
    }

    function _homeMoneyCard(st) {
      const row = (label, hint, val, cls) => `<button type="button" class="money-row" onclick="switchSection('invoices')"><span class="money-label"><span class="money-name">${label}</span><span class="money-hint">${hint}</span></span><span class="money-num num${cls ? ' ' + cls : ''}">${_homeMoney(val)}</span></button>`;
      return `<section class="card home-card" aria-labelledby="homeMoneyT"><div class="card-head"><h2 class="card-title" id="homeMoneyT">Money</h2></div>
        ${row('Received this month', 'Payments logged since the 1st', st.received)}
        ${row('Due in 30 days', 'Unpaid and not late yet', st.due30)}
        ${row('Outstanding', st.late ? st.late + ' late' : 'Nothing late', st.outstanding, st.late ? 'is-late' : '')}
      </section>`;
    }

    function _homePipelineCard(events, inquiries, reply) {
      const stages = [['lead', 'Lead'], ['proposal', 'Proposal'], ['negotiation', 'Negotiation'], ['booked', 'Booked'], ['confirmed', 'Confirmed']];
      const live = (events || []).filter(e => !e.archived);
      const newInq = (inquiries || []).filter(i => !i.status || i.status === 'new').length;
      let chips = `<button type="button" class="chip" onclick="switchSection('pipeline')">Inquiries <strong class="num">${newInq}</strong></button>`;
      stages.forEach(s => { chips += `<button type="button" class="chip" onclick="_homeStage('${s[0]}')">${s[1]} <strong class="num">${live.filter(e => e.status === s[0]).length}</strong></button>`; });
      return `<section class="card home-card" aria-labelledby="homePipeT"><div class="card-head"><h2 class="card-title" id="homePipeT">Pipeline</h2></div>
        <div class="home-strip">${chips}</div>
        <div class="home-reply"><span class="money-name">Median first reply</span><span class="home-reply-val num">${reply ? _homeSpan(reply.ms) : 'No data yet'}</span></div>
      </section>`;
    }

    function renderDashboard() {
      const currentUser = BSPortal.getCurrentUser();
      if (!currentUser) return;
      const widgets = document.getElementById('dashboardWidgets');
      if (!widgets) return;
      const isDJ = currentUser.role === 'dj';
      const now = new Date();
      const allEvents = getDB('events') || [];

      // First paint before the data lands: a skeleton instead of a false "nothing needs you".
      if (!allEvents.length && !window._homeDataReady && window._sbDataReady && typeof window._sbDataReady.then === 'function') {
        if (window.CRMUI && CRMUI.skeleton) CRMUI.skeleton(widgets, 5, 'row');
        if (!window._homeWaiting) {
          window._homeWaiting = true;
          const go = function() { window._homeDataReady = true; if (_homeActive()) renderDashboard(); };
          window._sbDataReady.then(go, go);
        }
        return;
      }

      _homeWatch();
      if (typeof _leadFinalizeConvert === 'function') _leadFinalizeConvert();
      if (!isDJ) _homeLoadInquiries();

      const events = isDJ ? allEvents.filter(e => (e.staff || []).includes(currentUser.id)) : allEvents;
      const invoices = isDJ ? [] : (getDB('invoices') || []);
      const inquiries = isDJ ? [] : (window._inquiries || []);
      let tasks = Array.isArray(getDB('tasks')) ? getDB('tasks') : [];
      if (isDJ) { const mine = {}; events.forEach(e => { mine[e.id] = true; }); tasks = tasks.filter(t => t && t.eventId && mine[t.eventId]); }
      const notesMap = (function() { const m = getDB('inquiryNotes'); return Object.assign({}, window._inqNotes || {}, (m && !Array.isArray(m)) ? m : {}); })();
      const items = _needsMe(events, invoices, inquiries, tasks, { now: now, role: currentUser.role, notes: notesMap });
      const openTasks = items.filter(i => i.kind === 'task').length;
      const upcoming = _homeUpcoming(events, now);
      const nextEvent = (function() { const l = (events || []).filter(_homeEventLive).map(e => ({ e: e, d: _homeDaysTo(e.date, now) })).filter(x => x.d !== null && x.d >= 0).sort((a, b) => a.d - b.d)[0]; return l ? Object.assign({ _d: l.d }, l.e) : null; })();

      const home = document.getElementById('dashboard');
      if (home) home.classList.toggle('home-solo', isDJ);

      widgets.innerHTML = _homeNeedsCard(items, _renderTasksCard(), openTasks, nextEvent, !isDJ);

      const weekEl = document.getElementById('upcomingEventsContainer');
      if (weekEl) {
        weekEl.innerHTML = upcoming.list.length
          ? `<section class="home-week" aria-labelledby="homeWeekT"><div class="card-head"><h2 class="card-title" id="homeWeekT">${upcoming.label}</h2></div><div class="week-row">${upcoming.list.map(x => _homeWeekCard(x, invoices, !isDJ)).join('')}</div></section>`
          : '';
      }

      const statEl = document.getElementById('statCards');
      const pillEl = document.getElementById('pipelinePillsContainer');
      if (isDJ) {
        if (statEl) statEl.innerHTML = '';
        if (pillEl) pillEl.innerHTML = '';
      } else {
        if (statEl) statEl.innerHTML = _homeMoneyCard(_homeMoneyStats(invoices, getDB('transactions') || [], now));
        if (pillEl) pillEl.innerHTML = _homePipelineCard(events, inquiries, _homeFirstReply(inquiries, (typeof _stageMap === 'function' ? _stageMap() : {}), now));
      }
    }

    // Reload the inquiries the Needs-me rules read. They normally only load on the Pipeline page. Retries after 60 s, never loops.
    function _homeLoadInquiries() {
      if (window._homeInqBusy || typeof _fetchInquiryRows !== 'function') return;
      if (window._inquiries && !window._inqLoadedAt) { window._inqLoadedAt = Date.now(); return; } // loaded by the Pipeline or the automation engine
      if (window._inqLoadedAt && Date.now() - window._inqLoadedAt < 60000) return;
      window._homeInqBusy = true;
      _fetchInquiryRows(50).then(rows => { window._inquiries = rows; }, () => {}).then(function() {
        window._inqLoadedAt = Date.now();
        window._homeInqBusy = false;
        if (_homeActive()) renderDashboard();
      });
    }

    // Home stays correct without a reload: when invoices, events, tasks or transactions are saved anywhere (a Mark paid undo,
    // the automation engine, another tab syncing) and Home is on screen, repaint it once. Installed once, on first Home render.
    function _homeWatch() {
      if (window._homeWatching || typeof window.setDB !== 'function') return;
      window._homeWatching = true;
      const orig = window.setDB;
      window.setDB = function(key) {
        const r = orig.apply(this, arguments);
        const k = String(key).replace(/^bs_/, '');
        if (k === 'invoices' || k === 'events' || k === 'tasks' || k === 'transactions') {
          clearTimeout(window._homeRepaint);
          window._homeRepaint = setTimeout(function() { if (_homeActive()) renderDashboard(); }, 80);
        }
        return r;
      };
    }

    // ── Home: actions ─────────────────────────────────────────────────────────
    function _homeOpenEventTab(eventId, tab) {
      if (!eventId) return;
      window.location.hash = '#/event/' + encodeURIComponent(eventId) + (tab ? '/' + tab : '');
    }

    function _homeStage(status) { switchSection('pipeline'); if (typeof filterPipeline === 'function') filterPipeline(status); }

    function _homeDayOf(eventId) {
      if (typeof openDayOfSheet === 'function') { openDayOfSheet(eventId); return; }
      _homeOpenEventTab(eventId, 'timeline');
    }

    // Mark an invoice paid from Home. markInvoicePaid belongs to the Money lane; when it already offers an undo (_undoMarkPaid) we
    // leave the toast to it, otherwise we put the invoice back ourselves.
    function _homeMarkPaid(invId, fromReport) {
      const before = (getDB('invoices') || []).find(i => i.id === invId);
      if (!before) return;
      if (typeof markInvoicePaid !== 'function') { switchSection('invoices'); return; }
      const prev = { status: before.status, paidAt: before.paidAt };
      markInvoicePaid(invId, fromReport ? { fromReport: true } : undefined);
      if (typeof _undoMarkPaid === 'function') { if (_homeActive()) renderDashboard(); return; }
      showUndoToast('Marked ' + (before.invoiceNum || 'invoice') + ' paid.', function() {
        const invs = getDB('invoices') || [];
        const inv = invs.find(i => i.id === invId);
        if (inv) { inv.status = prev.status; if (prev.paidAt === undefined) delete inv.paidAt; else inv.paidAt = prev.paidAt; setDB('invoices', invs); }
        const tr = getDB('transactions') || [];
        for (let k = tr.length - 1; k >= 0; k--) { if (tr[k].note === before.invoiceNum && tr[k].type === 'Invoice Payment') { tr.splice(k, 1); break; } }
        setDB('transactions', tr);
      });
      if (_homeActive()) renderDashboard();
    }

    async function _homeConfirmSend(title, body, label, run) {
      // Fail closed: if the confirm dialog is not there, nothing is sent.
      if (!(window.CRMUI && CRMUI.confirm)) { showToast('Could not ask for confirmation, so nothing was sent.', 'error'); return; }
      const ok = await CRMUI.confirm({ title: title, body: body, confirmLabel: label });
      if (ok) run();
    }

    function _homeAct(btn, which) {
      const row = btn.closest('[data-needs]');
      if (!row) return;
      const kind = row.dataset.needs, ev = row.dataset.event || '', inv = row.dataset.inv || '', inq = row.dataset.inq || '';
      const evObj = (getDB('events') || []).find(e => e.id === ev) || {};
      const invObj = (getDB('invoices') || []).find(i => i.id === inv) || {};
      const to = evObj.portalEmail || evObj.clientEmail || invObj.clientEmail || '';
      if (which === 'more') {
        if (window.CRMUI && CRMUI.menu) CRMUI.menu(btn, [
          { label: 'Send reminder', icon: 'send', onSelect: function() { _homeConfirmSend('Send a reminder?', 'This emails ' + (invObj.invoiceNum || 'the invoice') + ' to ' + (invObj.clientEmail || 'the client') + ' again.', 'Send reminder', function() { sendInvoice(inv); }); } },
          { label: 'Open invoices', icon: 'receipt', onSelect: function() { switchSection('invoices'); } }
        ]);
        return;
      }
      if (which === 'open') {
        if (kind === 'inquiry') openInquiry(inq);
        else if (kind === 'overdue' || kind === 'due' || kind === 'payment') _homeOpenEventTab(ev, 'invoices');
        else if (kind === 'contract') _homeOpenEventTab(ev, 'documents');
        else if (kind === 'messages') _homeOpenEventTab(ev, 'messages');
        else if (kind === 'timeline') _homeOpenEventTab(ev, 'timeline');
        else _homeOpenEventTab(ev, '');
        return;
      }
      // primary action
      if (kind === 'inquiry') {
        const row2 = (window._inquiries || []).find(i => i.id === inq);
        if (typeof openQuoteBuilderModal === 'function' && row2) { _leadCloseSilent(); openQuoteBuilderModal(null, { inquiry: row2 }); } else openInquiry(inq);
      } else if (kind === 'payment') {
        // The reported amount is what the client said they sent. Mark paid books the invoice in full, so a mismatch is Saul's call.
        const rep = Number(row.dataset.reported) || 0;
        if (!inv) { _homeOpenEventTab(ev, 'invoices'); return; }
        // Money lane's recordInvoicePayment books exactly what the client reported (part paid if short), with its own undo toast.
        if (rep > 0 && typeof recordInvoicePayment === 'function') {
          const r = recordInvoicePayment(inv, rep, { fromReport: true, toast: true });
          if (!r || !r.ok) showToast('Could not record that payment' + (r && r.reason ? ': ' + r.reason : '') + '.', 'error');
          if (_homeActive()) renderDashboard();
          return;
        }
        if (row.dataset.exact === '1') { _homeMarkPaid(inv, true); return; }
        _homeConfirmSend('Mark ' + (invObj.invoiceNum || 'this invoice') + ' paid in full?', (rep ? 'The client reported ' + _homeMoney(rep) + ', ' : 'The client did not give an amount, ') + 'and the invoice is ' + _homeMoney(invObj.total) + '. Marking it paid books the full ' + _homeMoney(invObj.total) + '. You can undo it right after.', 'Mark paid in full', function() { _homeMarkPaid(inv, true); });
      } else if (kind === 'overdue') {
        _homeMarkPaid(inv);
      } else if (kind === 'due') {
        _homeConfirmSend('Send a reminder?', 'This emails ' + (invObj.invoiceNum || 'the invoice') + ' to ' + (invObj.clientEmail || 'the client') + '.', 'Send reminder', function() { sendInvoice(inv); });
      } else if (kind === 'contract') {
        _homeConfirmSend('Resend the portal link?', 'This emails the portal invite to ' + (to || 'the client') + '. They sign from there.', 'Send link', function() { sendPortalInvite(ev); });
      } else if (kind === 'form') {
        _homeConfirmSend('Nudge ' + (_homeFirst(evObj.clientName) || 'the client') + '?', 'This emails the portal invite to ' + (to || 'the client') + ' so they can fill in the planning form.', 'Send nudge', function() { sendPortalInvite(ev); });
      } else if (kind === 'timeline') {
        _homeOpenEventTab(ev, 'timeline');
      } else if (kind === 'messages') {
        _homeOpenEventTab(ev, 'messages');
      }
    }

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
