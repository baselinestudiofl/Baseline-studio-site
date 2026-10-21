// ============================================================================
// portal-provider/40-clients.js  -  clients: list, client page, client portal credentials/invites, portal users, assign accounts
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A); redesigned in the CRM v2 UI pass (lane P5).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// Screen CSS lives in portal-provider/css/40-clients.css (classes cl-*, cd-*, pu-*, as-*).
// ============================================================================

    // ── Small helpers (P5) ────────────────────────────────────────────────
    function _clIcon(name, size) {
      return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(name, size || 16) : '';
    }

    // Accent-blind, case-blind text for matching (L25). CRMUI.norm.fold when present, else a local NFD strip.
    function _clFold(s) {
      const t = String(s == null ? '' : s);
      if (window.CRMUI && CRMUI.norm && CRMUI.norm.fold) return String(CRMUI.norm.fold(t));
      return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
    }

    function _clInitials(name) {
      const parts = String(name || '').replace(/&/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      return ((parts[0][0] || '') + (parts.length > 1 ? (parts[parts.length - 1][0] || '') : '')).toUpperCase();
    }

    function _clPhone(p) {
      if (!p) return '';
      return (window.CRMUI && CRMUI.fmt) ? CRMUI.fmt.phone(String(p)) : String(p);
    }

    function _clTel(p) {
      return String(p || '').replace(/[^\d+]/g, '');
    }

    function _clDateParts(iso) {
      const s = String(iso || '').slice(0, 10);
      const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : null;
      return d && !isNaN(d) ? d : null;
    }

    function _clDateList(iso) {
      const d = _clDateParts(iso);
      if (!d) return '';
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function _clMoney(n) {
      const v = Number(n) || 0;
      return (window.CRMUI && CRMUI.fmt) ? CRMUI.fmt.money(v) : '$' + v.toFixed(2);
    }

    function _clSince(client, clientEvents) {
      const fmt = ms => {
        const d = new Date(ms);
        return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      };
      if (client.createdAt) { const s = fmt(client.createdAt); if (s) return s; }
      const stamps = clientEvents.map(e => e.createdAt).filter(Boolean).map(x => new Date(x).getTime()).filter(x => !isNaN(x));
      return stamps.length ? fmt(Math.min.apply(null, stamps)) : '';
    }

    // "wedding" -> "Wedding", "hair-makeup" -> "Hair makeup"
    function _clLabel(v) {
      const t = String(v || '').replace(/[-_]+/g, ' ').trim();
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    }

    function _clTypePill(type) {
      return type === 'corporate'
        ? '<span class="pill pill-sm pill-info" data-ui="pill">Corporate</span>'
        : '<span class="pill pill-sm pill-neutral" data-ui="pill">Private</span>';
    }

    function _clStatusPill(status) {
      const s = String(status || '').toLowerCase();
      const tone = ({ booked: 'ok', confirmed: 'ok', lead: 'info', new: 'info', proposal: 'violet', quote: 'violet', quoted: 'violet', negotiation: 'violet', completed: 'neutral', cancelled: 'danger' })[s] || 'neutral';
      const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Event';
      return `<span class="pill pill-sm pill-${tone}" data-ui="pill">${esc(label)}</span>`;
    }

    // ── Client-level portal management (called from client profile page) ─────
    function saveClientPortalCredentials(clientId) {
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      const newEmail = (document.getElementById('clientPortalEmail')?.value || '').trim();
      const newPass  = (document.getElementById('clientPortalPassword')?.value || '').trim();
      const baseEmail = client.email || '';
      if (!newEmail && !newPass) { showToast('Nothing to save', 'error'); return; }
      if (!baseEmail.trim()) { showToast('Add an email first', 'error'); return; }
      if (newPass) {
        // Canonical write path: syncs email + password across all client + event records
        setClientCredentials(baseEmail, newEmail || baseEmail, newPass);
      } else {
        // Email-only change (no password entered)
        const clients = getDB('clients');
        const events  = getDB('events');
        clients.forEach(c => { if (c.id === clientId) c.portalEmail = newEmail; });
        // Match by client id, or by email only when both sides have one (an empty email must never match other clients' events)
        events.filter(e => e.clientId === clientId || (e.clientEmail || '').trim().toLowerCase() === baseEmail.trim().toLowerCase())
              .forEach(ev => { ev.portalEmail = newEmail; });
        setDB('clients', clients);
        setDB('events', events);
      }
      showToast('Portal credentials saved', 'success');
      showClientPage(clientId, 'overview');
    }

    function generateClientPortalPassword() {
      const pw = genPortalPassword();
      const el = document.getElementById('clientPortalPassword');
      if (el) { el.value = pw; el.focus(); }
    }

    function toggleClientPortalDisabled(clientId, disabled) {
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      const baseEmail = (client.email || '').trim().toLowerCase();
      const events = getDB('events');
      const affected = events.filter(e => e.clientId === clientId || (baseEmail && (e.clientEmail || '').trim().toLowerCase() === baseEmail));
      if (!affected.length) { showToast('Add an email first', 'error'); return; }
      affected.forEach(ev => { ev.portalDisabled = disabled; });
      setDB('events', events);
      showToast(disabled ? 'Portal access turned off for all their events' : 'Portal access turned on', disabled ? 'warning' : 'success');
      showClientPage(clientId, 'overview');
    }

    // ── Full-page client detail ────────────────────────────────────────────
    function showClientPage(clientId, tab) {
      _detailReturnSection = _detailReturnSection === 'detail' ? 'clients' : (_detailReturnSection || 'clients');
      const clients = getDB('clients');
      const client = clients.find(c => c.id === clientId);
      if (!client) return;
      document.getElementById('detailContent').innerHTML = typeof _clPageHtml === 'function' ? _clPageHtml(client, tab) : '';
      _showDetailSection();
      _routeWrite({ type: 'client', id: clientId }, 'push');
    }

    // The client page markup (kept apart from showClientPage so the route test can load showClientPage on its own)
    function _clPageHtml(client, tab) {
      const clientId = client.id;
      const events = getDB('events') || [];
      const clientEvents = events.filter(e => e.clientId === clientId || (e.linkedClients && e.linkedClients.includes(clientId)));
      const tabs = ['overview', 'events', 'messages', 'files'];
      const activeTab = tabs.includes(tab) ? tab : 'overview';

      const byDate = clientEvents.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      const portalEv    = byDate.find(e => e.portalPassword);
      const portalEmail = portalEv?.portalEmail || portalEv?.clientEmail || client.email || '';
      const portalPw    = portalEv?.portalPassword || '';
      const portalDisabled = !!portalEv?.portalDisabled;
      const _cpFirst    = (client.name || '').split(' ')[0] || 'there';
      const cpInviteMsg = portalPw
        ? `Hey ${_cpFirst},\n\nYour portal is ready. Log in to review your event details, timeline, and documents.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${portalEmail}\nPassword: ${portalPw}\n\nReach out if anything comes up.\n\nSaul, Baseline Studio`
        : '';

      // Money: invoices tied to this client's events or email
      const evIds = new Set(clientEvents.map(e => e.id));
      const cEmail = (client.email || '').toLowerCase();
      const invs = (getDB('invoices') || []).filter(i => i.status !== 'cancelled' && (evIds.has(i.eventId) || (cEmail && (i.clientEmail || '').toLowerCase() === cEmail)));
      const invoiced = invs.reduce((s, i) => s + (Number(i.total) || 0), 0);
      const paid = invs.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
      const due = Math.max(0, invoiced - paid);

      // Messages: unread from the client across their events
      const unread = clientEvents.reduce((n, e) => n + (e.messages || []).filter(m => m.from === 'client' && !m.read).length, 0);

      const evCount = clientEvents.length;
      const since = _clSince(client, clientEvents);
      const metaBits = [client.type === 'corporate' ? 'Corporate' : 'Private', since ? 'Client since ' + since : '', evCount + (evCount === 1 ? ' event' : ' events')].filter(Boolean);

      // ── Overview panel ──
      const portalStatus = !portalPw
        ? '<span class="pill pill-sm pill-neutral" data-ui="pill">Not set up</span>'
        : (portalDisabled ? '<span class="pill pill-sm pill-warn" data-ui="pill">Off</span>' : '<span class="pill pill-sm pill-ok" data-ui="pill">On</span>');

      const nextEv = byDate.slice().reverse().find(e => e.status !== 'cancelled' && e.status !== 'completed' && _clDateParts(e.date) && _clDateParts(e.date) >= new Date(new Date().toDateString())) || null;
      let eventPortal = '';
      if (nextEv && typeof _portalAccessCard === 'function') {
        try {
          eventPortal = `<section class="cd-card"><div class="cd-card-head"><h3 class="cd-card-title">Portal access</h3><span class="t-meta" data-user-content>${esc(nextEv.name)}</span></div>${_portalAccessCard(nextEv)}</section>`;
        } catch (err) { eventPortal = ''; }
      }

      // ── Notes card (lives on Overview so the phone tab strip stays at four) ──
      const notesCard = `<section class="cd-card" aria-labelledby="cdNotesTitle">
          <div class="cd-card-head"><h3 class="cd-card-title" id="cdNotesTitle">Notes</h3><span id="cdNotesSave" class="save-pill" data-state="idle" aria-live="polite" hidden></span></div>
          <div class="field cd-flush"><label class="field-label" for="clientNotes">Private notes. Only you see these.</label>
          <textarea class="input form-textarea cd-notes" id="clientNotes" placeholder="Preferences, how they like to be reached, anything to remember" onblur="saveClientNotes('${clientId}')" data-user-content>${esc(client.notes || '')}</textarea></div>
        </section>`;

      const overview = `
        <div class="cd-grid">
          <div class="cd-stack">
            <section class="cd-card" aria-labelledby="cdInfoTitle">
              <div class="cd-card-head"><h3 class="cd-card-title" id="cdInfoTitle">Client info</h3></div>
              <form class="cd-form" onsubmit="event.preventDefault();saveClientChanges('${clientId}')" novalidate>
                <div class="field"><label class="field-label" for="editClientName2">Name</label><input type="text" class="input form-input" value="${esc(client.name)}" id="editClientName2" autocomplete="off" data-user-content></div>
                <div class="field"><label class="field-label" for="editClientType">Type</label><select class="input form-select" id="editClientType"><option value="private" ${client.type==='private'||!client.type?'selected':''}>Private</option><option value="corporate" ${client.type==='corporate'?'selected':''}>Corporate</option></select></div>
                <div class="field"><label class="field-label" for="editClientEmail2">Email</label><input type="email" class="input form-input" value="${esc(client.email||'')}" id="editClientEmail2" data-norm="email" data-user-content></div>
                <div class="field"><label class="field-label" for="editClientPhone2">Phone</label><input type="tel" class="input form-input" value="${esc(client.phone||'')}" id="editClientPhone2" data-norm="phone" data-user-content></div>
                <div class="field cd-wide"><label class="field-label" for="editClientCompany">Company or agency</label><input type="text" class="input form-input" value="${esc(client.company||'')}" id="editClientCompany" placeholder="Optional" autocomplete="off" data-user-content></div>
                <div class="cd-form-foot cd-wide"><button type="submit" class="btn btn-secondary">Save changes</button></div>
              </form>
            </section>
            ${notesCard}
          </div>
          <div class="cd-stack">
            <section class="cd-card" aria-labelledby="cdMoneyTitle">
              <div class="cd-card-head"><h3 class="cd-card-title" id="cdMoneyTitle">Money</h3>${invs.length ? `<button type="button" class="btn btn-ghost btn-sm" onclick="switchSection('invoices')">View invoices</button>` : ''}</div>
              ${invs.length ? `<dl class="cd-money">
                <div><dt>Invoiced</dt><dd>${_clMoney(invoiced)}</dd></div>
                <div><dt>Paid</dt><dd>${_clMoney(paid)}</dd></div>
                <div><dt>Due</dt><dd class="${due > 0 ? 'is-due' : ''}">${_clMoney(due)}</dd></div>
              </dl>` : '<div class="as-hint cd-flush">No invoices yet.</div>'}
            </section>
            ${eventPortal || `<section class="cd-card" aria-labelledby="cdPortalTitle">
              <div class="cd-card-head"><h3 class="cd-card-title" id="cdPortalTitle">Portal access</h3>${portalStatus}</div>
              ${portalPw ? `
                <div class="cd-portal-line"><span>Login email</span><span data-user-content>${esc(portalEmail)}</span></div>
                <div class="cd-portal-line"><span>Password</span><span>Set</span></div>
                <div class="cd-portal-actions">
                  <button type="button" class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}',this)">${_clIcon('send', 16)} Send login</button>
                  <button type="button" class="btn btn-secondary" onclick="copyToClipboard(document.getElementById('cdInviteMsg').textContent)">${_clIcon('copy', 16)} Copy invite</button>
                  <button type="button" class="btn btn-ghost" id="clientPortalDisabled" onclick="toggleClientPortalDisabled('${clientId}',${portalDisabled ? 'false' : 'true'})">${portalDisabled ? 'Turn access on' : 'Turn access off'}</button>
                </div>` : `
                <div class="as-hint cd-flush">No portal login yet. Open Email and password to set one.</div>
                <div class="cd-portal-actions"><button type="button" class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}',this)">${_clIcon('send', 16)} Send login</button></div>`}
              <details class="cd-more">
                <summary>Email and password</summary>
                <div class="field cd-first"><label class="field-label" for="clientPortalEmail">Portal email</label><input type="email" class="input form-input" id="clientPortalEmail" value="${esc(portalEmail)}" placeholder="${esc(client.email||'client@email.com')}" data-user-content></div>
                <div class="field"><label class="field-label" for="clientPortalPassword">Portal password</label>
                  <div class="cd-pw">
                    <input type="text" class="input form-input" id="clientPortalPassword" value="${esc(portalPw)}" placeholder="No password set" autocomplete="off" spellcheck="false">
                    <button type="button" class="btn btn-secondary btn-icon" onclick="generateClientPortalPassword()" aria-label="Generate a new password">${_clIcon('refresh-cw', 18)}</button>
                    ${portalPw ? `<button type="button" class="btn btn-secondary btn-icon" onclick="copyToClipboard(document.getElementById('clientPortalPassword').value)" aria-label="Copy password">${_clIcon('copy', 18)}</button>` : ''}
                  </div>
                </div>
                <button type="button" class="btn btn-secondary" onclick="saveClientPortalCredentials('${clientId}')">Save login</button>
                ${portalPw ? `<div class="section-label cd-subhead">Invite message</div><pre class="cd-invite" id="cdInviteMsg" data-user-content>${esc(cpInviteMsg)}</pre>` : ''}
              </details>
              ${portalPw ? '' : '<pre id="cdInviteMsg" hidden></pre>'}
            </section>`}
          </div>
        </div>`;

      // ── Events panel ──
      const eventsPanel = clientEvents.length
        ? `<div class="row-list">${byDate.map(e => {
            const d = _clDateParts(e.date);
            const sub = [d ? _clDateList(e.date) : '', e.startTime && window.CRMUI ? CRMUI.fmt.time(e.startTime) : '', e.venueName].filter(Boolean).join(' · ');
            return `<a class="row row-event" href="#/event/${esc(e.id)}" onclick="event.preventDefault();navigateToEvent('${e.id}')">
              <span class="date-block" aria-hidden="true"><span class="dow">${d ? d.toLocaleDateString('en-US', { weekday: 'short' }) : ''}</span><span class="day">${d ? d.getDate() : '?'}</span></span>
              <span class="row-main"><span class="row-title" data-user-content>${esc(e.name)}</span><span class="row-sub" data-user-content>${esc(sub || 'Date not set')}</span></span>
              <span class="row-trail">${_clStatusPill(e.status)}${_clIcon('chevron-right', 18)}</span>
            </a>`;
          }).join('')}</div>`
        : `<div class="empty">${_clIcon('calendar', 32)}<h3 class="empty-title">No events yet</h3><p class="empty-text">Events for this client show up here.</p><button type="button" class="btn btn-secondary" onclick="_clNewEvent('${clientId}')">New event</button></div>`;

      // ── Messages panel ──
      const threads = clientEvents.map(e => ({ ev: e, msgs: (e.messages || []).slice().sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0)) })).filter(t => t.msgs.length)
        .sort((a, b) => new Date(b.msgs[b.msgs.length - 1].ts || 0) - new Date(a.msgs[a.msgs.length - 1].ts || 0));
      const fmtTs = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
      const messagesPanel = threads.length
        ? threads.map(t => {
            const shown = t.msgs.slice(-5);
            return `<div class="cd-group"><div class="section-label" data-user-content>${esc(t.ev.name)}</div><button type="button" class="btn btn-ghost btn-sm" onclick="_clOpenEvent('${t.ev.id}','messages')">Open thread</button></div>
              <div class="cd-list">${t.msgs.length > shown.length ? `<div class="as-hint cd-flush">Showing the latest ${shown.length} of ${t.msgs.length}.</div>` : ''}${shown.map(m => {
                const fromClient = m.from === 'client';
                return `<div class="cd-msg ${fromClient ? 'is-client' : ''}"><div class="cd-msg-head"><strong data-user-content>${fromClient ? esc(_cpFirst === 'there' ? 'Client' : _cpFirst) : 'Baseline'}</strong><span>${esc(fmtTs(m.ts))}</span>${fromClient && !m.read ? '<span class="pill pill-sm pill-info" data-ui="pill">New</span>' : ''}</div><div class="cd-msg-text" data-user-content>${esc(m.text)}</div></div>`;
              }).join('')}</div>`;
          }).join('')
        : `<div class="empty">${_clIcon('message-square', 32)}<h3 class="empty-title">No messages yet</h3><p class="empty-text">Messages from this client's portal show up here.</p></div>`;

      // ── Files panel ──
      const fileRows = [];
      clientEvents.forEach(e => {
        const list = (e.docs && e.docs.length) ? e.docs : (e.documents || []);
        list.forEach(doc => {
          let pill;
          if (doc.clientSignature || doc.clientSignedAt) pill = '<span class="pill pill-sm pill-ok" data-ui="pill">Signed</span>';
          else if (doc.requiresSignature) pill = '<span class="pill pill-sm pill-warn" data-ui="pill">To sign</span>';
          else if (doc.signedAt) pill = '<span class="pill pill-sm pill-ok" data-ui="pill">Signed</span>';
          else if (doc.sharedWithClient || doc.sharedAt) pill = '<span class="pill pill-sm pill-info" data-ui="pill">Shared</span>';
          else pill = '<span class="pill pill-sm pill-neutral" data-ui="pill">Draft</span>';
          fileRows.push(`<button type="button" class="row" onclick="_clOpenEvent('${e.id}','documents')">
            <span class="row-ic">${_clIcon('file-text', 20)}</span>
            <span class="row-main"><span class="row-title" data-user-content>${esc(doc.name || doc.label || 'Document')}</span><span class="row-sub" data-user-content>${esc(e.name)}</span></span>
            <span class="row-trail">${pill}${_clIcon('chevron-right', 18)}</span>
          </button>`);
        });
      });
      const filesPanel = fileRows.length
        ? `<div class="row-list">${fileRows.join('')}</div>`
        : `<div class="empty">${_clIcon('file-text', 32)}<h3 class="empty-title">No documents yet</h3><p class="empty-text">Contracts and files for this client's events show up here.</p></div>`;

      const tabBtn = (id, label, extra) => `<button type="button" class="tab-btn${activeTab === id ? ' active' : ''}" role="tab" id="cdTabBtn-${id}" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? '0' : '-1'}" aria-controls="cdTab-${id}" onclick="switchClientDetailTab(this,'${id}')">${label}${extra || ''}</button>`;

      const html = `<div class="detail-page" data-client-id="${clientId}">
        <button type="button" class="cd-back" onclick="goBack()" aria-label="Back to clients">${_clIcon('chevron-left', 20)} Clients</button>
        <div class="cd-head">
          <div class="cd-id">
            <span class="avatar" aria-hidden="true">${esc(_clInitials(client.name))}</span>
            <div>
              <h2 class="cd-title" data-user-content>${esc(client.name)}</h2>
              <div class="cd-meta">${esc(metaBits.join(' · '))}</div>
            </div>
          </div>
          <div class="cd-actions">
            <button type="button" class="btn btn-primary cd-primary" onclick="_clNewEvent('${clientId}')">${_clIcon('plus', 18)} New event</button>
            ${client.email ? `<a href="mailto:${esc(client.email)}" class="btn btn-secondary">${_clIcon('mail', 16)} Email</a>` : ''}
            ${client.phone ? `<a href="tel:${esc(_clTel(client.phone))}" class="btn btn-secondary">${_clIcon('phone', 16)} Call</a>` : ''}
            <button type="button" class="btn btn-ghost btn-icon" onclick="openClientMenu(this,'${clientId}')" aria-label="More actions">${_clIcon('ellipsis', 20)}</button>
          </div>
        </div>
        <div class="tabs" role="tablist" aria-label="Client sections">
          ${tabBtn('overview', 'Overview')}
          ${tabBtn('events', 'Events', `<span class="cd-tab-n">${evCount}</span>`)}
          ${tabBtn('messages', 'Messages', unread ? `<span class="pill pill-sm pill-info cd-tab-badge" data-ui="pill">${unread} new</span>` : '')}
          ${tabBtn('files', 'Files')}
        </div>
        <div class="cd-panel" role="tabpanel" id="cdTab-overview" aria-labelledby="cdTabBtn-overview" ${activeTab === 'overview' ? '' : 'hidden'}>${overview}</div>
        <div class="cd-panel" role="tabpanel" id="cdTab-events" aria-labelledby="cdTabBtn-events" ${activeTab === 'events' ? '' : 'hidden'}>${eventsPanel}</div>
        <div class="cd-panel" role="tabpanel" id="cdTab-messages" aria-labelledby="cdTabBtn-messages" ${activeTab === 'messages' ? '' : 'hidden'}>${messagesPanel}</div>
        <div class="cd-panel" role="tabpanel" id="cdTab-files" aria-labelledby="cdTabBtn-files" ${activeTab === 'files' ? '' : 'hidden'}>${filesPanel}</div>
      </div>`;

      return html;
    }

    function switchClientDetailTab(btn, tab) {
      const root = btn.closest('.detail-page') || document;
      root.querySelectorAll('.tabs .tab-btn').forEach(b => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      root.querySelectorAll('.cd-panel').forEach(p => { p.hidden = p.id !== 'cdTab-' + tab; });
    }

    // Open an event from the client page, optionally on a given tab (the tab button is clicked after the page renders)
    function _clOpenEvent(eventId, tab) {
      navigateToEvent(eventId);
      if (!tab) return;
      setTimeout(function() {
        const b = document.querySelector('#detailContent .tab-btn[onclick*="\'' + tab + '\'"]');
        if (b) b.click();
      }, 0);
    }

    // New event from the client page; preselects this client in the wizard when the wizard has a client picker
    function _clNewEvent(clientId) {
      if (typeof openNewEventModal !== 'function') return;
      openNewEventModal();
      const sel = document.getElementById('wizardClientSelect');
      if (sel && Array.prototype.some.call(sel.options, o => o.value === clientId)) {
        sel.value = clientId;
        if (typeof selectWizardClient === 'function') selectWizardClient(clientId);
      }
    }

    function openClientMenu(anchor, clientId) {
      if (!window.CRMUI || !CRMUI.menu) return;
      CRMUI.menu(anchor, [
        { label: 'Archive client', icon: 'package', danger: true, onSelect: function() { deleteClient(clientId); } }
      ], { label: 'Client actions', align: 'right' });
    }

    function navigateToClient(clientId) {
      const active = document.querySelector('.section.active');
      if (active && active.id !== 'detail') _detailReturnSection = active.id;
      showClientPage(clientId);
    }

    // ── Add client modal ──────────────────────────────────────────────────
    function _clAddClientFormHtml() {
      return `
        <p class="cl-modal-sub">Just the basics. You can add the rest later.</p>
        <div class="field"><label class="field-label" for="newClientName">Name</label><input type="text" class="input form-input" id="newClientName" required autocomplete="off" placeholder="Maria &amp; Carlos Diaz"></div>
        <div class="cl-row2">
          <div class="field"><label class="field-label" for="newClientPhone">Phone</label><input type="tel" class="input form-input" id="newClientPhone" data-norm="phone" placeholder="(305) 555-0142"></div>
          <div class="field"><label class="field-label" for="newClientEmail">Email</label><input type="email" class="input form-input" id="newClientEmail" data-norm="email" placeholder="name@email.com"></div>
        </div>
        <div class="field"><label class="field-label" for="newClientType">Type</label><select class="input form-select" id="newClientType"><option value="private" selected>Private</option><option value="corporate">Corporate</option></select></div>
        <details class="cd-more cl-more">
          <summary>Add a company or agency</summary>
          <div class="field cd-first"><label class="field-label" for="newClientCompany">Company or agency</label><input type="text" class="input form-input" id="newClientCompany" autocomplete="off" placeholder="Optional"></div>
        </details>
        <div class="field-msg" id="newClientErr" role="alert" hidden></div>
        <div class="cl-foot">
          <button type="button" class="btn btn-secondary" onclick="closeModal('addClientModal')">Cancel</button>
          <button type="submit" class="btn btn-primary">Add client</button>
        </div>`;
    }

    function openAddClientModal() {
      const form = document.getElementById('addClientForm');
      if (!form) return;
      form.innerHTML = _clAddClientFormHtml();
      form.setAttribute('novalidate', '');
      form.oninput = function(ev) {
        if (ev.target && ev.target.removeAttribute) ev.target.removeAttribute('aria-invalid');
        const box = document.getElementById('newClientErr');
        if (box) box.hidden = true;
      };
      const title = document.querySelector('#addClientModal .modal-title');
      if (title) title.textContent = 'Add client';
      openModal('addClientModal');
    }

    function _clAddClientError(msg, fieldId) {
      document.querySelectorAll('#addClientForm [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
      const box = document.getElementById('newClientErr');
      if (box) { box.textContent = msg; box.hidden = false; }
      const f = fieldId && document.getElementById(fieldId);
      if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
    }

    function saveNewClient(e) {
      e.preventDefault();
      const clients = getDB('clients') || [];
      const name = document.getElementById('newClientName').value.trim();
      if (!name) { _clAddClientError('Add a name to save this client.', 'newClientName'); return; }

      let email = document.getElementById('newClientEmail').value.trim();
      let phone = document.getElementById('newClientPhone').value.trim();
      if (window.CRMUI && CRMUI.norm) {
        if (email) {
          const ne = CRMUI.norm.email(email);
          if (!ne.ok) { _clAddClientError(ne.message || 'That email does not look right.', 'newClientEmail'); return; }
          email = ne.value;
        }
        if (phone) {
          const np = CRMUI.norm.phone(phone);
          if (np.ok && np.echo) phone = np.echo;
        }
      }
      const dup = email && clients.find(c => (c.email || '').toLowerCase() === email.toLowerCase());
      if (dup) { _clAddClientError(dup.name + ' already uses that email.', 'newClientEmail'); return; }

      const newClient = {
        id: genId(),
        name:    name,
        email:   email,
        phone:   phone,
        type:    document.getElementById('newClientType').value || 'private',
        company: (document.getElementById('newClientCompany')?.value || '').trim(),
        createdAt: Date.now()
      };
      clients.push(newClient);
      setDB('clients', clients);
      closeModal('addClientModal');
      renderClients();
      document.getElementById('addClientForm').reset();
      showToast('Client added', 'success');
    }

    // ── Clients list ──────────────────────────────────────────────────────
    function renderClients() {
      const mount = document.getElementById('clientsListMount');
      if (!mount) return;
      // Only show actual clients (private and corporate), not planners, venues, or other contact types
      const all = (getDB('clients') || []).filter(c => !c.archived && (!c.type || c.type === 'private' || c.type === 'corporate'));
      const raw = document.getElementById('clientsSearch')?.value || '';
      const q = _clFold(raw).trim();
      const qDigits = q.replace(/\D/g, '');
      let clients = all.slice().sort((a, b) => _clFold(a.name).localeCompare(_clFold(b.name)));
      if (q) {
        clients = clients.filter(c => _clFold([c.name, c.email, c.company, c.phone].join(' ')).includes(q)
          || (qDigits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(qDigits)));
      }

      if (!all.length) {
        mount.innerHTML = `<div class="empty">${_clIcon('users', 32)}<h3 class="empty-title">No clients yet</h3><p class="empty-text">Add a client here, or start an event and add them there.</p><button type="button" class="btn btn-secondary" onclick="openAddClientModal()">Add client</button></div>`;
        return;
      }
      if (!clients.length) {
        mount.innerHTML = `<div class="empty">${_clIcon('search', 32)}<h3 class="empty-title">No clients match that search</h3><p class="empty-text">Try a name, email, or phone number.</p><button type="button" class="btn btn-secondary" onclick="var s=document.getElementById('clientsSearch');s.value='';renderClients();s.focus()">Clear search</button></div>`;
        return;
      }

      const events = getDB('events') || [];
      const countFor = c => events.filter(e => e.clientId === c.id || (e.linkedClients && e.linkedClients.includes(c.id))).length;
      let rows = '', cards = '';
      clients.forEach(c => {
        const n = countFor(c);
        const phone = _clPhone(c.phone);
        const nameCell = `<div class="cl-cell"><span class="avatar" aria-hidden="true">${esc(_clInitials(c.name))}</span><div><div class="cl-name" data-user-content>${esc(c.name)}</div>${c.company ? `<div class="cl-sub" data-user-content>${esc(c.company)}</div>` : ''}</div></div>`;
        rows += `<tr tabindex="0" onclick="openClientDetail('${c.id}')" onkeydown="if(event.key==='Enter'){openClientDetail('${c.id}')}">
          <td>${nameCell}</td>
          <td class="meta" data-user-content>${c.email ? esc(c.email) : '<span class="t-meta">Not added</span>'}</td>
          <td data-user-content>${phone ? esc(phone) : '<span class="t-meta">Not added</span>'}</td>
          <td>${_clTypePill(c.type)}</td>
          <td class="num">${n}</td>
          <td class="cl-go" aria-hidden="true">${_clIcon('chevron-right', 18)}</td>
        </tr>`;
        cards += `<a class="row" href="#/client/${esc(c.id)}" onclick="event.preventDefault();openClientDetail('${c.id}')">
          <span class="avatar avatar-40" aria-hidden="true">${esc(_clInitials(c.name))}</span>
          <span class="row-main"><span class="row-title" data-user-content>${esc(c.name)}</span><span class="row-sub" data-user-content>${esc(c.email || phone || 'No contact info')}</span>${c.email && phone ? `<span class="row-sub" data-user-content>${esc(phone)}</span>` : ''}</span>
          <span class="row-trail"><span class="t-meta">${n} ${n === 1 ? 'event' : 'events'}</span>${_clIcon('chevron-right', 18)}</span>
        </a>`;
      });

      mount.innerHTML = `<p class="cl-count">${clients.length} ${clients.length === 1 ? 'client' : 'clients'}${q ? ' found' : ''}</p>
        <div class="tbl-wrap"><table class="tbl" id="clientsTable">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Type</th><th class="num">Events</th><th aria-label="Open"></th></tr></thead>
          <tbody id="clientsTableBody">${rows}</tbody>
        </table></div>
        <div class="row-list">${cards}</div>`;
    }

    function openClientDetail(clientId) {
      navigateToClient(clientId);
    }

    function saveClientChanges(clientId) {
      const clients = getDB('clients');
      const client = clients.find(c => c.id === clientId);
      if (!client) return;
      const nameEl = document.getElementById('editClientName2');
      if (nameEl && !nameEl.value.trim()) { showToast('A client needs a name', 'error'); nameEl.focus(); return; }
      let email = document.getElementById('editClientEmail2').value.trim();
      let phone = document.getElementById('editClientPhone2').value.trim();
      if (window.CRMUI && CRMUI.norm) {
        if (email) {
          const ne = CRMUI.norm.email(email);
          if (!ne.ok) { showToast(ne.message || 'That email does not look right', 'error'); document.getElementById('editClientEmail2').focus(); return; }
          email = ne.value;
        }
        if (phone) { const np = CRMUI.norm.phone(phone); if (np.ok && np.echo) phone = np.echo; }
      }
      const oldEmail = (client.email || '').trim().toLowerCase();
      client.name    = nameEl.value.trim() || client.name;
      client.email   = email;
      client.phone   = phone;
      client.type    = document.getElementById('editClientType').value;
      client.company = document.getElementById('editClientCompany').value.trim();
      setDB('clients', clients);
      // An email change has to reach this client's events (by client id only), or the portal login and invites point at the old address
      const newEmail = email.toLowerCase();
      if (newEmail !== oldEmail) {
        const events = getDB('events') || [];
        let moved = 0;
        events.filter(e => e.clientId === clientId).forEach(ev => {
          ev.clientEmail = email;
          if (!ev.portalEmail || String(ev.portalEmail).trim().toLowerCase() === oldEmail) ev.portalEmail = email;
          moved++;
        });
        if (moved) setDB('events', events);
      }
      showToast('Saved', 'success');
      renderClients(); // keep background list fresh
      showClientPage(clientId, 'overview'); // refresh the detail page with updated info
    }

    function saveClientNotes(clientId) {
      const ta = document.getElementById('clientNotes');
      if (!ta) return;
      const clients = getDB('clients');
      const client = clients.find(c => c.id === clientId);
      if (!client || (client.notes || '') === ta.value) return;
      const host = document.getElementById('cdNotesSave');
      const pill = host && window.CRMUI && CRMUI.savePill ? CRMUI.savePill(host) : null;
      if (host) host.hidden = false;
      if (pill) pill.set('saving');
      client.notes = ta.value;
      setDB('clients', clients);
      if (pill) pill.set('saved');
    }

    // Archiving is a soft delete: the record stays (notes, contact info, history) and comes back with Undo or from storage. Events are untouched.
    function deleteClient(clientId) {
      const clients = getDB('clients') || [];
      const client = clients.find(c => c.id === clientId);
      if (!client) return;
      client.archived = true;
      client.archivedAt = Date.now();
      setDB('clients', clients);
      goBack(); // return to clients list
      renderClients();
      showUndoToast('Client archived. Their events stay.', function() {
        const cur = getDB('clients') || [];
        const c = cur.find(x => x.id === clientId);
        if (c) { c.archived = false; delete c.archivedAt; setDB('clients', cur); }
        renderClients();
      });
    }

    // Send portal invite using the client's actual event credentials
    async function sendClientPortalInvite(clientId, triggerEl) {
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      if (!client.email) { showToast('No email on record. Add one first.', 'error'); return; }

      // Find their most recent event with portal credentials
      const events = getDB('events') || [];
      const ev = events.filter(e => e.clientId === clientId || e.clientEmail === client.email)
                       .sort((a,b) => new Date(b.date) - new Date(a.date))[0];

      const email    = client.email;
      const name     = client.name;
      const pass     = ev?.portalPassword || ev?.portalEmail ? ev.portalPassword : null;
      const eventName = ev?.name || 'your event';
      const eventDate = ev?.date || '';

      const fallbackMsg = `Hi ${name},\n\nYour Baseline Studio client portal is ready.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${email}\nPassword: ${pass || '(set in the event portal tab)'}\n\nReach out if you need anything.\n\nSaul, Baseline Studio`;

      if (!pass) {
        // No event credentials found: show fallback right away
        showEmailFallback(email, 'Your Baseline Studio Portal', fallbackMsg, 'No portal password found. Open the event, go to the Portal tab, and set credentials first.');
        return;
      }

      const sendBtn = triggerEl || null;
      if (sendBtn) { sendBtn.setAttribute('aria-busy', 'true'); sendBtn.setAttribute('aria-disabled', 'true'); sendBtn.disabled = true; }

      const result = await BSPortal.sendEmail('client_invite', { email, clientName: name, password: pass, eventName, eventDate });

      if (sendBtn) { sendBtn.removeAttribute('aria-busy'); sendBtn.removeAttribute('aria-disabled'); sendBtn.disabled = false; }

      if (result?.ok) {
        showToast('Portal invite sent to ' + email, 'success');
      } else {
        showEmailFallback(email, 'Your Baseline Studio Portal', fallbackMsg, 'Email failed. Use one of these instead:');
      }
    }

    //
    //  PORTAL USERS MANAGEMENT
    //  (the Portal users tab is gone from Clients; every client's portal lives on their event. These stay for the detail view and old links.)
    //
    function renderPortalUsers() {
      const body = document.getElementById('portalUsersTableBody');
      if (!body) return; // the table no longer exists on the Clients page
      const users = getDB('portalUsers') || [];
      let html = '';
      users.forEach(u => {
        const eventDate = new Date(u.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        html += `<tr onclick="openPortalUserDetail('${u.id}')" style="cursor:pointer;">
          <td data-user-content>${esc(u.fullName)}</td>
          <td data-user-content><a href="mailto:${esc(u.email)}" onclick="event.stopPropagation()" class="cd-link">${esc(u.email)}</a></td>
          <td><span class="pill pill-sm pill-neutral" data-ui="pill">${esc(_clLabel(u.eventType))}</span></td>
          <td>${eventDate}</td>
          <td><span class="pill pill-sm pill-ok" data-ui="pill">Active</span></td>
          <td>
            <div style="display:flex;gap:6px;" onclick="event.stopPropagation()">
              <button class="btn btn-secondary btn-sm" data-name="${esc(u.fullName)}" data-email="${esc(u.email)}" onclick="sendLoginInfo('client',{name:this.dataset.name,email:this.dataset.email})">Resend</button>
              <button class="btn btn-secondary btn-sm" onclick="editPortalUser('${u.id}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deletePortalUser('${u.id}')">Delete</button>
            </div>
          </td>
        </tr>`;
      });
      body.innerHTML = html || '<tr><td colspan="6"><div class="empty-state">No portal users yet. <button class="btn btn-secondary" style="margin-left:10px;" onclick="openAddPortalUserModal()">Add portal user</button></div></td></tr>';
    }

    function openPortalUserDetail(userId) {
      const users = getDB('portalUsers') || [];
      const u = users.find(x => x.id === userId);
      if (!u) return;
      const d = new Date(u.eventDate);
      const eventDate = isNaN(d) ? 'Not set' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      document.getElementById('clientDetailContent').innerHTML = `
        <div class="modal-title" data-user-content>${esc(u.fullName)}</div>
        <dl class="pu-grid">
          <div><dt>Email</dt><dd data-user-content><a class="cd-link" href="mailto:${esc(u.email)}">${esc(u.email)}</a></dd></div>
          <div><dt>Event type</dt><dd><span class="pill pill-sm pill-neutral" data-ui="pill">${esc(_clLabel(u.eventType) || 'Other')}</span></dd></div>
          <div><dt>Event date</dt><dd>${esc(eventDate)}</dd></div>
        </dl>
        ${u.password ? `<div class="pu-pw"><span>Portal password</span><code data-user-content>${esc(u.password)}</code>
          <button type="button" class="btn btn-ghost btn-icon" data-pw="${esc(u.password)}" onclick="copyToClipboard(this.dataset.pw)" aria-label="Copy password">${_clIcon('copy', 18)}</button></div>` : ''}
        <div class="cl-foot">
          <button type="button" class="btn btn-secondary" data-name="${esc(u.fullName)}" data-email="${esc(u.email)}" onclick="sendLoginInfo('client',{name:this.dataset.name,email:this.dataset.email})">Resend login</button>
          <a href="mailto:${esc(u.email)}" class="btn btn-secondary">Email</a>
          <button type="button" class="btn btn-secondary" onclick="editPortalUser('${u.id}');closeModal('clientDetailModal')">Edit</button>
        </div>`;
      openModal('clientDetailModal');
    }

    function openAddPortalUserModal() {
      document.getElementById('addPortalUserForm').reset();
      openModal('addPortalUserModal');
    }

    function savePortalUser(e) {
      e.preventDefault();
      const users = getDB('portalUsers') || [];
      const newUser = {
        id: genId(),
        fullName: document.getElementById('userFullName').value,
        email: document.getElementById('userEmail').value,
        password: document.getElementById('userPassword').value,
        eventType: document.getElementById('userEventType').value,
        eventDate: document.getElementById('userEventDate').value,
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      setDB('portalUsers', users);
      closeModal('addPortalUserModal');
      renderPortalUsers();
      showToast('Portal user added', 'success');
    }

    function editPortalUser(userId) {
      const users = getDB('portalUsers') || [];
      const user = users.find(u => u.id === userId);
      if (!user) return;

      // Pre-fill form with user data
      document.getElementById('userFullName').value = user.fullName;
      document.getElementById('userEmail').value = user.email;
      document.getElementById('userPassword').value = user.password;
      document.getElementById('userEventType').value = user.eventType;
      document.getElementById('userEventDate').value = user.eventDate;

      // Change form submit to update instead of create
      const form = document.getElementById('addPortalUserForm');
      form.onsubmit = (e) => {
        e.preventDefault();
        user.fullName = document.getElementById('userFullName').value;
        user.email = document.getElementById('userEmail').value;
        user.password = document.getElementById('userPassword').value;
        user.eventType = document.getElementById('userEventType').value;
        user.eventDate = document.getElementById('userEventDate').value;
        setDB('portalUsers', users);
        form.onsubmit = null;
        closeModal('addPortalUserModal');
        renderPortalUsers();
        showToast('Portal user updated', 'success');
      };
      openModal('addPortalUserModal');
    }

    function deletePortalUser(userId) {
      const users = getDB('portalUsers') || [];
      const user = users.find(u => u.id === userId);
      if (!user) return;
      const idx = users.indexOf(user);
      setDB('portalUsers', users.filter(u => u.id !== userId));
      renderPortalUsers();
      showUndoToast('Portal user removed.', function() {
        const cur = getDB('portalUsers') || [];
        if (!cur.some(u => u.id === user.id)) { cur.splice(Math.min(idx, cur.length), 0, user); setDB('portalUsers', cur); }
        renderPortalUsers();
      });
    }

    // ── Assign accounts (crew and client accounts on one event) ──────────────
    // Crew = the staff roster plus login accounts that are not on it. Saved as ev.assignedAccounts (ids), ev.staff (login ids, so a DJ sees the event)
    // and ev.assignedTeam (name + role, shown to the client). Client accounts = primary client and linked planners, venues, and so on.
    function _clCrewPeople() {
      const roster = getDB('staffroster') || [];
      const users = (getDB('users') || []).filter(u => u.active !== false);
      const byEmail = {};
      users.forEach(u => { if (u.email) byEmail[String(u.email).toLowerCase()] = u; });
      const onRoster = {};
      const people = roster.map(s => {
        const em = s.email ? String(s.email).toLowerCase() : '';
        const u = em ? byEmail[em] : null;
        if (em) onRoster[em] = true;
        return { id: s.id, userId: u ? u.id : '', name: s.name || 'Unnamed', role: s.title || s.role || 'Crew' };
      });
      users.forEach(u => {
        if (u.email && onRoster[String(u.email).toLowerCase()]) return;
        const role = String(u.role || 'Team').replace(/-/g, ' ');
        people.push({ id: u.id, userId: u.id, name: u.name || (u.email || 'Team member').split('@')[0], role: role.charAt(0).toUpperCase() + role.slice(1) });
      });
      return people;
    }

    function _clAssignTab(btn, which) {
      const root = document.getElementById('assignAccountContent');
      root.querySelectorAll('.as-seg .seg-btn').forEach(b => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      document.getElementById('asCrew').hidden = which !== 'crew';
      document.getElementById('asClients').hidden = which !== 'clients';
    }

    function openAssignAccountModal(eventId, tab) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const linked = new Set(ev.linkedClients || []);
      const clients = (getDB('clients') || []).filter(c => !c.archived || c.id === ev.clientId || linked.has(c.id));
      const people = _clCrewPeople();
      const mine = new Set(ev.assignedAccounts || []);
      const staffIds = new Set(ev.staff || []);
      const startOn = tab === 'clients' ? 'clients' : 'crew';

      const crewRows = people.length ? people.map((p, i) => {
        const on = mine.has(p.id) || (p.userId && (mine.has(p.userId) || staffIds.has(p.userId)));
        return `<label class="check as-row"><input type="checkbox" name="asCrew" value="${esc(p.id)}" ${on ? 'checked' : ''}><span class="check-box"></span>
          <span class="as-main"><span class="as-name" data-user-content>${esc(p.name)}</span><span class="as-meta" data-user-content>${esc(p.role)}</span></span></label>`;
      }).join('') : '<div class="as-empty">No crew yet. Add people under Team, then pick them here.</div>';

      const hasPrimary = clients.some(c => c.id === ev.clientId);
      const primaryOpts = (hasPrimary ? '' : '<option value="">Not set</option>')
        + clients.map(c => `<option value="${esc(c.id)}" ${ev.clientId === c.id ? 'selected' : ''}>${esc(c.name)}${c.company ? ', ' + esc(c.company) : ''}</option>`).join('');
      const linkRows = clients.filter(c => c.id !== ev.clientId).map(c => `<label class="check as-row"><input type="checkbox" name="asLinked" value="${esc(c.id)}" ${linked.has(c.id) ? 'checked' : ''}><span class="check-box"></span>
          <span class="as-main"><span class="as-name" data-user-content>${esc(c.name)}</span><span class="as-meta" data-user-content>${esc([c.company, _clLabel(c.type)].filter(Boolean).join(' · '))}</span></span></label>`).join('');

      const d = _clDateParts(ev.date);
      const sub = [ev.name, d ? _clDateList(ev.date) : ''].filter(Boolean).join(' · ');

      document.getElementById('assignAccountContent').innerHTML = `
        <div class="modal-title">Assign accounts</div>
        <p class="cl-modal-sub" data-user-content>${esc(sub)}</p>
        <div class="seg as-seg" role="tablist" aria-label="Accounts">
          <button type="button" class="seg-btn${startOn === 'crew' ? ' active' : ''}" role="tab" aria-selected="${startOn === 'crew'}" onclick="_clAssignTab(this,'crew')">Crew</button>
          <button type="button" class="seg-btn${startOn === 'clients' ? ' active' : ''}" role="tab" aria-selected="${startOn === 'clients'}" onclick="_clAssignTab(this,'clients')">Client accounts</button>
        </div>
        <div id="asCrew" ${startOn === 'crew' ? '' : 'hidden'}>
          <p class="as-hint">Pick who is working this event. They see it on their schedule.</p>
          <div class="as-list">${crewRows}</div>
        </div>
        <div id="asClients" ${startOn === 'clients' ? '' : 'hidden'}>
          <div class="field"><label class="field-label" for="assignPrimaryClient">Primary client</label><select class="input form-select" id="assignPrimaryClient">${primaryOpts}</select></div>
          <p class="as-hint">Also linked to this event: planners, coordinators, venues.</p>
          <div class="as-list">${linkRows || '<div class="as-empty">No other client accounts to link.</div>'}</div>
        </div>
        <div class="cl-foot">
          <button type="button" class="btn btn-secondary" onclick="closeModal('assignAccountModal')">Cancel</button>
          <button type="button" class="btn btn-primary" id="assignSave" onclick="saveAssignedAccounts('${eventId}')">Save</button>
        </div>`;

      openModal('assignAccountModal');
    }

    function saveAssignedAccounts(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const people = _clCrewPeople();
      const picked = Array.prototype.map.call(document.querySelectorAll('#assignAccountModal input[name="asCrew"]:checked'), i => i.value);
      const pickedPeople = people.filter(p => picked.includes(p.id));
      const knownIds = new Set();
      people.forEach(p => { knownIds.add(p.id); if (p.userId) knownIds.add(p.userId); });
      const knownNames = new Set(people.map(p => p.name));

      ev.assignedAccounts = (ev.assignedAccounts || []).filter(id => !knownIds.has(id)).concat(pickedPeople.map(p => p.id));
      ev.staff = (ev.staff || []).filter(id => !knownIds.has(id)).concat(pickedPeople.map(p => p.userId).filter(Boolean));
      // Entries carry the person's id so a rename never leaves a duplicate; old name-only entries are matched by name once, then replaced
      ev.assignedTeam = (Array.isArray(ev.assignedTeam) ? ev.assignedTeam : []).filter(m => m && (m.id ? !knownIds.has(m.id) : !knownNames.has(m.name)))
        .concat(pickedPeople.map(p => ({ id: p.id, name: p.name, role: p.role })));

      // Client accounts
      const clients = getDB('clients') || [];
      const sel = document.getElementById('assignPrimaryClient');
      const linkedPicked = Array.prototype.map.call(document.querySelectorAll('#assignAccountModal input[name="asLinked"]:checked'), i => i.value);
      let note = '';
      if (sel && sel.value && sel.value !== ev.clientId) {
        const oldId = ev.clientId, oldEmail = String(ev.clientEmail || '').trim().toLowerCase();
        const cl = clients.find(c => c.id === sel.value);
        ev.clientId = sel.value;
        if (cl) {
          ev.clientName = cl.name;
          ev.clientEmail = cl.email || '';
          ev.clientPhone = cl.phone || '';
          // The portal login follows the new primary unless someone set a custom login email
          if (!ev.portalEmail || String(ev.portalEmail).trim().toLowerCase() === oldEmail) ev.portalEmail = cl.email || '';
          if (ev.portalPassword) note = cl.email ? ' Portal login now uses ' + cl.email + '. Send them the login.' : ' The new client has no email, so add one before sending a login.';
        }
        // The old primary is never dropped: they stay linked and can be unlinked from this sheet later
        if (oldId && !linkedPicked.includes(oldId)) linkedPicked.push(oldId);
      }
      ev.linkedClients = linkedPicked.filter(id => id !== ev.clientId);

      setDB('events', events);
      closeModal('assignAccountModal');
      showToast('Accounts saved.' + note, note ? 'warning' : 'success');
      renderEvents();
      // If this event's page is open, redraw it on the same tab so the Crew card and Client card show the change
      try {
        if (typeof _route !== 'undefined' && _route && _route.type === 'event' && _route.id === eventId && typeof showEventPage === 'function') {
          const cur = document.querySelector('#detailContent .tab-btn.active');
          const m = cur && /switchEventTab\(this,\s*'([^']+)'/.exec(cur.getAttribute('onclick') || '');
          showEventPage(eventId, m ? m[1] : undefined);
        }
      } catch (err) { /* the list refresh above is enough */ }
    }
