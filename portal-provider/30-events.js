// ============================================================================
// portal-provider/30-events.js  -  events: list, event page and tabs, overview, messages, portal access and credentials, portal/lighting tab, delete
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Create / invite account (Saul's addition) ─────────────────────────
    // type: 'client' | 'vendor' | 'team'
    // person: { name, email, phone, role? }
    async function sendLoginInfo(type, person) {
      if (!person.email) { showToast('No email on record — add one first', 'error'); return; }

      // Generate a readable password
      const words   = ['Studio','Event','Beats','Stage','Bass','Crowd','Lights','Sound','Miami','Vibe'];
      const nums    = Math.floor(100 + Math.random() * 900);
      const pw      = words[Math.floor(Math.random()*words.length)] + nums + '!';
      const portalUrl = 'https://www.baselinestudiofl.com/' + (type === 'team' ? 'login.html' : 'portal-client.html');

      try {
        if (type === 'team') {
          // Create a real Supabase Auth provider account
          const acct = await BSPortal.createProviderUser(person.email, pw, person.name, person.role || 'staff');
          if (!acct.ok) {
            showToast('Could not create the account: ' + (acct.error || 'unknown error'), 'error');
            return;
          }
          showToast('Provider account created for ' + person.email, 'success');
          // Single provider_invite send; its result is reported separately from account creation
          const inviteRes = await BSPortal.sendEmail('provider_invite', {
            email: person.email,
            name:  person.name,
            role:  person.role || 'staff',
            password: pw
          });
          if (inviteRes.ok) {
            showToast('Invite email sent to ' + person.email, 'success');
          } else {
            showToast('Account created, but the invite email did not send: ' + (inviteRes.error || 'unknown error'), 'warning');
          }
        } else if (type === 'client') {
          // Clients get portal-client.html access via client_invite
          const res = await BSPortal.sendEmail('client_invite', {
            email: person.email,
            clientName: person.name,
            password: pw,
            eventName: 'your event',
            eventDate: ''
          });
          // Sync credentials to both clients and events records (the emailed password must match what the portal checks)
          setClientCredentials(person.email, person.email, pw);
          if (res.ok) {
            showToast('Login info sent to ' + person.email, 'success');
          } else {
            showToast('Could not send login info: ' + (res.error || 'unknown error'), 'error');
          }
        } else {
          // Vendors never get a login. Send a short contact note instead.
          const res = await BSPortal.sendEmail('generic', {
            email: person.email,
            clientName: person.name,
            subject: 'How to reach Baseline Studio',
            body: 'Thanks for being part of the event. If you need anything on the production side, you can reach me directly at (786) 302-6056 or Baselinestudiofl@gmail.com. Call or text, whatever is easiest.\n\nYou do not need a login for anything. I will send you the event details, timing, and load-in info myself, so you will have what you need before the day.'
          });
          if (res.ok) {
            showToast('Contact note sent to ' + person.email, 'success');
          } else {
            showToast('Could not send the contact note: ' + (res.error || 'unknown error'), 'error');
          }
        }
      } catch(err) {
        showToast('Could not send: ' + (err && err.message ? err.message : 'check edge function config'), 'error');
        console.error(err);
      }
    }

    // ── D: Honest email fallback — shown on any send failure ─────────────────
    function showEmailFallback(email, subject, body, errorMsg) {
      const old = document.getElementById('emailFallbackEl');
      if (old) old.remove();
      const el = document.createElement('div');
      el.id = 'emailFallbackEl';
      el.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#111;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:16px 20px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.6);font-family:Barlow,sans-serif;';
      const safeSubj = encodeURIComponent(subject);
      const safeBody = encodeURIComponent(body);
      el.innerHTML = `<div style="font-size:12px;color:#ff6b6b;margin-bottom:8px;">${errorMsg || 'Could not send — check edge function setup.'}</div><div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px;">Send it manually instead:</div><div style="display:flex;gap:8px;flex-wrap:wrap;"><a href="mailto:${email}?subject=${safeSubj}&body=${safeBody}" style="display:inline-block;padding:7px 14px;background:var(--cyan);color:#000;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;">↗ Open in Email App</a><button id="efbCopy" style="padding:7px 14px;background:rgba(255,255,255,0.08);border:1px solid var(--border-ui);color:#fff;border-radius:6px;font-size:12px;cursor:pointer;">📋 Copy Text</button><button id="efbClose" style="padding:7px 14px;background:none;border:1px solid var(--border-ui);color:rgba(255,255,255,0.55);border-radius:6px;font-size:12px;cursor:pointer;">Dismiss</button></div>`;
      document.body.appendChild(el);
      document.getElementById('efbCopy').addEventListener('click', () => {
        navigator.clipboard.writeText(body).catch(() => {});
        document.getElementById('efbCopy').textContent = 'Copied';
      });
      document.getElementById('efbClose').addEventListener('click', () => el.remove());
      setTimeout(() => { if (document.getElementById('emailFallbackEl')) el.remove(); }, 30000);
    }

    // ── F: Portal credential helpers ─────────────────────────────────────────

    // THE ONLY way credentials are ever written. Never set portalPassword anywhere else.
    function setClientCredentials(clientEmail, newPortalEmail, newPassword) {
      const email = (clientEmail || '').toLowerCase();
      if (!email || !newPassword) return;
      const clients = getDB('clients') || [];
      const events  = getDB('events')  || [];
      clients.forEach(c => {
        if ((c.email || '').toLowerCase() === email) {
          c.portalEmail    = newPortalEmail || c.email;
          c.portalPassword = newPassword;
        }
      });
      events.forEach(ev => {
        const evEmail = (ev.clientEmail || ev.portalEmail || '').toLowerCase();
        if (evEmail === email) {
          ev.portalEmail    = newPortalEmail || ev.clientEmail;
          ev.portalPassword = newPassword;
        }
      });
      setDB('clients', clients);
      setDB('events',  events);
    }

    function savePortalCredentials(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const newEmail = (document.getElementById('editPortalEmail')?.value || '').trim();
      const newPass  = (document.getElementById('editPortalPassword')?.value || '').trim();
      const clientEmail = ev.clientEmail || ev.portalEmail || '';
      if (newPass) {
        // Route through single write path — syncs both clients and events records
        setClientCredentials(clientEmail, newEmail || ev.portalEmail, newPass);
      } else if (newEmail) {
        ev.portalEmail = newEmail;
        setDB('events', events);
      }
      // Refresh ev reference after setClientCredentials may have updated it
      const updatedEv = (getDB('events') || []).find(e => e.id === eventId) || ev;
      window.currentEvent = updatedEv;
      showToast('Portal credentials saved', 'success');
      document.getElementById('tabPortal').innerHTML = renderEventPortal(updatedEv);
    }

    function generateNewPortalPassword(eventId) {
      const pw = genPortalPassword();
      const el = document.getElementById('editPortalPassword');
      if (el) el.value = pw;
    }

    function togglePortalDisabled(eventId, disabled) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.portalDisabled = disabled;
      setDB('events', events);
      window.currentEvent = ev;
      showToast(disabled ? 'Portal access turned off for this event' : 'Portal access is now active', disabled ? 'warning' : 'success');
    }

    // ── K: Portal-ready notification (after event creation) ──────────────────
    function showPortalReadyNotification(event) {
      const old = document.getElementById('portalReadyNotif');
      if (old) old.remove();
      const email = event.portalEmail || event.clientEmail || '';
      const pass  = event.portalPassword || '';
      const clientFirst = (event.clientName || '').split(' ')[0] || 'there';
      const inviteMsg = `Hey ${clientFirst},\n\nYour portal is ready. Log in to review your event details, timeline, and documents.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${email}\nPassword: ${pass}\n\nReach out if you need anything.\n\nSaul, Baseline Studio`;

      const el = document.createElement('div');
      el.id = 'portalReadyNotif';
      el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#111;border:1px solid rgba(46,204,113,0.4);border-radius:10px;padding:16px 20px;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,0.6);font-family:Barlow,sans-serif;';
      el.innerHTML = `<div style="font-size:13px;font-weight:600;color:#2ecc71;margin-bottom:4px;">Portal's ready for ${clientFirst}.</div><div style="font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:12px;">${email} &nbsp;·&nbsp; <code style="color:rgba(255,255,255,0.6);">${pass}</code></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button id="prnCopy" class="btn btn-secondary" style="font-size:12px;padding:7px 14px;">📋 Copy Invite</button><button id="prnSend" class="btn btn-primary" style="font-size:12px;padding:7px 14px;">✉ Send Invite</button><button id="prnClose" style="padding:7px 14px;background:none;border:1px solid var(--border-ui);color:rgba(255,255,255,0.55);border-radius:6px;font-size:12px;cursor:pointer;">×</button></div>`;
      document.body.appendChild(el);

      document.getElementById('prnCopy').addEventListener('click', () => {
        navigator.clipboard.writeText(inviteMsg).catch(() => {});
        document.getElementById('prnCopy').textContent = 'Copied';
      });
      document.getElementById('prnSend').addEventListener('click', async () => {
        const sendBtn = document.getElementById('prnSend');
        sendBtn.textContent = 'Sending…'; sendBtn.disabled = true;
        const result = await BSPortal.sendEmail('client_invite', { email, clientName: event.clientName || 'there', password: pass, eventName: event.name || 'your event', eventDate: event.date || '' });
        if (result.ok) {
          sendBtn.textContent = 'Sent ✓';
        } else {
          sendBtn.textContent = 'Failed';
          showEmailFallback(email, 'Your Baseline Studio Portal', inviteMsg, 'Could not send automatically — email client ready below.');
        }
      });
      document.getElementById('prnClose').addEventListener('click', () => el.remove());
      setTimeout(() => { if (document.getElementById('portalReadyNotif')) el.remove(); }, 20000);
    }

    function renderEvents() {
      let events = getDB('events');
      const currentUser = BSPortal.getCurrentUser();
      const searchVal = document.getElementById('eventsSearch')?.value || '';
      const typeFilter = document.getElementById('eventTypeFilter')?.value || '';
      const statusFilter = document.getElementById('eventStatusFilter')?.value || '';
      const showArchived = document.getElementById('showArchivedToggle')?.checked || false;

      if (currentUser.role === 'dj') {
        events = events.filter(e => (e.staff||[]).includes(currentUser.id));
      }
      // Hide archived unless toggle is on
      if (!showArchived) events = events.filter(e => !e.archived);
      if (searchVal) events = events.filter(e => e.name.toLowerCase().includes(searchVal.toLowerCase()));
      if (typeFilter) events = events.filter(e => e.type === typeFilter);
      if (statusFilter) events = events.filter(e => e.status === statusFilter);

      const now = Date.now();
      const oneDay  = 86400000;
      const oneWeek = oneDay * 7;
      const oneMonth= oneDay * 30;

      const today   = events.filter(e => { const d=new Date(e.date)-now; return d>=0 && d<oneDay; });
      const week    = events.filter(e => { const d=new Date(e.date)-now; return d>=oneDay && d<oneWeek; });
      const month   = events.filter(e => { const d=new Date(e.date)-now; return d>=oneWeek && d<oneMonth; });
      const rest    = events.filter(e => { const d=new Date(e.date)-now; return d>=oneMonth || d<0; });

      function evRow(e) {
        const date = new Date(e.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        const deleteBtn = currentUser.role === 'dj' ? '' : `<button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="event.stopPropagation(); deleteEvent('${e.id}');">Delete</button>`;
        const archiveBtn = currentUser.role === 'dj' ? '' : e.archived
          ? `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="event.stopPropagation();toggleArchiveEvent('${e.id}',false)">Restore</button>`
          : `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;color:#888;" onclick="event.stopPropagation();toggleArchiveEvent('${e.id}',true)">Archive</button>`;
        const archivedBadge = e.archived ? `<span class="badge badge-archived" style="margin-left:4px;font-size:12px;">archived</span>` : '';
        return `<tr onclick="openEventDetail('${e.id}')" style="cursor:pointer;${e.archived ? 'opacity:0.55;' : ''}">
          <td>${esc(e.name)}${archivedBadge}</td>
          <td><span class="badge badge-${esc(e.type)}">${esc(e.type)}</span></td>
          <td>${date} ${daysUntilChip(e.date)}</td>
          <td>${esc(e.clientName)}</td>
          <td>${esc(e.venueName)}</td>
          <td><span class="badge badge-${esc(e.status)}">${esc(e.status)}</span></td>
          <td>$${e.basePrice}</td>
          <td style="display:flex;gap:6px;">${archiveBtn}${deleteBtn}</td>
        </tr>`;
      }

      function groupSection(label, arr) {
        if (!arr.length) return '';
        return `<tr><td colspan="8" style="padding:10px 20px 4px;background:var(--black-4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);">${label}</td></tr>${arr.map(evRow).join('')}`;
      }

      let html = '';
      if (today.length || week.length || month.length || rest.length) {
        html += groupSection('Today', today) + groupSection('This Week', week) + groupSection('This Month', month) + groupSection('Later & Past', rest);
      }
      document.getElementById('eventsTableBody').innerHTML = html || '<tr><td colspan="8"><div class="empty-state">No events yet. <button class="btn btn-secondary" style="margin-left:10px;" onclick="openNewEventModal()">Create your first one →</button></div></td></tr>';
      document.getElementById('newEventBtn').style.display = 'block';
    }

    // ── Full-page event detail ─────────────────────────────────────────────
    function showEventPage(eventId, tab) {
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;
      // Re-rendering the event that is already open (after a save, or a background sync) keeps its tab.
      if (tab === undefined && _route && _route.type === 'event' && String(_route.id) === String(eventId) && document.getElementById('detail').classList.contains('active')) tab = _route.tab;
      if (ROUTE_EVENT_TABS.indexOf(tab) < 0) tab = null;

      window.currentEvent = event;

      const msgCount = (event.messages || []).filter(m => m.from === 'client' && !m.read).length;
      const msgBadge = msgCount ? ` <span style="background:#e74c3c;color:#07070d;border-radius:10px;font-size:12px;padding:1px 6px;font-weight:700;">${msgCount}</span>` : '';

      const eventDate = event.date ? new Date(event.date).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '';
      const metaParts = [event.type, event.venueName, eventDate].filter(Boolean);

      const html = `<div class="detail-page">
        <div class="detail-breadcrumb" role="button" tabindex="0" onclick="goBack()">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          ${_detailReturnSection.charAt(0).toUpperCase() + _detailReturnSection.slice(1)}
        </div>
        <div class="detail-page-header">
          <div>
            <div class="detail-page-title">
              ${esc(event.name)}
              <span class="badge badge-${esc(event.type)}" style="font-size:12px;">${esc(event.type)}</span>
              <span class="badge badge-${esc(event.status)}" style="font-size:12px;">${esc(event.status)}</span>
            </div>
            ${metaParts.length ? `<div class="detail-page-meta">${metaParts.map(esc).join(' · ')}</div>` : ''}
          </div>
          <div class="detail-page-actions">
            <button class="btn btn-secondary" onclick="openCreateInvoiceFromEvent('${event.id}')" style="background:rgba(31,163,224,0.15);border-color:var(--cyan);color:var(--cyan);">💳 Invoice</button>
            <button class="btn btn-secondary" onclick="openQuoteBuilderModal('${event.id}')" style="background:rgba(31,163,224,0.08);border-color:rgba(31,163,224,0.65);color:var(--cyan);">📋 Quote</button>
            <button class="btn btn-secondary" onclick="sendPortalInvite('${event.id}')" style="background:rgba(46,204,113,0.1);border-color:rgba(46,204,113,0.55);color:#2ecc71;">✉ Portal Invite</button>
          </div>
        </div>
        <div class="detail-tabs-wrap">
          <div class="tabs">
            <button class="tab-btn active" onclick="switchEventTab(this,'overview')">Overview</button>
            <button class="tab-btn" onclick="switchEventTab(this,'invoices')">Invoices</button>
            <button class="tab-btn" onclick="switchEventTab(this,'documents')">Documents</button>
            <button class="tab-btn" onclick="switchEventTab(this,'messages')">Messages${msgBadge}</button>
            <button class="tab-btn" onclick="switchEventTab(this,'timeline')">Timeline</button>
            <button class="tab-btn" onclick="switchEventTab(this,'plan')">Client Plan</button>
            <button class="tab-btn" onclick="switchEventTab(this,'lighting');initProviderLightingPicker('${event.id}')">Lighting</button>
            <button class="tab-btn" onclick="switchEventTab(this,'portal')">Portal</button>
          </div>
        </div>
        <div class="detail-tab-body">
          <div id="tabOverview" class="tab-content active">${renderEventOverview(event)}</div>
          <div id="tabInvoices" class="tab-content">${renderEventInvoices(event)}</div>
          <div id="tabDocuments" class="tab-content">${renderEventDocuments(event)}</div>
          <div id="tabMessages" class="tab-content">${renderEventMessages(event)}</div>
          <div id="tabTimeline" class="tab-content">${renderEventTimeline(event)}</div>
          <div id="tabPlan" class="tab-content">${renderEventClientPlan(event)}</div>
          <div id="tabLighting" class="tab-content"><div style="padding:8px 0;font-size:13px;color:var(--gray);">Click the Lighting tab to load preview.</div></div>
          <div id="tabPortal" class="tab-content">${renderEventPortal(event)}</div>
        </div>
      </div>`;

      document.getElementById('detailContent').innerHTML = html;
      _showDetailSection();
      _routeWrite({ type: 'event', id: eventId, tab: tab === 'overview' ? null : tab }, 'push');
      if (tab && tab !== 'overview') _routeActivateTab(tab);
      attachWeatherChip(event);
    }

    // ── Navigate to event / client (sets return section, pushes hash) ─────
    function navigateToEvent(eventId) {
      const active = document.querySelector('.section.active');
      if (active && active.id !== 'detail') _detailReturnSection = active.id;
      showEventPage(eventId);
    }

    // Legacy — all call sites now route to the full page
    function openEventDetail(eventId) {
      navigateToEvent(eventId);
    }

    function switchEventTab(btn, tabName) {
      const detailEl = document.getElementById('detailContent');
      (detailEl || document).querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      (detailEl || document).querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
      // Re-render volatile tabs from current event so they always show fresh data
      // (Portal tab in particular must reflect any credential changes)
      if (window.currentEvent) {
        if (tabName === 'portal') {
          document.getElementById('tabPortal').innerHTML = renderEventPortal(window.currentEvent);
        }
        // Client plan is read-only: always show the latest copy of the event
        if (tabName === 'plan') {
          const _planEv = (getDB('events') || []).find(e => e.id === window.currentEvent.id) || window.currentEvent;
          document.getElementById('tabPlan').innerHTML = renderEventClientPlan(_planEv);
        }
        // Mark client messages as read when Messages tab is opened — clears the badge
        if (tabName === 'messages') {
          const ev = window.currentEvent;
          const hasUnread = (ev.messages || []).some(m => m.from === 'client' && !m.read);
          if (hasUnread) {
            ev.messages.forEach(m => { if (m.from === 'client') m.read = true; });
            const events = getDB('events');
            const idx = events.findIndex(e => e.id === ev.id);
            if (idx !== -1) { events[idx] = ev; setDB('events', events); }
            // Clear the badge from the tab button
            btn.innerHTML = 'Messages';
          }
        }
      }
      // Move ink bar
      const tabs = btn.closest('.tabs');
      if (tabs) {
        let ink = tabs.querySelector('.tab-ink-p');
        if (!ink) { ink = document.createElement('div'); ink.className = 'tab-ink-p'; tabs.appendChild(ink); }
        const barRect = tabs.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        ink.style.left  = (btnRect.left - barRect.left + tabs.scrollLeft) + 'px';
        ink.style.width = btnRect.width + 'px';
      }
      // Tab switches rewrite the current history entry (Back should not step through tabs)
      if (window.currentEvent && _route && _route.type === 'event' && String(_route.id) === String(window.currentEvent.id)) {
        _routeWrite({ type: 'event', id: _route.id, tab: tabName === 'overview' ? null : tabName }, 'replace');
      }
    }

    function renderEventOverview(event) {
      return `<div class="grid-2">
        <div>
          <div class="form-group"><label class="form-label" for="editEventName">Event Name</label><input type="text" class="form-input" value="${event.name}" id="editEventName"></div>
          <div class="form-group"><label class="form-label" for="editEventType">Type</label><select class="form-select" id="editEventType"><option value="wedding" ${event.type === 'wedding' ? 'selected' : ''}>Wedding</option><option value="quince" ${event.type === 'quince' ? 'selected' : ''}>Quince/Sweet 16</option><option value="corporate" ${event.type === 'corporate' ? 'selected' : ''}>Corporate</option><option value="gala" ${event.type === 'gala' ? 'selected' : ''}>Gala/Fundraiser</option><option value="birthday" ${event.type === 'birthday' ? 'selected' : ''}>Birthday/Private Party</option><option value="concert" ${event.type === 'concert' ? 'selected' : ''}>Concert/Festival</option><option value="sweet16" ${event.type === 'sweet16' ? 'selected' : ''}>Sweet 16</option><option value="mitzvah" ${event.type === 'mitzvah' ? 'selected' : ''}>Bar/Bat Mitzvah</option>${['wedding','quince','corporate','gala','birthday','concert','sweet16','mitzvah'].includes(event.type) ? '' : `<option value="${esc(event.type || '')}" selected>Not set (pick a type)</option>`}</select></div>
          <div class="form-group"><label class="form-label" for="editEventStatus">Status</label><select class="form-select" id="editEventStatus"><option value="lead" ${event.status === 'lead' ? 'selected' : ''}>Lead</option><option value="quote_sent" ${event.status === 'quote_sent' ? 'selected' : ''}>Quote Sent</option><option value="proposal" ${event.status === 'proposal' ? 'selected' : ''}>Proposal</option><option value="negotiation" ${event.status === 'negotiation' ? 'selected' : ''}>Negotiation</option><option value="booked" ${event.status === 'booked' ? 'selected' : ''}>Booked</option><option value="confirmed" ${event.status === 'confirmed' ? 'selected' : ''}>Confirmed</option><option value="completed" ${event.status === 'completed' ? 'selected' : ''}>Completed</option><option value="cancelled" ${event.status === 'cancelled' ? 'selected' : ''}>Cancelled</option><option value="ghosted" ${event.status === 'ghosted' ? 'selected' : ''}>Ghosted</option></select></div>
          <div class="form-group"><label class="form-label" for="editEventDate">Date</label><input type="date" class="form-input" value="${event.date}" id="editEventDate"></div>
          <div class="form-group"><label class="form-label" for="editEventStartTime">Start Time</label><input type="time" class="form-input" value="${event.startTime}" id="editEventStartTime"></div>
          <div class="form-group"><label class="form-label" for="editVenueName">Venue</label><input type="text" class="form-input" value="${event.venueName}" id="editVenueName"></div>
        </div>
        <div>
          <div class="form-group"><label class="form-label" for="editClientName">Client Name</label><input type="text" class="form-input" value="${event.clientName}" id="editClientName"></div>
          <div class="form-group"><label class="form-label" for="editClientEmail">Client Email</label><input type="email" class="form-input" value="${event.clientEmail}" id="editClientEmail"></div>
          <div class="form-group"><label class="form-label" for="editClientPhone">Client Phone</label><input type="tel" class="form-input" value="${event.clientPhone}" id="editClientPhone"></div>
          <div class="form-group"><label class="form-label" for="editBasePrice">Base Price</label><input type="number" class="form-input" value="${event.basePrice}" id="editBasePrice"></div>
          <div class="form-group"><label class="form-label" for="editDepositAmount">Deposit</label><input type="number" class="form-input" value="${event.depositAmount}" id="editDepositAmount"></div>
          <div style="display:flex;gap:20px;margin:4px 0 12px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
              <input type="checkbox" id="editDepositPaid" ${event.depositPaid ? 'checked' : ''} onchange="toggleDepositPaid('${event.id}', this.checked)" style="width:16px;height:16px;accent-color:var(--cyan);">
              Deposit Paid
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
              <input type="checkbox" id="editBalancePaid" ${event.balancePaid ? 'checked' : ''} onchange="toggleBalancePaid('${event.id}', this.checked)" style="width:16px;height:16px;accent-color:var(--cyan);">
              Balance Paid
            </label>
          </div>
          ${(()=>{
            const lColors = ((event.clientEnhancements||{}).lighting||{}).colors||[];
            if (!lColors.length) return '';
            return `<div style="margin:8px 0 16px;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,0.55);margin-bottom:8px;">Client's Uplight Colors</div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                ${lColors.map(hex=>`<div style="width:24px;height:24px;border-radius:5px;background:${hex};box-shadow:0 0 8px ${hex}77;" title="${hex}"></div>`).join('')}
                <span style="font-size:12px;color:rgba(255,255,255,0.55);">${lColors.join(' · ')}</span>
                <button class="btn btn-secondary" style="font-size:12px;padding:3px 9px;border-radius:6px;" onclick="switchEventTab(document.querySelector('.tab-btn[onclick*=lighting]'),'lighting');initProviderLightingPicker('${event.id}')">Edit →</button>
              </div>
            </div>`;
          })()}
          <div class="form-group"><label class="form-label" for="editEventNotes">Internal Notes</label><textarea class="form-textarea" id="editEventNotes" style="min-height:70px;font-size:13px;" placeholder="Notes visible only to your team…">${event.notes || ''}</textarea></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="saveEventChanges('${event.id}')">Save</button>
            <button class="btn btn-secondary" onclick="openCreateInvoiceFromEvent('${event.id}')" style="background:rgba(31,163,224,0.15);border-color:var(--cyan);color:var(--cyan);">💳 Create Invoice</button>
            <button class="btn btn-secondary" onclick="openQuoteBuilderModal('${event.id}')" style="background:rgba(31,163,224,0.08);border-color:rgba(31,163,224,0.65);color:var(--cyan);">📋 Build Quote</button>
            <button class="btn btn-secondary" onclick="openAssignAccountModal('${event.id}')">👤 Assign Accounts</button>
            <button class="btn btn-secondary" onclick="sendPortalInvite('${event.id}')" style="background:rgba(46,204,113,0.1);border-color:rgba(46,204,113,0.55);color:#2ecc71;">✉ Send Portal Invite</button>
            ${event.archived
              ? `<button class="btn btn-secondary" onclick="toggleArchiveEvent('${event.id}',false)" style="background:rgba(255,255,255,0.05);border-color:var(--border-ui);color:rgba(255,255,255,0.5);">↩ Restore Event</button>`
              : `<button class="btn btn-secondary" onclick="toggleArchiveEvent('${event.id}',true)" style="background:rgba(85,85,85,0.12);border-color:var(--border-ui);color:#888;">🗄 Archive Event</button>`
            }
          </div>
        </div>
      </div>`;
    }

    // ── Event Messages tab ────────────────────────────────────────────────────
    function renderEventMessages(event) {
      const messages = event.messages || [];
      const msgHtml = messages.length ? messages.map(m => {
        const isClient = m.from === 'client';
        const avatar   = isClient ? (event.clientName || 'C')[0].toUpperCase() : 'BS';
        const bgColor  = isClient ? 'rgba(31,163,224,0.18)' : 'rgba(255,255,255,0.08)';
        const borderC  = isClient ? 'rgba(31,163,224,0.25)' : 'rgba(255,255,255,0.08)';
        return `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;${!isClient ? 'flex-direction:row-reverse;' : ''}">
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;color:rgba(255,255,255,0.7);">${avatar}</div>
          <div style="display:flex;flex-direction:column;max-width:75%;${!isClient ? 'align-items:flex-end;' : ''}">
            <div style="background:${bgColor};border:1px solid ${borderC};border-radius:10px;padding:10px 14px;font-size:13px;color:rgba(255,255,255,0.85);">${esc(m.text)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:4px;">${new Date(m.ts).toLocaleString()}</div>
          </div>
        </div>`;
      }).join('') : '<div style="text-align:center;color:var(--gray);font-size:13px;padding:24px;">No messages yet — client messages appear here in real time</div>';

      return `
        <div style="max-height:380px;overflow-y:auto;margin-bottom:16px;padding:4px 0;" id="providerMsgThread">
          ${msgHtml}
        </div>
        <div style="display:flex;gap:8px;">
          <input type="text" class="form-input" id="providerMsgInput" placeholder="Reply to client…" style="flex:1;" onkeydown="if(event.key==='Enter')sendProviderMessage('${event.id}')">
          <button class="btn btn-primary" onclick="sendProviderMessage('${event.id}')">Send</button>
        </div>`;
    }

    function sendProviderMessage(eventId) {
      const input = document.getElementById('providerMsgInput');
      const text  = input?.value.trim();
      if (!text) return;
      const events = getDB('events');
      const ev     = events.find(e => e.id === eventId);
      if (!ev) return;
      if (!ev.messages) ev.messages = [];
      ev.messages.push({ from: 'provider', text, ts: new Date().toISOString() });
      setDB('events', events);
      window.currentEvent = ev;
      input.value = '';
      document.getElementById('tabMessages').innerHTML = renderEventMessages(ev);
      // Scroll to bottom
      setTimeout(() => { const t = document.getElementById('providerMsgThread'); if(t) t.scrollTop = t.scrollHeight; }, 50);
      showToast('Message sent', 'success');
    }

    async function sendPortalInvite(eventId, btnEl) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.portalEmail || ev.clientEmail || '';
      const name  = ev.clientName  || 'there';
      const pass  = ev.portalPassword || '';
      if (!email) { showToast('No client email — add one on the Overview tab first', 'warning'); return; }
      const date  = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : 'your event date';
      const clientFirst = name.split(' ')[0] || 'there';
      const inviteMsg = `Hey ${clientFirst},\n\nYour portal is ready. Log in to review your event details, timeline, and documents.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${email}\nPassword: ${pass}\n\nReach out if anything comes up.\n\nSaul, Baseline Studio`;

      if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending…'; }
      const result = await BSPortal.sendEmail('client_invite', {
        email, clientName: name, password: pass,
        eventName: ev.name || 'your event', eventDate: date
      });
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✉ Send Portal Invite'; }

      if (result.ok) {
        showToast('Portal invite sent to ' + email, 'success');
      } else {
        showEmailFallback(email, 'Your Baseline Studio Portal', inviteMsg,
          'Could not send — check Resend setup. Send it manually:');
      }
    }

    function saveEventChanges(eventId) {
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (event) {
        event.name = document.getElementById('editEventName').value;
        event.type = document.getElementById('editEventType').value;
        event.status = document.getElementById('editEventStatus').value;
        event.date = document.getElementById('editEventDate').value;
        event.startTime = document.getElementById('editEventStartTime').value;
        event.clientName = document.getElementById('editClientName').value;
        event.clientEmail = document.getElementById('editClientEmail').value;
        event.clientPhone = document.getElementById('editClientPhone').value;
        event.venueName = document.getElementById('editVenueName').value;
        event.basePrice = parseInt(document.getElementById('editBasePrice').value);
        event.depositAmount = parseInt(document.getElementById('editDepositAmount').value);
        event.notes = document.getElementById('editEventNotes')?.value || event.notes || '';
        setDB('events', events);
        window.currentEvent = event;
        renderEvents(); // refresh sidebar list so name/status/date changes show immediately
        showToast('Saved', 'success');
        // If we're on the detail page, refresh the header to show updated name/status
        if (document.getElementById('detail').classList.contains('active')) {
          showEventPage(eventId);
        }
      }
    }

    function renderEventPortal(event) {
      const email    = event.portalEmail || event.clientEmail || '';
      const pass     = event.portalPassword || '';
      const disabled = !!event.portalDisabled;
      const clientFirst = (event.clientName || '').split(' ')[0] || 'there';
      const inviteMsg = pass
        ? `Hey ${clientFirst},\n\nYour portal is ready. Log in to review your event details, timeline, and documents.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${email}\nPassword: ${pass}\n\nReach out if anything comes up.\n\nSaul, Baseline Studio`
        : '';
      const safeMsg = inviteMsg.replace(/`/g,'\\`').replace(/\$/g,'\\$');

      const manageLink = event.clientId
        ? `<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="navigateToClient('${event.clientId}')">👤 Manage in Client Profile</button>`
        : '';

      return `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:${disabled?'#ff6b6b':'var(--text-3)'};">
            <input type="checkbox" ${disabled?'checked':''} onchange="togglePortalDisabled('${event.id}',this.checked)" style="width:13px;height:13px;accent-color:var(--cyan);">
            ${disabled ? 'Portal disabled' : 'Portal enabled'}
          </label>
          ${manageLink}
        </div>
        ${pass ? `
          <div style="background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.18);border-radius:8px;padding:14px 16px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:12px;color:var(--gray);">Login email</span>
              <code style="font-size:12px;color:#2ecc71;">${esc(email)}</code>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:12px;color:var(--gray);">Password</span>
              <div style="display:flex;align-items:center;gap:8px;">
                <code style="font-size:12px;color:#2ecc71;">${esc(pass)}</code>
                <button onclick="copyToClipboard('${pass}')" style="background:none;border:none;color:var(--cyan);cursor:pointer;font-size:12px;">Copy</button>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="sendPortalInvite('${event.id}')" style="background:rgba(46,204,113,0.1);border-color:rgba(46,204,113,0.55);color:#2ecc71;">🔑 Send Login Info</button>
            <button class="btn btn-secondary" onclick="copyToClipboard(\`${safeMsg}\`)">✉ Copy Invite</button>
            ${email ? `<a href="mailto:${esc(email)}?subject=Your Baseline Studio Portal&body=${encodeURIComponent(inviteMsg)}" class="btn btn-secondary">↗ Email App</a>` : ''}
          </div>
        ` : `
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:14px 16px;font-size:13px;color:var(--gray);">
            No credentials set. ${event.clientId ? `<button onclick="navigateToClient('${event.clientId}')" style="background:none;border:none;color:var(--cyan);cursor:pointer;font-size:13px;padding:0;margin-left:4px;">Set them in the client profile →</button>` : 'Link a client to this event first.'}
          </div>
        `}`;
    }

    let _lpCleanup = null;
    function initProviderLightingPicker(eventId) {
      const container = document.getElementById('tabLighting');
      if (!container || !window.LightingPicker) return;
      // Cleanup prior instance
      if (_lpCleanup) { _lpCleanup(); _lpCleanup = null; }
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;

      const lighting = (event.clientEnhancements || {}).lighting || {};
      const colors   = lighting.colors || [];

      // Build header summary — show client's picks at a glance
      const swatchHtml = colors.length
        ? colors.map(hex => `<span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${hex};box-shadow:0 0 6px ${hex}55;vertical-align:middle;"></span>`).join(' ')
        : '<span style="color:var(--gray);font-size:12px;">No colors chosen yet</span>';

      container.innerHTML = `
        <div style="padding:8px 0;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:var(--black-4);border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--gray);">Client's Uplights</div>
            <div style="display:flex;gap:6px;align-items:center;">${swatchHtml}</div>
          </div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:16px;">You can view and update their color picks here. Changes sync to their portal.</div>
          <div id="providerLpMount"></div>
        </div>`;

      const mount = document.getElementById('providerLpMount');
      LightingPicker.mount(mount, lighting, function(lightingObj) {
        const evs = getDB('events');
        const ev  = evs.find(e => e.id === eventId);
        if (!ev) return;
        if (!ev.clientEnhancements) ev.clientEnhancements = {};
        ev.clientEnhancements.lighting = lightingObj; // { colors: [...] }
        setDB('events', evs);
        window.currentEvent = ev;
        // Re-render Overview tab so lighting swatches update immediately (was stale)
        const _ovEl = document.getElementById('tabOverview');
        if (_ovEl) _ovEl.innerHTML = renderEventOverview(ev);
        showToast('Lighting saved', 'success');
      });
      if (mount._lpCleanup) _lpCleanup = mount._lpCleanup;
    }

    function deleteEvent(eventId) {
      const events = getDB('events');
      const event = events.find(ev => ev.id === eventId);
      window.confirmCallback = () => {
        const updated = events.filter(ev => ev.id !== eventId);
        setDB('events', updated);
        closeModal('confirmDialog');
        if (document.getElementById('detail').classList.contains('active')) goBack();
        renderEvents();
        showToast('Deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete Event';
      document.getElementById('confirmMessage').textContent = `Delete "${event.name}"?`;
      openModal('confirmDialog');
    }
