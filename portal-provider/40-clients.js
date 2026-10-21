// ============================================================================
// portal-provider/40-clients.js  -  clients: list, client page, client portal credentials/invites, portal users, linked accounts
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Client-level portal management (called from client profile page) ─────
    function saveClientPortalCredentials(clientId) {
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      const newEmail = (document.getElementById('clientPortalEmail')?.value || '').trim();
      const newPass  = (document.getElementById('clientPortalPassword')?.value || '').trim();
      const baseEmail = client.email || '';
      if (!newEmail && !newPass) { showToast('Nothing to save', 'error'); return; }
      if (newPass) {
        // Canonical write path — syncs email + password across all client + event records
        setClientCredentials(baseEmail, newEmail || baseEmail, newPass);
      } else {
        // Email-only change (no password entered)
        const clients = getDB('clients');
        const events  = getDB('events');
        clients.forEach(c => { if (c.id === clientId) c.portalEmail = newEmail; });
        events.filter(e => e.clientId === clientId || (e.clientEmail||'').toLowerCase() === baseEmail.toLowerCase())
              .forEach(ev => { ev.portalEmail = newEmail; });
        setDB('clients', clients);
        setDB('events', events);
      }
      showToast('Portal credentials saved', 'success');
      showClientPage(clientId);
    }

    function generateClientPortalPassword() {
      const pw = genPortalPassword();
      const el = document.getElementById('clientPortalPassword');
      if (el) { el.value = pw; el.focus(); }
    }

    function toggleClientPortalDisabled(clientId, disabled) {
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      const baseEmail = (client.email || '').toLowerCase();
      const events = getDB('events');
      const affected = events.filter(e => e.clientId === clientId || (e.clientEmail||'').toLowerCase() === baseEmail);
      affected.forEach(ev => { ev.portalDisabled = disabled; });
      setDB('events', events);
      showToast(disabled ? 'Portal access disabled for all their events' : 'Portal access enabled', disabled ? 'warning' : 'success');
      showClientPage(clientId);
    }

    // ── Full-page client detail ────────────────────────────────────────────
    function showClientPage(clientId) {
      _detailReturnSection = _detailReturnSection === 'detail' ? 'clients' : (_detailReturnSection || 'clients');
      const clients = getDB('clients');
      const client = clients.find(c => c.id === clientId);
      if (!client) return;
      const events = getDB('events');
      const clientEvents = events.filter(e => e.clientId === clientId || (e.linkedClients && e.linkedClients.includes(clientId)));

      const portalEv    = clientEvents.sort((a,b) => new Date(b.date||0) - new Date(a.date||0)).find(e => e.portalPassword);
      const portalEmail = portalEv?.portalEmail || portalEv?.clientEmail || client.email || '';
      const portalPw    = portalEv?.portalPassword || '';
      const portalDisabled = !!portalEv?.portalDisabled;
      const _cpFirst    = (client.name || '').split(' ')[0] || 'there';
      const cpInviteMsg = portalPw
        ? `Hey ${_cpFirst},\n\nYour portal is ready. Log in to review your event details, timeline, and documents.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${portalEmail}\nPassword: ${portalPw}\n\nReach out if anything comes up.\n\nSaul, Baseline Studio`
        : '';
      const cpSafeMsg = cpInviteMsg.replace(/`/g,'\\`').replace(/\$/g,'\\$');

      const evCards = clientEvents.length
        ? clientEvents.map(e => {
            const evDate = e.date ? new Date(e.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
            return `<div onclick="navigateToEvent('${e.id}')"
              style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:var(--black-4);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:background 0.15s;"
              onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='var(--black-4)'">
              <div>
                <div style="font-size:14px;font-weight:600;">${e.name}</div>
                ${evDate ? `<div style="font-size:12px;color:var(--gray);margin-top:3px;">${evDate}${e.venueName ? ' · ' + e.venueName : ''}</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="badge badge-${e.status}">${e.status}</span>
                <span style="color:var(--gray);">→</span>
              </div>
            </div>`;
          }).join('')
        : `<div style="color:var(--gray);font-size:13px;padding:12px 0;">No events yet. <a href="#" onclick="event.preventDefault();goBack();openNewEventModal();" style="color:var(--cyan);">Create one →</a></div>`;

      const html = `<div class="detail-page">
        <div class="detail-breadcrumb" role="button" tabindex="0" onclick="goBack()">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          Clients
        </div>
        <div class="detail-page-header">
          <div class="detail-page-title">${client.name}</div>
          <div class="detail-page-actions">
            ${client.email ? `<a href="mailto:${client.email}" class="btn btn-secondary">✉ Email</a>` : ''}
            ${client.phone ? `<a href="tel:${client.phone}" class="btn btn-secondary">📞 Call</a>` : ''}
            <button class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}',this)" style="background:rgba(31,163,224,0.1);border-color:rgba(31,163,224,0.65);color:var(--cyan);">🔑 Send Login</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start;" id="clientDetailGrid">
          <!-- Left col -->
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:16px;">Client Info</div>
            <div class="grid-2" style="margin-bottom:16px;">
              <div class="form-group"><label class="form-label" for="editClientName2">Name</label><input type="text" class="form-input" value="${client.name}" id="editClientName2"></div>
              <div class="form-group"><label class="form-label" for="editClientType">Type</label><select class="form-select" id="editClientType"><option value="private" ${client.type==='private'||!client.type?'selected':''}>Private</option><option value="corporate" ${client.type==='corporate'?'selected':''}>Corporate</option></select></div>
            </div>
            <div class="grid-2" style="margin-bottom:16px;">
              <div class="form-group">
                <label class="form-label" for="editClientEmail2">Email</label>
                <input type="email" class="form-input" value="${client.email||''}" id="editClientEmail2">
                ${client.email ? `<a href="mailto:${client.email}" style="font-size:12px;color:var(--cyan);margin-top:4px;display:inline-block;">✉ ${client.email}</a>` : ''}
              </div>
              <div class="form-group">
                <label class="form-label" for="editClientPhone2">Phone</label>
                <input type="tel" class="form-input" value="${client.phone||''}" id="editClientPhone2">
                ${client.phone ? `<a href="tel:${client.phone}" style="font-size:12px;color:var(--cyan);margin-top:4px;display:inline-block;">📞 ${client.phone}</a>` : ''}
              </div>
            </div>
            <div class="form-group" style="margin-bottom:20px;"><label class="form-label" for="editClientCompany">Company / Notes</label><input type="text" class="form-input" value="${client.company||''}" id="editClientCompany" placeholder="Company name or notes…"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px;">
              <button class="btn btn-primary" onclick="saveClientChanges('${clientId}')">Save Changes</button>
              <button class="btn btn-secondary" onclick="deleteClient('${clientId}')" style="border-color:rgba(231,76,60,0.75);color:#e74c3c;">🗑 Delete</button>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);">Portal Access</div>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:${portalDisabled?'#ff6b6b':'var(--text-3)'};">
                <input type="checkbox" id="clientPortalDisabled" ${portalDisabled?'checked':''} onchange="toggleClientPortalDisabled('${clientId}',this.checked)" style="width:13px;height:13px;accent-color:var(--cyan);">
                ${portalDisabled ? 'Access disabled' : 'Disable access'}
              </label>
            </div>
            <div class="grid-2" style="margin-bottom:12px;">
              <div class="form-group" style="margin:0;">
                <label class="form-label" for="clientPortalEmail">Portal Email</label>
                <input type="email" class="form-input" id="clientPortalEmail" value="${portalEmail}" placeholder="${client.email||'client@email.com'}">
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label">Portal Password</label>
                <div style="display:flex;gap:6px;">
                  <input type="text" class="form-input" id="clientPortalPassword" value="${portalPw}" style="font-family:monospace;letter-spacing:.05em;flex:1;" placeholder="No password set">
                  <button class="btn btn-secondary" style="white-space:nowrap;padding:0 12px;" onclick="generateClientPortalPassword()" title="Generate new password">↺</button>
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
              <button class="btn btn-primary" onclick="saveClientPortalCredentials('${clientId}')">Save Credentials</button>
              ${portalPw ? `
                <button class="btn btn-secondary" onclick="copyToClipboard('${portalPw}')">📋 Copy Password</button>
                <button class="btn btn-secondary" onclick="copyToClipboard(\`${cpSafeMsg}\`)">✉ Copy Invite</button>
                <button class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}',this)" style="background:rgba(31,163,224,0.1);border-color:rgba(31,163,224,0.65);color:var(--cyan);">🔑 Send Login</button>
              ` : ''}
            </div>
            ${portalPw ? `
              <div style="background:var(--black-4);border:1px solid var(--border);border-radius:6px;padding:14px 16px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:8px;">Invite Preview</div>
                <pre style="font-size:12px;color:rgba(255,255,255,0.55);white-space:pre-wrap;line-height:1.6;margin:0;">${cpInviteMsg}</pre>
              </div>
            ` : `
              <div style="font-size:12px;color:var(--gray);padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:6px;">No portal yet — set credentials above to activate their access.</div>
            `}
          </div>

          <!-- Right col: events -->
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:16px;">Events (${clientEvents.length})</div>
            ${evCards}
          </div>
        </div>
      </div>`;

      document.getElementById('detailContent').innerHTML = html;
      _showDetailSection();
      _routeWrite({ type: 'client', id: clientId }, 'push');
    }

    function navigateToClient(clientId) {
      const active = document.querySelector('.section.active');
      if (active && active.id !== 'detail') _detailReturnSection = active.id;
      showClientPage(clientId);
    }

    function openAddClientModal() {
      document.getElementById('addClientForm').reset();
      openModal('addClientModal');
    }

    function saveNewClient(e) {
      e.preventDefault();
      const clients = getDB('clients') || [];
      const newClient = {
        id: genId(),
        name:    document.getElementById('newClientName').value.trim(),
        email:   document.getElementById('newClientEmail').value.trim(),
        phone:   document.getElementById('newClientPhone').value.trim(),
        type:    document.getElementById('newClientType').value,
        company: document.getElementById('newClientCompany').value.trim(),
        createdAt: Date.now()
      };
      clients.push(newClient);
      setDB('clients', clients);
      closeModal('addClientModal');
      renderClients();
      document.getElementById('addClientForm').reset();
      showToast('Client added', 'success');
    }

    function renderClients() {
      // Only show actual clients — private and corporate — not planners, venues, or other contact types
      let clients = (getDB('clients') || []).filter(c => !c.type || c.type === 'private' || c.type === 'corporate');
      const searchVal = document.getElementById('clientsSearch')?.value || '';
      if (searchVal) clients = clients.filter(c => (c.name || '').toLowerCase().includes(searchVal.toLowerCase()));

      const events = getDB('events');
      let html = '';
      clients.forEach(c => {
        const eventCount = events.filter(e => e.clientId === c.id).length;
        html += `<tr onclick="openClientDetail('${c.id}')"><td>${c.name}</td><td>${c.email}</td><td>${c.phone}</td><td>${c.type}</td><td>${eventCount}</td><td><button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;">View</button></td></tr>`;
      });
      document.getElementById('clientsTableBody').innerHTML = html || '<tr><td colspan="6"><div class="empty-state">No clients</div></td></tr>';
    }

    function openClientDetail(clientId) {
      navigateToClient(clientId);
    }

    // ── Old openClientDetail body kept as reference — no longer used ──────
    function _openClientDetailModal_UNUSED(clientId) {
      const clients = getDB('clients');
      const client = clients.find(c => c.id === clientId);
      if (!client) return;
      const events = getDB('events');
      const clientEvents = events.filter(e => e.clientId === clientId || (e.linkedClients && e.linkedClients.includes(clientId)));

      // Clickable event cards — close client modal, open the event
      let evHtml = clientEvents.length
        ? clientEvents.map(e => {
            const evDate = e.date ? new Date(e.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
            return `<div onclick="closeModal('clientDetailModal');openEventDetail('${e.id}')"
              style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--black-4);border-radius:6px;margin-bottom:6px;cursor:pointer;transition:background 0.15s;"
              onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='var(--black-4)'">
              <div>
                <div style="font-size:13px;font-weight:500;">${e.name}</div>
                ${evDate ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${evDate}</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="badge badge-${e.status}">${e.status}</span>
                <span style="color:var(--gray);font-size:14px;">→</span>
              </div>
            </div>`;
          }).join('')
        : '';

      // Portal credentials — pull from most recent event with a password set
      const portalEv = clientEvents.sort((a,b) => new Date(b.date||0) - new Date(a.date||0)).find(e => e.portalPassword);
      const portalEmail = portalEv?.portalEmail || portalEv?.clientEmail || client.email || '';
      const portalPw    = portalEv?.portalPassword || '';

      let html = `<div class="modal-title">${client.name}</div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label" for="editClientName2">Name</label><input type="text" class="form-input" value="${client.name}" id="editClientName2"></div>
          <div class="form-group"><label class="form-label" for="editClientType">Type</label><select class="form-select" id="editClientType"><option value="private" ${client.type==='private'||!client.type?'selected':''}>Private</option><option value="corporate" ${client.type==='corporate'?'selected':''}>Corporate</option></select></div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label" for="editClientEmail2">Email</label>
            <input type="email" class="form-input" value="${client.email || ''}" id="editClientEmail2">
            ${client.email ? `<a href="mailto:${client.email}" style="display:inline-block;margin-top:4px;font-size:12px;color:var(--cyan);">✉ ${client.email}</a>` : ''}
          </div>
          <div class="form-group">
            <label class="form-label" for="editClientPhone2">Phone</label>
            <input type="tel" class="form-input" value="${client.phone || ''}" id="editClientPhone2">
            ${client.phone ? `<a href="tel:${client.phone}" style="display:inline-block;margin-top:4px;font-size:12px;color:var(--cyan);">📞 ${client.phone}</a>` : ''}
          </div>
        </div>
        <div class="form-group"><label class="form-label" for="editClientCompany">Company / Notes</label><input type="text" class="form-input" value="${client.company || ''}" id="editClientCompany" placeholder="Company name or notes…"></div>
        <div style="display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="saveClientChanges('${clientId}')">Save Changes</button>
          ${client.email ? `<a href="mailto:${client.email}" class="btn btn-secondary">✉ Email Client</a>` : ''}
          <button class="btn btn-secondary" onclick="deleteClient('${clientId}')" style="border-color:rgba(231,76,60,0.75);color:#e74c3c;">🗑 Delete</button>
        </div>

        <!-- ── Portal Access ─────────────────────────────────────────── -->
        <div style="border-top:1px solid var(--border);padding-top:20px;margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:14px;">Portal Access</div>
          ${portalPw ? `
            <div style="background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.18);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="color:var(--gray);">Login email:</span>
                <code style="color:#2ecc71;">${portalEmail}</code>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--gray);">Password:</span>
                <div style="display:flex;align-items:center;gap:8px;">
                  <code style="color:#2ecc71;">${portalPw}</code>
                  <button onclick="copyToClipboard('${portalPw}')" style="background:none;border:none;color:var(--cyan);cursor:pointer;font-size:12px;">Copy</button>
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
              <button class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}', this)" style="background:rgba(31,163,224,0.1);border-color:rgba(31,163,224,0.65);color:var(--cyan);">🔑 Send Login Info</button>
              <button class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}', this, true)" style="background:rgba(243,156,18,0.08);border-color:rgba(243,156,18,0.55);color:#f39c12;">↺ Send Recovery Email</button>
            </div>` : `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--gray);">No portal yet — activates when their first event is created.</div>
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <button class="btn btn-secondary" onclick="sendClientPortalInvite('${clientId}', this)" style="background:rgba(31,163,224,0.1);border-color:rgba(31,163,224,0.65);color:var(--cyan);">🔑 Send Portal Invite</button>
            </div>`}
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" class="form-input" id="newClientPortalPw" placeholder="Set new password…" style="font-size:13px;max-width:220px;">
            <button class="btn btn-secondary" onclick="changeClientPortalPassword('${clientId}')" style="white-space:nowrap;">Update Password</button>
          </div>
          <div style="font-size:12px;color:var(--gray);margin-top:6px;">Updates password across all their events.</div>
        </div>

        <!-- ── Linked Events ─────────────────────────────────────────── -->
        <div style="border-top:1px solid var(--border);padding-top:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:12px;">Linked Events (${clientEvents.length})</div>
          ${evHtml || '<div style="color:var(--gray);font-size:12px;padding:8px 0;">No events yet. <a href="#" onclick="event.preventDefault();closeModal(\'clientDetailModal\');openNewEventModal();" style="color:var(--cyan);">Create one →</a></div>'}
        </div>`;

      document.getElementById('clientDetailContent').innerHTML = html;
      openModal('clientDetailModal');
    }


    function saveClientChanges(clientId) {
      const clients = getDB('clients');
      const client = clients.find(c => c.id === clientId);
      if (client) {
        client.name    = document.getElementById('editClientName2').value || client.name;
        client.email   = document.getElementById('editClientEmail2').value;
        client.phone   = document.getElementById('editClientPhone2').value;
        client.type    = document.getElementById('editClientType').value;
        client.company = document.getElementById('editClientCompany').value;
        setDB('clients', clients);
        showToast('Saved', 'success');
        renderClients(); // keep background list fresh
        showClientPage(clientId); // refresh the detail page with updated info
      }
    }

    function changeClientPortalPassword(clientId) {
      const newPw = (document.getElementById('newClientPortalPw')?.value || '').trim();
      if (!newPw) { showToast('Enter a new password first', 'error'); return; }
      const events = getDB('events');
      const clientEvents = events.filter(e => e.clientId === clientId || (e.linkedClients && e.linkedClients.includes(clientId)));
      if (!clientEvents.length) { showToast('No linked events to update', 'info'); return; }
      clientEvents.forEach(ev => {
        ev.portalPassword = newPw;
        const idx = events.findIndex(e => e.id === ev.id);
        if (idx !== -1) events[idx] = ev;
      });
      setDB('events', events);
      showToast(`Password updated across ${clientEvents.length} event${clientEvents.length > 1 ? 's' : ''}`, 'success');
      showClientPage(clientId); // refresh page with new credentials
    }

    function deleteClient(clientId) {
      if (!confirm('Remove this client? Their linked events will stay — only the client record is deleted.')) return;
      const clients = getDB('clients').filter(c => c.id !== clientId);
      setDB('clients', clients);
      goBack(); // return to clients list
      renderClients();
      showToast('Client removed', 'success');
    }

    // Send portal invite using the client's actual event credentials
    async function sendClientPortalInvite(clientId, triggerEl) {
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      if (!client.email) { showToast('No email on record — add one first', 'error'); return; }

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
        // No event credentials found — show fallback right away
        showEmailFallback(email, 'Your Baseline Studio Portal', fallbackMsg, 'No portal password found — open the event, go to the Portal tab, and set credentials first.');
        return;
      }

      const sendBtn = triggerEl || null;
      if (sendBtn) { sendBtn.textContent = 'Sending…'; sendBtn.disabled = true; }

      const result = await BSPortal.sendEmail('client_invite', { email, clientName: name, password: pass, eventName, eventDate });

      if (sendBtn) { sendBtn.textContent = '🔑 Send Portal Invite'; sendBtn.disabled = false; }

      if (result?.ok) {
        showToast('Portal invite sent to ' + email, 'success');
      } else {
        showEmailFallback(email, 'Your Baseline Studio Portal', fallbackMsg, 'Email failed — use one of these instead:');
      }
    }

    //
    //  PORTAL USERS MANAGEMENT
    //
    function switchClientsTab(btn, tabName) {
      document.querySelectorAll('#clients .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#clients .tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tabName).classList.add('active');
      if (tabName === 'portal-users') renderPortalUsers();
    }

    function renderPortalUsers() {
      const users = getDB('portalUsers') || [];
      let html = '';
      users.forEach(u => {
        const eventDate = new Date(u.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        html += `<tr onclick="openPortalUserDetail('${u.id}')" style="cursor:pointer;">
          <td>${u.fullName}</td>
          <td><a href="mailto:${u.email}" onclick="event.stopPropagation()" style="color:var(--cyan);text-decoration:none;">${u.email}</a></td>
          <td><span class="badge badge-${u.eventType}">${u.eventType}</span></td>
          <td>${eventDate}</td>
          <td><span style="color: var(--success); font-weight: 600;">ACTIVE</span></td>
          <td>
            <div style="display: flex; gap: 6px;" onclick="event.stopPropagation()">
              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;color:var(--cyan);border-color:rgba(31,163,224,0.65);" onclick="sendLoginInfo('client',{name:'${u.fullName.replace(/'/g,"\\'")}',email:'${u.email}'})">🔑 Resend</button>
              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="editPortalUser('${u.id}')">Edit</button>
              <button class="btn btn-danger" style="padding: 6px 10px; font-size: 12px;" onclick="deletePortalUser('${u.id}')">Delete</button>
            </div>
          </td>
        </tr>`;
      });
      document.getElementById('portalUsersTableBody').innerHTML = html || '<tr><td colspan="6"><div class="empty-state">No portal users yet. <button class="btn btn-secondary" style="margin-left:10px;" onclick="openAddPortalUserModal()">Add Portal User →</button></div></td></tr>';
    }

    function openPortalUserDetail(userId) {
      const users = getDB('portalUsers') || [];
      const u = users.find(x => x.id === userId);
      if (!u) return;
      const eventDate = new Date(u.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      document.getElementById('clientDetailContent').innerHTML = `
        <div class="modal-title">${u.fullName}</div>
        <div class="grid-2" style="margin-bottom:16px;">
          <div><label class="form-label">Name</label><div style="color:#fff;font-size:14px;">${u.fullName}</div></div>
          <div><label class="form-label">Email</label><div style="font-size:14px;"><a href="mailto:${u.email}" style="color:var(--cyan);text-decoration:none;">${u.email}</a></div></div>
          <div><label class="form-label">Event Type</label><div style="font-size:14px;"><span class="badge badge-${u.eventType}">${u.eventType}</span></div></div>
          <div><label class="form-label">Event Date</label><div style="color:#fff;font-size:14px;">${eventDate}</div></div>
        </div>
        ${u.password ? `<div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:12px;">
          <span style="color:var(--gray);">Portal password:</span>
          <code style="color:#2ecc71;margin-left:6px;">${u.password}</code>
          <button onclick="copyToClipboard('${u.password}')" style="background:none;border:none;color:var(--cyan);cursor:pointer;font-size:12px;margin-left:8px;">Copy</button>
        </div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary" style="color:var(--cyan);border-color:rgba(31,163,224,0.65);" onclick="sendLoginInfo('client',{name:'${u.fullName.replace(/'/g,"\\'")}',email:'${u.email}'})">🔑 Resend Login Info</button>
          <a href="mailto:${u.email}" class="btn btn-secondary">✉ Email</a>
          <button class="btn btn-secondary" onclick="editPortalUser('${u.id}');closeModal('clientDetailModal')">Edit</button>
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
      showToast('Portal user added successfully!', 'success');
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
        showToast('Portal user updated!', 'success');
      };
      openModal('addPortalUserModal');
    }

    function deletePortalUser(userId) {
      const users = getDB('portalUsers') || [];
      const user = users.find(u => u.id === userId);
      if (!user) return;

      window.confirmCallback = () => {
        const updated = users.filter(u => u.id !== userId);
        setDB('portalUsers', updated);
        closeModal('confirmDialog');
        renderPortalUsers();
        showToast('Portal user deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete Portal User';
      document.getElementById('confirmMessage').textContent = `Delete "${user.fullName}"? This action cannot be undone.`;
      openModal('confirmDialog');
    }

    function openAssignAccountModal(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const clients = getDB('clients') || [];

      if (!ev.linkedClients) ev.linkedClients = [];

      const primaryOpts = clients.map(c => `<option value="${c.id}" ${ev.clientId === c.id ? 'selected' : ''}>${c.name}${c.company ? ' — ' + c.company : ''} (${c.type})</option>`).join('');
      const linkedOpts  = clients.filter(c => c.id !== ev.clientId).map(c => `<option value="${c.id}">${c.name}${c.company ? ' — ' + c.company : ''} (${c.type})</option>`).join('');

      const linkedList = ev.linkedClients.map(lid => {
        const cl = clients.find(c => c.id === lid);
        return cl ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--black-4);border-radius:4px;margin-bottom:6px;">
          <span style="font-size:13px;">${cl.name}${cl.company ? ' <span style="color:var(--gray);font-size:12px;">— ' + cl.company + '</span>' : ''} <span style="font-size:12px;color:var(--cyan);">(${cl.type})</span></span>
          <button class="btn btn-danger" style="padding:4px 8px;font-size:12px;" onclick="removeLinkedAccount('${eventId}','${lid}')">Remove</button>
        </div>` : '';
      }).join('');

      document.getElementById('assignAccountContent').innerHTML = `
        <div class="modal-title">Assign Accounts — ${ev.name}</div>
        <div class="form-group">
          <label class="form-label" for="assignPrimaryClient">Primary Client</label>
          <select class="form-select" id="assignPrimaryClient">${primaryOpts}</select>
          <div style="font-size:12px;color:var(--gray);margin-top:4px;">This is the main client for the event.</div>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:24px;">
          <button class="btn btn-primary" onclick="savePrimaryClient('${eventId}')">Update Primary Client</button>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:20px;margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:12px;">Additional Linked Accounts <span style="color:var(--gray);font-weight:400;font-size:12px;">(planners, coordinators, venues…)</span></div>
          ${linkedList || '<div style="color:var(--gray);font-size:12px;margin-bottom:12px;">No additional accounts linked</div>'}
          <div style="display:flex;gap:8px;margin-top:12px;">
            <select class="form-select" id="addLinkedSelect" style="flex:1;margin:0;">${linkedOpts}</select>
            <button class="btn btn-secondary" style="white-space:nowrap;" onclick="addLinkedAccount('${eventId}')">+ Link Account</button>
          </div>
        </div>
        <div style="text-align:right;margin-top:16px;">
          <button class="btn btn-secondary" onclick="closeModal('assignAccountModal')">Close</button>
        </div>`;

      openModal('assignAccountModal');
    }

    function savePrimaryClient(eventId) {
      const sel = document.getElementById('assignPrimaryClient');
      if (!sel || !sel.value) return;
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.clientId = sel.value;
      setDB('events', events);
      // update client name in display
      const clients = getDB('clients') || [];
      const cl = clients.find(c => c.id === sel.value);
      if (cl) ev.clientName = cl.name;
      setDB('events', events);
      showToast('Primary client updated', 'success');
      renderEvents();
    }

    function addLinkedAccount(eventId) {
      const sel = document.getElementById('addLinkedSelect');
      if (!sel || !sel.value) return;
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      if (!ev.linkedClients) ev.linkedClients = [];
      if (!ev.linkedClients.includes(sel.value)) {
        ev.linkedClients.push(sel.value);
        setDB('events', events);
        showToast('Account linked', 'success');
      }
      openAssignAccountModal(eventId);
    }

    function removeLinkedAccount(eventId, clientId) {
      confirmDestructive('Unlink Account', 'Remove this client account from the event?', function() {
        const events = getDB('events');
        const ev = events.find(e => e.id === eventId);
        if (!ev || !ev.linkedClients) return;
        ev.linkedClients = ev.linkedClients.filter(id => id !== clientId);
        setDB('events', events);
        showToast('Account unlinked', 'success');
        openAssignAccountModal(eventId);
      }, 'Unlink');
    }
