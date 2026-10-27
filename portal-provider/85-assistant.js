// ============================================================================
// portal-provider/85-assistant.js  -  Ask assistant: panel, local answers, drafts, proposals, lead watcher, Settings > Ask assistant
// Classic script (no modules, no build step). Only function declarations at load (UI-PLAN scope-check rule 4). Loads after 80, before 99.
// Shares the global scope with the other portal-provider/*.js files. State lives on window._askState, built on first use.
//
// Safety model (see _DEV/crm-v2/AI-ASSISTANT-PLAN.md):
//  - Only an allowlist of fields leaves the browser. Never emails, phones, portal passwords, signatures or tokens (_askScrub is the last gate).
//  - Records are sent as aliases (E1 event, V1 invoice, L1 lead, C1 client, R1 rule). The alias map stays here.
//  - The model only proposes. Every proposal is validated here against the real records, shown as a sentence built from those records,
//    and runs only after Confirm, through the CRM's own functions (recordInvoicePayment, _pipeMoveEvent, setInquiryStage, executeAction...).
//  - No data blob is written from here except askDrafts, the migrations flag and a switched-off automation rule the owner approved.
//  - The Worker (_DEV/crm-v2/ask-ai/worker.js) is the server side: role, daily caps and visibility are enforced there too.
// ============================================================================

    // ── State and gating ─────────────────────────────────────────────────────
    function _askS() {
      if (!window._askState) window._askState = { thread: [], history: [], busy: false, cfg: null, cfgAt: 0, cfgFull: null, cfgErr: '', flags: null, watching: false,
        alias: { byKey: {}, byCode: {}, n: { E: 0, V: 0, L: 0, C: 0, R: 0 } }, open: false, seq: 0 };
      return window._askState;
    }
    function _askSettingsObj() {
      const st = (typeof getDB === 'function') ? getDB('settings') : null;
      return (st && typeof st === 'object' && !Array.isArray(st)) ? st : {};
    }
    // The Ask Worker link comes from CODE only: window.BS_AI.askUrl in ai-config.js. It is never read from synced data (provider_data), because any
    // org member can edit that and this link receives the owner's session token. Second layer: the host must be *.workers.dev (https) or localhost.
    // Returns '' when the value is missing or fails the check. Trailing slashes are dropped.
    function _askCleanUrl(raw) {
      const u = String(raw || '').trim();
      const ok = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev(\/[^\s?#]*)?$/i.test(u) || /^http:\/\/localhost(:\d+)?(\/[^\s?#]*)?$/i.test(u);
      return ok ? u.replace(/\/+$/, '') : '';
    }
    function _askUrl() { const c = window.BS_AI; return _askCleanUrl(c && typeof c === 'object' ? c.askUrl : ''); }
    // Every token-carrying call goes through this: the URL must be exactly the configured one, nothing else.
    function _askPinned(url) { const p = _askUrl(); return !!p && String(url || '').replace(/\/+$/, '') === p; }
    function _askUser() {
      const u = (typeof BSPortal !== 'undefined' && BSPortal.getCurrentUser) ? BSPortal.getCurrentUser() : null;
      return u || {};
    }
    function _askRole() {
      const r = String(_askUser().role || '').toLowerCase();
      return ['master', 'admin', 'event-architect', 'dj'].indexOf(r) > -1 ? r : 'dj';
    }
    function _askIsManager(role) { return role === 'master' || role === 'admin'; }
    function _askSections() { return ['events', 'money', 'leads', 'clients', 'tasks', 'thread']; }
    function _askDefaultPerms(role) {
      const all = { events: true, money: true, leads: true, clients: true, tasks: true, thread: true };
      if (_askIsManager(role)) return all;
      if (role === 'event-architect') return { events: true, money: false, leads: true, clients: true, tasks: true, thread: true };
      return { events: true, money: false, leads: false, clients: false, tasks: true, thread: false };
    }
    // What this login may put in a question. The server's answer wins once it is loaded. Hard rules no toggle can change: managers see all,
    // a dj never gets leads or clients (they are not tied to the events a dj works).
    function _askPerms(role) {
      role = role || _askRole();
      if (_askIsManager(role)) return _askDefaultPerms('master');
      const s = _askS();
      const out = _askDefaultPerms(role);
      const srv = s.cfg && s.cfg.perms;
      if (srv && typeof srv === 'object') _askSections().forEach(k => { if (typeof srv[k] === 'boolean') out[k] = srv[k]; });
      if (role === 'dj') { out.leads = false; out.clients = false; }
      return out;
    }
    function _askAllowedModes(role) {
      if (_askIsManager(role)) return ['ask', 'draft', 'summarize', 'rule', 'campaign'];
      if (role === 'event-architect') return ['ask', 'draft', 'summarize'];
      return ['ask'];
    }
    // Who may run which proposal. Money and email stay with master and admin.
    function _askActionRoles(action) {
      const M = ['master', 'admin'], MA = ['master', 'admin', 'event-architect'];
      const t = { mark_invoice_paid: M, send_invoice_reminder: M, move_event_stage: MA, move_lead_stage: MA, create_task: ['master', 'admin', 'event-architect', 'dj'],
        send_client_email: M, create_draft_reply: MA, propose_automation_rule: M, create_campaign_draft: M };
      return t[action] || [];
    }
    function _askCanUse() { return !!_askUrl(); }

    // ── Text helpers ─────────────────────────────────────────────────────────
    // House voice for anything the model wrote: no em or en dashes, no exclamation points, plain spaces. Never throws.
    function _askClean(text, max) {
      let t = String(text == null ? '' : text);
      t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
      t = t.replace(/\s*[\u2014\u2015]\s*/g, ', ').replace(/\s*\u2013\s*/g, '-');
      t = t.replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/\.\s*\./g, '.');
      t = t.replace(/<[^>]*>/g, '');
      t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (max && t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '').trim();
      return t;
    }
    function _askOne(text, max) { return _askClean(String(text == null ? '' : text).replace(/\s+/g, ' '), max); }
    // Values that must never leave the browser even if they sneak into free text.
    function _askSecrets() {
      const out = [];
      const add = v => { v = String(v || ''); if (v.length >= 4 && out.indexOf(v) < 0) out.push(v); };
      try { add(window._sbToken); } catch (e) {}
      try { (getDB('events') || []).forEach(e => { if (e) add(e.portalPassword); }); } catch (e) {}
      try { (getDB('clients') || []).forEach(c => { if (c) add(c.portalPassword); }); } catch (e) {}
      return out;
    }
    // Last gate on every outgoing string: tokens, emails, phone numbers, long hex and base64 runs, known passwords.
    function _askScrub(text) {
      let t = String(text == null ? '' : text);
      _askSecrets().forEach(sec => { t = t.split(sec).join('[removed]'); });
      t = t.replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[removed]')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]')
        .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone removed]')
        .replace(/\b\d{10,11}\b/g, '[phone removed]')
        .replace(/\b[0-9a-fA-F]{24,}\b/g, '[removed]')
        .replace(/[A-Za-z0-9+\/_=-]{32,}/g, '[removed]');
      return t;
    }
    function _askCut(v, n) { return _askScrub(_askOne(v, n)); }
    function _askParseDate(v) {
      if (v === null || v === undefined || v === '') return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
      if (typeof v === 'number') { const d0 = new Date(v); return isNaN(d0.getTime()) ? null : d0; }
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    function _askISO(d) {
      d = _askParseDate(d);
      return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    }
    function _askDayNum(d) { d = _askParseDate(d); return d ? Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 86400000) : null; }
    function _askNow(opts) { return opts && opts.now ? new Date(opts.now) : new Date(); }
    function _askDow(now) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][_askNow({ now: now }).getDay()]; }
    function _askFmtDate(v) {
      const d = _askParseDate(v);
      return d ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate() : '';
    }
    function _askFmtTime(t) {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
      if (!m) return String(t || '');
      let h = +m[1]; const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
      return h + ':' + m[2] + ap;
    }
    function _askUSD(c) {
      const a = Math.abs(c);
      return (c < 0 ? '-' : '') + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: a % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
    }
    function _askCents(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; }
    function _askFirst(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
    function _askLabel(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

    // ── Money reads (use the CRM's own helpers when loaded) ──────────────────
    function _askInvPaidC(inv) {
      if (typeof _mnyInvPaidC === 'function') return _mnyInvPaidC(inv);
      if (Array.isArray(inv && inv.payments) && inv.payments.length) return inv.payments.reduce((s, p) => s + _askCents(p && p.amount), 0);
      return String((inv && inv.status) || '').toLowerCase() === 'paid' ? _askCents(inv.total) : 0;
    }
    function _askInvStatus(inv, now) {
      if (typeof _mnyInvStatus === 'function') return _mnyInvStatus(inv, now);
      const s = String((inv && inv.status) || '').toLowerCase();
      if (s === 'paid') return 'paid';
      if (/^(void|voided|cancelled|canceled)$/.test(s)) return 'void';
      const due = _askDayNum(inv && inv.dueDate), today = _askDayNum(_askNow({ now: now }));
      if (due !== null && due < today) return 'overdue';
      if (s === 'partial') return 'partial';
      return inv && inv.sentAt ? 'sent' : 'draft';
    }
    function _askInvLeftC(inv) { return Math.max(0, _askCents(inv && inv.total) - _askInvPaidC(inv)); }
    function _askInvNum(inv) { return String((inv && inv.invoiceNum) || 'invoice'); }
    function _askTerms() {
      try { if (typeof _mnyTerms === 'function') return _mnyTerms(); } catch (e) {}
      return { depositPercent: 50, balanceDueDays: 14 };
    }

    // ── Alias map ────────────────────────────────────────────────────────────
    // kind: E event, V invoice, L lead, C client, R rule. One code per record for the life of the page, so earlier answers stay readable.
    function _askAlias(kind, id) {
      const a = _askS().alias, key = kind + ':' + id;
      if (a.byKey[key]) return a.byKey[key];
      a.n[kind] = (a.n[kind] || 0) + 1;
      const code = kind + a.n[kind];
      a.byKey[key] = code; a.byCode[code] = { kind: kind, id: id };
      return code;
    }
    function _askResolve(code) { const r = _askS().alias.byCode[String(code || '')]; return r || null; }
    function _askFindEvent(id) { return (getDB('events') || []).find(e => e && e.id === id) || null; }
    function _askFindInvoice(id) { return (getDB('invoices') || []).find(i => i && i.id === id) || null; }
    function _askFindLead(id) { return (window._inquiries || []).find(i => i && i.id === id) || null; }
    function _askFindClient(id) { return (getDB('clients') || []).find(c => c && c.id === id) || null; }
    // Human label for a code, built from the CRM record (shown in place of the code in answers).
    function _askCodeLabel(code) {
      const r = _askResolve(code);
      if (!r) return code;
      if (r.kind === 'E') { const e = _askFindEvent(r.id); return e ? (e.name || 'the event') : code; }
      if (r.kind === 'V') { const i = _askFindInvoice(r.id); return i ? 'invoice ' + _askInvNum(i) + (i.clientName ? ' (' + i.clientName + ')' : '') : code; }
      if (r.kind === 'L') { const l = _askFindLead(r.id); return l ? (l.name || 'the lead') : code; }
      if (r.kind === 'C') { const c = _askFindClient(r.id); return c ? (c.name || 'the client') : code; }
      if (r.kind === 'R') { const x = (getDB('automations') || []).find(q => q && q.id === r.id); return x ? (x.label || x.name || 'the rule') : code; }
      return code;
    }
    function _askDeAlias(text) {
      return String(text == null ? '' : text).replace(/\b([EVLCR]\d{1,4})\b/g, (m, code) => (_askResolve(code) ? _askCodeLabel(code) : m));
    }

    // ── Context builder (allowlist only) ─────────────────────────────────────
    function _askEventLive(ev) { const s = String((ev && ev.status) || ''); return s !== 'cancelled' && s !== 'ghosted'; }
    function _askStaffNames(ev) {
      const users = getDB('users') || [];
      return (Array.isArray(ev && ev.staff) ? ev.staff : []).map(id => { const u = users.find(x => x && (x.id === id || x.supabaseId === id)); return u ? _askFirst(u.name) : ''; }).filter(Boolean);
    }
    // Events this login may see. A dj sees only the events they work.
    function _askVisibleEvents(role, user) {
      return (getDB('events') || []).filter(e => e && (role !== 'dj' || (Array.isArray(e.staff) && e.staff.indexOf(user.id) > -1)));
    }
    function _askTimelineText(ev) {
      const tl = Array.isArray(ev && ev.timeline) ? ev.timeline : [];
      return tl.slice(0, 12).map(t => {
        if (!t) return '';
        const time = _askFmtTime(t.time || t.startTime || '');
        const what = t.title || t.name || t.event || t.description || t.activity || '';
        return (time ? time + ' ' : '') + _askCut(what, 60);
      }).filter(Boolean).join('; ');
    }
    function _askGearText(ev) {
      const sv = Array.isArray(ev && ev.services) ? ev.services : [];
      return sv.slice(0, 8).map(s => (typeof s === 'string' ? s : (s && (s.name || s.label)) || '')).filter(Boolean).map(s => _askCut(s, 40)).join(', ');
    }
    function _askEventLine(ev, o) {
      const code = _askAlias('E', ev.id);
      const parts = [code, _askCut(ev.name || 'Event', 60), _askFmtDate(ev.date)];
      const t1 = _askFmtTime(ev.startTime), t2 = _askFmtTime(ev.endTime);
      if (t1) parts.push(t2 ? t1 + ' to ' + t2 : t1);
      if (ev.venueName) parts.push('at ' + _askCut(ev.venueName, 50));
      if (ev.status) parts.push(String(ev.status));
      if (o.names && ev.clientName) parts.push('client ' + _askCut(ev.clientName, 40));
      const crew = _askStaffNames(ev); if (crew.length) parts.push('crew ' + crew.join(', '));
      let line = parts.filter(Boolean).join(' | ');
      if (o.detail) {
        const g = _askGearText(ev), tl = _askTimelineText(ev);
        if (g) line += '\n  gear: ' + g;
        if (tl) line += '\n  timeline: ' + tl;
      }
      return line;
    }
    function _askSecEvents(c) {
      const today = _askDayNum(c.now), names = c.manager || c.perms.clients;
      const list = c.events.filter(e => _askEventLive(e) && _askDayNum(e.date) !== null && _askDayNum(e.date) >= today - 1)
        .sort((a, b) => _askDayNum(a.date) - _askDayNum(b.date)).slice(0, 15);
      const focusEv = c.focus && c.focus.kind === 'event' ? c.events.find(e => e.id === c.focus.id) : null;
      if (focusEv && list.indexOf(focusEv) < 0) list.push(focusEv);
      if (!list.length) return 'No upcoming events.';
      return list.map(e => _askEventLine(e, { names: names, detail: focusEv === e })).join('\n');
    }
    function _askSecMoney(c) {
      const invs = (getDB('invoices') || []).filter(i => i && _askInvStatus(i, c.now) !== 'void' && (c.role !== 'dj' || c.events.some(e => e.id === i.eventId)));
      const names = c.manager || c.perms.clients;
      const open = invs.filter(i => _askInvStatus(i, c.now) !== 'paid').sort((a, b) => (_askDayNum(a.dueDate) || 99999) - (_askDayNum(b.dueDate) || 99999)).slice(0, 15);
      const focusInv = c.focus && c.focus.kind === 'invoice' ? invs.find(i => i.id === c.focus.id) : null;
      if (focusInv && open.indexOf(focusInv) < 0) open.push(focusInv);
      const lines = open.map(i => {
        const ev = c.events.find(e => e.id === i.eventId);
        const p = [_askAlias('V', i.id), 'INV ' + _askInvNum(i).replace(/^INV-?/i, ''), ev ? 'for ' + _askAlias('E', ev.id) + ' ' + _askCut(ev.name, 40) : ''];
        if (names && i.clientName) p.push(_askCut(i.clientName, 40));
        p.push('total ' + _askUSD(_askCents(i.total)), 'paid ' + _askUSD(_askInvPaidC(i)), 'left ' + _askUSD(_askInvLeftC(i)));
        if (i.dueDate) p.push('due ' + _askFmtDate(i.dueDate));
        p.push(_askInvStatus(i, c.now));
        return p.filter(Boolean).join(' | ');
      });
      // Event totals come from the CRM's payment schedule. The model never adds anything up.
      const sched = [];
      if (typeof _mnySchedule === 'function') {
        const all = getDB('invoices') || [], terms = _askTerms(), today = _askDayNum(c.now);
        c.events.filter(e => _askEventLive(e) && _askDayNum(e.date) !== null && _askDayNum(e.date) >= today - 1).sort((a, b) => _askDayNum(a.date) - _askDayNum(b.date)).slice(0, 8).forEach(e => {
          let s = null; try { s = _mnySchedule(e, all, terms, c.now); } catch (x) { s = null; }
          if (!s || !s.ok) return;
          const next = (s.rows || []).find(r => !r.paid);
          sched.push(_askAlias('E', e.id) + ' money: total ' + _askUSD(s.totalC) + ', paid ' + _askUSD(s.paidC) + ', left ' + _askUSD(s.remainingC) + (next && next.due ? ', next due ' + _askFmtDate(next.due) : ''));
        });
      }
      const out = lines.concat(sched);
      return out.length ? out.join('\n') : 'No open invoices.';
    }
    function _askLeadOpen(l) { const s = String((l && l.status) || 'new'); return s !== 'archived' && s !== 'booked' && s !== 'converted'; }
    function _askLeadAgeDays(l, now) { const d = _askParseDate(l && l.created_at); return d ? Math.max(0, (_askNow({ now: now }).getTime() - d.getTime()) / 86400000) : 0; }
    function _askSecLeads(c) {
      const all = (window._inquiries || []).filter(l => l && _askLeadOpen(l)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 15);
      const focusLead = c.focus && c.focus.kind === 'lead' ? (window._inquiries || []).find(l => l && l.id === c.focus.id) : null;
      if (focusLead && all.indexOf(focusLead) < 0) all.push(focusLead);
      if (!all.length) return 'No open leads.';
      return all.map(l => {
        const p = [_askAlias('L', l.id), _askCut(l.name || 'Lead', 40)];
        if (l.event_type) p.push(_askCut(l.event_type, 30));
        if (l.event_date) p.push('event ' + _askFmtDate(l.event_date));
        if (l.venue) p.push('at ' + _askCut(l.venue, 40));
        p.push(String(l.status || 'new'), 'received ' + Math.floor(_askLeadAgeDays(l, c.now)) + ' days ago');
        let line = p.join(' | ');
        if (l === focusLead) {      // free text only for the lead you are working on, cut and scrubbed
          if (l.services) line += '\n  services: ' + _askCut(l.services, 120);
          if (l.message) line += '\n  message: ' + _askCut(l.message, 600);
        }
        return line;
      }).join('\n');
    }
    function _askSecClients(c) {
      const evs = getDB('events') || [];
      const list = (getDB('clients') || []).filter(x => x && x.name).slice(-15).reverse();
      const focusC = c.focus && c.focus.kind === 'client' ? _askFindClient(c.focus.id) : null;
      if (focusC && list.indexOf(focusC) < 0) list.push(focusC);
      if (!list.length) return 'No clients.';
      return list.map(x => {
        const mine = evs.filter(e => e && (e.clientId === x.id || (x.email && String(e.clientEmail || '').toLowerCase() === String(x.email).toLowerCase())));
        return [_askAlias('C', x.id), _askCut(x.name, 40), mine.length + ' events'].join(' | ');
      }).join('\n');
    }
    function _askSecTasks(c) {
      let tasks = (Array.isArray(getDB('tasks')) ? getDB('tasks') : []).filter(t => t && !t.completed);
      if (c.role === 'dj') tasks = tasks.filter(t => t.eventId && c.events.some(e => e.id === t.eventId));
      tasks = tasks.slice(-15);
      if (!tasks.length) return 'No open tasks.';
      return tasks.map(t => _askCut(t.description || t.text || 'Task', 100) + (t.eventName ? ' (' + _askCut(t.eventName, 40) + ')' : '')).join('\n');
    }
    function _askSecThread(c) {
      if (!c.focus || c.focus.kind !== 'event') return '';
      const ev = c.events.find(e => e.id === c.focus.id);
      if (!ev) return '';
      const msgs = (Array.isArray(ev.messages) ? ev.messages : []).slice(-6);
      if (!msgs.length) return 'No messages on ' + _askAlias('E', ev.id) + '.';
      return 'Messages on ' + _askAlias('E', ev.id) + ' (newest last):\n' + msgs.map(m => (m && m.from === 'client' ? 'Client: ' : 'Me: ') + _askCut(m && m.text, 600)).join('\n');
    }
    function _askSecRules(c) {
      const rules = (getDB('automations') || []).filter(r => r && r.id).slice(0, 15);
      if (!rules.length) return 'No rules yet.';
      return rules.map(r => {
        let s = ''; try { s = (typeof _autoSentence === 'function') ? _autoSentence(r) : (r.label || r.name || ''); } catch (e) { s = r.label || r.name || ''; }
        return _askAlias('R', r.id) + ' | ' + (r.enabled ? 'on' : 'off') + ' | ' + _askCut(s, 160);
      }).join('\n');
    }
    // Which sections a question needs. Keeps the context small, which keeps the free allowance going further.
    function _askPickSections(question, mode, perms, focus, role) {
      const q = String(question || '').toLowerCase(), want = {};
      if (mode === 'rule') want.rules = true;
      else if (mode === 'campaign') want.rules = true;
      else {
        if (focus) {
          if (focus.kind === 'event') { want.events = true; want.thread = true; if (perms.money) want.money = true; }
          else if (focus.kind === 'invoice') want.money = true;
          else if (focus.kind === 'lead') want.leads = true;
          else if (focus.kind === 'client') { want.clients = true; want.events = true; }
        }
        if (/owe|paid|pay\b|payment|invoice|deposit|balance|money|\$|revenue|due\b|overdue/.test(q)) want.money = true;
        if (/lead|inquir|quote|prospect/.test(q)) want.leads = true;
        if (/client|customer/.test(q)) want.clients = true;
        if (/task|todo|to-do|remind/.test(q)) want.tasks = true;
        if (/message|thread|replied|said\b/.test(q) && focus) want.thread = true;
        if (/rule|automat/.test(q)) want.rules = true;
        if (/event|weekend|week\b|date|tonight|tomorrow|today|when\b|schedule|calendar|venue|timeline|gear|crew|dj\b|light|book|coming up|upcoming|next\b/.test(q)) want.events = true;
        if (!Object.keys(want).length) { want.events = true; want.tasks = true; if (perms.money) want.money = true; if (perms.leads) want.leads = true; }
      }
      const out = [];
      ['events', 'money', 'leads', 'clients', 'tasks', 'thread', 'rules'].forEach(k => {
        if (!want[k]) return;
        if (k === 'rules' ? _askIsManager(role) : perms[k] === true) out.push(k);
      });
      return out;
    }
    // The request context. Returns { context: { today, dow, sections, aliases }, focus: { kind, alias } | null, chars }.
    // focus (optional): { kind: 'event'|'invoice'|'lead'|'client', id }. opts: { mode, now, role, user }.
    function assistantContext(question, focus, opts) {
      opts = opts || {};
      const now = _askNow(opts), role = opts.role || _askRole(), user = opts.user || _askUser();
      const perms = _askPerms(role), manager = _askIsManager(role);
      const c = { now: now, role: role, perms: perms, manager: manager, events: _askVisibleEvents(role, user), focus: null };
      if (focus && focus.id) {
        const kind = focus.kind;
        const ok = kind === 'event' ? c.events.some(e => e.id === focus.id)
          : kind === 'invoice' ? (perms.money && !!_askFindInvoice(focus.id) && (role !== 'dj' || c.events.some(e => e.id === (_askFindInvoice(focus.id) || {}).eventId)))
          : kind === 'lead' ? (perms.leads && !!_askFindLead(focus.id))
          : kind === 'client' ? (perms.clients && !!_askFindClient(focus.id)) : false;
        if (ok) c.focus = { kind: kind, id: focus.id };
      }
      if (c.focus && c.focus.kind === 'event' && !perms.events) c.focus = null;
      const pick = _askPickSections(question, opts.mode || 'ask', perms, c.focus, role);
      const build = { events: _askSecEvents, money: _askSecMoney, leads: _askSecLeads, clients: _askSecClients, tasks: _askSecTasks, thread: _askSecThread, rules: _askSecRules };
      const sections = {}; let total = 0; const LIMIT = 9000;
      pick.forEach(k => {
        let text = '';
        try { text = _askScrub(build[k](c)); } catch (e) { text = ''; }
        if (!text) return;
        if (total + text.length > LIMIT) {
          const room = LIMIT - total;
          if (room < 200) return;
          text = text.slice(0, room).replace(/\n[^\n]*$/, '');
        }
        sections[k] = text; total += text.length;
      });
      // Aliases the request may use: the codes that actually appear in the text sent.
      const joined = Object.keys(sections).map(k => sections[k]).join('\n');
      const seen = {}; (joined.match(/\b[EVLCR]\d{1,4}\b/g) || []).forEach(a => { if (_askResolve(a)) seen[a] = true; });
      let focusOut = null;
      if (c.focus) {
        const prefix = { event: 'E', invoice: 'V', lead: 'L', client: 'C' }[c.focus.kind];
        const code = _askAlias(prefix, c.focus.id);
        if (seen[code]) focusOut = { kind: c.focus.kind, alias: code };
      }
      return { context: { today: _askISO(now), dow: _askDow(now), sections: sections, aliases: Object.keys(seen) }, focus: focusOut, chars: total };
    }

    // ── Intent router and local answers (no AI, no cost) ─────────────────────
    function _askIntent(question) {
      const q = String(question || '').toLowerCase().trim();
      if (!q) return null;
      if (/who owes|owes me|owe me|who hasn.?t paid|unpaid|outstanding (invoices|balance|money)|overdue (invoices|payments)|money (is )?(due|owed)/.test(q)) return { intent: 'owed' };
      if (/(leads?|inquir\w*).*(no (reply|response)|not (been )?(replied|answered)|unanswered|waiting|haven.?t (replied|answered))|(no|without) (reply|response).*(leads?|inquir\w*)|haven.?t (replied|answered|responded).*(leads?|inquir\w*)/.test(q)) {
        const m = /(\d+)\s*(day|days|d)\b/.exec(q);
        return { intent: 'noreply', days: m ? Math.max(1, Math.min(60, +m[1])) : 3 };
      }
      if (/this weekend|what.?s on.*(weekend|saturday|sunday|friday)|on (this )?weekend|weekend events?|events? this weekend/.test(q)) return { intent: 'weekend' };
      return null;
    }
    function _askMode(question, role) {
      const q = String(question || '').toLowerCase();
      let mode = 'ask';
      if (/\b(campaign|newsletter|email blast|promo email|promotion email)\b/.test(q)) mode = 'campaign';
      else if (/\b(automation|auto-?reply|whenever|every time|automatically)\b|\bnew rule\b|\bcreate a rule\b|\badd a rule\b|\ba rule\b/.test(q)) mode = 'rule';
      else if (/^\s*(please\s+)?(draft|write|compose)\b|\b(reply to|respond to)\b|\bwrite (a|an|the)\b.*\b(email|message|reply|note)\b/.test(q)) mode = 'draft';
      else if (/\b(summar(y|ize|ise)|catch me up|recap)\b/.test(q)) mode = 'summarize';
      if ((mode === 'rule' || mode === 'campaign') && !_askIsManager(role)) mode = 'ask';
      return mode;
    }
    // { type: 'local', intent, days? } | { type: 'denied', message } | { type: 'model', mode }
    function _askRoute(question, opts) {
      opts = opts || {};
      const role = opts.role || _askRole();
      if (opts.forceMode) return { type: 'model', mode: opts.forceMode };
      const it = _askIntent(question);
      if (it) return Object.assign({ type: 'local' }, it);
      const mode = _askMode(question, role);
      if (_askAllowedModes(role).indexOf(mode) < 0) return { type: 'denied', message: 'Drafts and summaries are not turned on for this login. You can still ask questions.' };
      return { type: 'model', mode: mode };
    }
    function _askMsg(kind, extra) {
      switch (kind) {
        case 'busy': return 'Still working on your last question. Try again in a moment.';
        case 'limit': return 'The free AI limit for today is used up. Quick answers about money, the weekend and leads still work.';
        case 'cap': return extra && extra.off ? 'Ask is turned off for this login. Ask the owner to turn it on in Settings.' : 'You have used your questions for today.' + (extra && extra.resetLocal ? ' They come back at ' + extra.resetLocal + ' Miami time.' : ' They come back tomorrow.');
        case 'auth': return 'Sign in again to use Ask.';
        case 'forbidden': return 'This login is not set up to use Ask.';
        case 'origin': return 'The assistant link does not allow this site. Check the link in Settings.';
        case 'network': return 'Could not reach the assistant. Check the link in Settings and your connection.';
        case 'bad_output': return 'The assistant gave an answer that could not be used. Try asking again.';
        case 'nolink': return 'Ask is not set up yet. The assistant link goes in ai-config.js.';
        case 'empty': return 'Type a question first.';
        default: return 'The assistant could not answer. Try again in a moment.';
      }
    }
    function _askRowsFor(kind, items) { return items.map(x => ({ label: x.label, open: { kind: kind, id: x.id } })); }
    // Pure. opts: { now, role, user, days }. Returns { answer, rows, local: true } or { answer, denied: true }.
    function _askLocalAnswer(intent, opts) {
      opts = opts || {};
      const now = _askNow(opts), role = opts.role || _askRole(), user = opts.user || _askUser(), perms = _askPerms(role);
      const today = _askDayNum(now);
      if (intent === 'owed') {
        if (!perms.money) return { answer: 'Money details are turned off for this login.', denied: true };
        const invs = (getDB('invoices') || []).filter(i => i && ['paid', 'void', 'draft'].indexOf(_askInvStatus(i, now)) < 0 && _askInvLeftC(i) > 0 && (role !== 'dj' || _askVisibleEvents(role, user).some(e => e.id === i.eventId)));
        if (!invs.length) return { answer: 'Nobody owes you money right now.', rows: [], local: true };
        invs.sort((a, b) => (_askDayNum(a.dueDate) || 99999) - (_askDayNum(b.dueDate) || 99999));
        const total = invs.reduce((s, i) => s + _askInvLeftC(i), 0);
        const lines = invs.slice(0, 10).map(i => {
          const st = _askInvStatus(i, now), due = _askDayNum(i.dueDate);
          const late = st === 'overdue' && due !== null ? ', ' + (today - due) + (today - due === 1 ? ' day' : ' days') + ' late' : (i.dueDate ? ', due ' + _askFmtDate(i.dueDate) : '');
          return (i.clientName || 'Client') + ', invoice ' + _askInvNum(i) + ': ' + _askUSD(_askInvLeftC(i)) + ' left' + late + '.';
        });
        const more = invs.length > 10 ? '\nAnd ' + (invs.length - 10) + ' more.' : '';
        return { answer: invs.length + (invs.length === 1 ? ' invoice has' : ' invoices have') + ' money still due, ' + _askUSD(total) + ' in all.\n' + lines.join('\n') + more, local: true,
          rows: _askRowsFor('invoice', invs.slice(0, 10).map(i => ({ id: i.id, label: (i.clientName || 'Client') + ' ' + _askInvNum(i) }))) };
      }
      if (intent === 'weekend') {
        if (!perms.events) return { answer: 'Events are turned off for this login.', denied: true };
        const dow = now.getDay(), toFri = dow === 6 ? -1 : dow === 0 ? -2 : (5 - dow);
        const fri = today + toFri, sun = fri + 2;
        const evs = _askVisibleEvents(role, user).filter(e => _askEventLive(e) && _askDayNum(e.date) !== null && _askDayNum(e.date) >= fri && _askDayNum(e.date) <= sun)
          .sort((a, b) => (_askDayNum(a.date) - _askDayNum(b.date)) || String(a.startTime || '').localeCompare(String(b.startTime || '')));
        if (!evs.length) return { answer: 'Nothing is on the calendar for ' + (fri > today ? 'this coming weekend' : 'this weekend') + '.', rows: [], local: true };
        const lines = evs.map(e => {
          const t1 = _askFmtTime(e.startTime), t2 = _askFmtTime(e.endTime);
          return _askFmtDate(e.date) + (t1 ? ', ' + (t2 ? t1 + ' to ' + t2 : t1) : '') + ': ' + (e.name || 'Event') + (e.venueName ? ' at ' + e.venueName : '') + (e.status ? ' (' + e.status + ')' : '') + '.';
        });
        return { answer: (evs.length === 1 ? 'One event' : evs.length + ' events') + ' ' + (fri > today ? 'this coming weekend' : 'this weekend') + '.\n' + lines.join('\n'), local: true,
          rows: _askRowsFor('event', evs.map(e => ({ id: e.id, label: e.name || 'Event' }))) };
      }
      if (intent === 'noreply') {
        if (!perms.leads || role === 'dj') return { answer: 'Leads are turned off for this login.', denied: true };
        const days = Math.max(1, Math.min(60, Number(opts.days) || 3));
        const flags = _askLeadFlags(window._inquiries || [], now, days);
        const list = flags.stale;
        if (!window._inquiries) return { answer: 'Leads have not loaded yet. Open Pipeline once, then ask again.', local: true, rows: [] };
        if (!list.length) return { answer: 'No lead has been waiting ' + days + ' days or more for a reply.', rows: [], local: true };
        const lines = list.slice(0, 10).map(l => (l.name || 'Lead') + (l.event_type ? ', ' + l.event_type : '') + ', received ' + Math.floor(_askLeadAgeDays(l, now)) + ' days ago.');
        const more = list.length > 10 ? '\nAnd ' + (list.length - 10) + ' more.' : '';
        return { answer: list.length + (list.length === 1 ? ' lead has' : ' leads have') + ' had no reply in ' + days + ' days or more.\n' + lines.join('\n') + more, local: true,
          rows: _askRowsFor('lead', list.slice(0, 10).map(l => ({ id: l.id, label: l.name || 'Lead' }))) };
      }
      return { answer: '', local: true };
    }

    // ── Lead watcher (flags only, never drafts or sends by itself) ───────────
    // fresh: new leads younger than `days`. stale: still "new" after `days` or more with no reply recorded.
    function _askLeadFlags(leads, now, days) {
      const out = { fresh: [], stale: [] };
      (leads || []).forEach(l => {
        if (!l || String(l.status || 'new') !== 'new' || l.repliedAt) return;
        (_askLeadAgeDays(l, now) >= days ? out.stale : out.fresh).push(l);
      });
      return out;
    }
    function _askWatchDays() { const n = parseInt(_askSettingsObj().assistantWatchDays, 10); return n >= 1 && n <= 30 ? n : 2; }
    function _askLeadWatch(opts) {
      opts = opts || {};
      const s = _askS();
      const role = _askRole();
      if (role === 'dj' || !_askPerms(role).leads || !Array.isArray(window._inquiries)) return null;
      const f = _askLeadFlags(window._inquiries, _askNow(opts), _askWatchDays());
      s.flags = { fresh: f.fresh.map(l => l.id), stale: f.stale.map(l => l.id), at: Date.now() };
      _askRefreshBtn();
      if (!s.watching && !opts.noTimer && typeof setInterval === 'function') { s.watching = true; setInterval(function () { try { _askLeadWatch(); } catch (e) {} }, 5 * 60 * 1000); }
      return s.flags;
    }

    // ── Request to the Worker ────────────────────────────────────────────────
    // Builds the POST body. Never includes emails, phones, passwords, signatures or tokens (the token goes in the header only).
    function _askBuildRequest(mode, question, focus, opts) {
      opts = opts || {};
      const q = _askOne(question, 500) || (mode === 'summarize' ? 'Summarize this.' : '');
      const built = assistantContext(q, focus, Object.assign({}, opts, { mode: mode }));
      const payload = { v: 1, mode: mode, question: _askScrub(q), context: built.context };
      if (built.focus) payload.focus = built.focus;
      const hist = (opts.history || _askS().history || []).slice(-2).map(h => ({ q: _askScrub(_askOne(h.q, 500)), a: _askScrub(_askOne(h.a, 300)) })).filter(h => h.q && h.a);
      if (hist.length) payload.history = hist;
      const cap = _askS().cfg && _askS().cfg.cap;
      if (typeof cap === 'number' && cap >= 0 && cap <= 200 && Math.floor(cap) === cap) payload.capHint = cap;
      return payload;
    }
    // Posts to the link with the session token. Resolves to { ok: true, data } or { error, message, usage? }.
    async function _askRequest(url, token, payload, fetchFn, signal) {
      if (!url || !_askPinned(url)) return { error: 'nolink', message: _askMsg('nolink') };
      if (!token) return { error: 'auth', message: _askMsg('auth') };
      let r;
      try {
        r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(payload), signal: signal });
      } catch (e) { return { error: 'network', message: _askMsg('network') }; }
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      const code = data && typeof data.error === 'string' ? data.error : '';
      if (r.status === 429 && code === 'busy') return { error: 'busy', message: _askMsg('busy') };   // one question at a time, nothing was counted
      if (r.status === 429 && code === 'cap') return { error: 'cap', message: _askMsg('cap', { off: !!data.off, resetLocal: data.resetLocal }), usage: data.usage || null };
      if (r.status === 429 || code === 'limit') return { error: 'limit', message: _askMsg('limit'), usage: data && data.usage || null };
      if (r.status === 401 || code === 'auth') return { error: 'auth', message: _askMsg('auth') };
      if (r.status === 403 && code === 'origin') return { error: 'origin', message: _askMsg('origin') };
      if (r.status === 403) return { error: 'forbidden', message: _askMsg('forbidden') };
      if (r.status === 502 && code === 'bad_output') return { error: 'bad_output', message: _askMsg('bad_output') };
      if (!r.ok) return { error: 'other', message: (r.status === 400 && data && typeof data.message === 'string' && /\s/.test(data.message)) ? data.message : _askMsg('other') };
      if (!data || typeof data !== 'object') return { error: 'other', message: _askMsg('other') };
      return { ok: true, data: data };
    }

    // ── Proposal validation (second check; the Worker validates too) ─────────
    // The sentence and confirm text are built here from CRM records, never from model text.
    // p: { action, args }. opts: { now, role, user }. Returns { ok: true, card } or { ok: false, reason }.
    function _askValidateProposal(p, opts) {
      opts = opts || {};
      const now = _askNow(opts), role = opts.role || _askRole(), user = opts.user || _askUser();
      if (!p || typeof p.action !== 'string') return { ok: false, reason: 'shape' };
      if (_askActionRoles(p.action).indexOf(role) < 0) return { ok: false, reason: 'role' };
      const a = (p.args && typeof p.args === 'object') ? p.args : {};
      const bad = reason => ({ ok: false, reason: reason });
      const evFor = code => { const r = _askResolve(code); return r && r.kind === 'E' ? _askVisibleEvents(role, user).find(e => e.id === r.id) || null : null; };
      if (p.action === 'mark_invoice_paid') {
        const r = _askResolve(a.invoice); if (!r || r.kind !== 'V') return bad('invoice');
        const inv = _askFindInvoice(r.id); if (!inv) return bad('invoice');
        const st = _askInvStatus(inv, now); if (st === 'paid' || st === 'void') return bad('closed');
        const left = _askInvLeftC(inv); if (!(left > 0)) return bad('closed');
        let amt = left;
        if (a.amount !== undefined && a.amount !== null) {
          if (typeof a.amount !== 'number' || !isFinite(a.amount)) return bad('amount');
          amt = Math.round(a.amount * 100);
          if (!(amt > 0) || amt > left) return bad('amount');
        }
        const who = inv.clientName || 'the client', num = _askInvNum(inv);
        return { ok: true, card: { action: p.action, args: { invoiceId: inv.id, amountC: amt },
          sentence: 'Record ' + _askUSD(amt) + ' as received on invoice ' + num + ' for ' + who + '.',
          confirm: { title: 'Record this payment?', body: _askUSD(amt) + ' will be recorded as received on invoice ' + num + ' for ' + who + '. ' + (left - amt > 0 ? _askUSD(left - amt) + ' would still be due.' : 'It will be marked paid.') + ' The event payment status follows.', confirmLabel: 'Record payment' } } };
      }
      if (p.action === 'send_invoice_reminder') {
        const r = _askResolve(a.invoice); if (!r || r.kind !== 'V') return bad('invoice');
        const inv = _askFindInvoice(r.id); if (!inv) return bad('invoice');
        const st = _askInvStatus(inv, now); if (st === 'paid' || st === 'void') return bad('closed');
        if (!inv.clientEmail) return bad('noemail');
        return { ok: true, card: { action: p.action, args: { invoiceId: inv.id }, ownConfirm: true,
          sentence: 'Send a payment reminder for invoice ' + _askInvNum(inv) + ' to ' + (inv.clientName || 'the client') + '. You will see the exact email before it goes.' } };
      }
      if (p.action === 'move_event_stage') {
        const ev = evFor(a.event); if (!ev) return bad('event');
        if (['lead', 'proposal', 'negotiation', 'cancelled', 'ghosted'].indexOf(a.stage) < 0) return bad('stage');
        if (ev.status === a.stage) return bad('same');
        if (_askLockedStage(ev.status)) return bad('locked');
        return { ok: true, card: { action: p.action, args: { eventId: ev.id, stage: a.stage },
          sentence: 'Move ' + (ev.name || 'the event') + ' from ' + _askLabel(ev.status || 'lead') + ' to ' + _askLabel(a.stage) + '.',
          confirm: { title: 'Move this event?', body: (ev.name || 'The event') + ' goes from ' + _askLabel(ev.status || 'lead') + ' to ' + _askLabel(a.stage) + ' in the pipeline. You can undo it right after.', confirmLabel: 'Move event' } } };
      }
      if (p.action === 'move_lead_stage') {
        const r = _askResolve(a.lead); if (!r || r.kind !== 'L') return bad('lead');
        const lead = _askFindLead(r.id); if (!lead) return bad('lead');
        if (['contacted', 'quoted', 'archived'].indexOf(a.stage) < 0) return bad('stage');
        if ((lead.status || 'new') === a.stage) return bad('same');
        return { ok: true, card: { action: p.action, args: { leadId: lead.id, stage: a.stage },
          sentence: 'Move ' + (lead.name || 'the lead') + ' from ' + _askLabel(lead.status || 'new') + ' to ' + _askLabel(a.stage) + '.',
          confirm: { title: 'Move this lead?', body: (lead.name || 'The lead') + ' goes from ' + _askLabel(lead.status || 'new') + ' to ' + _askLabel(a.stage) + '. Automations for that stage may run. You can undo it right after.', confirmLabel: 'Move lead' } } };
      }
      if (p.action === 'create_task') {
        const text = _askOne(a.text, 140); if (!text) return bad('text');
        let ev = null;
        if (a.event !== undefined && a.event !== null && a.event !== '') { ev = evFor(a.event); if (!ev) return bad('event'); }
        if (role === 'dj' && !ev) return bad('event');
        return { ok: true, card: { action: p.action, args: { text: text, eventId: ev ? ev.id : '' },
          sentence: 'Add the task "' + text + '"' + (ev ? ' to ' + (ev.name || 'the event') : '') + '.',
          confirm: { title: 'Add this task?', body: '"' + text + '"' + (ev ? ' will be added to ' + (ev.name || 'the event') + '.' : ' will be added to your task list.'), confirmLabel: 'Add task' } } };
      }
      if (p.action === 'send_client_email') {
        const t = _askTargetEmail(a.target); if (!t) return bad('target');
        if (!t.email) return bad('noemail');
        const subject = _askOne(a.subject, 150), body = _askClean(a.body, 2000);
        if (!subject || !body) return bad('text');
        return { ok: true, card: { action: p.action, args: { email: t.email, name: t.name, subject: subject, body: body }, ownConfirm: true, showBody: body, subject: subject,
          sentence: 'Email ' + (t.name || 'the client') + '. You will see the full email and the address before it goes.' } };
      }
      return bad('action');
    }
    // Booked, confirmed and completed come from payments and contracts. Ask never moves an event out of them.
    function _askLockedStage(status) { return ['booked', 'confirmed', 'completed'].indexOf(String(status || '')) > -1; }
    // Where an email would go for a target code (E event, L lead, C client). The address stays in the browser.
    function _askTargetEmail(code) {
      const r = _askResolve(code); if (!r) return null;
      if (r.kind === 'E') { const e = _askFindEvent(r.id); return e ? { kind: 'event', id: e.id, name: e.clientName || '', email: String(e.clientEmail || e.portalEmail || '').trim(), label: e.name || 'Event' } : null; }
      if (r.kind === 'L') { const l = _askFindLead(r.id); return l ? { kind: 'lead', id: l.id, name: l.name || '', email: String(l.email || '').trim(), label: l.name || 'Lead' } : null; }
      if (r.kind === 'C') { const c = _askFindClient(r.id); return c ? { kind: 'client', id: c.id, name: c.name || '', email: String(c.email || '').trim(), label: c.name || 'Client' } : null; }
      return null;
    }
    // Draft from the model: { target, channel, subject?, body }. Returns { ok, draft } or { ok: false, reason }. No write.
    function _askValidateDraft(d, opts) {
      opts = opts || {};
      const role = opts.role || _askRole();
      if (role === 'dj') return { ok: false, reason: 'role' };
      if (!d || typeof d !== 'object') return { ok: false, reason: 'shape' };
      const t = _askTargetEmail(d.target); if (!t) return { ok: false, reason: 'target' };
      if (d.channel !== 'email' && d.channel !== 'portal') return { ok: false, reason: 'channel' };
      if (d.channel === 'portal' && t.kind !== 'event') return { ok: false, reason: 'channel' };
      if (t.kind === 'lead' && !_askPerms(role).leads) return { ok: false, reason: 'perm' };
      if (t.kind === 'client' && !_askPerms(role).clients) return { ok: false, reason: 'perm' };
      const body = _askClean(d.body, 2000); if (!body) return { ok: false, reason: 'text' };
      const subject = _askOne(d.subject, 150);
      return { ok: true, draft: { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: t.kind, targetId: t.id, label: t.label, channel: d.channel, subject: subject, body: body, createdAt: Date.now() } };
    }

    // Rules. Lead rules (stage/trigger/action) and event rules ({trigger:{type,value}, action:{type,...}}). Returns { ok, rule } with enabled:false.
    function _askValidateRule(r, opts) {
      opts = opts || {};
      if (!_askIsManager(opts.role || _askRole())) return { ok: false, reason: 'role' };
      if (!r || typeof r !== 'object') return { ok: false, reason: 'shape' };
      const base = { id: (typeof genId === 'function' ? genId() : 'r' + Date.now().toString(36)), enabled: false, createdBy: 'ask', createdAt: new Date().toISOString() };
      if (r.trigger && typeof r.trigger === 'object') {
        const t = r.trigger, a = r.action;
        if (t.type !== 'status_change' && t.type !== 'deposit_received') return { ok: false, reason: 'trigger' };
        if (!a || typeof a !== 'object') return { ok: false, reason: 'action' };
        const field = { create_task: 'task', notification: 'message', add_note: 'note' }[a.type];
        if (!field) return { ok: false, reason: 'action' };
        const text = _askOne(a[field], 200); if (!text) return { ok: false, reason: 'text' };
        const trigger = { type: t.type, value: '' };
        if (t.type === 'status_change') { if (['proposal', 'booked', 'confirmed', 'completed'].indexOf(t.value) < 0) return { ok: false, reason: 'trigger' }; trigger.value = t.value; }
        const rule = Object.assign(base, { trigger: trigger, action: { type: a.type } });
        rule.action[field] = text;
        rule.name = _askOne((t.type === 'status_change' ? 'Event moves to ' + _askLabel(t.value) : 'Deposit received') + ': ' + text, 80);
        return { ok: true, rule: rule, kind: 'event' };
      }
      if (['new', 'contacted', 'quoted'].indexOf(r.stage) < 0) return { ok: false, reason: 'stage' };
      if (['enter', 'after_days', 'days_before_event'].indexOf(r.trigger) < 0) return { ok: false, reason: 'trigger' };
      if (['email', 'task', 'advance'].indexOf(r.action) < 0) return { ok: false, reason: 'action' };
      if (r.trigger === 'days_before_event' && r.action === 'advance') return { ok: false, reason: 'action' };
      let days = 0;
      if (r.trigger !== 'enter') { days = r.days === undefined ? (r.trigger === 'days_before_event' ? 21 : 1) : r.days; if (typeof days !== 'number' || days !== Math.floor(days) || days < 0 || days > 365) return { ok: false, reason: 'days' }; }
      const rule = Object.assign(base, { stage: r.trigger === 'days_before_event' ? null : r.stage, trigger: r.trigger, action: r.action, days: days });
      rule.label = _askOne(r.label, 80);
      if (r.action === 'task') { rule.taskTemplate = _askOne(r.taskTemplate || r.label, 140); if (!rule.taskTemplate) return { ok: false, reason: 'text' }; }
      if (r.action === 'email') { rule.marketing = true; rule.emailBody = _askClean(r.emailBody, 1000); if (!rule.emailBody) return { ok: false, reason: 'text' }; rule.template = 'generic'; rule.subject = _askOne(r.subject, 150) || rule.label || 'From Baseline Studio'; }
      if (r.action === 'advance') { if (['contacted', 'quoted'].indexOf(r.toStage) < 0) return { ok: false, reason: 'stage' }; rule.toStage = r.toStage; }
      if (!rule.label) rule.label = rule.taskTemplate || (r.action === 'advance' ? 'Move lead to ' + rule.toStage : 'Email');
      return { ok: true, rule: rule, kind: 'lead' };
    }
    // Campaign draft. Only all, booked or completed. Only the two merge tokens the composer knows. Never sends.
    function _askValidateCampaign(c, opts) {
      opts = opts || {};
      if (!_askIsManager(opts.role || _askRole())) return { ok: false, reason: 'role' };
      if (!c || typeof c !== 'object') return { ok: false, reason: 'shape' };
      if (['all', 'booked', 'completed'].indexOf(c.audience) < 0) return { ok: false, reason: 'audience' };
      const tok = s => String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k === 'client_name' || k === 'event_date' ? '{{' + k + '}}' : ''));
      const subjects = (Array.isArray(c.subjects) ? c.subjects : (c.subject ? [c.subject] : [])).map(s => tok(_askOne(s, 150))).filter(Boolean).slice(0, 3);
      const message = tok(_askClean(c.message, 3000));
      if (!subjects.length || !message) return { ok: false, reason: 'text' };
      return { ok: true, campaign: { name: _askOne(c.name, 80) || subjects[0].slice(0, 80), audience: c.audience, subjects: subjects, message: message } };
    }

    // ── Drafts (synced in provider_data.askDrafts, kept 7 days) ──────────────
    function _askDraftsPrune(list, now) {
      const cut = (now || Date.now()) - 7 * 86400000;
      return (Array.isArray(list) ? list : []).filter(d => d && d.id && d.body && Number(d.createdAt) >= cut).slice(-30);
    }
    function _askDrafts() { return _askDraftsPrune(getDB('askDrafts')); }
    function _askDraftSave(d) {
      const list = _askDrafts().filter(x => !(x.kind === d.kind && x.targetId === d.targetId));
      list.push(d);
      setDB('askDrafts', _askDraftsPrune(list));
      return d;
    }
    function _askDraftRemove(id) { setDB('askDrafts', _askDrafts().filter(x => x.id !== id)); }
    function _askDraftFor(kind, targetId) { return _askDrafts().find(x => x.kind === kind && x.targetId === targetId) || null; }

    // ── Turning a Worker answer into thread content ──────────────────────────
    // Returns { text, cards, usage, skipped }. cards: draft, proposal, rule, campaign. Invalid parts are dropped and counted.
    function _askHandleResponse(data, opts) {
      opts = opts || {};
      const role = opts.role || _askRole();
      const out = { text: _askClean(_askDeAlias(data && data.answer), 1200), cards: [], usage: (data && data.usage) || null, skipped: 0 };
      if (data && data.draft) {
        const v = _askValidateDraft(data.draft, opts);
        if (v.ok) { out.cards.push({ kind: 'draft', draft: _askDraftSave(v.draft), state: 'open' }); } else out.skipped++;
      }
      (Array.isArray(data && data.proposals) ? data.proposals : []).slice(0, 3).forEach(p => {
        if (p && p.action === 'create_draft_reply') {
          const v = _askValidateDraft(p.args, opts);
          if (v.ok && !out.cards.some(c => c.kind === 'draft')) out.cards.push({ kind: 'draft', draft: _askDraftSave(v.draft), state: 'open' }); else if (!v.ok) out.skipped++;
          return;
        }
        const v = _askValidateProposal(p, opts);
        if (v.ok) out.cards.push(Object.assign({ kind: 'proposal', state: 'open' }, v.card)); else out.skipped++;
      });
      if (data && data.rule) { const v = _askValidateRule(data.rule, opts); if (v.ok) out.cards.push({ kind: 'rule', rule: v.rule, ruleKind: v.kind, state: 'open' }); else out.skipped++; }
      if (data && data.campaign) { const v = _askValidateCampaign(data.campaign, opts); if (v.ok) out.cards.push({ kind: 'campaign', campaign: v.campaign, state: 'open' }); else out.skipped++; }
      if (!out.text && !out.cards.length) out.text = out.skipped ? 'I could not match that to your records. Try asking another way.' : 'No answer came back. Try asking another way.';
      return out;
    }

    // ── Doing things (always through the CRM's own functions) ────────────────
    function _askToast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'info'); }
    function _askConfirm(c) {
      if (!(window.CRMUI && CRMUI.confirm)) { _askToast('Could not ask for confirmation, so nothing was done.', 'error'); return Promise.resolve(false); }
      return CRMUI.confirm(c);
    }
    // Email: always shows the address, subject and full body first. Fails closed when the dialog is missing.
    async function _askSendEmail(email, clientName, subject, body) {
      if (!email) { _askToast('There is no email address on that record.', 'warning'); return { ok: false }; }
      const ok = await _askConfirm({ title: 'Send this email?', body: 'To ' + email + '. Subject: ' + subject + '.\n\n' + body, confirmLabel: 'Send email' });
      if (!ok) return { ok: false, cancelled: true };
      let res = null;
      try { res = await BSPortal.sendEmail('generic', { email: email, clientName: clientName || 'there', body: body, subject: subject }); } catch (e) { res = { ok: false }; }
      if (res && res.ok) { _askToast('Email sent to ' + email, 'success'); return { ok: true }; }
      if (typeof showEmailFallback === 'function') showEmailFallback(email, subject, body, 'Could not send. Use this fallback:');
      else _askToast('Could not send the email.', 'error');
      return { ok: false };
    }
    // Runs one validated proposal card. Resolves to true when it was done.
    async function _askRunCard(card) {
      const a = card.args || {};
      if (card.action === 'mark_invoice_paid') {
        if (!(await _askConfirm(card.confirm))) return false;
        if (typeof recordInvoicePayment !== 'function') { _askToast('Payments are not available right now.', 'error'); return false; }
        const r = recordInvoicePayment(a.invoiceId, a.amountC / 100, { method: 'Manual', toast: true });
        if (!r || !r.ok) { _askToast('Could not record that payment' + (r && r.reason ? ': ' + r.reason + '.' : '.'), 'warning'); return false; }
        return true;
      }
      if (card.action === 'send_invoice_reminder') {
        if (typeof sendInvoiceConfirm !== 'function') return false;
        await sendInvoiceConfirm(a.invoiceId, { reminder: true });
        return true;
      }
      if (card.action === 'move_event_stage') {
        const live = _askFindEvent(a.eventId);
        if (!live || _askLockedStage(live.status)) { _askToast('That event is already booked, so Ask will not move it. Move it yourself in the pipeline.', 'warning'); return false; }
        if (!(await _askConfirm(card.confirm))) return false;
        const live2 = _askFindEvent(a.eventId);
        if (!live2 || _askLockedStage(live2.status)) { _askToast('That event changed while you were deciding, so nothing was moved.', 'warning'); return false; }
        if (typeof _pipeMoveEvent !== 'function') return false;
        _pipeMoveEvent(a.eventId, a.stage);
        return true;
      }
      if (card.action === 'move_lead_stage') {
        if (!(await _askConfirm(card.confirm))) return false;
        if (typeof setInquiryStage !== 'function') return false;
        await setInquiryStage(a.leadId, a.stage);
        return true;
      }
      if (card.action === 'create_task') {
        if (!(await _askConfirm(card.confirm))) return false;
        if (typeof executeAction !== 'function') return false;
        executeAction({ type: 'create_task', task: a.text }, a.eventId || '');
        _askToast('Task added.', 'success');
        try { if (typeof renderDashboard === 'function' && document.getElementById('homeNeeds')) renderDashboard(); } catch (e) {}
        return true;
      }
      if (card.action === 'send_client_email') {
        const r = await _askSendEmail(a.email, a.name, a.subject, a.body);
        return !!r.ok;
      }
      return false;
    }
    async function _askRunRule(card) {
      const rule = card.rule;
      const text = (typeof _autoSentence === 'function') ? _autoSentence(rule) : (rule.label || rule.name || '');
      if (!(await _askConfirm({ title: 'Add this rule?', body: text + '\n\nIt is added switched off. Turn it on in Automations when you are ready.', confirmLabel: 'Add as off' }))) return false;
      const rules = Array.isArray(getDB('automations')) ? getDB('automations') : [];
      rules.push(Object.assign({}, rule, { enabled: false }));
      setDB('automations', rules);
      try { if (typeof renderAutomations === 'function' && document.getElementById('automations')) renderAutomations(); } catch (e) {}
      _askToast('Rule added, switched off.', 'success');
      return true;
    }
    // Opens the existing campaign composer filled in. Saving and sending stay with the owner.
    function _askRunCampaign(card, idx) {
      const c = card.campaign;
      if (typeof openCampaignComposer !== 'function') { _askToast('Campaigns are not available right now.', 'error'); return false; }
      try { const sh = document.getElementById('askSheet'); if (sh && window.CRMUI && CRMUI.close) CRMUI.close(sh, { force: true }); } catch (e) {}
      openCampaignComposer();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('campaignName', c.name); set('campaignAudience', c.audience); set('campaignSubject', c.subjects[Math.min(idx || 0, c.subjects.length - 1)]); set('campaignMessage', c.message);
      try { if (typeof _mktShowCount === 'function') _mktShowCount(); } catch (e) {}
      _askToast('Review it, then save as a draft. Nothing is sent.', 'info');
      return true;
    }
    function _askCopy(text) {
      try { navigator.clipboard.writeText(String(text || '')); _askToast('Copied', 'success'); } catch (e) { _askToast('Could not copy. Select the text and copy it.', 'warning'); }
    }
    function _askCloseSheet() { try { const sh = document.getElementById('askSheet'); if (sh && window.CRMUI && CRMUI.close) CRMUI.close(sh, { force: true }); } catch (e) {} }
    // Puts text into the event Messages composer. The owner still presses Send.
    function _askUseInMessage(draft) {
      if (!draft || draft.kind !== 'event') { _askToast('Copy this one and paste it where you need it.', 'info'); return false; }
      _askCloseSheet();
      if (typeof showEventPage === 'function') showEventPage(draft.targetId, 'messages');
      let tries = 0;
      (function fill() {
        const el = document.getElementById('providerMsgInput');
        if (el) { el.value = draft.body; try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} el.focus(); return; }
        if (++tries < 12) setTimeout(fill, 200);
      })();
      return true;
    }
    // Review and send by email. For a lead that was still new, offers the move to Contacted afterwards.
    async function _askReviewSend(draft) {
      if (!_askIsManager(_askRole())) { _askToast('Only the owner and admins send email from Ask. Copy the text instead.', 'info'); return false; }
      const t = _askTargetEmail(_askAlias(draft.kind === 'event' ? 'E' : draft.kind === 'lead' ? 'L' : 'C', draft.targetId));
      if (!t) { _askToast('That record is gone.', 'warning'); return false; }
      const r = await _askSendEmail(t.email, t.name, draft.subject || 'Re: your inquiry', draft.body);
      if (!r.ok) return false;
      _askDraftRemove(draft.id);
      if (draft.kind === 'lead') {
        const lead = _askFindLead(draft.targetId);
        if (lead && (lead.status || 'new') === 'new') {
          const v = _askValidateProposal({ action: 'move_lead_stage', args: { lead: _askAlias('L', lead.id), stage: 'contacted' } });
          if (v.ok) { _askS().thread.push({ role: 'ai', text: 'Sent. Want to mark this lead as contacted?', cards: [Object.assign({ kind: 'proposal', state: 'open' }, v.card)] }); }
        }
      }
      return true;
    }

    // ── Config from the Worker (GET /config) ─────────────────────────────────
    // Everyone gets their own cap, usage today and visibility. Master also gets the full config and every person's usage.
    function _askNormalizeConfig(d) {
      const o = { role: d && d.role || '', cap: null, used: 0, left: null, perms: null, modes: Array.isArray(d && d.modes) ? d.modes : null, resetLocal: d && d.resetLocal || '' };
      if (d && typeof d.cap === 'number') o.cap = d.cap;
      if (d && typeof d.used === 'number') o.used = d.used;
      if (d && typeof d.left === 'number') o.left = d.left;
      else if (o.cap !== null) o.left = Math.max(0, o.cap - o.used);
      if (d && d.perms && typeof d.perms === 'object') { o.perms = {}; _askSections().forEach(k => { if (typeof d.perms[k] === 'boolean') o.perms[k] = d.perms[k]; }); }
      return o;
    }
    async function _askConfigFetch(url, token, method, body, fetchFn) {
      if (!url || !_askPinned(url)) return { error: 'nolink', message: _askMsg('nolink') };
      if (!token) return { error: 'auth', message: _askMsg('auth') };
      let r;
      try {
        r = await fetchFn(url + '/config', { method: method, headers: Object.assign({ 'Authorization': 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      } catch (e) { return { error: 'network', message: _askMsg('network') }; }
      let data = null; try { data = await r.json(); } catch (e) { data = null; }
      const code = data && typeof data.error === 'string' ? data.error : '';
      if (r.status === 401 || code === 'auth') return { error: 'auth', message: _askMsg('auth') };
      if (r.status === 403 && code === 'origin') return { error: 'origin', message: _askMsg('origin') };
      if (r.status === 403) return { error: 'forbidden', message: _askMsg('forbidden') };
      if (!r.ok) return { error: 'other', message: (r.status === 400 && data && typeof data.message === 'string' && /\s/.test(data.message)) ? data.message : _askMsg('other') };
      if (!data || typeof data !== 'object') return { error: 'other', message: _askMsg('other') };
      return { ok: true, data: data };
    }
    async function _askLoadConfig(force) {
      const s = _askS();
      if (!force && s.cfg && Date.now() - s.cfgAt < 5 * 60 * 1000) return { ok: true, cached: true };
      const res = await _askConfigFetch(_askUrl(), window._sbToken, 'GET', null, window.fetch.bind(window));
      if (!res.ok) { s.cfgErr = res.error; return res; }
      s.cfgErr = '';
      s.cfg = _askNormalizeConfig(res.data); s.cfgAt = Date.now();
      s.cfgFull = (res.data.config && typeof res.data.config === 'object') ? { config: res.data.config, defaults: res.data.defaults || null, usage: res.data.usage || {}, pool: res.data.pool || null } : null;
      return { ok: true };
    }
    function _askUsageText() {
      const c = _askS().cfg;
      if (!c || c.cap === null) return '';
      if (c.cap <= 0) return 'Ask is turned off for this login.';
      return c.left + ' of ' + c.cap + ' questions left today';
    }

    // ── Button, palette, init ────────────────────────────────────────────────
    function _askRefreshBtn() {
      const b = document.getElementById('askBtn');
      if (!b) return;
      b.hidden = !_askCanUse();
      const f = _askS().flags, n = f ? f.fresh.length + f.stale.length : 0;
      b.setAttribute('aria-label', n ? 'Ask, ' + n + (n === 1 ? ' lead waiting' : ' leads waiting') : 'Ask');
      if (n) b.setAttribute('data-flag', String(n)); else b.removeAttribute('data-flag');
    }
    function _askPaletteRows(q) {
      const t = String(q || '').trim();
      if (!_askCanUse() || t.length < 3) return [];
      return [{ group: 'Actions', label: 'Ask: ' + t.slice(0, 80), meta: 'Assistant', run: function () { askOpen(t, {}); } }];
    }
    // Called once from _registerPalette after the data has loaded. Safe to call again (Settings calls it after a link change).
    function _askInit() {
      if (!window._askPalReg && window.CRMUI && CRMUI.palette && CRMUI.palette.register) { window._askPalReg = true; CRMUI.palette.register(_askPaletteRows); }
      _askRefreshBtn();
      // No request is made here. The token only goes to the Worker after the person opens Ask or the Ask settings.
      if (_askCanUse()) { try { _askLeadWatch(); } catch (e) {} }
    }

    // ── Panel ────────────────────────────────────────────────────────────────
    function _askPanelHtml() {
      return '<div class="ask">' +
        '<div class="ask-chips" id="askChips" role="group" aria-label="Quick questions"></div>' +
        '<div class="ask-thread" id="askThread" role="log" aria-live="polite" aria-label="Conversation"></div>' +
        '<form class="ask-form" id="askForm" autocomplete="off">' +
          '<label class="sr-only" for="askInput">Your question</label>' +
          '<textarea class="form-textarea ask-input" id="askInput" rows="2" maxlength="500" enterkeyhint="send" placeholder="Ask about your events, money or leads"></textarea>' +
          '<div class="ask-foot"><span class="ask-usage" id="askUsage" aria-live="polite"></span><button type="submit" class="btn btn-primary ask-send" id="askSend">Ask</button></div>' +
        '</form></div>';
    }
    function _askQuickQuestions(role) {
      const p = _askPerms(role), out = [];
      if (p.money) out.push('Who owes me money?');
      if (p.events) out.push('What is on this weekend?');
      if (p.leads && role !== 'dj') out.push('Leads with no reply in 3 days');
      if (_askAllowedModes(role).indexOf('summarize') > -1 && p.events) out.push('Summarize my week');
      return out;
    }
    function _askRenderChips() {
      const el = document.getElementById('askChips'); if (!el) return;
      el.innerHTML = _askQuickQuestions(_askRole()).map(q => '<button type="button" class="ask-chip" data-ask="chip" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('');
    }
    function _askRenderUsage() {
      const el = document.getElementById('askUsage'); if (el) el.textContent = _askUsageText();
    }
    function _askCardHtml(card, i, j) {
      const at = ' data-i="' + i + '" data-j="' + j + '"';
      const btn = (act, label, cls, extra) => '<button type="button" class="btn ' + (cls || 'btn-secondary') + ' btn-sm ask-btn" data-ask="' + act + '"' + at + (extra || '') + '>' + esc(label) + '</button>';
      if (card.state === 'done') return '<div class="ask-card is-done"><p class="ask-card-text">' + esc(card.sentence || card.rule && 'Rule added, switched off.' || 'Done.') + '</p><p class="ask-card-state">Done.</p></div>';
      if (card.state === 'skipped') return '<div class="ask-card is-skipped"><p class="ask-card-state">Skipped.</p></div>';
      if (card.kind === 'proposal') {
        return '<div class="ask-card"><p class="ask-card-text">' + esc(card.sentence) + '</p>' +
          (card.showBody ? '<p class="ask-card-body">' + esc(card.subject ? 'Subject: ' + card.subject + '\n\n' + card.showBody : card.showBody) + '</p>' : '') +
          '<div class="ask-card-actions">' + btn('confirm', card.ownConfirm ? 'Review and send' : 'Confirm', 'btn-primary') + btn('skip', 'Skip') + '</div></div>';
      }
      if (card.kind === 'draft') {
        const d = card.draft, canSend = _askIsManager(_askRole());
        return '<div class="ask-card ask-draft"><p class="ask-card-text">Draft for ' + esc(d.label) + (d.channel === 'portal' ? ' (portal message)' : ' (email)') + '</p>' +
          (d.subject ? '<p class="ask-card-sub">Subject: ' + esc(d.subject) + '</p>' : '') +
          '<p class="ask-card-body">' + esc(d.body) + '</p>' +
          '<div class="ask-card-actions">' + btn('copy', 'Copy') + (d.kind === 'event' ? btn('use', 'Use in message') : '') + (canSend && d.channel === 'email' ? btn('send', 'Review and send', 'btn-primary') : '') + btn('skip', 'Dismiss', 'btn-ghost') + '</div></div>';
      }
      if (card.kind === 'rule') {
        let s = ''; try { s = (typeof _autoSentence === 'function') ? _autoSentence(card.rule) : (card.rule.label || card.rule.name || ''); } catch (e) { s = card.rule.label || card.rule.name || ''; }
        return '<div class="ask-card"><p class="ask-card-text">' + esc(s) + '</p>' + (card.rule.emailBody ? '<p class="ask-card-body">' + esc((card.rule.subject ? 'Subject: ' + card.rule.subject + '\n\n' : '') + card.rule.emailBody) + '</p>' : '') + '<p class="ask-card-sub">It is added switched off. You turn it on in Automations.' + (card.rule.marketing ? ' It counts as marketing email, so it skips anyone who opted out.' : '') + '</p>' +
          '<div class="ask-card-actions">' + btn('rule', 'Add as off', 'btn-primary') + btn('skip', 'Skip') + '</div></div>';
      }
      if (card.kind === 'campaign') {
        const c = card.campaign, aud = { all: 'All clients', booked: 'Booked events', completed: 'Past clients' }[c.audience] || c.audience;
        return '<div class="ask-card"><p class="ask-card-text">Campaign draft: ' + esc(c.name) + ' for ' + esc(aud) + '.</p>' +
          '<p class="ask-card-body">' + esc(c.message) + '</p><p class="ask-card-sub">It opens in the campaign composer. You save it and send it yourself.</p>' +
          '<div class="ask-card-actions">' + c.subjects.map((sub, k) => btn('campaign', 'Use: ' + (sub.length > 40 ? sub.slice(0, 40) + '...' : sub), k === 0 ? 'btn-primary' : 'btn-secondary', ' data-s="' + k + '"')).join('') + btn('skip', 'Skip', 'btn-ghost') + '</div></div>';
      }
      return '';
    }
    function _askRenderThread() {
      const el = document.getElementById('askThread'); if (!el) return;
      const s = _askS();
      const html = s.thread.map((m, i) => {
        if (m.role === 'user') return '<div class="ask-msg ask-me"><p class="ask-text">' + esc(m.text) + '</p></div>';
        let h = '<div class="ask-msg ask-ai' + (m.error ? ' is-error' : '') + '">';
        if (m.text) h += '<p class="ask-text">' + esc(m.text) + '</p>';
        if (m.rows && m.rows.length) h += '<div class="ask-rows">' + m.rows.map((r, k) => '<button type="button" class="btn btn-ghost btn-sm ask-btn" data-ask="open" data-i="' + i + '" data-k="' + k + '">Open ' + esc(r.label) + '</button>').join('') + '</div>';
        (m.cards || []).forEach((c, j) => { h += _askCardHtml(c, i, j); });
        if (m.skipped) h += '<p class="ask-note">' + m.skipped + (m.skipped === 1 ? ' suggestion' : ' suggestions') + ' did not match your records and was left out.</p>';
        if (m.local) h += '<p class="ask-note">Answered from your CRM. No AI used.</p>';
        return h + '</div>';
      }).join('');
      el.innerHTML = html + (s.busy ? '<div class="ask-msg ask-ai ask-busy" role="status"><p class="ask-text">Thinking</p></div>' : '');
      el.scrollTop = el.scrollHeight;
      const send = document.getElementById('askSend'); if (send) { send.disabled = !!s.busy; if (s.busy) send.setAttribute('aria-busy', 'true'); else send.removeAttribute('aria-busy'); }
    }
    function _askOpenRecord(r) {
      _askCloseSheet();
      if (!r) return;
      if (r.kind === 'event' && typeof navigateToEvent === 'function') navigateToEvent(r.id);
      else if (r.kind === 'invoice' && typeof _openInvoiceRecord === 'function') { const inv = _askFindInvoice(r.id); if (inv) _openInvoiceRecord(inv); }
      else if (r.kind === 'lead' && typeof showSection === 'function') { showSection('pipeline'); setTimeout(function () { if (typeof openInquiry === 'function') openInquiry(r.id); }, 400); }
      else if (r.kind === 'client' && typeof openClientDetail === 'function') openClientDetail(r.id);
    }
    // Delegated click handler for chips and cards.
    async function _askPanelClick(e) {
      const b = e.target && e.target.closest ? e.target.closest('[data-ask]') : null;
      if (!b) return;
      const s = _askS(), act = b.getAttribute('data-ask');
      if (act === 'chip') { askSend(b.getAttribute('data-q') || ''); return; }
      const m = s.thread[+b.getAttribute('data-i')];
      if (!m) return;
      if (act === 'open') { const r = (m.rows || [])[+b.getAttribute('data-k')]; _askOpenRecord(r && r.open); return; }
      const card = (m.cards || [])[+b.getAttribute('data-j')];
      if (!card || card.state !== 'open' || card.busy) return;
      if (act === 'skip') { card.state = 'skipped'; if (card.kind === 'draft') _askDraftRemove(card.draft.id); _askRenderThread(); return; }
      if (act === 'copy') { _askCopy((card.draft.subject ? card.draft.subject + '\n\n' : '') + card.draft.body); return; }
      if (act === 'use') { _askUseInMessage(card.draft); return; }
      card.busy = true;
      let ok = false;
      try {
        if (act === 'confirm') ok = await _askRunCard(card);
        else if (act === 'send') ok = await _askReviewSend(card.draft);
        else if (act === 'rule') ok = await _askRunRule(card);
        else if (act === 'campaign') { ok = _askRunCampaign(card, +b.getAttribute('data-s')); }
      } catch (err) { ok = false; _askToast('That did not work. Nothing was changed.', 'error'); }
      card.busy = false;
      if (ok) card.state = 'done';
      _askRenderThread();
    }
    function askOpen(q, opts) {
      opts = opts || {};
      if (!_askUrl()) { _askToast(_askMsg('nolink'), 'warning'); return null; }
      if (!(window.CRMUI && CRMUI.sheet)) return null;
      let d = document.getElementById('askSheet');
      if (!d || !d.open) {
        d = CRMUI.sheet({ id: 'askSheet', drawer: true, title: 'Ask', html: _askPanelHtml(), onClose: function () { _askS().open = false; } });
        _askS().open = true;
        if (d) {
          d.addEventListener('click', _askPanelClick);
          const form = d.querySelector('#askForm'), input = d.querySelector('#askInput');
          if (form) form.addEventListener('submit', function (ev) { ev.preventDefault(); const v = input.value; input.value = ''; askSend(v); });
          if (input) input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const v = input.value; input.value = ''; askSend(v); } });
        }
      }
      _askRenderChips(); _askRenderThread(); _askRenderUsage();
      _askLoadConfig(false).then(function () { _askRenderChips(); _askRenderUsage(); }, function () {});
      if (q) askSend(q, opts);
      else { const i = document.getElementById('askInput'); if (i) i.focus(); }
      return d;
    }
    // One question. opts: { mode, focus: { kind, id } }.
    async function askSend(text, opts) {
      opts = opts || {};
      const s = _askS();
      if (s.busy) return;
      const q = _askOne(String(text || '').replace(/[\u0000-\u001f]/g, ' '), 500);
      if (!q) { _askToast(_askMsg('empty'), 'info'); return; }
      const role = _askRole();
      s.thread.push({ role: 'user', text: q });
      const route = _askRoute(q, { role: role, forceMode: opts.mode });
      if (route.type === 'local') {
        const r = _askLocalAnswer(route.intent, { role: role, days: route.days });
        s.thread.push({ role: 'ai', text: r.answer, rows: r.rows || [], local: !r.denied });
        _askRenderThread(); return;
      }
      if (route.type === 'denied') { s.thread.push({ role: 'ai', text: route.message, error: true }); _askRenderThread(); return; }
      if (!_askUrl()) { s.thread.push({ role: 'ai', text: _askMsg('nolink'), error: true }); _askRenderThread(); return; }
      const payload = _askBuildRequest(route.mode, q, opts.focus || null, {});
      s.busy = true; _askRenderThread();
      let ctl = null, timer = null;
      try { ctl = new AbortController(); timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 45000); } catch (e) { ctl = null; }
      let res;
      try { res = await _askRequest(_askUrl(), window._sbToken, payload, window.fetch.bind(window), ctl ? ctl.signal : undefined); }
      catch (e) { res = { error: 'other', message: _askMsg('other') }; }
      if (timer) clearTimeout(timer);
      s.busy = false;
      if (!res.ok) {
        if (res.usage && s.cfg) { s.cfg.used = res.usage.used; s.cfg.cap = res.usage.cap; s.cfg.left = res.usage.left; }
        s.thread.push({ role: 'ai', text: res.message, error: true });
      } else {
        const h = _askHandleResponse(res.data, { role: role });
        if (h.usage && typeof h.usage.cap === 'number') { s.cfg = Object.assign(s.cfg || {}, { cap: h.usage.cap, used: h.usage.used, left: h.usage.left }); }
        s.thread.push({ role: 'ai', text: h.text, cards: h.cards, skipped: h.skipped });
        s.history.push({ q: q, a: h.text }); if (s.history.length > 2) s.history = s.history.slice(-2);
      }
      _askRenderThread(); _askRenderUsage();
    }

    // ── Contextual entry points ──────────────────────────────────────────────
    function _askCanDraft() { return _askCanUse() && _askAllowedModes(_askRole()).indexOf('draft') > -1; }
    function _askLeadButton(id) {
      if (!_askCanDraft() || !_askPerms().leads) return '';
      return '<button type="button" class="btn btn-secondary ask-draft-btn" data-id="' + esc(id) + '" onclick="askDraftLead(this.getAttribute(\'data-id\'))">Draft reply</button>';
    }
    function _askMsgButton(eventId) {
      if (!_askCanDraft()) return '';
      return '<button type="button" class="btn btn-ghost ask-draft-btn" data-id="' + esc(eventId) + '" onclick="askDraftEvent(this.getAttribute(\'data-id\'))">Draft with Ask</button>';
    }
    // One tap, one question. A saved draft for the same record is shown again instead of asking twice.
    function _askDraftFlow(kind, id, question) {
      _askCloseLeadSheet();
      const existing = _askDraftFor(kind, id);
      const d = askOpen('', {});
      if (!d) return;
      if (existing) { _askS().thread.push({ role: 'ai', text: 'You already have a draft saved for this one.', cards: [{ kind: 'draft', draft: existing, state: 'open' }] }); _askRenderThread(); return; }
      askSend(question, { mode: 'draft', focus: { kind: kind, id: id } });
    }
    function _askCloseLeadSheet() { try { if (typeof closeModal === 'function' && document.getElementById('eventDetailModal') && document.getElementById('eventDetailModal').classList.contains('active')) closeModal('eventDetailModal'); } catch (e) {} }
    function askDraftLead(id) { _askDraftFlow('lead', id, 'Draft a first reply to this lead.'); }
    function askDraftEvent(id) { _askDraftFlow('event', id, 'Draft a short reply to the latest message from the client.'); }
    // Home hook: adds a quiet "Draft reply" next to each new-inquiry row in Needs me.
    function _askHomeHook() {
      if (!_askCanDraft() || !_askPerms().leads) return;
      const rows = document.querySelectorAll('#homeNeeds [data-needs="inquiry"][data-inq]');
      Array.prototype.forEach.call(rows, function (row) {
        const trail = row.querySelector('.row-trail');
        if (!trail || trail.querySelector('.ask-draft-btn')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-ghost btn-sm ask-draft-btn'; b.textContent = 'Draft reply';
        const id = row.getAttribute('data-inq');
        b.addEventListener('click', function () { askDraftLead(id); });
        trail.insertBefore(b, trail.firstChild);
      });
    }

    // ── One-time migration: switch off the seed rule auto1 ───────────────────
    // The website already sends a thank-you (contact_thankyou), so auto1 could send a second one. Runs once, only for master or admin,
    // changes only enabled on the rule with id auto1 (key and label stay), and never turns it off again after the owner switches it back on.
    function _askMigrateAuto1() {
      if (!_askIsManager(String(_askUser().role || '').toLowerCase())) return { skipped: 'role' };
      const raw = getDB('settings');
      const st = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
      if (st.migrations && st.migrations.auto1Off2026) return { skipped: 'done' };
      const rules = getDB('automations');
      if (!Array.isArray(rules) || !rules.length) return { skipped: 'no rules' };
      const r = rules.find(x => x && x.id === 'auto1');
      let changed = false;
      if (r && r.enabled !== false) { r.enabled = false; setDB('automations', rules); changed = true; }
      st.migrations = Object.assign({}, st.migrations || {}, { auto1Off2026: true });
      setDB('settings', st);
      if (changed) _askToast('Turned off the old auto-reply so new leads only get one thank-you.', 'info');
      return { changed: changed };
    }

    // ── Settings > Ask assistant (master only) ───────────────────────────────
    // The link lives in settings.assistantUrl (synced). Caps and visibility live on the Worker (KV) so they can be raised from here.
    // Inputs carry data-orig with the saved value, so the sticky Save bar can count changes the same way as the other sections.
    function _askRoleName(r) { return { master: 'Master', admin: 'Admin', 'event-architect': 'Event architect', dj: 'DJ' }[r] || r; }
    function _askSecName(k) { return { events: 'Events', money: 'Money', leads: 'Leads', clients: 'Clients', tasks: 'Tasks', thread: 'Messages' }[k] || k; }
    function _askPeople() {
      const me = _askUser(), users = getDB('users') || [], rows = [], seen = {};
      const myEmail = String(me.email || '').trim().toLowerCase();
      users.forEach(u => {
        if (!u) return;
        const uid = u.supabaseId || (myEmail && String(u.email || '').trim().toLowerCase() === myEmail ? me.id : '');
        if (!uid || seen[uid]) return;
        seen[uid] = true; rows.push({ uid: uid, name: u.name || u.email || 'Person', role: u.role || 'staff', me: uid === me.id });
      });
      if (me.id && !seen[me.id]) rows.unshift({ uid: me.id, name: me.name || 'You', role: me.role || 'master', me: true });
      return rows;
    }
    function _askSettingsBodyHtml() {
      const s = _askS(), v = s.cfgView || { state: _askUrl() ? 'loading' : 'nolink' };
      if (v.state === 'nolink') return '<p class="set-sub">Ask is switched off until the Worker link is set in ai-config.js. The daily limits and visibility settings show up here after that.</p>';
      if (v.state === 'loading') return '<p class="set-sub" role="status">Loading the limits.</p>';
      if (v.state === 'error') return '<p class="set-sub">' + esc(v.message || _askMsg('network')) + '</p><button type="button" class="btn btn-secondary" onclick="_askSettingsReload()">Try again</button>';
      const full = s.cfgFull;
      if (!full || !full.config) return '<p class="set-sub">Only the owner login can change the Ask limits.</p>';
      const cfg = full.config, defs = (full.defaults && full.defaults.caps) || {}, usage = full.usage || {};
      const roles = ['master', 'admin', 'event-architect', 'dj'];
      const num = (id, label, val, ph) => '<div class="ask-num"><label class="field-label" for="' + id + '">' + esc(label) + '</label><input type="number" class="form-input" id="' + id + '" min="0" max="200" step="1" inputmode="numeric" value="' + esc(val === undefined || val === null ? '' : val) + '" data-orig="' + esc(val === undefined || val === null ? '' : val) + '"' + (ph !== undefined ? ' placeholder="' + esc(ph) + '"' : '') + '></div>';
      let h = '<h4 class="ask-sub-h">Daily questions by role</h4><p class="set-sub">How many questions each login can ask per day. 0 turns Ask off for that role.</p><div class="ask-roles">' +
        roles.map(r => num('askCap_' + r, _askRoleName(r), cfg.caps && cfg.caps[r], defs[r])).join('') + '</div>';
      const people = _askPeople();
      h += '<h4 class="ask-sub-h">Daily questions per person</h4><p class="set-sub">Leave blank to use the role number. A number here replaces it, higher or lower. People show up once they have a CRM login.</p>' +
        '<div class="ask-people" role="table" aria-label="Daily questions per person"><div class="ask-prow ask-phead" role="row"><span role="columnheader">Person</span><span role="columnheader">Daily questions</span><span role="columnheader">Used today</span></div>' +
        people.map(p => {
          const own = cfg.userCaps && cfg.userCaps[p.uid];
          const dflt = cfg.caps && cfg.caps[p.role];
          return '<div class="ask-prow" role="row"><span role="cell" class="ask-pname"><strong>' + esc(p.name) + '</strong>' + (p.me ? ' <span class="pill pill-info pill-sm" data-ui="pill">This is you</span>' : '') + '<span class="ask-prole">' + esc(_askRoleName(p.role)) + '</span></span>' +
            '<span role="cell"><label class="sr-only" for="askUcap_' + esc(p.uid) + '">Daily questions for ' + esc(p.name) + '</label><input type="number" class="form-input" id="askUcap_' + esc(p.uid) + '" data-uid="' + esc(p.uid) + '" min="0" max="200" step="1" inputmode="numeric" value="' + esc(own === undefined ? '' : own) + '" data-orig="' + esc(own === undefined ? '' : own) + '" placeholder="' + esc(dflt === undefined ? '' : dflt) + '"></span>' +
            '<span role="cell" class="ask-used">' + esc(usage[p.uid] || 0) + '</span></div>';
        }).join('') + '</div>';
      const secs = _askSections();
      h += '<h4 class="ask-sub-h">What each role can ask about</h4><p class="set-sub">Master and admin always see everything. Client emails, phone numbers, portal passwords and tokens are never sent for any role. A DJ only ever sees events they work.</p>' +
        '<div class="ask-grid" role="table" aria-label="Visibility by role"><div class="ask-grow ask-ghead" role="row"><span role="columnheader">Role</span>' + secs.map(k => '<span role="columnheader">' + esc(_askSecName(k)) + '</span>').join('') + '</div>' +
        roles.map(r => {
          const locked = r === 'master' || r === 'admin', p = (cfg.perms && cfg.perms[r]) || _askDefaultPerms(r);
          return '<div class="ask-grow" role="row"><span role="rowheader" class="ask-grole">' + esc(_askRoleName(r)) + (locked ? '<span class="ask-prole">Always on</span>' : '') + '</span>' +
            secs.map(k => { const on = locked ? true : !!p[k]; const id = 'askPerm_' + r + '_' + k;
              return '<span role="cell" data-label="' + esc(_askSecName(k)) + '"><input type="checkbox" class="ask-check" id="' + id + '" aria-label="' + esc(_askRoleName(r) + ': ' + _askSecName(k)) + '"' + (on ? ' checked' : '') + (locked ? ' disabled' : ' data-orig="' + (on ? '1' : '0') + '"') + '></span>'; }).join('') + '</div>';
        }).join('') + '</div>';
      if (full.pool) h += '<p class="set-sub ask-pool">' + (full.pool.provider === 'claude' ? 'Claude daily allowance used today: ' + esc(full.pool.used) + ' of ' + esc(full.pool.budget) + ' tokens.' : 'Shared free allowance used today: ' + esc(full.pool.used) + ' of ' + esc(full.pool.budget) + '.') + ' This number is set in Cloudflare, not here.</p>';
      return h;
    }
    function _askSettingsPaint() { const el = document.getElementById('askCfgBody'); if (el) el.innerHTML = _askSettingsBodyHtml(); }
    // Called when the Settings screen is filled.
    function renderAskSettings() {
      const card = document.getElementById('askSettingsCard'); if (!card) return;
      const s = _askS();
      const link = _askUrl();
      card.innerHTML = '<div class="field"><span class="field-label">Worker link</span><p class="set-sub" id="setAskUrl">' + (link ? esc(link) : 'Not set') + '</p>' +
        '<span class="field-hint">Set in ai-config.js. It is part of the site files, so nobody can change it from inside the CRM. Leave it empty there to turn Ask off for everyone.</span></div>' +
        '<p class="set-sub ask-privacy">Names, event details and message text you ask about go to Cloudflare Workers AI. Emails, phone numbers, portal passwords and tokens never do.</p><div id="askCfgBody"></div>';
      if (!_askUrl()) { s.cfgView = { state: 'nolink' }; _askSettingsPaint(); return; }
      if (s.cfgFull && s.cfgFull.config) { s.cfgView = { state: 'ready' }; _askSettingsPaint(); return; }
      s.cfgView = { state: 'loading' }; _askSettingsPaint();
      _askSettingsReload();
    }
    async function _askSettingsReload() {
      const s = _askS();
      if (!_askUrl()) { s.cfgView = { state: 'nolink' }; _askSettingsPaint(); return; }
      s.cfgView = { state: 'loading' }; _askSettingsPaint();
      const r = await _askLoadConfig(true);
      s.cfgView = r.ok ? { state: 'ready' } : { state: 'error', message: r.message };
      _askSettingsPaint(); _askRecountSafe();
    }
    function _askRecountSafe() { try { if (typeof _setRecount === 'function') _setRecount(); } catch (e) {} }
    // Number of changed limit fields on screen.
    function _askSettingsDiff() {
      if (!document.getElementById('setAskUrl')) return 0;
      let n = 0;
      Array.prototype.forEach.call(document.querySelectorAll('#askCfgBody [data-orig]'), function (el) {
        if (el.type === 'checkbox') { if ((el.checked ? '1' : '0') !== el.getAttribute('data-orig')) n++; }
        else if (String(el.value || '').trim() !== String(el.getAttribute('data-orig') || '')) n++;
      });
      return n;
    }
    function _askIntOrNull(v) { const t = String(v == null ? '' : v).trim(); if (t === '') return null; const n = Number(t); return (isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 200) ? n : NaN; }
    // Returns an error message, or '' when everything on screen is fine to save.
    function _askSettingsCheck() {
      if (!document.getElementById('setAskUrl')) return '';
      let err = '';
      Array.prototype.forEach.call(document.querySelectorAll('#askCfgBody input[type="number"]'), function (el) {
        const n = _askIntOrNull(el.value);
        const isRole = /^askCap_/.test(el.id);
        if (n !== n || (isRole && n === null)) err = err || 'Daily questions must be whole numbers from 0 to 200.';
      });
      return err;
    }
    function _askCollectConfig() {
      const body = { caps: {}, userCaps: {}, perms: { 'event-architect': {}, dj: {} } };
      ['master', 'admin', 'event-architect', 'dj'].forEach(r => { const el = document.getElementById('askCap_' + r); if (el) body.caps[r] = _askIntOrNull(el.value); });
      Array.prototype.forEach.call(document.querySelectorAll('#askCfgBody input[data-uid]'), function (el) { const n = _askIntOrNull(el.value); if (n !== null) body.userCaps[el.getAttribute('data-uid')] = n; });
      ['event-architect', 'dj'].forEach(r => _askSections().forEach(k => { const el = document.getElementById('askPerm_' + r + '_' + k); if (el) body.perms[r][k] = !!el.checked; }));
      return body;
    }
    // Saves the limits to the Worker (the link itself lives in ai-config.js). Resolves to true when everything on screen was saved.
    async function _askSettingsSave() {
      if (!document.getElementById('setAskUrl') || !_askSettingsDiff()) return true;
      const s = _askS(), url = _askUrl();
      if (!url) { _askToast(_askMsg('nolink'), 'warning'); return false; }
      if (s.cfgFull && s.cfgFull.config) {
        const res = await _askConfigFetch(url, window._sbToken, 'PUT', _askCollectConfig(), window.fetch.bind(window));
        if (!res.ok) { _askToast(res.message || _askMsg('other'), 'error'); return false; }
        s.cfg = _askNormalizeConfig(res.data); s.cfgAt = Date.now();
        s.cfgFull = { config: res.data.config || s.cfgFull.config, defaults: res.data.defaults || s.cfgFull.defaults, usage: res.data.usage || s.cfgFull.usage, pool: res.data.pool || s.cfgFull.pool };
        _askToast('Ask limits saved.', 'success');
      }
      return true;
    }
