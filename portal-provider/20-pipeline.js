// ============================================================================
// portal-provider/20-pipeline.js  -  pipeline: website inquiries, kanban stages, stage CTAs, drag and drop, lead import
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── I: Pipeline filter (invoked from dashboard status pills) ─────────────
    function filterPipeline(status) {
      window._pipelineStatusFilter = status || null;
      renderPipeline();
      // Highlight & scroll to the matching column
      setTimeout(() => {
        const col = document.querySelector(`.kanban-col[data-status="${status}"]`);
        if (col) { col.style.borderColor = 'var(--cyan)'; setTimeout(() => { col.style.borderColor = ''; }, 1500); col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }
      }, 100);
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

    async function loadInquiries() {
      const container = document.getElementById('inquiriesContainer');
      if (!container) return;
      container.innerHTML = '<div style="color:rgba(255,255,255,0.55);font-size:13px;padding:20px 0;">Loading…</div>';

      try {
        const rows = await _fetchInquiryRows(50);

        if (!rows.length) {
          container.innerHTML = '<div style="color:rgba(255,255,255,0.55);font-size:13px;padding:20px 0;">No inquiries yet — they\'ll appear here when someone submits the contact form.</div>';
          return;
        }

        const sColor = { new: 'var(--s-new)', contacted: 'var(--s-contacted)', quoted: 'var(--s-quoted)', booked: 'var(--s-booked)', archived: 'var(--s-archived)', converted: '#27ae60', closed: '#555' };

        container.innerHTML = `
          <div style="display:grid;gap:10px;">
            ${rows.map(inq => {
              const ret = isReturningClient(inq.email);
              const sc  = sColor[inq.status] || '#888';
              return `
              <div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px 18px;display:flex;align-items:center;gap:16px;cursor:pointer;transition:border-color .15s,background .15s;" onmouseenter="this.style.borderColor='rgba(31,163,224,0.4)';this.style.background='#141414'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.08)';this.style.background='#111'" onclick="openInquiry('${inq.id}')">
                <div style="flex:1;min-width:0;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
                    <span style="font-weight:600;font-size:14px;">${esc(inq.name || 'Unknown')}</span>
                    <span style="font-size:12px;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:20px;color:rgba(255,255,255,0.5);">${esc(inq.event_type || 'Inquiry')}</span>
                    <span style="font-size:12px;padding:2px 8px;border-radius:20px;color:${sc};background:${sc}22;">${esc(inq.status || 'new')}</span>
                    ${ret ? `<span class="returning-badge">↩ ${esc(ret.label)}</span>` : ''}
                  </div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.55);display:flex;gap:16px;flex-wrap:wrap;">
                    ${inq.email ? `<a href="mailto:${esc(inq.email)}" onclick="event.stopPropagation()" style="color:rgba(255,255,255,0.55);text-decoration:none;">✉ ${esc(inq.email)}</a>` : ''}
                    ${inq.phone ? `<a href="tel:${esc(inq.phone)}" onclick="event.stopPropagation()" style="color:rgba(255,255,255,0.55);text-decoration:none;">📞 ${esc(inq.phone)}</a>` : ''}
                    ${inq.event_date ? `<span>📅 ${esc(inq.event_date)} ${daysUntilChip(inq.event_date)}</span>` : ''}
                    ${inq.venue ? `<span>📍 ${esc(inq.venue)}</span>` : ''}
                  </div>
                  ${inq.services ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:3px;">Services: ${esc(inq.services)}</div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                  <span style="font-size:12px;color:var(--text-3);" title="${new Date(inq.created_at).toLocaleString()}">${timeAgo(inq.created_at)}</span>
                  <span style="color:var(--text-3);font-size:14px;">→</span>
                </div>
              </div>`;
            }).join('')}
          </div>`;

        // store for detail modal
        window._inquiries = rows;
      } catch(e) {
        container.innerHTML = '<div style="color:#f88;font-size:13px;padding:20px 0;">Could not load inquiries. Check Supabase connection.</div>';
      }
    }

    function openInquiry(id) {
      const inq = (window._inquiries || []).find(i => i.id === id);
      if (!inq) return;
      const stages = ['new','contacted','quoted','booked','archived'];
      const cur = inq.status || 'new';
      const returning = isReturningClient(inq.email);
      const storedNotes = (window._inqNotes || {})[id] || inq.notes || '';
      document.getElementById('eventDetailContent').innerHTML = `
        <div class="modal-title" style="display:flex;align-items:center;gap:12px;">
          ${esc(inq.name || 'Inquiry')}
          ${returning ? `<span class="returning-badge">↩ ${esc(returning.label)}</span>` : ''}
        </div>

        <div class="stage-stepper" id="stageStepper_${id}">
          ${stages.map((s,i) => {
            const curIdx = stages.indexOf(cur);
            const cls = s===cur?' active':i<curIdx?' past':'';
            return `<div class="stage-step${cls}" onclick="setInquiryStage('${id}','${s}')">${s}</div>`;
          }).join('')}
        </div>
        ${(()=>{ const curIdx=Math.max(stages.indexOf(cur),0); const pct=stages.length>1?Math.round((curIdx/(stages.length-1))*100):0; const dotPct=stages.length>1?curIdx/(stages.length-1)*100:0;
          return `<div class="stage-progress"><div class="stage-progress-fill" style="width:${pct}%"></div><div class="stage-progress-dot" style="left:calc(${dotPct}% - 6px)"></div></div>`; })()}

        <div class="grid-2" style="gap:14px;margin-bottom:16px;">
          <div>
            <label class="form-label">Name</label>
            <div style="color:#fff;font-size:14px;">${esc(inq.name||'—')}</div>
          </div>
          <div>
            <label class="form-label">Email</label>
            <div style="font-size:14px;">
              ${inq.email ? `<a href="mailto:${esc(inq.email)}" style="color:var(--cyan);text-decoration:none;">${esc(inq.email)}</a>` : '—'}
            </div>
          </div>
          <div>
            <label class="form-label">Phone</label>
            <div style="font-size:14px;">
              ${inq.phone ? `<a href="tel:${esc(inq.phone)}" style="color:var(--cyan);text-decoration:none;">${esc(inq.phone)}</a>` : '—'}
            </div>
          </div>
          <div><label class="form-label">Event Type</label><div style="color:#fff;font-size:14px;">${esc(inq.event_type||'—')}</div></div>
          <div><label class="form-label">Event Date</label><div style="color:#fff;font-size:14px;">${esc(inq.event_date||'—')} ${daysUntilChip(inq.event_date)}</div></div>
          <div><label class="form-label">Venue</label><div style="color:#fff;font-size:14px;">${esc(inq.venue||'—')}</div></div>
        </div>

        ${inq.services ? `<div style="margin-bottom:12px;"><label class="form-label">Services</label><div style="color:#fff;font-size:14px;">${esc(inq.services)}</div></div>` : ''}
        ${inq.message  ? `<div style="margin-bottom:12px;"><label class="form-label">Message</label><div style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(inq.message)}</div></div>` : ''}

        <div style="margin-bottom:12px;">
          <label class="form-label">Received</label>
          <div style="color:rgba(255,255,255,0.5);font-size:13px;" title="${new Date(inq.created_at).toLocaleString()}">${timeAgo(inq.created_at)}</div>
        </div>

        <div style="margin-bottom:20px;">
          <label class="form-label" for="inqNotes">Notes</label>
          <textarea class="form-textarea" id="inqNotes" placeholder="Add notes about this inquiry…" style="min-height:80px;">${storedNotes}</textarea>
        </div>

        ${returning ? `<div style="background:rgba(142,68,173,0.1);border:1px solid rgba(142,68,173,0.3);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#c39bd3;">
          ↩ This person has history with you${returning.eventName ? ` — <strong>${returning.eventName}</strong>` : ''}.
          ${returning.eventId ? `<a href="#" onclick="closeModal('eventDetailModal');openEventDetail('${returning.eventId}');return false;" style="color:var(--cyan);margin-left:6px;">View their event →</a>` : ''}
        </div>` : ''}

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
          <button class="btn btn-primary" onclick="saveInquiryWithNotes('${inq.id}')">Save</button>
          <button class="btn btn-primary" onclick="convertInquiryToEvent('${inq.id}')">+ Convert to Event</button>
          ${inq.email ? `<a href="mailto:${esc(inq.email)}?subject=Re: Your Inquiry" class="btn btn-secondary">✉ Email Client</a>` : ''}
          <button class="btn btn-secondary" onclick="archiveInquiry('${inq.id}')" style="border-color:rgba(231,76,60,0.75);color:#e74c3c;">Archive</button>
          <button class="btn btn-secondary" onclick="closeModal('eventDetailModal')">Close</button>
        </div>

        <!-- Automation timeline -->
        <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;margin-top:4px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:10px;">Automations</div>
          ${renderPendingAutomations(inq)}
          ${renderAutomationLog(inq.id)}
        </div>`;

      _routeWrite({ type: 'lead', id: id }, 'push');
      openModal('eventDetailModal');
    }

    async function setInquiryStage(id, stage) {
      await setInquiryStageWithCheck(id, stage);
    }

    async function saveInquiryWithNotes(id) {
      if (!window._inqNotes) window._inqNotes = {};
      const notes = document.getElementById('inqNotes')?.value || '';
      window._inqNotes[id] = notes;
      const status = document.querySelector('.stage-step.active')?.textContent.trim() || 'new';
      await saveInquiryStatus_silent(id, status);
      showToast('Saved', 'success');
    }

    async function archiveInquiry(id) {
      await saveInquiryStatus_silent(id, 'archived');
      const inq = (window._inquiries||[]).find(i=>i.id===id);
      if (inq) inq.status = 'archived';
      closeModal('eventDetailModal');
      loadInquiries();
      showToast('Inquiry archived', 'success');
    }

    async function saveInquiryStatus(id) {
      // J5: #inqStatusSel doesn't exist — use active stage step (same pattern as saveInquiryWithNotes)
      const status = document.querySelector('.stage-step.active')?.textContent.trim() || 'new';
      await saveInquiryStatus_silent(id, status);
      const inq = (window._inquiries||[]).find(i=>i.id===id);
      if (inq) inq.status = status;
      showToast('Status updated', 'success');
      closeModal('eventDetailModal');
      loadInquiries();
    }

    function convertInquiryToEvent(id) {
      const inq = (window._inquiries || []).find(i => i.id === id);
      if (!inq) return;
      closeModal('eventDetailModal');
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
        notes:       inq.message || '',
        status:      'lead'
      };
      openNewEventModal();

      // After modal renders, fill in what we can
      setTimeout(() => {
        const nameEl  = document.querySelector('#wizardStep1 input[id*="Name"], #wizardStep1 input[placeholder*="name" i]');
        const dateEl  = document.querySelector('#wizardStep1 input[type="date"]');
        if (nameEl) nameEl.value = window.wizardPrefill.name;
        if (dateEl) dateEl.value = window.wizardPrefill.date;
        const clientNameEl  = document.querySelector('#wizardStep2 input[id*="clientName"], #wizardStep2 input[placeholder*="name" i]');
        const clientEmailEl = document.querySelector('#wizardStep2 input[type="email"]');
        if (clientNameEl)  clientNameEl.value  = window.wizardPrefill.clientName;
        if (clientEmailEl) clientEmailEl.value = window.wizardPrefill.clientEmail;
        // Store in wizardData so saves pick it up
        window.wizardData = Object.assign(window.wizardData || {}, window.wizardPrefill);
        if (window.wizardPrefill.typeNeedsReview) showToast('This inquiry has no event type. Pick one in step 1 so the right contract is chosen.', 'warning');
      }, 150);

      saveInquiryStatus_silent(id, 'converted');
    }

    async function saveInquiryStatus_silent(id, status) {
      if ((_stageMap()[id] || {}).status !== status) _recordStage(id, status); // persist stageEnteredAt for after_days
      await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + (window._sbToken || SUPABASE_ANON),
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status })
      }).catch(()=>{});
    }

    function renderPipeline() {
      const events = getDB('events');
      const currentUser = BSPortal.getCurrentUser();
      let dashboardEvents = currentUser.role === 'dj' ? events.filter(e => (e.staff||[]).includes(currentUser.id)) : events;

      // Hide archived events from pipeline
      dashboardEvents = dashboardEvents.filter(e => !e.archived);

      // Sort newest first by createdAt or date
      dashboardEvents = [...dashboardEvents].sort((a,b) => new Date(b.createdAt||b.date) - new Date(a.createdAt||a.date));

      // Status color legend
      const legendColors = [
        { s:'lead',       c:'#888',    label:'Lead' },
        { s:'proposal',   c:'#f39c12', label:'Proposal' },
        { s:'negotiation',c:'#ff9800', label:'Negotiation' },
        { s:'booked',     c:'#27ae60', label:'Booked' },
        { s:'confirmed',  c:'#2ecc71', label:'Confirmed' },
        { s:'completed',  c:'#0d7a3a', label:'Completed' },
        { s:'cancelled',  c:'#e74c3c', label:'Cancelled' },
        { s:'ghosted',    c:'#9b59b6', label:'Ghosted' },
      ];
      document.getElementById('pipelineLegend') && (document.getElementById('pipelineLegend').innerHTML =
        legendColors.map(l=>`<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:3px 10px;border-radius:12px;background:${l.c}22;color:${l.c};">${l.label}</span>`).join(''));

      const statuses = ['lead', 'proposal', 'negotiation', 'booked', 'confirmed', 'completed', 'cancelled', 'ghosted'];
      const nextStatus = { lead:'proposal', proposal:'negotiation', negotiation:'booked', booked:'confirmed', confirmed:'completed' };
      let html = '';

      statuses.forEach(status => {
        const statusEvents = dashboardEvents.filter(e => e.status === status);
        html += `<div class="kanban-column" data-status="${status}">
          <div class="kanban-header"><div>${status}</div><div class="kanban-count">${statusEvents.length}</div></div>
          <div class="kanban-items" data-status="${status}">`;
        statusEvents.forEach(e => {
          const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const next = nextStatus[status];
          const advanceChip = next ? `<div class="kanban-advance-chip" role="button" tabindex="0" onclick="event.stopPropagation();advancePipelineStage('${e.id}','${next}')" style="display:none;position:absolute;bottom:8px;right:8px;font-size:12px;font-weight:700;padding:3px 8px;border-radius:10px;background:rgba(31,163,224,0.2);color:var(--cyan);border:1px solid rgba(31,163,224,0.3);cursor:pointer;white-space:nowrap;">→ ${next}</div>` : '';
          const stageCtaHtml = getStageCTAs(status, e.id, e);
          html += `<div class="kanban-card" role="button" tabindex="0" draggable="true" data-event-id="${e.id}" style="position:relative;" ondragstart="dragStart(event)" ondragend="dragEnd(event)" onclick="openEventDetail('${e.id}')" onmouseenter="this.querySelector('.kanban-advance-chip')&&(this.querySelector('.kanban-advance-chip').style.display='block')" onmouseleave="this.querySelector('.kanban-advance-chip')&&(this.querySelector('.kanban-advance-chip').style.display='none')">
            <div class="kanban-card-title">${esc(e.name)}</div>
            <div class="kanban-card-client">${esc(e.clientName)}</div>
            <div class="kanban-card-date">${date} ${daysUntilChip(e.date)}</div>
            <div class="kanban-card-footer"><div class="kanban-card-price">$${e.basePrice}</div></div>
            ${stageCtaHtml ? `<div class="stage-actions" onclick="event.stopPropagation()">${stageCtaHtml}</div>` : ''}
            ${advanceChip}
          </div>`;
        });
        if (!statusEvents.length) html += `<div style="padding:16px;color:var(--text-3);font-size:12px;text-align:center;">No ${status} leads</div>`;
        html += `</div></div>`;
      });

      document.getElementById('kanbanBoard').innerHTML = html;
      document.querySelectorAll('.kanban-items').forEach(col => {
        col.addEventListener('dragover', dragOver);
        col.addEventListener('drop', drop);
      });
      document.getElementById('newEventBtn').style.display = 'block';
    }

    function advancePipelineStage(eventId, newStatus) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.status = newStatus;
      setDB('events', events);
      showToast('Moved to ' + newStatus, 'success');
      renderPipeline();
    }

    // ── Stage-specific CTA buttons for kanban cards ───────────────────
    function getStageCTAs(status, eventId, ev) {
      const hasEmail = !!(ev && (ev.clientEmail || ev.portalEmail));
      switch (status) {
        case 'lead':
          return `<button class="stage-action-btn" onclick="openQuoteBuilderModal('${eventId}')">Send Quote</button>`;
        case 'proposal':
          return `<button class="stage-action-btn" onclick="stageFollowUp('${eventId}')">Follow Up</button>`;
        case 'negotiation':
          return `<button class="stage-action-btn" onclick="stageSendContract('${eventId}')">Send Contract</button>`;
        case 'booked':
          return `<button class="stage-action-btn${ev && ev.depositPaid ? ' success' : ''}" onclick="stageCollectDeposit('${eventId}')">${ev && ev.depositPaid ? '✓ Deposit Paid' : 'Mark Deposit Paid'}</button>
                  <button class="stage-action-btn" onclick="sendPortalInvite('${eventId}')">Portal Invite</button>`;
        case 'confirmed':
          return `<button class="stage-action-btn" onclick="stageSendDayOf('${eventId}')">Send Day-Of</button>`;
        case 'completed':
          return `<button class="stage-action-btn success" onclick="stageRequestReview('${eventId}')">Request Review</button>`;
        default:
          return '';
      }
    }

    async function stageFollowUp(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.clientEmail || ev.portalEmail || '';
      const firstName = (ev.clientName || 'there').split(' ')[0];
      if (!email) { showToast('No client email — add one in event details first.', 'warning'); return; }
      const eventDate = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'your event date';
      const body = `Hey ${firstName},\n\nJust wanted to follow up on the quote I sent over for your ${ev.type || 'event'} on ${eventDate}.\n\nHappy to answer any questions or adjust anything. What's your timeline for deciding?\n\nSaul\nBaseline Studio\n(786) 302-6056`;
      const result = await BSPortal.sendEmail('generic', { email, clientName: ev.clientName || 'there', body, subject: `Following up on ${ev.name || 'your event'}` });
      if (result.ok) {
        showToast('Follow-up sent to ' + email, 'success');
      } else {
        showEmailFallback(email, `Following up on ${ev.name || 'your event'}`, body, 'Could not send — use this fallback:');
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
          if (contractOption) { sel.value = contractOption.value; showToast('Contract template ready — click "+ From Template" to create it.', 'info'); }
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
      if (!email) { showToast('No client email — add one in event details first.', 'warning'); return; }
      const eventDate = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'your event date';
      const timelineLines = (ev.timeline || []).map(t => `  ${t.time || ''}  ${t.label || ''}`).join('\n');
      const body = `Hey ${firstName},\n\nYour event is coming up. Here's where everything stands.\n\nDate: ${eventDate}\nVenue: ${ev.venueName || 'your venue'}\n${timelineLines ? '\nRun of Show:\n' + timelineLines + '\n' : ''}\nWe'll be onsite early for setup and sound check. If anything comes up between now and then, just text or call.\n\nSaul\nBaseline Studio\n(786) 302-6056`;
      const result = await BSPortal.sendEmail('generic', { email, clientName: ev.clientName || 'there', body, subject: `Day-of details for ${ev.name || 'your event'}` });
      if (result.ok) {
        showToast('Day-of details sent to ' + email, 'success');
      } else {
        showEmailFallback(email, `Day-of details for ${ev.name || 'your event'}`, body, 'Could not send — use this fallback:');
      }
    }

    async function stageRequestReview(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.portalEmail || ev.clientEmail || '';
      const firstName = (ev.clientName || 'there').split(' ')[0];
      if (!email) { showToast('No client email — add one in event details first.', 'warning'); return; }
      const body = `Hey ${firstName},\n\nReally glad we got to be part of your ${ev.type || 'event'}. Hope the night was everything you wanted it to be.\n\nIf you have a minute, leaving us a Google review would mean a lot. It takes about 60 seconds and helps other clients find us:\n\nhttps://g.page/r/baselinestudiofl/review\n\nThanks for trusting us with your night.\n\nSaul\nBaseline Studio\n(786) 302-6056`;
      const result = await BSPortal.sendEmail('generic', { email, clientName: ev.clientName || 'there', body, subject: `Thank you from Baseline Studio` });
      if (result.ok) {
        showToast('Review request sent to ' + email, 'success');
      } else {
        showEmailFallback(email, `Thank you from Baseline Studio`, body, 'Could not send — use this fallback:');
      }
    }
    // ─────────────────────────────────────────────────────────────────

    function toggleArchiveEvent(eventId, archive) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.archived = archive;
      setDB('events', events);
      showToast(archive ? 'Event archived — toggle "Show Archived" in Events to find it.' : 'Event restored to active.', archive ? 'info' : 'success');
      renderPipeline();
      renderEvents();
      // Refresh event detail if open
      if (window.currentEvent && window.currentEvent.id === eventId) {
        window.currentEvent.archived = archive;
        document.getElementById('tabOverview') && (document.getElementById('tabOverview').innerHTML = renderEventOverview(window.currentEvent));
      }
    }

    let draggedCard = null;
    function dragStart(e) { draggedCard = e.target.closest('.kanban-card'); draggedCard.classList.add('dragging'); }
    function dragEnd(e) { if (draggedCard) draggedCard.classList.remove('dragging'); }
    function dragOver(e) { e.preventDefault(); }
    function drop(e) {
      e.preventDefault();
      const target = e.target.closest('.kanban-items');
      if (target && draggedCard) {
        target.appendChild(draggedCard);
        const newStatus = target.dataset.status;
        const eventId = draggedCard.dataset.eventId;
        const events = getDB('events');
        const event = events.find(e => e.id === eventId);
        if (event) {
          event.status = newStatus;
          setDB('events', events);
          showToast(`Moved to ${newStatus}`, 'success');
        }
      }
    }

    //  BLOG WRITER 
    
    
    
    
    
    
    
    
    
    
    
    
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
