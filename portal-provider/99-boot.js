// ============================================================================
// portal-provider/99-boot.js  -  routing and init: hash routing, early Supabase init, every statement that runs at load, event listeners
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // Async provider init — loads Supabase data before rendering anything
    window._sbDataReady = BSPortal.initProvider().then(ok => {
      if (!ok) return; // already redirected to login.html
      document.getElementById('sb-loading').style.display = 'none';
      // B6: Reconcile — event copy is source of truth for portal credentials.
      // If a client changed their password via the client portal RPC, events already
      // have the new value. Sync it back into clients so the Clients tab stays accurate.
      _reconcileClientCredentials();
    }).catch(err => {
      console.error('Supabase init error:', err);
      document.getElementById('sb-loading').innerHTML = '<p class="boot-error">Connection error.<br>Please refresh or check your internet.</p>';
    });

    function _reconcileClientCredentials() {
      const events  = getDB('events')  || [];
      const clients = getDB('clients') || [];
      let changed = false;

      // Sync credentials from events → matching client records
      events.forEach(ev => {
        if (!ev.portalPassword) return;
        const evEmail = (ev.clientEmail || ev.portalEmail || '').toLowerCase();
        if (!evEmail) return;
        clients.forEach(c => {
          if ((c.email || '').toLowerCase() === evEmail) {
            if (c.portalPassword !== ev.portalPassword || c.portalEmail !== (ev.portalEmail || c.email)) {
              c.portalPassword = ev.portalPassword;
              c.portalEmail    = ev.portalEmail || c.email;
              changed = true;
            }
          }
        });
      });

      // Auto-create client records from events that have a clientName but no matching client
      events.forEach(ev => {
        const name = (ev.clientName || '').trim();
        if (!name) return;
        const email = (ev.clientEmail || ev.portalEmail || '').toLowerCase();
        const alreadyExists = clients.some(c => {
          if (email && (c.email || '').toLowerCase() === email) return true;
          if (!email && c.name === name) return true;
          return false;
        });
        if (!alreadyExists) {
          clients.push({
            id:           genId(),
            name:         name,
            email:        ev.clientEmail || ev.portalEmail || '',
            phone:        ev.clientPhone || '',
            type:         ev.type === 'corporate' ? 'corporate' : 'private',
            company:      ev.clientCompany || '',
            portalPassword: ev.portalPassword || '',
            portalEmail:    ev.portalEmail || ev.clientEmail || '',
            createdAt:    Date.now()
          });
          changed = true;
        }
      });

      if (changed) setDB('clients', clients);
    }
  
    // ── Hash routing ──────────────────────────────────────────────────────
    // Canonical hashes:  #/<section>  |  #/event/<id>[/<tab>]  |  #/client/<id>  |  #/lead/<id>
    // Old links still open:  #event=<id>  #client=<id>  #lead=<id>  #inquiry=<id>  (rewritten to the new form)
    // Sections and detail pages push a history entry. Event tab switches replace the current one.
    // Modals are not routes, except the lead modal (it was already deep-linkable).
    let _detailReturnSection = 'events'; // where to go on back
    const ROUTE_SECTIONS = ['dashboard','pipeline','events','clients','vendors','documents','equipment','invoices','marketing','accounts','reports','automations','settings'];
    const ROUTE_EVENT_TABS = ['overview','plan','timeline','invoices','documents','gear','portal','messages','lighting'];
    let _route = null;              // the route currently shown (or last written)
    let _routeApplying = 0;         // >0 while the router itself changes the view: no history writes
    let _routeSeq = 0;              // newest apply wins when an async apply (lead) is overtaken
    let _routeInflight = '';        // hash being applied, stops popstate + hashchange applying twice
    let _routeBackPending = false;  // a history.back() from closing the lead modal is still travelling
    let _routeDeferred = null;      // a history write asked for while that back() was travelling

    function _routeParse(hash) {
      const h = String(hash || '');
      if (h === '' || h === '#' || h === '#/') return { type: 'section', id: 'dashboard' };
      const dec = s => { try { return decodeURIComponent(s); } catch (e) { return null; } };
      let m = h.match(/^#\/(event|client|lead)\/([^\/?]+)(?:\/([^\/?]+))?\/?$/);
      if (m) {
        const id = dec(m[2]);
        if (!id) return null;
        const tab = m[1] === 'event' && m[3] && m[3] !== 'overview' && ROUTE_EVENT_TABS.indexOf(m[3]) > -1 ? m[3] : null;
        return { type: m[1], id: id, tab: tab };
      }
      m = h.match(/^#\/([a-z]+)\/?$/);
      if (m && ROUTE_SECTIONS.indexOf(m[1]) > -1) return { type: 'section', id: m[1] };
      m = h.match(/^#(event|client|lead|inquiry)=(.+)$/);
      if (m) {
        const id = dec(m[2]);
        return id ? { type: m[1] === 'inquiry' ? 'lead' : m[1], id: id, tab: null } : null;
      }
      return null;
    }

    function _routeHash(r) {
      if (!r) return '';
      if (r.type === 'section') return '#/' + r.id;
      const base = '#/' + r.type + '/' + encodeURIComponent(r.id);
      return r.type === 'event' && r.tab && r.tab !== 'overview' ? base + '/' + r.tab : base;
    }

    // The only place history is touched. Same hash twice = no new entry. Silent while the router is applying a route.
    function _routeWrite(r, mode) {
      _route = r;
      if (_routeApplying) return false;
      if (_routeBackPending) { _routeDeferred = { r: r, mode: mode }; return false; }
      const h = _routeHash(r);
      if (location.hash === h || (!location.hash && h === '#/dashboard')) return false;
      const st = { route: r, pushed: mode !== 'replace' };
      if (mode === 'replace') history.replaceState(st, '', h);
      else history.pushState(st, '', h);
      return true;
    }

    function _routeFlushDeferred() {
      _routeBackPending = false;
      const d = _routeDeferred;
      _routeDeferred = null;
      if (d) _routeWrite(d.r, d.mode);
      return !!d;
    }

    // Same visibility rules as applyRoleBasedAccess: a route the nav hides is not reachable by URL either.
    function _routeAllowed(r) {
      const u = BSPortal.getCurrentUser();
      const role = (u && u.role) || 'master';
      const sec = r.type === 'section' ? r.id : r.type === 'client' ? 'clients' : r.type === 'lead' ? 'pipeline' : 'events';
      if (role === 'dj' && ['pipeline', 'clients', 'vendors', 'invoices'].indexOf(sec) > -1) return false;
      if (['reports', 'accounts', 'automations', 'marketing'].indexOf(sec) > -1 && ['master', 'admin'].indexOf(role) < 0) return false;
      return true;
    }

    function _routeEventVisible(ev) {
      const u = BSPortal.getCurrentUser();
      if (u && u.role === 'dj') return (ev.staff || []).includes(u.id);
      return true;
    }

    function _routeFindInquiry(id) {
      return (window._inquiries || []).find(i => String(i.id) === String(id)) || null;
    }

    // Open an event-detail tab by clicking its real button (so Lighting still runs its picker init).
    // 'lighting' is an alias of 'plan' once the Plan tab holds the lighting card: if there is no Lighting button, open Plan and scroll to #lightingCard.
    function _routeActivateTab(tab) {
      const btns = document.querySelectorAll('#detailContent .tab-btn');
      const find = t => {
        for (let i = 0; i < btns.length; i++) {
          const m = /switchEventTab\(this,\s*'(\w+)'\)/.exec(btns[i].getAttribute('onclick') || '');
          if (m && m[1] === t) return btns[i];
        }
        return null;
      };
      let btn = find(tab);
      if (!btn && tab === 'lighting') {
        btn = find('plan');
        if (btn) setTimeout(function() { const c = document.getElementById('lightingCard'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' }); }, 60);
      }
      if (btn) { btn.click(); return true; }
      return false;
    }

    // Show the view a route describes. Unknown id or a section the role can't see falls back (and the hash is cleaned).
    async function _routeApply(r, opts) {
      opts = opts || {};
      if (!r) return false;
      const seq = ++_routeSeq;
      _routeInflight = location.hash;
      try {
        let target = r;
        const active = () => document.querySelector('.section.active');
        const toSection = id => {
          _routeApplying++;
          try { const a = active(); if (!a || a.id !== id) switchSection(id); else closeMobileSidebar(); }
          finally { _routeApplying--; }
        };
        if (!_routeAllowed(r)) {
          target = { type: 'section', id: 'dashboard' };
        } else if (r.type === 'event') {
          const ev = (getDB('events') || []).find(e => String(e.id) === r.id);
          target = ev && _routeEventVisible(ev) ? { type: 'event', id: ev.id, tab: r.tab } : { type: 'section', id: 'events' };
        } else if (r.type === 'client') {
          const cl = (getDB('clients') || []).find(c => String(c.id) === r.id);
          target = cl ? { type: 'client', id: cl.id } : { type: 'section', id: 'clients' };
        } else if (r.type === 'lead') {
          toSection('pipeline');
          let inq = _routeFindInquiry(r.id);
          if (!inq) { try { await loadInquiries(); } catch (e) {} inq = _routeFindInquiry(r.id); }
          if (seq !== _routeSeq) return false; // a newer navigation took over while inquiries loaded
          target = inq ? { type: 'lead', id: inq.id } : { type: 'section', id: 'pipeline' };
        }

        _routeApplying++;
        try {
          const leadOpen = !!(_route && _route.type === 'lead' && String(_route.id) === String(target.id));
          const modals = document.querySelectorAll('.modal-backdrop.active');
          for (let i = 0; i < modals.length; i++) { if (!(target.type === 'lead' && leadOpen)) { if (window.CRMUI && CRMUI.close) CRMUI.close(modals[i], { force: true }); modals[i].classList.remove('active'); } }
          const a = active();
          if (target.type === 'section') {
            toSection(target.id);
          } else if (target.type === 'event') {
            const same = !!(a && a.id === 'detail' && _route && _route.type === 'event' && String(_route.id) === String(target.id));
            if (same) { closeMobileSidebar(); _routeActivateTab(target.tab || 'overview'); }
            else {
              _detailReturnSection = a && a.id !== 'detail' && !opts.initial ? a.id : (a && a.id === 'detail' && _detailReturnSection) || 'events';
              closeMobileSidebar();
              showEventPage(target.id, target.tab || null);
            }
          } else if (target.type === 'client') {
            _detailReturnSection = a && a.id !== 'detail' && !opts.initial ? a.id : (a && a.id === 'detail' && _detailReturnSection) || 'clients';
            closeMobileSidebar();
            showClientPage(target.id);
          } else if (target.type === 'lead') {
            if (!leadOpen) openInquiry(target.id);
          }
        } finally { _routeApplying--; }
        _routeWrite(target, 'replace'); // no-op when the hash is already canonical
        return true;
      } finally {
        if (seq === _routeSeq) _routeInflight = '';
      }
    }

    function _routeOnPop() {
      if (_routeBackPending) {
        // A view opened right after the lead modal closed: its own write was waiting for this back() to land.
        if (_routeFlushDeferred()) return;
      }
      if (_routeInflight && _routeInflight === location.hash) return;
      if (_routeHash(_route) === location.hash) return;
      const r = _routeParse(location.hash);
      if (r) _routeApply(r, { fromPop: true }).catch(e => console.warn('[route]', e));
    }

    // Called by closeModal / Esc. Closing the lead modal steps back to the entry it was opened from.
    function _routeModalClosed(modalId) {
      if (modalId !== 'eventDetailModal' || !_route || _route.type !== 'lead' || _routeApplying) return;
      if (history.state && history.state.pushed && history.state.route && history.state.route.type === 'lead') {
        _routeBackPending = true;
        history.back();
        setTimeout(function() {
          if (!_routeBackPending) return;
          if (!_routeFlushDeferred()) _routeWrite({ type: 'section', id: 'pipeline' }, 'replace');
        }, 400);
      } else {
        _routeWrite({ type: 'section', id: 'pipeline' }, 'replace');
      }
    }

    function _showDetailSection() {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('detail').classList.add('active');
      if (typeof _syncNav === 'function') _syncNav('detail', { parent: _detailReturnSection, detail: true });
      // Phone top bar: back chevron + the record name. Screens can override with setTopbarDetail(title, backFn) after this runs.
      if (typeof setTopbarDetail === 'function') {
        const dc = document.getElementById('detailContent');
        const hit = dc && dc.querySelector('[data-detail-title], .detail-page-title, .detail-title');
        let title = '';
        if (hit) title = (hit.getAttribute('data-detail-title') || (hit.firstChild && hit.firstChild.nodeType === 3 ? hit.firstChild.textContent : hit.textContent) || '').trim().replace(/\s+/g, ' ');
        setTopbarDetail(title);
      }
      const pa = document.getElementById('pageActions');
      if (pa) pa.innerHTML = '';
      const mc = document.querySelector('.main-content');
      if (mc) mc.scrollTop = 0;
    }

    function goBack() {
      switchSection(_detailReturnSection);
    }

    window.addEventListener('popstate', _routeOnPop);
    window.addEventListener('hashchange', _routeOnPop);

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    document.addEventListener('keydown', function(e) {
      // Esc — close topmost modal. CRMUI already handles it when focus is inside the modal (and asks before dropping edits);
      // this catches the case where focus is elsewhere on the page.
      if (e.key === 'Escape') {
        const open = document.querySelector('.modal-backdrop.active');
        if (open) {
          if (window.CRMUI && CRMUI.close) { open._bsClosing = false; CRMUI.close(open); }
          else { open.classList.remove('active'); _routeModalClosed(open.id); }
        }
      }
      // Cmd/Ctrl+K and "/" open the command palette. CRMUI owns those keys once the provider is registered (see _registerPalette).
    });
    (function () { // hook the existing events save path once; first call after load seeds the snapshot
      const _origSetDB = window.setDB;
      window.setDB = function (key) {
        const r = _origSetDB.apply(this, arguments);
        if (String(key).replace(/^bs_/, '') === 'events') { try { _checkEventTriggers(); } catch (e) { console.warn('[automation]', e); } }
        return r;
      };
    })();

    // Run engine on portal load + every 5 min
    window._sbDataReady && window._sbDataReady.then(() => {
      setTimeout(() => _runAutomationEngine(), 3000);
      setInterval(() => _runAutomationEngine(), 5 * 60 * 1000);
      // Catch events up to their payments and signatures (a date passing, a client signature). Real changes fire automations.
      setInterval(() => { try { if (typeof reconcileAllEvents === 'function') reconcileAllEvents({ silent: false }); } catch (e) { console.warn('[sync]', e); } }, 5 * 60 * 1000);
    });

    window.addEventListener('DOMContentLoaded', async function() {
      try {
        // Bail out gracefully if portal-supabase.js failed to load
        if (typeof BSPortal === 'undefined' || typeof window._sbDataReady === 'undefined') {
          console.error('[Portal] portal-supabase.js not loaded — check file is uploaded to GitHub');
          document.getElementById('sb-loading').innerHTML = '<p class="boot-error">Portal failed to load.<br>Please refresh or contact support.</p>';
          return;
        }

        // Populate user info immediately from session (no async needed for this)
        const earlyUser = BSPortal.getCurrentUser();
        if (earlyUser) renderUserChrome(earlyUser);

        // Wait for Supabase data to finish loading before rendering
        await window._sbDataReady;

        // Always force-hide overlay regardless of what _sbDataReady did
        const overlay = document.getElementById('sb-loading');
        if (overlay) overlay.style.display = 'none';

        initData();
        _contractsBoot();
        const currentUser = BSPortal.getCurrentUser();
        if (!currentUser) { window.location.href = 'login.html'; return; }

        // Re-apply after data loaded (in case name changed)
        renderUserChrome(currentUser);

        // Silent catch-up: events that already match their payments and signatures on paper but not in the pipeline. No automations, no emails.
        try {
          if (typeof reconcileAllEvents === 'function') {
            const rec = reconcileAllEvents({ silent: true, refresh: false });
            if (rec && rec.n > 0) showToast('Updated ' + rec.n + (rec.n === 1 ? ' event' : ' events') + ' to match ' + (rec.n === 1 ? 'its' : 'their') + ' payments.', 'success');
          }
        } catch (e) { console.warn('[sync]', e); }

        // Set up event listeners BEFORE anything that could crash
        document.getElementById('eventsSearch')?.addEventListener('input', renderEvents);
        document.getElementById('eventTypeFilter')?.addEventListener('change', renderEvents);
        document.getElementById('eventStatusFilter')?.addEventListener('change', renderEvents);
        document.getElementById('clientsSearch')?.addEventListener('input', renderClients);
        document.getElementById('vendorsSearch')?.addEventListener('input', renderVendors);
        document.getElementById('vendorCategoryFilter')?.addEventListener('change', renderVendors);

        try { applyRoleBasedAccess(); } catch(e) { console.warn('[roleAccess]', e); }
        try { _registerPalette(); } catch(e) { console.warn('[palette]', e); }
        try { _syncNav('dashboard'); } catch(e) { console.warn('[nav]', e); }
        try { if (typeof loadOptouts === 'function') loadOptouts(); } catch(e) { console.warn('[optouts]', e); } // marketing opt-out list (sql/p3-optout.sql); stays empty until that SQL is run
        try { renderDashboard(); } catch(e) { console.warn('[dashboard]', e); }
        try { if (typeof invBindRoutes === 'function') invBindRoutes(); } catch (e) {} // inventory routes (scan) must exist before the first route is resolved
        // Open the view named by the URL hash (refresh / shared link) instead of staying on the dashboard
        if (location.hash) {
          try {
            const r0 = _routeParse(location.hash);
            if (r0) await _routeApply(r0, { initial: true });
            else _routeWrite({ type: 'section', id: 'dashboard' }, 'replace'); // unknown hash: show Home and clean the URL
          } catch(e) { console.warn('[route]', e); }
        }
      } catch (err) {
        console.error('[Portal init error]', err);
        const overlay = document.getElementById('sb-loading');
        if (overlay) overlay.style.display = 'none';
      }
    });

    // ─── G: Global interaction polish ────────────────────────────────────────

    // ─── Re-sync from Supabase when tab regains focus ──────────────────────────
    // Fixes stale data when the same account is used in multiple tabs or devices.
    let _lastSync = 0;
    document.addEventListener('visibilitychange', async function() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - _lastSync < 30000) return; // throttle: max once every 30s
      _lastSync = now;
      try {
        const ok = await BSPortal.reloadDB();
        if (!ok) return;
        try { if (typeof reconcileAllEvents === 'function') reconcileAllEvents({ silent: false, refresh: false }); } catch (e) { console.warn('[sync]', e); }
        // Refresh whichever section is currently visible
        const activeSection = document.querySelector('.section.active')?.id;
        if (activeSection === 'dashboard') renderDashboard();
        else if (activeSection === 'pipeline') { renderPipeline(); loadInquiries(); }
        else if (activeSection === 'events') renderEvents();
        else if (activeSection === 'clients') renderClients();
        else if (activeSection === 'vendors') renderVendors();
      } catch(e) { console.warn('[visibilitychange sync]', e); }
    });

    // Re-render active section when the restore-from-backup banner is accepted
    document.addEventListener('bs:restored', function() {
      const activeSection = document.querySelector('.section.active')?.id;
      if (activeSection === 'dashboard') renderDashboard();
      else if (activeSection === 'pipeline') { renderPipeline(); loadInquiries(); }
      else if (activeSection === 'events') renderEvents();
      else if (activeSection === 'clients') renderClients();
      else if (activeSection === 'vendors') renderVendors();
      showToast('Local data restored', 'success');
    });

    // Re-render when background poll detects server-side changes (other tabs/devices)
    document.addEventListener('bs:data-synced', function() {
      try { if (typeof reconcileAllEvents === 'function') reconcileAllEvents({ silent: false, refresh: false }); } catch (e) { console.warn('[sync]', e); }
      const activeSection = document.querySelector('.section.active')?.id;
      if (activeSection === 'dashboard') renderDashboard();
      else if (activeSection === 'pipeline') { renderPipeline(); loadInquiries(); }
      else if (activeSection === 'events') renderEvents();
      else if (activeSection === 'clients') renderClients();
      else if (activeSection === 'vendors') renderVendors();
      else if (activeSection === 'detail') {
        // Re-render whatever detail page is open
        if (_route && _route.type === 'event') showEventPage(_route.id);
        else if (_route && _route.type === 'client') showClientPage(_route.id);
      }
    });

  
    // Keyboard: Enter or Space activates any clickable card that is not a real button.
    document.addEventListener('keydown', function(e) {
      const el = e.target;
      if (!el || el.getAttribute('role') !== 'button' || el.tagName === 'BUTTON') return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
