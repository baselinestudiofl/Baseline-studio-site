// ============================================================================
// portal-provider/61-inv-buy.js  -  Inventory > Purchases (everything bought, by category, searchable) and Inventory > Subscriptions
// (recurring costs such as annual insurance, software, storage). Classic script, shares the global scope with 60-library.js (loads after it).
//
// Purchases: a purchase IS the item.purchase block on an inventory item, so logging one here creates the item in the catalog with its date,
//   price, vendor and order number. Nothing here writes to events or invoices.
// Subscriptions: their own provider key, getDB('subscriptions') = [ { id, name, vendor, category, amountC, cycle, nextDate, autopay, account, notes,
//   status, history: [ { date, amountC } ] } ]. Provider only (never in anything a client reads).
// Money is integer cents. Owner, admin and event manager only (same check as invCanEdit); crew never see prices.
// ============================================================================

    const INVB_SUB_CATS = ['Insurance', 'Software', 'Storage & cloud', 'Music & licensing', 'Phone & internet', 'Vehicle', 'Memberships', 'Other'];
    const INVB_CYCLES = { monthly: { label: 'Every month', months: 1, per: 'a month' }, quarterly: { label: 'Every 3 months', months: 3, per: 'every 3 months' }, annual: { label: 'Every year', months: 12, per: 'a year' } };
    let _ibUI = { pq: '', pcat: '', pcats: [], sq: '', scat: '', scats: [] };

    // ── small pure helpers ───────────────────────────────────────────────────
    function invbInt(v) { const n = Math.round(Number(v)); return isFinite(n) ? n : 0; }
    function invbQ(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_.:-]/g, ''); }
    function invbIcon(n, s) { return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(n, s || 16) : ''; }
    function invbToday() {
      if (typeof invTodayIso === 'function') return invTodayIso();
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function invbIso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
    function invbParseIso(iso) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    }
    // Add whole months to a YYYY-MM-DD date. A day that does not exist in the new month lands on its last day (Jan 31 + 1 month = Feb 28).
    function invbAddMonths(iso, n) {
      const p = invbParseIso(iso);
      if (!p) return '';
      const total = p.y * 12 + (p.m - 1) + invbInt(n);
      const ny = Math.floor(total / 12), nm = total - ny * 12;
      const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
      return invbIso(ny, nm + 1, Math.min(p.d, last));
    }
    // Whole days from `today` to `iso` (negative = already past). Null when the date is missing.
    function invbDaysUntil(iso, today) {
      const a = invbParseIso(iso), b = invbParseIso(today || invbToday());
      if (!a || !b) return null;
      return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
    }
    function invbFmt(c) { return (typeof invFmtC === 'function') ? invFmtC(c) : '$' + (invbInt(c) / 100).toFixed(2); }
    function invbFold(s) { return (typeof invFold === 'function') ? invFold(s) : String(s == null ? '' : s).toLowerCase(); }
    function invbParseC(v) { return (typeof invParsePriceC === 'function') ? invParsePriceC(v) : (function() { const t = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (t === '') return 0; return /^\d*\.?\d+$/.test(t) ? Math.round(parseFloat(t) * 100) : null; })(); }
    function invbInputC(c) { const v = invbInt(c); return v > 0 ? (v / 100).toFixed(2) : ''; }
    function invbNewId(p) { return (p || 'x') + ((typeof genId === 'function') ? genId() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 7))); }
    function invbDateText(iso) { return (typeof invFmtDate === 'function') ? invFmtDate(iso, 'short') : String(iso || ''); }
    function invbCanEdit() { return (typeof invCanEdit === 'function') && invCanEdit(); }

    // ── modal (same shell as the Costs modals) ───────────────────────────────
    function invbCloseModal(id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (window.CRMUI && CRMUI.close) { try { CRMUI.close(el, { force: true }); } catch (e) {} }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    function invbOpenModal(id, title, inner, width) {
      invbCloseModal(id);
      const m = document.createElement('div');
      m.id = id;
      m.className = 'modal-backdrop';
      m.innerHTML = '<div class="modal" style="--mw:' + (width || 520) + 'px" role="document">'
        + '<button type="button" class="modal-close btn btn-ghost btn-icon" onclick="invbCloseModal(\'' + id + '\')" aria-label="Close">' + invbIcon('x', 20) + '</button>'
        + '<div class="modal-title">' + esc(title) + '</div>' + inner + '</div>';
      document.body.appendChild(m);
      if (window.CRMUI && CRMUI.open) CRMUI.open(m, { dirty: function() { return false; }, onClose: function() { if (m.parentNode) m.parentNode.removeChild(m); } });
      else m.classList.add('active');
      return m;
    }
    function invbSelect(id, opts, cur, onchange) {
      return '<select class="input" id="' + id + '"' + (onchange ? ' onchange="' + onchange + '"' : '') + '>' + opts.map(o => {
        const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>';
    }

    // ============================================================================
    //  PURCHASES
    // ============================================================================
    // One row per inventory item that carries purchase info.
    function invbPurchaseRows(items) {
      const rows = [];
      (items || []).forEach(it => {
        const p = it && it.purchase;
        if (!p || typeof p !== 'object') return;
        const each = Math.max(0, invbInt(p.priceC));
        const qty = (typeof invPurchaseQty === 'function') ? invPurchaseQty(it) : Math.max(1, invbInt(p.qty) || 1);
        if (!each && !p.date && !p.vendor && !p.orderNo) return;
        rows.push({ id: it.id, name: it.name || 'Item', tag: it.tag || '', category: it.category || 'Other', serial: it.serial || '', notes: it.notes || '',
          date: String(p.date || ''), vendor: String(p.vendor || ''), orderNo: String(p.orderNo || ''), eventName: String(p.eventName || ''), warrantyUntil: String(p.warrantyUntil || ''),
          qty: qty, eachC: each, totalC: each * qty });
      });
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.name).localeCompare(String(b.name)));
      return rows;
    }
    // Search matches name, tag, serial, category, vendor, order number, event, date and notes.
    function invbFilterPurchases(rows, q, cat) {
      let list = (rows || []).slice();
      if (cat) list = list.filter(r => r.category === cat);
      const f = invbFold(q);
      if (f) list = list.filter(r => [r.name, r.tag, r.serial, r.category, r.vendor, r.orderNo, r.eventName, r.date, r.notes].some(x => invbFold(x).indexOf(f) > -1));
      return list;
    }
    function invbPurchaseTotals(rows, today) {
      const year = String(invbParseIso(today || invbToday()).y);
      const out = { totalC: 0, yearC: 0, count: rows.length, byCat: {} };
      rows.forEach(r => {
        out.totalC += r.totalC;
        if (r.date.slice(0, 4) === year) out.yearC += r.totalC;
        out.byCat[r.category] = (out.byCat[r.category] || 0) + r.totalC;
      });
      return out;
    }
    // Make the inventory item for a purchase logged from Inventory. Returns { ok, item, tag } or { ok:false, reason }.
    function invbRecordPurchase(o) {
      o = o || {};
      if (typeof invStore !== 'function' || typeof invNextTag !== 'function' || typeof invNormItem !== 'function') return { ok: false, reason: 'inventory' };
      const name = String(o.name || '').trim();
      if (!name) return { ok: false, reason: 'name' };
      const qty = Math.max(1, invbInt(o.qty) || 1);
      const unitC = Math.max(0, invbInt(o.unitPriceC));
      let tracking = o.tracking === 'consumable' ? 'consumable' : (o.tracking === 'bulk' ? 'bulk' : 'serialized');
      if (qty > 1 && tracking === 'serialized') tracking = 'bulk';
      const store = invStore();
      const items = store.list();
      const tag = invNextTag(items);
      const it = {
        id: (typeof genId === 'function') ? genId() : invbNewId('i'),
        name: name, category: o.category || 'Other', serial: tracking === 'serialized' ? String(o.serial || '').trim() : '',
        value: unitC ? (unitC / 100).toFixed(2) : '', notes: String(o.note || ''), status: 'available',
        tracking: tracking, qty: qty, unit: 'pcs', tag: tag, kit: null, buffers: { before: 2, after: 2 }, condition: 'A', maintenance: [], history: [],
        purchase: { date: o.date || invbToday(), priceC: unitC, qty: qty, vendor: String(o.vendor || '').trim(), orderNo: String(o.orderNo || '').trim(), paidWith: '',
          warrantyUntil: String(o.warrantyUntil || ''), receiptNote: '', eventId: '', eventName: '', source: 'inventory' }
      };
      invNormItem(it);
      if (typeof invLog === 'function') invLog(it, 'register', null, 'Logged as a purchase');
      items.push(it);
      store.save(items);
      return { ok: true, item: it, tag: tag };
    }

    function invbStat(label, val, sub, cls) {
      return '<div class="invb-stat"><div class="invb-stat-label">' + esc(label) + '</div><div class="invb-stat-val num' + (cls ? ' ' + cls : '') + '">' + val + '</div>' + (sub ? '<div class="invb-stat-sub">' + sub + '</div>' : '') + '</div>';
    }
    function invViewPurchases(b) {
      if (!invbCanEdit()) { b.innerHTML = ''; return; }
      const rows = invbPurchaseRows(invItems());
      const t = invbPurchaseTotals(rows);
      invActions('<button type="button" class="btn btn-primary" onclick="invbOpenPurchaseModal()">' + invbIcon('plus', 18) + ' Log a purchase</button>'
        + (rows.length ? '<button type="button" class="btn btn-secondary" onclick="invbExportPurchases()">' + invbIcon('download', 18) + ' Export CSV</button>' : ''));
      const cats = Object.keys(t.byCat).sort((a, b) => a.localeCompare(b));
      _ibUI.pcats = cats;
      if (_ibUI.pcat && cats.indexOf(_ibUI.pcat) < 0) _ibUI.pcat = '';
      const chips = cats.length ? '<div class="inv-chips" role="group" aria-label="Filter by category"><button type="button" class="chip' + (_ibUI.pcat ? '' : ' is-selected') + '" aria-pressed="' + (!_ibUI.pcat) + '" onclick="invbSetPCat(\'\')">All</button>'
        + cats.map((c, i) => '<button type="button" class="chip' + (_ibUI.pcat === c ? ' is-selected' : '') + '" aria-pressed="' + (_ibUI.pcat === c) + '" onclick="invbSetPCat(' + i + ')">' + esc(c) + '</button>').join('') + '</div>' : '';
      b.innerHTML = '<div class="invb-stats">'
        + invbStat('Spent on gear', esc(invbFmt(t.totalC)), t.count ? 'across ' + t.count + (t.count === 1 ? ' purchase' : ' purchases') : '')
        + invbStat('This year', esc(invbFmt(t.yearC)), '')
        + invbStat('Purchases', esc(String(t.count)), '')
        + '</div>'
        + '<div class="inv-toolbar"><div class="input-wrap input-search inv-search">' + invbIcon('search', 18) + '<input id="invbPSearch" class="input" type="search" placeholder="Search item, vendor, order number or date" aria-label="Search purchases" value="' + esc(_ibUI.pq) + '" oninput="invbOnPSearch(this.value)" autocomplete="off"></div></div>'
        + chips + '<div id="invbPList"></div>';
      invbRenderPurchaseList();
    }
    function invbSetPCat(i) { _ibUI.pcat = i === '' ? '' : ((_ibUI.pcats || [])[i] || ''); if (typeof invRenderBody === 'function') invRenderBody(); }
    function invbOnPSearch(v) { _ibUI.pq = v; invbRenderPurchaseList(); }
    function invbRenderPurchaseList() {
      const host = document.getElementById('invbPList');
      if (!host) return;
      const all = invbPurchaseRows(invItems());
      if (!all.length) {
        host.innerHTML = invEmpty('receipt', 'No purchases yet', 'Log what you buy, like speakers, subs, tripods or a generator. Each one is added to your catalog with the date, price and where you bought it.',
          '<button type="button" class="btn btn-secondary" onclick="invbOpenPurchaseModal()">Log a purchase</button>');
        return;
      }
      const list = invbFilterPurchases(all, _ibUI.pq, _ibUI.pcat);
      if (!list.length) { host.innerHTML = invEmpty('search', 'Nothing matches', 'Clear the search or pick another category.'); return; }
      const sum = list.reduce((s, r) => s + r.totalC, 0);
      const summary = '<p class="invb-sum" role="status">' + list.length + (list.length === 1 ? ' purchase' : ' purchases') + ', ' + esc(invbFmt(sum)) + (_ibUI.pcat ? ' in ' + esc(_ibUI.pcat) : '') + '</p>';
      const money = r => esc(invbFmt(r.totalC)) + (r.qty > 1 ? '<span class="t-meta invb-each">' + r.qty + ' x ' + esc(invbFmt(r.eachC)) + '</span>' : '');
      if (typeof invIsPhone === 'function' && invIsPhone()) {
        host.innerHTML = summary + '<div class="row-list">' + list.map(r => '<div class="row inv-row" onclick="invOpenItem(\'' + invbQ(r.id) + '\')" data-user-content>'
          + '<button type="button" class="row-link row-main" aria-label="Open ' + esc(r.name) + '"><span class="row-title">' + esc(r.name) + '</span>'
          + '<span class="row-sub">' + esc([r.date ? invbDateText(r.date) : '', r.vendor, r.category].filter(Boolean).join(' · ')) + '</span>'
          + (r.orderNo ? '<span class="row-sub">Order ' + esc(r.orderNo) + '</span>' : '') + '</button>'
          + '<div class="row-trail invb-money num">' + money(r) + '</div></div>').join('') + '</div>';
        return;
      }
      host.innerHTML = summary + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Item</th><th>Category</th><th>Bought from</th><th>Order</th><th class="num">Total</th></tr></thead><tbody>'
        + list.map(r => '<tr class="inv-tr" tabindex="0" data-user-content onclick="invOpenItem(\'' + invbQ(r.id) + '\')" onkeydown="if(event.key===\'Enter\'){invOpenItem(\'' + invbQ(r.id) + '\')}">'
          + '<td class="meta">' + esc(r.date ? invbDateText(r.date) : '-') + '</td>'
          + '<td><strong>' + esc(r.name) + '</strong><div class="t-meta">' + esc(r.tag) + (r.eventName ? ' · for ' + esc(r.eventName) : '') + (r.warrantyUntil ? ' · warranty to ' + esc(invbDateText(r.warrantyUntil)) : '') + '</div></td>'
          + '<td class="meta">' + esc(r.category) + '</td><td class="meta">' + esc(r.vendor || '-') + '</td><td class="meta">' + esc(r.orderNo || '-') + '</td>'
          + '<td class="num invb-money">' + money(r) + '</td></tr>').join('') + '</tbody></table></div>';
    }

    // ── log a purchase ───────────────────────────────────────────────────────
    function invbCategoryOptions() {
      const base = (typeof INV_CATEGORIES !== 'undefined' && Array.isArray(INV_CATEGORIES)) ? INV_CATEGORIES.slice() : ['Other'];
      try { invItems().forEach(i => { if (i.category && base.indexOf(i.category) < 0) base.push(i.category); }); } catch (e) {}
      return base;
    }
    function invbOpenPurchaseModal(preset) {
      if (!invbCanEdit()) return;
      const pre = preset || {};
      const cats = invbCategoryOptions().map(c => [c, c]).concat([['__new', 'New category...']]);
      const inner = '<form class="invb-form" onsubmit="invbSubmitPurchase();return false;">'
        + (typeof lfBlockHtml === 'function' ? lfBlockHtml('ibp') : '')
        + '<div class="field"><label class="field-label" for="ibpName">What did you buy</label><input class="input" id="ibpName" type="text" required autocomplete="off" placeholder="Example: QSC K12.2 speaker"></div>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibpCat">Category</label>' + invbSelect('ibpCat', cats, pre.category || 'Speakers', 'invbCatChange(this)')
        +   '<input class="input invb-newcat" id="ibpNewCat" type="text" autocomplete="off" placeholder="Name the new category" hidden></div>'
        +   '<div class="field"><label class="field-label" for="ibpQty">How many</label><input class="input" id="ibpQty" type="number" min="1" step="1" value="1" inputmode="numeric" oninput="invbPurchasePreview()"></div></div>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibpPrice">Price each</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="ibpPrice" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" oninput="invbPurchasePreview()"></div></div>'
        +   '<div class="field"><label class="field-label" for="ibpDate">Date bought</label><input class="input" id="ibpDate" type="date" value="' + esc(invbToday()) + '"></div></div>'
        + '<span class="field-hint invb-prev" id="ibpPrev" aria-live="polite"></span>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibpVendor">Where from</label><input class="input" id="ibpVendor" type="text" autocomplete="off" placeholder="Store or website"></div>'
        +   '<div class="field"><label class="field-label" for="ibpOrder">Order number</label><input class="input" id="ibpOrder" type="text" autocomplete="off" placeholder="Optional"></div></div>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibpTrack">Track it as</label>' + invbSelect('ibpTrack', [['serialized', 'One item (own tag and serial)'], ['bulk', 'A count of the same thing'], ['consumable', 'Used up (fuel, tape, gels)']], 'serialized')
        +   '</div><div class="field"><label class="field-label" for="ibpSerial">Serial number</label><input class="input" id="ibpSerial" type="text" autocomplete="off" placeholder="Optional, for a single item"></div></div>'
        + '<div class="field"><label class="field-label" for="ibpWar">Warranty ends</label><input class="input" id="ibpWar" type="date"><span class="field-hint">Optional. Handy for claims.</span></div>'
        + '<div class="cst-modal-foot invb-foot"><button type="button" class="btn btn-ghost" onclick="invbCloseModal(\'invbPurchaseModal\')">Cancel</button><button type="submit" class="btn btn-primary">Add to Inventory</button></div>'
        + '</form>';
      invbOpenModal('invbPurchaseModal', 'Log a purchase', inner, 540);
      const n = document.getElementById('ibpName'); if (n && n.focus) n.focus();
    }
    function invbCatChange(sel) {
      const n = document.getElementById('ibpNewCat');
      if (!n) return;
      n.hidden = sel.value !== '__new';
      if (!n.hidden && n.focus) n.focus();
    }
    function invbPurchasePreview() {
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const out = document.getElementById('ibpPrev');
      if (!out) return;
      const c = invbParseC(v('ibpPrice')), q = Math.max(1, invbInt(v('ibpQty')) || 1);
      out.textContent = (c && c > 0) ? 'Total ' + invbFmt(c * q) + (q > 1 ? ' for ' + q : '') : '';
    }
    function invbSubmitPurchase() {
      if (!invbCanEdit()) return;
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const name = v('ibpName').trim();
      if (!name) { showToast('Give the purchase a name first.', 'info'); return; }
      const c = invbParseC(v('ibpPrice'));
      if (c === null) { showToast('Enter the price like 25 or 25.50.', 'error'); return; }
      let cat = v('ibpCat');
      if (cat === '__new') {
        cat = v('ibpNewCat').trim();
        if (!cat) { showToast('Name the new category.', 'info'); const el = document.getElementById('ibpNewCat'); if (el) el.focus(); return; }
        const hit = invbCategoryOptions().find(x => invbFold(x) === invbFold(cat));
        if (hit) cat = hit;
      }
      const res = invbRecordPurchase({ name: name, category: cat || 'Other', qty: invbInt(v('ibpQty')) || 1, unitPriceC: c, date: v('ibpDate'), vendor: v('ibpVendor'), orderNo: v('ibpOrder'),
        tracking: v('ibpTrack'), serial: v('ibpSerial'), warrantyUntil: v('ibpWar') });
      if (!res.ok) { showToast('Could not add that. Check the name and try again.', 'error'); return; }
      invbCloseModal('invbPurchaseModal');
      if (typeof invRenderBody === 'function') invRenderBody();
      showToast('Added to Inventory as ' + res.tag + '.', 'success');
    }

    // ── CSV ──────────────────────────────────────────────────────────────────
    function invbCsvCell(v) {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // spreadsheets run text that starts with these as formulas
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function invbCsvRows(rows) {
      const out = [['Date', 'Item', 'Tag', 'Category', 'Bought from', 'Order number', 'How many', 'Price each', 'Total', 'Bought for event', 'Warranty ends']];
      let tot = 0;
      (rows || []).forEach(r => {
        tot += r.totalC;
        out.push([r.date, r.name, r.tag, r.category, r.vendor, r.orderNo, r.qty, (r.eachC / 100).toFixed(2), (r.totalC / 100).toFixed(2), r.eventName, r.warrantyUntil]);
      });
      out.push(['', 'Total', '', '', '', '', '', '', (tot / 100).toFixed(2), '', '']);
      return out;
    }
    function invbDownload(filename, text) {
      try {
        const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('Exported.', 'success');
      } catch (e) { console.warn('[inventory] csv', e); showToast('Could not export. Try again.', 'error'); }
    }
    function invbExportPurchases() {
      if (!invbCanEdit()) return;
      const rows = invbFilterPurchases(invbPurchaseRows(invItems()), _ibUI.pq, _ibUI.pcat);
      invbDownload('purchases.csv', invbCsvRows(rows).map(r => r.map(invbCsvCell).join(',')).join('\r\n') + '\r\n');
    }

    // ============================================================================
    //  SUBSCRIPTIONS
    // ============================================================================
    function invbSubs() {
      const l = getDB('subscriptions');
      return Array.isArray(l) ? l : [];
    }
    function invbSaveSubs(list) { setDB('subscriptions', list); }
    function invbSubCycle(s) { return INVB_CYCLES[s && s.cycle] ? s.cycle : 'monthly'; }
    function invbSubActive(s) { return !!s && s.status !== 'cancelled'; }
    // What a subscription costs in a month and in a year, whatever its billing cycle.
    function invbSubMonthlyC(s) { return Math.round(Math.max(0, invbInt(s && s.amountC)) / INVB_CYCLES[invbSubCycle(s)].months); }
    function invbSubAnnualC(s) { return Math.max(0, invbInt(s && s.amountC)) * (12 / INVB_CYCLES[invbSubCycle(s)].months); }
    function invbSubTotals(subs, today) {
      today = today || invbToday();
      const year = String(invbParseIso(today).y);
      const out = { activeCount: 0, monthlyC: 0, annualC: 0, paidYearC: 0, soonC: 0, soonCount: 0, next: null };
      (subs || []).forEach(s => {
        if (!s) return;
        (Array.isArray(s.history) ? s.history : []).forEach(h => { if (h && String(h.date || '').slice(0, 4) === year) out.paidYearC += Math.max(0, invbInt(h.amountC)); });
        if (!invbSubActive(s)) return;
        out.activeCount++;
        out.annualC += invbSubAnnualC(s);
        out.monthlyC += invbSubMonthlyC(s);
        const d = invbDaysUntil(s.nextDate, today);
        if (d === null) return;
        if (d <= 30) { out.soonC += Math.max(0, invbInt(s.amountC)); out.soonCount++; }
        if (!out.next || String(s.nextDate) < String(out.next.nextDate)) out.next = s;
      });
      out.monthlyC = Math.round(out.annualC / 12);
      return out;
    }
    // "Renews in 12 days" with a tone for the pill: danger when past due, warn within 30 days.
    function invbSubDue(s, today) {
      if (!invbSubActive(s)) return { text: 'Cancelled', tone: 'neutral', days: null };
      const d = invbDaysUntil(s.nextDate, today);
      if (d === null) return { text: 'No renewal date', tone: 'neutral', days: null };
      if (d < 0) return { text: 'Overdue ' + (-d) + (d === -1 ? ' day' : ' days'), tone: 'danger', days: d };
      if (d === 0) return { text: 'Due today', tone: 'warn', days: d };
      if (d === 1) return { text: 'Due tomorrow', tone: 'warn', days: d };
      if (d <= 30) return { text: 'Due in ' + d + ' days', tone: 'warn', days: d };
      return { text: 'In ' + d + ' days', tone: 'ok', days: d };
    }
    // Check typed fields. Returns { ok, sub } or { ok:false, error }.
    function invbSubBuild(raw, existing) {
      const r = raw || {};
      const name = String(r.name || '').trim();
      if (!name) return { ok: false, error: 'Give the subscription a name.' };
      const amountC = invbParseC(r.amount);
      if (amountC === null) return { ok: false, error: 'Enter the amount like 25 or 25.50.' };
      if (!(amountC > 0)) return { ok: false, error: 'Enter what it costs each time.' };
      const next = String(r.nextDate || '').trim();
      if (next && !invbParseIso(next)) return { ok: false, error: 'Pick the renewal date.' };
      const ex = (existing && typeof existing === 'object') ? existing : {};
      const sub = Object.assign({}, ex, {
        id: ex.id || invbNewId('sub'), name: name, vendor: String(r.vendor || '').trim(), category: INVB_SUB_CATS.indexOf(r.category) > -1 ? r.category : 'Other',
        amountC: amountC, cycle: INVB_CYCLES[r.cycle] ? r.cycle : 'monthly', nextDate: next, autopay: !!r.autopay, account: String(r.account || '').trim(), notes: String(r.notes || '').trim(),
        status: ex.status === 'cancelled' ? 'cancelled' : 'active', history: Array.isArray(ex.history) ? ex.history : []
      });
      return { ok: true, sub: sub };
    }

    function invViewSubscriptions(b) {
      if (!invbCanEdit()) { b.innerHTML = ''; return; }
      const subs = invbSubs();
      const t = invbSubTotals(subs);
      invActions('<button type="button" class="btn btn-primary" onclick="invbOpenSubModal()">' + invbIcon('plus', 18) + ' Add subscription</button>');
      const cats = INVB_SUB_CATS.filter(c => subs.some(s => (s.category || 'Other') === c));
      _ibUI.scats = cats;
      if (_ibUI.scat && cats.indexOf(_ibUI.scat) < 0) _ibUI.scat = '';
      const chips = cats.length > 1 ? '<div class="inv-chips" role="group" aria-label="Filter by category"><button type="button" class="chip' + (_ibUI.scat ? '' : ' is-selected') + '" aria-pressed="' + (!_ibUI.scat) + '" onclick="invbSetSCat(\'\')">All</button>'
        + cats.map((c, i) => '<button type="button" class="chip' + (_ibUI.scat === c ? ' is-selected' : '') + '" aria-pressed="' + (_ibUI.scat === c) + '" onclick="invbSetSCat(' + i + ')">' + esc(c) + '</button>').join('') + '</div>' : '';
      let nextSub = '';
      if (t.next) { const d = invbSubDue(t.next); nextSub = esc(t.next.name) + ', ' + esc(d.text.toLowerCase()); }
      b.innerHTML = (subs.length ? '<div class="invb-stats invb-stats-4">'
        + invbStat('Each month', esc(invbFmt(t.monthlyC)), t.activeCount ? esc(String(t.activeCount)) + (t.activeCount === 1 ? ' active subscription' : ' active subscriptions') : '')
        + invbStat('Each year', esc(invbFmt(t.annualC)), '')
        + invbStat('Paid this year', esc(invbFmt(t.paidYearC)), 'Marked paid here')
        + invbStat('Next renewal', t.next ? esc(invbDateText(t.next.nextDate)) : '-', nextSub)
        + '</div>'
        + (t.soonCount ? '<div class="banner banner-warn" role="status">' + invbIcon('triangle-alert', 20) + '<div class="banner-body"><div class="banner-title">' + esc(invbFmt(t.soonC)) + ' due in the next 30 days across ' + t.soonCount + (t.soonCount === 1 ? ' subscription' : ' subscriptions') + '</div></div></div>' : '')
        + '<div class="inv-toolbar"><div class="input-wrap input-search inv-search">' + invbIcon('search', 18) + '<input id="invbSSearch" class="input" type="search" placeholder="Search name, vendor or policy number" aria-label="Search subscriptions" value="' + esc(_ibUI.sq) + '" oninput="invbOnSSearch(this.value)" autocomplete="off"></div></div>'
        + chips : '') + '<div id="invbSList"></div>';
      invbRenderSubList();
    }
    function invbSetSCat(i) { _ibUI.scat = i === '' ? '' : ((_ibUI.scats || [])[i] || ''); if (typeof invRenderBody === 'function') invRenderBody(); }
    function invbOnSSearch(v) { _ibUI.sq = v; invbRenderSubList(); }
    function invbFilterSubs(subs, q, cat) {
      let list = (subs || []).slice();
      if (cat) list = list.filter(s => (s.category || 'Other') === cat);
      const f = invbFold(q);
      if (f) list = list.filter(s => [s.name, s.vendor, s.category, s.account, s.notes].some(x => invbFold(x).indexOf(f) > -1));
      // active first, soonest renewal first, then the cancelled ones
      list.sort((a, b) => (invbSubActive(b) ? 1 : 0) - (invbSubActive(a) ? 1 : 0) || String(a.nextDate || '9999').localeCompare(String(b.nextDate || '9999')) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    function invbRenderSubList() {
      const host = document.getElementById('invbSList');
      if (!host) return;
      const subs = invbSubs();
      if (!subs.length) {
        host.innerHTML = invEmpty('refresh-cw', 'No subscriptions yet', 'Track what renews: annual insurance, software, storage, licenses. You will see what is due and what it all costs a month.',
          '<div class="invb-quick"><button type="button" class="btn btn-secondary" onclick="invbOpenSubModal(\'\', { category: \'Insurance\', cycle: \'annual\', name: \'Equipment insurance\' })">Add annual insurance</button>'
          + '<button type="button" class="btn btn-secondary" onclick="invbOpenSubModal(\'\', { category: \'Software\', cycle: \'monthly\' })">Add software</button>'
          + '<button type="button" class="btn btn-secondary" onclick="invbOpenSubModal()">Add something else</button></div>');
        return;
      }
      const list = invbFilterSubs(subs, _ibUI.sq, _ibUI.scat);
      if (!list.length) { host.innerHTML = invEmpty('search', 'Nothing matches', 'Clear the search or pick another category.'); return; }
      const per = s => esc(invbFmt(s.amountC)) + ' <span class="t-meta">' + esc(INVB_CYCLES[invbSubCycle(s)].per) + '</span>';
      const due = s => { const d = invbSubDue(s); return invPill(d.text, d.tone); };
      const sub = s => esc([s.vendor, s.category || 'Other', s.autopay ? 'Autopay' : ''].filter(Boolean).join(' · '));
      const pay = s => invbSubActive(s) ? '<button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation();invbSubPay(\'' + invbQ(s.id) + '\')">' + invbIcon('check', 16) + '<span>Mark paid</span></button>' : '';
      if (typeof invIsPhone === 'function' && invIsPhone()) {
        host.innerHTML = '<div class="row-list">' + list.map(s => '<div class="row inv-row' + (invbSubActive(s) ? '' : ' invb-off') + '" onclick="invbOpenSubModal(\'' + invbQ(s.id) + '\')" data-user-content>'
          + '<button type="button" class="row-link row-main" aria-label="Edit ' + esc(s.name) + '"><span class="row-title">' + esc(s.name) + '</span><span class="row-sub">' + sub(s) + '</span>'
          + '<span class="row-sub">' + per(s) + (s.nextDate ? ' · ' + esc(invbDateText(s.nextDate)) : '') + '</span></button>'
          + '<div class="row-trail invb-trail">' + due(s) + pay(s) + '</div></div>').join('') + '</div>';
        return;
      }
      host.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Subscription</th><th class="num">Cost</th><th>Next renewal</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>'
        + list.map(s => '<tr class="inv-tr' + (invbSubActive(s) ? '' : ' invb-off') + '" tabindex="0" data-user-content onclick="invbOpenSubModal(\'' + invbQ(s.id) + '\')" onkeydown="if(event.key===\'Enter\'){invbOpenSubModal(\'' + invbQ(s.id) + '\')}">'
          + '<td><strong>' + esc(s.name) + '</strong><div class="t-meta">' + sub(s) + (s.account ? ' · ' + esc(s.account) : '') + '</div></td>'
          + '<td class="num">' + per(s) + '</td>'
          + '<td>' + (s.nextDate ? esc(invbDateText(s.nextDate)) + ' ' : '') + due(s) + '</td><td class="num">' + pay(s) + '</td></tr>').join('') + '</tbody></table></div>';
    }

    // ── add / edit ───────────────────────────────────────────────────────────
    function invbOpenSubModal(id, preset) {
      if (!invbCanEdit()) return;
      const ex = id ? invbSubs().find(s => s && String(s.id) === String(id)) : null;
      if (id && !ex) return;
      const s = ex || Object.assign({ name: '', vendor: '', category: 'Software', amountC: 0, cycle: 'monthly', nextDate: '', autopay: false, account: '', notes: '', status: 'active', history: [] }, preset || {});
      const cyc = Object.keys(INVB_CYCLES).map(k => [k, INVB_CYCLES[k].label]);
      const hist = (s.history || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const sid = invbQ(s.id || '');
      const inner = '<form class="invb-form" onsubmit="invbSubmitSub(\'' + sid + '\');return false;">'
        + '<div class="field"><label class="field-label" for="ibsName">Name</label><input class="input" id="ibsName" type="text" required autocomplete="off" placeholder="Example: Equipment insurance" value="' + esc(s.name) + '"></div>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibsCat">Type</label>' + invbSelect('ibsCat', INVB_SUB_CATS, INVB_SUB_CATS.indexOf(s.category) > -1 ? s.category : 'Other') + '</div>'
        +   '<div class="field"><label class="field-label" for="ibsVendor">Company</label><input class="input" id="ibsVendor" type="text" autocomplete="off" placeholder="Who you pay" value="' + esc(s.vendor) + '"></div></div>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibsAmt">Cost each time</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="ibsAmt" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(invbInputC(s.amountC)) + '"></div></div>'
        +   '<div class="field"><label class="field-label" for="ibsCycle">How often</label>' + invbSelect('ibsCycle', cyc, invbSubCycle(s)) + '</div></div>'
        + '<div class="invb-two"><div class="field"><label class="field-label" for="ibsNext">Next renewal</label><input class="input" id="ibsNext" type="date" value="' + esc(s.nextDate || '') + '"></div>'
        +   '<div class="field"><label class="field-label" for="ibsAcct">Policy or account number</label><input class="input" id="ibsAcct" type="text" autocomplete="off" placeholder="Optional" value="' + esc(s.account || '') + '"></div></div>'
        + '<label class="check"><input type="checkbox" id="ibsAuto"' + (s.autopay ? ' checked' : '') + '><span class="check-box" aria-hidden="true"></span><span class="check-text">Charges automatically</span></label>'
        + '<div class="field"><label class="field-label" for="ibsNotes">Notes</label><textarea class="input" id="ibsNotes" rows="2" placeholder="Optional. Coverage, login hint, cancel by date">' + esc(s.notes || '') + '</textarea></div>'
        + (hist.length ? '<div class="invb-hist"><div class="field-label">Payments marked</div>' + hist.slice(0, 5).map(h => '<div class="invb-hist-row"><span>' + esc(invbDateText(h.date)) + '</span><span class="num">' + esc(invbFmt(h.amountC)) + '</span></div>').join('')
          + (hist.length > 5 ? '<div class="t-meta">and ' + (hist.length - 5) + ' earlier</div>' : '') + '</div>' : '')
        + '<div class="cst-modal-foot invb-foot">'
        + (ex ? '<button type="button" class="btn btn-ghost invb-del" onclick="invbSubDelete(\'' + sid + '\')">' + invbIcon('trash-2', 16) + '<span>Delete</span></button>'
            + '<button type="button" class="btn btn-secondary" onclick="invbSubToggle(\'' + sid + '\')">' + (invbSubActive(ex) ? 'Mark cancelled' : 'Turn back on') + '</button>' : '')
        + '<button type="button" class="btn btn-ghost" onclick="invbCloseModal(\'invbSubModal\')">Cancel</button><button type="submit" class="btn btn-primary">' + (ex ? 'Save' : 'Add subscription') + '</button></div></form>';
      invbOpenModal('invbSubModal', ex ? 'Edit subscription' : 'Add subscription', inner, 540);
      if (!ex) { const n = document.getElementById('ibsName'); if (n && n.focus) n.focus(); }
    }
    function invbSubmitSub(id) {
      if (!invbCanEdit()) return;
      const v = i => { const el = document.getElementById(i); return el ? el.value : ''; };
      const subs = invbSubs();
      const ex = id ? subs.find(s => s && String(s.id) === String(id)) : null;
      const r = invbSubBuild({ name: v('ibsName'), category: v('ibsCat'), vendor: v('ibsVendor'), amount: v('ibsAmt'), cycle: v('ibsCycle'), nextDate: v('ibsNext'),
        account: v('ibsAcct'), autopay: !!(document.getElementById('ibsAuto') || {}).checked, notes: v('ibsNotes') }, ex);
      if (!r.ok) { showToast(r.error, 'error'); return; }
      if (ex) subs[subs.indexOf(ex)] = r.sub; else subs.push(r.sub);
      invbSaveSubs(subs);
      invbCloseModal('invbSubModal');
      if (typeof invRenderBody === 'function') invRenderBody();
      showToast(ex ? 'Saved.' : 'Subscription added.', 'success');
    }
    // One payment: log it and move the renewal date forward by one billing period.
    function invbSubPay(id) {
      if (!invbCanEdit()) return;
      const subs = invbSubs();
      const s = subs.find(x => x && String(x.id) === String(id));
      if (!s || !invbSubActive(s)) return;
      const prevNext = s.nextDate || '', prevLen = (s.history || []).length;
      if (!Array.isArray(s.history)) s.history = [];
      s.history.push({ date: invbToday(), amountC: Math.max(0, invbInt(s.amountC)) });
      s.nextDate = invbAddMonths(s.nextDate || invbToday(), INVB_CYCLES[invbSubCycle(s)].months);
      invbSaveSubs(subs);
      if (typeof invRenderBody === 'function') invRenderBody();
      showUndoToast('Marked paid. Next renewal ' + invbDateText(s.nextDate) + '.', function() {
        const cur = invbSubs();
        const t = cur.find(x => x && String(x.id) === String(id));
        if (!t || !Array.isArray(t.history) || t.history.length <= prevLen) return;
        t.history.length = prevLen;
        t.nextDate = prevNext;
        invbSaveSubs(cur);
        if (typeof invRenderBody === 'function') invRenderBody();
      });
    }
    function invbSubToggle(id) {
      if (!invbCanEdit()) return;
      const subs = invbSubs();
      const s = subs.find(x => x && String(x.id) === String(id));
      if (!s) return;
      s.status = invbSubActive(s) ? 'cancelled' : 'active';
      invbSaveSubs(subs);
      invbCloseModal('invbSubModal');
      if (typeof invRenderBody === 'function') invRenderBody();
      showToast(s.status === 'cancelled' ? 'Marked cancelled. It no longer counts in your totals.' : 'Turned back on.', 'success');
    }
    function invbSubDelete(id) {
      if (!invbCanEdit()) return;
      const subs = invbSubs();
      const idx = subs.findIndex(x => x && String(x.id) === String(id));
      if (idx < 0) return;
      const removed = subs.splice(idx, 1)[0];
      invbSaveSubs(subs);
      invbCloseModal('invbSubModal');
      if (typeof invRenderBody === 'function') invRenderBody();
      showUndoToast('Subscription deleted.', function() {
        const cur = invbSubs();
        if (cur.some(x => x && x.id === removed.id)) return;
        cur.splice(Math.min(idx, cur.length), 0, removed);
        invbSaveSubs(cur);
        if (typeof invRenderBody === 'function') invRenderBody();
      });
    }
