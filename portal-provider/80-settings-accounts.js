// ============================================================================
// portal-provider/80-settings-accounts.js  -  settings and accounts: team accounts, settings, contract terms, notification settings, blasts
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Team (accounts + crew roster) ───────────────────────────────────────────
    let _teamTab = 'accounts';

    function _teamInitials(name) {
      const p = String(name || '').trim().split(/\s+/).filter(Boolean);
      return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
    }

    function _teamAvatar(u, cls) {
      if (u && u.profilePic) return `<img class="avatar ${cls || ''}" src="${esc(u.profilePic)}" alt="">`;
      return `<span class="avatar ${cls || ''}" aria-hidden="true">${esc(_teamInitials(u && u.name))}</span>`;
    }

    function _teamRolePill(role) {
      const m = { master: ['pill-violet', 'Master'], admin: ['pill-info', 'Admin'], 'event-architect': ['pill-ok', 'Event architect'], dj: ['pill-neutral', 'DJ'] };
      const x = m[role] || ['pill-neutral', String(role || 'Staff')];
      return `<span class="pill ${x[0]}" data-ui="pill">${esc(x[1])}</span>`;
    }

    // The signed-in owner's own Team row, matched by email (case-insensitive). The row id is local; the sign-in id is the auth user.
    function _teamIsMe(u) {
      const me = (window.BSPortal && BSPortal.getCurrentUser && BSPortal.getCurrentUser()) || {};
      const a = String((u && u.email) || '').trim().toLowerCase();
      return !!a && a === String(me.email || '').trim().toLowerCase();
    }
    function _teamHasLogin(u) { return !!(u && (u.supabaseId || _teamIsMe(u))); }
    function _teamYouPill(u) { return _teamIsMe(u) ? ' <span class="pill pill-info pill-sm" data-ui="pill">This is you</span>' : ''; }

    // Saves the sign-in id on the Team row after a create, link or reset, then repaints.
    function _teamLinkLogin(userId, email, supabaseId) {
      if (!supabaseId) return;
      const users = _teamStripPasswords(getDB('users') || []);
      const em = String(email || '').trim().toLowerCase();
      const u = users.find(x => x.id === userId) || users.find(x => em && String(x.email || '').trim().toLowerCase() === em);
      if (!u) return;
      u.supabaseId = supabaseId;
      setDB('users', users);
      if (typeof renderAccounts === 'function' && document.getElementById('accounts')) renderAccounts();
    }

    function _teamLoginPill(u) {
      return _teamHasLogin(u)
        ? `<span class="pill pill-ok pill-sm" data-ui="pill">CRM login</span>`
        : `<span class="pill pill-neutral pill-sm" data-ui="pill">Local only</span>`;
    }

    // One shell for the Team section: tabs, a page-level panel per tab. Written once.
    function _teamShell() {
      const sec = document.getElementById('accounts');
      if (!sec || sec.getAttribute('data-p7') === '1') return;
      sec.setAttribute('data-p7', '1');
      sec.innerHTML = `
        <div class="team-wrap">
          <div class="tabs" role="tablist" aria-label="Team">
            <button type="button" class="tab-btn" role="tab" id="teamTabAccounts" aria-controls="teamPanelAccounts" onclick="switchTeamTab('accounts')">Accounts</button>
            <button type="button" class="tab-btn" role="tab" id="teamTabCrew" aria-controls="teamPanelCrew" onclick="switchTeamTab('crew')">Crew roster</button>
          </div>
          <div id="teamPanelAccounts" role="tabpanel" aria-labelledby="teamTabAccounts">
            <p class="t-meta team-sub">Everyone with a provider login. Availability only controls event assignment. It does not sign anyone out.</p>
            <div id="accountsListMount"></div>
          </div>
          <div id="teamPanelCrew" role="tabpanel" aria-labelledby="teamTabCrew" hidden>
            <p class="t-meta team-sub">People you book for events. They do not sign in.</p>
            <div id="crewRosterMount"></div>
          </div>
        </div>`;
    }

    function switchTeamTab(tab) {
      _teamTab = tab === 'crew' ? 'crew' : 'accounts';
      renderAccounts();
      const b = document.getElementById(_teamTab === 'crew' ? 'teamTabCrew' : 'teamTabAccounts');
      if (b) b.focus();
    }

    // Saving the Add staff form lives in 60-library.js; refresh the roster after it has run.
    function _crewHook() {
      const f = document.getElementById('addStaffForm');
      if (!f || f.getAttribute('data-p7-hook') === '1') return;
      f.setAttribute('data-p7-hook', '1');
      f.addEventListener('submit', () => setTimeout(() => { renderCrewRoster(); }, 0));
    }

    function renderAccounts() {
      const users = getDB('users') || [];
      const currentUser = BSPortal.getCurrentUser();
      const sec = document.getElementById('accounts');

      if (!['master', 'admin'].includes(currentUser.role)) {
        if (sec) sec.removeAttribute('data-p7');
        document.getElementById('accounts').innerHTML = '<div class="empty"><h3 class="empty-title">Access denied</h3><p class="empty-text">Team is for the owner and admins.</p></div>';
        return;
      }

      _teamShell();
      _crewHook();
      const crew = _teamTab === 'crew';
      const set = (id, show) => { const el = document.getElementById(id); if (el) el.hidden = !show; };
      set('teamPanelAccounts', !crew); set('teamPanelCrew', crew);
      [['teamTabAccounts', !crew], ['teamTabCrew', crew]].forEach(p => {
        const b = document.getElementById(p[0]);
        if (b) { b.classList.toggle('active', p[1]); b.setAttribute('aria-selected', p[1] ? 'true' : 'false'); b.tabIndex = p[1] ? 0 : -1; }
      });

      const mount = document.getElementById('accountsListMount');
      if (mount) {
        if (!users.length) {
          mount.innerHTML = `<div class="empty"><h3 class="empty-title">No team members yet</h3><p class="empty-text">Add the people who sign in to the CRM.</p><button type="button" class="btn btn-secondary" onclick="openAddAccountModal()">Add account</button></div>`;
        } else {
          mount.innerHTML = CRMUI.renderList(users, { table: _teamTable, card: _teamCard });
        }
      }
      renderCrewRoster();
      _p7Actions('accounts', crew
        ? `<button type="button" class="btn btn-primary" onclick="openAddStaffModal()">${_p7Icon('plus', 18)} Add crew</button>`
        : `<button type="button" class="btn btn-primary" onclick="openAddAccountModal()">${_p7Icon('plus', 18)} Add account</button>`);
    }

    function _teamSwitchHtml(u) {
      const on = !!u.active;
      return `<span class="team-active"><button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="Available for events: ${esc(u.name)}" onclick="_teamSwitch(this,'${esc(u.id)}')"></button><span class="team-active-label">${on ? 'Available' : 'Not available'}</span></span>`;
    }

    function _teamKebab(u) {
      return `<button type="button" class="btn btn-ghost btn-icon" aria-label="More actions for ${esc(u.name)}" aria-haspopup="menu" onclick="_teamMenu(this,'${esc(u.id)}')">${_p7Icon('ellipsis-vertical', 20)}</button>`;
    }

    function _teamTable(users) {
      const rows = users.map(u => `<tr class="is-click" data-user="${esc(u.id)}" onclick="openTeamMemberDetail('${esc(u.id)}')">
        <td><div class="team-who">${_teamAvatar(u, 'avatar-32')}<div><div class="team-name" data-user-content>${esc(u.name)}${_teamYouPill(u)}</div><a class="team-mail" href="mailto:${esc(u.email)}" onclick="event.stopPropagation()" data-user-content>${esc(u.email)}</a></div></div></td>
        <td>${_teamRolePill(u.role)}</td>
        <td onclick="event.stopPropagation()">${_teamSwitchHtml(u)}</td>
        <td>${_teamLoginPill(u)}${u.lastLogin ? `<div class="t-meta">Last login ${esc(new Date(u.lastLogin).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</div>` : ''}</td>
        <td class="team-act" onclick="event.stopPropagation()">${_teamKebab(u)}</td>
      </tr>`).join('');
      return `<table class="tbl" id="accountsTable"><thead><tr><th>Person</th><th>Role</th><th>Available for events</th><th>CRM login</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="accountsTableBody">${rows}</tbody></table>`;
    }

    function _teamCard(u) {
      return `<div class="team-card" data-user="${esc(u.id)}">
        <button type="button" class="team-card-main" onclick="openTeamMemberDetail('${esc(u.id)}')">
          ${_teamAvatar(u, 'avatar-40')}
          <span class="team-card-text">
            <span class="team-name" data-user-content>${esc(u.name)}${_teamYouPill(u)}</span>
            <span class="team-card-pills">${_teamRolePill(u.role)}${_teamLoginPill(u)}</span>
          </span>
          ${_p7Icon('chevron-right', 20)}
        </button>
        <div class="team-card-foot">${_teamSwitchHtml(u)}${_teamKebab(u)}</div>
      </div>`;
    }

    function _teamSwitch(btn, userId) {
      _teamSetActive(userId, btn.getAttribute('aria-checked') !== 'true');
      const again = [...document.querySelectorAll('[data-user="' + userId + '"] .switch')].find(b => b.offsetParent !== null);
      if (again) again.focus();
    }

    function _teamMenu(btn, userId) {
      const u = (getDB('users') || []).find(x => x.id === userId);
      if (!u || !window.CRMUI || !CRMUI.menu) return;
      CRMUI.menu(btn, [
        { label: 'Edit details', icon: 'pencil', onSelect: () => editUserProfile(userId) },
        _teamIsMe(u) ? null : (u.supabaseId ? { label: 'Send sign-in link', icon: 'send', onSelect: () => _teamSendSignIn(userId) } : { label: 'Create CRM login', icon: 'send', onSelect: () => _teamSendLogin(userId) }),
        _teamIsMe(u) || !u.supabaseId ? null : { label: 'Reset password', icon: 'lock', onSelect: () => _teamResetPassword(userId) },
        { label: u.active ? 'Make unavailable for events' : 'Make available for events', icon: 'ban', onSelect: () => toggleUserActive(userId) },
        { label: 'Delete', icon: 'trash-2', danger: true, onSelect: () => deleteUser(userId) }
      ].filter(Boolean), { align: 'right' });
    }

    // Creates the CRM login and emails a new password. Only for people who have no login yet.
    function _teamSendLogin(userId) {
      const u = (getDB('users') || []).find(x => x.id === userId);
      if (!u) return;
      if (_teamIsMe(u)) { showToast('This is your own login. Nothing to create.', 'info'); return; }
      sendLoginInfo('team', { id: u.id, name: u.name, email: u.email, role: u.role, mode: 'create' });
    }

    // Existing login: a note with the sign-in address. Nothing about their password changes.
    async function _teamSendSignIn(userId) {
      const u = (getDB('users') || []).find(x => x.id === userId);
      if (!u || !u.email) { showToast('Add an email first.', 'warning'); return; }
      const r = await BSPortal.sendEmail('generic', { email: u.email, clientName: u.name, subject: 'Sign in to the Baseline Studio CRM',
        body: 'You can sign in at https://www.baselinestudiofl.com/login.html with this email address. If you forgot your password, use Forgot password on that page.' });
      showToast(r && r.ok ? 'Sign-in link sent to ' + u.email : 'Could not send: ' + ((r && r.error) || 'unknown error'), r && r.ok ? 'success' : 'error');
    }

    // Existing login: replaces the password, so it asks first and names the person.
    async function _teamResetPassword(userId) {
      const u = (getDB('users') || []).find(x => x.id === userId);
      if (!u) return;
      if (_teamIsMe(u)) { showToast('Use Forgot password on the login page to change your own password.', 'info'); return; }
      const ok = await CRMUI.confirm({ title: 'Reset password for ' + (u.name || 'this person') + '?', body: 'This replaces their current password. They get an email with a new one.', confirmLabel: 'Reset password', danger: true });
      if (ok) sendLoginInfo('team', { id: u.id, name: u.name, email: u.email, role: u.role, mode: 'reset' });
    }

    // Staff passwords are used once, for the invite call. They are not kept in the synced users record.
    function _teamStripPasswords(users) {
      (users || []).forEach(u => { if (u && u.password) delete u.password; });
      return users;
    }

    function _teamSetActive(userId, on) {
      const users = _teamStripPasswords(getDB('users') || []);
      const u = users.find(x => x.id === userId);
      if (!u) return;
      const was = !!u.active;
      if (was === on) return;
      u.active = on;
      setDB('users', users);
      renderAccounts();
      showUndoToast((u.name || 'This person') + (on ? ' is available for events.' : ' is not available for events. They can still sign in.'), function() {
        const us = getDB('users') || [];
        const x = us.find(y => y.id === userId);
        if (x) { x.active = was; setDB('users', us); renderAccounts(); }
      });
    }

    function toggleUserActive(userId) {
      const u = (getDB('users') || []).find(x => x.id === userId);
      if (u) _teamSetActive(userId, !u.active);
    }

    async function deleteUser(userId) {
      const users = getDB('users') || [];
      const u = users.find(x => x.id === userId);
      if (!u) return;
      const ok = await CRMUI.confirm({ title: 'Delete ' + (u.name || 'this person') + '?', body: 'This removes them from your team list. It does not delete their sign-in account.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      setDB('users', (getDB('users') || []).filter(x => x.id !== userId));
      renderAccounts();
      showToast('Removed from the team', 'success');
    }

    // ── Crew roster (the staffroster key; Add crew uses openAddStaffModal from 60-library.js) ──
    function renderCrewRoster() {
      const mount = document.getElementById('crewRosterMount');
      if (!mount) return;
      const staff = getDB('staffroster') || [];
      if (!staff.length) {
        mount.innerHTML = `<div class="empty"><h3 class="empty-title">No crew yet</h3><p class="empty-text">Add the MCs, setup crew and photographers you book for events.</p><button type="button" class="btn btn-secondary" onclick="openAddStaffModal()">Add crew</button></div>`;
        return;
      }
      mount.innerHTML = `<div class="crew-list">` + staff.map(s => {
        const phone = s.phone ? (window.CRMUI && CRMUI.fmt ? CRMUI.fmt.phone(s.phone) : s.phone) : '';
        const tel = String(s.phone || '').replace(/[^\d+]/g, '');
        return `<div class="crew-card" data-crew="${esc(s.id)}">
          ${_teamAvatar(s, 'avatar-40')}
          <div class="crew-text">
            <div class="team-name" data-user-content>${esc(s.name)}</div>
            ${s.title ? `<div class="t-meta" data-user-content>${esc(s.title)}</div>` : ''}
            <div class="crew-contact">
              ${s.phone ? `<a class="team-link" href="tel:${esc(tel)}" data-user-content>${esc(phone)}</a>` : ''}
              ${s.email ? `<a class="team-link" href="mailto:${esc(s.email)}" data-user-content>${esc(s.email)}</a>` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-icon" aria-label="Remove ${esc(s.name)} from the crew" onclick="_crewRemove('${esc(s.id)}')">${_p7Icon('trash-2', 20)}</button>
        </div>`;
      }).join('') + `</div>`;
    }

    function _crewRemove(id) {
      const all = getDB('staffroster') || [];
      const idx = all.findIndex(s => s.id === id);
      if (idx < 0) return;
      const gone = all[idx];
      setDB('staffroster', all.filter(s => s.id !== id));
      renderCrewRoster();
      showUndoToast('Removed ' + (gone.name || 'crew member') + ' from the crew', function() {
        const cur = getDB('staffroster') || [];
        if (!cur.some(s => s.id === gone.id)) { cur.splice(Math.min(idx, cur.length), 0, gone); setDB('staffroster', cur); }
        renderCrewRoster();
      });
    }

    // Team member detail. Uses the page's #clientDetailModal (a centered modal on desktop, a bottom sheet on phone through crm-ui.css),
    // so the harness and the router still find it as .modal-backdrop.active.
    function openTeamMemberDetail(userId) {
      const users = getDB('users');
      const u = users.find(x => x.id === userId);
      if (!u) return;
      const first = String(u.name || '').split(' ')[0] || 'them';
      document.getElementById('clientDetailContent').innerHTML = `<div class="team-detail">
        <div class="modal-title" data-user-content>${esc(u.name)}</div>
        <div class="team-detail-pills">${_teamRolePill(u.role)}${_teamYouPill(u)}<span class="pill ${u.active ? 'pill-ok' : 'pill-neutral'}" data-ui="pill">${u.active ? 'Available for events' : 'Not available for events'}</span></div>
        <p class="t-meta">Availability only controls event assignment. It does not sign them out.</p>
        <dl class="team-dl">
          <dt>Email</dt><dd><a class="team-link" href="mailto:${esc(u.email)}" data-user-content>${esc(u.email)}</a></dd>
          <dt>Phone</dt><dd>${u.phone ? `<a class="team-link" href="tel:${esc(String(u.phone).replace(/[^\d+]/g, ''))}" data-user-content>${esc(CRMUI.fmt.phone(u.phone))}</a>` : '<span class="t-meta">Not added</span>'}</dd>
          <dt>CRM login</dt><dd>${_teamHasLogin(u) ? '<span class="pill pill-ok pill-sm" data-ui="pill">Account created</span>' : '<span class="pill pill-neutral pill-sm" data-ui="pill">Not set up yet</span>'}</dd>
        </dl>
        <p class="t-meta">${_teamIsMe(u) ? 'This is your own login. To change your password, use Forgot password on the login page.' : _teamHasLogin(u) ? 'This person can sign in to the provider CRM at <code>baselinestudiofl.com/login.html</code>.' : 'Once you create their login, they get an email with their sign-in details.'}</p>
        <div class="team-detail-actions">
          ${_teamIsMe(u) ? ''
            : u.supabaseId
            ? `<button type="button" class="btn btn-primary" onclick="_teamSendSignIn('${esc(u.id)}')">Send sign-in link</button><button type="button" class="btn btn-secondary" onclick="_teamResetPassword('${esc(u.id)}')">Reset password</button>`
            : `<button type="button" class="btn btn-primary" onclick="_teamSendLogin('${esc(u.id)}')">Create CRM login</button>`}
          ${u.email ? `<a class="btn btn-secondary" href="mailto:${esc(u.email)}">Email ${esc(first)}</a>` : ''}
          <button type="button" class="btn btn-secondary" onclick="closeModal('clientDetailModal');editUserProfile('${esc(u.id)}')">Edit details</button>
        </div>
      </div>`;
      openModal('clientDetailModal');
    }

    // Edit a Team row: name, phone, role and photo. Email stays fixed because it is how the row matches the sign-in.
    // The role here is the label on the Team list and event assignment; it does not change what the person's login can open.
    function editUserProfile(userId) {
      const users = getDB('users');
      const user = users.find(u => u.id === userId);
      if (!user) return;

      window.editingUserId = userId;
      window.newUserPhoto = null;
      const me = _teamIsMe(user);
      const roles = [['master', 'Master: full access'], ['admin', 'Admin: full access'], ['dj', 'DJ: events and timeline only'], ['event-architect', 'Event architect: events and documents']];
      if (user.role && !roles.some(r => r[0] === user.role)) roles.push([user.role, String(user.role)]);
      const opts = roles.map(r => `<option value="${esc(r[0])}"${r[0] === user.role ? ' selected' : ''}>${esc(r[1])}</option>`).join('');
      document.getElementById('editAccountForm').innerHTML = `
        <div class="field"><label class="field-label" for="editAcctName">Full name</label><input type="text" class="form-input" id="editAcctName" required autocomplete="off" value="${esc(user.name)}"></div>
        <div class="field"><span class="field-label">Email</span><div class="t-meta" data-user-content>${esc(user.email)}</div></div>
        <div class="field"><label class="field-label" for="editAcctPhone">Phone (optional)</label><input type="tel" class="form-input" id="editAcctPhone" autocomplete="off" data-norm="phone" value="${esc(user.phone || '')}"></div>
        <div class="field"><label class="field-label" for="editAcctRole">Role</label><select class="form-select" id="editAcctRole"${me ? ' disabled' : ''}>${opts}</select>${me ? '<p class="field-hint">This is your own account, so the role stays as it is.</p>' : ''}</div>
        <div class="field"><span class="field-label">Profile photo</span><div id="editAvatarPreview">${_teamAvatar(user, 'avatar-40')}</div></div>
        <div class="field"><label class="field-label" for="accountPhotoInput">Choose a photo</label><input type="file" class="form-input" id="accountPhotoInput" accept="image/*" onchange="previewAccountPhoto(event)"></div>
        <button type="submit" class="btn btn-primary">Save</button>`;
      openModal('editAccountModal');
    }

    function previewAccountPhoto(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        window.newUserPhoto = e.target.result;
        const pv = document.getElementById('editAvatarPreview');
        if (pv) pv.innerHTML = `<img class="avatar avatar-40" src="${esc(e.target.result)}" alt="">`;
      };
      reader.readAsDataURL(file);
    }

    function updateUserProfile(event) {
      event.preventDefault();
      const users = _teamStripPasswords(getDB('users'));
      const user = users.find(u => u.id === window.editingUserId);
      if (!user) return;
      const val = id => { const el = document.getElementById(id); return el ? el.value : null; };
      const name = String(val('editAcctName') == null ? user.name : val('editAcctName')).trim();
      if (!name) { showToast('Add a name first.', 'warning'); return; }
      const phone = val('editAcctPhone') == null ? user.phone : String(val('editAcctPhone')).trim();
      const roleEl = document.getElementById('editAcctRole');
      const role = roleEl && !roleEl.disabled && roleEl.value ? roleEl.value : user.role;
      const changed = name !== user.name || (phone || '') !== (user.phone || '') || role !== user.role || !!window.newUserPhoto;
      if (!changed) { closeModal('editAccountModal'); return; }
      user.name = name;
      user.phone = phone;
      user.role = role;
      if (window.newUserPhoto) user.profilePic = window.newUserPhoto;
      setDB('users', users);
      closeModal('editAccountModal');
      renderAccounts();
      showToast('Saved', 'success');
    }

    async function saveAccount(e) {
      e.preventDefault();
      const name = document.getElementById('accountName').value;
      const email = document.getElementById('accountEmail').value;
      const password = document.getElementById('accountPassword').value;
      const phone = document.getElementById('accountPhone').value;
      const role = document.getElementById('accountRole').value;

      const submitBtn = e.target.querySelector('[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating'; }

      // Try creating in Supabase Auth so the new user can log in. Create mode never changes an existing login's password.
      const result = await BSPortal.createProviderUser(email, password, name, role, { mode: 'create' });

      const users = _teamStripPasswords(getDB('users'));
      users.push({
        id: genId(), name, email, phone, role,
        active: true, profilePic: null,
        supabaseId: result.ok ? (result.userId || null) : null
      });
      setDB('users', users);
      closeModal('addAccountModal');
      renderAccounts();
      document.getElementById('addAccountForm').reset();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create account'; }

      if (result.ok && result.existing) {
        showToast('Already has a login. Linked.', 'success');
      } else if (result.ok) {
        showToast('Account created. Sending invite email.', 'success');
        const emailResult = await BSPortal.sendEmail('provider_invite', { email, name, role, password });
        if (emailResult.ok) {
          showToast('Invite email sent to ' + email, 'success');
        } else {
          showToast('Account created, but the email did not send. Resend it from the Team list. (' + (emailResult.error || 'unknown error') + ')', 'warning');
        }
      } else {
        showToast('Saved locally, but the login account was not created: ' + result.error, 'warning');
      }
    }

    // The Add account form is five fields and one role choice. The modal markup lives in portal-provider.html;
    // it is rewritten once here with the same ids (accountName, accountEmail, accountPassword, accountPhone, accountRole).
    function openAddAccountModal() {
      const m = document.getElementById('addAccountModal');
      if (m && m.getAttribute('data-p7') !== '1') {
        const box = m.querySelector('.modal');
        const close = box && box.querySelector('.modal-close');
        if (box) {
          box.innerHTML = (close ? close.outerHTML : '') + `
            <div class="modal-title">Add account</div>
            <form id="addAccountForm" onsubmit="saveAccount(event)">
              <p class="field-hint" style="margin-bottom:var(--sp-4);">They get an email to confirm their login. Once they confirm, they can sign in.</p>
              <div class="field"><label class="field-label" for="accountName">Full name</label><input type="text" class="form-input" id="accountName" required autocomplete="off" placeholder="Maria Rodriguez"></div>
              <div class="field"><label class="field-label" for="accountEmail">Email</label><input type="email" class="form-input" id="accountEmail" required autocomplete="off" data-norm="email" placeholder="name@example.com"></div>
              <div class="field"><label class="field-label" for="accountPassword">Password</label><input type="password" class="form-input" id="accountPassword" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></div>
              <div class="field"><label class="field-label" for="accountPhone">Phone (optional)</label><input type="tel" class="form-input" id="accountPhone" autocomplete="off" data-norm="phone"></div>
              <div class="field"><label class="field-label" for="accountRole">Role</label><select class="form-select" id="accountRole" required><option value="">Choose a role</option><option value="master">Master: full access</option><option value="admin">Admin: full access</option><option value="dj">DJ: events and timeline only</option><option value="event-architect">Event architect: events and documents</option></select></div>
              <button type="submit" class="btn btn-primary" style="width:100%;">Create account</button>
            </form>`;
        }
        m.setAttribute('data-p7', '1');
      }
      document.getElementById('addAccountForm').reset();
      openModal('addAccountModal');
    }

    // ── Settings ────────────────────────────────────────────────────────────────

    // Defaults: messages on, everything else off
    const NOTIFY_DEFAULTS = { enabled: false, messages: true, prefs: false, timeline: false, vendors: false };
    const _NOTIFY_SWITCHES = { enabled: 'notifyMaster', messages: 'notifyMsg', prefs: 'notifyPrefs', timeline: 'notifyTimeline', vendors: 'notifyVendors' };

    function _getNotifySettings() {
      const s = getDB('settings') || {};
      return Object.assign({}, NOTIFY_DEFAULTS, s.notify || {});
    }

    function _setStored() {
      const st = getDB('settings') || {};
      return {
        notify: _getNotifySettings(),
        business: Object.assign({ name: '', address: '' }, st.business || {}),
        inventory: Object.assign({ enabled: true, scan: true, nextTag: 1 }, st.inventory || {})
      };
    }

    function _setSwitchOn(id) {
      const el = document.getElementById(id);
      return !!el && el.getAttribute('aria-checked') === 'true';
    }

    // Notification choices as they are on screen right now (stored values when the Settings screen is not built).
    function _setReadNotify() {
      const stored = _getNotifySettings();
      if (!document.getElementById('notifyMasterTrack')) return stored;
      const ns = {};
      Object.keys(_NOTIFY_SWITCHES).forEach(k => { ns[k] = _setSwitchOn(_NOTIFY_SWITCHES[k] + 'Track'); });
      return ns;
    }

    function _setVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

    // ── Costs & travel (settings.costs, provider only). Defaults and storage live in 55-costs.js (costsSettings, costsSaveSettings).
    // Only master, admin and event-architect see this section (costsRoleOk); other roles never get the markup, so nothing below runs for them.
    function _setCostsOn() { return typeof costsCanView === 'function' && typeof costsSettings === 'function' && costsCanView(); }

    // Clean up typed values. Bad numbers fall back to the same defaults costsSettings() uses, so a stored value can never be nonsense.
    function _setCostsNormalize(raw) {
      const r = raw || {};
      const num = (v, def, min, max) => {
        const t = String(v == null ? '' : v).trim();
        const n = t === '' ? NaN : Number(t);
        return isFinite(n) && n >= min && (max === undefined || n <= max) ? n : def;
      };
      const people = {};
      const seen = {};
      (Array.isArray(r.people) ? r.people : []).forEach(p => {
        const name = String((p && p.name) || '').trim();
        if (!name || seen[name.toLowerCase()]) return;
        seen[name.toLowerCase()] = 1;
        const mpgT = String((p && p.mpg) == null ? '' : p.mpg).trim();
        const mpg = mpgT === '' ? null : num(mpgT, null, 0.1);
        const o = { name: name, mpg: mpg, startAddr: String((p && p.startAddr) || '').trim() };
        if (p && (p.mode === 'gas' || p.mode === 'irs')) o.mode = p.mode;
        people[name] = o;
      });
      return {
        homeBase: String(r.homeBase || '').trim(),
        gasPrice: num(r.gasPrice, 3.75, 0),
        mpg: num(r.mpg, 15, 0.1),
        mode: r.mode === 'irs' ? 'irs' : 'gas',
        irsRate: num(r.irsRate, 0.70, 0),
        wearPerMile: num(r.wearPerMile, 0, 0),
        minMargin: num(r.minMargin, 30, 0, 100),
        people: people
      };
    }
    // The first thing wrong with the typed values, or '' when they are fine. Nothing is saved while this returns text.
    function _setCostsCheck(raw) {
      const r = raw || {};
      const bad = (v, min, max) => { const t = String(v == null ? '' : v).trim(); const n = Number(t); return t === '' || !isFinite(n) || n < min || (max !== undefined && n > max); };
      if (bad(r.gasPrice, 0)) return 'Enter the gas price as a number like 3.75.';
      if (bad(r.mpg, 0.1)) return 'Enter miles per gallon as a number above 0.';
      if (bad(r.irsRate, 0)) return 'Enter the IRS rate as a number like 0.70.';
      if (String(r.wearPerMile == null ? '' : r.wearPerMile).trim() !== '' && bad(r.wearPerMile, 0)) return 'Wear per mile must be a number, or leave it at 0.';
      if (bad(r.minMargin, 0, 100)) return 'Enter the thin-margin warning as a percent from 0 to 100.';
      const rows = Array.isArray(r.people) ? r.people : [];
      for (let i = 0; i < rows.length; i++) {
        const p = rows[i] || {};
        const name = String(p.name || '').trim(), mpgT = String(p.mpg == null ? '' : p.mpg).trim();
        if (!name && (mpgT !== '' || String(p.startAddr || '').trim() !== '')) return 'Give each person a name.';
        if (mpgT !== '' && bad(mpgT, 0.1)) return 'Miles per gallon for ' + (name || 'a person') + ' must be a number above 0.';
      }
      return '';
    }
    // Stored people as a list sorted by name, for comparing with what is on screen.
    function _setCostsPeopleList(people) {
      const src = (people && typeof people === 'object' && !Array.isArray(people)) ? people : {};
      return Object.keys(src).map(k => {
        const p = src[k] || {};
        const m = Number(p.mpg);
        return { name: String(p.name || k).trim(), mpg: p.mpg == null || p.mpg === '' || !isFinite(m) ? null : m, startAddr: String(p.startAddr || '').trim() };
      }).filter(p => p.name).sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
    }
    // The values as typed on screen (strings), or null when the section is not on the page.
    function _setCostsRead() {
      if (!document.getElementById('setCostGas')) return null;
      const people = [];
      document.querySelectorAll('#setCostPeople [data-person]').forEach(row => {
        const f = k => { const el = row.querySelector('[data-f="' + k + '"]'); return el ? el.value : ''; };
        people.push({ name: f('name'), mpg: f('mpg'), startAddr: f('startAddr') });
      });
      return { homeBase: _setVal('setCostHome'), gasPrice: _setVal('setCostGas'), mpg: _setVal('setCostMpg'), mode: _setVal('setCostMode'),
        irsRate: _setVal('setCostIrs'), wearPerMile: _setVal('setCostWear'), minMargin: _setVal('setCostMin'), people: people };
    }
    // How many costs settings differ from what is saved (each field counts one, the people table counts one).
    function _setCostsDiff(read, stored) {
      if (!read) return 0;
      const s = stored || costsSettings();
      const same = (txt, n) => { const t = String(txt == null ? '' : txt).trim(); return t !== '' && Number(t) === Number(n); };
      let n = 0;
      if (String(read.homeBase || '').trim() !== String(s.homeBase || '').trim()) n++;
      if (!same(read.gasPrice, s.gasPrice)) n++;
      if (!same(read.mpg, s.mpg)) n++;
      if ((read.mode === 'irs' ? 'irs' : 'gas') !== s.mode) n++;
      if (!same(read.irsRate, s.irsRate)) n++;
      if (!same(read.wearPerMile, s.wearPerMile)) n++;
      if (!same(read.minMargin, s.minMargin)) n++;
      const a = (Array.isArray(read.people) ? read.people : []).map(p => ({ name: String(p.name || '').trim(), mpg: String(p.mpg == null ? '' : p.mpg).trim() === '' ? null : Number(p.mpg), startAddr: String(p.startAddr || '').trim() }))
        .filter(p => p.name || p.startAddr || p.mpg !== null).sort((x, y) => x.name.toLowerCase() < y.name.toLowerCase() ? -1 : (x.name.toLowerCase() > y.name.toLowerCase() ? 1 : 0));
      if (JSON.stringify(a) !== JSON.stringify(_setCostsPeopleList(s.people))) n++;
      return n;
    }
    // The patch to hand to costsSaveSettings. Keeps a person's own mileage method if one was set elsewhere.
    function _setCostsBuild(read, stored) {
      const out = _setCostsNormalize(read);
      const old = (stored && stored.people) || {};
      Object.keys(out.people).forEach(k => { const prev = old[k]; if (prev && (prev.mode === 'gas' || prev.mode === 'irs') && !out.people[k].mode) out.people[k].mode = prev.mode; });
      return out;
    }
    function _setCostsPersonRow(i, p) {
      const v = k => esc(p && p[k] != null ? String(p[k]) : '');
      return '<div class="set-cost-person" data-person>'
        + '<div class="field"><label class="field-label" for="setCostPN' + i + '">Name</label><input type="text" class="form-input" id="setCostPN' + i + '" data-f="name" autocomplete="off" value="' + v('name') + '"></div>'
        + '<div class="field set-cost-mpg"><label class="field-label" for="setCostPM' + i + '">Miles per gallon</label><input type="number" class="form-input" id="setCostPM' + i + '" data-f="mpg" min="0.1" step="0.1" inputmode="decimal" placeholder="Default" value="' + v('mpg') + '"></div>'
        + '<div class="field set-cost-addr"><label class="field-label" for="setCostPA' + i + '">Usual start address</label><input type="text" class="form-input" id="setCostPA' + i + '" data-f="startAddr" autocomplete="off" placeholder="Same as home base" value="' + v('startAddr') + '"></div>'
        + '<button type="button" class="btn btn-ghost btn-icon set-cost-del" aria-label="Remove this person" onclick="_setCostsPersonRemove(this)">' + _p7Icon('trash-2', 18) + '</button></div>';
    }
    let _setCostsRowSeq = 0;
    function _setCostsPersonAdd() {
      const host = document.getElementById('setCostPeople');
      if (!host) return;
      const empty = host.querySelector('.set-cost-none'); if (empty) empty.remove();
      host.insertAdjacentHTML('beforeend', _setCostsPersonRow('n' + (++_setCostsRowSeq), null));
      const last = host.querySelector('[data-person]:last-of-type input'); if (last && last.focus) last.focus();
      _setRecount();
    }
    function _setCostsPersonRemove(btn) {
      const row = btn && btn.closest ? btn.closest('[data-person]') : null;
      if (row) row.remove();
      const host = document.getElementById('setCostPeople');
      if (host && !host.querySelector('[data-person]') && !host.querySelector('.set-cost-none')) host.insertAdjacentHTML('afterbegin', '<p class="set-sub set-cost-none">No one added yet. Everyone uses the default miles per gallon and the home base.</p>');
      _setRecount();
    }
    function _setCostsFill() {
      if (!document.getElementById('setCostGas') || !_setCostsOn()) return;
      const c = costsSettings();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('setCostHome', c.homeBase); set('setCostGas', c.gasPrice); set('setCostMpg', c.mpg); set('setCostMode', c.mode);
      set('setCostIrs', c.irsRate); set('setCostWear', c.wearPerMile); set('setCostMin', c.minMargin);
      const list = _setCostsPeopleList(c.people);
      const host = document.getElementById('setCostPeople');
      if (host) host.innerHTML = list.length ? list.map((p, i) => _setCostsPersonRow('s' + i, p)).join('') : '<p class="set-sub set-cost-none">No one added yet. Everyone uses the default miles per gallon and the home base.</p>';
    }
    function _setCostsSectionHtml() {
      return _setSection('costs', 'Costs & travel', 'Used by the Costs tab on each event to estimate gas and show profit. Only the owner and managers can see this.', `
        <div class="field"><label class="field-label" for="setCostHome">Home base address</label><textarea class="form-textarea" id="setCostHome" rows="2" autocomplete="off" placeholder="Street, city, state, ZIP"></textarea><span class="field-hint">Private. Only used to estimate travel.</span></div>
        <div class="set-cost-grid">
          <div class="field"><label class="field-label" for="setCostGas">Gas price a gallon ($)</label><input type="number" class="form-input" id="setCostGas" min="0" step="0.01" inputmode="decimal"></div>
          <div class="field"><label class="field-label" for="setCostMpg">Default miles per gallon</label><input type="number" class="form-input" id="setCostMpg" min="0.1" step="0.1" inputmode="decimal"></div>
          <div class="field"><label class="field-label" for="setCostMode">Mileage method</label><select class="form-select" id="setCostMode"><option value="gas">Gas cost</option><option value="irs">IRS rate</option></select></div>
          <div class="field"><label class="field-label" for="setCostIrs">IRS rate a mile ($)</label><input type="number" class="form-input" id="setCostIrs" min="0" step="0.001" inputmode="decimal"><span class="field-hint">Check irs.gov for the current year's rate.</span></div>
          <div class="field"><label class="field-label" for="setCostWear">Wear a mile ($)</label><input type="number" class="form-input" id="setCostWear" min="0" step="0.01" inputmode="decimal"><span class="field-hint">Optional. Adds tire and repair wear to each mile. Leave at 0 to skip.</span></div>
          <div class="field"><label class="field-label" for="setCostMin">Thin-margin warning (%)</label><input type="number" class="form-input" id="setCostMin" min="0" max="100" step="1" inputmode="numeric"><span class="field-hint">Events with a profit margin below this show a Thin margin tag.</span></div>
        </div>
        <h4 class="set-cost-h">Drivers</h4>
        <p class="set-sub">Optional. Give a person their own miles per gallon or a usual start address, like their house.</p>
        <div id="setCostPeople" class="set-cost-people"></div>
        <button type="button" class="btn btn-secondary" onclick="_setCostsPersonAdd()">${_p7Icon('plus', 16)} Add a person</button>`);
    }

    // What changed on screen compared with what is saved. { notify, business, inventory, terms, count }
    function _setDiff() {
      const out = { notify: 0, business: 0, inventory: 0, terms: 0, assistant: 0, payments: 0, costs: 0, count: 0 };
      if (!document.getElementById('setLayout')) return out;
      const s = _setStored(), ns = _setReadNotify();
      Object.keys(_NOTIFY_SWITCHES).forEach(k => { if (!!ns[k] !== !!s.notify[k]) out.notify++; });
      if (_setVal('setBizName').trim() !== String(s.business.name || '').trim()) out.business++;
      if (_setVal('setBizAddress').trim() !== String(s.business.address || '').trim()) out.business++;
      if (_setSwitchOn('setInvEnabled') !== !!s.inventory.enabled) out.inventory++;
      if (_setSwitchOn('setInvScan') !== !!s.inventory.scan) out.inventory++;
      if (String(_setVal('setInvNextTag')).trim() !== String(s.inventory.nextTag)) out.inventory++;
      if (typeof BSContracts !== 'undefined' && document.getElementById('ct_depositPercent') && !document.getElementById('ct_depositPercent').disabled) {
        const t = BSContracts.getTerms(getDB('settings')), raw = _contractTermsRaw();
        BSContracts.TERM_FIELDS.forEach(f => { if (String(raw[f.key]).trim() === '' || Number(raw[f.key]) !== Number(t[f.key])) out.terms++; });
      }
      if (_payDraft && document.getElementById('payMethodsCard') && _payKey(_payDraft) !== _payKey(_payFromStored())) out.payments++;
      out.ask = (typeof _askSettingsDiff === 'function') ? _askSettingsDiff() : 0;
      if (_setCostsOn()) out.costs = _setCostsDiff(_setCostsRead());
      out.count = out.notify + out.business + out.inventory + out.terms + out.assistant + out.payments + out.ask + out.costs;
      return out;
    }

    function _setRecount() {
      const bar = document.getElementById('setSaveBar');
      if (!bar) return;
      const d = _setDiff();
      bar.hidden = d.count === 0;
      const txt = document.getElementById('setSaveText');
      if (txt) txt.textContent = d.count + (d.count === 1 ? ' change' : ' changes');
    }

    function _setSection(id, title, sub, body) {
      return `<section class="set-sec" id="setSec-${id}" data-sec="${id}" aria-labelledby="setH-${id}">
        <h3 class="set-h" id="setH-${id}">${title}</h3>
        ${sub ? `<p class="set-sub">${sub}</p>` : ''}
        ${body}
      </section>`;
    }

    function _setSwitchRow(id, labelId, title, sub, onclick) {
      return `<div class="set-row">
        <div class="set-row-text"><div class="set-row-title" id="${labelId}">${title}</div><div class="set-row-sub">${sub}</div></div>
        <button type="button" class="switch" role="switch" id="${id}" aria-checked="false" aria-labelledby="${labelId}" onclick="${onclick}"></button>
      </div>`;
    }

    // The Settings section shell is written once. Desktop: side list plus every section stacked. Phone: a list that opens one section.
    function _setShell() {
      const sec = document.getElementById('settings');
      if (!sec || sec.getAttribute('data-p7') === '1') return;
      sec.setAttribute('data-p7', '1');
      const u = BSPortal.getCurrentUser() || {};
      const admin = ['master', 'admin'].includes(u.role);
      const costsOn = _setCostsOn();
      const chev = _p7Icon('chevron-right', 20);
      const items = [['business', 'Business'], ['notifications', 'Notifications'], ['contract', 'Contract terms'], ['payments', 'Payment methods'], ['optouts', 'Email opt-outs'], ['assistant', 'Contract assistant']]
        .concat(u.role === 'master' ? [['ask', 'Ask assistant']] : []).concat(admin ? [['team', 'Team']] : []).concat([['inventory', 'Inventory']]).concat(costsOn ? [['costs', 'Costs & travel']] : []);
      sec.innerHTML = `
        <div class="set-layout" id="setLayout" data-view="list" data-active="business">
          <nav class="set-nav" aria-label="Settings sections">
            ${items.map(i => `<button type="button" class="set-nav-item" data-sec="${i[0]}" onclick="settingsGo('${i[0]}')"><span>${i[1]}</span>${chev}</button>`).join('')}
          </nav>
          <div class="set-content" id="setContent" oninput="_setRecount()" onchange="_setRecount()">
            <button type="button" class="set-back btn btn-ghost" onclick="settingsBack()">${_p7Icon('chevron-left', 20)} Settings</button>
            ${_setSection('business', 'Business', 'Your business details for emails and paperwork.', `
              <div class="field"><label class="field-label" for="setBizName">Business name</label><input type="text" class="form-input" id="setBizName" autocomplete="organization" placeholder="Baseline Studio"></div>
              <div class="field"><label class="field-label" for="setBizAddress">Mailing address</label><textarea class="form-textarea" id="setBizAddress" rows="3" autocomplete="street-address" placeholder="Street, city, state, ZIP"></textarea><span class="field-hint">Campaign emails need a business mailing address.</span></div>`)}
            ${_setSection('notifications', 'Notifications', 'Choose when you get emailed after a client updates their portal. Saving applies these choices to every event.', `
              ${_setSwitchRow('notifyMasterTrack', 'notifyMasterLabel', 'Email me when clients update their portal', 'Master switch. Turn off to stop all portal update emails.', "toggleNotify('master')")}
              <div id="notifySubToggles" class="set-subs">
                ${_setSwitchRow('notifyMsgTrack', 'notifyMsgLabel', 'New messages from clients', 'When a client sends you a message through their portal.', "toggleNotify('messages')")}
                ${_setSwitchRow('notifyPrefsTrack', 'notifyPrefsLabel', 'Preference and enhancement changes', 'Vibe, music and special effects choices.', "toggleNotify('prefs')")}
                ${_setSwitchRow('notifyTimelineTrack', 'notifyTimelineLabel', 'Timeline changes', 'When a client adds or edits run-of-show entries.', "toggleNotify('timeline')")}
                ${_setSwitchRow('notifyVendorsTrack', 'notifyVendorsLabel', 'Vendor and enhancement additions', 'When a client adds a preferred vendor or service.', "toggleNotify('vendors')")}
              </div>`)}
            ${_setSection('contract', 'Contract terms', '', `<div id="contractTermsCard"></div>`)}
            ${_setSection('payments', 'Payment methods', 'How clients can pay you. They see the ones that are switched on, on their portal and on invoices. Zelle always shows first.', `<div id="payMethodsCard"></div>`)}
            ${_setSection('optouts', 'Email opt-outs', 'People who asked not to get marketing email. Campaigns skip them. Messages about an event someone booked, like invoices and contracts, are never blocked.', `<div id="optoutsCard"></div>`)}
            ${_setSection('assistant', 'Contract assistant', 'Optional. Suggests wording changes inside the contract editor. It stays hidden until a link is set in ai-config.js.', `
              <div class="field"><span class="field-label">Assistant link</span><p class="set-sub" id="setAiUrl">Not set</p><span class="field-hint">Set in ai-config.js. It is part of the site files, so nobody can change it from inside the CRM. It uses the free plan, so it stops for the day when the free limit is used and never bills. Nothing is sent until you press Suggest changes in a contract.</span></div>`)}
            ${u.role === 'master' ? _setSection('ask', 'Ask assistant', 'Optional. Ask answers questions about your events, money and leads, and drafts replies. Set who can use it and how many questions a day.', `<div id="askSettingsCard"></div>`) : ''}
            ${admin ? _setSection('team', 'Team', 'Logins and your crew roster live on the Team screen.', `<button type="button" class="btn btn-secondary" onclick="switchSection('accounts')">Open Team</button>`) : ''}
            ${_setSection('inventory', 'Inventory', 'Gear catalog, pull lists and check-out.', `
              ${_setSwitchRow('setInvEnabled', 'setInvEnabledLabel', 'Use inventory', 'Shows Inventory in the menu and on events.', '_setInvToggle(this)')}
              ${_setSwitchRow('setInvScan', 'setInvScanLabel', 'Scan check-out and check-in', 'Lets crew scan tags to take gear out and bring it back.', '_setInvToggle(this)')}
              <div class="field" style="margin-top:var(--sp-4);"><label class="field-label" for="setInvNextTag">Next tag number</label><input type="number" class="form-input" id="setInvNextTag" min="1" step="1" inputmode="numeric" style="max-width:160px;"><span class="field-hint">Tags look like BL-000123. The number can only go up, so a tag is never used twice.</span></div>
              <button type="button" class="btn btn-secondary" onclick="_setOpenPullDefaults()">Pull list defaults</button>`)}
            ${costsOn ? _setCostsSectionHtml() : ''}
          </div>
          <div class="set-savebar" id="setSaveBar" role="region" aria-label="Unsaved changes" hidden>
            <span class="set-savebar-text" id="setSaveText" aria-live="polite">0 changes</span>
            <span class="set-savebar-actions">
              <button type="button" class="btn btn-ghost" onclick="discardSettings()">Discard</button>
              <button type="button" class="btn btn-primary" id="saveSettingsBtn" onclick="saveSettingsAll()">Save</button>
            </span>
          </div>
        </div>`;
      const first = document.querySelector('.set-nav-item[data-sec="business"]'); if (first) first.setAttribute('aria-current', 'true');
      const sb = document.getElementById('setSec-business'); if (sb) sb.classList.add('is-active');
    }

    function settingsGo(secId) {
      const lay = document.getElementById('setLayout');
      if (!lay) return;
      lay.setAttribute('data-active', secId);
      lay.setAttribute('data-view', 'detail');
      document.querySelectorAll('.set-nav-item').forEach(b => { if (b.getAttribute('data-sec') === secId) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      document.querySelectorAll('.set-sec').forEach(s => s.classList.toggle('is-active', s.getAttribute('data-sec') === secId));
      const el = document.getElementById('setSec-' + secId);
      const mc = document.querySelector('.main-content');
      if (window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches) { if (mc) mc.scrollTop = 0; }
      else if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function settingsBack() {
      const lay = document.getElementById('setLayout');
      if (lay) lay.setAttribute('data-view', 'list');
      const mc = document.querySelector('.main-content'); if (mc) mc.scrollTop = 0;
    }

    function _fillSettings() {
      const s = _setStored();
      Object.keys(_NOTIFY_SWITCHES).forEach(k => _applyToggle(_NOTIFY_SWITCHES[k], s.notify[k]));
      _updateSubToggleVisibility(s.notify.enabled);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('setBizName', s.business.name || ''); set('setBizAddress', s.business.address || ''); { const ai = document.getElementById('setAiUrl'); if (ai) ai.textContent = (typeof _aiUrl === 'function' && _aiUrl()) || 'Not set'; }
      _applyInvSwitch('setInvEnabled', s.inventory.enabled); _applyInvSwitch('setInvScan', s.inventory.scan);
      set('setInvNextTag', s.inventory.nextTag);
      const nt = document.getElementById('setInvNextTag'); if (nt) nt.min = s.inventory.nextTag;
      try { _setCostsFill(); } catch (e) { console.warn('[costs settings]', e); }
      try { renderContractTerms(); } catch (e) { console.warn('[contract terms]', e); }
      _payDraft = _payFromStored();
      try { renderPayMethods(); } catch (e) { console.warn('[payment methods]', e); }
      try { renderOptoutsCard(true); } catch (e) { console.warn('[email opt-outs]', e); }
      try { if (typeof renderAskSettings === 'function') renderAskSettings(); } catch (e) { console.warn('[ask settings]', e); }
    }

    // force = true on Save and Discard. Opening the screen again keeps changes that were not saved yet.
    function renderSettings(force) {
      const sec = document.getElementById('settings');
      const built = !!sec && sec.getAttribute('data-p7') === '1';
      if (built && force !== true && _setDiff().count > 0) { _setRecount(); return; }
      _setShell();
      _fillSettings();
      _setRecount();
    }

    function discardSettings() { renderSettings(true); showToast('Changes discarded', 'info'); }

    function _applyInvSwitch(id, on) { const el = document.getElementById(id); if (el) el.setAttribute('aria-checked', on ? 'true' : 'false'); }
    function _setInvToggle(btn) { btn.setAttribute('aria-checked', btn.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); _setRecount(); }

    // Pull list defaults belong to the Inventory screen (60-library.js reads the sub view from the address).
    function _setOpenPullDefaults() {
      switchSection('equipment');
      try { history.replaceState(history.state, '', '#/equipment/defaults'); } catch (e) { /* ignore */ }
      if (typeof renderEquipment === 'function') renderEquipment();
    }

    // ── Email opt-outs panel (Settings). Add and Remove act right away (an opt-out must not wait for the Save bar). ──
    // The list lives in Supabase (sql/p3-optout.sql) and in window._optouts. loadOptouts and _optoutRpc are in 75-marketing.js.
    const _OPTOUT_SOURCES = { link: 'Unsubscribe link', reply: 'Replied UNSUBSCRIBE', phone: 'Asked by phone', manual: 'Added by hand' };
    // Only the owner and admins may add or remove opt-outs. Everyone else sees the list read-only. Checked in the actions too, not just by hiding buttons.
    function _optoutCanEdit() { const u = (typeof BSPortal !== 'undefined' && BSPortal.getCurrentUser && BSPortal.getCurrentUser()) || {}; return u.role === 'master' || u.role === 'admin'; }
    function _optoutSourceLabel(s) { return _OPTOUT_SOURCES[s] || (s ? String(s) : 'Not recorded'); }

    function renderOptoutsCard(reload) {
      const el = document.getElementById('optoutsCard');
      if (!el) return;
      const state = window._optoutsState;
      if (reload && typeof loadOptouts === 'function') {
        if (!state) el.innerHTML = '<p class="set-sub">Loading the list.</p>';
        loadOptouts().then(() => renderOptoutsCard(false), () => {});
        if (!state) return;
      }
      if (state === 'missing') {
        el.innerHTML = '<p class="set-sub" style="color:var(--text-2);">Not set up yet. The opt-out list has not been turned on for this account, so campaigns cannot check it. Hold marketing email until it is set up.</p>';
        return;
      }
      if (state === 'error' && !Array.isArray(window._optouts)) {
        el.innerHTML = '<p class="set-sub" style="color:var(--text-2);">The list could not be loaded. Check your connection and open Settings again.</p>';
        return;
      }
      const locked = !_optoutCanEdit();
      const rows = (Array.isArray(window._optouts) ? window._optouts : []).slice().sort((a, b) => String(b.opted_out_at || '').localeCompare(String(a.opted_out_at || '')));
      const fmt = d => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
      const list = rows.length
        ? `<div class="optout-list" role="list">${rows.map(o => `
            <div class="set-row optout-row" role="listitem">
              <div class="set-row-text"><div class="set-row-title" data-user-content>${esc(o.email)}</div><div class="set-row-sub">${esc(fmt(o.opted_out_at))}${o.opted_out_at ? ' · ' : ''}${esc(_optoutSourceLabel(o.source))}</div></div>
              ${locked ? '' : `<button type="button" class="btn btn-ghost" data-email="${esc(o.email)}" onclick="optoutRemove(this.getAttribute('data-email'))">Remove</button>`}
            </div>`).join('')}</div>`
        : '<p class="set-sub" style="color:var(--text-2);">No one has opted out yet.</p>';
      const add = locked ? '' : `
        <div class="field"><label class="field-label" for="optoutEmail">Add an opt-out</label>
          <input type="email" class="form-input" id="optoutEmail" autocomplete="off" inputmode="email" placeholder="name@example.com">
          <span class="field-hint">Use this when someone replies UNSUBSCRIBE or asks you by phone.</span></div>
        <div class="field"><label class="field-label" for="optoutSource">How they asked</label>
          <select class="form-input" id="optoutSource"><option value="reply">Replied UNSUBSCRIBE</option><option value="phone">Asked by phone</option><option value="manual">Other</option></select></div>
        <button type="button" class="btn btn-secondary" id="optoutAddBtn" onclick="optoutAdd()">Add opt-out</button>`;
      el.innerHTML = `${add}<div style="margin-top:var(--sp-5, 24px);">${list}</div>`;
    }

    async function optoutAdd() {
      if (!_optoutCanEdit()) { showToast('Only the owner and admins can change the opt-out list.', 'warning'); return; }
      const inp = document.getElementById('optoutEmail'), src = document.getElementById('optoutSource'), btn = document.getElementById('optoutAddBtn');
      const email = String(inp ? inp.value : '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Enter a valid email address.', 'error'); return; }
      if (btn) btn.disabled = true;
      const r = await _optoutRpc('add_optout', { p_email: email, p_source: src ? src.value : 'manual' });
      if (btn) btn.disabled = false;
      if (!r.ok) { showToast('Could not add that opt-out. Check your connection and try again.', 'error'); return; }
      await loadOptouts();
      renderOptoutsCard(false);
      showToast(email + ' will not get marketing email.', 'success');
    }

    async function optoutRemove(email) {
      if (!_optoutCanEdit()) { showToast('Only the owner and admins can change the opt-out list.', 'warning'); return; }
      const ok = await CRMUI.confirm({ title: 'Remove ' + email + '?', body: 'Only remove someone if they asked to receive marketing email again.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      const r = await _optoutRpc('remove_optout', { p_email: email });
      if (!r.ok) { showToast('Could not remove that opt-out. Check your connection and try again.', 'error'); return; }
      await loadOptouts();
      renderOptoutsCard(false);
      showToast(email + ' can get marketing email again.', 'success');
    }

    // ── Contract terms panel (Settings). One object: settings.contractTerms. Read by contract-templates.js. ──
    function renderContractTerms() {
      const el = document.getElementById('contractTermsCard');
      if (!el || typeof BSContracts === 'undefined') return;
      const t = BSContracts.getTerms(getDB('settings'));
      const u = BSPortal.getCurrentUser() || {};
      const locked = u.role === 'dj';
      const GROUPS = [
        ['Deposit and balance', ['depositPercent', 'balanceDueDays', 'detailsDueDays']],
        ['Cancellation', ['cancelFarDays', 'cancelNearDays', 'cancelMidPercent']],
        ['Overtime', ['overtimeDjRate', 'overtimeCrewRate', 'overtimeBlockMinutes']]
      ];
      const known = {}; GROUPS.forEach(g => g[1].forEach(k => { known[k] = true; }));
      const rest = BSContracts.TERM_FIELDS.filter(f => !known[f.key]).map(f => f.key);
      if (rest.length) GROUPS.push(['Other', rest]);
      const unitText = { '%': 'percent', days: 'days', 'min': 'minutes', '$/hr': 'per hour' };
      const row = f => `
        <div class="ct-row">
          <label for="ct_${f.key}" class="ct-label" style="color:var(--text-1);">${esc(f.label)}</label>
          <span class="ct-ctl">
            ${f.unit === '$/hr' ? '<span class="ct-pre" aria-hidden="true">$</span>' : ''}<input type="number" class="form-input" id="ct_${f.key}" value="${esc(t[f.key])}" min="${f.min}" max="${f.max}" step="${f.step}" inputmode="decimal" oninput="_contractTermsPreview()" ${locked ? 'disabled' : ''}>
            <span class="ct-unit">${esc(unitText[f.unit] || f.unit)}</span>
          </span>
        </div>`;
      const groups = GROUPS.map(g => `<fieldset class="ct-fs"><legend>${esc(g[0])}</legend>${g[1].map(k => BSContracts.TERM_FIELDS.find(f => f.key === k)).filter(Boolean).map(row).join('')}</fieldset>`).join('');
      el.innerHTML = `
        <p class="set-sub" style="color:var(--text-2);">These numbers fill every new contract. Contracts already created keep the terms they were created with.</p>
        ${groups}
        <div id="ctPreview" class="ct-preview" style="color:var(--text-2);border-top:1px solid var(--border-ui);"></div>
        ${locked ? '' : `<div class="ct-actions"><button type="button" class="btn btn-secondary" onclick="resetContractTerms()">Fill in defaults</button></div>`}`;
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
      if (!v.ok) { el.style.color = 'var(--warn)'; el.textContent = v.errors[0]; return; }
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
      if (typeof _setRecount === 'function') _setRecount();
    }

    function resetContractTerms() {
      BSContracts.TERM_FIELDS.forEach(f => { const i = document.getElementById('ct_' + f.key); if (i) i.value = BSContracts.DEFAULT_TERMS[f.key]; });
      _contractTermsPreview();
      showToast('Defaults filled in. Press Save to keep them.', 'info');
      if (typeof _setRecount === 'function') _setRecount();
    }

    // ── Payment methods panel (Settings). Editing happens on a draft; the Save bar writes it (_paySave). ──
    let _payDraft = null;

    function _payFromStored() {
      const st = getDB('settings') || {};
      const p = st.payments || {};
      const fee = (p.cardFeePercent === '' || p.cardFeePercent == null) ? '' : String(p.cardFeePercent);
      return { methods: _payMethodsOf(p), fee };
    }
    function _payKey(d) { return JSON.stringify([d.methods.map(m => [m.id, m.type, m.label, m.details, m.note, !!m.enabled]), String(d.fee).trim()]); }
    function _payLocked() { const u = BSPortal.getCurrentUser() || {}; return u.role === 'dj'; }

    function renderPayMethods() {
      const el = document.getElementById('payMethodsCard');
      if (!el) return;
      if (!_payDraft) _payDraft = _payFromStored();
      const locked = _payLocked();
      const dis = locked ? ' disabled' : '';
      const ms = _payDraft.methods;
      const list = ms.map((m, i) => {
        const t = _payType(m.type);
        const last = i === ms.length - 1;
        return `<div class="pay-m${m.enabled ? '' : ' is-off'}" data-pay-i="${i}">
          <div class="pay-m-head">
            <div class="set-row-text"><div class="set-row-title">${esc(m.label)}</div><div class="set-row-sub">${esc(t.name)}${m.enabled ? '' : '. Hidden from clients'}</div></div>
            <div class="pay-m-acts">
              <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Move ${esc(m.label)} up" onclick="_payMove(${i},-1)"${i === 0 ? ' disabled' : dis}>${_p7Icon('chevron-up', 18)}</button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Move ${esc(m.label)} down" onclick="_payMove(${i},1)"${last ? ' disabled' : dis}>${_p7Icon('chevron-down', 18)}</button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(m.label)}" onclick="_payDelete(${i})"${dis}>${_p7Icon('trash-2', 18)}</button>
              <button type="button" class="switch" role="switch" id="payOn${i}" aria-checked="${m.enabled ? 'true' : 'false'}" aria-label="Show ${esc(m.label)} to clients" onclick="_payToggle(${i})"${dis}></button>
            </div>
          </div>
          <div class="field"><label class="field-label" for="payLabel${i}">Name clients see</label><input type="text" class="form-input" id="payLabel${i}" value="${esc(m.label)}" maxlength="40" oninput="_payEdit(${i},'label',this.value)"${dis}></div>
          <div class="field"><label class="field-label" for="payDetails${i}">${esc(t.detailsLabel)}</label><input type="text" class="form-input" id="payDetails${i}" value="${esc(m.details)}" placeholder="${esc(t.placeholder)}" autocomplete="off" oninput="_payEdit(${i},'details',this.value)"${dis}>${t.hint ? `<span class="field-hint">${esc(t.hint)}</span>` : ''}</div>
          <div class="field"><label class="field-label" for="payNote${i}">Note for clients (optional)</label><input type="text" class="form-input" id="payNote${i}" value="${esc(m.note)}" maxlength="120" autocomplete="off" oninput="_payEdit(${i},'note',this.value)"${dis}></div>
        </div>`;
      }).join('');
      const opts = _payTypes().map(t => `<option value="${t.type}">${esc(t.name)}</option>`).join('');
      el.innerHTML = `
        ${ms.length ? list : `<p class="set-sub">No payment methods yet. Until you add one, clients are told to pay by Zelle.</p>`}
        <div class="pay-add">
          <label class="field-label" for="payAddType">Add a way to pay</label>
          <div class="pay-add-row"><select class="form-select" id="payAddType"${dis}>${opts}</select><button type="button" class="btn btn-secondary" onclick="_payAdd()"${dis}>${_p7Icon('plus', 16)} Add</button></div>
        </div>
        <div class="field pay-fee"><label class="field-label" for="payFee">Card fee percent (optional)</label>
          <input type="number" class="form-input" id="payFee" min="0" max="20" step="0.1" inputmode="decimal" value="${esc(_payDraft.fee)}" placeholder="3" oninput="_payFeeEdit(this.value)"${dis}>
          <span class="field-hint">Shown next to card payment links as "A 3% card fee applies." Leave empty for no fee note.</span></div>`;
    }

    function _payEdit(i, key, v) {
      const m = _payDraft && _payDraft.methods[i];
      if (!m) return;
      m[key] = String(v);
      if (typeof _setRecount === 'function') _setRecount();
    }
    function _payFeeEdit(v) { if (_payDraft) _payDraft.fee = String(v); if (typeof _setRecount === 'function') _setRecount(); }
    function _payToggle(i) {
      const m = _payDraft && _payDraft.methods[i];
      if (!m) return;
      m.enabled = !m.enabled;
      renderPayMethods();
      if (typeof _setRecount === 'function') _setRecount();
    }
    function _payMove(i, dir) {
      const ms = _payDraft && _payDraft.methods, j = i + dir;
      if (!ms || j < 0 || j >= ms.length) return;
      const x = ms[i]; ms[i] = ms[j]; ms[j] = x;
      renderPayMethods();
      if (typeof _setRecount === 'function') _setRecount();
      const b = document.querySelector('[data-pay-i="' + j + '"] .pay-m-acts button:nth-child(' + (dir < 0 ? 1 : 2) + ')');
      if (b && !b.disabled) b.focus();
    }
    function _payAddMethod(type) {
      if (!_payDraft) _payDraft = _payFromStored();
      const m = _payNormMethod({ type, enabled: true });
      m.label = _payType(type).name;
      _payDraft.methods.push(m);
      return m;
    }
    function _payAdd() {
      const sel = document.getElementById('payAddType');
      _payAddMethod(sel ? sel.value : 'other');
      renderPayMethods();
      if (typeof _setRecount === 'function') _setRecount();
      const last = _payDraft.methods.length - 1, d = document.getElementById('payDetails' + last);
      if (d) d.focus();
    }
    function _payDelete(i) {
      const ms = _payDraft && _payDraft.methods;
      if (!ms || !ms[i]) return;
      const gone = ms.splice(i, 1)[0];
      renderPayMethods();
      if (typeof _setRecount === 'function') _setRecount();
      showUndoToast(gone.label + ' removed. Press Save to keep that.', function () { _payUndoDelete(gone, i); });
    }
    function _payUndoDelete(m, i) {
      if (!_payDraft || _payDraft.methods.some(x => x.id === m.id)) return;
      _payDraft.methods.splice(Math.min(i, _payDraft.methods.length), 0, m);
      renderPayMethods();
      if (typeof _setRecount === 'function') _setRecount();
    }

    // Checks the draft and returns what to save, or { error }. Writes nothing.
    function _payBuildSave() {
      const d = _payDraft || _payFromStored();
      const methods = d.methods.map(m => _payNormMethod(m));
      for (const m of methods) {
        if (!m.enabled) continue;
        const t = _payType(m.type);
        if (t.required && !m.details) return { error: 'Add the details for ' + m.label + ', or switch it off.' };
        if (m.type === 'card_link' && !_paySafeUrl(m.details)) return { error: 'The card payment link must start with https://.' };
      }
      const feeRaw = String(d.fee == null ? '' : d.fee).trim();
      let fee = '';
      if (feeRaw !== '') {
        const n = Number(feeRaw);
        if (!isFinite(n) || n < 0 || n > 20) return { error: 'The card fee must be a number from 0 to 20.' };
        fee = n;
      }
      return { methods, fee };
    }

    // Writes settings.payments.methods and cardFeePercent, keeps settings.payments.zelle in step (old readers use it),
    // and copies the payments settings onto each event so the client portal can read them (same way notify choices travel).
    function _paySave(out) {
      const st = getDB('settings') || {};
      const p = Object.assign({}, st.payments || {});
      p.methods = out.methods;
      p.cardFeePercent = out.fee;
      const z = out.methods.find(m => m.enabled && m.type === 'zelle' && m.details);
      p.zelle = z ? z.details : '';
      st.payments = p;
      setDB('settings', st);
      const copy = { methods: p.methods, cardFeePercent: p.cardFeePercent, zelle: p.zelle };
      if (p.enabled === true) copy.enabled = true;
      if (p.link) copy.link = p.link;
      const events = getDB('events') || [];
      events.forEach(ev => { ev.settings = Object.assign({}, ev.settings || {}, { payments: copy }); });
      setDB('events', events);
      showToast('Payment methods saved.', 'success');
    }

    function _applyToggle(id, on) {
      const track = document.getElementById(id + 'Track');
      if (!track) return;
      if (on) track.classList.add('on'); else track.classList.remove('on');
      if (track.getAttribute('role') === 'switch') track.setAttribute('aria-checked', on ? 'true' : 'false');
    }

    // With the master switch off the four detail switches are shown but cannot be changed.
    function _updateSubToggleVisibility(masterOn) {
      ['notifyMsgTrack', 'notifyPrefsTrack', 'notifyTimelineTrack', 'notifyVendorsTrack'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = !masterOn; }
      });
    }

    // Changes the switch on screen only. The Save bar writes it (saveNotifySettings).
    function toggleNotify(which) {
      const key = which === 'master' ? 'enabled' : which;
      const id = _NOTIFY_SWITCHES[key];
      if (!id) return;
      const on = !_setSwitchOn(id + 'Track');
      _applyToggle(id, on);
      if (key === 'enabled') _updateSubToggleVisibility(on);
      _setRecount();
    }

    async function saveNotifySettings() {
      const ns = _setReadNotify();
      const s = getDB('settings') || {};
      s.notify = ns;
      setDB('settings', s);

      // Copy the choices onto every event in the provider's own data. The client portal reads
      // event.providerNotify from there. (Writing through the client RPC never worked:
      // update_client_event only lets clients write their own fields.)
      const events = getDB('events') || [];
      let pushed = 0;
      events.forEach(ev => {
        ev.providerNotify = ns;
        if (ev.portalPassword && (ev.portalEmail || ev.clientEmail)) pushed++;
      });
      setDB('events', events);

      const msg = pushed > 0
        ? 'Notification settings saved. Applied to ' + pushed + ' active event' + (pushed > 1 ? 's' : '') + '.'
        : 'Notification settings saved.';
      showToast(msg, 'success');
    }

    // The sticky bar: checks everything first, writes nothing if anything is invalid, then saves each part.
    async function saveSettingsAll() {
      const d = _setDiff();
      if (!d.count) return;
      if (d.ask && typeof _askSettingsCheck === 'function') { const askErr = _askSettingsCheck(); if (askErr) { showToast(askErr, 'error'); return; } }
      if (d.terms) {
        const v = BSContracts.validateTerms(_contractTermsRaw());
        if (!v.ok) { showToast(v.errors[0], 'error'); return; }
      }
      const stored = _setStored();
      let nextTag = null;
      if (d.inventory) {
        nextTag = parseInt(_setVal('setInvNextTag'), 10);
        if (!(nextTag >= Number(stored.inventory.nextTag))) {
          showToast('The next tag number can only go up. Tags already handed out are never reused.', 'error');
          return;
        }
      }
      let costsRead = null;
      if (d.costs) {
        costsRead = _setCostsRead();
        const costsErr = _setCostsOn() ? _setCostsCheck(costsRead) : 'Costs settings are only for the owner and managers.';
        if (costsErr) { showToast(costsErr, 'error'); return; }
      }
      let payOut = null;
      if (d.payments) {
        payOut = _payBuildSave();
        if (payOut.error) { showToast(payOut.error, 'error'); return; }
      }
      const btn = document.getElementById('saveSettingsBtn');
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true'); btn.disabled = true; }
      try {
        if (d.business || d.inventory) {
          const st = getDB('settings') || {};
          if (d.business) st.business = { name: _setVal('setBizName').trim(), address: _setVal('setBizAddress').trim() };
          if (d.inventory) st.inventory = Object.assign({}, st.inventory || {}, { enabled: _setSwitchOn('setInvEnabled'), scan: _setSwitchOn('setInvScan'), nextTag });
          setDB('settings', st);
        }
        if (d.costs && costsRead && typeof costsSaveSettings === 'function') costsSaveSettings(_setCostsBuild(costsRead, costsSettings()));
        if (d.payments) _paySave(payOut);
        if (d.terms) saveContractTerms();
        if (d.notify) await saveNotifySettings();
        else if (!d.terms && !d.payments && !d.ask) showToast('Settings saved', 'success');
        if (d.ask && typeof _askSettingsSave === 'function') await _askSettingsSave();
      } finally {
        if (btn) { btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled'); btn.disabled = false; }
      }
      renderSettings(true);
    }

    // ── Reports ───────────────────────────────────────────────────────────────
    // Money numbers come from _reportsMoney and _reportRangeBounds (50-money.js). This screen only lays them out.
    function _reportsShell() {
      const sec = document.getElementById('reports');
      if (!sec || sec.getAttribute('data-p7') === '1') return;
      sec.setAttribute('data-p7', '1');
      const chips = [['month', 'This month'], ['last_month', 'Last month'], ['last90', 'Last 90 days'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']];
      sec.innerHTML = `
        <div class="rep-wrap">
          <select id="reportRange" hidden aria-hidden="true" tabindex="-1">
            <option value="all">All time</option><option value="month">This month</option><option value="last_month">Last month</option>
            <option value="last90">Last 90 days</option><option value="year">This year</option><option value="custom">Custom</option>
          </select>
          <div class="rep-chips" role="group" aria-label="Report period">
            ${chips.map(c => `<button type="button" class="chip" data-range="${c[0]}" aria-pressed="false" onclick="_reportSetRange('${c[0]}')">${c[1]}</button>`).join('')}
          </div>
          <div class="rep-custom" id="reportCustom" hidden>
            <div class="field"><label class="field-label" for="reportFrom">From</label><input type="date" class="form-input" id="reportFrom" onchange="renderReports()"></div>
            <div class="field"><label class="field-label" for="reportTo">To</label><input type="date" class="form-input" id="reportTo" onchange="renderReports()"></div>
          </div>
          <div class="stat-cards" id="reportsStats"></div>
          <p class="t-meta rep-note">Billed is the total of invoices created in the period. Collected is invoices marked paid plus payments logged, counted once. Outstanding is invoices not yet paid. Payments marked on an event without an invoice are not included. Events counts booked, confirmed and completed events by event date.</p>
          <section class="rep-card" aria-labelledby="repMonthH"><h3 class="rep-h" id="repMonthH">By month</h3><div id="reportsByMonth"></div></section>
          <div class="rep-split">
            <section class="rep-card" aria-labelledby="repTypeH"><h3 class="rep-h" id="repTypeH">Events by type</h3><div id="typeChart"></div></section>
            <section class="rep-card" aria-labelledby="repStatusH"><h3 class="rep-h" id="repStatusH">Events by status</h3><div id="statusChart"></div></section>
          </div>
        </div>`;
    }

    function _reportSetRange(key) {
      const sel = document.getElementById('reportRange');
      if (sel) sel.value = key;
      renderReports();
    }

    function _reportBoundsFor(key) {
      if (key === 'custom') {
        const f = document.getElementById('reportFrom'), t = document.getElementById('reportTo');
        const from = f && f.value ? new Date(f.value + 'T00:00:00').getTime() : null;
        const to = t && t.value ? new Date(t.value + 'T00:00:00').getTime() + 86400000 : null;
        return { from: from === null ? 0 : from, to: to === null ? Date.now() + 86400000 : to };
      }
      return _reportRangeBounds(key);
    }

    function _reportEventMs(e) { const t = e && e.date ? new Date(String(e.date).slice(0, 10) + 'T12:00:00').getTime() : NaN; return t; }
    function _reportCountEvents(events, from, to) {
      return events.filter(e => {
        if (!/^(booked|confirmed|completed)$/.test(String(e.status || ''))) return false;
        if (from === null) return true;
        const t = _reportEventMs(e);
        return !isNaN(t) && t >= from && t < to;
      }).length;
    }

    // One row per calendar month that has activity, newest first, clipped to the chosen period so the rows add up to the cards.
    function _reportMonthRows(invoices, tx, events, b) {
      const stamp = v => (typeof v === 'number') ? v : new Date(v).getTime();
      const months = {};
      const add = ts => { const t = stamp(ts); if (isNaN(t)) return; const d = new Date(t); months[d.getFullYear() + '-' + d.getMonth()] = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
      (invoices || []).forEach(i => { if (i) { add(i.createdAt); if (i.paidAt) add(i.paidAt); } });
      (tx || []).forEach(t => { if (t) add(t.date); });
      events.forEach(e => { if (/^(booked|confirmed|completed)$/.test(String(e.status || ''))) add(_reportEventMs(e)); });
      return Object.keys(months).map(k => months[k]).sort((x, y) => y - x).slice(0, 12).map(start => {
        const d = new Date(start), end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
        const from = b.from === null ? start : Math.max(b.from, start), to = b.to === null ? end : Math.min(b.to, end);
        if (from >= to) return null;
        const m = _reportsMoney(invoices, tx, { from, to });
        return { label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), billed: m.billed, collected: m.collected, outstanding: m.outstanding, events: _reportCountEvents(events, from, to) };
      }).filter(Boolean);
    }

    function _reportStatusPill(status) {
      const cls = /^(completed|booked|confirmed)$/.test(status) ? 'pill-ok' : /^(cancelled|ghosted)$/.test(status) ? 'pill-danger' : /^(lead|new)$/.test(status) ? 'pill-info' : 'pill-warn';
      return `<span class="pill ${cls}" data-ui="pill">${esc(String(status || 'unknown').replace(/_/g, ' '))}</span>`;
    }

    // Costs and profit for the events in a report range (same event filter as the Events card). Profit is billed minus costs logged,
    // so it is the "if fully paid" figure. Needs 55-costs.js; returns zeros when it is not loaded. Never writes anything.
    function _reportCostsSummary(events, from, to) {
      const out = { costsC: 0, profitC: 0, billedC: 0, events: 0, withCosts: 0, marginPct: null };
      if (typeof costsGet !== 'function' || typeof costsTotalsFrom !== 'function' || typeof costsRevenue !== 'function') return out;
      const minMargin = (typeof costsSettings === 'function') ? costsSettings().minMargin : 30;
      (events || []).forEach(e => {
        if (!e || !/^(booked|confirmed|completed)$/.test(String(e.status || ''))) return;
        if (from !== null && from !== undefined) {
          const t = _reportEventMs(e);
          if (isNaN(t) || t < from || t >= to) return;
        }
        const lines = costsGet(e.id).lines;
        const t = costsTotalsFrom(lines, costsRevenue(e.id), minMargin);
        out.events++;
        if (t.countedC > 0) out.withCosts++;
        out.costsC += t.countedC;
        out.billedC += t.billedC;
        out.profitC += t.profitC;
      });
      out.marginPct = out.billedC > 0 ? Math.round(out.profitC / out.billedC * 1000) / 10 : null;
      return out;
    }

    function renderReports() {
      const events = getDB('events') || [];
      if (typeof _reportsShell === 'function') _reportsShell();
      const rangeEl = document.getElementById('reportRange');
      const key = (rangeEl && rangeEl.value) || 'all';
      const b = typeof _reportBoundsFor === 'function' ? _reportBoundsFor(key) : _reportRangeBounds(key);
      const invoices = getDB('invoices') || [], tx = getDB('transactions') || [];
      const money = _reportsMoney(invoices, tx, b);
      const nEvents = typeof _reportCountEvents === 'function' ? _reportCountEvents(events, b.from, b.to) : 0;

      let html = '';
      [
        { label: 'Billed', value: _fmtMoney(money.billed), sub: money.billedCount + (money.billedCount === 1 ? ' invoice' : ' invoices') },
        { label: 'Collected', value: _fmtMoney(money.collected), sub: (money.paidCount + money.txCount) + ' payments' },
        { label: 'Outstanding', value: _fmtMoney(money.outstanding), sub: 'Not yet paid' },
        { label: 'Events', value: String(nEvents), sub: 'Booked or done' }
      ].forEach(s => {
        html += `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value num">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`;
      });
      // Costs and Profit: provider-only, shown to the owner and managers (costsCanView) and only when 55-costs.js is loaded.
      if (typeof costsCanView === 'function' && costsCanView() && typeof _reportCostsSummary === 'function') {
        const cs = _reportCostsSummary(events, b.from, b.to);
        [
          { label: 'Costs', value: esc(costsFmtC(cs.costsC)), sub: cs.withCosts + (cs.withCosts === 1 ? ' event' : ' events') + ' with costs' },
          { label: 'Profit', value: esc(costsFmtC(cs.profitC)), sub: cs.marginPct === null ? 'Billed minus costs' : cs.marginPct + '% margin if fully paid' }
        ].forEach(s => {
          html += `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value num">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`;
        });
      }
      document.getElementById('reportsStats').innerHTML = html;

      const rows = typeof _reportMonthRows === 'function' ? _reportMonthRows(invoices, tx, events, b) : [];
      const mEl = document.getElementById('reportsByMonth');
      if (mEl) {
        mEl.innerHTML = rows.length
          ? `<div class="tbl-wrap"><table class="tbl tbl-ledger"><thead><tr><th scope="col">Month</th><th scope="col" class="num">Billed</th><th scope="col" class="num">Collected</th><th scope="col" class="num">Outstanding</th><th scope="col" class="num">Events</th></tr></thead><tbody>`
            + rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${_fmtMoney(r.billed)}</td><td class="num">${_fmtMoney(r.collected)}</td><td class="num">${_fmtMoney(r.outstanding)}</td><td class="num">${r.events}</td></tr>`).join('')
            + `</tbody></table></div>`
          : '<p class="t-meta">Nothing in this period yet.</p>';
      }

      const typeChart = {};
      events.forEach(e => { const t = e.type || 'other'; typeChart[t] = (typeChart[t] || 0) + 1; });
      document.getElementById('typeChart').innerHTML = '<div class="rep-pills">' + Object.entries(typeChart).map(([type, count]) =>
        `<span class="pill pill-neutral" data-ui="pill">${esc(String(type).replace(/_/g, ' '))} <strong class="num">${count}</strong></span>`).join('') + '</div>';

      const statusChart = {};
      events.forEach(e => { const s = e.status || 'unknown'; statusChart[s] = (statusChart[s] || 0) + 1; });
      document.getElementById('statusChart').innerHTML = '<div class="rep-pills">' + Object.entries(statusChart).map(([status, count]) =>
        `<span class="rep-stat">${typeof _reportStatusPill === 'function' ? _reportStatusPill(status) : esc(status)}<strong class="num">${count}</strong></span>`).join('') + '</div>';

      if (typeof _reportSyncChips === 'function') _reportSyncChips(key);
    }

    function _reportSyncChips(key) {
      document.querySelectorAll('.rep-chips .chip').forEach(c => {
        const on = c.getAttribute('data-range') === key;
        c.classList.toggle('is-selected', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const cu = document.getElementById('reportCustom');
      if (cu) cu.hidden = key !== 'custom';
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
              <div style="font-weight:600;margin-bottom:4px;">${esc(b.subject)}</div>
              <div style="font-size:13px;color:var(--gray);margin-bottom:6px;">${esc((b.body||'').substring(0,120))}${(b.body||'').length>120?'…':''}</div>
              <div style="font-size:12px;color:var(--gray);display:flex;gap:12px;flex-wrap:wrap;">
                <span>Sent by ${esc(b.authorName)}</span>
                <span>${new Date(b.sentAt).toLocaleString()}</span>
                <span>To: ${esc((b.targetRoles||[]).join(', '))}</span>
                <span class="blast-ack">Acknowledged: ${receipts.length}/${b.recipientCount||'?'}</span>
              </div>
            </div>
            ${b.urgent ? `<span class="pill pill-danger pill-sm" data-ui="pill" style="flex-shrink:0;">URGENT</span>` : ''}
          </div>
        </div>`;
      }).join('') || '<p class="t-meta" style="text-align:center;padding:var(--sp-8) 0;">No blasts sent yet.</p>';

      document.getElementById('docTabBlasts').innerHTML = `
        <h3 class="set-h" style="margin-bottom:var(--sp-4);">Blasts</h3>
        <div class="blast-layout">
          <div class="blast-panel">
            <div class="blast-panel-title">Compose blast</div>
            ${!availRoles.length ? `<p class="t-meta">Your role (${esc(role)}) does not have blast permissions.</p>` : `
            <div class="form-group">
              <label class="form-label" for="blastSubject">Subject</label>
              <input type="text" class="form-input" id="blastSubject" placeholder="e.g. Heads up, schedule change Saturday">
            </div>
            <div class="form-group">
              <label class="form-label" for="blastBody">Message</label>
              <textarea class="form-textarea" id="blastBody" rows="5" placeholder="Write your message"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Send to</label>
              <div class="blast-role-chips">${roleChips}</div>
            </div>
            <div class="form-group">
              <label class="check"><input type="checkbox" id="blastUrgent"><span class="check-box" aria-hidden="true"></span><span class="check-text"><strong>Urgent.</strong> Also email the people in the roles you picked, right now.</span></label>
            </div>
            <button type="button" class="btn btn-primary" style="width:100%;" onclick="sendBlast()">Send Blast</button>
            `}
          </div>
          <div>
            <div class="set-row-title" style="margin-bottom:var(--sp-3);">Sent blasts</div>
            ${blastRows}
          </div>
        </div>`;
    }

    async function sendBlast() {
      const subject = (document.getElementById('blastSubject')?.value || '').trim();
      const body = (document.getElementById('blastBody')?.value || '').trim();
      const urgent = document.getElementById('blastUrgent')?.checked;
      const selectedRoles = [...document.querySelectorAll('.blast-role-check:checked')].map(c => c.value);
      if (!subject) { showToast('Add a subject.', 'error'); return; }
      if (!body) { showToast('Add a message.', 'error'); return; }
      if (!selectedRoles.length) { showToast('Pick at least one role to send to.', 'error'); return; }
      const currentUser = BSPortal.getCurrentUser();
      const accounts = getDB('accounts') || [];
      const roleMap = { 'All': ['master','admin','event-architect','dj'], 'Owner / Admin': ['master','admin'], 'Event Manager': ['event-architect'], 'DJ / Performer': ['dj'] };
      const targetKeys = [...new Set(selectedRoles.flatMap(r => roleMap[r] || []))];
      const recipients = accounts.filter(a => targetKeys.includes(a.role));
      if (urgent && recipients.length) {
        const ok = await CRMUI.confirm({ title: 'Email ' + recipients.length + (recipients.length === 1 ? ' person' : ' people') + ' now?',
          body: 'This emails everyone in ' + selectedRoles.join(', ') + ' right away. It cannot be undone.', confirmLabel: 'Send now', danger: true });
        if (!ok) return;
      }
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
        const _blastResults = await Promise.all(recipients.map(r => Promise.resolve().then(() => BSPortal.sendEmail('generic', {
          email: r.email, clientName: r.name,
          subject: _blastSubject,
          body: _blastBody
        })).catch(err => ({ ok: false, error: String(err && err.message || err) }))));
        _blastResults.forEach((res, i) => {
          if (!res || !res.ok) { _blastFailed.push(recipients[i]); if (!_blastFirstErr) _blastFirstErr = (res && res.error) || 'unknown error'; }
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
