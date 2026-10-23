// 45-sync.js: one source of truth for event state. Pure derivation (deriveEventState) plus the writer (syncEvent) and the
// boot / poll catch-up (reconcileAllEvents). Only function declarations here: nothing runs at load time (scope-check rule 4).
// Stages move forward only. Manual moves in the pipeline do not call this. See _DEV/crm-v2/SYNC-PLAN.md.

    // lead 0, quote_sent / proposal 1, negotiation 2, booked 3, confirmed 4, completed 5. Unknown ranks as lead.
    function _syncRank(stage) {
      const r = { lead: 0, quote_sent: 1, proposal: 1, negotiation: 2, booked: 3, confirmed: 4, completed: 5 };
      const k = String(stage == null ? '' : stage).toLowerCase();
      return Object.prototype.hasOwnProperty.call(r, k) ? r[k] : 0;
    }

    // Pure. Facts about one event from its invoices and documents, and the stage those facts support (never lower than the current one).
    // Returns { contractSigned, countersigned, depositPaid, balancePaid, paidInFull, amountPaid, amountDue, nextDue, overdue, eventPast,
    //           quoteSent, hasContract, current, suggested, stage, signedAt }
    function deriveEventState(ev, invoices, docs, now, terms) {
      ev = ev || {};
      const nowD = (typeof _mnyDate === 'function' ? _mnyDate(now) : null) || new Date();
      const list = Array.isArray(docs) ? docs : (Array.isArray(ev.docs) ? ev.docs : []).concat(Array.isArray(ev.documents) ? ev.documents : []);
      const contracts = list.filter(d => d && d.requiresSignature);
      const signedDocs = contracts.filter(d => d.clientSignature || d.clientSignedAt);
      const contractSigned = signedDocs.length > 0;
      const countersigned = signedDocs.some(d => !!d.signedAt);
      const s = typeof _mnySchedule === 'function' ? _mnySchedule(ev, invoices || [], terms, nowD) : { ok: false };
      let depositPaid, balancePaid, paidInFull, amountPaid = 0, amountDue = 0, nextDue = null, overdue = false;
      if (s.ok) {
        const dep = s.rows.find(r => r.key === 'deposit');
        const bal = s.rows.find(r => r.key === 'balance');
        depositPaid = !!(dep && dep.paid);
        balancePaid = bal ? !!bal.paid : depositPaid;
        paidInFull = s.remainingC === 0 && s.extrasUnpaidC === 0;
        amountPaid = s.paidC;
        amountDue = s.remainingC + s.extrasUnpaidC;
        const unpaidRow = s.rows.find(r => !r.paid);
        const unpaidExtras = (s.extras || []).filter(i => _mnyInvStatus(i, nowD) !== 'paid');
        if (unpaidRow && unpaidRow.due) nextDue = unpaidRow.due;
        else if (!unpaidRow) {
          const dues = unpaidExtras.map(i => _mnyDate(i.dueDate)).filter(Boolean).sort((a, b) => a - b);
          if (dues.length) nextDue = dues[0];
        }
        overdue = s.rows.some(r => !r.paid && r.overdue) || unpaidExtras.some(i => _mnyInvStatus(i, nowD) === 'overdue');
      } else {
        depositPaid = ev.depositPaid === true;
        balancePaid = ev.balancePaid === true;
        paidInFull = depositPaid && balancePaid;
      }
      const evDay = typeof _mnyDate === 'function' ? _mnyDate(ev.date) : null;
      const eventPast = !!evDay && _mnyDay(evDay) < _mnyDay(nowD);
      const quoteSent = (Array.isArray(ev.quotes) ? ev.quotes : []).some(q => q && q.sentAt);
      const current = ev.status || '';
      const terminal = ['cancelled', 'lost', 'ghosted'].indexOf(String(current).toLowerCase()) > -1 || ev.archived === true;
      let suggested;
      if (terminal) suggested = current;
      else if (eventPast && paidInFull) suggested = 'completed';
      else if (paidInFull && (contractSigned || contracts.length === 0)) suggested = 'confirmed';
      else if (contractSigned || depositPaid) suggested = 'booked';
      else if (quoteSent) suggested = 'proposal';
      else suggested = current;
      const stage = terminal ? current : (_syncRank(suggested) > _syncRank(current) ? suggested : current);
      const signedAt = signedDocs.length ? (signedDocs.map(d => d.clientSignedAt).filter(Boolean)[0] || null) : null;
      return { contractSigned, countersigned, depositPaid, balancePaid, paidInFull, amountPaid, amountDue, nextDue, overdue, eventPast,
        quoteSent, hasContract: contracts.length > 0, current, suggested, stage, signedAt };
    }

    // The automation snapshot (70-automations.js) as a plain object we may edit.
    function _syncSnapObj() {
      const raw = getDB('automationEventSnap');
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    }
    function _syncSeedSnap(id, status, depositPaid) {
      const snap = _syncSnapObj();
      snap[id] = { status: status || '', depositPaid: !!depositPaid };
      setDB('automationEventSnap', snap);
    }

    // Repaint the views that show event state. Every call is guarded: a section that is not mounted is skipped.
    function _syncRefreshViews(eventId) {
      const active = id => { const el = document.getElementById(id); return !!(el && el.classList.contains('active')); };
      try { if (typeof _mnyRefreshViews === 'function') _mnyRefreshViews(); } catch (e) { /* money owns its errors */ }
      try { if (active('pipeline') && typeof renderPipeline === 'function') renderPipeline(); } catch (e) { /* pipeline owns its errors */ }
      try { if (active('events') && typeof renderEvents === 'function') renderEvents(); } catch (e) { /* events owns its errors */ }
      try {
        const cur = window.currentEvent;
        if (cur && (!eventId || cur.id === eventId) && typeof _evRefresh === 'function') {
          _evRefresh((getDB('events') || []).find(e => e && e.id === cur.id) || cur);
        }
      } catch (e) { /* event page owns its errors */ }
      try { if (active('reports') && typeof renderReports === 'function') renderReports(); } catch (e) { /* reports own their errors */ }
    }

    // Link between an event and its lead: ev.inquiryId, else the inquiryLinks map (lead id -> event id).
    function _syncLeadFor(ev) {
      const rows = window._inquiries;
      if (!Array.isArray(rows)) return null;
      let id = ev.inquiryId || '';
      if (!id) {
        const lk = getDB('inquiryLinks');
        if (lk && typeof lk === 'object' && !Array.isArray(lk)) id = Object.keys(lk).find(k => lk[k] === ev.id) || '';
      }
      return id ? (rows.find(i => i && i.id === id) || null) : null;
    }

    // Make one event match its payments and signatures. opts = { source, silent=false, persist=true, refresh=true }.
    // Returns { changed, stage, prevStage, flags, note, undo } when something moved, else { changed:false, stage }. Never toasts.
    function syncEvent(eventId, opts) {
      opts = opts || {};
      const silent = opts.silent === true, persist = opts.persist !== false, refresh = opts.refresh !== false;
      const events = getDB('events');
      const ev = Array.isArray(events) ? events.find(e => e && e.id === eventId) : null;
      if (!ev) return { changed: false };
      const now = new Date();
      const d = deriveEventState(ev, getDB('invoices') || [], null, now, typeof _mnyTerms === 'function' ? _mnyTerms() : undefined);
      const prev = {
        status: ev.status, hadStageAt: 'stageAt' in ev, stageAt: ev.stageAt, depositPaid: ev.depositPaid, balancePaid: ev.balancePaid,
        hadPaidInFull: 'paidInFull' in ev, paidInFull: ev.paidInFull, hadSignedAt: 'contractSignedAt' in ev, contractSignedAt: ev.contractSignedAt,
        hadSyncAt: 'syncAt' in ev, syncAt: ev.syncAt
      };
      const flags = {};
      let changed = false, dirty = false; // changed = a stage or payment flag moved (the user can see it); dirty = anything on the event was written
      // flags only move forward
      if (d.depositPaid && ev.depositPaid !== true) { ev.depositPaid = true; flags.depositPaid = true; changed = true; dirty = true; }
      if (d.balancePaid && ev.balancePaid !== true) { ev.balancePaid = true; flags.balancePaid = true; changed = true; dirty = true; }
      // facts the client portal reads
      if ((ev.paidInFull === true) !== d.paidInFull) { ev.paidInFull = d.paidInFull; flags.paidInFull = d.paidInFull; dirty = true; }
      if (d.contractSigned && !ev.contractSignedAt) { ev.contractSignedAt = d.signedAt || now.getTime(); flags.contractSignedAt = ev.contractSignedAt; dirty = true; }
      const stageMoved = d.stage !== d.current;
      if (stageMoved) { ev.status = d.stage; ev.stageAt = now.getTime(); changed = true; dirty = true; }
      // the linked lead follows the event, forward only
      const lead = _syncLeadFor(ev);
      const prevLead = lead ? lead.status : null;
      let leadTo = null;
      if (lead) {
        const rk = _syncRank(ev.status), ls = String(lead.status || 'new').toLowerCase();
        if (rk >= 3 && ls !== 'converted' && ls !== 'archived') leadTo = 'converted';
        else if (rk >= 1 && (ls === 'new' || ls === 'contacted')) leadTo = 'quoted';
      }
      if (leadTo) {
        lead.status = leadTo;
        try { if (typeof saveInquiryStatus_silent === 'function') { const p = saveInquiryStatus_silent(lead.id, leadTo); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* offline: the in-memory status still moved */ }
      }
      if (!dirty && !leadTo) return { changed: false, dirty: false, stage: d.stage };
      if (changed) ev.syncAt = now.getTime();
      if (persist && dirty) {
        if (silent) _syncSeedSnap(ev.id, ev.status, ev.depositPaid);
        setDB('events', events);
      }
      if (persist && window.currentEvent && window.currentEvent.id === ev.id) window.currentEvent = ev;
      if (!changed) return { changed: false, dirty, stage: d.stage };
      if (refresh && persist) _syncRefreshViews(ev.id);
      let note = '';
      if (stageMoved && !silent && typeof _pipeStageNote === 'function') { try { note = _pipeStageNote('event', d.stage, ev.clientName) || ''; } catch (e) { note = ''; } }
      const id = ev.id;
      const undo = function () {
        const list = getDB('events');
        const e2 = Array.isArray(list) ? list.find(e => e && e.id === id) : null;
        if (!e2) return false;
        e2.status = prev.status;
        const put = (k, had, v) => { if (had || v !== undefined) e2[k] = v; else delete e2[k]; };
        if (prev.hadStageAt) e2.stageAt = prev.stageAt; else delete e2.stageAt;
        if (prev.depositPaid === undefined) delete e2.depositPaid; else e2.depositPaid = prev.depositPaid;
        if (prev.balancePaid === undefined) delete e2.balancePaid; else e2.balancePaid = prev.balancePaid;
        put('paidInFull', prev.hadPaidInFull, prev.paidInFull);
        put('contractSignedAt', prev.hadSignedAt, prev.contractSignedAt);
        put('syncAt', prev.hadSyncAt, prev.syncAt);
        _syncSeedSnap(id, e2.status, e2.depositPaid); // the demotion must fire nothing
        setDB('events', list);
        if (leadTo && lead) {
          lead.status = prevLead;
          try { if (typeof saveInquiryStatus_silent === 'function') { const p = saveInquiryStatus_silent(lead.id, prevLead); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* offline */ }
        }
        if (window.currentEvent && window.currentEvent.id === id) window.currentEvent = e2;
        _syncRefreshViews(id);
        return true;
      };
      return { changed: true, dirty: true, stage: d.stage, prevStage: d.current, flags, note, undo };
    }

    // Catch every event up to its payments and signatures. Writes once. opts = { silent=false, refresh=true }.
    // Silent: the automation snapshot is updated first, so no rule fires. Not for the DJ role (they only see their own events).
    function reconcileAllEvents(opts) {
      opts = opts || {};
      const silent = opts.silent === true;
      try { const u = typeof BSPortal !== 'undefined' && BSPortal.getCurrentUser ? BSPortal.getCurrentUser() : null; if (u && u.role === 'dj') return { n: 0, ids: [] }; } catch (e) { /* no user: carry on */ }
      const events = getDB('events');
      if (!Array.isArray(events) || !events.length) return { n: 0, ids: [] };
      const ids = []; let dirtyAny = false;
      events.slice().forEach(ev => {
        if (!ev || ev.archived === true) return;
        let r;
        try { r = syncEvent(ev.id, { source: 'reconcile', silent, persist: false, refresh: false }); } catch (e) { console.warn('[sync]', e); return; }
        if (r && r.changed) ids.push(ev.id);
        if (r && r.dirty) dirtyAny = true;
      });
      if (ids.length || dirtyAny) {
        if (silent && ids.length) {
          const snap = _syncSnapObj();
          ids.forEach(id => { const e = events.find(x => x && x.id === id); if (e) snap[id] = { status: e.status || '', depositPaid: !!e.depositPaid }; });
          setDB('automationEventSnap', snap);
        }
        setDB('events', events);
        if (opts.refresh !== false && ids.length) _syncRefreshViews();
      }
      return { n: ids.length, ids };
    }
