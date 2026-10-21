// ============================================================================
// portal-provider/00-core.js  -  core: shared helpers, state seeds, toasts/modals, section switching, search, session chrome
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // getDB / setDB are defined in portal-supabase.js (loaded above).
    // They use an in-memory cache backed by Supabase — all existing calls work unchanged.
    function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }

    // ── HTML escape — always use for user-supplied content in innerHTML ──────────
    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function initData() {
      if (!getDB('users') || getDB('users').length === 0) {
        setDB('users', [
          { id: 'u1', email: 'baselinestudiofl@gmail.com', password: '', name: 'Baseline Admin', role: 'master', active: true, phone: '(786)302-6056', profilePic: null }
        ]);
      }
      if (!getDB('vendors') || getDB('vendors').length === 0) {
        setDB('vendors', [
          { id: genId(), name: 'Addison', category: 'venue', contact: 'Management', email: 'events@addisonmiamibeach.com', phone: '(305)674-6000' },
          { id: genId(), name: 'Ritz Carlton Bal Harbour', category: 'venue', contact: 'Banquets', email: 'banquets@ritzcarlton.com', phone: '(305)455-5400' }
        ]);
      }
      if (!getDB('clients') || getDB('clients').length === 0) {
        setDB('clients', []);
      }
      if (!getDB('portalUsers') || getDB('portalUsers').length === 0) {
        setDB('portalUsers', []);
      }
      if (!getDB('events') || getDB('events').length === 0) {
        setDB('events', []);
      }
      if (!getDB('templates') || getDB('templates').length === 0) {
        setDB('templates', [
          { id: genId(), name: 'Event Proposal', content: 'EVENT PROPOSAL - Dear {{client_name}},\n\nProposal for {{event_type}} on {{event_date}} at {{venue_name}}.\n\nServices Included: {{services_list}}\n\nInvestment Breakdown:\nTotal: ${{total_price}}\nDeposit Required: ${{deposit_amount}}\n\nNext Steps:\n1. Review proposal\n2. Confirm event details\n3. Sign agreement\n4. Submit deposit\n\nBaseline Studio | (786) 302-6056 | Hello@baselinestudiofl.com' }
        ]);
      }
      // F: Seed 7 default pipeline automation rules if not already an array
      if (!Array.isArray(getDB('automations'))) {
        setDB('automations', [
          { id: 'auto1', stage: 'new',    trigger: 'enter',      action: 'email',   template: 'ack',              days: 0, enabled: true,
            label: 'New lead — send ack',
            emailBody: 'Got your inquiry. We\'ll have a real quote to you within 24 hours.' },
          { id: 'auto2', stage: 'new',    trigger: 'after_days', action: 'task',    days: 1,  enabled: true,
            label: 'Follow up with {name} — quote promised in 24h',
            taskTemplate: 'Follow up with {name} — quote promised in 24h' },
          { id: 'auto3', stage: 'quoted', trigger: 'after_days', action: 'email',   template: 'generic', subject: 'Checking in on your quote', days: 3, enabled: true,
            label: 'Quote follow-up (3 days)',
            emailBody: 'Wanted to make sure your quote landed. If anything in it is unclear, or you want to adjust the hours or the lineup to fit your budget, just reply here and we will work it out. How does that sound?' },
          { id: 'auto4', stage: 'quoted', trigger: 'after_days', action: 'task',    days: 7,  enabled: true,
            label: 'Call {name} — quote going cold',
            taskTemplate: 'Call {name} — quote going cold' },
          { id: 'auto5', stage: 'booked', trigger: 'enter',      action: 'task',    days: 0,  enabled: true,
            label: 'Booked — send portal invite to {name}',
            taskTemplate: 'Send portal invite to {name}' },
          { id: 'auto6', stage: 'booked', trigger: 'enter',      action: 'task',    days: 0,  enabled: true,
            label: 'Send contract + deposit invoice to {name}',
            taskTemplate: 'Send contract + deposit invoice to {name}' },
          { id: 'auto7', stage: null,     trigger: 'days_before_event', action: 'email', template: 'generic', subject: 'Final details for your event', days: 21, enabled: true,
            label: 'Final details nudge (21 days before event)',
            emailBody: 'Your event is coming up and we love this part. Take a few minutes to look over the timeline, the music, and the vendor list, and send me anything that has changed. You enjoy the build-up. We will handle the rest.' }
        ]);
      }
    }

    // Titles for the page head and the phone app bar. Labels follow UI-PLAN 2.1.
    function _sectionTitle(id) {
      const t = { dashboard: 'Home', pipeline: 'Pipeline', events: 'Events', clients: 'Clients', vendors: 'Vendors & Venues', documents: 'Documents', equipment: 'Inventory', invoices: 'Invoices', marketing: 'Marketing', accounts: 'Team', reports: 'Reports', automations: 'Automations', settings: 'Settings' };
      return t[id] || id;
    }

    // Marks the active rail item, More sheet item and bottom bar item, and sets the titles.
    // opts.parent: the section a full-page detail view belongs to. opts.detail: true while a detail page is showing.
    function _syncNav(sectionId, opts) {
      opts = opts || {};
      const navId = opts.parent || sectionId;
      document.querySelectorAll('.rail-item, .more-item').forEach(el => {
        const on = el.getAttribute('data-section') === navId;
        el.classList.toggle('active', on);
        if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      });
      if (window.CRMUI && CRMUI.bottomBar) CRMUI.bottomBar.setActive(navId);
      const title = _sectionTitle(navId);
      const pt = document.getElementById('pageTitle'); if (pt) pt.textContent = title;
      const at = document.getElementById('appbarTitle'); if (at) at.textContent = title;
      if (document.body && document.body.classList) document.body.classList.toggle('is-detail', !!opts.detail);
      // Any route change drops the detail top bar; a detail screen turns it back on with setTopbarDetail().
      if (!opts.detail && typeof clearTopbarDetail === 'function') clearTopbarDetail();
    }

    // Phone top bar for pushed (detail) screens (UI-PLAN 1.10): back chevron left, record title centered, optional kebab right.
    // setTopbarDetail(title, backFn, menuItems): title string (empty keeps the current text), backFn defaults to goBack(),
    // menuItems is an optional CRMUI.menu item array that shows the kebab. clearTopbarDetail() undoes it and _syncNav calls it
    // on every non-detail route. On desktop the bar is unchanged (CSS only shows these on phone).
    function setTopbarDetail(title, backFn, menuItems) {
      window._topbarBack = typeof backFn === 'function' ? backFn : null;
      window._topbarMenu = Array.isArray(menuItems) && menuItems.length ? menuItems : null;
      const at = document.getElementById('appbarTitle');
      if (at && title) at.textContent = title;
      const kb = document.getElementById('appbarKebab');
      if (kb) kb.hidden = !window._topbarMenu;
      if (document.body) document.body.classList.add('has-topbar-detail');
    }
    function clearTopbarDetail() {
      window._topbarBack = null; window._topbarMenu = null;
      const kb = document.getElementById('appbarKebab'); if (kb) kb.hidden = true;
      if (document.body) document.body.classList.remove('has-topbar-detail');
    }
    function topbarBack() {
      if (typeof window._topbarBack === 'function') window._topbarBack();
      else if (typeof goBack === 'function') goBack();
    }
    function topbarKebab(anchor) {
      if (window._topbarMenu && window.CRMUI && CRMUI.menu) CRMUI.menu(anchor, window._topbarMenu, { label: 'Actions', align: 'right' });
    }

    function switchSection(sectionId) {
      // Close the More sheet when navigating
      closeMobileSidebar();
      const sec = document.getElementById(sectionId);
      if (!sec) return;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      sec.classList.add('active');
      if (typeof _syncNav === 'function') _syncNav(sectionId);
      // Screens put their page-level buttons in #pageActions when they render; start clean on every section change.
      const pa = document.getElementById('pageActions');
      if (pa) pa.innerHTML = '';

      if (sectionId === 'dashboard') renderDashboard();
      if (sectionId === 'pipeline') { renderPipeline(); loadInquiries(); }
      if (sectionId === 'events') renderEvents();
      if (sectionId === 'clients') renderClients();
      if (sectionId === 'vendors') renderVendors();
      if (sectionId === 'documents') renderDocuments();
      if (sectionId === 'equipment') renderEquipment();
      if (sectionId === 'invoices') renderInvoices();
      if (sectionId === 'marketing') renderMarketing();
      if (sectionId === 'accounts') renderAccounts();
      if (sectionId === 'reports') renderReports();
      if (sectionId === 'automations') renderAutomations();
      if (sectionId === 'settings') renderSettings();

      // Always scroll back to top when switching sections
      const mc = document.querySelector('.main-content');
      if (mc) mc.scrollTop = 0;
      _routeWrite({ type: 'section', id: sectionId }, 'push');
    }

    // Modals keep their ids and the .modal-backdrop.active markup; CRMUI gives them focus handling, Esc, and the "Discard changes?" guard.
    function openModal(modalId) {
      const el = document.getElementById(modalId);
      if (!(window.CRMUI && CRMUI.open)) { el.classList.add('active'); return; }
      el.dataset.touched = '';
      if (!el._bsDirtyBound) {
        el._bsDirtyBound = true;
        el.addEventListener('input', function() { el.dataset.touched = '1'; });
        el.addEventListener('change', function() { el.dataset.touched = '1'; });
      }
      CRMUI.open(el, {
        dirty: () => el.dataset.touched === '1',
        onClose: () => { if (!el._bsClosing) _routeModalClosed(modalId); }
      });
      try { liftModalFooter(el); } catch (e) { console.warn('[modal footer]', e); }
    }

    // Phone sheets: keep the form's primary action row in view (UI-PLAN 1.10). Runs on every openModal, on phone only.
    // If the primary sits in a row of buttons (up to 3) that row becomes the sticky footer; a lone primary is wrapped in one.
    // The CSS for .modal-sticky-foot is in portal-provider.html. Idempotent; modals that build their buttons after opening are left alone.
    function liftModalFooter(backdrop) {
      if (!window.matchMedia || !window.matchMedia('(max-width: 767.98px)').matches) return;
      const modal = backdrop.querySelector('.modal');
      if (!modal || modal.querySelector('.modal-sticky-foot')) return;
      const prims = Array.prototype.filter.call(modal.querySelectorAll('.btn-primary'), b => !b.hidden && b.offsetParent !== null);
      if (!prims.length) return;
      const btn = prims[prims.length - 1];
      const row = btn.parentElement;
      if (!row) return;
      // A lane that built its own sticky footer (position sticky or fixed on the row or an ancestor inside the modal) keeps it.
      for (let n = row; n && n !== modal.parentElement; n = n.parentElement) { const ps = getComputedStyle(n).position; if (ps === 'sticky' || ps === 'fixed') return; }
      const btnRow = row !== modal && row.tagName !== 'FORM' && Array.prototype.every.call(row.children, c => c.tagName === 'BUTTON' || c.tagName === 'A');
      let foot = null, wrap = null;
      if (btnRow) {
        if (row.children.length > 3) return;
        foot = row;
        foot.classList.add('modal-sticky-foot');
      } else {
        wrap = foot = document.createElement('div');
        wrap.className = 'modal-sticky-foot';
        row.insertBefore(wrap, btn);
        wrap.appendChild(btn);
      }
      // A footer that wraps onto a second row would eat too much of the sheet: undo it and leave the form as it was.
      if (foot.offsetHeight > 96) {
        if (wrap) { wrap.parentNode.insertBefore(btn, wrap); wrap.remove(); }
        else foot.classList.remove('modal-sticky-foot');
      }
    }
    function closeModal(modalId) {
      const el = document.getElementById(modalId);
      if (window.CRMUI && CRMUI.close) {
        el._bsClosing = true;
        try { CRMUI.close(el, { force: true }); } finally { el._bsClosing = false; }
      }
      el.classList.remove('active');
      _routeModalClosed(modalId);
    }

    function showToast(message, type = 'info') {
      if (window.CRMUI && CRMUI.toast) return CRMUI.toast(message, type);
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);
    }

    // Frequent, cheap deletes stay one click and get an Undo instead of a dialog.
    function showUndoToast(message, onUndo) {
      if (window.CRMUI && CRMUI.undoToast) return CRMUI.undoToast(message, onUndo);
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast info';
      const text = document.createElement('span'); text.textContent = message;
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'toast-undo'; btn.textContent = 'Undo';
      const timer = setTimeout(() => toast.remove(), 6000);
      btn.onclick = () => { clearTimeout(timer); toast.remove(); onUndo(); };
      toast.appendChild(text); toast.appendChild(btn);
      container.appendChild(toast);
    }

    // ── Relative timestamps ───────────────────────────────────────────────
    function timeAgo(iso) {
      if (!iso) return '-';
      const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (secs < 60)   return 'just now';
      if (secs < 3600) return Math.floor(secs/60)+'m ago';
      if (secs < 86400)return Math.floor(secs/3600)+'h ago';
      if (secs < 604800)return Math.floor(secs/86400)+'d ago';
      return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
    }

    // ── Days-until chip ───────────────────────────────────────────────────
    function daysUntilChip(dateStr) {
      if (!dateStr) return '';
      const d = Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
      if (d < 0)  return `<span class="days-chip past">${Math.abs(d)}d ago</span>`;
      if (d === 0)return `<span class="days-chip soon">Today</span>`;
      if (d <= 7) return `<span class="days-chip soon">${d}d</span>`;
      if (d <= 30)return `<span class="days-chip week">${d}d</span>`;
      return `<span class="days-chip future">${d}d</span>`;
    }

    // ── Returning-client detection ────────────────────────────────────────
    function isReturningClient(email) {
      if (!email) return null;
      const events  = getDB('events') || [];
      const clients = getDB('clients') || [];
      const inqs    = window._inquiries || [];
      const em = email.toLowerCase();
      const matchEv = events.find(e => (e.clientEmail||'').toLowerCase() === em);
      if (matchEv) return { label: 'Returning client', eventId: matchEv.id, eventName: matchEv.name };
      const matchCl = clients.find(c => (c.email||'').toLowerCase() === em);
      if (matchCl) return { label: 'Known client', clientId: matchCl.id, clientName: matchCl.name };
      return null;
    }

    // ── Global search ─────────────────────────────────────────────────────
    // Rows for the command palette (Cmd/Ctrl+K, "/", or the search button). Accent-blind and case-blind (CRMUI.norm.fold).
    // Each row is { group, label, meta, run }. No DOM work here.
    function _searchRows(q) {
      const fold = (window.CRMUI && CRMUI.norm && CRMUI.norm.fold) ? CRMUI.norm.fold : (s => String(s == null ? '' : s).toLowerCase());
      const n = fold(q);
      const user = BSPortal.getCurrentUser ? BSPortal.getCurrentUser() : null;
      const role = (user && user.role) || 'master';
      const fmtDate = d => (window.CRMUI && CRMUI.fmt && d) ? CRMUI.fmt.date(d, 'list') : (d || '');
      const hit = (...vals) => vals.some(v => v && fold(v).includes(n));
      const rows = [];
      if (n) {
        (getDB('events') || []).filter(e => (role !== 'dj' || (e.staff || []).includes(user.id)) && hit(e.name, e.clientName, e.clientEmail, e.venueName)).slice(0, 5)
          .forEach(e => rows.push({ group: 'Events', label: e.name || 'Event', meta: [fmtDate(e.date), e.clientName].filter(Boolean).join(', '), run: () => openEventDetail(e.id) }));
        if (role !== 'dj') {
          (getDB('clients') || []).filter(c => hit(c.name, c.email, c.company)).slice(0, 5)
            .forEach(c => rows.push({ group: 'Clients', label: c.name || 'Client', meta: c.email || '', run: () => openClientDetail(c.id) }));
          (window._inquiries || []).filter(i => hit(i.name, i.email, i.venue)).slice(0, 5)
            .forEach(i => rows.push({ group: 'Inquiries', label: i.name || 'Inquiry', meta: i.email || '', run: () => { showSection('pipeline'); setTimeout(() => openInquiry(i.id), 300); } }));
          (getDB('invoices') || []).filter(v => hit(v.invoiceNum, v.clientName, v.eventName)).slice(0, 5)
            .forEach(v => rows.push({ group: 'Invoices', label: (v.invoiceNum || 'Invoice') + (v.clientName ? ' ' + v.clientName : ''), meta: v.total != null ? ((window.CRMUI && CRMUI.fmt) ? CRMUI.fmt.money(v.total) : '$' + v.total) : '', run: () => _openInvoiceRecord(v) }));
          (getDB('vendors') || []).filter(v => hit(v.name, v.category)).slice(0, 5)
            .forEach(v => rows.push({ group: 'Vendors', label: v.name || 'Vendor', meta: v.category || '', run: () => { if (typeof openVendorDetail === 'function') { showSection('vendors'); openVendorDetail(v.id); } else showSection('vendors'); } }));
        }
      }
      const actions = [];
      if (role !== 'dj') actions.push({ label: 'New event', run: () => openNewEventModal() }, { label: 'New quote', run: () => openQuoteBuilderModal() }, { label: 'New invoice', run: () => openCreateInvoiceModal() });
      actions.push({ label: 'Add inventory item', run: () => openAddEquipmentModal() });
      actions.filter(a => !n || hit(a.label)).forEach(a => rows.push({ group: 'Actions', label: a.label, meta: '', run: a.run }));
      return rows;
    }

    // Palette invoice row. Opens the invoice record when a lane provides an opener; otherwise lands on the list filtered to that invoice number.
    function _openInvoiceRecord(inv) {
      const openers = ['openInvoiceDetail', 'openInvoice', 'viewInvoice'];
      for (let i = 0; i < openers.length; i++) {
        if (typeof window[openers[i]] === 'function') { window[openers[i]](inv.id); return; }
      }
      switchSection('invoices');
      const box = document.getElementById('invoiceSearch');
      if (box) {
        box.value = inv.invoiceNum || '';
        if (typeof renderInvoices === 'function') renderInvoices();
        else box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Registers the palette provider once. Called from the boot code after the data has loaded.
    function _registerPalette() {
      if (window._palRegistered || !(window.CRMUI && CRMUI.palette)) return;
      window._palRegistered = true;
      CRMUI.palette.register(_searchRows);
    }

    // Kept for older callers: the dropdown is gone, the palette does the job.
    function runGlobalSearch(q) {
      if (window.CRMUI && CRMUI.palette) CRMUI.palette.open();
    }

    // Both of these used to duplicate switchSection with a shorter title list. One path now.
    function switchSectionById(sectionId) {
      switchSection(sectionId);
    }

    // Navigate to a section programmatically (used by search)
    function showSection(sectionId) {
      switchSection(sectionId);
    }

    // ── K: Readable portal password generator ────────────────────────────────
    function genPortalPassword() {
      const words = ['ocean','beats','cloud','lights','stage','crown','sound','miami','vibe','pulse','glow','wave','bass','spark','bloom'];
      const w1 = words[Math.floor(Math.random()*words.length)];
      const w2 = words[Math.floor(Math.random()*words.length)];
      const num = String(10 + Math.floor(Math.random()*90));
      return `${w1}-${w2}${num}`;
    }

    function logout() {
      BSPortal.logout(); // signs out of Supabase + clears session
    }

    function triggerPhotoUpload() {
      document.getElementById('photoUploadInput').click();
    }

    function handlePhotoUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        const users = getDB('users');
        const currentUser = BSPortal.getCurrentUser();
        // Team rows keep a local id; the sign-in id only matches a linked row, so fall back to the email.
        const myEmail = String(currentUser.email || '').trim().toLowerCase();
        const user = users.find(u => u.id === currentUser.id) || users.find(u => myEmail && String(u.email || '').trim().toLowerCase() === myEmail);
        if (user) {
          user.profilePic = e.target.result;
          BSPortal.updateProfilePic(e.target.result);
          setDB('users', users);
          displayUserAvatar(currentUser);
          showToast('Photo updated', 'success');
        }
      };
      reader.readAsDataURL(file);
    }

    function displayUserAvatar(user) {
      const letter = String(safeName(user)).charAt(0);
      document.querySelectorAll('#userAvatar, .js-avatar').forEach(av => {
        if (user.profilePic) av.innerHTML = `<img src="${esc(user.profilePic)}" alt="">`;
        else av.textContent = letter;
      });
    }

    // Name, role and avatar in the rail, the app bar and the More sheet.
    function renderUserChrome(user) {
      document.querySelectorAll('.js-user-name').forEach(el => { el.textContent = safeName(user); });
      document.querySelectorAll('.js-user-role').forEach(el => { el.textContent = safeRole(user); });
      try { displayUserAvatar(user); } catch (e) { console.warn('[avatar]', e); }
    }

    // Menus in the app bar. Both use CRMUI.menu (max 6 items).
    function openNewMenu(anchor) {
      if (!(window.CRMUI && CRMUI.menu)) { openNewEventModal(); return; }
      CRMUI.menu(anchor, [
        { label: 'New inquiry', icon: 'inbox', onSelect: () => { if (typeof openNewInquiry === 'function') openNewInquiry(); else switchSection('pipeline'); } },
        { label: 'New event', icon: 'calendar-days', onSelect: () => openNewEventModal() },
        { label: 'New quote', icon: 'file-text', onSelect: () => openQuoteBuilderModal() },
        { label: 'New invoice', icon: 'receipt', onSelect: () => openCreateInvoiceModal() },
        { label: 'Add inventory item', icon: 'boxes', onSelect: () => openAddEquipmentModal() }
      ], { label: 'Create', align: 'right' });
    }

    function openAvatarMenu(anchor) {
      if (!(window.CRMUI && CRMUI.menu)) return;
      CRMUI.menu(anchor, [
        { label: 'Profile photo', icon: 'camera', onSelect: () => triggerPhotoUpload() },
        { label: 'Settings', icon: 'settings', onSelect: () => switchSection('settings') },
        { label: 'Log out', icon: 'log-out', onSelect: () => logout() }
      ], { label: 'Account', align: 'right' });
    }

    // Role rules live in the markup: data-hide-role="dj" hides for that role, data-show-role="dj" shows only for it,
    // data-admin-only shows for master and admin. Rail groups with nothing visible are hidden too.
    function applyRoleBasedAccess() {
      const currentUser = BSPortal.getCurrentUser();
      if (!currentUser) return;
      const role = currentUser.role || 'master';
      const admin = ['master', 'admin'].includes(role);
      document.querySelectorAll('[data-hide-role]').forEach(el => { el.hidden = el.getAttribute('data-hide-role').split(' ').includes(role); });
      document.querySelectorAll('[data-show-role]').forEach(el => { el.hidden = !el.getAttribute('data-show-role').split(' ').includes(role); });
      document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !admin; });
      document.querySelectorAll('.rail-group').forEach(g => { g.hidden = !g.querySelector('.rail-item:not([hidden])'); });
      // More sheet: when the visible items are odd in number, the last one spans both columns so it does not sit alone.
      const mi = Array.prototype.filter.call(document.querySelectorAll('.more-grid .more-item'), x => !x.hidden);
      mi.forEach(x => x.classList.remove('more-item-wide'));
      if (mi.length % 2 === 1) mi[mi.length - 1].classList.add('more-item-wide');
      // Apple keyboards show the Command key.
      const kbd = document.getElementById('searchKbd');
      if (kbd && /Mac|iPhone|iPad/.test(navigator.platform || '')) kbd.textContent = '\u2318K';
      const el = id => document.getElementById(id);
      if (el('newEventBtn')) el('newEventBtn').hidden = role === 'dj';
      if (el('addVendorBtn')) el('addVendorBtn').hidden = role === 'dj';
    }

    function copyToClipboard(text) { navigator.clipboard.writeText(text); showToast('Copied', 'success'); }

    function handleConfirm() { if (window.confirmCallback) { window.confirmCallback(); window.confirmCallback = null; } document.getElementById('confirmBtn').textContent = 'Delete'; }
    function cancelConfirm() { window.confirmCallback = null; document.getElementById('confirmBtn').textContent = 'Delete'; closeModal('confirmDialog'); }
    // One path for every irreversible action: name it, say what is lost, offer Cancel.
    function confirmDestructive(title, message, onConfirm, label) {
      window.confirmCallback = function() { closeModal('confirmDialog'); onConfirm(); };
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      document.getElementById('confirmBtn').textContent = label || 'Delete';
      openModal('confirmDialog');
    }

    // Safe name helper — prevents "null" string from Supabase metadata
    function safeName(user) {
      const n = user?.name;
      if (n && n !== 'null' && n !== 'undefined') return n;
      const e = user?.email;
      if (e && e !== 'null') return e.split('@')[0];
      return 'Admin';
    }
    function safeRole(user) {
      const r = user?.role;
      if (r && r !== 'null' && r !== 'undefined') return r.replace(/-/g, ' ');
      return 'master';
    }

    // ─── More sheet (phone). The old slide-in sidebar is gone; these keep their names for the router and the harness. ───
    function toggleMobileSidebar() {
      const sheet = document.getElementById('moreSheet');
      if (!sheet) return;
      if (sheet.open) { closeMobileSidebar(); return; }
      if (window.CRMUI && CRMUI.open) CRMUI.open(sheet);
      else if (sheet.showModal) sheet.showModal();
      const mb = document.getElementById('moreNavBtn'); if (mb) mb.setAttribute('aria-expanded', 'true');
      if (!sheet._bsExpandBound) { sheet._bsExpandBound = true; sheet.addEventListener('close', () => { const b = document.getElementById('moreNavBtn'); if (b) b.setAttribute('aria-expanded', 'false'); }); }
    }

    function closeMobileSidebar() {
      const sheet = document.getElementById('moreSheet');
      if (!sheet || !sheet.open) return;
      if (window.CRMUI && CRMUI.close) CRMUI.close(sheet, { force: true });
      else if (sheet.close) sheet.close();
    }
