// ============================================================================
// portal-provider/50-money.js  -  money: event invoice tab, invoices, quote builder, service catalog, reports
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Event Invoices tab ────────────────────────────────────────────────────
    function renderEventInvoices(event) {
      const allInvoices = getDB('invoices') || [];
      const evInvoices  = allInvoices.filter(i => i.eventId === event.id);
      const total       = evInvoices.reduce((s, i) => s + (i.total || 0), 0);
      const paid        = evInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
      const outstanding = total - paid;

      let rows = '';
      evInvoices.sort((a,b) => (b.createdAt||0)-(a.createdAt||0)).forEach(inv => {
        const due = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const isOverdue = inv.status !== 'paid' && inv.dueDate && new Date(inv.dueDate) < new Date();
        const sc = inv.status === 'paid' ? 'var(--success)' : isOverdue ? 'var(--danger)' : 'var(--warning)';
        rows += `<tr>
          <td style="font-family:monospace;">${inv.invoiceNum||'INV-???'}</td>
          <td style="font-weight:600;">$${(inv.total||0).toLocaleString()}</td>
          <td>${due}</td>
          <td><span style="color:${sc};font-weight:600;">${isOverdue && inv.status!=='paid' ? 'OVERDUE' : inv.status.toUpperCase()}</span></td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              <button class="btn btn-primary" style="font-size:12px;padding:4px 10px;background:rgba(31,163,224,0.18);border-color:rgba(31,163,224,0.65);color:var(--cyan);" onclick="sendInvoice('${inv.id}')">✉ Send</button>
              ${inv.status !== 'paid' ? `<button class="btn btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="markInvoicePaid('${inv.id}');document.getElementById('tabInvoices').innerHTML=renderEventInvoices(window.currentEvent)">Paid</button>` : ''}
              <button class="btn btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="exportInvoicePDF('${inv.id}')">PDF</button>
              <button class="btn btn-danger" style="font-size:12px;padding:4px 8px;" onclick="deleteInvoice('${inv.id}');document.getElementById('tabInvoices').innerHTML=renderEventInvoices(window.currentEvent)">✕</button>
            </div>
          </td>
        </tr>`;
      });

      const summaryColor = outstanding > 0 ? 'var(--warning)' : 'var(--success)';
      return `
        <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
          <div class="invoice-total-card"><div class="invoice-total-label">Invoiced</div><div class="invoice-total-value">$${total.toLocaleString()}</div></div>
          <div class="invoice-total-card"><div class="invoice-total-label">Collected</div><div class="invoice-total-value green">$${paid.toLocaleString()}</div></div>
          <div class="invoice-total-card"><div class="invoice-total-label">Outstanding</div><div class="invoice-total-value" style="color:${summaryColor};">$${outstanding.toLocaleString()}</div></div>
        </div>
        ${evInvoices.length ? `
          <div style="overflow-x:auto;margin-bottom:16px;">
            <table class="data-table">
              <thead><tr><th>Invoice #</th><th>Amount</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>` : `<div style="padding:20px;text-align:center;color:var(--gray);font-size:13px;border:1px dashed var(--border);border-radius:6px;margin-bottom:16px;">No invoices yet for this event</div>`}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="openCreateInvoiceFromEvent('${event.id}')">+ Create Invoice</button>
          <button class="btn btn-secondary" onclick="openQuoteBuilderModal('${event.id}')">📋 Build Quote First</button>
        </div>`;
    }

    // ── Invoice helpers ───────────────────────────────────────────────────────
    function openCreateInvoiceFromEvent(eventId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      openCreateInvoiceModal();
      if (!ev) return;
      document.getElementById('invEventId').value    = eventId;
      document.getElementById('invClientName').value = ev.clientName  || '';
      document.getElementById('invClientEmail').value= ev.clientEmail || '';
      // Pre-fill from base price if nothing typed yet
      if (ev.basePrice && ev.basePrice > 0) {
        document.getElementById('invoiceLines').innerHTML = '';
        invoiceLineCount = 0;
        addInvoiceLine('Event Services — ' + (ev.name || 'Event'), ev.basePrice);
        if (ev.depositAmount && ev.depositAmount > 0 && !ev.depositPaid) {
          addInvoiceLine('Deposit applied', -ev.depositAmount);
        }
        updateInvoiceTotal();
      }
    }

    function autoFillInvoiceFromEvent(eventId) {
      if (!eventId) return;
      const ev = (getDB('events') || []).find(e => e.id === eventId);
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

    function toggleDepositPaid(eventId, paid) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.depositPaid = paid;
      // Auto-advance to confirmed when deposit is received and event is still in booked stage
      if (paid && ev.status === 'booked') {
        ev.status = 'confirmed';
        showToast('Deposit received — stage advanced to Confirmed.', 'success');
      }
      setDB('events', events);
      if (paid) {
        // Non-blocking toast with inline "Send Portal Invite" action
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#111118;border:1px solid rgba(46,204,113,0.4);color:#fff;padding:14px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);max-width:320px;';
        toast.innerHTML = `<div style="font-weight:600;color:#2ecc71;margin-bottom:6px;">✓ Deposit received</div>
          <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-bottom:10px;">Send the client their portal access?</div>
          <div style="display:flex;gap:8px;">
            <button onclick="sendPortalInvite('${eventId}');this.closest('div[style]').remove()" style="flex:1;padding:7px;background:#2ecc71;border:none;border-radius:6px;color:#000;font-weight:700;cursor:pointer;font-size:12px;">Send Invite</button>
            <button onclick="this.closest('div[style]').remove()" style="padding:7px 12px;background:rgba(255,255,255,0.06);border:1px solid var(--border-ui);border-radius:6px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:12px;">Later</button>
          </div>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 8000);
      }
      renderEvents();
    }

    function toggleBalancePaid(eventId, paid) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      ev.balancePaid = paid;
      setDB('events', events);
      showToast(paid ? 'Balance marked as paid — fully collected!' : 'Balance marked unpaid', paid ? 'success' : 'info');
      renderEvents();
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
    //  INVOICES & TRANSACTIONS
    // 
    function renderInvoices() {
      if (!getDB('invoices') || getDB('invoices').length === 0) setDB('invoices', []);
      if (!getDB('transactions') || getDB('transactions').length === 0) setDB('transactions', []);
      const invoices = getDB('invoices');
      const transactions = getDB('transactions');
      const search = (document.getElementById('invoiceSearch')?.value || '').toLowerCase();

      // Totals
      const total = invoices.reduce((s, i) => s + (i.total || 0), 0);
      const paid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
      const outstanding = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.total || 0), 0);
      const overdue = invoices.filter(i => i.status !== 'paid' && i.dueDate && new Date(i.dueDate) < new Date()).reduce((s, i) => s + (i.total || 0), 0);

      document.getElementById('invoiceTotals').innerHTML = `
        <div class="invoice-total-card"><div class="invoice-total-label">Total Invoiced</div><div class="invoice-total-value">\$${total.toLocaleString()}</div></div>
        <div class="invoice-total-card"><div class="invoice-total-label">Collected</div><div class="invoice-total-value green">\$${paid.toLocaleString()}</div></div>
        <div class="invoice-total-card"><div class="invoice-total-label">Outstanding</div><div class="invoice-total-value yellow">\$${outstanding.toLocaleString()}</div></div>
        <div class="invoice-total-card"><div class="invoice-total-label">Overdue</div><div class="invoice-total-value red">\$${overdue.toLocaleString()}</div></div>
      `;

      // Invoices table
      const filtered = invoices.filter(i => !search || i.clientName.toLowerCase().includes(search) || (i.invoiceNum||'').toLowerCase().includes(search));
      let rows = '';
      if (!filtered.length) {
        rows = '<tr><td colspan="7" class="empty-state">No invoices yet</td></tr>';
      } else {
        filtered.sort((a,b) => (b.createdAt||0)-(a.createdAt||0)).forEach(inv => {
          const due = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
          const isOverdue = inv.status !== 'paid' && inv.dueDate && new Date(inv.dueDate) < new Date();
          const statusColor = inv.status === 'paid' ? 'var(--success)' : isOverdue ? 'var(--danger)' : 'var(--warning)';
          rows += `<tr>
            <td style="font-family:monospace;">${inv.invoiceNum||'INV-???'}</td>
            <td>${inv.clientName}</td>
            <td>${inv.eventName || '—'}</td>
            <td style="font-weight:600;">\$${(inv.total||0).toLocaleString()}</td>
            <td>${due}</td>
            <td><span style="color:${statusColor};font-weight:600;">${isOverdue && inv.status!=='paid' ? 'OVERDUE' : inv.status.toUpperCase()}</span></td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="btn btn-primary" style="font-size:12px;padding:4px 10px;background:rgba(31,163,224,0.18);border-color:rgba(31,163,224,0.65);color:var(--cyan);" onclick="sendInvoice('${inv.id}')">✉ Send</button>
                ${inv.status !== 'paid' ? `<button class="btn btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="markInvoicePaid('${inv.id}')">Paid</button>` : ''}
                <button class="btn btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="exportInvoicePDF('${inv.id}')">PDF</button>
                <button class="btn btn-danger" style="font-size:12px;padding:4px 8px;" onclick="deleteInvoice('${inv.id}')">✕</button>
              </div>
            </td>
          </tr>`;
        });
      }
      document.getElementById('invoicesTableBody').innerHTML = rows;

      // Transactions
      let tRows = '';
      if (!transactions.length) {
        tRows = '<tr><td colspan="5" class="empty-state">No transactions recorded</td></tr>';
      } else {
        transactions.sort((a,b)=>(b.date||0)-(a.date||0)).slice(0,20).forEach(t => {
          tRows += `<tr>
            <td>${new Date(t.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
            <td>${t.clientName}</td>
            <td style="color:var(--success);font-weight:600;">\$${(t.amount||0).toLocaleString()}</td>
            <td>${t.type}</td>
            <td>${t.note||''}</td>
          </tr>`;
        });
      }
      document.getElementById('transactionsTableBody').innerHTML = tRows;
    }

    function openCreateInvoiceModal() {
      const events  = getDB('events')  || [];
      const clients = getDB('clients') || [];

      // Populate event dropdown
      const evSel = document.getElementById('invEventId');
      evSel.innerHTML = '<option value="">No event linked</option>';
      events.sort((a,b) => new Date(b.date||0) - new Date(a.date||0))
        .forEach(e => evSel.innerHTML += `<option value="${e.id}">${e.name} — ${e.clientName} (${e.date||'no date'})</option>`);

      // Populate client picker
      const cPicker = document.getElementById('invClientPicker');
      cPicker.innerHTML = '<option value="">— Select existing client —</option>';
      clients.sort((a,b) => (a.name||'').localeCompare(b.name||''))
        .forEach(c => cPicker.innerHTML += `<option value="${c.id}">${c.name}${c.email ? ' — ' + c.email : ''}</option>`);

      document.getElementById('createInvoiceForm').reset();
      evSel.value    = '';
      cPicker.value  = '';
      invoiceLineCount = 0;
      document.getElementById('invoiceLines').innerHTML = '';
      addInvoiceLine();
      addInvoiceLine();
      updateInvoiceTotal();
      openModal('createInvoiceModal');
    }

    let invoiceLineCount = 0;
    function addInvoiceLine(desc='', amount='') {
      invoiceLineCount++;
      const div = document.createElement('div');
      div.className = 'quote-service-row';
      div.id = 'invLine' + invoiceLineCount;
      div.innerHTML = `<input type="text" class="form-input" placeholder="Description" value="${desc}" style="flex:1;" oninput="updateInvoiceTotal()">
        <input type="number" class="form-input" placeholder="Amount" value="${amount}" style="width:110px;" oninput="updateInvoiceTotal()">
        <button type="button" class="btn btn-danger" style="padding:6px 10px;" onclick="this.parentElement.remove();updateInvoiceTotal()">×</button>`;
      document.getElementById('invoiceLines').appendChild(div);
    }

    function updateInvoiceTotal() {
      const rows = document.querySelectorAll('#invoiceLines .quote-service-row');
      let sub = 0;
      rows.forEach(r => { const amt = parseFloat(r.querySelectorAll('input')[1].value) || 0; sub += amt; });
      const tax = parseFloat(document.getElementById('invTax')?.value) || 0;
      const total = sub * (1 + tax/100);
      document.getElementById('invoicePreviewTotal').textContent = `Total: \$${total.toFixed(2)}`;
    }

    function saveInvoice(e) {
      e.preventDefault();
      const rows = document.querySelectorAll('#invoiceLines .quote-service-row');
      const lines = [];
      let subtotal = 0;
      rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = inputs[0].value;
        const amt = parseFloat(inputs[1].value) || 0;
        if (desc) { lines.push({ desc, amount: amt }); subtotal += amt; }
      });
      const tax = parseFloat(document.getElementById('invTax').value) || 0;
      const total = subtotal * (1 + tax/100);
      const eventId = document.getElementById('invEventId').value;
      const events = getDB('events');
      const linkedEvent = events.find(e => e.id === eventId);
      const invoices = getDB('invoices');
      const inv = {
        id: genId(),
        invoiceNum: 'INV-' + String(Math.max(0, ...invoices.map(i => parseInt((i.invoiceNum || 'INV-0').replace('INV-', '') || '0'))) + 1).padStart(4, '0'),
        clientName: document.getElementById('invClientName').value,
        clientEmail: document.getElementById('invClientEmail').value,
        eventId, eventName: linkedEvent?.name || '',
        lines, subtotal, taxPct: tax, total,
        dueDate: document.getElementById('invDueDate').value,
        notes: document.getElementById('invNotes').value,
        status: 'unpaid',
        createdAt: Date.now()
      };
      invoices.push(inv);
      setDB('invoices', invoices);
      closeModal('createInvoiceModal');
      renderInvoices();
      // If this was created from an event modal, refresh that event's invoice tab
      const tabInvEl = document.getElementById('tabInvoices');
      if (tabInvEl && window.currentEvent && window.currentEvent.id === eventId) {
        tabInvEl.innerHTML = renderEventInvoices(window.currentEvent);
      }
      showToast('Invoice created', 'success');
      // Offer to send immediately if we have a client email
      if (inv.clientEmail) {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#111118;border:1px solid rgba(31,163,224,0.35);color:#fff;padding:14px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);max-width:300px;';
        t.innerHTML = `<div style="font-weight:600;color:var(--cyan);margin-bottom:6px;">${inv.invoiceNum} created</div>
          <div style="color:rgba(255,255,255,0.55);font-size:12px;margin-bottom:10px;">Send it to ${inv.clientEmail}?</div>
          <div style="display:flex;gap:8px;">
            <button onclick="sendInvoice('${inv.id}');this.closest('div[style]').remove()" style="flex:1;padding:7px;background:var(--cyan);border:none;border-radius:6px;color:#000;font-weight:700;cursor:pointer;font-size:12px;">Send Now</button>
            <button onclick="this.closest('div[style]').remove()" style="padding:7px 12px;background:rgba(255,255,255,0.06);border:1px solid var(--border-ui);border-radius:6px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:12px;">Later</button>
          </div>`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 9000);
      }
    }

    function saveAndExportInvoice() {
      const form = document.getElementById('createInvoiceForm');
      if (form.checkValidity()) {
        saveInvoice({ preventDefault: ()=>{} });
        const invoices = getDB('invoices');
        if (invoices.length) exportInvoicePDF(invoices[invoices.length - 1].id);
      } else { form.reportValidity(); }
    }

    function saveAndSendInvoice() {
      const form = document.getElementById('createInvoiceForm');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      saveInvoice({ preventDefault: ()=>{} });
      const invoices = getDB('invoices');
      if (invoices.length) {
        const inv = invoices[invoices.length - 1];
        if (inv.clientEmail) {
          sendInvoice(inv.id);
        } else {
          showToast('Invoice saved — add a client email to send it', 'info');
        }
      }
    }

    async function sendInvoice(invId) {
      const invoices = getDB('invoices') || [];
      const inv = invoices.find(i => i.id === invId);
      if (!inv) return;
      if (!inv.clientEmail) {
        showToast('No client email on this invoice — add one when creating or edit via the client record', 'warning');
        return;
      }

      const lineText = (inv.lines || []).map(l => `  ${l.desc}: $${(l.amount||0).toFixed(2)}`).join('\n');
      const dueStr   = inv.dueDate ? new Date(inv.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : 'Upon receipt';
      const firstName = (inv.clientName || 'there').split(' ')[0];
      const body = `Hey ${firstName},\n\nYour invoice from Baseline Studio is ready.\n\nInvoice #: ${inv.invoiceNum}${inv.eventName ? '\nEvent: ' + inv.eventName : ''}\n\n${lineText}\n\nTotal Due: $${(inv.total||0).toFixed(2)}\nDue: ${dueStr}${inv.notes ? '\n\n' + inv.notes : ''}\n\nYou can view your event portal here:\nhttps://www.baselinestudiofl.com/portal-client.html\n\nReach out if you have any questions.\n\nSaul, Baseline Studio\n(786) 302-6056`;

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
        showToast('Invoice sent to ' + inv.clientEmail, 'success');
        // Mark as sent
        inv.sentAt = Date.now();
        setDB('invoices', invoices);
        // Refresh invoices tab if open
        const tabEl = document.getElementById('tabInvoices');
        if (tabEl && window.currentEvent) tabEl.innerHTML = renderEventInvoices(window.currentEvent);
        renderInvoices();
      } else {
        showEmailFallback(inv.clientEmail, `Invoice ${inv.invoiceNum} — Baseline Studio`, body,
          'Edge function unavailable — send it manually:');
      }
    }

    function markInvoicePaid(id) {
      const invoices = getDB('invoices');
      const inv = invoices.find(i => i.id === id);
      if (!inv) return;
      inv.status = 'paid';
      inv.paidAt = Date.now();
      setDB('invoices', invoices);
      // Log transaction
      const transactions = getDB('transactions');
      transactions.push({ id: genId(), clientName: inv.clientName, amount: inv.total, type: 'Invoice Payment', note: inv.invoiceNum, date: Date.now() });
      setDB('transactions', transactions);
      renderInvoices();
      showToast('Invoice marked as paid', 'success');
    }

    function deleteInvoice(id) {
      confirmDestructive('Delete Invoice', 'Delete this invoice? This cannot be undone.', function() {
        setDB('invoices', getDB('invoices').filter(i => i.id !== id));
        renderInvoices();
        showToast('Invoice deleted', 'info');
      });
    }

    function exportInvoicePDF(id) {
      const invoices = getDB('invoices');
      const inv = invoices.find(i => i.id === id);
      if (!inv) return;
      const lines = (inv.lines||[]).map(l => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${l.desc}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">\$${l.amount.toFixed(2)}</td></tr>`).join('');
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>${inv.invoiceNum}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111;background:#fff;}h1{color:#1585b8;}table{width:100%;border-collapse:collapse;}th{background:#f5f5f5;padding:8px;text-align:left;}</style>
</head>
      <body>
        <div style="display:flex;justify-content:space-between;margin-bottom:30px;">
          <div><h1>INVOICE</h1><div style="color:#6b7078;">${inv.invoiceNum}</div></div>
          <div style="text-align:right;"><strong>Baseline Studio</strong><br>(786) 302-6056<br>Hello@baselinestudiofl.com</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:24px;">
          <div><strong>Bill To:</strong><br>${inv.clientName}<br>${inv.clientEmail||''}</div>
          <div style="text-align:right;"><strong>Date:</strong> ${new Date(inv.createdAt).toLocaleDateString()}<br><strong>Due:</strong> ${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : 'Upon receipt'}</div>
        </div>
        <table><thead><tr><th>Description</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${lines}</tbody></table>
        <div style="text-align:right;margin-top:16px;"><div>Subtotal: \$${(inv.subtotal||0).toFixed(2)}</div>${inv.taxPct ? `<div>Tax (${inv.taxPct}%): \$${((inv.subtotal||0)*inv.taxPct/100).toFixed(2)}</div>` : ''}<div style="font-size:22px;font-weight:bold;color:#1585b8;">Total: \$${(inv.total||0).toFixed(2)}</div></div>
        ${inv.notes ? `<div style="margin-top:20px;padding:12px;background:#f9f9f9;border-radius:4px;"><strong>Notes:</strong> ${inv.notes}</div>` : ''}
      </body></html>`);
      w.document.close();
      w.print();
    }

    // 
    //  QUOTE BUILDER
    // 
    // eventId is optional — if passed, quote is linked to that event
    function openQuoteBuilderModal(eventId) {
      window._quoteEventId = eventId || null;
      document.getElementById('quoteServicesList').innerHTML = '';
      populateCatalogPicker();
      // Pre-fill from event if provided
      if (eventId) {
        const ev = (getDB('events') || []).find(e => e.id === eventId);
        if (ev) {
          document.getElementById('quoteClient').value = ev.clientName || '';
          document.getElementById('quoteDate').value = ev.date || '';
          const typeEl = document.getElementById('quoteEventType');
          if (ev.type && typeEl) { typeEl.value = ev.type; updateQuoteDefaults(); }
          document.getElementById('sendQuoteBtn').textContent = `✉ Send Quote to ${ev.clientEmail || 'Client'}`;
          document.getElementById('sendQuoteBtn').style.display = ev.clientEmail ? 'inline-flex' : 'none';
        }
      } else {
        document.getElementById('quoteClient').value = '';
        document.getElementById('quoteDate').value = '';
        addQuoteLine('DJ Services', 2500);
        addQuoteLine('Sound System', 800);
        document.getElementById('sendQuoteBtn').style.display = 'none'; // no client email context
      }
      updateQuoteSummary();
      openModal('quoteBuilderModal');
    }

    async function sendQuoteEmail() {
      const eventId = window._quoteEventId;
      const events = getDB('events') || [];
      const ev = eventId ? events.find(e => e.id === eventId) : null;
      const clientEmail = ev?.clientEmail || '';
      if (!clientEmail) { showToast('No client email on this event — add one in event details first.', 'warning'); return; }

      const rows = document.querySelectorAll('#quoteServicesList .quote-service-row');
      const lines = [];
      let total = 0;
      rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = inputs[0].value || 'Service';
        const price = parseFloat(inputs[1].value) || 0;
        lines.push({ desc, price });
        total += price;
      });
      const deposit = Math.round(total * 0.5);
      const eventDate = ev?.date ? new Date(ev.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : '';

      const btn = document.getElementById('sendQuoteBtn');
      btn.disabled = true; btn.textContent = 'Sending…';

      // portalUrl sent in payload so the Edge Function can use it in the email button.
      // IMPORTANT: also update the Edge Function template in Supabase Dashboard (send-email fn)
      // to use {{portalUrl}} in the "Accept & Get Started" button href — not the hardcoded contact.html.
      const result = await BSPortal.sendEmail('quote', {
        email: clientEmail,
        clientName: ev.clientName || 'there',
        eventDate,
        eventType: ev.type || '',
        lines, total, deposit,
        notes: '',
        portalUrl: 'https://www.baselinestudiofl.com/portal-client.html'
      });

      if (result.ok) {
        // Save quote snapshot to event (marks sentAt so Documents tab reflects it was sent)
        _saveQuoteToEvent(eventId, lines, total, Date.now());
        // Auto-advance pipeline stage to "proposal" (quote sent)
        if (ev && ev.status === 'lead') {
          ev.status = 'proposal';
          setDB('events', events);
          showToast('Quote sent — stage updated to Proposal.', 'success');
        } else {
          showToast('Quote sent to ' + clientEmail, 'success');
        }
        closeModal('quoteBuilderModal');
      } else {
        btn.disabled = false; btn.textContent = '✉ Send Quote to Client';
        // Build a plain-text fallback so Saul can send via email app
        // NOTE: The Supabase Edge Function email template also has an "Accept & Get Started"
        // button — update it in the Supabase dashboard to point to portal-client.html (not contact.html)
        const portalUrl = `https://www.baselinestudiofl.com/portal-client.html`;
        const quoteLines = lines.map(l => `${l.desc}: $${l.price.toLocaleString()}`).join('\n');
        const quoteText = `Hi ${ev?.clientName || 'there'},\n\nHere's your quote from Baseline Studio.\n\nEvent Date: ${eventDate}\n\n${quoteLines}\n\nTotal: $${total.toLocaleString()}\nRequired Deposit to Book (50%): $${deposit.toLocaleString()}\n\nReady to move forward? You can access your client portal here:\n${portalUrl}\n\nOr just reply to this email or give us a call at (786) 302-6056 — we'll get you sorted.\n\nSaul\nBaseline Studio\nbaselinestudiofl.com | (786) 302-6056`;
        showEmailFallback(clientEmail, `Your Event Quote — Baseline Studio`, quoteText,
          `Could not send — check Resend setup. Use the fallback below:`);
      }
    }

    let quoteLineCount = 0;
    function addQuoteLine(desc='', price='') {
      quoteLineCount++;
      const div = document.createElement('div');
      div.className = 'quote-service-row';
      div.innerHTML = `<input type="text" class="form-input" placeholder="Service / Description" value="${desc}" style="flex:1;" oninput="updateQuoteSummary()">
        <input type="number" class="form-input" placeholder="Price" value="${price}" style="width:110px;" oninput="updateQuoteSummary()">
        <button type="button" class="btn btn-danger" style="padding:6px 10px;" onclick="this.parentElement.remove();updateQuoteSummary()">×</button>`;
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
        updateQuoteSummary();
      }
    }

    function updateQuoteSummary() {
      const rows = document.querySelectorAll('#quoteServicesList .quote-service-row');
      let lines = '', total = 0;
      rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = inputs[0].value || 'Service';
        const amt = parseFloat(inputs[1].value) || 0;
        total += amt;
        lines += `<div class="quote-line"><span>${desc}</span><span>\$${amt.toLocaleString()}</span></div>`;
      });
      lines += `<div class="quote-total"><span>TOTAL ESTIMATE</span><span>\$${total.toLocaleString()}</span></div>`;
      const deposit = Math.round(total * 0.5);
      lines += `<div style="font-size:12px;color:var(--cyan);text-align:right;margin-top:4px;font-weight:600;">&#128274; Required Deposit to Book (50%): \$${deposit.toLocaleString()}</div>`;
      document.getElementById('quoteSummary').innerHTML = lines;
      window._quoteTotal = total;
      window._quoteLines = rows;
    }

    function exportQuotePDF() {
      const client = document.getElementById('quoteClient').value || 'Client';
      const date = document.getElementById('quoteDate').value;
      const type = document.getElementById('quoteEventType').options[document.getElementById('quoteEventType').selectedIndex]?.text || '';
      const rows = document.querySelectorAll('#quoteServicesList .quote-service-row');
      let lineHtml = '', total = 0;
      rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = inputs[0].value || 'Service';
        const amt = parseFloat(inputs[1].value) || 0;
        total += amt;
        lineHtml += `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${desc}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">\$${amt.toLocaleString()}</td></tr>`;
      });
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>Quote — ${client}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111;background:#fff;}h1{color:#1585b8;}table{width:100%;border-collapse:collapse;}th{background:#f5f5f5;padding:8px;}</style>
</head>
      <body>
        <div style="display:flex;justify-content:space-between;margin-bottom:30px;">
          <div><h1>EVENT QUOTE</h1><div>Prepared for: <strong>${client}</strong></div>${type ? '<div>Event Type: '+type+'</div>' : ''}${date ? '<div>Event Date: '+new Date(date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})+'</div>' : ''}</div>
          <div style="text-align:right;"><strong>Baseline Studio</strong><br>(786) 302-6056<br>Hello@baselinestudiofl.com<br>baselinestudiofl.com</div>
        </div>
        <table><thead><tr><th>Service</th><th style="text-align:right;">Price</th></tr></thead><tbody>${lineHtml}</tbody></table>
        <div style="text-align:right;margin-top:16px;font-size:24px;font-weight:bold;color:#1585b8;">Total: \$${total.toLocaleString()}</div>
        <div style="text-align:right;color:#6b7078;margin-top:4px;">50% Deposit Required: \$${Math.round(total*0.5).toLocaleString()}</div>
        <div style="margin-top:30px;color:#6b7078;font-size:12px;">This quote is valid for 30 days. Pricing subject to change based on final event details.</div>
      </body></html>`);
      w.document.close(); w.print();
    }

    function convertQuoteToInvoice() {
      const client  = document.getElementById('quoteClient').value || '';
      const eventId = window._quoteEventId || '';
      const rows    = document.querySelectorAll('#quoteServicesList .quote-service-row');
      // Capture line items BEFORE opening new modal
      const lineItems = [];
      let quoteTotal = 0;
      rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = inputs[0].value || 'Service';
        const price = parseFloat(inputs[1].value) || 0;
        lineItems.push({ desc, amount: inputs[1].value });
        quoteTotal += price;
      });
      // Save quote snapshot to event before converting
      if (eventId) {
        const quoteLines = lineItems.map(l => ({ desc: l.desc, price: parseFloat(l.amount) || 0 }));
        _saveQuoteToEvent(eventId, quoteLines, quoteTotal, null);
      }
      closeModal('quoteBuilderModal');
      openCreateInvoiceModal();
      // Restore line items (openCreateInvoiceModal resets the form)
      document.getElementById('invoiceLines').innerHTML = '';
      invoiceLineCount = 0;
      lineItems.forEach(l => addInvoiceLine(l.desc, l.amount));
      // Fill client + event
      document.getElementById('invClientName').value = client;
      if (eventId) {
        document.getElementById('invEventId').value = eventId;
        autoFillInvoiceFromEvent(eventId);
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
        deposit: Math.round(total * 0.5),
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
      if (!eventId) { showToast('Open a quote from within an event to save it', 'warning'); return; }
      const rows = document.querySelectorAll('#quoteServicesList .quote-service-row');
      const lines = [];
      let total = 0;
      rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        const desc = inputs[0].value || 'Service';
        const price = parseFloat(inputs[1].value) || 0;
        lines.push({ desc, price });
        total += price;
      });
      _saveQuoteToEvent(eventId, lines, total, null);
      showToast('Quote saved to Documents tab', 'success');
    }

    function exportSavedQuotePDF(quoteId, eventId) {
      const events = getDB('events') || [];
      const ev = events.find(e => e.id === eventId);
      if (!ev || !ev.quotes) return;
      const q = ev.quotes.find(x => x.id === quoteId);
      if (!q) return;
      const lineHtml = (q.lines || []).map(l =>
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${l.desc}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${(l.price||0).toLocaleString()}</td></tr>`
      ).join('');
      const dateStr = q.eventDate ? new Date(q.eventDate + 'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to export PDF', 'warning'); return; }
      w.document.write(`<html><head><title>Quote — ${q.clientName}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111;}h1{color:#1585b8;}table{width:100%;border-collapse:collapse;}th{background:#f5f5f5;padding:8px;text-align:left;}</style></head>
      <body>
        <div style="display:flex;justify-content:space-between;margin-bottom:30px;">
          <div><h1>EVENT QUOTE</h1><div>Prepared for: <strong>${q.clientName}</strong></div>${q.eventType ? '<div>Event Type: '+q.eventType+'</div>' : ''}${dateStr ? '<div>Event Date: '+dateStr+'</div>' : ''}</div>
          <div style="text-align:right;"><strong>Baseline Studio</strong><br>(786) 302-6056<br>Hello@baselinestudiofl.com<br>baselinestudiofl.com</div>
        </div>
        <table><thead><tr><th>Service</th><th style="text-align:right;">Price</th></tr></thead><tbody>${lineHtml}</tbody></table>
        <div style="text-align:right;margin-top:16px;font-size:24px;font-weight:bold;color:#1585b8;">Total: $${(q.total||0).toLocaleString()}</div>
        <div style="text-align:right;color:#6b7078;margin-top:4px;">50% Deposit Required: $${(q.deposit||0).toLocaleString()}</div>
        <div style="margin-top:30px;color:#6b7078;font-size:12px;">This quote is valid for 30 days. Pricing subject to change based on final event details.</div>
      </body></html>`);
      w.document.close(); w.print();
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
      el.innerHTML = '<option value="">📦 Add service from catalog…</option>';
      SERVICE_CATALOG.forEach((s, i) => {
        if (s.label === null) {
          el.innerHTML += `<option value="__custom__" style="font-style:italic;">✏ Custom Service (free form)</option>`;
        } else {
          el.innerHTML += `<option value="${i}">${s.label} — $${s.price.toLocaleString()}</option>`;
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
        const rows = document.querySelectorAll('#quoteServicesList .quote-service-row');
        if (rows.length) {
          const inp = rows[rows.length-1].querySelector('input');
          if (inp) inp.focus();
        }
      }, 60);
    }
