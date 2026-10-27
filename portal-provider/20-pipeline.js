// ============================================================================
// portal-provider/20-pipeline.js  -  pipeline: website inquiries, kanban stages, stage CTAs, drag and drop, lead import
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A); Pipeline redesigned by lane P1 (UI-PLAN 3.3).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// Only function declarations and literal consts at top level (scope-check). Helpers are prefixed _pipe / _lead.
// ============================================================================

    // Days in a stage before a card turns amber / red: [amber after, red after]
    const PIPE_STAGE_DAYS = { lead: [7, 14], proposal: [7, 14], negotiation: [7, 14], booked: [14, 30], confirmed: [30, 60] };

    // ── I: Pipeline filter (invoked from Home's pipeline strip) ──────────────
    // Phone: selects the stage chip. Desktop: flashes and scrolls to the column.
    function filterPipeline(status) {
      window._pipelineStatusFilter = status || null;
      renderPipeline();
      setTimeout(() => {
        const col = document.querySelector(`.kanban-column[data-status="${status}"]`);
        if (col && col.offsetParent !== null) {
          col.classList.add('is-flash');
          setTimeout(() => col.classList.remove('is-flash'), 1500);
          if (col.scrollIntoView) col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
      }, 100);
    }

    // Stage tone, label and phone-friendly helpers shared by the inbox, the lead sheet and the board.
    function _pipeTone(status) {
      return ({ new: 'pill-info', contacted: 'pill-warn', quoted: 'pill-violet', booked: 'pill-ok', converted: 'pill-ok', archived: 'pill-neutral', closed: 'pill-neutral',
                lead: 'pill-neutral', proposal: 'pill-warn', negotiation: 'pill-warn', confirmed: 'pill-ok', completed: 'pill-ok', cancelled: 'pill-danger', ghosted: 'pill-neutral' })[status] || 'pill-neutral';
    }
    function _pipeLabel(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function _pipeIcon(name, size) { return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(name, size || 20) : ''; }
    function _pipeIsPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches); }
    function _pipeDate(iso) {
      if (!iso) return '';
      if (window.CRMUI && CRMUI.fmt && CRMUI.fmt.date) { const t = CRMUI.fmt.date(iso, 'long'); if (t) return t; }
      return String(iso);
    }

    // What fires when something enters a stage, read from the rules list. '' when nothing is set up for it.
    // kind 'inquiry': pipeline rules { stage, trigger: 'enter' | 'after_days', action, label, days }. kind 'event': builder rules { trigger: { type: 'status_change', value } }.
    function _pipeStageNote(kind, stage, who) {
      const rules = (getDB('automations') || []).filter(r => r && r.enabled);
      const first = String(who || '').trim().split(/\s+/)[0] || 'them';
      const tidy = t => String(t || '').replace(/\{name\}/g, first).replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
      let hits;
      if (kind === 'inquiry') {
        hits = rules.filter(r => r.stage === stage && (r.trigger === 'enter' || r.trigger === 'after_days')).map(r => {
          const verb = r.action === 'email' ? 'send' : r.action === 'task' ? 'add the task' : 'run';
          const when = r.trigger === 'enter' || !(r.days > 0) ? 'right away' : 'in ' + r.days + ' day' + (r.days === 1 ? '' : 's');
          return { verb: verb, name: tidy(r.label), when: when };
        });
      } else {
        hits = rules.filter(r => r.trigger && typeof r.trigger === 'object' && r.trigger.type === 'status_change' && r.trigger.value === stage)
          .map(r => ({ verb: 'run', name: tidy(r.name || r.label), when: 'right away' }));
      }
      if (!hits.length) return '';
      const h = hits[0];
      return 'Will ' + h.verb + ' "' + h.name + '" ' + h.when + '.' + (hits.length > 1 ? ' (+' + (hits.length - 1) + ' more)' : '');
    }

    // ── Website Inquiries ─────────────────────────────────────────────────────
    // Shared by the Pipeline loader and the automation engine. Stamps stageEnteredAt on every row.
    async function _fetchInquiryRows(limit) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/inquiries?order=created_at.desc&limit=${limit}`, {
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + (window._sbToken || SUPABASE_ANON),
          'Content-Type': 'application/json'
        }
      });
      const rows = r.ok ? await r.json() : [];
      if (Array.isArray(rows) && rows.length) _applyStageTimes(rows);
      return Array.isArray(rows) ? rows : [];
    }

    // One row of the inbox. The whole row opens the lead; the trailing button repeats it for desktop pointers.
    function _pipeInquiryRow(inq) {
      const ret = isReturningClient(inq.email);
      const st = inq.status || 'new';
      const open = st === 'new' || st === 'contacted' || st === 'quoted';
      const ic = st === 'new' ? 'inbox' : open ? 'clock' : 'circle-check';
      const bits = [];
      if (ret) bits.push(`<span class="returning-badge">${_pipeIcon('undo-2', 12)} ${esc(ret.label)}</span>`);
      if (inq.event_type) bits.push(`<span class="pill pill-neutral pill-sm" data-ui="pill">${esc(inq.event_type)}</span>`);
      if (inq.event_date) bits.push(`<span class="inq-date">${esc(_pipeDate(inq.event_date))} ${daysUntilChip(inq.event_date)}</span>`);
      const where = [inq.venue, inq.services].filter(Boolean).join(' · ');
      if (where) bits.push(`<span data-user-content>${esc(where)}</span>`);
      return `<div class="row row-task inq-row" data-inquiry="${esc(inq.id)}">
        <span class="row-ic${st === 'new' ? ' is-warn' : ''}">${_pipeIcon(ic, 20)}</span>
        <button type="button" class="row-link row-main" onclick="openInquiry('${esc(inq.id)}')">
          <span class="row-title"><span data-user-content>${esc(inq.name || 'Unknown')}</span></span>
          <span class="row-sub inq-sub">${bits.join('<span class="inq-dot" aria-hidden="true"></span>')}</span>
        </button>
        <div class="row-trail">
          <span class="inq-stat"><span class="pill ${_pipeTone(st)} pill-sm" data-ui="pill">${esc(_pipeLabel(st))}</span><span class="t-meta" title="${esc(new Date(inq.created_at).toLocaleString())}">${esc(timeAgo(inq.created_at))}</span></span>
          <button type="button" class="btn btn-secondary btn-sm inq-open" onclick="openInquiry('${esc(inq.id)}')">Open</button>
          <span class="inq-chev" aria-hidden="true">${_pipeIcon('chevron-right', 20)}</span>
        </div>
      </div>`;
    }

    function _pipeInbox(rows) {
      const live = rows.filter(r => { const s = r.status || 'new'; return s === 'new' || s === 'contacted' || s === 'quoted'; });
      const done = rows.filter(r => live.indexOf(r) < 0);
      let h = live.length
        ? `<div class="row-list">${live.map(_pipeInquiryRow).join('')}</div>`
        : `<div class="empty inq-empty">${_pipeIcon('inbox', 32)}<p class="empty-title">No new inquiries</p><p class="empty-text">Website leads land here.</p></div>`;
      if (done.length) h += `<details class="inq-closed"><summary>Booked and archived <span class="pill pill-neutral pill-sm" data-ui="pill">${done.length}</span></summary><div class="row-list">${done.map(_pipeInquiryRow).join('')}</div></details>`;
      return h;
    }

    async function loadInquiries() {
      const container = document.getElementById('inquiriesContainer');
      if (!container) return;
      if (!window._inquiries) {
        if (window.CRMUI && CRMUI.skeleton) CRMUI.skeleton(container, 3, 'row');
        else container.innerHTML = '<div class="t-meta pad-y">Loading inquiries</div>';
      }

      try {
        const rows = await _fetchInquiryRows(50);
        // store for the detail sheet and for Home's Needs-me rules
        window._inquiries = rows;
        window._inqLoadedAt = Date.now();
        try { if (typeof _askLeadWatch === 'function') _askLeadWatch(); } catch (e) { /* Ask is optional */ }
        container.removeAttribute('aria-busy');
        container.innerHTML = rows.length
          ? _pipeInbox(rows)
          : `<div class="empty inq-empty">${_pipeIcon('inbox', 32)}<p class="empty-title">No new inquiries</p><p class="empty-text">Website leads land here.</p></div>`;
      } catch(e) {
        container.removeAttribute('aria-busy');
        container.innerHTML = `<div class="empty inq-empty">${_pipeIcon('circle-alert', 32)}<p class="empty-title">Could not load inquiries</p><p class="empty-text">Check the connection and try again.</p><button type="button" class="btn btn-secondary" onclick="loadInquiries()">Try again</button></div>`;
      }
    }

    // ── New inquiry (the + New menu and the Pipeline page action) ─────────────
    function openNewInquiry() {
      if (!(window.CRMUI && CRMUI.sheet)) { switchSection('pipeline'); return; }
      const types = ['Wedding', 'Quinceanera', 'Sweet 16', 'Bar/Bat Mitzvah', 'Corporate', 'Gala/Fundraiser', 'Birthday', 'Concert/Festival', 'Other'];
      const html = `<form id="newInquiryForm" onsubmit="return false" novalidate>
        <fieldset class="ni-group"><legend class="section-label">Who</legend>
          <div class="field"><label class="field-label" for="ni_name">Name</label><input class="input" id="ni_name" autocomplete="off" autocapitalize="words" enterkeyhint="next" data-autofocus></div>
          <div class="field"><label class="field-label" for="ni_email">Email</label><input class="input" id="ni_email" type="email" data-norm="email" autocomplete="off" enterkeyhint="next"></div>
          <div class="field"><label class="field-label" for="ni_phone">Phone</label><input class="input" id="ni_phone" type="tel" data-norm="phone" autocomplete="off" enterkeyhint="next"></div>
        </fieldset>
        <fieldset class="ni-group"><legend class="section-label">The event</legend>
          <div class="field"><label class="field-label" for="ni_type">Event type</label><select class="input" id="ni_type">${types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="ni_date">Event date</label><input class="input" id="ni_date" type="date"></div>
          <div class="field"><label class="field-label" for="ni_venue">Venue</label><input class="input" id="ni_venue" autocomplete="off" enterkeyhint="next"></div>
          <div class="field"><label class="field-label" for="ni_services">Services</label><input class="input" id="ni_services" autocomplete="off" placeholder="DJ, uplighting" enterkeyhint="next"></div>
        </fieldset>
        <fieldset class="ni-group"><legend class="section-label">Notes</legend>
          <div class="field"><label class="field-label" for="ni_msg">What they asked for</label><textarea class="input" id="ni_msg" rows="3"></textarea></div>
        </fieldset>
      </form>`;
      CRMUI.sheet({
        id: 'newInquirySheet', title: 'New inquiry', html: html,
        dirty: () => ['ni_name', 'ni_email', 'ni_phone', 'ni_venue', 'ni_services', 'ni_msg'].some(id => { const el = document.getElementById(id); return el && el.value.trim(); }),
        primary: { label: 'Add inquiry', onClick: _pipeSaveNewInquiry },
        secondary: { label: 'Cancel' }
      });
    }

    async function _pipeSaveNewInquiry() {
      const v = id => (document.getElementById(id) || {}).value || '';
      const fail = (id, msg) => {
        const el = document.getElementById(id);
        if (!el) return false;
        el.classList.add('is-error'); el.setAttribute('aria-invalid', 'true');
        let m = el.parentNode.querySelector('.field-msg');
        if (!m) { m = document.createElement('div'); m.className = 'field-msg'; el.parentNode.appendChild(m); }
        m.textContent = msg; el.focus();
        return false;
      };
      ['ni_name', 'ni_email', 'ni_phone'].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.remove('is-error'); el.removeAttribute('aria-invalid'); const m = el.parentNode.querySelector('.field-msg'); if (m) m.textContent = ''; } });
      const name = v('ni_name').trim();
      if (!name) return fail('ni_name', 'Add a name so you can find this lead later.');
      let email = v('ni_email').trim(), phone = v('ni_phone').trim();
      if (!email && !phone) return fail('ni_email', 'Add an email or a phone number.');
      if (window.CRMUI && CRMUI.norm) {
        if (email) { const r = CRMUI.norm.email(email); if (!r.ok) return fail('ni_email', r.message || 'That email does not look right.'); email = r.value || email; }
        if (phone) { const r = CRMUI.norm.phone(phone); if (!r.ok) return fail('ni_phone', r.message || 'That phone number does not look right.'); phone = r.echo || phone; }
      }
      const row = { name: name, email: email, phone: phone, event_type: v('ni_type'), event_date: v('ni_date'), venue: v('ni_venue').trim(), services: v('ni_services').trim(), message: v('ni_msg').trim().slice(0, 5000) };
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + (window._sbToken || SUPABASE_ANON), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(row)
        });
        if (!r.ok) { showToast('The inquiry was not saved (HTTP ' + r.status + '). What you typed is still here.', 'error'); return false; }
      } catch (err) {
        showToast('The inquiry was not saved. Check the connection. What you typed is still here.', 'error');
        return false;
      }
      window._inqLoadedAt = 0;
      showToast('Inquiry added for ' + name + '.', 'success');
      const active = document.querySelector('.section.active');
      if (active && active.id === 'pipeline') loadInquiries();
      else if (active && active.id === 'dashboard') { try { _homeLoadInquiries(); } catch (e) {} }
      else { try { await loadInquiries(); } catch (e) {} }
      return true;
    }

    // ── Lead sheet ─────────────────────────────────────────────────────────────
    function _leadStages() { return ['new', 'contacted', 'quoted', 'booked', 'archived']; }

    // Closes the lead sheet WITHOUT the router stepping back in history. closeModal('eventDetailModal') asks the router to
    // history.back(); the hashchange that follows used to close whatever modal opened next (BUGS.md #1, Convert to event).
    // Does nothing when the lead sheet is not open.
    function _leadCloseSilent() {
      const el = document.getElementById('eventDetailModal');
      if (!el || !el.classList.contains('active')) return;
      if (typeof _routeApplying === 'number') _routeApplying++;
      try { closeModal('eventDetailModal'); } finally { if (typeof _routeApplying === 'number') _routeApplying--; }
      if (typeof _routeWrite === 'function') _routeWrite({ type: 'section', id: 'pipeline' }, 'replace');
    }

    function openInquiry(id) {
      const inq = (window._inquiries || []).find(i => i.id === id);
      if (!inq) return;
      // Self-contained on purpose: test-route.js runs this function alone, so every helper is optional.
      const ico = (n, z) => (typeof _pipeIcon === 'function' ? _pipeIcon(n, z) : '');
      const tone = st => (typeof _pipeTone === 'function' ? _pipeTone(st) : 'pill-neutral');
      const lbl = st => String(st || '').charAt(0).toUpperCase() + String(st || '').slice(1);
      const dt = d => (typeof _pipeDate === 'function' ? _pipeDate(d) : String(d));
      const stages = ['new', 'contacted', 'quoted', 'booked', 'archived'];
      const cur = inq.status || 'new';
      const returning = isReturningClient(inq.email);
      const nm = getDB('inquiryNotes');
      const storedNotes = ((nm && !Array.isArray(nm)) ? nm[id] : '') || (window._inqNotes || {})[id] || inq.notes || '';
      // A lead that already became an event: link by id, else (converted by the quote builder) by client email and date.
      const evs = getDB('events') || [];
      const lk = getDB('inquiryLinks');
      const linkedId = (lk && !Array.isArray(lk)) ? lk[id] : '';
      const linked = evs.find(e => e && (e.id === linkedId || e.inquiryId === id))
        || (cur === 'converted' ? evs.find(e => e && inq.email && String(e.clientEmail || '').toLowerCase() === String(inq.email).toLowerCase() && (!inq.event_date || e.date === inq.event_date)) : null);
      const converted = cur === 'converted' || !!linked;
      const curIdx = Math.max(stages.indexOf(cur), 0);
      const pct = stages.length > 1 ? Math.round((curIdx / (stages.length - 1)) * 100) : 0;
      const contact = (href, icon, text) => `<a class="lead-contact" href="${href}">${ico(icon, 18)}<span data-user-content>${esc(text)}</span></a>`;
      const fact = (label, val) => `<div class="lead-fact"><span class="lead-k">${label}</span><span class="lead-v" data-user-content>${val}</span></div>`;
      document.getElementById('eventDetailContent').innerHTML = `
        <div class="lead-head">
          <h2 class="modal-title" data-user-content>${esc(inq.name || 'Inquiry')}</h2>
          <div class="lead-tags">
            ${inq.event_type ? `<span class="pill pill-neutral pill-sm" data-ui="pill">${esc(inq.event_type)}</span>` : ''}
            <span class="pill ${tone(cur)} pill-sm" data-ui="pill">${esc(lbl(cur))}</span>
            ${returning ? `<span class="returning-badge">${ico('undo-2', 12)} ${esc(returning.label)}</span>` : ''}
            <span class="t-meta" title="${esc(new Date(inq.created_at).toLocaleString())}">Received ${esc(timeAgo(inq.created_at))}</span>
          </div>
        </div>

        <div class="stage-stepper" id="stageStepper_${esc(id)}" role="group" aria-label="Stage">
          ${stages.map((s, i) => `<button type="button" class="stage-step${s === cur ? ' active' : i < curIdx ? ' past' : ''}" aria-pressed="${s === cur}" onclick="setInquiryStage('${esc(id)}','${s}')">${s}</button>`).join('')}
        </div>
        <div class="stage-progress"><div class="stage-progress-fill" style="width:${pct}%"></div></div>

        <div class="lead-contacts">
          ${inq.email ? contact('mailto:' + esc(inq.email) + '?subject=' + encodeURIComponent('Re: Your inquiry'), 'mail', inq.email) : ''}
          ${inq.phone ? contact('tel:' + esc(inq.phone), 'phone', inq.phone) : ''}
        </div>

        <div class="lead-facts">
          ${fact('Event date', inq.event_date ? esc(dt(inq.event_date)) + ' ' + daysUntilChip(inq.event_date) : 'Not set')}
          ${fact('Venue', inq.venue ? esc(inq.venue) : 'Not set')}
          ${inq.services ? fact('Services', esc(inq.services)) : ''}
        </div>

        ${inq.message ? `<div class="lead-block"><span class="lead-k">Message</span><p class="lead-msg" data-user-content>${esc(inq.message)}</p></div>` : ''}

        <div class="lead-block">
          <label class="lead-k" for="inqNotes">Notes</label>
          <textarea class="form-textarea" id="inqNotes" placeholder="Add notes about this inquiry" rows="3">${esc(storedNotes)}</textarea>
          <button type="button" class="btn btn-ghost btn-sm lead-save" onclick="saveInquiryWithNotes('${esc(id)}')">Save notes</button>
        </div>

        ${converted ? `<div class="lead-returning">${ico('circle-check', 16)}<span>${linked ? 'This lead is already an event: <strong data-user-content>' + esc(linked.name || 'Event') + '</strong>.' : 'This lead was already turned into an event.'}</span></div>` : ''}
        ${returning ? `<div class="lead-returning">${ico('undo-2', 16)}<span>This person has history with you${returning.eventName ? ': <strong data-user-content>' + esc(returning.eventName) + '</strong>' : ''}.${returning.eventId ? ` <a href="#" onclick="_leadCloseSilent();openEventDetail('${esc(returning.eventId)}');return false;">View their event</a>` : ''}</span></div>` : ''}

        <div class="lead-block lead-auto">
          <span class="lead-k">Automations</span>
          ${String(renderPendingAutomations(inq) + renderAutomationLog(inq.id)).replace(/\{name\}/g, esc(String(inq.name || 'them').trim().split(/\s+/)[0]))}
        </div>

        <div class="lead-foot">
          ${converted
            ? (linked ? `<button type="button" class="btn btn-primary" onclick="_leadOpenEvent('${esc(linked.id)}')">Open event</button>` : `<button type="button" class="btn btn-primary" onclick="_leadCloseSilent();switchSection('events')">Open Events</button>`)
            : `<button type="button" class="btn btn-primary" onclick="_leadQuote('${esc(id)}')">Quote</button>
          <button type="button" class="btn btn-secondary" onclick="convertInquiryToEvent('${esc(id)}')">Convert to event</button>`}
          ${typeof _askLeadButton === 'function' && !converted ? _askLeadButton(id) : ''}
          <button type="button" class="btn btn-secondary btn-icon lead-more" aria-label="Move to" aria-haspopup="menu" onclick="openLeadMoveMenu(this,'${esc(id)}')">${ico('ellipsis-vertical', 20)}</button>
        </div>`;

      _routeWrite({ type: 'lead', id: id }, 'push');
      openModal('eventDetailModal');
    }

    // Stage change from the stepper or the Move-to menu. Optimistic, with an Undo that names the automation that will fire.
    // A forward jump that skips stages with enabled rules goes through the stage-jump prompt (70-automations) instead.
    async function setInquiryStage(id, stage) {
      const lead = (window._inquiries || []).find(l => l.id === id);
      if (!lead) return;
      const prev = lead.status || 'new';
      if (prev === stage) return;
      const stages = _leadStages();
      const curIdx = stages.indexOf(prev), newIdx = stages.indexOf(stage);
      if (newIdx - curIdx > 1) {
        const between = stages.slice(curIdx + 1, newIdx);
        const hit = (getDB('automations') || []).some(r => r && r.enabled && between.indexOf(r.stage) > -1 && !(typeof _alreadyFired === 'function' && _alreadyFired(id, r.id)));
        if (hit) { await setInquiryStageWithCheck(id, stage); return; }
      }
      const prevAt = lead.stageEnteredAt;
      const snap = _stageMap()[id];
      const notesEl = document.getElementById('inqNotes');
      if (notesEl) { if (!window._inqNotes) window._inqNotes = {}; window._inqNotes[id] = notesEl.value; }
      lead.status = stage; lead.stageEnteredAt = new Date().toISOString();
      const modalOpen = () => { const m = document.getElementById('eventDetailModal'); return !!(m && m.classList.contains('active')); };
      if (modalOpen()) openInquiry(id);
      _pipeRefreshInbox();
      if (!(await saveInquiryStatus_silent(id, stage))) {
        lead.status = prev; lead.stageEnteredAt = prevAt;
        if (modalOpen()) openInquiry(id);
        _pipeRefreshInbox();
        showToast('Could not save the new stage. Check the connection and try again.', 'error');
        return;
      }
      const note = _pipeStageNote('inquiry', stage, lead.name);
      showUndoToast('Moved ' + (lead.name || 'the lead') + ' to ' + _pipeLabel(stage) + '.' + (note ? ' ' + note : ''), async function() {
        lead.status = prev; lead.stageEnteredAt = prevAt;
        await saveInquiryStatus_silent(id, prev);
        const m = _stageMap(); if (snap) m[id] = snap; else delete m[id]; setDB('inquiryStages', m); // put the stage clock back too
        if (modalOpen()) openInquiry(id);
        _pipeRefreshInbox();
      });
    }

    function _pipeRefreshInbox() {
      const c = document.getElementById('inquiriesContainer');
      if (c && window._inquiries) c.innerHTML = _pipeInbox(window._inquiries);
      if (typeof _homeActive === 'function' && _homeActive()) renderDashboard();
    }

    function openLeadMoveMenu(btn, id) {
      const lead = (window._inquiries || []).find(l => l.id === id);
      if (!lead || !(window.CRMUI && CRMUI.menu)) return;
      const cur = lead.status || 'new';
      const icons = { new: 'inbox', contacted: 'phone', quoted: 'file-text', booked: 'calendar-check', archived: 'ban' };
      CRMUI.menu(btn, _leadStages().filter(s => s !== cur).map(s => ({
        label: (s === 'archived' ? 'Archive' : 'Move to ' + _pipeLabel(s)), icon: icons[s], onSelect: function() { if (s === 'archived') archiveInquiry(id); else setInquiryStage(id, s); }
      })), { align: 'right' });
    }

    // Primary action of the lead sheet: the quote builder, prefilled from this inquiry (Money lane: openQuoteBuilderModal(null, {inquiry})).
    function _leadQuote(id) {
      const inq = (window._inquiries || []).find(i => i.id === id);
      if (!inq) return;
      if (inq.status === 'converted') { showToast('This lead is already an event.', 'info'); return; }
      if (typeof openQuoteBuilderModal !== 'function') { showToast('The quote builder is not available here yet.', 'warning'); return; }
      _leadCloseSilent();
      openQuoteBuilderModal(null, { inquiry: inq });
    }


    // Notes live in provider_data ('inquiryNotes', like inquiryStages) through setDB, so they survive a reload and never touch the lead's status.
    async function saveInquiryWithNotes(id) {
      const el = document.getElementById('inqNotes');
      if (!el) return;
      const cur = getDB('inquiryNotes');
      const map = (cur && !Array.isArray(cur)) ? Object.assign({}, cur) : {};
      map[id] = el.value;
      setDB('inquiryNotes', map);
      if (!window._inqNotes) window._inqNotes = {};
      window._inqNotes[id] = el.value;
      showToast('Notes saved', 'success');
      if (typeof _homeActive === 'function' && _homeActive()) renderDashboard();
    }

    async function archiveInquiry(id) {
      const inq = (window._inquiries||[]).find(i=>i.id===id);
      const prev = inq ? (inq.status || 'new') : 'new';
      const snap = _stageMap()[id];
      if (!(await saveInquiryStatus_silent(id, 'archived'))) { showToast('Could not archive. Check the connection and try again.', 'error'); return; }
      if (inq) inq.status = 'archived';
      _leadCloseSilent();
      loadInquiries();
      showUndoToast('Archived ' + ((inq && inq.name) || 'the inquiry') + '.', async function() {
        await saveInquiryStatus_silent(id, prev);
        const m = _stageMap(); if (snap) m[id] = snap; else delete m[id]; setDB('inquiryStages', m);
        if (inq) inq.status = prev;
        loadInquiries();
      });
    }

    async function saveInquiryStatus(id) {
      const inq = (window._inquiries||[]).find(i=>i.id===id);
      if (!inq) return;
      showToast('Status unchanged. Use the stage buttons to move a lead.', 'info');
    }

    // Fill the New event wizard from a lead. Fields are filled when they exist and are still empty, so it is safe to call twice.
    function _pipePrefillWizard(p) {
      const set = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value) el.value = val; };
      set('wizardEventName', p.name); set('wizardEventDate', p.date);
      set('wizardClientName', p.clientName); set('wizardClientEmail', p.clientEmail); set('wizardClientPhone', p.clientPhone);
      set('wizardVenueName', p.venueName);
      window.wizardData = Object.assign(window.wizardData || {}, p);
      if (p.type && p.type !== 'event' && typeof selectEventType === 'function') {
        const tile = Array.from(document.querySelectorAll('.event-type-tile')).find(t => (t.getAttribute('onclick') || '').indexOf("'" + p.type + "'") > -1);
        if (tile) selectEventType(p.type, tile);
      }
    }

    function convertInquiryToEvent(id) {
      const inq = (window._inquiries || []).find(i => i.id === id);
      if (!inq) return;
      // Once only: a lead that is already an event opens that event; a wizard that is already open ignores a second tap.
      const modal = document.getElementById('newEventModal');
      if (modal && modal.classList && typeof modal.classList.contains === 'function' && modal.classList.contains('active')) return;
      if (inq.status === 'converted') { showToast('This lead is already an event.', 'info'); return; }
      // Close the lead sheet without the router's history.back(): its hashchange used to close the wizard ~100 ms after it opened (BUGS.md #1).
      if (typeof _leadCloseSilent === 'function') _leadCloseSilent(); else closeModal('eventDetailModal');
      const _invType = (typeof BSContracts !== 'undefined') ? BSContracts.eventTypeFromText(inq.event_type) : '';

      // Seed wizard pre-fill data then open modal
      window.wizardPrefill = {
        // Use the inquiry's own type. No type: 'event' and flagged, so the owner picks one and the right contract is chosen.
        type:        _invType || 'event',
        typeNeedsReview: !_invType,
        name:        inq.name ? inq.name + '\'s Event' : '',
        date:        inq.event_date || '',
        clientName:  inq.name  || '',
        clientEmail: inq.email || '',
        clientPhone: inq.phone || '',
        venueName:   inq.venue || '',
        notes:       [inq.message, inq.services ? 'Services asked for: ' + inq.services : ''].filter(Boolean).join('\n\n'),
        status:      'lead'
      };
      // The lead is marked converted only when the wizard saves an event for this client (_leadFinalizeConvert), not when it opens.
      window._leadPending = { id: id, at: Date.now(), ids: (getDB('events') || []).map(e => e && e.id), email: String(inq.email || '').toLowerCase(), name: inq.name || '' };
      openNewEventModal();
      // Store in wizardData so saves pick it up, then fill the fields (again on the next tick for a wizard that renders late)
      window.wizardData = Object.assign(window.wizardData || {}, window.wizardPrefill);
      if (typeof _pipePrefillWizard === 'function') {
        _pipePrefillWizard(window.wizardPrefill);
        setTimeout(() => { _pipePrefillWizard(window.wizardPrefill); }, 150);
      }
      if (window.wizardPrefill.typeNeedsReview) showToast('This inquiry has no event type. Pick one in step 1 so the right contract is chosen.', 'warning');
    }

    // Called by renderDashboard / renderPipeline (the wizard calls both after it saves). Links the new event to the lead and marks it converted.
    function _leadFinalizeConvert() {
      const p = window._leadPending;
      if (!p) return;
      if (Date.now() - p.at > 30 * 60000) { window._leadPending = null; return; }
      const evs = getDB('events') || [];
      const ev = evs.find(e => e && p.ids.indexOf(e.id) < 0 && ((p.email && String(e.clientEmail || '').toLowerCase() === p.email) || (p.name && e.clientName === p.name)));
      if (!ev) return;
      window._leadPending = null;
      ev.inquiryId = p.id;
      setDB('events', evs);
      const lk = getDB('inquiryLinks');
      const map = (lk && !Array.isArray(lk)) ? Object.assign({}, lk) : {};
      map[p.id] = ev.id;
      setDB('inquiryLinks', map);
      const lead = (window._inquiries || []).find(i => i.id === p.id);
      if (lead) lead.status = 'converted';
      saveInquiryStatus_silent(p.id, 'converted');
      if (typeof _pipeRefreshInbox === 'function') _pipeRefreshInbox();
    }

    function _leadOpenEvent(eventId) { _leadCloseSilent(); openEventDetail(eventId); }

    async function saveInquiryStatus_silent(id, status) {
      if ((_stageMap()[id] || {}).status !== status) _recordStage(id, status); // persist stageEnteredAt for after_days
      const r = await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + (window._sbToken || SUPABASE_ANON),
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status })
      }).catch(()=>null);
      return !!(r && r.ok);
    }

    // ── Board ──────────────────────────────────────────────────────────────────
    // Phone chips map onto board columns; "lost" is cancelled + ghosted together.
    function _pipePhoneStages() {
      return [['lead', 'Lead'], ['proposal', 'Proposal'], ['negotiation', 'Negotiation'], ['booked', 'Booked'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['lost', 'Lost']];
    }

    function _pipeNextStep(ev, tasks) {
      const names = [ev.name, ev.clientName].filter(Boolean);
      const t = (tasks || []).find(x => x && !x.completed && (x.eventId === ev.id || (x.eventName && names.indexOf(x.eventName) > -1)));
      return t ? String(t.description || '').replace(/\s+/g, ' ').trim() : '';
    }

    function _pipeStageAge(ev) {
      const t = (typeof _homeMs === 'function') ? _homeMs(ev.stageAt) : NaN;
      if (isNaN(t)) return null;
      const days = Math.floor((Date.now() - t) / 86400000);
      const lim = PIPE_STAGE_DAYS[ev.status];
      const tone = lim ? (days > lim[1] ? 'is-danger' : days > lim[0] ? 'is-warn' : '') : '';
      return { days: days, tone: tone };
    }

    function _pipeCard(e, status, tasks) {
      const date = e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const age = _pipeStageAge(e);
      const next = _pipeNextStep(e, tasks);
      const active = ['lead', 'proposal', 'negotiation', 'booked', 'confirmed'].indexOf(status) > -1;
      const cta = getStageCTAs(status, e.id, e);
      return `<div class="kanban-card" data-event-id="${esc(e.id)}" draggable="true" ondragstart="dragStart(event)" ondragend="dragEnd(event)">
        <button type="button" class="kc-link" onclick="openEventDetail('${esc(e.id)}')"><span class="kanban-card-title" data-user-content>${esc(e.name)}</span></button>
        <div class="kanban-card-client" data-user-content>${esc(e.clientName)}</div>
        <div class="kc-meta"><span class="kanban-card-date">${_pipeIcon('calendar', 16)} ${esc(date)} ${daysUntilChip(e.date)}</span><span class="kanban-card-price num">${esc(_homeMoney(e.basePrice))}</span></div>
        ${age ? `<div class="kc-age t-meta ${age.tone}">${age.days} day${age.days === 1 ? '' : 's'} in stage</div>` : ''}
        ${active ? (next ? `<div class="kc-next" data-user-content>${_pipeIcon('chevron-right', 14)}<span>${esc(next)}</span></div>` : '<div class="kc-next is-none">No next step</div>') : ''}
        <div class="kc-foot">${cta}<button type="button" class="btn btn-ghost btn-icon btn-sm kc-more" aria-label="Move ${esc(e.name)} or more actions" aria-haspopup="menu" onclick="openPipeMenu(this,'${esc(e.id)}')">${_pipeIcon('ellipsis-vertical', 20)}</button></div>
      </div>`;
    }

    function _pipeColumn(status, list, tasks) {
      const sum = list.reduce((n, e) => n + (Number(e.basePrice) || 0), 0);
      const cards = list.length ? list.map(e => _pipeCard(e, status, tasks)).join('') : `<div class="kanban-empty">Nothing in ${_pipeLabel(status)} yet</div>`;
      return `<div class="kanban-column" data-status="${status}">
        <div class="kanban-header"><div class="kh-name"><span class="kh-dot ${_pipeTone(status)}"></span>${_pipeLabel(status)}</div><div class="kh-meta"><span class="kh-sum num">${esc(_homeMoney(sum))}</span><span class="kanban-count">${list.length}</span></div></div>
        <div class="kanban-items" data-status="${status}">${cards}</div>
      </div>`;
    }

    function renderPipeline() {
      const board = document.getElementById('kanbanBoard');
      if (!board) return;
      if (typeof _leadFinalizeConvert === 'function') _leadFinalizeConvert();
      const events = getDB('events') || [];
      const currentUser = BSPortal.getCurrentUser();
      const tasks = Array.isArray(getDB('tasks')) ? getDB('tasks') : [];
      let dashboardEvents = currentUser && currentUser.role === 'dj' ? events.filter(e => (e.staff||[]).includes(currentUser.id)) : events;

      // Hide archived events from pipeline
      dashboardEvents = dashboardEvents.filter(e => !e.archived);

      // Sort newest first by createdAt or date
      dashboardEvents = [...dashboardEvents].sort((a,b) => new Date(b.createdAt||b.date) - new Date(a.createdAt||a.date));

      // Page action: the one primary on this page
      const pa = document.getElementById('pageActions');
      const pipeActive = (document.getElementById('pipeline') || {}).classList && document.getElementById('pipeline').classList.contains('active');
      if (pa && pipeActive) pa.innerHTML = `<button type="button" class="btn btn-primary" onclick="openNewInquiry()">${_pipeIcon('plus', 16)} New inquiry</button>`;

      // Legend
      const legend = document.getElementById('pipelineLegend');
      if (legend) legend.innerHTML = ['lead', 'proposal', 'negotiation', 'booked', 'confirmed', 'completed', 'cancelled', 'ghosted']
        .map(s => `<span class="pill ${_pipeTone(s)} pill-sm" data-ui="pill">${_pipeLabel(s)}</span>`).join('');

      const main = ['lead', 'proposal', 'negotiation', 'booked', 'confirmed', 'completed'];
      const lost = ['cancelled', 'ghosted'];
      const by = s => dashboardEvents.filter(e => e.status === s);
      const lostCount = by('cancelled').length + by('ghosted').length;
      let html = main.map(s => _pipeColumn(s, by(s), tasks)).join('');
      html += `<div class="kanban-lost${window._pipeLostOpen ? ' is-open' : ''}" id="kanbanLost">
        <button type="button" class="kanban-lost-toggle" aria-expanded="${window._pipeLostOpen ? 'true' : 'false'}" onclick="_pipeToggleLost()"><span class="kanban-lost-label">Lost and archived</span><span class="kanban-count">${lostCount}</span></button>
        <div class="kanban-lost-cols">${lost.map(s => _pipeColumn(s, by(s), tasks)).join('')}</div>
      </div>`;
      board.innerHTML = html;
      board.querySelectorAll('.kanban-items').forEach(col => {
        col.addEventListener('dragover', dragOver);
        col.addEventListener('drop', drop);
      });

      // Phone: stage chips above a single-column card list (the board itself is a column list there)
      let chips = document.getElementById('pipeChips');
      if (!chips) { board.insertAdjacentHTML('beforebegin', '<div class="pipe-chips" id="pipeChips" role="group" aria-label="Pipeline stage"></div>'); chips = document.getElementById('pipeChips'); }
      const counts = {};
      _pipePhoneStages().forEach(s => { counts[s[0]] = s[0] === 'lost' ? lostCount : by(s[0]).length; });
      let sel = window._pipelineStatusFilter;
      if (sel === 'cancelled' || sel === 'ghosted') sel = 'lost';
      if (!sel || counts[sel] === undefined) { const f = _pipePhoneStages().find(s => counts[s[0]] > 0); sel = f ? f[0] : 'lead'; }
      chips.innerHTML = _pipePhoneStages().map(s => `<button type="button" class="chip${s[0] === sel ? ' is-selected' : ''}" data-stage="${s[0]}" aria-pressed="${s[0] === sel}" onclick="selectPipelineStage('${s[0]}')">${s[1]} <span class="num">${counts[s[0]]}</span></button>`).join('');
      _pipeMarkPhoneStage(sel);
    }

    function _pipeMarkPhoneStage(sel) {
      document.querySelectorAll('#kanbanBoard .kanban-column').forEach(c => {
        const s = c.dataset.status;
        c.classList.toggle('is-phone-active', s === sel || (sel === 'lost' && (s === 'cancelled' || s === 'ghosted')));
      });
    }

    function selectPipelineStage(status) {
      window._pipelineStatusFilter = status;
      document.querySelectorAll('#pipeChips .chip').forEach(c => { const on = c.dataset.stage === status; c.classList.toggle('is-selected', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      _pipeMarkPhoneStage(status);
    }

    function _pipeToggleLost() {
      window._pipeLostOpen = !window._pipeLostOpen;
      const el = document.getElementById('kanbanLost');
      if (el) { el.classList.toggle('is-open', window._pipeLostOpen); const b = el.querySelector('.kanban-lost-toggle'); if (b) b.setAttribute('aria-expanded', window._pipeLostOpen ? 'true' : 'false'); }
    }

    // Move an event to another stage: optimistic, Undo names the automation that fires. Saving 'events' runs _checkEventTriggers (99-boot).
    function _pipeMoveEvent(eventId, newStatus) {
      const events = getDB('events') || [];
      const ev = events.find(e => e.id === eventId);
      if (!ev || ev.status === newStatus) return;
      const prev = { status: ev.status, stageAt: ev.stageAt };
      ev.status = newStatus; ev.stageAt = Date.now();
      setDB('events', events);
      const note = _pipeStageNote('event', newStatus, ev.clientName);
      showUndoToast('Moved ' + (ev.name || 'the event') + ' to ' + _pipeLabel(newStatus) + '.' + (note ? ' ' + note : ''), function() {
        const evs = getDB('events') || [];
        const e2 = evs.find(e => e.id === eventId);
        if (!e2) return;
        e2.status = prev.status;
        if (prev.stageAt === undefined) delete e2.stageAt; else e2.stageAt = prev.stageAt;
        setDB('events', evs);
        renderPipeline();
      });
      renderPipeline();
    }

    function advancePipelineStage(eventId, newStatus) { _pipeMoveEvent(eventId, newStatus); }

    // The kebab on every card: Move to ... (and one extra action where the stage has a second step). Six items at most.
    function openPipeMenu(btn, eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev || !(window.CRMUI && CRMUI.menu)) return;
      const order = ['lead', 'proposal', 'negotiation', 'booked', 'confirmed', 'completed', 'cancelled', 'ghosted'];
      const i = order.indexOf(ev.status);
      const icons = { lead: 'inbox', proposal: 'file-text', negotiation: 'message-square', booked: 'calendar-check', confirmed: 'circle-check', completed: 'check', cancelled: 'ban', ghosted: 'circle' };
      const extras = [];
      if (ev.status === 'booked' && ev.depositPaid) { /* the card button is Portal invite */ }
      else if (ev.status === 'booked') extras.push({ label: 'Send portal invite', icon: 'send', onSelect: function() { sendPortalInvite(eventId); } });
      const prio = [order[i + 1], order[i - 1], 'cancelled', 'ghosted', 'completed', 'booked', 'lead'].filter((s, k, a) => s && s !== ev.status && a.indexOf(s) === k);
      const moves = prio.slice(0, 6 - extras.length).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      CRMUI.menu(btn, extras.concat(moves.map(s => ({ label: 'Move to ' + _pipeLabel(s), icon: icons[s], onSelect: function() { _pipeMoveEvent(eventId, s); } }))), { align: 'right' });
    }

    // ── Stage-specific CTA buttons for kanban cards (one per card) ────
    function getStageCTAs(status, eventId, ev) {
      const b = (label, fn, extra) => `<button type="button" class="btn btn-secondary btn-sm kc-cta${extra || ''}" onclick="${fn}">${label}</button>`;
      switch (status) {
        case 'lead':
          return b('Quote', `openQuoteBuilderModal('${eventId}')`);
        case 'proposal':
          return b('Follow up', `stageFollowUp('${eventId}')`);
        case 'negotiation':
          return b('Send contract', `stageSendContract('${eventId}')`);
        case 'booked':
          return ev && ev.depositPaid ? b('Portal invite', `sendPortalInvite('${eventId}')`) : b('Mark deposit paid', `stageCollectDeposit('${eventId}')`);
        case 'confirmed':
          return b('Send day-of', `stageSendDayOf('${eventId}')`);
        case 'completed':
          return b('Request review', `stageRequestReview('${eventId}')`);
        default:
          return '';
      }
    }

    // Every client email from a card asks first: who it goes to and what it says. Fails closed if the dialog is missing.
    async function _pipeConfirmEmail(title, email, subject, body) {
      if (!(window.CRMUI && CRMUI.confirm)) { showToast('Could not ask for confirmation, so nothing was sent.', 'error'); return false; }
      const preview = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      return CRMUI.confirm({ title: title, body: 'To ' + email + '. Subject: ' + subject + '. ' + preview + (String(body || '').length > 220 ? '...' : ''), confirmLabel: 'Send email' });
    }

    async function stageFollowUp(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.clientEmail || ev.portalEmail || '';
      const firstName = (ev.clientName || 'there').split(' ')[0];
      if (!email) { showToast('No client email. Add one in event details first.', 'warning'); return; }
      const eventDate = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'your event date';
      const body = `Hey ${firstName},\n\nJust wanted to follow up on the quote I sent over for your ${ev.type || 'event'} on ${eventDate}.\n\nHappy to answer any questions or adjust anything. What's your timeline for deciding?\n\nSaul\nBaseline Studio\n(786) 302-6056`;
      if (!(await _pipeConfirmEmail('Send the follow-up?', email, `Following up on ${ev.name || 'your event'}`, body))) return;
      const result = await BSPortal.sendEmail('generic', { email, clientName: ev.clientName || 'there', body, subject: `Following up on ${ev.name || 'your event'}`, marketing: true });
      if (result.ok && result.skipped === 'opted_out') {
        showToast(email + ' opted out of marketing email, so nothing was sent.', 'warning');
      } else if (result.ok) {
        showToast('Follow-up sent to ' + email, 'success');
      } else {
        showToast('The follow-up was not sent, so nothing went out. Try again in a moment.', 'error'); // fail closed: no manual fallback for marketing email
      }
    }

    function stageSendContract(eventId) {
      // Navigate to event detail and open the Documents tab
      navigateToEvent(eventId);
      setTimeout(() => {
        const docsBtn = document.querySelector('.tab-btn[onclick*="documents"]');
        if (docsBtn) docsBtn.click();
        // Auto-select a contract template if one exists
        const sel = document.getElementById('evtDocTemplate_' + eventId);
        if (sel) {
          const contractOption = Array.from(sel.options).find(o => /agreement|contract/i.test(o.text));
          if (contractOption) { sel.value = contractOption.value; showToast('Contract template ready. Click "+ From Template" to create it.', 'info'); }
        }
      }, 350);
    }

    function stageCollectDeposit(eventId) {
      navigateToEvent(eventId);
      setTimeout(() => {
        const cb = document.getElementById('editDepositPaid');
        if (cb && !cb.checked) { cb.focus(); showToast('Mark the deposit checkbox once payment is received.', 'info'); }
      }, 350);
    }

    async function stageSendDayOf(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.portalEmail || ev.clientEmail || '';
      const firstName = (ev.clientName || 'there').split(' ')[0];
      if (!email) { showToast('No client email. Add one in event details first.', 'warning'); return; }
      const eventDate = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'your event date';
      const timelineLines = (ev.timeline || []).map(t => `  ${t.time || ''}  ${t.label || ''}`).join('\n');
      const body = `Hey ${firstName},\n\nYour event is coming up. Here's where everything stands.\n\nDate: ${eventDate}\nVenue: ${ev.venueName || 'your venue'}\n${timelineLines ? '\nRun of Show:\n' + timelineLines + '\n' : ''}\nWe'll be onsite early for setup and sound check. If anything comes up between now and then, just text or call.\n\nSaul\nBaseline Studio\n(786) 302-6056`;
      if (!(await _pipeConfirmEmail('Send the day-of details?', email, `Day-of details for ${ev.name || 'your event'}`, body))) return;
      const result = await BSPortal.sendEmail('generic', { email, clientName: ev.clientName || 'there', body, subject: `Day-of details for ${ev.name || 'your event'}` });
      if (result.ok) {
        showToast('Day-of details sent to ' + email, 'success');
      } else {
        showEmailFallback(email, `Day-of details for ${ev.name || 'your event'}`, body, 'Could not send. Use this fallback:');
      }
    }

    async function stageRequestReview(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.portalEmail || ev.clientEmail || '';
      const firstName = (ev.clientName || 'there').split(' ')[0];
      if (!email) { showToast('No client email. Add one in event details first.', 'warning'); return; }
      const body = `Hey ${firstName},\n\nReally glad we got to be part of your ${ev.type || 'event'}. Hope the night was everything you wanted it to be.\n\nIf you have a minute, leaving us a Google review would mean a lot. It takes about 60 seconds and helps other clients find us:\n\nhttps://g.page/r/baselinestudiofl/review\n\nThanks for trusting us with your night.\n\nSaul\nBaseline Studio\n(786) 302-6056`;
      if (!(await _pipeConfirmEmail('Send the review request?', email, 'Thank you from Baseline Studio', body))) return;
      const result = await BSPortal.sendEmail('generic', { email, clientName: ev.clientName || 'there', body, subject: `Thank you from Baseline Studio`, marketing: true });
      if (result.ok && result.skipped === 'opted_out') {
        showToast(email + ' opted out of marketing email, so nothing was sent.', 'warning');
      } else if (result.ok) {
        showToast('Review request sent to ' + email, 'success');
      } else {
        showToast('The review request was not sent, so nothing went out. Try again in a moment.', 'error'); // fail closed: no manual fallback for marketing email
      }
    }
    // ─────────────────────────────────────────────────────────────────

    function toggleArchiveEvent(eventId, archive) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.archived = archive;
      setDB('events', events);
      showToast(archive ? 'Event archived. Turn on Show Archived in Events to find it.' : 'Event restored to active.', archive ? 'info' : 'success');
      renderPipeline();
      renderEvents();
      // Refresh event detail if open
      if (window.currentEvent && window.currentEvent.id === eventId) {
        window.currentEvent.archived = archive;
        document.getElementById('tabOverview') && (document.getElementById('tabOverview').innerHTML = renderEventOverview(window.currentEvent));
      }
    }

    let draggedCard = null;
    function dragStart(e) {
      if (_pipeIsPhone()) { e.preventDefault(); return; } // drag is desktop only; phones use the Move to menu
      draggedCard = e.target.closest('.kanban-card');
      if (draggedCard) draggedCard.classList.add('dragging');
    }
    function dragEnd(e) { if (draggedCard) draggedCard.classList.remove('dragging'); }
    function dragOver(e) { e.preventDefault(); }
    function drop(e) {
      e.preventDefault();
      const target = e.target.closest('.kanban-items');
      if (target && draggedCard) {
        const newStatus = target.dataset.status;
        const eventId = draggedCard.dataset.eventId;
        draggedCard.classList.remove('dragging');
        draggedCard = null;
        _pipeMoveEvent(eventId, newStatus);
      }
    }

    // Knot / WeddingWire paste import. Leads live in one place, the inquiries table, so this writes there
    // and the Pipeline picks it up. (It used to push into the legacy "leads" list.)
    async function importKnotLead() {
      const text = document.getElementById('knotiImportText').value.trim();
      if (!text) { showToast('Paste lead text first', 'warning'); return; }

      // Try to parse common patterns
      const nameMatch = text.match(/Name[:\s]+([^\n]+)/i);
      const emailMatch = text.match(/Email[:\s]+([^\s\n]+)/i);
      const phoneMatch = text.match(/Phone[:\s]+([^\n]+)/i);
      const dateMatch = text.match(/(?:Event\s*)?Date[:\s]+([^\n]+)/i);
      const guestMatch = text.match(/Guest[s\s]*(?:Count)?[:\s]+([^\n]+)/i);

      if (!nameMatch && !emailMatch) {
        showToast('Could not parse lead, check the format', 'warning');
        return;
      }

      const rawDate = dateMatch?.[1]?.trim() || '';
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const isoDate = (parsedDate && !isNaN(parsedDate.getTime()))
        ? parsedDate.getFullYear() + '-' + String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' + String(parsedDate.getDate()).padStart(2, '0')
        : '';
      const messageParts = ['Imported from WeddingWire / The Knot.'];
      if (rawDate && !isoDate) messageParts.push('Event date as written: ' + rawDate);
      if (guestMatch?.[1]?.trim()) messageParts.push('Guest count: ' + guestMatch[1].trim());
      messageParts.push('', text);

      const row = {
        name: (nameMatch?.[1] || 'New Lead').trim(),
        email: (emailMatch?.[1] || '').trim(),
        phone: (phoneMatch?.[1] || '').trim(),
        event_type: 'inquiry',
        event_date: isoDate,
        venue: '',
        services: '',
        message: messageParts.join('\n').slice(0, 5000)
      };

      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON,
            'Authorization': 'Bearer ' + (window._sbToken || SUPABASE_ANON),
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(row)
        });
        if (!r.ok) { showToast('Lead was not saved (HTTP ' + r.status + '). Your pasted text is still there.', 'error'); return; }
      } catch (err) {
        showToast('Lead was not saved: ' + (err && err.message ? err.message : 'network error') + '. Your pasted text is still there.', 'error');
        return;
      }
      document.getElementById('knotiImportText').value = '';
      try { loadInquiries(); } catch (e) {}
      showToast('Lead imported. It is in the Pipeline.', 'success');
    }
