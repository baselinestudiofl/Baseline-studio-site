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

    function switchSection(sectionId) {
      // Close mobile sidebar when navigating
      closeMobileSidebar();
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById(sectionId).classList.add('active');
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      // Use attribute selector so programmatic calls (no click event) also work
      document.querySelector(`.nav-link[onclick*="${sectionId}"]`)?.classList.add('active');

      const titles = { dashboard: 'Dashboard', pipeline: 'Pipeline', events: 'Events', clients: 'Clients', vendors: 'Vendors & Venues', documents: 'Documents', equipment: 'Equipment', invoices: 'Invoices', marketing: 'Marketing', accounts: 'Accounts', reports: 'Reports', automations: 'Automations', settings: 'Settings' };
      document.getElementById('pageTitle').textContent = titles[sectionId] || sectionId;

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

    function openModal(modalId) { document.getElementById(modalId).classList.add('active'); }
    function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); _routeModalClosed(modalId); }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);
    }

    // Frequent, cheap deletes stay one click and get an Undo instead of a dialog.
    function showUndoToast(message, onUndo) {
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
      if (!iso) return '—';
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
    function runGlobalSearch(q) {
      const box = document.getElementById('globalSearchResults');
      if (!q || q.length < 2) { box.classList.remove('active'); return; }
      const ql = q.toLowerCase();
      const events  = (getDB('events') || []).filter(e => e.name?.toLowerCase().includes(ql) || e.clientName?.toLowerCase().includes(ql) || e.clientEmail?.toLowerCase().includes(ql) || e.venueName?.toLowerCase().includes(ql));
      const clients = (getDB('clients') || []).filter(c => c.name?.toLowerCase().includes(ql) || c.email?.toLowerCase().includes(ql));
      const vendors = (getDB('vendors') || []).filter(v => v.name?.toLowerCase().includes(ql) || v.category?.toLowerCase().includes(ql));
      const inqs    = (window._inquiries || []).filter(i => i.name?.toLowerCase().includes(ql) || i.email?.toLowerCase().includes(ql) || i.venue?.toLowerCase().includes(ql));
      if (!events.length && !clients.length && !vendors.length && !inqs.length) {
        box.innerHTML = '<div style="padding:16px;color:var(--gray);font-size:13px;">Nothing found.</div>';
        box.classList.add('active');
        return;
      }
      let html = '';
      if (inqs.length) {
        html += `<div class="sr-group"><div class="sr-group-label">Inquiries</div>${inqs.slice(0,4).map(i=>`<div class="sr-item" role="button" tabindex="0" onclick="hideSearchResults();showSection('pipeline');setTimeout(()=>openInquiry('${i.id}'),300)"><span>📩</span><span>${i.name||'—'}</span><span class="sr-item-sub">${i.email||''}</span><span class="sr-arrow">→</span></div>`).join('')}</div>`;
      }
      if (events.length) {
        html += `<div class="sr-group"><div class="sr-group-label">Events</div>${events.slice(0,4).map(e=>`<div class="sr-item" role="button" tabindex="0" onclick="hideSearchResults();showSection('events');setTimeout(()=>openEventDetail('${e.id}'),300)"><span>🎵</span><span>${e.name}</span><span class="sr-item-sub">${e.clientName}</span><span class="sr-arrow">→</span></div>`).join('')}</div>`;
      }
      if (clients.length) {
        html += `<div class="sr-group"><div class="sr-group-label">Clients</div>${clients.slice(0,4).map(c=>`<div class="sr-item" role="button" tabindex="0" onclick="hideSearchResults();showSection('clients');setTimeout(()=>openClientDetail('${c.id}'),300)"><span>👤</span><span>${c.name}</span><span class="sr-item-sub">${c.email||''}</span><span class="sr-arrow">→</span></div>`).join('')}</div>`;
      }
      if (vendors.length) {
        html += `<div class="sr-group"><div class="sr-group-label">Vendors</div>${vendors.slice(0,4).map(v=>`<div class="sr-item" role="button" tabindex="0" onclick="hideSearchResults();showSection('vendors')"><span>🏢</span><span>${v.name}</span><span class="sr-item-sub">${v.category}</span><span class="sr-arrow">→</span></div>`).join('')}</div>`;
      }
      box.innerHTML = html;
      box.classList.add('active');
    }

    function hideSearchResults() {
      const box = document.getElementById('globalSearchResults');
      if (box) box.classList.remove('active');
      const inp = document.getElementById('globalSearch');
      if (inp) inp.value = '';
    }

    // Navigate by section ID from stat cards or other non-nav triggers
    function switchSectionById(sectionId) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById(sectionId)?.classList.add('active');
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      document.querySelector(`.nav-link[onclick*="${sectionId}"]`)?.classList.add('active');
      const titles = { dashboard:'Dashboard', pipeline:'Pipeline', events:'Events', clients:'Clients', vendors:'Vendors & Venues', documents:'Documents' };
      document.getElementById('pageTitle').textContent = titles[sectionId] || sectionId;
      if (sectionId === 'pipeline')  { renderPipeline(); loadInquiries(); }
      if (sectionId === 'events')    renderEvents();
      if (sectionId === 'clients')   renderClients();
      if (sectionId === 'vendors')   renderVendors();
      _routeWrite({ type: 'section', id: sectionId }, 'push');
    }

    // Navigate to a section programmatically (used by search)
    function showSection(sectionId) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById(sectionId)?.classList.add('active');
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      document.querySelector(`.nav-link[onclick*="${sectionId}"]`)?.classList.add('active');
      const titles = { dashboard:'Dashboard', pipeline:'Pipeline', events:'Events', clients:'Clients', vendors:'Vendors & Venues', documents:'Documents' };
      document.getElementById('pageTitle').textContent = titles[sectionId] || sectionId;
      if (sectionId === 'pipeline')  { renderPipeline(); loadInquiries(); }
      if (sectionId === 'events')    renderEvents();
      if (sectionId === 'clients')   renderClients();
      if (sectionId === 'vendors')   renderVendors();
      _routeWrite({ type: 'section', id: sectionId }, 'push');
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
        const user = users.find(u => u.id === currentUser.id);
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
      const avatar = document.getElementById('userAvatar');
      if (user.profilePic) {
        avatar.innerHTML = `<img src="${user.profilePic}" alt="${user.name}">`;
      } else {
        avatar.textContent = user.name.charAt(0);
      }
    }

    function applyRoleBasedAccess() {
      const currentUser = BSPortal.getCurrentUser();
      if (!currentUser) return;
      const role = currentUser.role || 'master';

      document.getElementById('pipelineNav').classList.toggle('hidden', role === 'dj');
      document.getElementById('clientsNav').classList.toggle('hidden', role === 'dj');
      document.getElementById('vendorsNav').classList.toggle('hidden', role === 'dj');
      const el = id => document.getElementById(id);
      el('reportsNav')?.classList.toggle('hidden', !['master', 'admin'].includes(role));
      if (el('accountsNav')) el('accountsNav').style.display = ['master', 'admin'].includes(role) ? 'flex' : 'none';
      if (el('automationsNav')) el('automationsNav').style.display = ['master', 'admin'].includes(role) ? 'flex' : 'none';
      if (el('marketingNav')) el('marketingNav').style.display = ['master', 'admin'].includes(role) ? 'flex' : 'none';
    if (el('growthNavGroup')) el('growthNavGroup').style.display = ['master', 'admin'].includes(role) ? 'contents' : 'none';
      if (el('invoicesNav')) el('invoicesNav').style.display = role === 'dj' ? 'none' : 'flex';
      if (el('equipmentNav')) el('equipmentNav').style.display = 'flex';
      if (el('newEventBtn')) el('newEventBtn').style.display = role === 'dj' ? 'none' : 'block';
      if (el('addVendorBtn')) el('addVendorBtn').style.display = role === 'dj' ? 'none' : 'block';
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

    // ─── Mobile sidebar toggle ────────────────────────────────────────────────
    function toggleMobileSidebar() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      const isOpen = sidebar.classList.contains('mobile-open');
      if (isOpen) closeMobileSidebar();
      else {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    }

    function closeMobileSidebar() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (overlay) overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
