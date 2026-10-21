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

    function _teamLoginPill(u) {
      return u.supabaseId
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
        <td><div class="team-who">${_teamAvatar(u, 'avatar-32')}<div><div class="team-name" data-user-content>${esc(u.name)}</div><a class="team-mail" href="mailto:${esc(u.email)}" onclick="event.stopPropagation()" data-user-content>${esc(u.email)}</a></div></div></td>
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
            <span class="team-name" data-user-content>${esc(u.name)}</span>
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
        { label: 'Change photo', icon: 'pencil', onSelect: () => editUserProfile(userId) },
        u.supabaseId ? { label: 'Send sign-in link', icon: 'send', onSelect: () => _teamSendSignIn(userId) } : { label: 'Create CRM login', icon: 'send', onSelect: () => _teamSendLogin(userId) },
        u.supabaseId ? { label: 'Reset password', icon: 'lock', onSelect: () => _teamResetPassword(userId) } : null,
        { label: u.active ? 'Make unavailable for events' : 'Make available for events', icon: 'ban', onSelect: () => toggleUserActive(userId) },
        { label: 'Delete', icon: 'trash-2', danger: true, onSelect: () => deleteUser(userId) }
      ].filter(Boolean), { align: 'right' });
    }

    // Creates the CRM login and emails a new password. Only for people who have no login yet.
    function _teamSendLogin(userId) {
      const u = (getDB('users') || []).find(x => x.id === userId);
      if (u) sendLoginInfo('team', { name: u.name, email: u.email, role: u.role });
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
      const ok = await CRMUI.confirm({ title: 'Reset password for ' + (u.name || 'this person') + '?', body: 'This replaces their current password. They get an email with a new one.', confirmLabel: 'Reset password', danger: true });
      if (ok) sendLoginInfo('team', { name: u.name, email: u.email, role: u.role });
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
        <div class="team-detail-pills">${_teamRolePill(u.role)}<span class="pill ${u.active ? 'pill-ok' : 'pill-neutral'}" data-ui="pill">${u.active ? 'Available for events' : 'Not available for events'}</span></div>
        <p class="t-meta">Availability only controls event assignment. It does not sign them out.</p>
        <dl class="team-dl">
          <dt>Email</dt><dd><a class="team-link" href="mailto:${esc(u.email)}" data-user-content>${esc(u.email)}</a></dd>
          <dt>Phone</dt><dd>${u.phone ? `<a class="team-link" href="tel:${esc(String(u.phone).replace(/[^\d+]/g, ''))}" data-user-content>${esc(CRMUI.fmt.phone(u.phone))}</a>` : '<span class="t-meta">Not added</span>'}</dd>
          <dt>CRM login</dt><dd>${u.supabaseId ? '<span class="pill pill-ok pill-sm" data-ui="pill">Account created</span>' : '<span class="pill pill-neutral pill-sm" data-ui="pill">Not set up yet</span>'}</dd>
        </dl>
        <p class="t-meta">${u.supabaseId ? 'This person can sign in to the provider CRM at <code>baselinestudiofl.com/login.html</code>.' : 'Once you create their login, they get an email with their sign-in details.'}</p>
        <div class="team-detail-actions">
          ${u.supabaseId
            ? `<button type="button" class="btn btn-primary" onclick="_teamSendSignIn('${esc(u.id)}')">Send sign-in link</button><button type="button" class="btn btn-secondary" onclick="_teamResetPassword('${esc(u.id)}')">Reset password</button>`
            : `<button type="button" class="btn btn-primary" onclick="_teamSendLogin('${esc(u.id)}')">Create CRM login</button>`}
          ${u.email ? `<a class="btn btn-secondary" href="mailto:${esc(u.email)}">Email ${esc(first)}</a>` : ''}
          <button type="button" class="btn btn-secondary" onclick="closeModal('clientDetailModal');editUserProfile('${esc(u.id)}')">Change photo</button>
        </div>
      </div>`;
      openModal('clientDetailModal');
    }

    function editUserProfile(userId) {
      const users = getDB('users');
      const user = users.find(u => u.id === userId);
      if (!user) return;

      window.editingUserId = userId;
      window.newUserPhoto = null;
      document.getElementById('editAccountForm').innerHTML = `
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
      const users = getDB('users');
      const user = users.find(u => u.id === window.editingUserId);
      if (user && !window.newUserPhoto) { showToast('Choose a photo first.', 'warning'); return; }
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
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating'; }

      // Try creating in Supabase Auth so the new user can log in
      const result = await BSPortal.createProviderUser(email, password, name, role);

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

      if (result.ok) {
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

    // What changed on screen compared with what is saved. { notify, business, inventory, terms, count }
    function _setDiff() {
      const out = { notify: 0, business: 0, inventory: 0, terms: 0, count: 0 };
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
      out.count = out.notify + out.business + out.inventory + out.terms;
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
      const chev = _p7Icon('chevron-right', 20);
      const items = [['business', 'Business'], ['notifications', 'Notifications'], ['contract', 'Contract terms']]
        .concat(admin ? [['team', 'Team']] : []).concat([['inventory', 'Inventory']]);
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
            ${admin ? _setSection('team', 'Team', 'Logins and your crew roster live on the Team screen.', `<button type="button" class="btn btn-secondary" onclick="switchSection('accounts')">Open Team</button>`) : ''}
            ${_setSection('inventory', 'Inventory', 'Gear catalog, pull lists and check-out.', `
              ${_setSwitchRow('setInvEnabled', 'setInvEnabledLabel', 'Use inventory', 'Shows Inventory in the menu and on events.', '_setInvToggle(this)')}
              ${_setSwitchRow('setInvScan', 'setInvScanLabel', 'Scan check-out and check-in', 'Lets crew scan tags to take gear out and bring it back.', '_setInvToggle(this)')}
              <div class="field" style="margin-top:var(--sp-4);"><label class="field-label" for="setInvNextTag">Next tag number</label><input type="number" class="form-input" id="setInvNextTag" min="1" step="1" inputmode="numeric" style="max-width:160px;"><span class="field-hint">Tags look like BL-000123. The number can only go up, so a tag is never used twice.</span></div>
              <button type="button" class="btn btn-secondary" onclick="_setOpenPullDefaults()">Pull list defaults</button>`)}
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
      set('setBizName', s.business.name || ''); set('setBizAddress', s.business.address || '');
      _applyInvSwitch('setInvEnabled', s.inventory.enabled); _applyInvSwitch('setInvScan', s.inventory.scan);
      set('setInvNextTag', s.inventory.nextTag);
      const nt = document.getElementById('setInvNextTag'); if (nt) nt.min = s.inventory.nextTag;
      try { renderContractTerms(); } catch (e) { console.warn('[contract terms]', e); }
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
      const btn = document.getElementById('saveSettingsBtn');
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true'); btn.disabled = true; }
      try {
        if (d.business || d.inventory) {
          const st = getDB('settings') || {};
          if (d.business) st.business = { name: _setVal('setBizName').trim(), address: _setVal('setBizAddress').trim() };
          if (d.inventory) st.inventory = Object.assign({}, st.inventory || {}, { enabled: _setSwitchOn('setInvEnabled'), scan: _setSwitchOn('setInvScan'), nextTag });
          setDB('settings', st);
        }
        if (d.terms) saveContractTerms();
        if (d.notify) await saveNotifySettings();
        else if (!d.terms) showToast('Settings saved', 'success');
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
