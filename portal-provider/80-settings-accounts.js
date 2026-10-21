// ============================================================================
// portal-provider/80-settings-accounts.js  -  settings and accounts: team accounts, settings, contract terms, notification settings, blasts
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    function renderAccounts() {
      const users = getDB('users');
      const currentUser = BSPortal.getCurrentUser();

      if (!['master', 'admin'].includes(currentUser.role)) {
        document.getElementById('accounts').innerHTML = '<div class="empty-state"><div class="empty-state-text">Access Denied</div></div>';
        return;
      }

      let html = '';
      users.forEach(u => {
        html += `<tr onclick="openTeamMemberDetail('${u.id}')" style="cursor:pointer;">
          <td>${u.name}</td>
          <td><a href="mailto:${u.email}" onclick="event.stopPropagation()" style="color:var(--cyan);text-decoration:none;">${u.email}</a></td>
          <td><span class="badge" style="background: var(--cyan); color: var(--black);">${u.role}</span></td>
          <td><span class="badge" style="background: ${u.active ? 'var(--success)' : 'var(--danger)'};">${u.active ? 'Active' : 'Inactive'}</span></td>
          <td style="font-size:12px;color:var(--gray);">${u.supabaseId ? '<span style="color:var(--success)">✓ CRM account</span>' : '<span style="color:var(--gray)">Local only</span>'}</td>
          <td onclick="event.stopPropagation()">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;color:var(--cyan);border-color:rgba(31,163,224,0.65);" onclick="sendLoginInfo('team',{name:'${u.name.replace(/'/g,"\\'")}',email:'${u.email}',role:'${u.role}'})">🔑 ${u.supabaseId?'Resend Login':'Create Account'}</button>
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="editUserProfile('${u.id}')">Edit</button>
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="toggleUserActive('${u.id}')">Toggle</button>
              <button class="btn btn-danger"    style="padding:4px 8px;font-size:12px;" onclick="deleteUser('${u.id}')">Delete</button>
            </div>
          </td>
        </tr>`;
      });
      document.getElementById('accountsTableBody').innerHTML = html || '<tr><td colspan="6"><div class="empty-state">No team members. <button class="btn btn-secondary" style="margin-left:10px;" onclick="openAddAccountModal()">Add one →</button></div></td></tr>';
    }

    function openTeamMemberDetail(userId) {
      const users = getDB('users');
      const u = users.find(x => x.id === userId);
      if (!u) return;
      document.getElementById('clientDetailContent').innerHTML = `
        <div class="modal-title" style="display:flex;align-items:center;gap:12px;">
          ${u.name}
          <span class="badge" style="background:var(--cyan);color:var(--black);">${u.role}</span>
        </div>
        <div class="grid-2" style="margin-bottom:16px;">
          <div>
            <label class="form-label">Email</label>
            <a href="mailto:${u.email}" style="color:var(--cyan);font-size:14px;text-decoration:none;">${u.email}</a>
          </div>
          <div>
            <label class="form-label">Phone</label>
            ${u.phone ? `<a href="tel:${u.phone}" style="color:var(--cyan);font-size:14px;text-decoration:none;">📞 ${u.phone}</a>` : '<span style="color:var(--gray)">—</span>'}
          </div>
          <div>
            <label class="form-label">Status</label>
            <span class="badge" style="background:${u.active?'var(--success)':'var(--danger)'};">${u.active?'Active':'Inactive'}</span>
          </div>
          <div>
            <label class="form-label">CRM Login</label>
            ${u.supabaseId ? '<span style="color:var(--success);">✓ Account created</span>' : '<span style="color:var(--gray);">Not set up yet</span>'}
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="sendLoginInfo('team',{name:'${u.name.replace(/'/g,"\\'")}',email:'${u.email}',role:'${u.role}'})" style="background:rgba(31,163,224,0.15);border:1px solid var(--cyan);color:var(--cyan);">
            🔑 ${u.supabaseId ? 'Resend Login Info' : 'Create CRM Account + Send Login'}
          </button>
          ${u.email ? `<a href="mailto:${u.email}" class="btn btn-secondary">✉ Email ${u.name.split(' ')[0]}</a>` : ''}
          <button class="btn btn-secondary" onclick="editUserProfile('${u.id}');closeModal('clientDetailModal')">Edit Profile</button>
        </div>
        <div style="margin-top:16px;padding:12px 16px;background:var(--black-4);border-radius:6px;font-size:12px;color:var(--gray);">
          ${u.supabaseId ? 'This person can log into the provider CRM at <code style="color:var(--cyan);">baselinestudiofl.com/login.html</code>' : 'Once you create their account, they\'ll get an email with their login details.'}
        </div>`;
      openModal('clientDetailModal');
    }

    function editUserProfile(userId) {
      const users = getDB('users');
      const user = users.find(u => u.id === userId);
      if (!user) return;

      window.editingUserId = userId;
      const photoHtml = user.profilePic ? `<img src="${user.profilePic}" alt="${user.name}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover;">` : `<div style="width: 80px; height: 80px; border-radius: 50%; background: var(--cyan); display: flex; align-items: center; justify-content: center; font-weight: 600;">${user.name.charAt(0)}</div>`;

      document.getElementById('editAccountForm').innerHTML = `<div class="form-group"><label class="form-label">Profile Photo</label>${photoHtml}</div><div class="form-group"><input type="file" class="form-input" id="accountPhotoInput" accept="image/*" onchange="previewAccountPhoto(event)"></div><button type="submit" class="btn btn-primary">Save</button>`;
      openModal('editAccountModal');
    }

    function previewAccountPhoto(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        window.newUserPhoto = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    function updateUserProfile(event) {
      event.preventDefault();
      const users = getDB('users');
      const user = users.find(u => u.id === window.editingUserId);
      if (user && window.newUserPhoto) {
        user.profilePic = window.newUserPhoto;
        setDB('users', users);
        closeModal('editAccountModal');
        renderAccounts();
        showToast('Profile updated', 'success');
      }
    }

    async function saveAccount(e) {
      e.preventDefault();
      const name = document.getElementById('accountName').value;
      const email = document.getElementById('accountEmail').value;
      const password = document.getElementById('accountPassword').value;
      const phone = document.getElementById('accountPhone').value;
      const role = document.getElementById('accountRole').value;

      const submitBtn = e.target.querySelector('[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

      // Try creating in Supabase Auth so the new user can log in
      const result = await BSPortal.createProviderUser(email, password, name, role);

      const users = getDB('users');
      users.push({
        id: genId(), name, email, password, phone, role,
        active: true, profilePic: null,
        supabaseId: result.ok ? (result.userId || null) : null
      });
      setDB('users', users);
      closeModal('addAccountModal');
      renderAccounts();
      document.getElementById('addAccountForm').reset();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Account'; }

      if (result.ok) {
        showToast('Account created. Sending invite email…', 'success');
        const emailResult = await BSPortal.sendEmail('provider_invite', { email, name, role, password });
        if (emailResult.ok) {
          showToast('Invite email sent to ' + email, 'success');
        } else {
          showToast('Account created, but the email did not send. Resend it from the Accounts list. (' + (emailResult.error || 'unknown error') + ')', 'warning');
        }
      } else {
        showToast('Saved locally, but the login account was not created: ' + result.error, 'warning');
      }
    }

    function openAddAccountModal() { document.getElementById('addAccountForm').reset(); openModal('addAccountModal'); }

    function toggleUserActive(userId) {
      const users = getDB('users');
      const user = users.find(u => u.id === userId);
      if (user) { user.active = !user.active; setDB('users', users); renderAccounts(); showToast(user.active ? 'Activated' : 'Deactivated', 'success'); }
    }

    function deleteUser(userId) {
      const users = getDB('users');
      window.confirmCallback = () => {
        const updated = users.filter(u => u.id !== userId);
        setDB('users', updated);
        closeModal('confirmDialog');
        renderAccounts();
        showToast('Deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete User';
      document.getElementById('confirmMessage').textContent = 'Delete this user?';
      openModal('confirmDialog');
    }

    // ── Settings ────────────────────────────────────────────────────────────────

    // Defaults: messages on, everything else off
    const NOTIFY_DEFAULTS = { enabled: false, messages: true, prefs: false, timeline: false, vendors: false };

    function _getNotifySettings() {
      const s = getDB('settings') || {};
      return Object.assign({}, NOTIFY_DEFAULTS, s.notify || {});
    }

    function renderSettings() {
      const ns = _getNotifySettings();
      _applyToggle('notifyMaster', ns.enabled);
      _applyToggle('notifyMsg',     ns.messages);
      _applyToggle('notifyPrefs',   ns.prefs);
      _applyToggle('notifyTimeline',ns.timeline);
      _applyToggle('notifyVendors', ns.vendors);
      _updateSubToggleVisibility(ns.enabled);
      try { renderContractTerms(); } catch (e) { console.warn('[contract terms]', e); }
    }

    // ── Contract terms panel (Settings). One object: settings.contractTerms. Read by contract-templates.js. ──
    function renderContractTerms() {
      const el = document.getElementById('contractTermsCard');
      if (!el || typeof BSContracts === 'undefined') return;
      const t = BSContracts.getTerms(getDB('settings'));
      const u = BSPortal.getCurrentUser() || {};
      const locked = u.role === 'dj';
      const rows = BSContracts.TERM_FIELDS.map(f => `
        <label for="ct_${f.key}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--text-1);">
          <span>${esc(f.label)}</span>
          <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <input type="number" class="form-input" id="ct_${f.key}" value="${esc(t[f.key])}" min="${f.min}" max="${f.max}" step="${f.step}" oninput="_contractTermsPreview()" ${locked ? 'disabled' : ''} style="width:90px;padding:6px 8px;text-align:right;">
            <span style="width:34px;font-size:12px;color:var(--text-2);">${esc(f.unit)}</span>
          </span>
        </label>`).join('');
      el.innerHTML = `
        <div style="font-family:'Anton',sans-serif;font-size:15px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;color:var(--text-1);">Contract terms</div>
        <div style="font-size:12px;color:var(--text-2);margin-bottom:16px;">These numbers fill every new contract. Contracts already created keep the terms they were created with.</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${rows}</div>
        <div id="ctPreview" style="font-size:12px;line-height:1.6;color:var(--text-2);border-top:1px solid var(--border-ui);margin-top:16px;padding-top:12px;"></div>
        ${locked ? '' : `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
          <button class="btn btn-primary" onclick="saveContractTerms()">Save contract terms</button>
          <button class="btn btn-secondary" onclick="resetContractTerms()">Fill in defaults</button>
        </div>`}`;
      _contractTermsPreview();
    }

    function _contractTermsRaw() {
      const raw = {};
      BSContracts.TERM_FIELDS.forEach(f => { const i = document.getElementById('ct_' + f.key); raw[f.key] = i ? i.value : ''; });
      return raw;
    }

    function _contractTermsPreview() {
      const el = document.getElementById('ctPreview');
      if (!el) return;
      const v = BSContracts.validateTerms(_contractTermsRaw());
      if (!v.ok) { el.style.color = 'var(--warning)'; el.textContent = v.errors[0]; return; }
      el.style.color = 'var(--text-2)';
      const t = v.terms;
      el.innerHTML = 'What clients will read: ' + t.depositPercent + '% deposit, non-refundable, due at signing. Balance due ' + t.balanceDueDays + ' days before the event. '
        + 'Cancel ' + t.cancelFarDays + '+ days out: deposit only. ' + t.cancelNearDays + ' to ' + (t.cancelFarDays - 1) + ' days: deposit plus ' + t.cancelMidPercent + '% of the remaining balance. Under ' + t.cancelNearDays + ' days: full balance. '
        + 'Overtime: $' + t.overtimeDjRate + '/hr for a DJ with sound, plus $' + t.overtimeCrewRate + '/hr for each additional crew member, in ' + t.overtimeBlockMinutes + '-minute blocks.';
    }

    function saveContractTerms() {
      const v = BSContracts.validateTerms(_contractTermsRaw());
      if (!v.ok) { showToast(v.errors[0], 'error'); return; }
      const st = getDB('settings') || {};
      st.contractTerms = v.terms;
      setDB('settings', st);
      showToast('Contract terms saved. New contracts use them.', 'success');
    }

    function resetContractTerms() {
      BSContracts.TERM_FIELDS.forEach(f => { const i = document.getElementById('ct_' + f.key); if (i) i.value = BSContracts.DEFAULT_TERMS[f.key]; });
      _contractTermsPreview();
      showToast('Defaults filled in. Press Save to keep them.', 'info');
    }

    function _applyToggle(id, on) {
      const track = document.getElementById(id + 'Track');
      if (!track) return;
      if (on) track.classList.add('on'); else track.classList.remove('on');
    }

    function _updateSubToggleVisibility(masterOn) {
      const sub = document.getElementById('notifySubToggles');
      if (sub) { sub.style.opacity = masterOn ? '1' : '0.6'; sub.style.pointerEvents = masterOn ? '' : 'none'; }
    }

    function toggleNotify(which) {
      const ns = _getNotifySettings();
      if (which === 'master') {
        ns.enabled = !ns.enabled;
        _applyToggle('notifyMaster', ns.enabled);
        _updateSubToggleVisibility(ns.enabled);
      } else if (which === 'messages')  { ns.messages  = !ns.messages;  _applyToggle('notifyMsg',      ns.messages); }
      else if (which === 'prefs')       { ns.prefs     = !ns.prefs;     _applyToggle('notifyPrefs',    ns.prefs); }
      else if (which === 'timeline')    { ns.timeline  = !ns.timeline;  _applyToggle('notifyTimeline', ns.timeline); }
      else if (which === 'vendors')     { ns.vendors   = !ns.vendors;   _applyToggle('notifyVendors',  ns.vendors); }
      // Update stored state live so it reflects current toggles
      const s = getDB('settings') || {};
      s.notify = ns;
      setDB('settings', s);
    }

    async function saveNotifySettings() {
      const ns = _getNotifySettings();
      const btn  = document.getElementById('saveSettingsBtn');
      const note = document.getElementById('settingsSaveNote');
      btn.disabled = true; btn.textContent = 'Saving…';
      note.style.display = 'block';

      // Already saved live via toggleNotify. Now copy them onto every event in the provider's own
      // data. The client portal reads event.providerNotify from there. (Writing through the client
      // RPC never worked: update_client_event only lets clients write their own fields.)
      const events = getDB('events') || [];
      let pushed = 0;
      events.forEach(ev => {
        ev.providerNotify = ns;
        if (ev.portalPassword && (ev.portalEmail || ev.clientEmail)) pushed++;
      });
      setDB('events', events);

      btn.disabled = false;
      btn.textContent = 'Save & Apply to All Events';
      note.style.display = 'none';

      const msg = pushed > 0
        ? 'Settings saved — applied to ' + pushed + ' active event' + (pushed > 1 ? 's' : '')
        : 'Settings saved';
      showToast(msg, 'success');
    }

    // ── Blasts tab ────────────────────────────────────────────────────────────
    function renderBlastsTab() {
      const accounts = getDB('accounts') || [];
      const blasts = [...(getDB('blasts') || [])].sort((a,b) => b.sentAt - a.sentAt);
      const currentUser = BSPortal.getCurrentUser();
      const role = currentUser?.role || 'master';
      const isOwner = ['master','admin'].includes(role);
      const isEM = role === 'event-architect';
      const availRoles = isOwner ? ['All','Owner / Admin','Event Manager','DJ / Performer'] : isEM ? ['Event Manager','DJ / Performer'] : [];

      const roleChips = availRoles.map(r => `<label class="blast-role-chip" id="blastChip_${r.replace(/[^a-z]/gi,'')}" onclick="this.classList.toggle('selected')"><input type="checkbox" class="blast-role-check" value="${r}">${r}</label>`).join('');

      const blastRows = blasts.map(b => {
        const receipts = (getDB('blast_receipts') || []).filter(r => r.blastId === b.id);
        return `<div class="blast-record">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;margin-bottom:4px;">${b.subject}</div>
              <div style="font-size:13px;color:var(--gray);margin-bottom:6px;">${(b.body||'').substring(0,120)}${(b.body||'').length>120?'...':''}</div>
              <div style="font-size:12px;color:var(--gray);display:flex;gap:12px;flex-wrap:wrap;">
                <span>Sent by ${b.authorName}</span>
                <span>${new Date(b.sentAt).toLocaleString()}</span>
                <span>To: ${(b.targetRoles||[]).join(', ')}</span>
                <span style="color:var(--success);">Acknowledged: ${receipts.length}/${b.recipientCount||'?'}</span>
              </div>
            </div>
            ${b.urgent ? `<span class="badge" style="background:rgba(231,76,60,0.2);color:#f26a5c;flex-shrink:0;font-size:12px;">URGENT</span>` : ''}
          </div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:32px;color:var(--gray);font-size:13px;">No blasts sent yet.</div>';

      document.getElementById('docTabBlasts').innerHTML = `
        <div style="font-family:'Anton',sans-serif;font-size:22px;margin-bottom:20px;">Blasts</div>
        <div class="blast-layout">
          <div class="blast-panel">
            <div class="blast-panel-title">Compose Blast</div>
            ${!availRoles.length ? `<div style="color:var(--gray);font-size:13px;">Your role (${role}) does not have blast permissions.</div>` : `
            <div class="form-group">
              <label class="form-label" for="blastSubject">Subject</label>
              <input type="text" class="form-input" id="blastSubject" placeholder="e.g. Heads up — schedule change Saturday">
            </div>
            <div class="form-group">
              <label class="form-label" for="blastBody">Message</label>
              <textarea class="form-textarea" id="blastBody" rows="5" placeholder="Write your message..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Send to</label>
              <div class="blast-role-chips">${roleChips}</div>
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:10px;padding:14px;background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.2);border-radius:6px;">
              <input type="checkbox" id="blastUrgent" style="cursor:pointer;width:16px;height:16px;">
              <label for="blastUrgent" style="font-size:13px;cursor:pointer;color:var(--white);"><strong style="color:#e74c3c;">URGENT</strong> — also send email to all recipients now</label>
            </div>
            <button class="btn btn-primary" style="width:100%;padding:14px;font-size:14px;" onclick="sendBlast()">Send Blast</button>
            `}
          </div>
          <div>
            <div style="font-weight:600;font-size:14px;margin-bottom:14px;">Sent Blasts</div>
            ${blastRows}
          </div>
        </div>`;
    }

    async function sendBlast() {
      const subject = (document.getElementById('blastSubject')?.value || '').trim();
      const body = (document.getElementById('blastBody')?.value || '').trim();
      const urgent = document.getElementById('blastUrgent')?.checked;
      const selectedRoles = [...document.querySelectorAll('.blast-role-check:checked')].map(c => c.value);
      if (!subject) { showToast('Subject is required', 'error'); return; }
      if (!body) { showToast('Message is required', 'error'); return; }
      if (!selectedRoles.length) { showToast('Select at least one role', 'error'); return; }
      const currentUser = BSPortal.getCurrentUser();
      const accounts = getDB('accounts') || [];
      const roleMap = { 'All': ['master','admin','event-architect','dj'], 'Owner / Admin': ['master','admin'], 'Event Manager': ['event-architect'], 'DJ / Performer': ['dj'] };
      const targetKeys = [...new Set(selectedRoles.flatMap(r => roleMap[r] || []))];
      const recipients = accounts.filter(a => targetKeys.includes(a.role));
      const blast = {
        id: genId(), authorId: currentUser?.id||'', authorName: currentUser?.name||'Owner',
        authorRole: currentUser?.role||'master', subject, body, targetRoles: selectedRoles,
        urgent, sentAt: Date.now(), recipientCount: recipients.length
      };
      const blasts = getDB('blasts') || [];
      blasts.push(blast);
      setDB('blasts', blasts);
      let _blastFailed = [];
      let _blastFirstErr = '';
      const _blastSubject = `[URGENT] ${subject}`;
      const _blastBody = `${body}\n\n${blast.authorName}, Baseline Studio`;
      if (urgent && recipients.length) {
        const _blastResults = await Promise.all(recipients.map(r => BSPortal.sendEmail('generic', {
          email: r.email, clientName: r.name,
          subject: _blastSubject,
          body: _blastBody
        })));
        _blastResults.forEach((res, i) => {
          if (!res.ok) { _blastFailed.push(recipients[i]); if (!_blastFirstErr) _blastFirstErr = res.error || 'unknown error'; }
        });
      }
      if (_blastFailed.length) {
        showToast(`Blast posted, but ${_blastFailed.length} of ${recipients.length} email${recipients.length !== 1 ? 's' : ''} did not send: ${_blastFirstErr}`, 'error');
        showEmailFallback(_blastFailed.map(r => r.email).filter(Boolean).join(','), _blastSubject, _blastBody, 'Could not send to ' + _blastFailed.length + ' recipient' + (_blastFailed.length !== 1 ? 's' : '') + ' (' + _blastFirstErr + '). Send manually:');
      } else {
        showToast(`Blast sent to ${recipients.length} team member${recipients.length !== 1 ? 's' : ''}`, 'success');
      }
      renderBlastsTab();
    }
