// ============================================================================
// portal-provider/30-events.js  -  events: list, event page and tabs, overview, messages, portal access, crew and gear, day-of and contract sheets, delete
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A), redesigned in UI lane P2.
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// Screen CSS lives in portal-provider/css/30-events.css (classes start with ev-).
// ============================================================================

    // ── Create / invite account (Saul's addition) ─────────────────────────
    // type: 'client' | 'vendor' | 'team'
    // person: { name, email, phone, role? }
    async function sendLoginInfo(type, person) {
      if (!person.email) { showToast('No email on record. Add one first.', 'error'); return; }

      // Generate a readable password
      const words   = ['Studio','Event','Beats','Stage','Bass','Crowd','Lights','Sound','Miami','Vibe'];
      const nums    = Math.floor(100 + Math.random() * 900);
      const pw      = words[Math.floor(Math.random()*words.length)] + nums + '!';
      const portalUrl = 'https://www.baselinestudiofl.com/' + (type === 'team' ? 'login.html' : 'portal-client.html');

      try {
        if (type === 'team') {
          // Create or link a real Supabase Auth provider account. mode 'create' never changes an existing login's password.
          const mode = person.mode === 'reset' ? 'reset' : 'create';
          const acct = await BSPortal.createProviderUser(person.email, pw, person.name, person.role || 'staff', { mode });
          if (!acct.ok) {
            showToast(mode === 'reset' ? 'Could not reset the password: ' + (acct.error || 'unknown error') : 'Could not create the account: ' + (acct.error || 'unknown error'), 'error');
            return;
          }
          if (typeof _teamLinkLogin === 'function') _teamLinkLogin(person.id, person.email, acct.userId);
          if (mode === 'create' && acct.existing) {
            // The email already had a login. It was linked and nothing about it changed, so no password goes out.
            showToast('Already has a login. Linked.', 'success');
            return;
          }
          showToast(mode === 'reset' ? 'Password reset for ' + person.email : 'Provider account created for ' + person.email, 'success');
          if (mode === 'create' && acct.created !== true) return;
          // Single provider_invite send; its result is reported separately from account creation
          const inviteRes = await BSPortal.sendEmail('provider_invite', {
            email: person.email,
            name:  person.name,
            role:  person.role || 'staff',
            password: pw
          });
          if (inviteRes.ok) {
            showToast('Invite email sent to ' + person.email, 'success');
          } else {
            showToast((mode === 'reset' ? 'Password reset' : 'Account created') + ', but the email did not send: ' + (inviteRes.error || 'unknown error'), 'warning');
          }
        } else if (type === 'client') {
          // Clients get portal-client.html access via client_invite
          const res = await BSPortal.sendEmail('client_invite', {
            email: person.email,
            clientName: person.name,
            password: pw,
            eventName: 'your event',
            eventDate: ''
          });
          // Sync credentials to both clients and events records (the emailed password must match what the portal checks)
          setClientCredentials(person.email, person.email, pw);
          if (res.ok) {
            showToast('Login info sent to ' + person.email, 'success');
          } else {
            showToast('Could not send login info: ' + (res.error || 'unknown error'), 'error');
          }
        } else {
          // Vendors never get a login. Send a short contact note instead.
          const res = await BSPortal.sendEmail('generic', {
            email: person.email,
            clientName: person.name,
            subject: 'How to reach Baseline Studio',
            body: 'Thanks for being part of the event. If you need anything on the production side, you can reach me directly at (786) 302-6056 or Baselinestudiofl@gmail.com. Call or text, whatever is easiest.\n\nYou do not need a login for anything. I will send you the event details, timing, and load-in info myself, so you will have what you need before the day.'
          });
          if (res.ok) {
            showToast('Contact note sent to ' + person.email, 'success');
          } else {
            showToast('Could not send the contact note: ' + (res.error || 'unknown error'), 'error');
          }
        }
      } catch(err) {
        showToast('Could not send: ' + (err && err.message ? err.message : 'check edge function config'), 'error');
        console.error(err);
      }
    }

    // ── D: Honest email fallback, shown on any send failure ───────────────────
    // A sheet with the message in a textarea. Copy and Open in email app both work from here.
    function showEmailFallback(email, subject, body, errorMsg) {
      if (!(window.CRMUI && typeof CRMUI.sheet === 'function')) { showToast(errorMsg || 'Could not send. Copy the text and send it yourself.', 'error'); return; }
      const old = document.getElementById('emailFallbackEl');
      if (old) { try { CRMUI.close(old, { force: true }); } catch (e) {} if (old.parentNode) old.parentNode.removeChild(old); }
      const text = String(body == null ? '' : body);
      const mailto = 'mailto:' + encodeURIComponent(email || '').replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(text);
      const html = `<p class="ev-sheet-note ev-note-warn">${_evIcon('triangle-alert', 16)}<span>${esc(errorMsg || 'Could not send. Send it yourself instead.')}</span></p>
        <div class="field"><label class="field-label" for="efbBody">To ${esc(email || 'the client')}. ${esc(subject || '')}</label><textarea class="input ev-fallback-text" id="efbBody" rows="9" readonly>${esc(text)}</textarea></div>`;
      const sheet = CRMUI.sheet({
        id: 'emailFallbackEl', title: 'Send it yourself', html,
        secondary: { label: 'Copy text', onClick: function () {
          try { navigator.clipboard.writeText(text); } catch (e) {}
          const b = sheet && sheet.querySelector('.dlg-foot .btn-secondary'); if (b) b.textContent = 'Copied';
          return false;
        } },
        primary: { label: 'Open in email app', onClick: function () { window.location.href = mailto; return false; } }
      });
    }

    // ── F: Portal credential helpers ─────────────────────────────────────────

    // THE ONLY way credentials are ever written. Never set portalPassword anywhere else.
    function setClientCredentials(clientEmail, newPortalEmail, newPassword) {
      const email = (clientEmail || '').toLowerCase();
      if (!email || !newPassword) return;
      const clients = getDB('clients') || [];
      const events  = getDB('events')  || [];
      clients.forEach(c => {
        if ((c.email || '').toLowerCase() === email) {
          c.portalEmail    = newPortalEmail || c.email;
          c.portalPassword = newPassword;
        }
      });
      events.forEach(ev => {
        const evEmail = (ev.clientEmail || ev.portalEmail || '').toLowerCase();
        if (evEmail === email) {
          ev.portalEmail    = newPortalEmail || ev.clientEmail;
          ev.portalPassword = newPassword;
        }
      });
      setDB('clients', clients);
      setDB('events',  events);
    }

    function savePortalCredentials(eventId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const newEmail = (document.getElementById('editPortalEmail')?.value || '').trim();
      const newPass  = (document.getElementById('editPortalPassword')?.value || '').trim();
      const clientEmail = ev.clientEmail || ev.portalEmail || '';
      if (newPass) {
        // Route through single write path: syncs both clients and events records
        setClientCredentials(clientEmail, newEmail || ev.portalEmail, newPass);
      } else if (newEmail) {
        ev.portalEmail = newEmail;
        setDB('events', events);
      }
      // Refresh ev reference after setClientCredentials may have updated it
      const updatedEv = (getDB('events') || []).find(e => e.id === eventId) || ev;
      window.currentEvent = updatedEv;
      showToast('Portal login saved', 'success');
      const host = document.getElementById('tabPortal');
      if (host) host.innerHTML = renderEventPortal(updatedEv);
    }

    function generateNewPortalPassword(eventId) {
      const pw = genPortalPassword();
      const el = document.getElementById('editPortalPassword');
      if (el) { el.value = pw; el.type = 'text'; }
      showToast('New password ready. Save the login to use it.', 'info');
    }

    function togglePortalDisabled(eventId, disabled) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.portalDisabled = disabled;
      setDB('events', events);
      window.currentEvent = ev;
      showToast(disabled ? 'Portal access is off for this event' : 'Portal access is on', disabled ? 'warning' : 'success');
      const host = document.getElementById('tabPortal');
      if (host) host.innerHTML = renderEventPortal(ev);
    }

    // ── K: Portal-ready notice (after event creation): a success toast with one action ──────────
    // Keeps the name and the #portalReadyNotif id. The password is never shown here.
    function showPortalReadyNotification(event) {
      const old = document.getElementById('portalReadyNotif');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      const clientFirst = ((event && event.clientName) || '').split(' ')[0] || 'your client';
      if (!(window.CRMUI && typeof CRMUI.toast === 'function')) { showToast('Portal is ready for ' + clientFirst + '.', 'success'); return; }
      const t = CRMUI.toast('Portal is ready for ' + clientFirst + '.', 'success', 20000);
      const el = t && t.el;
      if (!el) return;
      el.id = 'portalReadyNotif';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'toast-undo'; btn.textContent = 'Send portal link';
      btn.addEventListener('click', async function () {
        btn.disabled = true; btn.textContent = 'Sending';
        try { await sendPortalInvite(event.id); } finally { if (t.dismiss) t.dismiss(); }
      });
      el.appendChild(btn);
    }

    // ============================================================================
    //  Shared helpers for the events screens (all start with _ev)
    // ============================================================================
    function _evIcon(name, size) {
      return (window.CRMUI && typeof CRMUI.icon === 'function') ? CRMUI.icon(name, size || 16) : '';
    }
    function _evDateObj(s) {
      if (!s) return null;
      const d = new Date(String(s).slice(0, 10) + 'T12:00:00');
      return isNaN(d.getTime()) ? null : d;
    }
    function _evDaysUntil(s) {
      const d = _evDateObj(s);
      if (!d) return null;
      const t = new Date(); t.setHours(12, 0, 0, 0);
      return Math.round((d - t) / 86400000);
    }
    function _evRel(days) {
      if (days === null || days === undefined) return '';
      if (days === 0) return 'Today';
      if (days === 1) return 'Tomorrow';
      if (days === -1) return 'Yesterday';
      if (days > 60) return 'In ' + Math.round(days / 30) + ' months';
      if (days > 0) return 'In ' + days + ' days';
      if (days < -60) return Math.round(-days / 30) + ' months ago';
      return (-days) + ' days ago';
    }
    function _evFmtDate(s, style) {
      const d = _evDateObj(s);
      if (!d) return '';
      if (window.CRMUI && CRMUI.fmt && typeof CRMUI.fmt.date === 'function') { try { return CRMUI.fmt.date(String(s).slice(0, 10), style || 'list'); } catch (e) {} }
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function _evFmtTime(t) {
      if (!t) return '';
      if (window.CRMUI && CRMUI.fmt && typeof CRMUI.fmt.time === 'function') { try { return CRMUI.fmt.time(t); } catch (e) {} }
      return String(t);
    }
    function _evMoneyStr(n) {
      const v = Number(n) || 0;
      if (window.CRMUI && CRMUI.fmt && typeof CRMUI.fmt.money === 'function') { try { return CRMUI.fmt.money(v); } catch (e) {} }
      return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function _evFold(s) {
      if (window.CRMUI && CRMUI.norm && typeof CRMUI.norm.fold === 'function') return CRMUI.norm.fold(s);
      return String(s == null ? '' : s).toLowerCase();
    }
    function _evTs(v) {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
      const s = String(v).trim();
      if (/^\d{9,}$/.test(s)) return _evTs(Number(s));
      const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    // Local calendar date as YYYY-MM-DD (the UTC date is already tomorrow in the evening in Miami).
    function _evLocalDate(d) {
      d = d || new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function _evFirstName(ev) { return String((ev && ev.clientName) || '').trim().split(/\s+/)[0] || ''; }
    function _evGuests(ev) {
      const g = ev.guestCount != null && ev.guestCount !== '' ? ev.guestCount
        : ((ev.clientPrefs || {}).guestCount != null && (ev.clientPrefs || {}).guestCount !== '' ? (ev.clientPrefs || {}).guestCount : (ev.clientOnboarding || {}).guestCount);
      return (g === undefined || g === null || String(g).trim() === '') ? '' : String(g).trim();
    }
    // Only ever called with ids already created by the app (genId); kept simple on purpose.
    function _evA(s) { return esc(String(s == null ? '' : s)); }

    const EV_STATUS = {
      lead: ['Lead', 'info'], quote_sent: ['Quote sent', 'violet'], proposal: ['Proposal', 'warn'], negotiation: ['Negotiation', 'warn'],
      booked: ['Booked', 'ok'], confirmed: ['Confirmed', 'ok'], completed: ['Completed', 'ok'], cancelled: ['Cancelled', 'danger'], ghosted: ['Ghosted', 'neutral']
    };
    const EV_TYPE_OPTIONS = [
      ['wedding', 'Wedding'], ['quince', 'Quince/Sweet 16'], ['sweet16', 'Sweet 16'], ['mitzvah', 'Bar/Bat Mitzvah'],
      ['corporate', 'Corporate'], ['gala', 'Gala/Fundraiser'], ['birthday', 'Birthday/Private Party'], ['concert', 'Concert/Festival']
    ];
    const EV_STAGE_OPTIONS = [
      ['lead', 'Lead'], ['quote_sent', 'Quote sent'], ['proposal', 'Proposal'], ['negotiation', 'Negotiation'], ['booked', 'Booked'],
      ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['ghosted', 'Ghosted']
    ];
    function _evStatusPill(s, small) {
      const m = EV_STATUS[s] || [s ? String(s) : 'No stage', 'neutral'];
      return `<span class="pill pill-${m[1]}${small ? ' pill-sm' : ''}" data-ui="pill">${esc(m[0])}</span>`;
    }
    function _evTypeLabel(t) {
      const hit = EV_TYPE_OPTIONS.find(o => o[0] === t);
      if (hit) return hit[1];
      return t && t !== 'event' ? String(t) : 'Event';
    }
    function _evTypePill(t, small) {
      return `<span class="pill pill-neutral${small ? ' pill-sm' : ''}" data-ui="pill">${esc(_evTypeLabel(t))}</span>`;
    }

    // ── Money, contracts, readiness ─────────────────────────────────────────
    function _evInvoices(ev) { return (getDB('invoices') || []).filter(i => i && i.eventId === ev.id); }
    function _evMoney(ev, invs) {
      invs = invs || _evInvoices(ev);
      const invTotal = invs.reduce((s, i) => s + (Number(i.total) || 0), 0);
      const invPaid  = invs.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
      const base = Number(ev.basePrice) || 0;
      const total = base > 0 ? base : invTotal;
      const dep = Number(ev.depositAmount) || 0;
      const flagged = (ev.depositPaid ? dep : 0) + (ev.balancePaid ? Math.max(0, total - dep) : 0);
      const paid = Math.min(Math.max(invPaid, flagged), Math.max(total, invPaid));
      return { total: total, paid: paid, due: Math.max(0, total - paid), invs: invs, invTotal: invTotal, invPaid: invPaid };
    }
    function _evDocSigned(d) {
      return !!(d && (d.clientSignature || d.clientSignedAt));
    }
    function _evContractDocs(ev) {
      return (ev.docs || []).filter(d => d && (/agreement|contract/i.test(d.name || '') || /^tpl-contract-/.test(d.templateId || '')));
    }
    function _evHasQuote(ev, invs) {
      invs = invs || _evInvoices(ev);
      return (ev.quotes || []).length > 0 || invs.length > 0 || !(['lead', '', undefined, null].includes(ev.status));
    }
    function _evCrewList(ev) {
      const roster = getDB('staffroster') || [];
      const users = getDB('users') || getDB('accounts') || [];
      const out = [];
      const seen = new Set();
      const add = (name, role) => { const k = String(name || '').toLowerCase(); if (!name || seen.has(k)) return; seen.add(k); out.push({ name: name, role: role || '' }); };
      (ev.assignedAccounts || []).forEach(uid => {
        const s = roster.find(p => p.id === uid);
        if (s) { add(s.name, s.title); return; }
        const u = users.find(p => p.id === uid);
        if (u) add(u.name, _evRoleLabel(u.role));
      });
      (ev.staff || []).forEach(uid => { const u = users.find(p => p.id === uid); if (u) add(u.name, _evRoleLabel(u.role)); });
      (Array.isArray(ev.assignedTeam) ? ev.assignedTeam : []).forEach(m => { if (m && m.name) add(m.name, m.role); });
      return out;
    }
    function _evRoleLabel(r) {
      const map = { master: 'Owner', admin: 'Admin', dj: 'DJ', 'event-architect': 'Event manager', staff: 'Staff' };
      return map[r] || (r ? String(r) : '');
    }
    // Four readiness states. Each is 'ok', 'part' or 'none'.
    function _evReadiness(ev, invs) {
      invs = invs || _evInvoices(ev);
      const m = _evMoney(ev, invs);
      const cdocs = _evContractDocs(ev);
      const con = cdocs.some(_evDocSigned) ? 'ok' : (cdocs.length ? 'part' : 'none');
      const pay = (m.total > 0 && m.due <= 0) ? 'ok' : (m.paid > 0 ? 'part' : 'none');
      let any = false;
      try { any = typeof _cpData === 'function' ? !!_cpData(ev).any : false; } catch (e) {}
      const frm = ev.onboardingComplete ? 'ok' : (any ? 'part' : 'none');
      const n = (ev.timeline || []).length;
      const tml = n >= 3 ? 'ok' : (n > 0 ? 'part' : 'none');
      return { con: con, pay: pay, frm: frm, tml: tml, money: m };
    }
    const EV_READY_META = {
      con: { abbr: 'CON', tab: 'documents', words: { ok: 'Contract signed', part: 'Contract unsigned', none: 'No contract' } },
      pay: { abbr: 'PAY', tab: 'invoices',  words: { ok: 'Paid in full', part: 'Partly paid', none: 'Nothing paid' } },
      frm: { abbr: 'FRM', tab: 'plan',      words: { ok: 'Details in', part: 'Details started', none: 'No details yet' } },
      tml: { abbr: 'TML', tab: 'timeline',  words: { ok: 'Timeline set', part: 'Timeline started', none: 'No timeline' } }
    };
    function _evStateIcon(state) { return state === 'ok' ? 'check' : (state === 'part' ? 'clock' : 'circle'); }

    // ── Next steps and the one primary action ───────────────────────────────
    function _evDepositAmount(ev) {
      const dep = Number(ev.depositAmount) || 0;
      if (dep > 0) return dep;
      let pct = 50;
      try { if (typeof BSContracts !== 'undefined') pct = BSContracts.getTerms(getDB('settings')).depositPercent || 50; } catch (e) {}
      return Math.round((Number(ev.basePrice) || 0) * pct) / 100;
    }
    function _evBalanceDueDays(ev) {
      let due = 14;
      try { if (typeof BSContracts !== 'undefined') due = BSContracts.getTerms(getDB('settings')).balanceDueDays; } catch (e) {}
      const d = _evDaysUntil(ev.date);
      return d === null ? null : d - due;
    }
    function _evFnTakesPrefill(fn) {
      try { return typeof fn === 'function' && (fn.length >= 2 || /prefill|opts/.test(Function.prototype.toString.call(fn).slice(0, 220))); } catch (e) { return false; }
    }
    const EV_PRIMARY_KEYS = ['quote', 'contract', 'deposit', 'balance', 'dayof'];
    function _evNextSteps(ev) {
      const id = _evA(ev.id);
      const out = [];
      const closed = ['completed', 'cancelled', 'ghosted'].indexOf(ev.status) > -1 || !!ev.archived;
      if (closed) return { steps: out, primary: null, closed: true };
      const invs = _evInvoices(ev);
      const money = _evMoney(ev, invs);
      const days = _evDaysUntil(ev.date);
      const first = _evFirstName(ev) || 'The client';
      const hasQuote = _evHasQuote(ev, invs);
      const live = ['booked', 'confirmed', 'negotiation'].indexOf(ev.status) > -1;
      if (!hasQuote) {
        out.push({ k: 'quote', icon: 'send', label: 'Send quote', text: 'No quote has gone out yet.', run: "openQuoteBuilderModal('" + id + "',{fromEvent:true})" });
      } else {
        const cdocs = _evContractDocs(ev);
        const signed = cdocs.some(_evDocSigned);
        if (!cdocs.length) out.push({ k: 'contract', icon: 'file-signature', label: 'Create contract', text: 'The quote is out. Next is the contract.', run: "openContractSheet('" + id + "')" });
        else if (!signed) out.push({ k: 'contract', icon: 'file-signature', label: 'Resend contract', text: (cdocs[0].name || 'The contract') + ' is waiting on a signature.', run: "openContractSheet('" + id + "')" });
        const depPaidInv = invs.some(i => i.status === 'paid' && (i.lines || []).some(l => /deposit/i.test(l.desc || '')));
        const depInv = invs.some(i => (i.lines || []).some(l => /deposit/i.test(l.desc || '')));
        const depAmt = _evDepositAmount(ev);
        const depPending = !ev.depositPaid && !depPaidInv && depAmt > 0 && !depInv;
        if (depPending) out.push({ k: 'deposit', icon: 'receipt', label: 'Send deposit invoice', text: 'The ' + _evMoneyStr(depAmt) + ' deposit has not come in yet.', run: "evSendDeposit('" + id + "')" });
        const today = _evLocalDate();
        const overdue = invs.filter(i => i.status !== 'paid' && i.dueDate && String(i.dueDate).slice(0, 10) < today)
          .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
        const balDays = _evBalanceDueDays(ev);
        if (overdue) {
          out.push({ k: 'balance', icon: 'receipt', label: 'Send balance reminder', text: (overdue.invoiceNum || 'An invoice') + ' was due ' + _evFmtDate(overdue.dueDate, 'short') + '. Send a reminder.', run: "evSendBalance('" + id + "')" });
        } else if (!depPending && money.due > 0 && balDays !== null && balDays <= 30) {
          const when = balDays < 0 ? 'was due' : 'is due';
          out.push({ k: 'balance', icon: 'receipt', label: 'Send balance reminder', text: 'The balance of ' + _evMoneyStr(money.due) + ' ' + when + ' ' + _evFmtDate(_evLocalDate(new Date(Date.now() + balDays * 86400000)), 'short') + '.', run: "evSendBalance('" + id + "')" });
        }
      }
      if (days !== null && days >= 0 && days <= 7) {
        out.push({ k: 'dayof', icon: 'calendar-check', label: 'Open day-of sheet', text: days === 0 ? 'The event is today.' : 'The event is in ' + days + (days === 1 ? ' day.' : ' days.'), run: "openDayOfSheet('" + id + "')" });
      }
      if (live && !ev.onboardingComplete) out.push({ k: 'details', icon: 'mail', label: 'Send portal link', text: first + ' has not finished their event details.', run: "sendPortalInvite('" + id + "')" });
      if (live && !(ev.timeline || []).length) out.push({ k: 'timeline', icon: 'clock', label: 'Build timeline', text: 'No timeline yet.', run: "evGoTab('timeline')" });
      if (live && !_evCrewList(ev).length) out.push({ k: 'crew', icon: 'users', label: 'Assign crew', text: 'No crew is assigned.', run: "openCrewAssign('" + id + "')" });
      const primary = out.find(s => EV_PRIMARY_KEYS.indexOf(s.k) > -1) || null;
      return { steps: out, primary: primary, closed: false };
    }
    function evGoTab(tab) {
      const btn = document.querySelector('#detailContent .tab-btn[onclick*="\'' + tab + '\'"]');
      if (btn) btn.click();
    }
    function evSendDeposit(eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev) return;
      if (typeof openCreateInvoiceFromEvent !== 'function') { showToast('Invoices are not available right now.', 'error'); return; }
      if (_evFnTakesPrefill(openCreateInvoiceFromEvent)) openCreateInvoiceFromEvent(eventId, { deposit: true, amount: _evDepositAmount(ev), label: 'Deposit' });
      else openCreateInvoiceFromEvent(eventId);
    }
    function evSendBalance(eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev) return;
      const unpaid = _evInvoices(ev).filter(i => i.status !== 'paid').sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
      if (unpaid.length) {
        const inv = unpaid[0];
        if (typeof sendInvoiceConfirm === 'function') { sendInvoiceConfirm(inv.id, { reminder: true }); return; }
        if (typeof sendInvoice === 'function') {
          _evConfirm({ title: 'Send a reminder to ' + (inv.clientEmail || ev.clientName || 'the client') + '?', body: 'Invoice ' + (inv.invoiceNum || '') + ' for ' + _evMoneyStr(inv.total) + '. It goes out now.', confirmLabel: 'Send reminder' })
            .then(yes => { if (yes) sendInvoice(inv.id, { reminder: true }); });
        }
        return;
      }
      if (typeof openCreateInvoiceFromEvent === 'function') openCreateInvoiceFromEvent(eventId);
    }
    // A confirm that carries the id the harness and tests look for.
    function _evConfirm(opts) {
      if (!(window.CRMUI && typeof CRMUI.confirm === 'function')) return Promise.resolve(true);
      const p = CRMUI.confirm(opts);
      const dlgs = document.querySelectorAll('dialog.dlg-confirm');
      const d = dlgs[dlgs.length - 1];
      if (d) d.id = 'crmConfirm';
      return p;
    }

    // ============================================================================
    //  Events list
    // ============================================================================
    const EV_VIEWS = [['upcoming', 'Upcoming'], ['month', 'This month'], ['attention', 'Needs attention'], ['past', 'Past'], ['all', 'All']];
    function _evUiState() {
      if (!window._evState) {
        let compact = false;
        try { compact = window.localStorage.getItem('bs_ev_compact') === '1'; } catch (e) {}
        window._evState = { view: 'upcoming', compact: compact, filters: false };
      }
      return window._evState;
    }
    function _evClosedStatus(s) { return ['completed', 'cancelled', 'ghosted'].indexOf(s) > -1; }
    // Why an event needs attention, or ''. Only open (not closed, not archived) events qualify.
    function _evAttention(ev, ready, days) {
      if (_evClosedStatus(ev.status) || ev.archived) return '';
      const today = _evLocalDate();
      if (ready.money.invs.some(i => i.status !== 'paid' && i.dueDate && String(i.dueDate).slice(0, 10) < today)) return 'Overdue balance';
      const unread = (ev.messages || []).some(m => m.from === 'client' && !m.read);
      if (unread) return 'Unread message';
      if (days !== null && days >= 0 && days <= 14) {
        if (ready.con !== 'ok') return 'Contract not signed';
        if (ready.tml === 'none') return 'No timeline';
      }
      return '';
    }
    function _evEnsureListShell() {
      const sec = document.getElementById('events');
      if (!sec || sec.getAttribute('data-p2') === '1') return;
      // Keep the real controls (boot code listens on them), move them into the new layout.
      const search = document.getElementById('eventsSearch');
      const typeSel = document.getElementById('eventTypeFilter');
      const statusSel = document.getElementById('eventStatusFilter');
      const arch = document.getElementById('showArchivedToggle');
      const archLabel = arch ? arch.closest('label') : null;
      sec.setAttribute('data-p2', '1');
      sec.innerHTML = `
        <div class="ev-views" id="evViews" role="tablist" aria-label="Event views"></div>
        <div class="ev-tools">
          <div class="input-wrap input-search ev-search" id="evSearchSlot">${_evIcon('search', 18)}</div>
          <button type="button" class="btn btn-secondary ev-filter-btn" id="evFilterBtn" aria-expanded="false" aria-controls="evFilters" onclick="evToggleFilters()">${_evIcon('filter', 16)}<span>Filters</span></button>
          <div class="ev-filters" id="evFilters"></div>
          <button type="button" class="btn btn-ghost btn-sm ev-compact" id="evCompactBtn" aria-pressed="false" onclick="evToggleCompact()">Compact rows</button>
        </div>
        <div class="tbl-wrap ev-tbl-wrap" id="eventsListMount">
          <table class="tbl" id="eventsTable">
            <thead><tr>
              <th class="ev-c-date">Date</th><th>Event</th><th class="hide-tablet">Venue</th><th>Ready</th><th class="num">Balance</th><th>Status</th><th class="hide-tablet ev-c-act"><span class="sr-only">Actions</span></th>
            </tr></thead>
            <tbody id="eventsTableBody"></tbody>
          </table>
        </div>
        <div class="row-list ev-cards" id="eventsCards"></div>`;
      const slot = document.getElementById('evSearchSlot');
      if (search) { search.className = 'input'; search.setAttribute('placeholder', 'Search events or clients'); slot.appendChild(search); }
      const fl = document.getElementById('evFilters');
      if (typeSel) { typeSel.className = 'input'; fl.appendChild(typeSel); }
      if (statusSel) { statusSel.className = 'input'; fl.appendChild(statusSel); }
      if (archLabel) fl.appendChild(archLabel);
    }
    function evToggleFilters() {
      const st = _evUiState();
      st.filters = !st.filters;
      const f = document.getElementById('evFilters'), b = document.getElementById('evFilterBtn');
      if (f) f.classList.toggle('is-open', st.filters);
      if (b) b.setAttribute('aria-expanded', st.filters ? 'true' : 'false');
    }
    function evToggleCompact() {
      const st = _evUiState();
      st.compact = !st.compact;
      try { window.localStorage.setItem('bs_ev_compact', st.compact ? '1' : '0'); } catch (e) {}
      renderEvents();
    }
    function evSetView(view) {
      _evUiState().view = view;
      renderEvents();
    }
    function _evBucket(days, dateStr, view) {
      if (view === 'past' || days < 0) {
        if (view === 'all' && days < 0) return 'Past';
        const d = _evDateObj(dateStr);
        return d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'No date';
      }
      if (days === 0) return 'Today';
      if (days <= 7) return 'This week';
      const d = _evDateObj(dateStr), n = new Date();
      if (d && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()) return 'This month';
      return d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'No date';
    }
    function _evReadyChips(ready) {
      return ['con', 'pay', 'frm', 'tml'].map(k => {
        const m = EV_READY_META[k], s = ready[k];
        return `<span class="chip chip-${s === 'ok' ? 'ok' : (s === 'part' ? 'part' : 'none')} ev-rc" title="${_evA(m.words[s])}">${_evIcon(_evStateIcon(s), 12)}<span aria-hidden="true">${m.abbr}</span><span class="sr-only">${_evA(m.words[s])}</span></span>`;
      }).join('');
    }
    function _evBalanceCell(ready, ev) {
      const m = ready.money;
      if (_evClosedStatus(ev.status) && m.due <= 0) return m.total > 0 ? '<span class="ev-paid">Paid</span>' : '';
      if (m.total <= 0) return '';
      if (m.due <= 0) return '<span class="ev-paid">Paid</span>';
      return `<span class="ev-due num">${_evMoneyStr(m.due)}</span>`;
    }
    function renderEvents() {
      _evEnsureListShell();
      const st = _evUiState();
      const user = BSPortal.getCurrentUser();
      const isDj = !!(user && user.role === 'dj');
      const searchVal = document.getElementById('eventsSearch')?.value || '';
      const typeFilter = document.getElementById('eventTypeFilter')?.value || '';
      const statusFilter = document.getElementById('eventStatusFilter')?.value || '';
      const showArchived = document.getElementById('showArchivedToggle')?.checked || false;

      let events = (getDB('events') || []).slice();
      if (isDj) events = events.filter(e => (e.staff || []).includes(user.id));
      if (!showArchived) events = events.filter(e => !e.archived);
      const q = _evFold(searchVal).trim();
      if (q) events = events.filter(e => [e.name, e.clientName, e.venueName, e.clientEmail].some(v => v && _evFold(v).includes(q)));
      if (typeFilter) events = events.filter(e => e.type === typeFilter);
      if (statusFilter) events = events.filter(e => e.status === statusFilter);

      // one pass: invoices by event
      const byEvent = {};
      (getDB('invoices') || []).forEach(i => { if (i && i.eventId) (byEvent[i.eventId] = byEvent[i.eventId] || []).push(i); });
      const items = events.map(e => {
        const days = _evDaysUntil(e.date);
        const ready = _evReadiness(e, byEvent[e.id] || []);
        return { e: e, days: days, ready: ready, attn: _evAttention(e, ready, days) };
      });
      const now = new Date();
      const inMonth = it => { const d = _evDateObj(it.e.date); return !!d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && it.days >= 0 && it.e.status !== 'cancelled'; };
      const isUpcoming = it => it.days !== null && it.days >= 0 && !_evClosedStatus(it.e.status);
      const isPast = it => (it.days !== null && it.days < 0) || it.e.status === 'completed';
      const views = {
        upcoming: items.filter(isUpcoming), month: items.filter(inMonth), attention: items.filter(it => !!it.attn),
        past: items.filter(isPast), all: items
      };
      const asc = (a, b) => String(a.e.date || '9999').localeCompare(String(b.e.date || '9999'));
      const desc = (a, b) => String(b.e.date || '').localeCompare(String(a.e.date || ''));
      let list = (views[st.view] || views.upcoming).slice();
      if (st.view === 'past') list.sort(desc);
      else if (st.view === 'all') { const up = list.filter(it => it.days === null || it.days >= 0).sort(asc), past = list.filter(it => it.days !== null && it.days < 0).sort(desc); list = up.concat(past); }
      else list.sort(asc);

      // view tabs with counts
      const vt = document.getElementById('evViews');
      if (vt) vt.innerHTML = EV_VIEWS.map(v => `<button type="button" role="tab" class="ev-view${st.view === v[0] ? ' active' : ''}" aria-selected="${st.view === v[0] ? 'true' : 'false'}" onclick="evSetView('${v[0]}')">${v[1]}<span class="ev-count num">${views[v[0]].length}</span></button>`).join('');
      const cb = document.getElementById('evCompactBtn');
      if (cb) { cb.setAttribute('aria-pressed', st.compact ? 'true' : 'false'); cb.classList.toggle('is-on', st.compact); }
      const tbl = document.getElementById('eventsTable');
      if (tbl) tbl.classList.toggle('tbl-compact', st.compact);

      const filtering = !!(q || typeFilter || statusFilter);
      const emptyMsg = filtering
        ? ['No events match.', 'Try a different search or clear the filters.', 'Clear filters', 'evClearFilters()']
        : ({ upcoming: ['No upcoming events.', 'Add one or convert an inquiry.', 'New event', 'openNewEventModal()'],
             month: ['Nothing this month.', 'Events with a date in this month show up here.', 'New event', 'openNewEventModal()'],
             attention: ['Nothing needs attention.', 'Overdue balances, unsigned contracts and unread messages show up here.', '', ''],
             past: ['No past events yet.', 'Finished events show up here.', '', ''],
             all: ['No events yet.', 'Add your first one or convert an inquiry.', 'New event', 'openNewEventModal()'] }[st.view]);
      const emptyHtml = `<div class="empty">${_evIcon('calendar', 32)}<h3 class="empty-title">${emptyMsg[0]}</h3><p class="empty-text">${emptyMsg[1]}</p>${emptyMsg[2] ? `<button type="button" class="btn btn-secondary" onclick="${emptyMsg[3]}">${emptyMsg[2]}</button>` : ''}</div>`;

      const body = document.getElementById('eventsTableBody');
      const cards = document.getElementById('eventsCards');
      const canEdit = !isDj;
      if (!list.length) {
        if (body) body.innerHTML = `<tr class="tbl-empty"><td colspan="7">${emptyHtml}</td></tr>`;
        if (cards) cards.innerHTML = emptyHtml;
      } else {
        let rows = '', cardHtml = '', lastBucket = null;
        list.forEach(it => {
          const b = _evBucket(it.days === null ? 9999 : it.days, it.e.date, st.view);
          if (b !== lastBucket) {
            lastBucket = b;
            rows += `<tr class="ev-month"><td colspan="7">${esc(b)}</td></tr>`;
            cardHtml += `<div class="ev-month-card section-label">${esc(b)}</div>`;
          }
          rows += _evListRow(it, canEdit, st.view === 'attention');
          cardHtml += _evListCard(it, st.view === 'attention');
        });
        if (body) body.innerHTML = rows;
        if (cards) cards.innerHTML = cardHtml;
      }

      // page head: the one primary
      const sec = document.getElementById('events');
      const pa = document.getElementById('pageActions');
      if (pa && sec && sec.classList.contains('active')) {
        pa.innerHTML = canEdit ? `<button type="button" class="btn btn-primary" id="evNewBtn" onclick="openNewEventModal()">${_evIcon('plus', 18)}<span>New event</span></button>` : '';
      }
    }
    function evClearFilters() {
      const s = document.getElementById('eventsSearch'), t = document.getElementById('eventTypeFilter'), u = document.getElementById('eventStatusFilter');
      if (s) s.value = ''; if (t) t.value = ''; if (u) u.value = '';
      renderEvents();
    }
    function _evListRow(it, canEdit, showWhy) {
      const e = it.e, id = _evA(e.id);
      const d = _evDateObj(e.date);
      const dow = d ? d.toLocaleDateString('en-US', { weekday: 'short' }) : '';
      const day = d ? d.getDate() : '';
      return `<tr class="ev-row${e.archived ? ' is-archived' : ''}" tabindex="0" onclick="openEventDetail('${id}')" onkeydown="if(event.target===this&&event.key==='Enter'){openEventDetail('${id}')}">
        <td class="ev-c-date"><span class="ev-dow">${esc(dow)}</span> <span class="ev-day num">${day}</span><div class="t-meta">${d ? esc(_evRel(it.days)) : 'No date'}</div></td>
        <td class="ev-c-name"><div class="ev-name" data-user-content>${esc(e.name || 'Untitled event')}${e.archived ? ' <span class="pill pill-neutral pill-sm" data-ui="pill">Archived</span>' : ''}</div><div class="t-meta" data-user-content>${esc(showWhy && it.attn ? it.attn : (e.clientName || ''))}</div></td>
        <td class="hide-tablet ev-c-venue" data-user-content>${esc(e.venueName || '')}</td>
        <td class="ev-c-ready"><span class="ev-ready-row">${_evReadyChips(it.ready)}</span></td>
        <td class="num ev-c-bal">${_evBalanceCell(it.ready, e)}</td>
        <td>${_evStatusPill(e.status, false)}</td>
        <td class="hide-tablet ev-c-act"><button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Actions for ${_evA(e.name)}" onclick="event.stopPropagation();openEventRowMenu(this,'${id}')">${_evIcon('ellipsis', 18)}</button></td>
      </tr>`;
    }
    function _evListCard(it, showWhy) {
      const e = it.e, id = _evA(e.id);
      const d = _evDateObj(e.date);
      const dow = d ? d.toLocaleDateString('en-US', { weekday: 'short' }) : '';
      const sub = [e.venueName, e.startTime ? _evFmtTime(e.startTime) : ''].filter(Boolean).join(' · ');
      return `<div class="row row-event ev-card${e.archived ? ' is-archived' : ''}">
        <div class="date-block"><span class="dow">${esc(dow || 'TBD')}</span><span class="day">${d ? d.getDate() : ''}</span></div>
        <a class="row-link row-main" href="#/event/${encodeURIComponent(e.id)}" onclick="openEventDetail('${id}');return false;">
          <span class="row-title" data-user-content>${esc(e.name || 'Untitled event')}</span>
          <span class="row-sub" data-user-content>${esc(showWhy && it.attn ? it.attn : (sub || e.clientName || ''))}</span>
          <span class="ev-card-meta"><span class="ev-ready-row">${_evReadyChips(it.ready)}</span>${_evBalanceCell(it.ready, e)}</span>
        </a>
        <div class="row-trail">${_evStatusPill(e.status, true)}</div>
      </div>`;
    }
    function openEventRowMenu(btn, eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev || !(window.CRMUI && CRMUI.menu)) return;
      const user = BSPortal.getCurrentUser();
      const items = [{ label: 'Open event', icon: 'arrow-up-right', onSelect: () => openEventDetail(eventId) }];
      if (!(user && user.role === 'dj')) {
        items.push({ label: ev.archived ? 'Restore event' : 'Archive event', icon: 'package-open', onSelect: () => _evSetArchived(eventId, !ev.archived) });
        items.push({ label: 'Delete event', icon: 'trash-2', danger: true, onSelect: () => deleteEvent(eventId) });
      }
      CRMUI.menu(btn, items, { align: 'right', label: 'Event actions' });
    }
    function _evSetArchived(eventId, archive) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.archived = !!archive;
      setDB('events', events);
      if (window.currentEvent && window.currentEvent.id === eventId) window.currentEvent = ev;
      renderEvents();
      if (typeof renderPipeline === 'function') { try { renderPipeline(); } catch (e) {} }
      if (document.getElementById('detail') && document.getElementById('detail').classList.contains('active')) _evRefresh(ev);
      const name = ev.name || 'Event';
      if (archive) showUndoToast(name + ' archived.', () => _evSetArchived(eventId, false));
      else showToast(name + ' restored.', 'success');
    }

    // ============================================================================
    //  Event page: header, readiness, tabs
    // ============================================================================
    function _evBackLabel() {
      const map = { dashboard: 'Home', pipeline: 'Pipeline', events: 'Events', clients: 'Clients', invoices: 'Money' };
      const s = (typeof _detailReturnSection !== 'undefined' && _detailReturnSection) ? _detailReturnSection : 'events';
      return map[s] || (s.charAt(0).toUpperCase() + s.slice(1));
    }
    function _evMetaHtml(ev) {
      const parts = [];
      const rel = _evRel(_evDaysUntil(ev.date));
      const d = _evDateObj(ev.date);
      const sameYear = d && d.getFullYear() === new Date().getFullYear();
      parts.push(d ? esc(_evFmtDate(ev.date, sameYear ? 'list' : 'long')) : 'Date not set');
      const st = _evFmtTime(ev.startTime), en = _evFmtTime(ev.endTime);
      if (st) parts.push(esc(en ? st + ' to ' + en : st));
      if (ev.venueName) parts.push(`<span data-user-content>${esc(ev.venueName)}</span>`);
      const g = _evGuests(ev);
      if (g) parts.push(esc(g) + ' guests');
      return (rel ? `<span class="ev-rel">${esc(rel)}</span>` : '') + parts.join('<span class="ev-dot" aria-hidden="true">·</span>');
    }
    function _evReadyHtml(ev) {
      const r = _evReadiness(ev);
      const id = encodeURIComponent(ev.id);
      return ['con', 'pay', 'frm', 'tml'].map(k => {
        const m = EV_READY_META[k], s = r[k];
        return `<a class="chip chip-${s === 'ok' ? 'ok' : (s === 'part' ? 'part' : 'none')} ev-chip" href="#/event/${id}/${m.tab}">${_evIcon(_evStateIcon(s), 14)}<span>${esc(m.words[s])}</span></a>`;
      }).join('');
    }
    function _evBarInner(ev) {
      const np = _evNextSteps(ev);
      const prim = np.primary || { icon: 'message-square', label: 'Message client', run: "evGoTab('messages')" };
      return `<div class="ev-id">
          <h2 class="ev-title" data-detail-title="Event" data-user-content>${esc(ev.name || 'Untitled event')}</h2>
          <div class="ev-pills">${_evTypePill(ev.type)}${_evStatusPill(ev.status)}${ev.archived ? '<span class="pill pill-neutral" data-ui="pill">Archived</span>' : ''}</div>
        </div>
        <div class="ev-act">
          <button type="button" class="btn btn-primary detail-primary" onclick="${prim.run}">${_evIcon(prim.icon || 'send', 18)}<span>${esc(prim.label)}</span></button>
          <button type="button" class="btn btn-secondary btn-icon ev-more" aria-label="More actions" onclick="openEventMenu(this,'${_evA(ev.id)}')">${_evIcon('ellipsis', 20)}</button>
        </div>`;
    }
    function _eventHeaderHtml(ev, msgCount) {
      return `<div class="ev-crumb"><button type="button" class="btn btn-ghost ev-back" onclick="goBack()" aria-label="Back to ${_evA(_evBackLabel())}">${_evIcon('chevron-left', 20)}<span>${esc(_evBackLabel())}</span></button></div>
        <div class="ev-bar" id="evBar">${_evBarInner(ev)}</div>
        <div class="ev-sub" id="evSub"><div class="ev-meta" id="evMeta">${_evMetaHtml(ev)}</div><div class="ev-ready" id="evReady">${_evReadyHtml(ev)}</div></div>`;
    }
    function openEventMenu(btn, eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev || !(window.CRMUI && CRMUI.menu)) return;
      const call = (fn, a, b) => { if (typeof fn === 'function') fn(a, b); else showToast('That is not available right now.', 'error'); };
      CRMUI.menu(btn, [
        { label: 'Create invoice', icon: 'receipt', onSelect: () => call(openCreateInvoiceFromEvent, eventId) },
        { label: 'Build quote', icon: 'file-text', onSelect: () => call(openQuoteBuilderModal, eventId, { fromEvent: true }) },
        { label: 'Send portal link', icon: 'send', onSelect: () => sendPortalInvite(eventId) },
        { label: 'Print run of show', icon: 'printer', onSelect: () => printRunOfShow(eventId) },
        { label: ev.archived ? 'Restore event' : 'Archive event', icon: 'package-open', onSelect: () => _evSetArchived(eventId, !ev.archived) },
        { label: 'Delete event', icon: 'trash-2', danger: true, onSelect: () => deleteEvent(eventId) }
      ], { align: 'right', label: 'Event actions' });
    }
    // Re-draw the parts of the open event page that depend on event data (not the inline-edit cards).
    function _evRefresh(ev) {
      if (!ev) return;
      const bar = document.getElementById('evBar'), meta = document.getElementById('evMeta'), rd = document.getElementById('evReady');
      if (bar) bar.innerHTML = _evBarInner(ev);
      if (meta) meta.innerHTML = _evMetaHtml(ev);
      if (rd) rd.innerHTML = _evReadyHtml(ev);
      const next = document.getElementById('evNext'); if (next) next.innerHTML = _evNextCardInner(ev);
      const side = document.getElementById('evSide'); if (side) side.innerHTML = _evSideInner(ev);
      const gear = document.getElementById('tabGear'); if (gear && typeof renderEventGear === 'function') gear.innerHTML = renderEventGear(ev);
    }

    // Full-page event detail. `opts.force` re-renders even while someone is typing.
    function showEventPage(eventId, tab, opts) {
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;
      // Re-rendering the event that is already open (after a save, or a background sync) keeps its tab.
      if (tab === undefined && _route && _route.type === 'event' && String(_route.id) === String(eventId) && document.getElementById('detail').classList.contains('active')) tab = _route.tab;
      if (ROUTE_EVENT_TABS.indexOf(tab) < 0) tab = null;
      // A background sync must not wipe what someone is typing.
      if (!(opts && opts.force) && document.activeElement && document.activeElement.closest && document.activeElement.closest('#detailContent') &&
          /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && String(window.currentEvent && window.currentEvent.id) === String(eventId) &&
          document.getElementById('detail').classList.contains('active')) return;

      window.currentEvent = event;
      const safe = f => { try { return f(); } catch (e) { console.warn('[event tab]', e); return '<div class="empty"><p class="empty-text">This section could not load. Reload the page and try again.</p></div>'; } };

      const msgCount = (event.messages || []).filter(m => m.from === 'client' && !m.read).length;
      const msgBadge = msgCount ? ` <span class="ev-badge" aria-label="${msgCount} unread">${msgCount}</span>` : '';
      const header = (typeof _eventHeaderHtml === 'function') ? safe(() => _eventHeaderHtml(event, msgCount)) : '';
      const planHtml = (typeof renderEventPlanTab === 'function') ? safe(() => renderEventPlanTab(event)) : safe(() => renderEventClientPlan(event));
      const gearHtml = (typeof renderEventGear === 'function') ? safe(() => renderEventGear(event)) : '';

      const html = `<div class="detail-page ev-page" data-event-id="${esc(event.id)}">
        ${header}
        <div class="ev-tabs-wrap">
          <div class="tabs ev-tabs" role="tablist" aria-label="Event sections">
            <button class="tab-btn active" onclick="switchEventTab(this,'overview')" role="tab" aria-selected="true">Overview</button>
            <button class="tab-btn" onclick="switchEventTab(this,'plan')" role="tab" aria-selected="false">Plan</button>
            <button class="tab-btn" onclick="switchEventTab(this,'timeline')" role="tab" aria-selected="false">Timeline</button>
            <button class="tab-btn" onclick="switchEventTab(this,'invoices')" role="tab" aria-selected="false">Money</button>
            <button class="tab-btn" onclick="switchEventTab(this,'documents')" role="tab" aria-selected="false">Documents</button>
            <button class="tab-btn" onclick="switchEventTab(this,'gear')" role="tab" aria-selected="false">Crew &amp; Gear</button>
            <button class="tab-btn" onclick="switchEventTab(this,'portal')" role="tab" aria-selected="false">Portal</button>
            <button class="tab-btn" onclick="switchEventTab(this,'messages')" role="tab" aria-selected="false">Messages${msgBadge}</button>
          </div>
        </div>
        <div class="ev-body">
          <div id="tabOverview" class="tab-content active" role="tabpanel">${safe(() => renderEventOverview(event))}</div>
          <div id="tabPlan" class="tab-content" role="tabpanel">${planHtml}</div>
          <div id="tabTimeline" class="tab-content" role="tabpanel">${safe(() => renderEventTimeline(event))}</div>
          <div id="tabInvoices" class="tab-content" role="tabpanel">${safe(() => renderEventInvoices(event))}</div>
          <div id="tabDocuments" class="tab-content" role="tabpanel">${safe(() => renderEventDocuments(event))}</div>
          <div id="tabGear" class="tab-content" role="tabpanel">${gearHtml}</div>
          <div id="tabPortal" class="tab-content" role="tabpanel">${safe(() => renderEventPortal(event))}</div>
          <div id="tabMessages" class="tab-content" role="tabpanel">${safe(() => renderEventMessages(event))}</div>
        </div>
      </div>`;

      document.getElementById('detailContent').innerHTML = html;
      _showDetailSection();
      _routeWrite({ type: 'event', id: eventId, tab: tab === 'overview' ? null : tab }, 'push');
      if (tab && tab !== 'overview') _routeActivateTab(tab);
      attachWeatherChip(event);
    }

    // ── Navigate to event / client (sets return section, pushes hash) ─────
    function navigateToEvent(eventId) {
      const active = document.querySelector('.section.active');
      if (active && active.id !== 'detail') _detailReturnSection = active.id;
      showEventPage(eventId);
    }

    // Legacy: all call sites now route to the full page
    function openEventDetail(eventId) {
      navigateToEvent(eventId);
    }

    function switchEventTab(btn, tabName) {
      if (tabName === 'lighting') tabName = 'plan';   // the lighting card lives on the Plan tab now
      const detailEl = document.getElementById('detailContent');
      (detailEl || document).querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); if (b.setAttribute) b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      if (typeof btn.setAttribute === 'function') btn.setAttribute('aria-selected', 'true');
      (detailEl || document).querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
      // Re-render volatile tabs from current event so they always show fresh data
      if (window.currentEvent) {
        const _fresh = (getDB('events') || []).find(e => e.id === window.currentEvent.id) || window.currentEvent;
        if (tabName === 'portal') {
          document.getElementById('tabPortal').innerHTML = renderEventPortal(_fresh);
        }
        // Client plan is read-only: always show the latest copy of the event
        if (tabName === 'plan') {
          document.getElementById('tabPlan').innerHTML = (typeof renderEventPlanTab === 'function') ? renderEventPlanTab(_fresh) : renderEventClientPlan(_fresh);
          if (typeof _evMountLightingLazy === 'function') _evMountLightingLazy(_fresh.id);
        }
        if (tabName === 'gear' && typeof renderEventGear === 'function') {
          document.getElementById('tabGear').innerHTML = renderEventGear(_fresh);
        }
        // Mark client messages as read when Messages tab is opened. Re-read the stored event and touch only the read flags,
        // so nothing else on a stale window.currentEvent is ever written back. The Unread divider stays until the tab is drawn again.
        if (tabName === 'messages') {
          const events = getDB('events');
          const stored = events.find(e => e.id === window.currentEvent.id);
          if (stored && (stored.messages || []).some(m => m.from === 'client' && !m.read)) {
            stored.messages.forEach(m => { if (m.from === 'client') m.read = true; });
            setDB('events', events);
            (window.currentEvent.messages || []).forEach(m => { if (m.from === 'client') m.read = true; });
            // Clear the badge from the tab button
            btn.innerHTML = 'Messages';
          }
          setTimeout(() => { const t = document.getElementById('providerMsgThread'); if (t) t.scrollTop = t.scrollHeight; }, 30);
        }
      }
      // Keep the active tab in view on a narrow strip
      const tabs = btn.closest ? btn.closest('.tabs') : null;
      if (tabs && typeof tabs.scrollTo === 'function' && btn.offsetWidth) {
        tabs.scrollTo({ left: Math.max(0, btn.offsetLeft - (tabs.clientWidth - btn.offsetWidth) / 2), behavior: 'auto' });
      }
      // Tab switches rewrite the current history entry (Back should not step through tabs)
      if (window.currentEvent && _route && _route.type === 'event' && String(_route.id) === String(window.currentEvent.id)) {
        _routeWrite({ type: 'event', id: _route.id, tab: tabName === 'overview' ? null : tabName }, 'replace');
      }
    }

    // ============================================================================
    //  Overview: next steps, key facts (click to edit), side panel, activity
    // ============================================================================
    const EV_FIELDS = {
      name:    { label: 'Event name',  prop: 'name',          type: 'text',     id: 'editEventName' },
      type:    { label: 'Type',        prop: 'type',          type: 'select',   id: 'editEventType' },
      status:  { label: 'Stage',       prop: 'status',        type: 'select',   id: 'editEventStatus' },
      date:    { label: 'Date',        prop: 'date',          type: 'date',     id: 'editEventDate' },
      start:   { label: 'Start',       prop: 'startTime',     type: 'time',     id: 'editEventStartTime' },
      end:     { label: 'End',         prop: 'endTime',       type: 'time',     id: 'editEventEndTime' },
      guests:  { label: 'Guests',      prop: 'guestCount',    type: 'number',   id: 'editGuestCount' },
      venue:   { label: 'Venue',       prop: 'venueName',     type: 'text',     id: 'editVenueName' },
      client:  { label: 'Client',      prop: 'clientName',    type: 'text',     id: 'editClientName' },
      phone:   { label: 'Phone',       prop: 'clientPhone',   type: 'tel',      id: 'editClientPhone' },
      email:   { label: 'Email',       prop: 'clientEmail',   type: 'email',    id: 'editClientEmail' },
      price:   { label: 'Base price',  prop: 'basePrice',     type: 'money',    id: 'editBasePrice' },
      deposit: { label: 'Deposit',     prop: 'depositAmount', type: 'money',    id: 'editDepositAmount' },
      notes:   { label: 'Internal notes', prop: 'notes',      type: 'textarea', id: 'editEventNotes' }
    };
    function _evRaw(ev, key) {
      if (key === 'guests') return _evGuests(ev);
      const v = ev[EV_FIELDS[key].prop];
      return v === undefined || v === null ? '' : v;
    }
    function _evDisplay(ev, key) {
      const def = EV_FIELDS[key], raw = _evRaw(ev, key);
      if (raw === '' || raw === null) return '';
      if (key === 'date') return _evFmtDate(raw, 'long');
      if (key === 'start' || key === 'end') return _evFmtTime(raw);
      if (key === 'type') return _evTypeLabel(raw);
      if (key === 'status') return (EV_STATUS[raw] || [String(raw)])[0];
      if (key === 'price' || key === 'deposit') return _evMoneyStr(raw);
      if (key === 'phone') { try { if (window.CRMUI && CRMUI.fmt) return CRMUI.fmt.phone(String(raw)); } catch (e) {} }
      return String(raw);
    }
    function _evKfHtml(ev, key) {
      const def = EV_FIELDS[key];
      const shown = _evDisplay(ev, key);
      return `<button type="button" class="kf${def.type === 'textarea' ? ' kf-wide' : ''}" data-f="${key}" onclick="evEditField(this)" aria-label="${_evA(def.label)}: ${_evA(shown || 'not set')}. Edit">
        <span class="kf-l">${esc(def.label)}</span><span class="kf-v${shown ? '' : ' is-empty'}" data-user-content>${shown ? esc(shown) : 'Add'}</span>${_evIcon('pencil', 14)}</button>`;
    }
    function _evNextCardInner(ev) {
      const np = _evNextSteps(ev);
      let rows = '';
      if (np.closed) {
        rows = `<div class="ev-step is-done">${_evIcon('circle-check', 20)}<div class="ev-step-main"><div class="ev-step-text">This event is ${ev.archived ? 'archived' : _evA((EV_STATUS[ev.status] || [''])[0]).toLowerCase()}. Nothing is waiting on you.</div></div></div>`;
      } else if (!np.steps.length) {
        rows = `<div class="ev-step is-done">${_evIcon('circle-check', 20)}<div class="ev-step-main"><div class="ev-step-text">Everything for this event is in. Nothing is waiting on you.</div></div></div>`;
      } else {
        rows = np.steps.slice(0, 3).map((s, i) => `<div class="ev-step${s === np.primary ? ' is-now' : ''}">${_evIcon(s.icon || 'circle', 20)}
          <div class="ev-step-main"><div class="ev-step-text" data-user-content>${esc(s.text)}</div></div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="${s.run}">${esc(s.label)}</button></div>`).join('');
      }
      return `<div class="card-head"><h3 class="card-title">Next steps</h3></div>${rows}`;
    }
    function _evSideInner(ev) {
      const id = _evA(ev.id);
      const m = _evMoney(ev);
      const pct = m.total > 0 ? Math.min(100, Math.round(m.paid / m.total * 100)) : 0;
      const phone = ev.clientPhone ? String(ev.clientPhone) : '';
      const tel = phone.replace(/[^\d+]/g, '');
      const phoneShown = (() => { try { if (window.CRMUI && CRMUI.fmt && phone) return CRMUI.fmt.phone(phone); } catch (e) {} return phone; })();
      const crew = _evCrewList(ev);
      const addr = ev.venueAddress || '';
      const mapQ = encodeURIComponent([ev.venueName, addr].filter(Boolean).join(', '));
      return `
        <section class="card ev-client" data-section="client">
          <div class="card-head"><h3 class="card-title">Client</h3></div>
          <div class="ev-side-name" data-user-content>${ev.clientId ? `<a class="link ev-linkname" href="#/client/${encodeURIComponent(ev.clientId)}">${esc(ev.clientName || 'Client')}</a>` : esc(ev.clientName || 'No client yet')}</div>
          ${phoneShown ? `<div class="ev-side-line t-meta" data-user-content>${esc(phoneShown)}</div>` : ''}
          ${ev.clientEmail ? `<div class="ev-side-line t-meta" data-user-content>${esc(ev.clientEmail)}</div>` : ''}
          <div class="ev-side-actions">
            ${tel ? `<a class="btn btn-secondary btn-sm" href="tel:${_evA(tel)}">${_evIcon('phone', 16)}<span>Call</span></a>` : ''}
            ${ev.clientEmail ? `<a class="btn btn-secondary btn-sm" href="mailto:${_evA(ev.clientEmail)}">${_evIcon('mail', 16)}<span>Email</span></a>` : ''}
            ${(ev.clientEmail || phone) ? `<button type="button" class="btn btn-secondary btn-sm" data-copy="${_evA(ev.clientEmail || phoneShown)}" onclick="copyToClipboard(this.dataset.copy)">${_evIcon('copy', 16)}<span>Copy</span></button>` : ''}
          </div>
        </section>
        <section class="card ev-money" data-section="money">
          <div class="card-head"><h3 class="card-title">Money</h3><button type="button" class="btn btn-ghost btn-sm" onclick="evGoTab('invoices')">Open</button></div>
          <dl class="ev-money-rows">
            <div><dt>Total</dt><dd class="num">${_evMoneyStr(m.total)}</dd></div>
            <div><dt>Paid</dt><dd class="num ev-ok">${_evMoneyStr(m.paid)}</dd></div>
            <div><dt>Due</dt><dd class="num ${m.due > 0 ? 'ev-warn' : ''}">${_evMoneyStr(m.due)}</dd></div>
          </dl>
          <div class="sched-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Paid"><span style="width:${pct}%"></span></div>
          <div class="t-meta ev-money-note">${m.total > 0 ? pct + '% paid' : 'No price set yet'}</div>
        </section>
        <section class="card ev-venue" data-section="venue">
          <div class="card-head"><h3 class="card-title">Venue</h3></div>
          <div class="ev-side-name" data-user-content>${esc(ev.venueName || 'No venue yet')}</div>
          ${addr ? `<div class="ev-side-line t-meta" data-user-content>${esc(addr)}</div>` : ''}
          ${(ev.venueContact || ev.venuePhone) ? `<div class="ev-side-line t-meta" data-user-content>${esc([ev.venueContact, ev.venuePhone].filter(Boolean).join(', '))}</div>` : ''}
          ${mapQ ? `<div class="ev-side-actions"><a class="btn btn-secondary btn-sm" href="https://www.google.com/maps/search/?api=1&amp;query=${mapQ}" target="_blank" rel="noopener">${_evIcon('map-pin', 16)}<span>Open map</span></a></div>` : ''}
        </section>
        <section class="card ev-crew" data-section="crew">
          <div class="card-head"><h3 class="card-title">Crew</h3><button type="button" class="btn btn-ghost btn-sm" onclick="openCrewAssign('${id}')">${crew.length ? 'Edit' : 'Assign'}</button></div>
          ${crew.length ? crew.map(c => `<div class="ev-crew-line" data-user-content><span class="avatar avatar-24">${esc(c.name.charAt(0))}</span><span class="ev-crew-name">${esc(c.name)}</span>${c.role ? `<span class="t-meta">${esc(c.role)}</span>` : ''}</div>`).join('') : '<div class="t-meta">No crew yet.</div>'}
        </section>`;
    }
    function _evActivity(ev) {
      const items = [];
      const invs = _evInvoices(ev);
      (ev.messages || []).forEach(m => {
        const ts = _evTs(m.ts); if (!ts) return;
        const who = m.from === 'client' ? (_evFirstName(ev) || 'Client') : 'You';
        const t = String(m.text || '').replace(/\s+/g, ' ').trim();
        items.push({ ts: ts, icon: 'message-square', html: `${esc(who)} sent a message: <span data-user-content>${esc(t.length > 70 ? t.slice(0, 70) + '...' : t)}</span>` });
      });
      (ev.docs || []).forEach(d => {
        if (d.createdAt) items.push({ ts: _evTs(d.createdAt), icon: 'file-text', html: `Document created: <span data-user-content>${esc(d.name || 'Document')}</span>` });
        if (d.clientSignedAt) items.push({ ts: _evTs(d.clientSignedAt), icon: 'file-check', html: `<span data-user-content>${esc(d.clientSignedName || 'Client')}</span> signed <span data-user-content>${esc(d.name || 'a document')}</span>` });
        if (d.signedAt) items.push({ ts: _evTs(d.signedAt), icon: 'file-check', html: `You signed <span data-user-content>${esc(d.name || 'a document')}</span>` });
      });
      invs.forEach(i => {
        if (i.createdAt) items.push({ ts: _evTs(i.createdAt), icon: 'receipt', html: `Invoice ${esc(i.invoiceNum || '')} created, ${esc(_evMoneyStr(i.total))}` });
        if (i.sentAt) items.push({ ts: _evTs(i.sentAt), icon: 'send', html: `Invoice ${esc(i.invoiceNum || '')} sent` });
        if (i.paidAt) items.push({ ts: _evTs(i.paidAt), icon: 'circle-check', html: `Invoice ${esc(i.invoiceNum || '')} paid` });
      });
      const ids = new Set(invs.map(i => i.id)), nums = new Set(invs.map(i => i.invoiceNum).filter(Boolean));
      (getDB('transactions') || []).forEach(t => {
        if (!t || !(ids.has(t.invoiceId) || nums.has(t.invoiceNum) || nums.has(t.note))) return;
        const ts = _evTs(t.date || t.createdAt); if (!ts) return;
        items.push({ ts: ts, icon: 'banknote', html: `Payment received, ${esc(_evMoneyStr(t.amount))}${t.method ? ' by ' + esc(t.method) : ''}` });
      });
      (ev.quotes || []).forEach(q => { if (q.sentAt) items.push({ ts: _evTs(q.sentAt), icon: 'send', html: `Quote sent, ${esc(_evMoneyStr(q.total))}` }); });
      if (ev.portalInviteSentAt) items.push({ ts: _evTs(ev.portalInviteSentAt), icon: 'mail', html: 'Portal link sent' });
      return items.filter(i => i.ts).sort((a, b) => b.ts - a.ts);
    }
    function _evActivityHtml(ev) {
      const items = _evActivity(ev).slice(0, 8);
      if (!items.length) return `<div class="empty ev-empty-sm">${_evIcon('inbox', 32)}<p class="empty-text">Nothing yet. Sent quotes, signed documents and payments show up here.</p></div>`;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let last = '', out = '';
      items.forEach(i => {
        const d = new Date(i.ts), dd = new Date(i.ts); dd.setHours(0, 0, 0, 0);
        const diff = Math.round((today - dd) / 86400000);
        const label = diff === 0 ? 'Today' : (diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        if (label !== last) { out += `<div class="ev-day-label section-label">${esc(label)}</div>`; last = label; }
        out += `<div class="ev-act-row">${_evIcon(i.icon, 16)}<div class="ev-act-text">${i.html}</div><div class="t-meta num">${esc(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</div></div>`;
      });
      return out;
    }
    function renderEventOverview(event) {
      const ev = event;
      const cells = keys => keys.map(k => _evKfHtml(ev, k)).join('');
      return `<div class="ev-grid">
        <div class="ev-main">
          <section class="card ev-next" id="evNext" data-section="next">${_evNextCardInner(ev)}</section>
          <section class="card ev-facts" id="evWhen" data-section="when"><div class="card-head"><h3 class="card-title">When and where</h3></div>
            <div class="kf-grid">${cells(['date', 'start', 'end', 'guests', 'venue', 'type'])}</div></section>
          <section class="card ev-facts" id="evWho" data-section="who"><div class="card-head"><h3 class="card-title">Who</h3></div>
            <div class="kf-grid">${cells(['client', 'phone', 'email'])}</div></section>
          <section class="card ev-facts" id="evDeal" data-section="deal"><div class="card-head"><h3 class="card-title">Price and notes</h3></div>
            <div class="kf-grid">${cells(['name', 'status', 'price', 'deposit'])}</div>
            <div class="ev-checks">
              <label class="check"><input type="checkbox" id="editDepositPaid" ${ev.depositPaid ? 'checked' : ''} onchange="evTogglePaid('deposit','${_evA(ev.id)}',this.checked)"><span class="check-box"></span><span class="check-text">Deposit paid</span></label>
              <label class="check"><input type="checkbox" id="editBalancePaid" ${ev.balancePaid ? 'checked' : ''} onchange="evTogglePaid('balance','${_evA(ev.id)}',this.checked)"><span class="check-box"></span><span class="check-text">Balance paid</span></label>
            </div>
            <div class="kf-grid kf-notes">${cells(['notes'])}</div></section>
          <section class="card ev-activity" data-section="activity"><div class="card-head"><h3 class="card-title">Recent activity</h3></div>${_evActivityHtml(ev)}</section>
        </div>
        <aside class="ev-side" id="evSide">${_evSideInner(ev)}</aside>
      </div>`;
    }
    function evTogglePaid(which, eventId, checked) {
      if (which === 'deposit' && typeof toggleDepositPaid === 'function') toggleDepositPaid(eventId, checked);
      else if (which === 'balance' && typeof toggleBalancePaid === 'function') toggleBalancePaid(eventId, checked);
      else {
        const events = getDB('events'); const ev = events.find(e => e.id === eventId); if (!ev) return;
        ev[which === 'deposit' ? 'depositPaid' : 'balancePaid'] = checked; setDB('events', events);
      }
      const ev2 = (getDB('events') || []).find(e => e.id === eventId);
      if (ev2) { window.currentEvent = ev2; _evRefresh(ev2); }
    }

    // ── Click-to-edit cells ─────────────────────────────────────────────────
    function evEditField(btn) {
      const key = btn.getAttribute('data-f'), def = EV_FIELDS[key];
      const ev = window.currentEvent;
      if (!def || !ev) return;
      const open = document.querySelector('#detailContent .kf-editing');
      if (open && open !== btn) { const oi = open.querySelector('.kf-in'); if (oi) oi.blur(); }
      const raw = _evRaw(ev, key);
      let control;
      if (def.type === 'select') {
        const opts = key === 'type' ? EV_TYPE_OPTIONS.slice() : EV_STAGE_OPTIONS.slice();
        if (key === 'type' && raw && !opts.some(o => o[0] === raw)) opts.unshift([String(raw), 'Not set (pick a type)']);
        control = `<select class="input kf-in" id="${def.id}">${opts.map(o => `<option value="${_evA(o[0])}"${o[0] === raw ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
      } else if (def.type === 'textarea') {
        control = `<textarea class="input kf-in" id="${def.id}" rows="4" placeholder="Notes for your team only">${esc(raw)}</textarea>`;
      } else {
        const t = { text: 'text', date: 'date', time: 'time', tel: 'tel', email: 'email', number: 'text', money: 'text' }[def.type] || 'text';
        const val = def.type === 'money' && raw !== '' ? String(Number(raw)) : String(raw);
        const mode = { tel: 'tel', email: 'email', number: 'numeric', money: 'decimal' }[def.type];
        control = `<input class="input kf-in" id="${def.id}" type="${t}" value="${_evA(val)}"${mode ? ' inputmode="' + mode + '"' : ''}${def.type === 'tel' ? ' autocomplete="tel"' : ''}${def.type === 'email' ? ' autocomplete="email" autocapitalize="off"' : ''}>`;
      }
      const wrap = document.createElement('div');
      wrap.className = 'kf kf-editing' + (def.type === 'textarea' ? ' kf-wide' : '');
      wrap.setAttribute('data-f', key);
      wrap.innerHTML = `<label class="kf-l" for="${def.id}">${esc(def.label)}</label>${control}<div class="field-msg" role="alert" hidden></div>`;
      btn.replaceWith(wrap);
      const inp = wrap.querySelector('.kf-in');
      inp.focus();
      if (def.type !== 'select' && typeof inp.select === 'function' && def.type !== 'date' && def.type !== 'time') { try { inp.select(); } catch (e) {} }
      inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); wrap._done = true; evEndEdit(wrap); }
        else if (e.key === 'Enter' && def.type !== 'textarea') { e.preventDefault(); inp.blur(); }
      });
      if (def.type === 'select') inp.addEventListener('change', () => evCommit(wrap));
      inp.addEventListener('blur', () => { setTimeout(() => evCommit(wrap), 0); });
      if (window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches) _evDoneBar(true);
    }
    function _evDoneBar(show) {
      let bar = document.getElementById('evDoneBar');
      if (!show) { if (bar) bar.remove(); return; }
      if (bar) return;
      bar = document.createElement('div');
      bar.id = 'evDoneBar'; bar.className = 'ev-donebar';
      bar.innerHTML = '<button type="button" class="btn btn-primary" onmousedown="event.preventDefault()" onclick="evDoneEditing()">Done</button>';
      const page = document.querySelector('#detailContent .ev-page');
      (page || document.body).appendChild(bar);
    }
    function evDoneEditing() {
      const open = document.querySelector('#detailContent .kf-editing .kf-in');
      if (open) open.blur();
      _evDoneBar(false);
    }
    function evEndEdit(wrap) {
      const ev = window.currentEvent;
      _evDoneBar(false);
      if (!wrap || !wrap.isConnected || !ev) return;
      const key = wrap.getAttribute('data-f');
      const tmp = document.createElement('div');
      tmp.innerHTML = _evKfHtml(ev, key);
      wrap.replaceWith(tmp.firstElementChild);
    }
    function evCommit(wrap) {
      if (!wrap || wrap._done || !wrap.isConnected) return;
      const key = wrap.getAttribute('data-f'), def = EV_FIELDS[key];
      const inp = wrap.querySelector('.kf-in'), msg = wrap.querySelector('.field-msg');
      const ev = window.currentEvent;
      if (!inp || !ev) return;
      const fail = text => { if (msg) { msg.textContent = text; msg.hidden = false; } inp.classList.add('is-error'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); };
      let v = inp.value;
      const N = (window.CRMUI && CRMUI.norm) || null;
      if (def.type === 'tel' && v.trim() !== '' && N) { const r = N.phone(v); if (!r.ok) return fail(r.message); v = r.echo; }
      else if (def.type === 'email' && v.trim() !== '' && N) {
        const r = N.email(v); if (!r.ok) return fail(r.message); v = r.value;
        if (r.message) showToast(r.message, 'info');
      }
      else if (def.type === 'money' && N) { const r = N.money(v); if (!r.ok) return fail(r.message); v = r.value === null ? '' : String(Math.round(r.value) / 100); }
      else if (def.type === 'number') { const t = v.trim(); if (t !== '' && !/^\d+$/.test(t)) return fail('Use a whole number.'); v = t; }
      else if (def.type === 'date' && !v) return fail('An event needs a date.');
      else if (key === 'name' && !v.trim()) return fail('An event needs a name.');
      inp.classList.remove('is-error'); inp.removeAttribute('aria-invalid'); if (msg) msg.hidden = true;
      wrap._done = true;
      if (String(v) === String(_evRaw(ev, key)) || (def.type === 'money' && Number(v || 0) === Number(_evRaw(ev, key) || 0))) { evEndEdit(wrap); return; }
      inp.value = v;
      const card = wrap.closest('.card');
      const pill = (card && window.CRMUI && CRMUI.savePill) ? CRMUI.savePill(card.querySelector('.card-head')) : null;
      if (pill) pill.set('saving');
      const ok = saveEventChanges(ev.id, { inline: true });
      if (pill) pill.set(ok ? 'saved' : 'error', { onRetry: () => { const e2 = window.currentEvent; if (e2) saveEventChanges(e2.id, { inline: true }); } });
      evEndEdit(wrap);
    }

    // ── Save: reads the edit inputs that exist; fields not on screen stay as they are ──────────────
    function saveEventChanges(eventId, opts) {
      opts = opts || {};
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return false;
      const get = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
      const str = (prop, id) => { const v = get(id); if (v !== undefined) event[prop] = v; };
      str('name', 'editEventName'); str('type', 'editEventType'); str('status', 'editEventStatus'); str('date', 'editEventDate');
      str('startTime', 'editEventStartTime'); str('endTime', 'editEventEndTime'); str('clientName', 'editClientName');
      str('clientEmail', 'editClientEmail'); str('clientPhone', 'editClientPhone'); str('venueName', 'editVenueName');
      const num = (prop, id) => { const v = get(id); if (v === undefined) return; const n = parseFloat(v); event[prop] = isNaN(n) ? 0 : n; };
      num('basePrice', 'editBasePrice'); num('depositAmount', 'editDepositAmount');
      const g = get('editGuestCount'); if (g !== undefined) event.guestCount = g === '' ? '' : parseInt(g, 10);
      const notes = get('editEventNotes'); if (notes !== undefined) event.notes = notes;
      setDB('events', events);
      window.currentEvent = event;
      if (opts.inline) { _evRefresh(event); return true; }
      renderEvents(); // keep the list fresh so name, stage and date changes show immediately
      showToast('Saved', 'success');
      if (document.getElementById('detail').classList.contains('active')) showEventPage(eventId, undefined, { force: true });
      return true;
    }

    // ============================================================================
    //  Messages tab
    // ============================================================================
    function renderEventMessages(event) {
      const messages = event.messages || [];
      const first = _evFirstName(event) || 'Client';
      let body = '';
      if (!messages.length) {
        body = `<div class="empty ev-empty-sm">${_evIcon('message-square', 32)}<p class="empty-text">No messages yet. Anything you send here shows up in the client's portal.</p></div>`;
      } else {
        let lastDay = '', lastFrom = null, unreadShown = false;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        messages.forEach(m => {
          const isClient = m.from === 'client';
          const d = new Date(m.ts), valid = !isNaN(d.getTime());
          if (valid) {
            const dd = new Date(d); dd.setHours(0, 0, 0, 0);
            const diff = Math.round((today - dd) / 86400000);
            const label = diff === 0 ? 'Today' : (diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
            if (label !== lastDay) { body += `<div class="ev-msg-day"><span>${esc(label)}</span></div>`; lastDay = label; lastFrom = null; }
          }
          if (isClient && !m.read && !unreadShown) { body += '<div class="ev-msg-unread"><span>Unread</span></div>'; unreadShown = true; lastFrom = null; }
          const from = isClient ? 'client' : 'provider';
          const showName = lastFrom !== from;
          lastFrom = from;
          body += `<div class="ev-msg ev-msg-${from}${showName ? ' is-first' : ''}">
            ${showName ? `<div class="ev-msg-who">${esc(isClient ? first : 'You')}</div>` : ''}
            <div class="ev-bubble" data-user-content>${esc(m.text)}</div>
            ${valid ? `<div class="ev-msg-time">${esc(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</div>` : ''}
          </div>`;
        });
      }
      return `<div class="ev-msgs">
        <div class="ev-thread" id="providerMsgThread" role="log" aria-label="Messages with ${_evA(first)}">${body}</div>
        ${typeof _askMsgButton === 'function' ? _askMsgButton(event.id) : ''}
        <div class="ev-composer">
          <label class="sr-only" for="providerMsgInput">Message to ${_evA(first)}</label>
          <textarea class="input ev-compose-in" id="providerMsgInput" rows="1" enterkeyhint="send" placeholder="Write to ${_evA(first)}" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendProviderMessage('${_evA(event.id)}')}"></textarea>
          <button type="button" class="btn btn-secondary ev-send" onclick="sendProviderMessage('${_evA(event.id)}')">${_evIcon('send', 18)}<span>Send</span></button>
        </div>
      </div>`;
    }

    function sendProviderMessage(eventId) {
      const input = document.getElementById('providerMsgInput');
      const text  = input?.value.trim();
      if (!text) return;
      const events = getDB('events');
      const ev     = events.find(e => e.id === eventId);
      if (!ev) return;
      if (!ev.messages) ev.messages = [];
      ev.messages.push({ from: 'provider', text, ts: new Date().toISOString() });
      setDB('events', events);
      window.currentEvent = ev;
      input.value = '';
      document.getElementById('tabMessages').innerHTML = renderEventMessages(ev);
      // Scroll to bottom and keep typing
      setTimeout(() => { const t = document.getElementById('providerMsgThread'); if (t) t.scrollTop = t.scrollHeight; const i = document.getElementById('providerMsgInput'); if (i) i.focus(); }, 50);
      showToast('Message sent', 'success');
    }

    // ============================================================================
    //  Portal tab
    // ============================================================================
    async function sendPortalInvite(eventId, btnEl) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      const email = ev.portalEmail || ev.clientEmail || '';
      const name  = ev.clientName  || 'there';
      const pass  = ev.portalPassword || '';
      if (!email) { showToast('No client email yet. Add one on the Overview tab first.', 'warning'); return; }
      const date  = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : 'your event date';
      const clientFirst = name.split(' ')[0] || 'there';
      const inviteMsg = `Hey ${clientFirst},\n\nYour portal is ready. Log in to review your event details, timeline, and documents.\n\nPortal: https://www.baselinestudiofl.com/portal-client.html\nEmail: ${email}\nPassword: ${pass}\n\nReach out if anything comes up.\n\nSaul, Baseline Studio`;

      const original = btnEl ? btnEl.innerHTML : '';
      if (btnEl) { btnEl.disabled = true; btnEl.setAttribute('aria-busy', 'true'); btnEl.setAttribute('aria-disabled', 'true'); }
      const result = await BSPortal.sendEmail('client_invite', {
        email, clientName: name, password: pass,
        eventName: ev.name || 'your event', eventDate: date
      });
      if (btnEl) { btnEl.disabled = false; btnEl.removeAttribute('aria-busy'); btnEl.removeAttribute('aria-disabled'); btnEl.innerHTML = original; }

      if (result.ok) {
        const evs2 = getDB('events'); const ev2 = evs2.find(e => e.id === eventId);
        if (ev2) { ev2.portalInviteSentAt = Date.now(); setDB('events', evs2); if (window.currentEvent && window.currentEvent.id === eventId) window.currentEvent = ev2; }
        showToast('Portal link sent to ' + email, 'success');
        const host = document.getElementById('tabPortal');
        if (host && ev2) host.innerHTML = renderEventPortal(ev2);
        const act = document.getElementById('evActivityHost'); if (act && ev2) act.innerHTML = _evActivityHtml(ev2);
      } else {
        showEmailFallback(email, 'Your Baseline Studio Portal', inviteMsg,
          'Could not send. Check the email setup, or send it yourself.');
      }
    }

    // One card: who can log in, when the link last went out, and the password tools behind a disclosure.
    function _portalAccessCard(ev) {
      const id = _evA(ev.id);
      const email = ev.portalEmail || ev.clientEmail || '';
      const hasPass = !!ev.portalPassword;
      const off = !!ev.portalDisabled;
      const sent = ev.portalInviteSentAt ? new Date(_evTs(ev.portalInviteSentAt)) : null;
      const sentText = sent && !isNaN(sent.getTime())
        ? 'Last link sent ' + sent.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + sent.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.'
        : 'No link sent yet.';
      return `<section class="card ev-portal" id="portalAccessCard" data-section="portal">
        <div class="card-head"><h3 class="card-title">Portal access</h3></div>
        <div class="ev-portal-row">
          <div class="ev-portal-text"><div class="ev-portal-label">Portal is ${off ? 'off' : 'on'}</div><div class="t-meta">${off ? 'The client cannot sign in to this event.' : 'The client can sign in and see this event.'}</div></div>
          <button type="button" class="switch" role="switch" aria-checked="${off ? 'false' : 'true'}" aria-label="Portal access" onclick="togglePortalDisabled('${id}',${off ? 'false' : 'true'})"></button>
        </div>
        <div class="ev-portal-row">
          <div class="ev-portal-text"><div class="ev-portal-label">Login email</div><div class="t-meta" data-user-content>${email ? esc(email) : 'No email yet'}</div></div>
          ${email ? `<button type="button" class="btn btn-ghost btn-icon" aria-label="Copy login email" data-copy="${_evA(email)}" onclick="copyToClipboard(this.dataset.copy)">${_evIcon('copy', 18)}</button>` : ''}
        </div>
        <div class="ev-portal-row"><div class="ev-portal-text"><div class="t-meta">${esc(sentText)}</div></div></div>
        <div class="ev-portal-actions">
          <button type="button" class="btn btn-secondary" id="portalSendBtn" onclick="sendPortalInvite('${id}', this)" ${email ? '' : 'disabled'}>${_evIcon('send', 18)}<span>Send portal link</span></button>
          <button type="button" class="btn btn-secondary ev-soon" aria-disabled="true" title="After the next deploy" onclick="showToast('Preview as client arrives after the next deploy.','info')">${_evIcon('eye', 18)}<span>Preview as client</span></button>
          ${ev.clientId ? `<button type="button" class="btn btn-ghost" onclick="navigateToClient('${_evA(ev.clientId)}')">${_evIcon('user', 18)}<span>Open client profile</span></button>` : ''}
        </div>
        ${!email ? `<p class="t-meta ev-portal-hint">${ev.clientId ? 'Add an email to the client first.' : 'Link a client to this event first.'}</p>` : ''}
        <details class="ev-more-opts">
          <summary>More options</summary>
          <div class="ev-more-body">
            <div class="field"><label class="field-label" for="editPortalEmail">Login email</label><input type="email" class="input" id="editPortalEmail" value="${_evA(email)}" autocomplete="off" autocapitalize="off"></div>
            <div class="field"><label class="field-label" for="editPortalPassword">${hasPass ? 'New password' : 'Password'}</label><input type="password" class="input" id="editPortalPassword" placeholder="${hasPass ? 'Leave blank to keep the current one' : 'Make one for the client'}" autocomplete="new-password"></div>
            <div class="ev-more-actions">
              ${hasPass ? `<button type="button" class="btn btn-secondary btn-sm" data-ev="${id}" onclick="copyToClipboard(getDB('events').find(function(e){return e.id===this.dataset.ev}.bind(this)).portalPassword)">${_evIcon('copy', 16)}<span>Copy current password</span></button>` : ''}
              <button type="button" class="btn btn-secondary btn-sm" onclick="generateNewPortalPassword('${id}')">${_evIcon('refresh-cw', 16)}<span>Make a new password</span></button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="savePortalCredentials('${id}')">Save login</button>
            </div>
          </div>
        </details>
      </section>`;
    }

    function renderEventPortal(event) {
      return `<div class="ev-narrow">${_portalAccessCard(event)}</div>`;
    }

    // ============================================================================
    //  Crew and gear tab
    // ============================================================================
    function _evPullSummary(ev) {
      const pl = ev.pullList;
      if (!pl || typeof pl !== 'object') return null;
      const lines = Array.isArray(pl.lines) ? pl.lines : [];
      let total = 0, picked = 0;
      lines.forEach(l => { const q = Number(l.qty) > 0 ? Number(l.qty) : 1; total += q; const p = Number(l.picked); picked += Math.min(q, isNaN(p) ? (l.picked === true ? q : 0) : p); });
      const map = { draft: ['Draft', 'neutral'], ready: ['Ready', 'info'], out: ['Out', 'warn'], closed: ['Closed', 'ok'] };
      const m = map[String(pl.status || 'draft').toLowerCase()] || ['Draft', 'neutral'];
      return { lines: lines, total: total, picked: picked, status: m };
    }
    function renderEventGear(ev) {
      const id = _evA(ev.id);
      const crew = _evCrewList(ev);
      const ps = _evPullSummary(ev);
      const crewBody = crew.length
        ? crew.map(c => `<div class="ev-crew-line ev-crew-big" data-user-content><span class="avatar avatar-32">${esc(c.name.charAt(0))}</span><span class="ev-crew-name">${esc(c.name)}</span>${c.role ? `<span class="t-meta">${esc(c.role)}</span>` : ''}</div>`).join('')
        : `<div class="empty ev-empty-sm">${_evIcon('users', 32)}<p class="empty-text">No crew yet. Pick who is working this event.</p></div>`;
      const gearBody = ps && ps.lines.length
        ? `<div class="ev-gear-sum"><span class="pill pill-${ps.status[1]}" data-ui="pill">${ps.status[0]}</span><span class="num">${ps.picked} of ${ps.total} picked</span></div>
           <div class="sched-bar" role="progressbar" aria-valuenow="${ps.total ? Math.round(ps.picked / ps.total * 100) : 0}" aria-valuemin="0" aria-valuemax="100" aria-label="Picked"><span style="width:${ps.total ? Math.round(ps.picked / ps.total * 100) : 0}%"></span></div>
           <ul class="ev-gear-list">${ps.lines.slice(0, 40).map(l => {
             const q = Number(l.qty) > 0 ? Number(l.qty) : 1, p = Number(l.picked) || (l.picked === true ? q : 0), done = p >= q;
             return `<li class="${done ? 'is-done' : ''}" data-user-content>${_evIcon(done ? 'circle-check' : 'circle', 16)}<span class="ev-gear-name">${esc(l.name || l.itemName || l.label || 'Item')}</span><span class="t-meta num">${p} of ${q}</span></li>`;
           }).join('')}</ul>`
        : `<div class="empty ev-empty-sm">${_evIcon('package', 32)}<p class="empty-text">No pull list yet. Generate one from the booked services.</p></div>`;
      const scan = `#/equipment/scan/${encodeURIComponent(ev.id)}`;
      return `<div class="ev-gear-grid">
        <section class="card ev-crew-card" data-section="crew-card">
          <div class="card-head"><h3 class="card-title">Crew</h3><button type="button" class="btn btn-secondary" id="crewAssign" onclick="openCrewAssign('${id}')">${_evIcon('users', 18)}<span>${crew.length ? 'Edit crew' : 'Assign crew'}</span></button></div>
          ${crewBody}
        </section>
        <section class="card ev-gear-card" data-section="gear-card">
          <div class="card-head"><h3 class="card-title">Pull list</h3><button type="button" class="btn btn-secondary" id="gearGenerate" onclick="evGeneratePullList('${id}')">${_evIcon('package', 18)}<span>${ps && ps.lines.length ? 'Update pull list' : 'Generate pull list'}</span></button></div>
          ${gearBody}
          ${ps && ps.lines.length ? `<div class="ev-gear-foot"><a class="btn btn-ghost" href="${scan}">${_evIcon('scan-line', 18)}<span>Open check-out</span></a></div>` : ''}
        </section>
      </div>`;
    }
    function evGeneratePullList(eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev) return;
      if (typeof generatePullList !== 'function') { showToast('The pull list builder is not connected yet.', 'info'); return; }
      try { generatePullList(ev); } catch (e) { console.warn('[pull list]', e); showToast('Could not build the pull list.', 'error'); return; }
      const fresh = (getDB('events') || []).find(e => e.id === eventId) || ev;
      window.currentEvent = fresh;
      _evRefresh(fresh);
    }

    // Crew assignment is the Crew tab of P5's Assign accounts sheet (openAssignAccountModal in 40-clients.js).
    // It writes assignedAccounts, staff and assignedTeam, then redraws this page on the same tab.
    function openCrewAssign(eventId) {
      if (typeof openAssignAccountModal !== 'function') { showToast('Crew assignment is not available right now.', 'error'); return; }
      openAssignAccountModal(eventId, 'crew');
    }

    // ============================================================================
    //  Lighting picker (lives on the Plan tab, card #lightingCard)
    // ============================================================================
    let _lpCleanup = null;
    function initProviderLightingPicker(eventId) {
      const mount = document.getElementById('providerLpMount');
      if (!mount || !window.LightingPicker) return;
      // Cleanup prior instance
      if (_lpCleanup) { _lpCleanup(); _lpCleanup = null; }
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;
      const lighting = (event.clientEnhancements || {}).lighting || {};
      mount.setAttribute('data-mounted', '1');
      LightingPicker.mount(mount, lighting, function(lightingObj) {
        const evs = getDB('events');
        const ev  = evs.find(e => e.id === eventId);
        if (!ev) return;
        if (!ev.clientEnhancements) ev.clientEnhancements = {};
        const prev = ev.clientEnhancements.lighting || {};
        const next = { colors: (lightingObj && lightingObj.colors) || [] };
        // Remember what the client picked the first time the provider changes it
        next.clientPicked = Array.isArray(prev.clientPicked) ? prev.clientPicked : (prev.setBy === 'provider' ? [] : (prev.colors || []).slice());
        next.setBy = 'provider';
        ev.clientEnhancements.lighting = next;
        setDB('events', evs);
        window.currentEvent = ev;
        const sum = document.getElementById('lightingSummary');
        if (sum && typeof _evLightingSummary === 'function') sum.innerHTML = _evLightingSummary(ev);
        showToast('Lighting saved', 'success');
      });
      if (mount._lpCleanup) _lpCleanup = mount._lpCleanup;
    }
    // Mount when the card is on screen (or right away if the browser cannot tell).
    function _evMountLightingLazy(eventId) {
      const card = document.getElementById('lightingCard');
      if (!card) return;
      if (typeof IntersectionObserver !== 'function') { initProviderLightingPicker(eventId); return; }
      const io = new IntersectionObserver(function(entries) {
        if (entries.some(en => en.isIntersecting)) { io.disconnect(); initProviderLightingPicker(eventId); }
      }, { rootMargin: '200px' });
      io.observe(card);
    }

    // ============================================================================
    //  Day-of sheet: one big readable page from the timeline, crew, pull list and venue
    // ============================================================================
    function openDayOfSheet(eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev || !(window.CRMUI && CRMUI.sheet)) return;
      const old = document.getElementById('dayofSheet');
      if (old) { try { CRMUI.close(old, { force: true }); } catch (e) {} if (old.parentNode) old.parentNode.removeChild(old); }
      const tl = (ev.timeline || []).filter(t => t && (t.time || t.label)).slice().sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
      const crew = _evCrewList(ev);
      const ps = _evPullSummary(ev);
      const d = _evDateObj(ev.date);
      const when = [d ? _evFmtDate(ev.date, 'full') : '', [_evFmtTime(ev.startTime), _evFmtTime(ev.endTime)].filter(Boolean).join(' to ')].filter(Boolean).join(', ');
      const tel = String(ev.venuePhone || '').replace(/[^\d+]/g, '');
      const ctel = String(ev.clientPhone || '').replace(/[^\d+]/g, '');
      const sec = (title, inner) => `<section class="dayof-sec"><h3 class="dayof-h">${title}</h3>${inner}</section>`;
      const html = `<div class="dayof">
        <p class="dayof-when" data-user-content>${esc(when || 'Date not set')}</p>
        ${sec('Venue', `<div class="dayof-big" data-user-content>${esc(ev.venueName || 'No venue yet')}</div>
          ${ev.venueAddress ? `<div class="dayof-line" data-user-content>${esc(ev.venueAddress)}</div>` : ''}
          ${(ev.venueContact || ev.venuePhone) ? `<div class="dayof-line" data-user-content>${esc(ev.venueContact || 'Venue contact')}${tel ? `: <a class="link" href="tel:${_evA(tel)}">${esc(ev.venuePhone)}</a>` : ''}</div>` : ''}`)}
        ${sec('Run of show', tl.length ? `<ol class="dayof-tl">${tl.map(t => `<li><span class="dayof-time num">${esc(t.time ? _evFmtTime(t.time) : '')}</span><span class="dayof-label" data-user-content>${esc(t.label || '')}</span></li>`).join('')}</ol>` : '<div class="dayof-line">No timeline yet.</div>')}
        ${sec('Crew', crew.length ? crew.map(c => `<div class="dayof-line" data-user-content><b>${esc(c.name)}</b>${c.role ? ', ' + esc(c.role) : ''}</div>`).join('') : '<div class="dayof-line">No crew assigned.</div>')}
        ${sec('Gear', ps && ps.lines.length ? `<div class="dayof-line num">${ps.picked} of ${ps.total} picked</div><ul class="dayof-gear">${ps.lines.slice(0, 24).map(l => `<li data-user-content>${esc(l.name || l.itemName || l.label || 'Item')}<span class="num"> x${Number(l.qty) > 0 ? Number(l.qty) : 1}</span></li>`).join('')}</ul>` : '<div class="dayof-line">No pull list yet.</div>')}
        ${sec('Client', `<div class="dayof-line" data-user-content><b>${esc(ev.clientName || 'No client')}</b>${ctel ? `: <a class="link" href="tel:${_evA(ctel)}">${esc(ev.clientPhone)}</a>` : ''}</div>`)}
      </div>`;
      const dlg = CRMUI.sheet({
        id: 'dayofSheet', className: 'ev-dayof-dlg', title: 'Day of: ' + (ev.name || 'Event'), html,
        secondary: { label: 'Close' },
        primary: { label: 'Print run of show', onClick: function () { printRunOfShow(eventId); return false; } }
      });
      const pb = dlg && dlg.querySelector('[data-primary]');
      if (pb) { pb.classList.add('btn-print'); pb.insertAdjacentHTML('afterbegin', _evIcon('printer', 18)); }
      return dlg;
    }

    // ============================================================================
    //  Contract sheet: template picked by event type, share and require signature, optional deposit invoice
    // ============================================================================
    function _evSyncClientDocs(ev) {
      const _prev = ev.documents || [];
      const keys = ['clientSignature', 'clientSignedAt', 'clientSignedName', 'clientSignedIp', 'clientSignedUa', 'clientSignedHash', 'consentVersion'];
      ev.documents = (ev.docs || []).filter(d => d.sharedWithClient).map(d => {
        const prev = _prev.find(x => x.id === d.id) || {};
        const out = { id: d.id, name: d.name, label: d.name, contentHtml: d.contentHTML || d.content || '', requiresSignature: !!d.requiresSignature, sharedAt: prev.sharedAt || Date.now() };
        keys.forEach(k => { const v = d[k] != null ? d[k] : prev[k]; if (v != null) out[k] = v; });
        return out;
      });
    }
    function _evSwitchRow(id, label, desc, on) {
      return `<div class="ev-switch-row"><div class="ev-switch-text"><div class="ev-switch-label" id="${id}L">${esc(label)}</div>${desc ? `<div class="t-meta">${esc(desc)}</div>` : ''}</div>
        <button type="button" class="switch" role="switch" id="${id}" aria-labelledby="${id}L" aria-checked="${on ? 'true' : 'false'}" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')"></button></div>`;
    }
    function openContractSheet(eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      if (!ev || !(window.CRMUI && CRMUI.sheet)) return;
      if (typeof BSContracts === 'undefined') { showToast('The contract engine did not load. Refresh the page and try again.', 'error'); return; }
      const old = document.getElementById('contractSheet');
      if (old) { try { CRMUI.close(old, { force: true }); } catch (e) {} if (old.parentNode) old.parentNode.removeChild(old); }
      const first = _evFirstName(ev) || 'the client';
      const cdocs = _evContractDocs(ev);
      const pending = cdocs.find(d => !_evDocSigned(d));
      const resend = !!pending && !cdocs.some(_evDocSigned);
      const dep = _evDepositAmount(ev);
      const canDeposit = typeof openCreateInvoiceFromEvent === 'function' && _evFnTakesPrefill(openCreateInvoiceFromEvent) && typeof saveAndSendInvoice === 'function' && dep > 0 && !ev.depositPaid && !_evInvoices(ev).some(i => (i.lines || []).some(l => /deposit/i.test(l.desc || '')));
      let pct = 50; try { pct = BSContracts.getTerms(getDB('settings')).depositPercent; } catch (e) {}
      let html = '';
      if (resend) {
        html = `<p class="dlg-text" data-user-content>${esc(pending.name || 'The contract')} is waiting on a signature from ${esc(first)}.</p>
          <div class="ev-switch-list">${_evSwitchRow('csShare', 'Share with client', 'Shows in their portal.', true)}${_evSwitchRow('csSign', 'Require signature', '', true)}</div>`;
      } else {
        const templates = (getDB('templates') || []).filter(t => t && t.category !== 'employee');
        const pick = BSContracts.pickTemplate(ev, templates);
        const opts = templates.map(t => `<option value="${_evA(t.id)}"${pick.template && pick.template.id === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
        const hint = !pick.template ? 'No templates yet. Add one under Documents.' : (pick.typeUnknown ? 'This event has no recognized type, so the generic agreement is selected. Set the event type to get the matching one.' : 'Picked for this event: ' + pick.template.name + '. Choose another if you need a different one.');
        const co = BSContracts.contractOptions(ev);
        const contactBits = [ev.clientName, ev.clientEmail || ev.portalEmail, ev.clientPhone].filter(Boolean).join(', ');
        const segBtn = (v, label) => `<button type="button" class="seg-btn${co.powerSource === v ? ' active' : ''}" role="radio" aria-checked="${co.powerSource === v ? 'true' : 'false'}" data-power="${v}">${label}</button>`;
        const details = `<fieldset class="cs-group"><legend class="cs-legend">Contract details</legend>
          <div class="field"><label class="field-label" for="csCompany">Company</label><input class="input cs-in" id="csCompany" type="text" autocomplete="off" value="${_evA(co.company)}" placeholder="Leave blank if the client is a person"><div class="field-hint">When set, the company is the client on the contract.</div></div>
          <div class="field"><span class="field-label">Contact</span><div class="cs-ro" id="csContact">${contactBits ? esc(contactBits) : 'No contact on this event yet.'}</div></div>
          <div class="cs-row"><div class="field"><label class="field-label" for="csSignerName">Signer name</label><input class="input cs-in" id="csSignerName" type="text" autocomplete="off" value="${_evA(co.signerName)}" placeholder="Not known yet"></div>
            <div class="field"><label class="field-label" for="csSignerTitle">Signer title</label><input class="input cs-in" id="csSignerTitle" type="text" autocomplete="off" value="${_evA(co.signerTitle)}" placeholder="Not known yet"></div></div>
          <div class="field"><span class="field-label" id="csPowerL">Power</span><div class="seg cs-seg" id="csPower" role="radiogroup" aria-labelledby="csPowerL">${segBtn('venue', 'Venue power')}${segBtn('generator', 'Our generator')}${segBtn('client_generator', 'Client generator')}</div><div class="field-hint">Our generator means we bring and run one. Client generator means the client provides one.</div></div>
        </fieldset>`;
        html = `<div id="csStepDetails">${details}<div class="field"><label class="field-label" for="csTemplate">Agreement</label><select class="input" id="csTemplate">${opts}</select><div class="field-hint">${esc(hint)}</div></div>
          <div class="ev-switch-list">
            ${_evSwitchRow('csShare', 'Share with client', 'Shows in their portal.', true)}
            ${_evSwitchRow('csSign', 'Require signature', 'They sign in the portal.', true)}
            ${canDeposit ? _evSwitchRow('csDeposit', 'Also send deposit invoice', pct + '%, ' + _evMoneyStr(dep), true) : ''}
          </div></div><div id="csStepEdit" hidden></div>`;
      }
      let stage = 'details';
      let edited = false;
      const readOpts = function (dlg) {
        const pw = dlg.querySelector('#csPower [aria-checked="true"]');
        return {
          clientCompany: (dlg.querySelector('#csCompany').value || '').trim(),
          signerName: (dlg.querySelector('#csSignerName').value || '').trim(),
          signerTitle: (dlg.querySelector('#csSignerTitle').value || '').trim(),
          powerSource: pw ? pw.getAttribute('data-power') : 'venue'
        };
      };
      const goStage = function (dlg, to) {
        stage = to;
        dlg.classList.toggle('ce-sheet', to === 'edit');
        const d1 = dlg.querySelector('#csStepDetails'), d2 = dlg.querySelector('#csStepEdit');
        if (d1) d1.hidden = to !== 'details';
        if (d2) d2.hidden = to !== 'edit';
        const t = dlg.querySelector('.dlg-title'); if (t) t.textContent = to === 'edit' ? 'Review and edit' : 'Create contract';
        const pb = dlg.querySelector('[data-primary]'); if (pb) pb.textContent = to === 'edit' ? 'Send contract' : 'Review and edit';
        const sb = dlg.querySelector('.dlg-foot .btn-secondary'); if (sb) sb.textContent = to === 'edit' ? 'Back' : 'Cancel';
        const body = dlg.querySelector('.dlg-body'); if (body) body.scrollTop = 0;
      };
      const mergeText = function (e2, tmpl) {
        let h = BSContracts.mergeForEvent(tmpl.contentHTML || tmpl.content || '', e2, (typeof _contractEnv === 'function') ? _contractEnv() : { invoices: getDB('invoices') || [], settings: getDB('settings') || {} });
        if (/agreement|contract|proposal/i.test(tmpl.name || '') && typeof _injectAddenda === 'function') h = _injectAddenda(h, e2);
        return h;
      };
      const run = async function (dlg) {
        if (!resend && stage === 'details') {
          const tSel = dlg.querySelector('#csTemplate');
          if (!tSel || !tSel.value) { showToast('Pick an agreement first.', 'warning'); return false; }
          const tm = (getDB('templates') || []).find(t => t.id === tSel.value);
          if (!tm) { showToast('That agreement is missing. Pick another.', 'warning'); return false; }
          if (typeof _ceEditorHtml !== 'function') { showToast('Reload the page to edit contracts.', 'warning'); return false; }
          const evNow = (getDB('events') || []).find(e => e.id === eventId) || ev;
          const merged = mergeText(Object.assign({}, evNow, readOpts(dlg)), tm);
          const host = dlg.querySelector('#csStepEdit');
          host.innerHTML = '<p class="ev-sheet-note" data-user-content>Check the wording and change anything you need. Then send it.</p>' + _ceEditorHtml(merged);
          if (typeof _ceWire === 'function') _ceWire(host, Object.assign({}, evNow, readOpts(dlg)));
          goStage(dlg, 'edit');
          const ar = host.querySelector('#ceArea'); if (ar) { edited = false; ar.addEventListener('input', () => { edited = true; }); ar.focus(); }
          return false;
        }
        const share = dlg.querySelector('#csShare').getAttribute('aria-checked') === 'true';
        const sign = dlg.querySelector('#csSign').getAttribute('aria-checked') === 'true';
        const depEl = dlg.querySelector('#csDeposit');
        const wantDep = !!(depEl && depEl.getAttribute('aria-checked') === 'true');
        const tplSel = dlg.querySelector('#csTemplate');
        if (!resend && (!tplSel || !tplSel.value)) { showToast('Pick an agreement first.', 'warning'); return false; }
        const body = resend ? first + ' gets an email with the link to sign.' : first + ' will see it in their portal and get an email with the link.' + (wantDep ? ' A ' + _evMoneyStr(dep) + ' deposit invoice goes out with it.' : '');
        const yes = await _evConfirm({ title: (resend ? 'Resend the contract to ' : 'Send the contract to ') + first + '?', body: body, confirmLabel: resend ? 'Resend contract' : 'Send contract' });
        if (!yes) return false;
        const events = getDB('events');
        const e2 = events.find(e => e.id === eventId);
        if (!e2) return false;
        if (!e2.docs) e2.docs = [];
        if (resend) {
          const d = e2.docs.find(x => x.id === pending.id);
          if (d) { d.sharedWithClient = share; d.requiresSignature = sign; }
        } else {
          const tmpl = (getDB('templates') || []).find(t => t.id === tplSel.value);
          if (!tmpl) return false;
          const o = readOpts(dlg);
          e2.clientCompany = o.clientCompany; e2.signerName = o.signerName; e2.signerTitle = o.signerTitle; e2.powerSource = o.powerSource;
          let docHTML = (typeof _ceRead === 'function') ? _ceRead(dlg.querySelector('#csStepEdit')) : '';
          if (!docHTML || !String(docHTML).replace(/<[^>]*>/g, '').trim()) { showToast('The contract text is empty. Go back and review it again.', 'warning'); return false; }
          e2.docs.push({ id: genId(), name: tmpl.name, contentHTML: docHTML, templateId: tmpl.id, createdAt: Date.now(), signedAt: null, signature: null,
            fromTemplate: true, requiresSignature: sign, sharedWithClient: share });
        }
        _evSyncClientDocs(e2);
        setDB('events', events);
        window.currentEvent = e2;
        const tabDocs = document.getElementById('tabDocuments');
        if (tabDocs && typeof renderEventDocuments === 'function') tabDocs.innerHTML = renderEventDocuments(e2);
        if (wantDep) { try { openCreateInvoiceFromEvent(eventId, { deposit: true, amount: dep, label: 'Deposit' }); saveAndSendInvoice(); } catch (err) { console.warn('[deposit invoice]', err); showToast('The contract is saved. The deposit invoice did not go out, so send it from the Money tab.', 'warning'); } }
        showToast(resend ? 'Contract resent to ' + first + '.' : 'Contract sent to ' + first + '.', 'success');
        try { await sendPortalInvite(eventId); } catch (err) { console.warn('[portal link]', err); }
        _evRefresh(e2);
        return true;
      };
      const dlg = CRMUI.sheet({
        id: 'contractSheet', title: resend ? 'Resend contract' : 'Create contract', html,
        secondary: { label: 'Cancel', onClick: function (d) {
          if (stage !== 'edit') return undefined;
          if (!edited) { goStage(d, 'details'); return false; }
          return _evConfirm({ title: 'Discard your edits?', body: 'Going back builds the contract again from the details, so your changes to the text are lost.', confirmLabel: 'Discard edits', danger: true })
            .then(yes => { if (yes) goStage(d, 'details'); return false; });
        } },
        primary: { label: resend ? 'Resend contract' : 'Review and edit', onClick: run }
      });
      if (dlg) {
        dlg.querySelectorAll('#csPower .seg-btn').forEach(b => b.addEventListener('click', () => {
          dlg.querySelectorAll('#csPower .seg-btn').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        }));
      }
      return dlg;
    }

    // ============================================================================
    //  Delete
    // ============================================================================
    function deleteEvent(eventId) {
      const events = getDB('events');
      const event = events.find(ev => ev.id === eventId);
      if (!event) return;
      const done = () => {
        const updated = (getDB('events') || []).filter(ev => ev.id !== eventId);
        setDB('events', updated);
        if (document.getElementById('detail').classList.contains('active')) goBack();
        renderEvents();
        showToast('Event deleted', 'success');
      };
      if (window.CRMUI && typeof CRMUI.confirm === 'function') {
        _evConfirm({ title: 'Delete this event?', body: 'This removes ' + (event.name || 'the event') + ' and its documents. Invoices stay in Money.', confirmLabel: 'Delete event', danger: true }).then(yes => { if (yes) done(); });
        return;
      }
      window.confirmCallback = () => { closeModal('confirmDialog'); done(); };
      document.getElementById('confirmTitle').textContent = 'Delete Event';
      document.getElementById('confirmMessage').textContent = `Delete "${event.name}"?`;
      openModal('confirmDialog');
    }
