// ============================================================================
// portal-provider/50-money.js  -  money: event Money tab, payment schedule, invoices, quote builder, service catalog, reports
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A); redesigned in the UI pass (lane P3).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// Public globals other lanes call (ui-notes/CONTRACTS.md): openQuoteBuilderModal(eventIdOrNull, {inquiry|fromEvent}), renderPaymentSchedule(ev),
// openCreateInvoiceFromEvent(eventId, {deposit|balance, amount, label}), markInvoicePaid(id), confirmPaymentReport(eventId).
// ============================================================================

    // ── Money helpers (pure: no DOM, no storage) ──────────────────────────────
    // Amounts are dollars in storage (as before). Anything that adds or compares money goes through integer cents so a schedule
    // always sums to the cent.
    function _mnyCents(v) {
      const n = Number(v);
      return isFinite(n) ? Math.round(n * 100) : 0;
    }
    function _mnyUSD(c) {
      const a = Math.abs(c);
      const whole = a % 100 === 0;
      return (c < 0 ? '-' : '') + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    }
    function _mnyDate(v) {
      if (v === null || v === undefined || v === '') return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
      if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    function _mnyDay(d) {
      const x = _mnyDate(d) || new Date();
      return new Date(x.getFullYear(), x.getMonth(), x.getDate(), 12, 0, 0).getTime();
    }
    function _mnyAddDays(d, n) {
      const x = _mnyDate(d);
      return x ? new Date(x.getFullYear(), x.getMonth(), x.getDate() + n, 12, 0, 0) : null;
    }
    function _mnyISO(d) {
      const x = _mnyDate(d);
      if (!x) return '';
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }
    function _mnyShort(v, now) {
      const d = _mnyDate(v);
      if (!d) return '';
      const same = d.getFullYear() === (_mnyDate(now) || new Date()).getFullYear();
      return d.toLocaleDateString('en-US', same ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function _mnyLong(v) {
      const d = _mnyDate(v);
      return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    }
    // Same rule the client portal uses to tell a deposit invoice from a balance invoice.
    function _mnyKind(inv) {
      const text = (Array.isArray(inv && inv.lines) ? inv.lines : []).map(l => (l && l.desc) || '').join(' ') + ' ' + ((inv && inv.notes) || '');
      return /deposit/i.test(text) ? 'deposit' : /balance|final/i.test(text) ? 'balance' : 'other';
    }
    // paid | overdue | partial | sent | draft | void. Draft means it was never emailed from here.
    function _mnyInvStatus(inv, now) {
      const s = String((inv && inv.status) || '').toLowerCase();
      if (s === 'paid') return 'paid';
      if (/^(void|voided|cancelled|canceled)$/.test(s)) return 'void';
      const due = _mnyDate(inv && inv.dueDate);
      if (due && _mnyDay(due) < _mnyDay(now)) return 'overdue';
      if (s === 'partial') return 'partial';
      return inv && inv.sentAt ? 'sent' : 'draft';
    }
    // Money received on one invoice, in cents: the payments list, or the whole total for an invoice that was marked paid before payments were listed.
    function _mnyInvPaidC(inv) {
      if (Array.isArray(inv && inv.payments) && inv.payments.length) return inv.payments.reduce((s, p) => s + _mnyCents(p && p.amount), 0);
      return String((inv && inv.status) || '').toLowerCase() === 'paid' ? _mnyCents(inv.total) : 0;
    }
    function _mnyNum(inv) {
      const n = String((inv && inv.invoiceNum) || '');
      const m = /^INV-?(\d+)$/i.exec(n);
      return m ? m[1] : (n || '0000');
    }
    function _mnyFirst(name) {
      return String(name || '').trim().split(/\s+/)[0] || 'Your client';
    }

    // The payment schedule for one event, from the event price, the contract terms and the invoices already made.
    // Deposit = the event's own deposit amount when it has one, else terms.depositPercent of the total. Balance = the rest, so the two
    // always add up to the total to the cent. A row is paid when its flag is set (ev.depositPaid / ev.balancePaid), when a paid invoice of
    // that kind exists, or when paid invoices of no particular kind cover it.
    function _mnySchedule(ev, invoices, terms, now) {
      const t = terms || {};
      const pct = Number(t.depositPercent) > 0 ? Number(t.depositPercent) : 50;
      const days = isFinite(Number(t.balanceDueDays)) && t.balanceDueDays !== '' && t.balanceDueDays !== null ? Number(t.balanceDueDays) : 14;
      const nowD = _mnyDate(now) || new Date();
      const today = _mnyDay(nowD);
      const evInv = (invoices || []).filter(i => i && i.eventId === ev.id && _mnyInvStatus(i, nowD) !== 'void');
      let totalC = _mnyCents(ev.basePrice);
      let fromInvoices = false;
      if (totalC <= 0) {
        totalC = evInv.reduce((s, i) => s + _mnyCents(i.total), 0);
        fromInvoices = totalC > 0;
      }
      const out = { ok: false, totalC: 0, depositC: 0, balanceC: 0, paidC: 0, remainingC: 0, pctPaid: 0, rows: [], extras: [], extrasUnpaidC: 0, fromInvoices, days, pct };
      if (totalC <= 0) { out.extras = evInv; return out; }
      let depositC = _mnyCents(ev.depositAmount);
      if (fromInvoices || depositC <= 0 || depositC > totalC) depositC = Math.round(totalC * pct / 100);
      const balanceC = totalC - depositC;
      const paidInv = i => _mnyInvStatus(i, nowD) === 'paid';
      const byKind = { deposit: [], balance: [], other: [] };
      evInv.forEach(i => byKind[_mnyKind(i)].push(i));
      let otherPaidC = byKind.other.filter(paidInv).reduce((s, i) => s + _mnyCents(i.total), 0);
      let depPaid = ev.depositPaid === true || byKind.deposit.some(paidInv);
      let balPaid = balanceC > 0 && (ev.balancePaid === true || byKind.balance.some(paidInv));
      if (!depPaid && otherPaidC >= depositC) { depPaid = true; otherPaidC -= depositC; }
      if (balanceC > 0 && !balPaid && depPaid && otherPaidC >= balanceC) balPaid = true;
      const pick = list => list.find(i => !paidInv(i)) || list.slice().sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))[0] || null;
      const evDate = _mnyDate(ev.date);
      const balDue = evDate ? _mnyAddDays(evDate, -days) : null;
      const rows = [];
      const depInv = pick(byKind.deposit);
      rows.push({ key: 'deposit', label: 'Deposit', amountC: depositC, pct: Math.round(depositC * 100 / totalC), paid: depPaid,
        paidAt: depPaid && depInv && paidInv(depInv) ? (depInv.paidAt || null) : null, due: null, dueText: 'Due at signing', overdue: false, daysUntil: null, inv: depInv });
      if (balanceC > 0) {
        const balInv = pick(byKind.balance);
        const daysUntil = balDue ? Math.round((_mnyDay(balDue) - today) / 86400000) : null;
        rows.push({ key: 'balance', label: 'Balance', amountC: balanceC, pct: 100 - rows[0].pct, paid: balPaid,
          paidAt: balPaid && balInv && paidInv(balInv) ? (balInv.paidAt || null) : null, due: balDue,
          dueText: days + ' days before the event', overdue: !balPaid && daysUntil !== null && daysUntil < 0, daysUntil, inv: balInv });
      }
      out.ok = true;
      out.totalC = totalC; out.depositC = depositC; out.balanceC = balanceC;
      out.rows = rows;
      out.paidC = rows.filter(r => r.paid).reduce((s, r) => s + r.amountC, 0);
      out.remainingC = totalC - out.paidC;
      out.pctPaid = Math.round(out.paidC * 100 / totalC);
      out.extras = byKind.other;
      out.extrasUnpaidC = byKind.other.filter(i => !paidInv(i)).reduce((s, i) => s + _mnyCents(i.total), 0);
      return out;
    }

    // ── Small DOM-side helpers ────────────────────────────────────────────────
    function _mnyIcon(name, size) {
      return (typeof CRMUI !== 'undefined' && CRMUI.icon) ? CRMUI.icon(name, size || 16) : '';
    }
    function _mnyTerms() {
      if (typeof BSContracts !== 'undefined' && BSContracts.getTerms) return BSContracts.getTerms(getDB('settings'));
      return { depositPercent: 50, balanceDueDays: 14 };
    }
    function _mnyDeposit(total) {
      return Math.round(total * (Number(_mnyTerms().depositPercent) || 50) / 100);
    }
    function _mnyEvent(id) {
      return (getDB('events') || []).find(e => e && e.id === id) || null;
    }
    function _mnyPaymentsOff() {
      const s = getDB('settings');
      return !(s && s.payments && s.payments.enabled === true);
    }
    // ── Payment methods. Settings > Payment methods writes settings.payments.methods = [{id, type, label, details, note, enabled}]. ──
    // These helpers are pure (no DOM, no storage). The client portal carries the same names for the same rules.
    function _payTypes() {
      return [
        { type: 'zelle', name: 'Zelle', detailsLabel: 'Zelle email or phone', placeholder: 'name@email.com or (305) 555-0142', required: true },
        { type: 'venmo', name: 'Venmo', detailsLabel: 'Venmo @handle or venmo.com link', placeholder: '@yourhandle or a venmo.com link', required: true },
        { type: 'cashapp', name: 'Cash App', detailsLabel: 'Cash App $cashtag', placeholder: '$yourcashtag', required: true },
        { type: 'paypal', name: 'PayPal', detailsLabel: 'PayPal link or email', placeholder: 'https://paypal.me/yourname', required: true },
        { type: 'check', name: 'Check', detailsLabel: 'Make checks payable to', placeholder: 'Baseline Studio', required: true },
        { type: 'cash', name: 'Cash', detailsLabel: 'Cash instructions (optional)', placeholder: 'Hand it to your DJ or crew lead at the event.', required: false },
        { type: 'card_link', name: 'Card, Apple Pay or Google Pay', detailsLabel: 'Card payment link (Stripe or Square)', placeholder: 'https://', hint: 'Stripe and Square payment links show Apple Pay and Google Pay automatically on phones that support them.', required: true },
        { type: 'bank', name: 'Bank transfer (ACH)', detailsLabel: 'Bank transfer details', placeholder: 'Bank name, routing number, account number', required: true },
        { type: 'other', name: 'Other', detailsLabel: 'How to pay', placeholder: 'Tell clients what to do', required: true }
      ];
    }
    function _payType(t) { const l = _payTypes(); return l.find(x => x.type === t) || l[l.length - 1]; }
    // https links only. Anything else (javascript:, data:, http:, spaces, quotes) comes back empty.
    function _paySafeUrl(v) {
      let s = String(v == null ? '' : v).trim();
      if (!s) return '';
      if (/^(www\.)?paypal\.me\//i.test(s)) s = 'https://' + s;
      if (!/^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?([\/?#][^\s<>"'`\\]*)?$/i.test(s)) return '';
      return /^https:\/\/[^\/?#:]*\./i.test(s) ? s : '';
    }
    // The https link a method can open, or '' (card link and PayPal links; Venmo only when the link is on venmo.com).
    function _payLinkOf(m) {
      if (!m) return '';
      if (m.type === 'card_link' || m.type === 'paypal') return _paySafeUrl(m.details);
      if (m.type === 'venmo') { const u = _paySafeUrl(m.details); return /^https:\/\/([a-z0-9-]+\.)*venmo\.com([\/?#:]|$)/i.test(u) ? u : ''; }
      return '';
    }
    function _payNewId() { return 'pm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function _payNormMethod(m) {
      m = m || {};
      const t = _payType(m.type);
      return { id: String(m.id || _payNewId()), type: t.type, label: String(m.label == null ? '' : m.label).trim() || t.name,
        details: String(m.details == null ? '' : m.details).trim(), note: String(m.note == null ? '' : m.note).trim(), enabled: m.enabled !== false };
    }
    // The methods as saved. Settings saved before this existed have no list: seed Zelle (and the old card link) from the old fields.
    function _payMethodsOf(p) {
      p = p || {};
      if (Array.isArray(p.methods)) return p.methods.filter(m => m && typeof m === 'object').map(m => _payNormMethod(m));
      const out = [];
      const z = typeof p.zelle === 'string' ? p.zelle.trim() : '';
      if (z) out.push({ id: 'pm_zelle', type: 'zelle', label: 'Zelle', details: z, note: '', enabled: true });
      const link = p.enabled === true ? _paySafeUrl(p.link) : '';
      if (link) out.push({ id: 'pm_card', type: 'card_link', label: 'Card', details: link, note: '', enabled: true });
      return out;
    }
    // What clients and invoices show: enabled methods that have what they need, Zelle first, the rest in the saved order.
    function _payEnabled(p) {
      const l = _payMethodsOf(p).filter(m => m.enabled && (m.details || !_payType(m.type).required));
      return l.filter(m => m.type === 'zelle').concat(l.filter(m => m.type !== 'zelle'));
    }
    function _payFeePct(p) {
      const raw = p && p.cardFeePercent;
      if (raw === '' || raw == null) return 0;
      const n = Number(raw);
      return (isFinite(n) && n > 0 && n <= 20) ? n : 0;
    }
    function _payFeeNote(p, m) {
      const f = _payFeePct(p);
      return (f && m && m.type === 'card_link') ? 'A ' + (Math.round(f * 100) / 100) + '% card fee applies.' : '';
    }
    // One line of plain text for a method, used on the invoice print.
    function _payLineText(m) {
      if (m.type === 'check') return 'Make checks payable to ' + m.details;
      return m.details;
    }
    // The "How to pay" box on an invoice print. Enabled methods when any are set up, otherwise the old Zelle line.
    function _mnyHowToPay(inv) {
      const st = getDB('settings');
      const p = (st && st.payments) || {};
      const total = _mnyUSD(_mnyCents(inv.total));
      const ms = _payEnabled(p);
      if (!ms.length) {
        if (Array.isArray(p.methods) && p.methods.length) return `<div class="box"><strong>How to pay.</strong> Call or text (786) 302-6056 to arrange payment of ${total}. Put ${esc(inv.invoiceNum)} in the memo.</div>`;
        return `<div class="box"><strong>How to pay.</strong> Send ${total} by Zelle to ${esc(_mnyZelle())}. Put ${esc(inv.invoiceNum)} in the memo.</div>`;
      }
      const rows = ms.map(m => {
        const fee = _payFeeNote(p, m);
        return `<div><strong>${esc(m.label)}:</strong> ${m.details ? esc(_payLineText(m)) : ''}${m.note ? ' ' + esc(m.note) : ''}${fee ? ' ' + esc(fee) : ''}</div>`;
      }).join('');
      return `<div class="box"><strong>How to pay.</strong> Pay ${total} any of these ways. Put ${esc(inv.invoiceNum)} in the memo.${rows}</div>`;
    }
    function _mnyZelle() {
      const s = getDB('settings');
      const z = s && s.payments && typeof s.payments.zelle === 'string' ? s.payments.zelle.trim() : '';
      return z || '(786) 302-6056';
    }
    function _mnyPill(status) {
      const map = { paid: ['ok', 'Paid'], overdue: ['danger', 'Overdue'], sent: ['info', 'Sent'], partial: ['warn', 'Part paid'], draft: ['neutral', 'Draft'], void: ['neutral', 'Void'] };
      const m = map[status] || map.draft;
      return `<span class="pill pill-${m[0]}" data-ui="pill">${m[1]}</span>`;
    }
    // CRMUI.confirm, with the id the flow harness looks for.
    function _mnyConfirm(o) {
      if (typeof CRMUI === 'undefined' || !CRMUI.confirm) { showToast('Could not open the confirm box. Reload and try again.', 'error'); return Promise.resolve(false); }
      const p = CRMUI.confirm(o);
      const all = document.querySelectorAll('dialog.dlg-confirm');
      const d = all[all.length - 1];
      if (d) { const old = document.getElementById('crmConfirm'); if (old && old !== d) old.removeAttribute('id'); d.id = 'crmConfirm'; }
      return p;
    }
    function _mnyMarkBusy(btn, on) {
      if (!btn) return;
      if (on) { btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true'); btn.disabled = true; }
      else { btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled'); btn.disabled = false; }
    }
    // Repaint whatever money views are on screen after a change.
    function _mnyRefreshViews() {
      try { renderInvoices(); } catch (e) { /* section not mounted */ }
      const tab = document.getElementById('tabInvoices');
      if (tab && window.currentEvent) {
        const fresh = _mnyEvent(window.currentEvent.id) || window.currentEvent;
        tab.innerHTML = renderEventInvoices(fresh);
      }
      const dash = document.getElementById('dashboard');
      if (dash && dash.classList.contains('active') && typeof renderDashboard === 'function') { try { renderDashboard(); } catch (e) { /* home owns its errors */ } }
    }
    function _mnyReport(ev) {
      const pr = ev && ev.clientNotes && ev.clientNotes.paymentReported;
      if (!pr || typeof pr !== 'object' || pr.confirmedAt) return null;
      return pr;
    }

    // ── Payments-off banner (one per view) ────────────────────────────────────
    function _mnyOffBanner() {
      if (!_mnyPaymentsOff()) return '';
      return `<div class="banner banner-info mny-banner">${_mnyIcon('info', 18)}<div class="banner-body">Online payments are off. Clients see Zelle and manual instructions.</div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="switchSection('settings')">Settings</button></div>`;
    }

    // ── Client says paid ──────────────────────────────────────────────────────
    function _mnyReportCard(ev) {
      const pr = _mnyReport(ev);
      if (!pr) return '';
      const amt = Number(pr.amount) > 0 ? ' a payment of <strong class="num">' + _mnyUSD(_mnyCents(pr.amount)) + '</strong>' : ' a payment';
      const when = _mnyDate(pr.at) ? ' on ' + _mnyShort(pr.at) : '';
      return `<div class="mny-report" data-payment-report="${esc(ev.id)}">
        <div class="mny-report-main">${_mnyIcon('banknote', 20)}<div>
          <div class="mny-report-title"><span data-user-content>${esc(_mnyFirst(ev.clientName))}</span> reported${amt}${esc(when)}.</div>
          <div class="mny-report-sub">Check your Zelle, then confirm. Nothing changes until you do.</div></div></div>
        <button type="button" class="btn btn-secondary mny-confirm" onclick="confirmPaymentReport('${esc(ev.id)}')">${_mnyIcon('check', 16)}Confirm and mark paid</button>
      </div>`;
    }
    // One tap: finds the invoice the client named (or the next unpaid one) and marks it paid, with undo.
    function confirmPaymentReport(eventId) {
      const ev = _mnyEvent(eventId);
      const pr = _mnyReport(ev);
      if (!ev || !pr) return;
      const now = new Date();
      const open = (getDB('invoices') || []).filter(i => i.eventId === eventId && ['sent', 'draft', 'overdue', 'partial'].includes(_mnyInvStatus(i, now)));
      const key = String(pr.invoice || '');
      let inv = key ? open.find(i => String(i.invoiceNum || '') === key || String(i.id) === key) : null;
      if (!inv && !key) inv = open.slice().sort((a, b) => (_mnyDay(a.dueDate || '2999-12-31')) - (_mnyDay(b.dueDate || '2999-12-31')))[0] || null;
      if (inv) { recordInvoicePayment(inv.id, Number(pr.amount) > 0 ? Number(pr.amount) : 0, { fromReport: true, toast: true }); return; }
      const s = _mnySchedule(ev, getDB('invoices') || [], _mnyTerms(), now);
      const row = s.ok ? s.rows.find(r => !r.paid) : null;
      if (row) { _mnyMarkRowPaid(ev.id, row.key, { fromReport: true }); return; }
      pr.confirmedAt = new Date().toISOString();
      setDB('events', getDB('events'));
      _mnyRefreshViews();
      showToast('Payment report cleared. There was nothing unpaid to mark.', 'info');
    }

    // ── Payment schedule card (contract: renderPaymentSchedule(ev) -> HTML string) ──
    function renderPaymentSchedule(ev) {
      const e = _mnyEvent(ev && ev.id) || ev || {};
      const now = new Date();
      const s = _mnySchedule(e, getDB('invoices') || [], _mnyTerms(), now);
      if (!s.ok) {
        return `<div class="card mny-card" id="paymentSchedule"><div class="card-head"><h2 class="card-title">Payment schedule</h2></div>
          <p class="mny-note">No price on this event yet. Add one on Overview or build a quote, and the deposit and balance show up here.</p>
          <button type="button" class="btn btn-secondary" onclick="openQuoteBuilderModal('${esc(e.id)}')">${_mnyIcon('file-text', 16)}Build quote</button></div>`;
      }
      const rows = s.rows.map(r => {
        const state = r.paid ? 'paid' : r.overdue ? 'overdue' : 'due';
        let pill;
        if (r.paid) pill = `<span class="pill pill-ok" data-ui="pill">Paid${r.paidAt ? ' ' + esc(_mnyShort(r.paidAt, now)) : ''}</span>`;
        else if (r.overdue) pill = `<span class="pill pill-danger" data-ui="pill">Overdue, was due ${esc(_mnyShort(r.due, now))}</span>`;
        else if (r.key === 'deposit') pill = `<span class="pill pill-warn" data-ui="pill">Due at signing</span>`;
        else if (r.due) pill = `<span class="pill ${r.daysUntil <= 7 ? 'pill-warn' : 'pill-neutral'}" data-ui="pill">Due ${esc(_mnyShort(r.due, now))}</span>`;
        else pill = `<span class="pill pill-neutral" data-ui="pill">${esc(r.dueText)}</span>`;
        const got = r.inv && !r.paid ? _mnyInvPaidC(r.inv) : 0;
        const ref = r.inv ? ` · <span class="num">${esc(r.inv.invoiceNum || '')}</span>` + (got > 0 ? ` · ${_mnyUSD(got)} received` : '') : '';
        let acts = '';
        if (!r.paid) {
          acts = `<div class="mny-sact">${r.inv
            ? `<button type="button" class="btn btn-secondary btn-sm" onclick="_mnyRemindRow('${esc(e.id)}','${r.key}')">${r.inv.sentAt ? 'Send reminder' : 'Send invoice'}</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" onclick="_mnyRowInvoice('${esc(e.id)}','${r.key}')">Create invoice</button>`}
            <button type="button" class="btn btn-secondary btn-sm" onclick="_mnyMarkRowPaid('${esc(e.id)}','${r.key}')">Mark paid</button></div>`;
        }
        return `<li class="mny-srow is-${state}" data-sched="${r.key}">
          <span class="mny-sico">${_mnyIcon(r.paid ? 'circle-check' : r.overdue ? 'triangle-alert' : 'circle', 20)}</span>
          <div class="mny-smain"><div class="mny-stitle">${r.label} <span class="mny-spct">${r.pct}%</span></div>
            <div class="mny-smeta">${esc(r.dueText)}${ref}</div></div>
          <div class="mny-samt num">${_mnyUSD(r.amountC)}</div>
          <div class="mny-spill">${pill}</div>${acts}</li>`;
      }).join('');
      const extra = s.extras.length
        ? `<p class="mny-note">Not in the schedule: ${s.extras.length === 1 ? 'invoice <span class="num">' + esc(s.extras[0].invoiceNum || '') + '</span>' : s.extras.length + ' other invoices'}${s.extrasUnpaidC > 0 ? ', ' + _mnyUSD(s.extrasUnpaidC) + ' unpaid' : ', paid'}.</p>` : '';
      return `<div class="card mny-card" id="paymentSchedule">
        <div class="card-head"><h2 class="card-title">Payment schedule</h2></div>
        <ul class="mny-sched">${rows}</ul>
        <div class="mny-sfoot">
          <div><span class="mny-flabel">Total</span><span class="mny-fval num">${_mnyUSD(s.totalC)}</span></div>
          <div><span class="mny-flabel">Paid</span><span class="mny-fval num is-ok">${_mnyUSD(s.paidC)}</span></div>
          <div><span class="mny-flabel">Remaining</span><span class="mny-fval num ${s.remainingC > 0 ? 'is-warn' : 'is-ok'}">${_mnyUSD(s.remainingC)}</span></div>
        </div>
        <div class="sched-bar" role="img" aria-label="${s.pctPaid}% paid"><span style="width:${s.pctPaid}%"></span></div>
        <div class="mny-bartext num">${s.pctPaid}% paid</div>${extra}</div>`;
    }

    // schedule row actions
    function _mnyRowInvoice(eventId, key) {
      openCreateInvoiceFromEvent(eventId, key === 'balance' ? { balance: true } : { deposit: true });
    }
    function _mnyRemindRow(eventId, key) {
      const ev = _mnyEvent(eventId);
      const s = ev ? _mnySchedule(ev, getDB('invoices') || [], _mnyTerms(), new Date()) : null;
      const row = s && s.ok ? s.rows.find(r => r.key === key) : null;
      if (row && row.inv) sendInvoiceConfirm(row.inv.id, { reminder: !!row.inv.sentAt });
    }
    // Mark a schedule row paid. With an unpaid invoice behind it, that invoice is marked. Without one, the event flag is set and a payment is logged
    // so Reports still count it.
    function _mnyMarkRowPaid(eventId, key, opts) {
      const events = getDB('events') || [];
      const ev = events.find(e => e && e.id === eventId);
      if (!ev) return;
      const s = _mnySchedule(ev, getDB('invoices') || [], _mnyTerms(), new Date());
      const row = s.ok ? s.rows.find(r => r.key === key) : null;
      if (!row || row.paid) return;
      if (row.inv && _mnyInvStatus(row.inv, new Date()) !== 'paid') { markInvoicePaid(row.inv.id, opts); return; }
      const flag = key === 'balance' ? 'balancePaid' : 'depositPaid';
      const prev = { flag: ev[flag], confirmed: null };
      const pr = _mnyReport(ev);
      if (pr && (opts && opts.fromReport)) { prev.confirmed = pr.confirmedAt || null; pr.confirmedAt = new Date().toISOString(); }
      ev[flag] = true;
      const txs = getDB('transactions') || [];
      const tx = { id: genId(), eventId: ev.id, clientName: ev.clientName || '', amount: row.amountC / 100, type: row.label + ' payment', note: ev.name || '', date: Date.now(), manual: true };
      if (opts && opts.fromReport) tx.method = 'Zelle';
      txs.push(tx);
      setDB('transactions', txs);
      setDB('events', events);
      const syncRes = typeof syncEvent === 'function' ? syncEvent(ev.id, { source: 'payment', refresh: false }) : null;
      _mnyRefreshViews();
      if (typeof _syncRefreshViews === 'function') _syncRefreshViews(ev.id);
      showUndoToast('Marked paid: ' + row.label.toLowerCase() + ', ' + _mnyUSD(row.amountC) + '.' + (syncRes && syncRes.changed && syncRes.note ? ' ' + syncRes.note : ''), function () {
        if (syncRes && typeof syncRes.undo === 'function') { try { syncRes.undo(); } catch (e) {} }
        const evs = getDB('events') || [];
        const e2 = evs.find(e => e && e.id === eventId);
        if (e2) { e2[flag] = prev.flag === undefined ? false : prev.flag; const p2 = _mnyReport(e2) || (e2.clientNotes && e2.clientNotes.paymentReported); if (p2 && opts && opts.fromReport) { if (prev.confirmed) p2.confirmedAt = prev.confirmed; else delete p2.confirmedAt; } }
        setDB('transactions', (getDB('transactions') || []).filter(t => t.id !== tx.id));
        setDB('events', evs);
        _mnyRefreshViews();
        if (typeof _syncRefreshViews === 'function') _syncRefreshViews(eventId);
        showToast('Back to unpaid.', 'info');
      });
    }

    // ── Invoice list, shared by the Money page and the event Money tab ─────────
    function _mnyVerb(inv, now) {
      const st = _mnyInvStatus(inv, now);
      if (st === 'paid') return { label: 'PDF', fn: `exportInvoicePDF('${esc(inv.id)}')`, icon: 'download' };
      if (st === 'void') return null;
      if (!inv.sentAt) return { label: 'Send', fn: `sendInvoiceConfirm('${esc(inv.id)}')`, icon: 'send' };
      return { label: 'Remind', fn: `sendInvoiceConfirm('${esc(inv.id)}',{reminder:true})`, icon: 'send' };
    }
    function _mnyInvActions(inv, now) {
      const v = _mnyVerb(inv, now);
      const st = _mnyInvStatus(inv, now);
      const pr = _mnyReport(_mnyEvent(inv.eventId));
      const reported = pr && st !== 'paid' && (!pr.invoice || String(pr.invoice) === String(inv.invoiceNum || '') || String(pr.invoice) === String(inv.id));
      const verb = reported
        ? `<button type="button" class="btn btn-secondary btn-sm mny-confirm" onclick="confirmPaymentReport('${esc(inv.eventId)}')">Confirm paid</button>`
        : v ? `<button type="button" class="btn btn-secondary btn-sm" onclick="${v.fn}">${v.label}</button>` : '';
      return verb + `<button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="More for invoice ${esc(_mnyNum(inv))}" onclick="_mnyInvMenu(this,'${esc(inv.id)}')">${_mnyIcon('ellipsis-vertical', 18)}</button>`;
    }
    function _mnyInvMenu(btn, id) {
      const inv = (getDB('invoices') || []).find(i => i.id === id);
      if (!inv || typeof CRMUI === 'undefined') return;
      const st = _mnyInvStatus(inv, new Date());
      const items = [];
      if (st !== 'paid' && st !== 'void') items.push({ label: 'Mark paid', icon: 'circle-check', onSelect: () => markInvoicePaid(id) });
      if (st === 'paid') items.push({ label: 'Mark unpaid', icon: 'undo-2', onSelect: () => markInvoiceUnpaid(id) });
      items.push({ label: 'Download PDF', icon: 'download', onSelect: () => exportInvoicePDF(id) });
      if (inv.eventId && typeof navigateToEvent === 'function' && _mnyEvent(inv.eventId)) items.push({ label: 'Open event', icon: 'arrow-up-right', onSelect: () => navigateToEvent(inv.eventId) });
      items.push({ label: 'Delete invoice', icon: 'trash-2', danger: true, onSelect: () => deleteInvoice(id) });
      CRMUI.menu(btn, items, { label: 'Invoice actions', align: 'right' });
    }
    // ctx.client: show the client column (Money page). Event tab leaves it out.
    function _mnyInvList(list, ctx) {
      ctx = ctx || {};
      const now = new Date();
      const showClient = ctx.client !== false;
      const sorted = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const recv = (inv, st) => { const c = st === 'paid' ? 0 : _mnyInvPaidC(inv); return c > 0 ? ` <span class="pill pill-neutral pill-sm" data-ui="pill">${_mnyUSD(c)} received</span>` : ''; };
      const tbody = sorted.map(inv => {
        const st = _mnyInvStatus(inv, now);
        const due = inv.dueDate ? esc(_mnyShort(inv.dueDate, now)) : 'On receipt';
        const rep = _mnyReport(_mnyEvent(inv.eventId));
        const says = rep && st !== 'paid' && (!rep.invoice || String(rep.invoice) === String(inv.invoiceNum || '') || String(rep.invoice) === String(inv.id))
          ? ` <span class="pill pill-info pill-sm" data-ui="pill">Client says paid ${esc(_mnyShort(rep.at, now))}</span>` : '';
        const who = showClient
          ? `<td><div class="mny-cell-main" data-user-content>${esc(inv.clientName || '')}</div><div class="mny-cell-sub" data-user-content>${esc(inv.eventName || 'No event')}</div></td>`
          : '';
        return `<tr data-inv="${esc(inv.id)}"><td class="num mny-no">${esc(_mnyNum(inv))}</td>${who}<td class="num">${_mnyUSD(_mnyCents(inv.total))}</td><td>${due}</td><td>${_mnyPill(st)}${recv(inv, st)}${says}</td><td class="mny-acts">${_mnyInvActions(inv, now)}</td></tr>`;
      }).join('');
      const table = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>No.</th>${showClient ? '<th>Client and event</th>' : ''}<th class="num">Amount</th><th>Due</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="${ctx.bodyId || 'invoicesTableBody'}">${tbody}</tbody></table></div>`;
      const cards = sorted.map(inv => {
        const st = _mnyInvStatus(inv, now);
        const rep = _mnyReport(_mnyEvent(inv.eventId));
        const says = rep && st !== 'paid' && (!rep.invoice || String(rep.invoice) === String(inv.invoiceNum || '') || String(rep.invoice) === String(inv.id))
          ? ` <span class="pill pill-info pill-sm" data-ui="pill">Client says paid</span>` : '';
        const title = showClient ? esc(inv.clientName || 'No name') : 'Invoice ' + esc(_mnyNum(inv));
        const sub = showClient ? `<span class="num">${esc(_mnyNum(inv))}</span> · ${esc(inv.eventName || 'No event')}` : (inv.dueDate ? 'Due ' + esc(_mnyShort(inv.dueDate, now)) : 'Due on receipt');
        return `<div class="row mny-row" data-inv="${esc(inv.id)}">
          <div class="mny-row-top"><span class="row-title"${showClient ? ' data-user-content' : ''}>${title}</span><span class="mny-amt num">${_mnyUSD(_mnyCents(inv.total))}</span></div>
          <div class="row-sub"${showClient ? ' data-user-content' : ''}>${sub}</div>
          <div class="mny-row-bot"><span class="mny-row-state">${_mnyPill(st)}${recv(inv, st)}${says}${showClient ? `<span class="mny-due">${inv.dueDate ? 'Due ' + esc(_mnyShort(inv.dueDate, now)) : 'Due on receipt'}</span>` : ''}</span>
            <span class="mny-row-act">${_mnyInvActions(inv, now)}</span></div></div>`;
      }).join('');
      return table + `<div class="row-list">${cards}</div>`;
    }

    // ── Event Money tab (P2 mounts this inside #tabInvoices) ───────────────────
    function renderEventInvoices(event) {
      const ev = _mnyEvent(event && event.id) || event || {};
      const evInvoices = (getDB('invoices') || []).filter(i => i.eventId === ev.id && _mnyInvStatus(i, new Date()) !== 'void');
      const list = evInvoices.length
        ? _mnyInvList(evInvoices, { client: false, bodyId: 'eventInvoicesBody' })
        : `<div class="empty">${_mnyIcon('receipt', 32)}<h3 class="empty-title">No invoices on this event yet</h3><p class="empty-text">Create the deposit invoice from the schedule above, or build a quote first.</p></div>`;
      return `<div class="mny-tab">
        ${_mnyOffBanner()}
        ${_mnyReportCard(ev)}
        ${renderPaymentSchedule(ev)}
        <div class="card mny-card">
          <div class="card-head"><h2 class="card-title">Invoices</h2>
            <button type="button" class="btn btn-secondary btn-sm" onclick="openCreateInvoiceFromEvent('${esc(ev.id)}')">${_mnyIcon('plus', 16)}Create invoice</button></div>
          ${list}
        </div>
        <div class="mny-tab-foot"><button type="button" class="btn btn-secondary" onclick="openQuoteBuilderModal('${esc(ev.id)}',{fromEvent:true})">${_mnyIcon('file-text', 16)}Build quote</button></div>
      </div>`;
    }

    // ── Create invoice: the sheet's markup is built here (the page only carries an empty shell) ──
    function _mnyEnsureInvoiceModal() {
      const m = document.querySelector('#createInvoiceModal .modal');
      if (!m || m.dataset.mny === '1') return;
      m.dataset.mny = '1';
      m.style.setProperty('--mw', '680px');
      m.innerHTML = `
        <button type="button" class="modal-close btn btn-ghost btn-icon" onclick="closeModal('createInvoiceModal')" aria-label="Close">${_mnyIcon('x', 20)}</button>
        <div class="modal-title">New invoice</div>
        <form id="createInvoiceForm" onsubmit="saveInvoice(event)">
          <fieldset class="mny-chunk"><legend class="section-label">Who it is for</legend>
            <div class="field"><label class="field-label" for="invClientPicker">Pick a client</label>
              <select class="input" id="invClientPicker" onchange="autoFillInvoiceFromClient(this.value)"><option value="">Select an existing client</option></select></div>
            <div class="mny-two">
              <div class="field"><label class="field-label" for="invClientName">Client name</label><input type="text" class="input" id="invClientName" required autocomplete="off" placeholder="Or type a name"></div>
              <div class="field"><label class="field-label" for="invClientEmail">Client email</label><input type="email" class="input" id="invClientEmail" inputmode="email" autocomplete="off" placeholder="Fills from the client"></div>
            </div>
            <div class="field"><label class="field-label" for="invEventId">Linked event</label>
              <select class="input" id="invEventId" onchange="autoFillInvoiceFromEvent(this.value)"><option value="">No event linked</option></select></div>
          </fieldset>
          <fieldset class="mny-chunk"><legend class="section-label">Line items</legend>
            <div id="invQuick" class="mny-quick" hidden></div>
            <div id="invoiceLines" class="mny-lines"></div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="addInvoiceLine()">${_mnyIcon('plus', 16)}Add line</button>
          </fieldset>
          <fieldset class="mny-chunk"><legend class="section-label">Totals</legend>
            <div class="field mny-tax"><label class="field-label" for="invTax">Tax percent</label><input type="number" class="input" id="invTax" value="0" min="0" max="30" step="0.5" inputmode="decimal" oninput="updateInvoiceTotal()"></div>
            <div id="invBreakdown" class="mny-break" aria-live="polite"></div>
          </fieldset>
          <fieldset class="mny-chunk"><legend class="section-label">Due date and notes</legend>
            <div class="field"><label class="field-label" for="invDueDate">Due date</label><input type="date" class="input" id="invDueDate"></div>
            <div class="field"><label class="field-label" for="invNotes">Notes for the client</label><textarea class="input" id="invNotes" rows="2"></textarea></div>
          </fieldset>
          <div class="mny-foot modal-sticky-foot">
            <div class="mny-foot-total"><span class="mny-flabel">Total</span><span id="invoicePreviewTotal" class="mny-foot-amt num">$0</span></div>
            <div class="mny-foot-btns">
              <button type="button" class="btn btn-secondary" id="invSendBtn" onclick="saveAndSendInvoice()">Save and send</button>
              <button type="submit" class="btn btn-primary" id="invSaveBtn">Save</button>
            </div>
          </div>
        </form>`;
    }

    function openCreateInvoiceModal() {
      _mnyEnsureInvoiceModal();
      const events  = getDB('events')  || [];
      const clients = getDB('clients') || [];

      // Populate event dropdown
      const evSel = document.getElementById('invEventId');
      evSel.innerHTML = '<option value="">No event linked</option>';
      events.slice().sort((a,b) => new Date(b.date||0) - new Date(a.date||0))
        .forEach(e => evSel.insertAdjacentHTML('beforeend', `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.clientName)} (${esc(e.date || 'no date')})</option>`));

      // Populate client picker
      const cPicker = document.getElementById('invClientPicker');
      cPicker.innerHTML = '<option value="">Select an existing client</option>';
      clients.slice().sort((a,b) => (a.name||'').localeCompare(b.name||''))
        .forEach(c => cPicker.insertAdjacentHTML('beforeend', `<option value="${esc(c.id)}">${esc(c.name)}${c.email ? ' · ' + esc(c.email) : ''}</option>`));

      document.getElementById('createInvoiceForm').reset();
      evSel.value    = '';
      cPicker.value  = '';
      invoiceLineCount = 0;
      document.getElementById('invoiceLines').innerHTML = '';
      const quick = document.getElementById('invQuick');
      quick.hidden = true; quick.innerHTML = '';
      addInvoiceLine();
      addInvoiceLine();
      updateInvoiceTotal();
      openModal('createInvoiceModal');
    }

    // Presets for a linked event, straight from the payment schedule: deposit, balance, full amount.
    function _mnyPresets(ev) {
      const s = _mnySchedule(ev, getDB('invoices') || [], _mnyTerms(), new Date());
      if (!s.ok) return { s, list: [] };
      const list = [];
      s.rows.forEach(r => {
        if (r.paid) return;
        if (r.key === 'deposit') list.push({ key: 'deposit', chip: 'Deposit ' + _mnyUSD(r.amountC), desc: 'Deposit (' + r.pct + '%)', amountC: r.amountC, due: _mnyISO(new Date()) });
        else list.push({ key: 'balance', chip: 'Balance ' + _mnyUSD(r.amountC), desc: 'Balance', amountC: r.amountC, due: r.due ? _mnyISO(r.due) : '' });
      });
      if (s.remainingC > 0 && s.rows.length > 1 && s.paidC === 0) list.push({ key: 'full', chip: 'Full ' + _mnyUSD(s.remainingC), desc: 'Event services (full amount)', amountC: s.remainingC, due: '' });
      return { s, list };
    }
    function _mnyApplyPreset(eventId, key) {
      const ev = _mnyEvent(eventId);
      if (!ev) return;
      const p = _mnyPresets(ev).list.find(x => x.key === key);
      if (!p) return;
      document.getElementById('invoiceLines').innerHTML = '';
      invoiceLineCount = 0;
      addInvoiceLine(p.desc, p.amountC / 100);
      if (p.due) document.getElementById('invDueDate').value = p.due;
      updateInvoiceTotal();
      _mnyRenderQuick(eventId, key);
    }
    function _mnyRenderQuick(eventId, activeKey) {
      const host = document.getElementById('invQuick');
      if (!host) return;
      const ev = eventId ? _mnyEvent(eventId) : null;
      const list = ev ? _mnyPresets(ev).list : [];
      host.hidden = !list.length;
      host.innerHTML = list.length ? '<span class="mny-quick-label">From the schedule</span>' + list.map(p =>
        `<button type="button" class="chip${p.key === activeKey ? ' is-selected' : ''}" onclick="_mnyApplyPreset('${esc(eventId)}','${p.key}')">${esc(p.chip)}</button>`).join('') : '';
    }

    // prefill (all optional): { deposit: true } or { balance: true } picks that schedule row; { amount, label } sets one line by hand.
    // One-argument calls fill the next unpaid row of the schedule.
    function openCreateInvoiceFromEvent(eventId, prefill) {
      const ev = _mnyEvent(eventId);
      openCreateInvoiceModal();
      if (!ev) return;
      const p = prefill || {};
      document.getElementById('invEventId').value    = eventId;
      document.getElementById('invClientName').value = ev.clientName  || '';
      document.getElementById('invClientEmail').value= ev.clientEmail || '';
      const match = (getDB('clients') || []).find(c => (c.email || '').toLowerCase() === (ev.clientEmail || '').toLowerCase() && c.email);
      if (match) document.getElementById('invClientPicker').value = match.id;
      const pre = _mnyPresets(ev);
      let key = p.deposit ? 'deposit' : p.balance ? 'balance' : null;
      if (typeof p.amount === 'number' && p.amount > 0) {
        document.getElementById('invoiceLines').innerHTML = '';
        invoiceLineCount = 0;
        addInvoiceLine(p.label || (key === 'balance' ? 'Balance' : key === 'deposit' ? 'Deposit' : 'Event services'), p.amount);
        const hit = pre.list.find(x => x.key === key);
        if (hit && hit.due) document.getElementById('invDueDate').value = hit.due;
        updateInvoiceTotal();
        _mnyRenderQuick(eventId, key);
        return;
      }
      if (!key && pre.list.length) key = pre.list[0].key;
      if (key && pre.list.some(x => x.key === key)) { _mnyApplyPreset(eventId, key); return; }
      if (ev.basePrice && ev.basePrice > 0) {
        document.getElementById('invoiceLines').innerHTML = '';
        invoiceLineCount = 0;
        addInvoiceLine('Event services for ' + (ev.name || 'the event'), ev.basePrice);
        updateInvoiceTotal();
      }
      _mnyRenderQuick(eventId, null);
    }

    function autoFillInvoiceFromEvent(eventId) {
      _mnyRenderQuick(eventId || '', null);
      if (!eventId) return;
      const ev = _mnyEvent(eventId);
      if (!ev) return;
      if (ev.clientName)  document.getElementById('invClientName').value  = ev.clientName;
      if (ev.clientEmail) document.getElementById('invClientEmail').value = ev.clientEmail;
      // Also sync the client picker dropdown
      const clients = getDB('clients') || [];
      const match   = clients.find(c => (c.email || '').toLowerCase() === (ev.clientEmail || '').toLowerCase());
      if (match) document.getElementById('invClientPicker').value = match.id;
    }

    function autoFillInvoiceFromClient(clientId) {
      if (!clientId) return;
      const client = (getDB('clients') || []).find(c => c.id === clientId);
      if (!client) return;
      document.getElementById('invClientName').value  = client.name  || '';
      document.getElementById('invClientEmail').value = client.email || '';
    }

    let invoiceLineCount = 0;
    function addInvoiceLine(desc='', amount='', qty) {
      invoiceLineCount++;
      const n = invoiceLineCount;
      const div = document.createElement('div');
      div.className = 'mny-line form-section';
      div.id = 'invLine' + n;
      div.innerHTML = `<div class="mny-l-desc"><input type="text" class="input" aria-label="Description" placeholder="Description" value="${esc(desc)}" oninput="updateInvoiceTotal()"></div>
        <div class="mny-l-nums">
          <div class="mny-qty"><button type="button" class="btn btn-secondary btn-icon btn-sm" aria-label="One fewer" onclick="_mnyQty(this,-1)">${_mnyIcon('minus', 16)}</button><input type="number" class="input" aria-label="Quantity" inputmode="numeric" min="1" step="1" value="${esc(String(qty || 1))}" oninput="updateInvoiceTotal()"><button type="button" class="btn btn-secondary btn-icon btn-sm" aria-label="One more" onclick="_mnyQty(this,1)">${_mnyIcon('plus', 16)}</button></div>
          <div class="input-wrap input-money mny-l-unit"><span class="input-prefix" aria-hidden="true">$</span><input type="number" class="input" aria-label="Unit price" placeholder="0.00" inputmode="decimal" step="0.01" value="${esc(String(amount))}" oninput="updateInvoiceTotal()"></div>
          <div class="mny-l-total num" data-line-total>$0</div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Remove line" onclick="this.closest('.mny-line').remove();updateInvoiceTotal()">${_mnyIcon('x', 16)}</button>
        </div>`;
      document.getElementById('invoiceLines').appendChild(div);
    }
    function _mnyQty(btn, d) {
      const inp = btn.parentElement.querySelector('input');
      const v = Math.max(1, (parseInt(inp.value, 10) || 1) + d);
      inp.value = String(v);
      updateInvoiceTotal();
    }
    // Reads the sheet. Each line is qty x unit price in cents; tax is on the subtotal. Rows with nothing in them are ignored.
    function _mnyReadInvoice() {
      const lines = [];
      let subC = 0;
      document.querySelectorAll('#invoiceLines .mny-line').forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = (inputs[0].value || '').trim();
        const qtyRaw = parseFloat(inputs[1].value);
        const qty = isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
        const unit = parseFloat(inputs[2].value) || 0;
        const amountC = Math.round(qty * unit * 100);
        const tot = r.querySelector('[data-line-total]');
        if (tot) tot.textContent = _mnyUSD(amountC);
        if (!desc && !amountC) return;
        lines.push({ desc: desc || 'Item', qty, unit, amountC });
        subC += amountC;
      });
      const tax = parseFloat((document.getElementById('invTax') || {}).value) || 0;
      const taxC = Math.round(subC * tax / 100);
      return { lines, subC, taxC, totalC: subC + taxC, tax };
    }
    function updateInvoiceTotal() {
      const r = _mnyReadInvoice();
      const tot = document.getElementById('invoicePreviewTotal');
      if (tot) tot.textContent = _mnyUSD(r.totalC);
      const br = document.getElementById('invBreakdown');
      if (br) br.innerHTML = `<div><span>Subtotal</span><span class="num">${_mnyUSD(r.subC)}</span></div>${r.tax ? `<div><span>Tax (${esc(String(r.tax))}%)</span><span class="num">${_mnyUSD(r.taxC)}</span></div>` : ''}<div class="is-total"><span>Total</span><span class="num">${_mnyUSD(r.totalC)}</span></div>`;
      const em = document.getElementById('invClientEmail');
      const sb = document.getElementById('invSendBtn');
      if (sb) sb.title = em && em.value ? 'Sends to ' + em.value : 'Add a client email to send it';
    }

    // Stores one invoice. data: { clientName, clientEmail, eventId, lines: [{desc, qty, unit, amountC}], tax, dueDate, notes }.
    function _mnyStoreInvoice(data) {
      const linked = _mnyEvent(data.eventId);
      const invoices = getDB('invoices') || [];
      const maxNum = invoices.reduce((m, i) => Math.max(m, parseInt(String(i.invoiceNum || '').replace(/\D/g, ''), 10) || 0), 0);
      const subC = data.lines.reduce((s, l) => s + l.amountC, 0);
      const taxC = Math.round(subC * (data.tax || 0) / 100);
      const inv = {
        id: genId(),
        invoiceNum: 'INV-' + String(maxNum + 1).padStart(4, '0'),
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        eventId: data.eventId || '', eventName: linked ? (linked.name || '') : '',
        lines: data.lines.map(l => ({ desc: l.qty > 1 ? l.desc + ' (x' + l.qty + ')' : l.desc, amount: l.amountC / 100 })),
        subtotal: subC / 100, taxPct: data.tax || 0, total: (subC + taxC) / 100,
        dueDate: data.dueDate || '',
        notes: data.notes || '',
        status: 'unpaid',
        createdAt: Date.now()
      };
      invoices.push(inv);
      setDB('invoices', invoices);
      return inv;
    }

    // Builds and stores the invoice from the sheet. Returns it, or null (with a toast) when the sheet is not ready.
    function _mnyCreateFromForm() {
      const form = document.getElementById('createInvoiceForm');
      if (!form) return null;
      if (!form.checkValidity()) { form.reportValidity(); return null; }
      const r = _mnyReadInvoice();
      if (!r.lines.length || r.totalC <= 0) { showToast('Add a price to at least one line.', 'warning'); return null; }
      const inv = _mnyStoreInvoice({
        clientName: document.getElementById('invClientName').value.trim(),
        clientEmail: document.getElementById('invClientEmail').value.trim(),
        eventId: document.getElementById('invEventId').value,
        lines: r.lines, tax: r.tax,
        dueDate: document.getElementById('invDueDate').value,
        notes: document.getElementById('invNotes').value
      });
      closeModal('createInvoiceModal');
      _mnyRefreshViews();
      return inv;
    }

    // Headless version for other lanes (no sheet opens): createInvoiceFromEvent(eventId, { deposit|balance, amount, label }, { send }) -> Promise<invoice|null>.
    async function createInvoiceFromEvent(eventId, prefill, opts) {
      const ev = _mnyEvent(eventId);
      if (!ev) return null;
      const p = prefill || {};
      const pre = _mnyPresets(ev);
      let key = p.deposit ? 'deposit' : p.balance ? 'balance' : (pre.list[0] && pre.list[0].key) || null;
      const hit = pre.list.find(x => x.key === key);
      let amountC = typeof p.amount === 'number' && p.amount > 0 ? _mnyCents(p.amount) : hit ? hit.amountC : _mnyCents(ev.basePrice);
      if (amountC <= 0) { showToast('This event has no price yet. Add one first.', 'warning'); return null; }
      const desc = p.label || (hit ? hit.desc : 'Event services for ' + (ev.name || 'the event'));
      const inv = _mnyStoreInvoice({ clientName: ev.clientName || '', clientEmail: ev.clientEmail || '', eventId, lines: [{ desc, qty: 1, unit: amountC / 100, amountC }], tax: 0, dueDate: hit ? hit.due : '', notes: '' });
      _mnyRefreshViews();
      if (opts && opts.send && inv.clientEmail) await sendInvoice(inv.id);
      return inv;
    }

    function saveInvoice(e) {
      if (e && e.preventDefault) e.preventDefault();
      const inv = _mnyCreateFromForm();
      if (!inv) return null;
      showUndoToast('Invoice ' + _mnyNum(inv) + ' saved.', function () {
        setDB('invoices', (getDB('invoices') || []).filter(i => i.id !== inv.id));
        _mnyRefreshViews();
        showToast('Invoice ' + _mnyNum(inv) + ' removed.', 'info');
      });
      return inv;
    }

    function saveAndExportInvoice() {
      const inv = _mnyCreateFromForm();
      if (!inv) return;
      showToast('Invoice ' + _mnyNum(inv) + ' saved.', 'success');
      exportInvoicePDF(inv.id);
    }

    async function saveAndSendInvoice() {
      const btn = document.getElementById('invSendBtn');
      const form = document.getElementById('createInvoiceForm');
      if (!form) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      _mnyMarkBusy(btn, true);
      const inv = _mnyCreateFromForm();
      _mnyMarkBusy(btn, false);
      if (!inv) return;
      if (inv.clientEmail) await sendInvoice(inv.id);
      else showToast('Invoice saved. Add a client email to send it.', 'info');
    }

    async function sendInvoice(invId, opts) {
      opts = opts || {};
      const invoices = getDB('invoices') || [];
      const inv = invoices.find(i => i.id === invId);
      if (!inv) return;
      if (!inv.clientEmail) {
        showToast('No client email on this invoice. Add one on the client record first.', 'warning');
        return;
      }

      const lineText = (inv.lines || []).map(l => `  ${l.desc}: $${(l.amount||0).toFixed(2)}`).join('\n');
      const d = _mnyDate(inv.dueDate);
      const dueStr   = d ? _mnyLong(d) : 'Upon receipt';
      const firstName = (inv.clientName || 'there').split(' ')[0];
      const body = `Hey ${firstName},\n\n${opts.reminder ? 'A quick reminder about your invoice from Baseline Studio.' : 'Your invoice from Baseline Studio is ready.'}\n\nInvoice #: ${inv.invoiceNum}${inv.eventName ? '\nEvent: ' + inv.eventName : ''}\n\n${lineText}\n\nTotal Due: $${(inv.total||0).toFixed(2)}\nDue: ${dueStr}${inv.notes ? '\n\n' + inv.notes : ''}\n\nYou can view your event portal here:\nhttps://www.baselinestudiofl.com/portal-client.html\n\nReach out if you have any questions.\n\nSaul, Baseline Studio\n(786) 302-6056`;

      const result = await BSPortal.sendEmail('invoice', {
        email: inv.clientEmail,
        clientName: inv.clientName || 'there',
        invoiceNum: inv.invoiceNum,
        eventName: inv.eventName || '',
        lines: inv.lines || [],
        subtotal: inv.subtotal || inv.total || 0,
        taxPct: inv.taxPct || 0,
        total: inv.total || 0,
        dueDate: dueStr,
        notes: inv.notes || ''
      });

      if (result.ok) {
        showToast((opts.reminder ? 'Reminder sent to ' : 'Invoice sent to ') + inv.clientEmail + '.', 'success');
        // Mark as sent
        inv.sentAt = Date.now();
        if (opts.reminder) inv.remindedAt = Date.now();
        setDB('invoices', invoices);
        _mnyRefreshViews();
      } else {
        showEmailFallback(inv.clientEmail, `Invoice ${inv.invoiceNum} - Baseline Studio`, body,
          'Email is not available right now. Send it yourself:');
      }
    }

    // List and schedule buttons come here: a send always asks first, because an email goes to the client.
    async function sendInvoiceConfirm(id, opts) {
      opts = opts || {};
      const inv = (getDB('invoices') || []).find(i => i.id === id);
      if (!inv) return;
      if (!inv.clientEmail) { showToast('No client email on this invoice. Add one on the client record first.', 'warning'); return; }
      const due = _mnyDate(inv.dueDate);
      const ok = await _mnyConfirm({
        title: (opts.reminder ? 'Send a reminder to ' : 'Send this invoice to ') + inv.clientEmail + '?',
        body: 'Invoice ' + _mnyNum(inv) + ' for ' + _mnyUSD(_mnyCents(inv.total)) + (due ? ', due ' + _mnyShort(due) : '') + '. It goes out now.',
        confirmLabel: opts.reminder ? 'Send reminder' : 'Send invoice'
      });
      if (ok) await sendInvoice(id, opts);
    }

    // Records money received on an invoice. amount in dollars; 0 or missing means "whatever is still owed".
    // opts: { method, date, note, fromReport, toast (default false), refresh (default true) }.
    // The payment is appended to inv.payments and a transaction is logged. The invoice becomes paid only when payments reach the total;
    // until then its status is 'partial'. Deposit/balance flags on the event follow only a full payment. A "client says paid" report on the
    // same invoice is marked confirmed either way.
    // Returns { ok, invoice, payment, status, paidC, remainingC, snapshot, undo() } or { ok: false, reason }.
    // undo() puts the invoice, the event flags, the report and the transaction list back exactly as they were.
    function recordInvoicePayment(invoiceId, amount, opts) {
      opts = opts || {};
      const invoices = getDB('invoices') || [];
      const inv = invoices.find(i => i.id === invoiceId);
      if (!inv) return { ok: false, reason: 'not found' };
      const totalC = _mnyCents(inv.total);
      const paidBeforeC = _mnyInvPaidC(inv);
      if (String(inv.status || '').toLowerCase() === 'paid' && paidBeforeC >= totalC) return { ok: false, reason: 'already paid' };
      let amtC = _mnyCents(amount);
      if (!(amtC > 0)) amtC = Math.max(0, totalC - paidBeforeC);
      if (!(amtC > 0)) return { ok: false, reason: 'nothing owed' };
      const when = (opts.date && _mnyDate(opts.date)) ? _mnyDate(opts.date).getTime() : Date.now();
      const snapshot = { invoiceId, status: inv.status, hadPaidAt: 'paidAt' in inv, paidAt: inv.paidAt, hadPayments: Array.isArray(inv.payments),
        payments: Array.isArray(inv.payments) ? inv.payments.slice() : undefined, txId: null, flag: null, flagPrev: undefined, confirmed: false };
      const method = opts.method || (opts.fromReport ? 'Zelle' : '');
      const payment = { id: genId(), amount: amtC / 100, method: method || 'Manual', date: when, note: opts.note || '' };
      inv.payments = (Array.isArray(inv.payments) ? inv.payments : []).concat([payment]);
      const newPaidC = paidBeforeC + amtC;
      const full = newPaidC >= totalC;
      inv.status = full ? 'paid' : 'partial';
      if (full) inv.paidAt = when;
      setDB('invoices', invoices);
      const transactions = getDB('transactions') || [];
      const tx = { id: genId(), invoiceId: inv.id, invoiceNum: inv.invoiceNum, clientName: inv.clientName, amount: amtC / 100, type: 'Invoice Payment', note: inv.invoiceNum, date: when };
      if (method) tx.method = method;
      transactions.push(tx);
      setDB('transactions', transactions);
      snapshot.txId = tx.id;
      const events = getDB('events') || [];
      const ev = events.find(e => e && e.id === inv.eventId);
      if (ev) {
        let touched = false;
        const kind = _mnyKind(inv);
        const flag = kind === 'deposit' ? 'depositPaid' : kind === 'balance' ? 'balancePaid' : null;
        if (full && flag && ev[flag] !== true) { snapshot.flag = flag; snapshot.flagPrev = ev[flag]; ev[flag] = true; touched = true; }
        const pr = _mnyReport(ev);
        if (pr && (!pr.invoice || String(pr.invoice) === String(inv.invoiceNum || '') || String(pr.invoice) === String(inv.id))) { pr.confirmedAt = new Date().toISOString(); snapshot.confirmed = true; touched = true; }
        if (touched) setDB('events', events);
      }
      // One place decides the event stage from payments and signatures (45-sync.js).
      let syncRes = null;
      if (ev && typeof syncEvent === 'function') { syncRes = syncEvent(ev.id, { source: 'payment', refresh: false }); snapshot.sync = syncRes; }
      window._mnyUndo = window._mnyUndo || {};
      window._mnyUndo[invoiceId] = snapshot;
      if (opts.refresh !== false) { _mnyRefreshViews(); if (typeof _syncRefreshViews === 'function' && ev) _syncRefreshViews(ev.id); }
      const res = { ok: true, invoice: inv, payment, status: inv.status, paidC: newPaidC, remainingC: Math.max(0, totalC - newPaidC), snapshot, undo: () => _undoRecordPayment(snapshot) };
      if (opts.toast) {
        const who = inv.clientName || 'invoice';
        const syncNote = syncRes && syncRes.changed && syncRes.note ? ' ' + syncRes.note : '';
        showUndoToast((full ? 'Marked paid: ' + who + ', ' + _mnyUSD(amtC) + '.' : 'Recorded ' + _mnyUSD(amtC) + ' from ' + who + '. ' + _mnyUSD(res.remainingC) + ' still due.') + syncNote, res.undo);
      }
      return res;
    }
    function _undoRecordPayment(snapshot) {
      if (!snapshot) return;
      if (snapshot.sync && typeof snapshot.sync.undo === 'function') { try { snapshot.sync.undo(); } catch (e) {} }
      const id = snapshot.invoiceId;
      if (window._mnyUndo && window._mnyUndo[id] === snapshot) delete window._mnyUndo[id];
      const invoices = getDB('invoices') || [];
      const inv = invoices.find(i => i.id === id);
      if (!inv) return;
      inv.status = snapshot.status || 'unpaid';
      if (snapshot.hadPaidAt) inv.paidAt = snapshot.paidAt; else delete inv.paidAt;
      if (snapshot.hadPayments) inv.payments = snapshot.payments; else delete inv.payments;
      setDB('invoices', invoices);
      setDB('transactions', (getDB('transactions') || []).filter(t => t.id !== snapshot.txId));
      const events = getDB('events') || [];
      const ev = events.find(e => e && e.id === inv.eventId);
      if (ev) {
        if (snapshot.flag) ev[snapshot.flag] = snapshot.flagPrev === undefined ? false : snapshot.flagPrev;
        const pr = ev.clientNotes && ev.clientNotes.paymentReported;
        if (snapshot.confirmed && pr) delete pr.confirmedAt;
        setDB('events', events);
      }
      _mnyRefreshViews();
      if (typeof _syncRefreshViews === 'function' && ev) _syncRefreshViews(ev.id);
      showToast('Back to what it was.', 'info');
    }

    // Optimistic: it is paid the moment you tap (the rest of what is owed), and the toast offers Undo.
    function markInvoicePaid(id, opts) {
      recordInvoicePayment(id, 0, Object.assign({}, opts || {}, { toast: true }));
    }
    function _undoMarkPaid(id) {
      const prev = (window._mnyUndo || {})[id];
      if (!prev) { markInvoiceUnpaid(id); return; }
      _undoRecordPayment(prev);
    }
    // The long way back, for a mistake noticed after the Undo toast is gone.
    function markInvoiceUnpaid(id) {
      const invoices = getDB('invoices') || [];
      const inv = invoices.find(i => i.id === id);
      if (!inv) return;
      inv.status = 'unpaid';
      delete inv.paidAt;
      delete inv.payments;
      setDB('invoices', invoices);
      setDB('transactions', (getDB('transactions') || []).filter(t => !(t.invoiceId === id || (t.type === 'Invoice Payment' && t.note && t.note === inv.invoiceNum))));
      const events = getDB('events') || [];
      const ev = events.find(e => e && e.id === inv.eventId);
      const kind = _mnyKind(inv);
      if (ev && (kind === 'deposit' || kind === 'balance') && !invoices.some(i => i.id !== id && i.eventId === inv.eventId && _mnyKind(i) === kind && _mnyInvStatus(i, new Date()) === 'paid')) {
        ev[kind === 'deposit' ? 'depositPaid' : 'balancePaid'] = false;
        setDB('events', events);
      }
      _mnyRefreshViews();
      if (typeof _syncRefreshViews === 'function' && ev) _syncRefreshViews(ev.id);
      showToast('Marked unpaid.', 'info');
    }

    function deleteInvoice(id) {
      const invoices = getDB('invoices') || [];
      const idx = invoices.findIndex(i => i.id === id);
      if (idx < 0) return;
      const inv = invoices[idx];
      setDB('invoices', invoices.filter(i => i.id !== id));
      _mnyRefreshViews();
      showUndoToast('Invoice ' + _mnyNum(inv) + ' deleted.', function () {
        const cur = getDB('invoices') || [];
        cur.splice(Math.min(idx, cur.length), 0, inv);
        setDB('invoices', cur);
        if (typeof syncEvent === 'function' && inv.eventId) syncEvent(inv.eventId, { source: 'payment', refresh: false });
        _mnyRefreshViews();
        if (typeof _syncRefreshViews === 'function' && inv.eventId) _syncRefreshViews(inv.eventId);
      });
    }

    // ── Print popups (paper: white page, near-black text, #0b5f87 accents, #595959 meta) ──
    function _mnyPaperCss() {
      return 'html,body{background:#fff;color:#111}body{font-family:Arial,Helvetica,sans-serif;margin:40px;font-size:14px;line-height:1.5}'
        + 'h1,h2,h3{color:#111;margin:0 0 4px}h1{font-size:26px;letter-spacing:.02em}.acc{color:#0b5f87}.meta{color:#595959}'
        + '.head{display:flex;justify-content:space-between;gap:24px;margin-bottom:28px}.r{text-align:right}'
        + 'table{width:100%;border-collapse:collapse}th{background:#f3f3f3;color:#111;padding:8px;text-align:left;font-size:12px}td{padding:8px;border-bottom:1px solid #ddd;color:#111}'
        + '.tot{margin-top:16px;text-align:right}.tot .big{font-size:22px;font-weight:bold;color:#0b5f87}'
        + '.stamp{display:inline-block;border:2px solid #0b5f87;color:#0b5f87;font-weight:bold;padding:2px 10px;letter-spacing:.08em}'
        + '.box{margin-top:20px;padding:12px;background:#f7f7f7;border-radius:4px;color:#111}'
        + '@media print{body{margin:14mm}}';
    }
    function _mnyPaper(title, body) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${_mnyPaperCss()}</style></head><body>${body}</body></html>`;
    }
    function exportInvoicePDF(id) {
      const invoices = getDB('invoices') || [];
      const inv = invoices.find(i => i.id === id);
      if (!inv) return;
      const paid = String(inv.status || '').toLowerCase() === 'paid';
      const lines = (inv.lines||[]).map(l => `<tr><td>${esc(l.desc)}</td><td class="r">${_mnyUSD(_mnyCents(l.amount))}</td></tr>`).join('');
      const due = _mnyDate(inv.dueDate);
      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to open the PDF.', 'warning'); return; }
      w.document.write(_mnyPaper(inv.invoiceNum || 'Invoice', `
        <div class="head">
          <div><h1>${paid ? 'RECEIPT' : 'INVOICE'}</h1><div class="meta">${esc(inv.invoiceNum)}</div>${inv.eventName ? `<div class="meta">${esc(inv.eventName)}</div>` : ''}</div>
          <div class="r"><strong>Baseline Studio</strong><br>(786) 302-6056<br>Hello@baselinestudiofl.com</div>
        </div>
        <div class="head">
          <div><strong>Bill to</strong><br>${esc(inv.clientName)}<br><span class="meta">${esc(inv.clientEmail || '')}</span></div>
          <div class="r"><strong>Date</strong> ${esc(_mnyLong(inv.createdAt))}<br><strong>Due</strong> ${due ? esc(_mnyLong(due)) : 'Upon receipt'}${paid ? `<br><span class="stamp">PAID${inv.paidAt ? ' ' + esc(_mnyShort(inv.paidAt)) : ''}</span>` : ''}</div>
        </div>
        <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>${lines}</tbody></table>
        <div class="tot"><div>Subtotal ${_mnyUSD(_mnyCents(inv.subtotal))}</div>${inv.taxPct ? `<div>Tax (${esc(inv.taxPct)}%) ${_mnyUSD(_mnyCents(inv.total) - _mnyCents(inv.subtotal))}</div>` : ''}<div class="big">${paid ? 'Paid' : 'Total due'} ${_mnyUSD(_mnyCents(inv.total))}</div></div>
        ${paid ? '' : _mnyHowToPay(inv)}
        ${inv.notes ? `<div class="box"><strong>Notes.</strong> ${esc(inv.notes)}</div>` : ''}`));
      w.document.close();
      w.print();
    }

    function toggleDepositPaid(eventId, paid) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.depositPaid = paid;
      setDB('events', events);
      if (paid) {
        // Stage follows payments and signatures through syncEvent (45-sync.js): a deposit books the event, it does not confirm it.
        const r = typeof syncEvent === 'function' ? syncEvent(eventId, { source: 'payment' }) : null;
        if (r && r.changed && r.note) showUndoToast('Deposit received. ' + r.note, r.undo);
        // Non-blocking card with an inline "Send invite" action
        const old = document.getElementById('depositInviteCard');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.id = 'depositInviteCard';
        toast.className = 'mny-invite';
        toast.setAttribute('role', 'status');
        toast.innerHTML = `<div class="mny-invite-title">${_mnyIcon('circle-check', 18)}Deposit received</div>
          <div class="mny-invite-sub">Send the client their portal access?</div>
          <div class="mny-invite-btns">
            <button type="button" class="btn btn-secondary" onclick="sendPortalInvite('${esc(eventId)}');this.closest('.mny-invite').remove()">Send invite</button>
            <button type="button" class="btn btn-ghost" onclick="this.closest('.mny-invite').remove()">Later</button>
          </div>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 8000);
      }
      if (typeof renderEvents === 'function') renderEvents();
    }

    function toggleBalancePaid(eventId, paid) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.balancePaid = paid;
      setDB('events', events);
      const r = paid && typeof syncEvent === 'function' ? syncEvent(eventId, { source: 'payment' }) : null;
      if (r && r.changed && r.note) showUndoToast('Balance marked paid. ' + r.note, r.undo);
      else showToast(paid ? 'Balance marked paid. Fully collected.' : 'Balance marked unpaid.', paid ? 'success' : 'info');
      if (typeof renderEvents === 'function') renderEvents();
    }

    // ── Reports money (P0.8): Billed and Collected come from invoices and logged payments ──
    // Billed      = invoices created in the range (void/cancelled excluded).
    // Collected   = invoices marked paid (by paidAt) + logged payments (transactions) in the range.
    //               markInvoicePaid also logs a transaction with the invoice number, so a transaction that
    //               points at a paid invoice (note / invoiceNum / invoiceId) is skipped: counted once.
    // Outstanding = unpaid invoices created in the range.
    function _reportRangeBounds(key, now) {
      const d = new Date(now === undefined ? Date.now() : now);
      const y = d.getFullYear(), m = d.getMonth();
      if (key === 'month') return { from: new Date(y, m, 1).getTime(), to: new Date(y, m + 1, 1).getTime() };
      if (key === 'last_month') return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
      if (key === 'last90') return { from: d.getTime() - 90 * 86400000, to: d.getTime() + 1 };
      if (key === 'year') return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
      return { from: null, to: null }; // all time
    }
    function _reportsMoney(invoices, transactions, bounds) {
      const b = bounds || { from: null, to: null };
      const inRange = ts => {
        if (b.from === null) return true;
        const t = (typeof ts === 'number') ? ts : new Date(ts).getTime();
        return !isNaN(t) && t >= b.from && t < b.to;
      };
      const cents = v => Math.round((Number(v) || 0) * 100);
      const live = (invoices || []).filter(i => i && !/^(void|voided|cancelled|canceled)$/i.test(String(i.status || '')));
      const paid = live.filter(i => i.status === 'paid');
      const paidNums = new Set(paid.map(i => String(i.invoiceNum || '').trim().toLowerCase()).filter(Boolean));
      const paidIds = new Set(paid.map(i => String(i.id || '')).filter(Boolean));
      let billed = 0, collected = 0, outstanding = 0, billedCount = 0, paidCount = 0, txCount = 0;
      live.forEach(i => {
        if (inRange(i.createdAt)) {
          billed += cents(i.total); billedCount++;
          if (i.status !== 'paid') outstanding += cents(i.total);
        }
      });
      paid.forEach(i => { if (inRange(i.paidAt || i.createdAt)) { collected += cents(i.total); paidCount++; } });
      (transactions || []).forEach(t => {
        if (!t || !(Number(t.amount) > 0) || /refund/i.test(String(t.type || ''))) return;
        if (!inRange(t.date)) return;
        const tokens = (String(t.note || '') + ' ' + String(t.invoiceNum || '')).match(/INV-\d+/gi) || [];
        const linkedToPaid = tokens.some(k => paidNums.has(k.toLowerCase())) || (t.invoiceId && paidIds.has(String(t.invoiceId)));
        if (linkedToPaid) return;
        collected += cents(t.amount); txCount++;
      });
      return { billed: billed / 100, collected: collected / 100, outstanding: outstanding / 100, billedCount, paidCount, txCount };
    }
    function _fmtMoney(n) {
      const whole = Math.abs(n - Math.round(n)) < 0.005;
      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    }

    function renderReports() {
      const events = getDB('events');
      const rangeEl = document.getElementById('reportRange');
      const money = _reportsMoney(getDB('invoices') || [], getDB('transactions') || [], _reportRangeBounds(rangeEl ? rangeEl.value : 'all'));

      let html = '';
      [
        { label: 'Total Billed', value: _fmtMoney(money.billed) },
        { label: 'Collected', value: _fmtMoney(money.collected) },
        { label: 'Outstanding', value: _fmtMoney(money.outstanding) }
      ].forEach(s => {
        html += `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value" style="font-size: 24px;">${s.value}</div></div>`;
      });
      document.getElementById('reportsStats').innerHTML = html;

      const typeChart = {};
      events.forEach(e => { typeChart[e.type] = (typeChart[e.type] || 0) + 1; });
      let typeHtml = '<ul style="list-style: none;">';
      Object.entries(typeChart).forEach(([type, count]) => {
        typeHtml += `<li style="padding: 10px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;"><span>${type}</span><strong>${count}</strong></li>`;
      });
      document.getElementById('typeChart').innerHTML = typeHtml + '</ul>';

      const statusChart = {};
      events.forEach(e => { statusChart[e.status] = (statusChart[e.status] || 0) + 1; });
      let statusHtml = '<ul style="list-style: none;">';
      Object.entries(statusChart).forEach(([status, count]) => {
        statusHtml += `<li style="padding: 10px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;"><span class="badge badge-${status}">${status}</span><strong>${count}</strong></li>`;
      });
      document.getElementById('statusChart').innerHTML = statusHtml + '</ul>';
    }

    //
    //  INVOICES PAGE (Money): Invoices, Payments, Quotes
    //
    // The page owns #invoices: the shell is written once, then each render fills the parts so the search box keeps focus while you type.
    function _mnyShell() {
      const sec = document.getElementById('invoices');
      if (!sec) return null;
      if (sec.querySelector('#moneyShell')) return sec;
      window._mnyState = window._mnyState || { tab: 'invoices', status: 'all' };
      sec.innerHTML = `<div class="mny" id="moneyShell">
        <div class="tabs" role="tablist" aria-label="Money" id="moneyTabs">
          <button type="button" class="tab-btn active" role="tab" aria-selected="true" data-mtab="invoices" onclick="switchMoneyTab('invoices')">Invoices</button>
          <button type="button" class="tab-btn" role="tab" aria-selected="false" data-mtab="payments" onclick="switchMoneyTab('payments')">Payments</button>
          <button type="button" class="tab-btn" role="tab" aria-selected="false" data-mtab="quotes" onclick="switchMoneyTab('quotes')">Quotes</button>
        </div>
        <div id="moneyReports"></div>
        <div id="moneyPanelInvoices" role="tabpanel">
          <div class="mny-stats" id="invoiceTotals"></div>
          <div class="mny-toolbar">
            <div class="mny-seg-wrap"><div class="seg" id="invoiceSeg" role="group" aria-label="Filter by status"></div></div>
            <div class="input-wrap input-search mny-search">${_mnyIcon('search', 16)}<input type="search" class="input" id="invoiceSearch" placeholder="Search invoices" aria-label="Search invoices" autocomplete="off" oninput="renderInvoices()"></div>
          </div>
          <div id="invoicesListMount"></div>
        </div>
        <div id="moneyPanelPayments" role="tabpanel" hidden></div>
        <div id="moneyPanelQuotes" role="tabpanel" hidden></div>
      </div>`;
      return sec;
    }
    function switchMoneyTab(tab) {
      window._mnyState = window._mnyState || { tab: 'invoices', status: 'all' };
      window._mnyState.tab = tab;
      renderInvoices();
    }
    function setInvoiceFilter(status) {
      window._mnyState = window._mnyState || { tab: 'invoices', status: 'all' };
      window._mnyState.status = status;
      renderInvoices();
    }
    function _mnySearchText() {
      const raw = (document.getElementById('invoiceSearch') || {}).value || '';
      if (typeof CRMUI !== 'undefined' && CRMUI.norm && CRMUI.norm.fold) return CRMUI.norm.fold(raw);
      return raw.toLowerCase();
    }
    function _mnyFold(s) {
      return (typeof CRMUI !== 'undefined' && CRMUI.norm && CRMUI.norm.fold) ? CRMUI.norm.fold(String(s || '')) : String(s || '').toLowerCase();
    }

    function renderInvoices() {
      if (!getDB('invoices') || getDB('invoices').length === 0) setDB('invoices', []);
      if (!getDB('transactions') || getDB('transactions').length === 0) setDB('transactions', []);
      const sec = _mnyShell();
      if (!sec) return;
      const st = window._mnyState = window._mnyState || { tab: 'invoices', status: 'all' };
      const now = new Date();
      const all = getDB('invoices').filter(i => _mnyInvStatus(i, now) !== 'void');

      // page actions: the page's one primary, one secondary
      const pa = document.getElementById('pageActions');
      if (pa && sec.classList.contains('active')) {
        pa.innerHTML = `<button type="button" class="btn btn-secondary" onclick="openQuoteBuilderModal()">Quote builder</button><button type="button" class="btn btn-primary" onclick="openCreateInvoiceModal()">${_mnyIcon('plus', 18)}New invoice</button>`;
      }

      // tabs
      sec.querySelectorAll('#moneyTabs .tab-btn').forEach(b => {
        const on = b.getAttribute('data-mtab') === st.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      ['invoices', 'payments', 'quotes'].forEach(k => { const p = document.getElementById('moneyPanel' + k.charAt(0).toUpperCase() + k.slice(1)); if (p) p.hidden = st.tab !== k; });

      // client reports waiting for a confirm
      const reports = (getDB('events') || []).filter(e => _mnyReport(e));
      const rep = document.getElementById('moneyReports');
      rep.innerHTML = reports.length ? `<div class="mny-reports">${reports.slice(0, 3).map(e => _mnyReportCard(e)).join('')}${reports.length > 3 ? `<p class="mny-note">And ${reports.length - 3} more waiting on the event Money tabs.</p>` : ''}</div>` : '';

      // totals (void is left out everywhere)
      const sum = list => list.reduce((s, i) => s + _mnyCents(i.total), 0);
      const owed = list => list.reduce((s, i) => s + Math.max(0, _mnyCents(i.total) - _mnyInvPaidC(i)), 0);
      const paidL = all.filter(i => _mnyInvStatus(i, now) === 'paid');
      const openL = all.filter(i => _mnyInvStatus(i, now) !== 'paid');
      const overL = all.filter(i => _mnyInvStatus(i, now) === 'overdue');
      const stat = (label, c, cls, sub) => `<div class="mny-stat"><div class="mny-stat-label">${label}</div><div class="mny-stat-val num ${cls}">${_mnyUSD(c)}</div><div class="mny-stat-sub">${sub}</div></div>`;
      const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
      document.getElementById('invoiceTotals').innerHTML =
        stat('Billed', sum(all), '', plural(all.length, 'invoice')) +
        stat('Collected', all.reduce((t, i) => t + _mnyInvPaidC(i), 0), 'is-ok', plural(paidL.length, 'invoice') + ' paid') +
        stat('Outstanding', owed(openL), 'is-warn', plural(openL.length, 'invoice') + ' open') +
        stat('Overdue', owed(overL), overL.length ? 'is-danger' : '', overL.length ? plural(overL.length, 'invoice') : 'Nothing overdue');

      // status filter with counts
      const bucket = i => { const k = _mnyInvStatus(i, now); return k === 'partial' ? 'sent' : k; };
      const counts = { all: all.length, draft: 0, sent: 0, overdue: 0, paid: 0 };
      all.forEach(i => { counts[bucket(i)]++; });
      document.getElementById('invoiceSeg').innerHTML = [['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['overdue', 'Overdue'], ['paid', 'Paid']].map(([k, l]) =>
        `<button type="button" class="seg-btn${st.status === k ? ' active' : ''}" aria-pressed="${st.status === k}" onclick="setInvoiceFilter('${k}')">${l} <span class="num">${counts[k]}</span></button>`).join('');

      // list
      const q = _mnySearchText().replace(/^inv-?/, '');
      const filtered = all.filter(i => (st.status === 'all' || bucket(i) === st.status) &&
        (!q || _mnyFold(i.clientName).includes(q) || _mnyFold(i.eventName).includes(q) || String(i.invoiceNum || '').toLowerCase().replace(/^inv-?/, '').includes(q)));
      const mount = document.getElementById('invoicesListMount');
      if (!all.length) {
        mount.innerHTML = `<div class="empty">${_mnyIcon('receipt', 32)}<h3 class="empty-title">No invoices yet</h3><p class="empty-text">Create one here, or from an event so the client and amount fill in for you.</p><button type="button" class="btn btn-secondary" onclick="openCreateInvoiceModal()">Create invoice</button></div>`;
      } else if (!filtered.length) {
        mount.innerHTML = `<div class="empty">${_mnyIcon('search', 32)}<h3 class="empty-title">No invoices match</h3><p class="empty-text">Try another word, or look at all invoices.</p><button type="button" class="btn btn-secondary" onclick="document.getElementById('invoiceSearch').value='';setInvoiceFilter('all')">Show all</button></div>`;
      } else {
        mount.innerHTML = _mnyInvList(filtered, { client: true });
      }

      document.getElementById('moneyPanelPayments').innerHTML = _mnyLedgerHtml();
      document.getElementById('moneyPanelQuotes').innerHTML = _mnyQuotesHtml();
    }

    function _mnyLedgerHtml() {
      const txs = (getDB('transactions') || []).slice().sort((a, b) => ((_mnyDate(b.date) || new Date(0)).getTime()) - ((_mnyDate(a.date) || new Date(0)).getTime()));
      if (!txs.length) return `<div class="empty">${_mnyIcon('wallet', 32)}<h3 class="empty-title">No payments logged yet.</h3><p class="empty-text">When you mark an invoice paid, the payment shows up here.</p></div>`;
      const total = txs.reduce((s, t) => s + _mnyCents(t.amount), 0);
      const now = new Date();
      const rows = txs.map(t => {
        const applied = t.invoiceNum ? 'Invoice ' + _mnyNum({ invoiceNum: t.invoiceNum }) : (t.type || t.note || '');
        return `<tr><td>${esc(_mnyShort(t.date, now))}</td><td data-user-content>${esc(t.clientName || '')}</td><td class="num mny-pos">${_mnyUSD(_mnyCents(t.amount))}</td><td>${esc(t.method || 'Manual')}</td><td>${esc(applied)}</td></tr>`;
      }).join('');
      return `<p class="mny-ledger-sum"><span class="num">${txs.length}</span> ${txs.length === 1 ? 'payment' : 'payments'}, <span class="num mny-pos">${_mnyUSD(total)}</span> collected</p>
        <div class="tbl-wrap tbl-scroll"><table class="tbl tbl-ledger"><thead><tr><th>Date</th><th>Client</th><th class="num">Amount</th><th>Method</th><th>Applied to</th></tr></thead><tbody id="transactionsTableBody">${rows}</tbody></table></div>`;
    }

    function _mnyQuotesHtml() {
      const list = [];
      (getDB('events') || []).forEach(ev => (ev.quotes || []).forEach(q => list.push({ q, ev })));
      list.sort((a, b) => (b.q.createdAt || 0) - (a.q.createdAt || 0));
      if (!list.length) return `<div class="empty">${_mnyIcon('file-text', 32)}<h3 class="empty-title">No saved quotes yet</h3><p class="empty-text">Build a quote from an event or an inquiry and it lands here.</p><button type="button" class="btn btn-secondary" onclick="openQuoteBuilderModal()">Quote builder</button></div>`;
      const now = new Date();
      const acts = ({ q, ev }) => `<button type="button" class="btn btn-secondary btn-sm" onclick="sendSavedQuote('${esc(q.id)}','${esc(ev.id)}')">${q.sentAt ? 'Resend' : 'Send'}</button><button type="button" class="btn btn-ghost btn-sm" onclick="exportSavedQuotePDF('${esc(q.id)}','${esc(ev.id)}')">PDF</button>`;
      const pill = q => q.sentAt ? `<span class="pill pill-info" data-ui="pill">Sent ${esc(_mnyShort(q.sentAt, now))}</span>` : `<span class="pill pill-neutral" data-ui="pill">Saved</span>`;
      const rows = list.map(x => `<tr><td><div class="mny-cell-main" data-user-content>${esc(x.q.clientName || x.ev.clientName || '')}</div><div class="mny-cell-sub" data-user-content>${esc(x.ev.name || '')}</div></td>
        <td class="num">${_mnyUSD(_mnyCents(x.q.total))}</td><td class="num">${_mnyUSD(_mnyCents(x.q.deposit))}</td><td>${pill(x.q)}</td><td class="mny-acts">${acts(x)}</td></tr>`).join('');
      const cards = list.map(x => `<div class="row mny-row"><div class="mny-row-top"><span class="row-title" data-user-content>${esc(x.q.clientName || x.ev.clientName || '')}</span><span class="mny-amt num">${_mnyUSD(_mnyCents(x.q.total))}</span></div>
        <div class="row-sub" data-user-content>${esc(x.ev.name || '')}</div>
        <div class="mny-row-bot"><span class="mny-row-state">${pill(x.q)}<span class="mny-due">Deposit ${_mnyUSD(_mnyCents(x.q.deposit))}</span></span><span class="mny-row-act">${acts(x)}</span></div></div>`).join('');
      return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Client and event</th><th class="num">Total</th><th class="num">Deposit</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div><div class="row-list">${cards}</div>`;
    }

    // ── Quote builder ─────────────────────────────────────────────────────────
    // The sheet's markup is built here. Desktop: lines on the left, live preview on the right. Phone: Edit and Preview panes, sticky total bar.
    function _mnyEnsureQuoteModal() {
      const m = document.querySelector('#quoteBuilderModal .modal');
      if (!m || m.dataset.mny === '1') return;
      m.dataset.mny = '1';
      m.style.setProperty('--mw', '980px');
      m.innerHTML = `
        <button type="button" class="modal-close btn btn-ghost btn-icon" onclick="closeModal('quoteBuilderModal')" aria-label="Close">${_mnyIcon('x', 20)}</button>
        <div class="modal-title" id="quoteTitle">New quote</div>
        <div id="quoteSheet" class="mny-q" data-pane="edit">
          <div class="seg mny-q-seg" role="group" aria-label="Quote view">
            <button type="button" class="seg-btn active" data-qpane="edit" onclick="_mnyQuotePane('edit')">Edit</button>
            <button type="button" class="seg-btn" data-qpane="preview" onclick="_mnyQuotePane('preview')">Preview</button>
          </div>
          <div class="mny-q-grid">
            <div class="mny-q-edit">
              <fieldset class="mny-chunk"><legend class="section-label">Client and event</legend>
                <div class="mny-two">
                  <div class="field"><label class="field-label" for="quoteClient">Client name</label><input type="text" class="input" id="quoteClient" autocomplete="off" oninput="updateQuoteSummary()"></div>
                  <div class="field"><label class="field-label" for="quoteEmail">Client email</label><input type="email" class="input" id="quoteEmail" inputmode="email" autocomplete="off" oninput="updateQuoteSummary()"></div>
                </div>
                <div class="mny-two">
                  <div class="field"><label class="field-label" for="quoteDate">Event date</label><input type="date" class="input" id="quoteDate" oninput="updateQuoteSummary()"></div>
                  <div class="field"><label class="field-label" for="quoteEventType">Event type</label>
                    <select class="input" id="quoteEventType" onchange="updateQuoteDefaults()">
                      <option value="">Select a type</option>
                      <option value="wedding">Wedding</option>
                      <option value="quince">Quince</option>
                      <option value="sweet16">Sweet 16</option>
                      <option value="mitzvah">Bar or Bat Mitzvah</option>
                      <option value="corporate">Corporate event</option>
                      <option value="gala">Gala or fundraiser</option>
                      <option value="birthday">Birthday or private party</option>
                      <option value="concert">Concert or festival</option>
                    </select></div>
                </div>
              </fieldset>
              <fieldset class="mny-chunk"><legend class="section-label">Services and pricing</legend>
                <div id="quoteServicesList" class="mny-lines"></div>
                <div class="field"><label class="field-label sr-only" for="catalogPicker">Add a service</label>
                  <select id="catalogPicker" class="input" onchange="addCatalogLine(this)"><option value="">Add service from catalog</option></select></div>
              </fieldset>
            </div>
            <aside class="mny-q-prev" aria-label="Quote preview"><div class="mny-qcard"><div class="section-label">Quote preview</div><div id="quoteSummary"></div></div></aside>
          </div>
          <div class="mny-foot modal-sticky-foot">
            <div class="mny-foot-total"><span class="mny-flabel">Total</span><span id="quoteFootTotal" class="mny-foot-amt num">$0</span></div>
            <div class="mny-foot-btns">
              <button type="button" class="btn btn-ghost btn-icon" id="quoteMore" aria-label="More quote actions" onclick="_mnyQuoteMenu(this)">${_mnyIcon('ellipsis-vertical', 20)}</button>
              <button type="button" class="btn btn-secondary mny-q-previewbtn" id="quotePreviewBtn" onclick="_mnyQuotePane()">Preview</button>
              <button type="button" class="btn btn-primary" id="sendQuoteBtn" onclick="sendQuoteEmail()">Send quote</button>
            </div>
          </div>
        </div>`;
    }
    function _mnyQuotePane(which) {
      const sheet = document.getElementById('quoteSheet');
      if (!sheet) return;
      const next = which || (sheet.getAttribute('data-pane') === 'edit' ? 'preview' : 'edit');
      sheet.setAttribute('data-pane', next);
      sheet.querySelectorAll('[data-qpane]').forEach(b => b.classList.toggle('active', b.getAttribute('data-qpane') === next));
      const pb = document.getElementById('quotePreviewBtn');
      if (pb) pb.textContent = next === 'edit' ? 'Preview' : 'Edit';
    }
    function _mnyQuoteMenu(btn) {
      if (typeof CRMUI === 'undefined') return;
      CRMUI.menu(btn, [
        { label: 'Save quote', icon: 'file-text', onSelect: () => saveQuoteOnly() },
        { label: 'Export PDF', icon: 'printer', onSelect: () => exportQuotePDF() },
        { label: 'Convert to invoice', icon: 'receipt', onSelect: () => convertQuoteToInvoice() }
      ], { label: 'Quote actions', align: 'right' });
    }

    // Words an inquiry uses for what it wants, matched to catalog labels.
    const MNY_SERVICE_WORDS = [
      [/\bdj\b|disc jockey/i, 'DJ Services'], [/\bmc\b|emcee|host/i, 'MC Services'], [/sound|speaker|\bpa\b|audio/i, 'Sound System'],
      [/uplight|up-light|lighting/i, 'LED Uplighting'], [/co2|co₂|jet/i, 'CO₂ Jets'], [/spark/i, 'Cold Spark Towers'], [/cloud/i, 'Dancing on Clouds'],
      [/photo ?booth/i, 'Photo Booth'], [/gobo|monogram/i, 'Gobo Projection'], [/led wall|video wall|\bled\b/i, 'LED Video Wall'],
      [/moving head/i, 'Moving Head Lights'], [/fog|haze/i, 'Fog / Haze Machine'], [/projection|projector/i, 'Event Projection'],
      [/stage light/i, 'Stage Lighting Package'], [/full production|everything|full package/i, 'Full Production Package']
    ];
    function _mnyServiceLines(text) {
      const out = [];
      const seen = new Set();
      String(text || '').split(/,|;|\band\b|&|\n/i).map(s => s.trim()).filter(Boolean).forEach(tok => {
        const hit = MNY_SERVICE_WORDS.find(([re]) => re.test(tok));
        if (!hit || seen.has(hit[1])) return;
        const item = SERVICE_CATALOG.find(s => s.label === hit[1]);
        if (item) { seen.add(hit[1]); out.push(item); }
      });
      return out;
    }

    // eventId: link the quote to an event (or null). opts: { inquiry } prefills from an inquiry row; { fromEvent: true } is the same as passing an event id.
    function openQuoteBuilderModal(eventId, opts) {
      opts = opts || {};
      _mnyEnsureQuoteModal();
      const inq = opts.inquiry || null;
      window._quoteEventId = eventId || null;
      window._quoteInquiry = inq;
      document.getElementById('quoteServicesList').innerHTML = '';
      populateCatalogPicker();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
      set('quoteClient', ''); set('quoteEmail', ''); set('quoteDate', ''); set('quoteEventType', '');
      let title = 'New quote';
      const ev = eventId ? _mnyEvent(eventId) : null;
      if (ev) {
        title = 'Quote for ' + (ev.name || ev.clientName || 'this event');
        set('quoteClient', ev.clientName); set('quoteEmail', ev.clientEmail); set('quoteDate', ev.date);
        const typeEl = document.getElementById('quoteEventType');
        if (ev.type && typeEl) { typeEl.value = ev.type; updateQuoteDefaults(); }
        if (!document.querySelector('#quoteServicesList .mny-qline') && Number(ev.basePrice) > 0) addQuoteLine('Event services', ev.basePrice);
      } else if (inq) {
        title = 'Quote for ' + (inq.name || 'this inquiry');
        set('quoteClient', inq.name); set('quoteEmail', inq.email); set('quoteDate', inq.event_date);
        const kind = (typeof BSContracts !== 'undefined' && BSContracts.eventTypeFromText) ? BSContracts.eventTypeFromText(inq.event_type) : '';
        const typeEl = document.getElementById('quoteEventType');
        if (kind && typeEl && [...typeEl.options].some(o => o.value === kind)) { typeEl.value = kind; updateQuoteDefaults(); }
        const asked = _mnyServiceLines(inq.services);
        if (asked.length) {
          document.getElementById('quoteServicesList').innerHTML = '';
          asked.forEach(s => addQuoteLine(s.label, s.price));
        }
        if (!document.querySelector('#quoteServicesList .mny-qline')) { addQuoteLine('DJ Services', 2500); addQuoteLine('Sound System', 800); }
      } else {
        addQuoteLine('DJ Services', 2500);
        addQuoteLine('Sound System', 800);
      }
      document.getElementById('quoteTitle').textContent = title;
      _mnyQuotePane('edit');
      updateQuoteSummary();
      openModal('quoteBuilderModal');
    }

    let quoteLineCount = 0;
    function addQuoteLine(desc='', price='') {
      quoteLineCount++;
      const div = document.createElement('div');
      div.className = 'mny-qline form-section';
      div.innerHTML = `<div class="mny-ql-desc"><input type="text" class="input" aria-label="Service or description" placeholder="Service or description" value="${esc(desc)}" oninput="updateQuoteSummary()"></div>
        <div class="mny-ql-row"><div class="input-wrap input-money mny-ql-price"><span class="input-prefix" aria-hidden="true">$</span><input type="number" class="input" aria-label="Price" placeholder="0" inputmode="decimal" step="0.01" value="${esc(String(price))}" oninput="updateQuoteSummary()"></div>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Remove service" onclick="this.closest('.mny-qline').remove();updateQuoteSummary()">${_mnyIcon('x', 16)}</button></div>`;
      document.getElementById('quoteServicesList').appendChild(div);
    }

    function updateQuoteDefaults() {
      const type = document.getElementById('quoteEventType').value;
      const defaults = {
        wedding: [['DJ Services',3200],['MC Services',800],['Sound System',1200],['LED Uplighting',600]],
        quince: [['DJ Services',2800],['MC Services',600],['Sound System',1000]],
        corporate: [['DJ Services',2500],['Sound System',1000],['LED Uplighting',500],['Event Projection',800]],
        gala: [['Live Band',6000],['Sound System',1500],['Stage Lighting',1200]],
        birthday: [['DJ Services',1800],['Sound System',600]],
        concert: [['Production Package',8000],['Stage Sound',3000],['Stage Lighting',2500]]
      };
      if (defaults[type]) {
        document.getElementById('quoteServicesList').innerHTML = '';
        defaults[type].forEach(([desc, price]) => addQuoteLine(desc, price));
      }
      updateQuoteSummary();
    }

    // Reads the sheet. Prices are summed in cents.
    function _mnyReadQuote() {
      const val = id => ((document.getElementById(id) || {}).value || '').trim();
      const lines = [];
      let totalC = 0;
      document.querySelectorAll('#quoteServicesList .mny-qline').forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = (inputs[0].value || '').trim();
        const priceC = _mnyCents(parseFloat(inputs[1].value) || 0);
        if (!desc && !priceC) return;
        lines.push({ desc: desc || 'Service', price: priceC / 100 });
        totalC += priceC;
      });
      const typeEl = document.getElementById('quoteEventType');
      return { client: val('quoteClient'), email: val('quoteEmail'), date: val('quoteDate'), type: typeEl ? typeEl.value : '',
        typeLabel: typeEl && typeEl.value ? typeEl.options[typeEl.selectedIndex].text : '', lines, totalC, total: totalC / 100 };
    }

    function updateQuoteSummary() {
      const q = _mnyReadQuote();
      const terms = _mnyTerms();
      const depC = Math.round(q.totalC * (Number(terms.depositPercent) || 50) / 100);
      const rows = q.lines.map(l => `<div class="mny-ql"><span data-user-content>${esc(l.desc)}</span><span class="num">${_mnyUSD(_mnyCents(l.price))}</span></div>`).join('');
      const who = q.client ? `<div class="mny-qwho">Prepared for <strong data-user-content>${esc(q.client)}</strong>${q.date ? ' · ' + esc(_mnyShort(q.date)) : ''}</div>` : '';
      document.getElementById('quoteSummary').innerHTML = who +
        (rows || '<p class="mny-note">Add a service to see the quote.</p>') +
        `<div class="mny-qtotal"><span>Total</span><span class="num">${_mnyUSD(q.totalC)}</span></div>
         <div class="mny-qdep"><span>Deposit to book (${esc(String(terms.depositPercent))}%)</span><span class="num">${_mnyUSD(depC)}</span></div>
         <p class="mny-note">The balance is due ${esc(String(terms.balanceDueDays))} days before the event. This quote is good for 30 days.</p>`;
      window._quoteTotal = q.total;
      const ft = document.getElementById('quoteFootTotal');
      if (ft) ft.textContent = _mnyUSD(q.totalC);
      const sb = document.getElementById('sendQuoteBtn');
      if (sb) {
        const okMail = /^\S+@\S+\.\S+$/.test(q.email);
        sb.title = okMail ? 'Sends to ' + q.email : 'Add a client email to send it';
      }
    }

    // Creates the lead event a quote needs when it was started from an inquiry or from a blank builder.
    function _mnyDraftEvent(q, inq) {
      const events = getDB('events') || [];
      const clients = getDB('clients') || [];
      const email = q.email.toLowerCase();
      let client = clients.find(c => (c.email || '').toLowerCase() === email);
      if (!client) {
        client = { id: genId(), name: q.client, email: q.email, phone: inq ? (inq.phone || '') : '', type: 'private', notes: '' };
        clients.push(client);
        setDB('clients', clients);
      }
      const existingPw = events.filter(e => e.clientId === client.id && e.portalPassword).map(e => e.portalPassword)[0] || null;
      const password = existingPw || (typeof genPortalPassword === 'function' ? genPortalPassword() : '');
      const kind = q.type || ((typeof BSContracts !== 'undefined' && inq) ? BSContracts.eventTypeFromText(inq.event_type) : '') || 'event';
      const ev = {
        id: genId(),
        name: q.client + '\'s Event',
        type: kind,
        date: q.date || '',
        startTime: '', endTime: '',
        clientId: client.id,
        clientName: q.client,
        clientEmail: q.email,
        clientPhone: client.phone || '',
        venueName: inq ? (inq.venue || '') : '', venueAddress: '', venueContact: '', venuePhone: '',
        status: 'lead',
        basePrice: q.total,
        depositAmount: _mnyDeposit(q.total),
        depositPaid: false, balancePaid: false,
        services: [], staff: [],
        portalEmail: q.email, portalPassword: password, portalDisabled: false,
        timeline: [], vendors: [], music: [], documents: [],
        notes: inq ? (inq.message || '') : '',
        checklist: { soundCheck: false, timelineSent: false, depositReceived: false, equipmentLoaded: false }
      };
      events.push(ev);
      setDB('events', events);
      if (password && typeof setClientCredentials === 'function') setClientCredentials(q.email, q.email, password);
      if (inq) {
        inq.status = 'converted';
        if (typeof saveInquiryStatus_silent === 'function') saveInquiryStatus_silent(inq.id, 'converted');
      }
      return ev;
    }

    // The quote travels inside the link (after the #), so the client opens it with no sign-in and nothing to look up (quote.html).
    // Returns '' when the link would be too long for the email function (2000 characters); the caller then falls back to the portal.
    function _mnyB64Url(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function _mnyQuoteLink(ev, lines, total, deposit, terms, eventDate) {
      try {
        const t = new Date();
        const iso = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        const payload = { v: 1, c: String(ev.clientName || '').slice(0, 120), t: String(ev.type || '').slice(0, 80), d: eventDate || '',
          l: (lines || []).map(l => [String(l.desc || '').slice(0, 200), Number(l.price) || 0]), T: Number(total) || 0, D: Number(deposit) || 0,
          p: Number(terms && terms.depositPercent) || 50, b: Number(terms && terms.balanceDueDays) || 0, i: iso };
        const url = 'https://www.baselinestudiofl.com/quote.html#q=' + _mnyB64Url(JSON.stringify(payload));
        return url.length <= 1900 ? url : '';
      } catch (e) { return ''; }
    }
    const _MNY_PORTAL_URL = 'https://www.baselinestudiofl.com/portal-client.html';

    // Sends a quote email for an event and records it. Shared by the builder and "Send" on the Quotes tab.
    async function _mnySendQuoteMail(ev, email, lines, total) {
      const deposit = _mnyDeposit(total);
      const terms = _mnyTerms();
      const evDate = _mnyDate(ev.date);
      const eventDate = evDate ? evDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
      // portalUrl is sent in the payload so the Edge Function can use it in the email button. It is the quote page, so she sees the quote without a login.
      const portalUrl = _mnyQuoteLink(ev, lines, total, deposit, terms, eventDate) || _MNY_PORTAL_URL;
      const result = await BSPortal.sendEmail('quote', {
        email,
        clientName: ev.clientName || 'there',
        eventDate,
        eventType: ev.type || '',
        lines, total, deposit,
        notes: '',
        portalUrl: portalUrl
      });
      if (result.ok) return true;
      const quoteLines = lines.map(l => `${l.desc}: $${l.price.toLocaleString()}`).join('\n');
      const quoteText = `Hi ${ev.clientName || 'there'},\n\nHere's your quote from Baseline Studio.\n\nEvent Date: ${eventDate}\n\n${quoteLines}\n\nTotal: $${total.toLocaleString()}\nDeposit to book (${terms.depositPercent}%): $${deposit.toLocaleString()}\n\nReady to move forward? You can see your quote here:\n${portalUrl}\n\nOr just reply to this email or call us at (786) 302-6056. We will get you sorted.\n\nSaul\nBaseline Studio\nbaselinestudiofl.com | (786) 302-6056`;
      showEmailFallback(email, 'Your Event Quote - Baseline Studio', quoteText, 'Email is not available right now. Send it yourself:');
      return false;
    }

    async function sendQuoteEmail() {
      const q = _mnyReadQuote();
      const btn = document.getElementById('sendQuoteBtn');
      if (!/^\S+@\S+\.\S+$/.test(q.email)) { showToast('Add the client email to send the quote.', 'warning'); const el = document.getElementById('quoteEmail'); if (el) el.focus(); _mnyQuotePane('edit'); return; }
      if (!q.lines.length || q.totalC <= 0) { showToast('Add a price to at least one service.', 'warning'); return; }
      let ev = window._quoteEventId ? _mnyEvent(window._quoteEventId) : null;
      const needsEvent = !ev;
      if (needsEvent && !q.client) { showToast('Add the client name first.', 'warning'); _mnyQuotePane('edit'); return; }
      const ok = await _mnyConfirm({
        title: 'Send this quote to ' + q.email + '?',
        body: needsEvent ? 'It goes out now. This also adds ' + q.client + ' to Pipeline as a lead.' : 'It goes out now. You can still edit the event after.',
        confirmLabel: 'Send quote'
      });
      if (!ok) return;
      _mnyMarkBusy(btn, true);
      if (needsEvent) { ev = _mnyDraftEvent(q, window._quoteInquiry); window._quoteEventId = ev.id; }
      const sent = await _mnySendQuoteMail(ev, q.email, q.lines, q.total);
      _mnyMarkBusy(btn, false);
      if (!sent) return;
      // Save the quote snapshot to the event (marks sentAt so the Documents tab shows it went out)
      _saveQuoteToEvent(ev.id, q.lines, q.total, Date.now());
      // Auto-advance pipeline stage to "proposal" (quote sent)
      const events = getDB('events') || [];
      const live = events.find(e => e.id === ev.id) || ev;
      if (live.status === 'lead') {
        live.status = 'proposal';
        setDB('events', events);
        showToast('Quote sent. Moved to Proposal.', 'success');
      } else {
        showToast('Quote sent to ' + q.email + '.', 'success');
      }
      if (typeof syncEvent === 'function') syncEvent(ev.id, { source: 'quote', refresh: false });
      closeModal('quoteBuilderModal');
      _mnyRefreshViews();
      if (needsEvent && typeof renderPipeline === 'function') { try { renderPipeline(); } catch (e) { /* pipeline owns its errors */ } }
    }

    function _mnyQuotePaper(o) {
      const rows = o.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="r">${_mnyUSD(_mnyCents(l.price))}</td></tr>`).join('');
      const terms = _mnyTerms();
      return _mnyPaper('Quote for ' + o.client, `
        <div class="head">
          <div><h1>EVENT QUOTE</h1><div>Prepared for <strong>${esc(o.client)}</strong></div>${o.type ? `<div class="meta">Event type: ${esc(o.type)}</div>` : ''}${o.dateStr ? `<div class="meta">Event date: ${esc(o.dateStr)}</div>` : ''}</div>
          <div class="r"><strong>Baseline Studio</strong><br>(786) 302-6056<br>Hello@baselinestudiofl.com<br>baselinestudiofl.com</div>
        </div>
        <table><thead><tr><th>Service</th><th class="r">Price</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="tot"><div class="big">Total ${_mnyUSD(_mnyCents(o.total))}</div><div class="meta">${terms.depositPercent}% deposit to book: ${_mnyUSD(_mnyCents(o.deposit))}. The balance is due ${terms.balanceDueDays} days before the event.</div></div>
        <p class="meta" style="margin-top:30px;font-size:12px;">This quote is good for 30 days. Pricing depends on the final event details.</p>`);
    }

    function exportQuotePDF() {
      const q = _mnyReadQuote();
      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to open the PDF.', 'warning'); return; }
      w.document.write(_mnyQuotePaper({ client: q.client || 'Client', type: q.typeLabel, dateStr: q.date ? _mnyLong(q.date) : '', lines: q.lines, total: q.total, deposit: _mnyDeposit(q.total) }));
      w.document.close(); w.print();
    }

    function convertQuoteToInvoice() {
      const q = _mnyReadQuote();
      const eventId = window._quoteEventId || '';
      // Save quote snapshot to event before converting
      if (eventId && q.lines.length) _saveQuoteToEvent(eventId, q.lines, q.total, null);
      closeModal('quoteBuilderModal');
      openCreateInvoiceModal();
      // Restore line items (openCreateInvoiceModal resets the form)
      document.getElementById('invoiceLines').innerHTML = '';
      invoiceLineCount = 0;
      q.lines.forEach(l => addInvoiceLine(l.desc, l.price));
      if (!q.lines.length) addInvoiceLine();
      document.getElementById('invClientName').value = q.client;
      document.getElementById('invClientEmail').value = q.email;
      if (eventId) {
        document.getElementById('invEventId').value = eventId;
        autoFillInvoiceFromEvent(eventId);
        if (q.email) document.getElementById('invClientEmail').value = q.email;
      }
      updateInvoiceTotal();
    }

    // ─────────────────────────────────────────────────────────────────
    //  QUOTE PERSISTENCE
    // ─────────────────────────────────────────────────────────────────
    function _saveQuoteToEvent(eventId, lines, total, sentAt) {
      if (!eventId) return;
      const events = getDB('events') || [];
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      if (!ev.quotes) ev.quotes = [];
      ev.quotes.push({
        id: genId(),
        lines,          // [{ desc, price }]
        total,
        deposit: _mnyDeposit(total),
        clientName: ev.clientName || '',
        clientEmail: ev.clientEmail || '',
        eventDate: ev.date || '',
        eventType: ev.type || '',
        createdAt: Date.now(),
        sentAt: sentAt || null
      });
      setDB('events', events);
      window.currentEvent = ev;
      // Refresh Documents tab if open
      const tabDocEl = document.getElementById('tabDocuments');
      if (tabDocEl && window.currentEvent && window.currentEvent.id === eventId) {
        tabDocEl.innerHTML = renderEventDocuments(ev);
      }
    }

    function saveQuoteOnly() {
      const eventId = window._quoteEventId;
      if (!eventId) { showToast('Open the quote from an event to save it to Documents.', 'warning'); return; }
      const q = _mnyReadQuote();
      if (!q.lines.length) { showToast('Add a service before saving.', 'warning'); return; }
      _saveQuoteToEvent(eventId, q.lines, q.total, null);
      showToast('Quote saved to the Documents tab.', 'success');
      _mnyRefreshViews();
    }

    function exportSavedQuotePDF(quoteId, eventId) {
      const events = getDB('events') || [];
      const ev = events.find(e => e.id === eventId);
      if (!ev || !ev.quotes) return;
      const q = ev.quotes.find(x => x.id === quoteId);
      if (!q) return;
      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to open the PDF.', 'warning'); return; }
      w.document.write(_mnyQuotePaper({ client: q.clientName || '', type: q.eventType || '', dateStr: q.eventDate ? _mnyLong(q.eventDate) : '', lines: q.lines || [], total: q.total || 0, deposit: q.deposit || 0 }));
      w.document.close(); w.print();
    }

    // Send (or resend) a saved quote from the Quotes tab. Asks first: an email goes to the client.
    async function sendSavedQuote(quoteId, eventId) {
      const events = getDB('events') || [];
      const ev = events.find(e => e.id === eventId);
      const q = ev && (ev.quotes || []).find(x => x.id === quoteId);
      if (!ev || !q) return;
      const email = q.clientEmail || ev.clientEmail || '';
      if (!email) { showToast('No client email on this event. Add one in the event first.', 'warning'); return; }
      const ok = await _mnyConfirm({ title: (q.sentAt ? 'Send this quote again to ' : 'Send this quote to ') + email + '?', body: 'It goes out now.', confirmLabel: 'Send quote' });
      if (!ok) return;
      const sent = await _mnySendQuoteMail(ev, email, q.lines || [], q.total || 0);
      if (!sent) return;
      q.sentAt = Date.now();
      if (ev.status === 'lead') ev.status = 'proposal';
      setDB('events', events);
      if (typeof syncEvent === 'function') syncEvent(ev.id, { source: 'quote', refresh: false });
      showToast('Quote sent to ' + email + '.', 'success');
      _mnyRefreshViews();
      if (typeof _syncRefreshViews === 'function') _syncRefreshViews(ev.id);
    }

    // ─────────────────────────────────────────────────────────────────
    //  SERVICE CATALOG + QUOTE CATALOG PICKER
    // ─────────────────────────────────────────────────────────────────
    const SERVICE_CATALOG = [
      { label: 'DJ Services',            price: 2500 },
      { label: 'MC Services',            price: 800  },
      { label: 'Sound System',           price: 1200 },
      { label: 'LED Uplighting',         price: 600  },
      { label: 'CO₂ Jets',              price: 800  },
      { label: 'Cold Spark Towers',      price: 1200 },
      { label: 'Dancing on Clouds',      price: 700  },
      { label: 'Photo Booth',            price: 900  },
      { label: 'Gobo Projection',        price: 500  },
      { label: 'LED Video Wall',         price: 3500 },
      { label: 'Moving Head Lights',     price: 800  },
      { label: 'Fog / Haze Machine',     price: 300  },
      { label: 'Event Projection',       price: 800  },
      { label: 'Stage Lighting Package', price: 1500 },
      { label: 'Full Production Package',price: 7500 },
      { label: null, price: null },  // separator → Custom
    ];

    function populateCatalogPicker() {
      const el = document.getElementById('catalogPicker');
      if (!el) return;
      el.innerHTML = '<option value="">Add service from catalog</option>';
      SERVICE_CATALOG.forEach((s, i) => {
        if (s.label === null) {
          el.innerHTML += `<option value="__custom__">Custom service (type your own)</option>`;
        } else {
          el.innerHTML += `<option value="${i}">${esc(s.label)} · $${s.price.toLocaleString()}</option>`;
        }
      });
    }

    function addCatalogLine(selectEl) {
      const val = selectEl.value;
      if (!val) return;
      selectEl.value = '';  // always reset immediately
      if (val === '__custom__') {
        addQuoteLine('', '');
      } else {
        const item = SERVICE_CATALOG[parseInt(val)];
        if (item && item.label) addQuoteLine(item.label, item.price);
      }
      updateQuoteSummary();
      // Focus the last input for convenience
      setTimeout(() => {
        const rows = document.querySelectorAll('#quoteServicesList .mny-qline');
        if (rows.length) {
          const inp = rows[rows.length-1].querySelector('input');
          if (inp) inp.focus();
        }
      }, 60);
    }
