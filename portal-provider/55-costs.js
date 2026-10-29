// ============================================================================
// portal-provider/55-costs.js  -  per-event costs, travel estimator, gear purchases, profit view (Costs tab on the event page)
// Classic script (no modules, no build step). Shares the global scope with the other portal-provider/*.js files.
// Loads after 50-money.js and before 60-library.js, so inventory helpers (invStore, invNextTag, invNormItem, invLog) are only
// called at click time, behind typeof guards.
//
// HARD RULE: costs never live on the event, on invoices, or on anything the client portal reads.
//   Costs:    getDB('eventCosts')  = { [eventId]: { lines: [], travel: [], updatedAt } }   (provider only)
//   Settings: settings.costs       (home base, gas price, mpg, IRS rate, thin-margin threshold, per-person table)
//   Gear:     item.purchase on the inventory item (equipment key)
// Money is integer cents everywhere. Only master / admin / event-architect see any of it (same check as invCanEdit).
// Public globals: costsSettings, costsSaveSettings, costsGet, costsSave, costsLineAmountC, costsTotals, costsTravelCalc,
//   costsLookupMiles, costsRecordGearPurchase, costsSuggestions, costsRenderTab, costsOnTabOpen, costsExportCsv, costsCanView,
//   costsCrewRenderTab, costsCrewPayC, costsCrewTotals, costsUpsertCrewLine (Crew pay tab; crew rows live in eventCosts[eventId].crew).
// ============================================================================

    const COST_CATS = ['Travel', 'Crew', 'Gear bought', 'Rentals', 'Supplies', 'Venue & permits', 'Food', 'Parking & tolls', 'Other'];
    // Cost ideas by booked service. `key` is the pull-list module key (invModulesFor) and `match` the same keywords as INV_DEFAULT_PULL_LISTS.
    const COST_SUGGEST = {
      co2: { match: ['co2', 'cryo'], items: [{ label: 'CO2 tank refill', cat: 'Supplies' }] },
      cold_spark: { match: ['cold spark', 'spark'], items: [{ label: 'Spark granules', cat: 'Supplies' }] },
      dancing_on_clouds: { match: ['cloud', 'low fog', 'dry ice'], items: [{ label: 'Fog fluid', cat: 'Supplies' }, { label: 'Ice or dry ice', cat: 'Supplies' }] },
      led_wall: { match: ['led wall', 'video wall', 'led panel'], items: [{ label: 'Truck or van rental', cat: 'Rentals' }] }
    };
    const COST_ALWAYS = [
      { label: 'Parking', cat: 'Parking & tolls' }, { label: 'Tolls', cat: 'Parking & tolls' }, { label: 'Crew meals', cat: 'Food' },
      { label: 'Venue COI / insurance', cat: 'Venue & permits' }, { label: 'Load-in fees', cat: 'Venue & permits' }
    ];
    const COST_ROLES = ['master', 'admin', 'event-architect'];
    const COST_PAY_METHODS = ['Zelle', 'Venmo', 'Cash', 'Check', 'Other'];
    let _costsUI = { openEvent: '' };
    let _costsGeoCache = {};
    let _costsGeoLast = 0;
    let _costsGeoChain = null;

    // ── small pure helpers ───────────────────────────────────────────────────
    function costsNum(v, def) { const n = (v === '' || v === null || v === undefined) ? NaN : Number(v); return isFinite(n) ? n : (def === undefined ? 0 : def); }
    function costsNumOrNull(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return isFinite(n) ? n : null; }
    function costsInt(v) { const n = Number(v); return isFinite(n) ? Math.round(n) : 0; }
    function costsQ(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_.:-]/g, ''); }
    function costsNewId(prefix) {
      const base = (typeof genId === 'function') ? genId() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      return (prefix || 'c') + base;
    }
    function costsToday() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // "12", "$12.5", "1,234.50" -> cents. Empty -> 0. Anything else (letters, negative) -> null.
    function costsParseC(v) {
      const t = String(v == null ? '' : v).replace(/[$,\s]/g, '');
      if (t === '') return 0;
      if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
      return Math.round(parseFloat(t) * 100);
    }
    function costsFmtC(c) {
      const v = costsInt(c), a = Math.abs(v), whole = a % 100 === 0;
      return (v < 0 ? '-' : '') + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    }
    function costsInputC(c) { const v = costsInt(c); return v ? (v / 100).toFixed(2) : ''; }
    function costsMilesText(m) { const n = Math.round(costsNum(m) * 10) / 10; return (n % 1 === 0 ? String(n) : n.toFixed(1)) + ' mi'; }

    // ── role gate ────────────────────────────────────────────────────────────
    function costsRoleOk(role) { return COST_ROLES.indexOf(role) > -1; }
    function costsRole() {
      const u = (typeof BSPortal !== 'undefined' && BSPortal.getCurrentUser && BSPortal.getCurrentUser()) || {};
      return u.role || 'master';
    }
    function costsCanView() { return costsRoleOk(costsRole()); }

    // ── settings (settings.costs). All keys optional; defaults fill the gaps. ──
    function costsSettings() {
      const s = (typeof getDB === 'function') ? getDB('settings') : null;
      const base = (s && !Array.isArray(s) && typeof s === 'object') ? s : {};
      const c = (base.costs && typeof base.costs === 'object') ? base.costs : {};
      const biz = (base.business && typeof base.business === 'object') ? base.business : {};
      const gas = costsNum(c.gasPrice, 3.75), mpg = costsNum(c.mpg, 15);
      return {
        homeBase: String(c.homeBase || biz.address || '').trim(),
        gasPrice: gas >= 0 ? gas : 3.75,
        mpg: mpg > 0 ? mpg : 15,
        mode: c.mode === 'irs' ? 'irs' : 'gas',
        irsRate: costsNum(c.irsRate, 0.70) >= 0 ? costsNum(c.irsRate, 0.70) : 0.70,
        wearPerMile: costsNum(c.wearPerMile, 0) >= 0 ? costsNum(c.wearPerMile, 0) : 0,
        minMargin: costsNum(c.minMargin, 30),
        people: (c.people && typeof c.people === 'object' && !Array.isArray(c.people)) ? c.people : {}
      };
    }
    function costsSaveSettings(patch) {
      const s = getDB('settings');
      const base = (s && !Array.isArray(s) && typeof s === 'object') ? s : {};
      base.costs = Object.assign({}, (base.costs && typeof base.costs === 'object') ? base.costs : {}, patch || {});
      setDB('settings', base);
    }
    function costsPerson(settings, who) {
      const people = (settings && settings.people) || {};
      const w = String(who || '').trim();
      if (!w) return null;
      if (people[w]) return people[w];
      const lw = w.toLowerCase();
      const k = Object.keys(people).find(key => people[key] && String(people[key].name || key).trim().toLowerCase() === lw);
      return k ? people[k] : null;
    }

    // ── storage: getDB('eventCosts') map. Never touches events, invoices or anything a client can read. ──
    function costsMap() {
      const m = getDB('eventCosts');
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    }
    function costsGet(eventId) {
      const e = costsMap()[String(eventId)];
      const o = (e && typeof e === 'object') ? e : {};
      return { lines: Array.isArray(o.lines) ? o.lines : [], travel: Array.isArray(o.travel) ? o.travel : [], crew: Array.isArray(o.crew) ? o.crew : [], updatedAt: o.updatedAt || 0 };
    }
    function costsSave(eventId, data) {
      const next = Object.assign({}, costsMap());
      const d = data || {};
      next[String(eventId)] = { lines: Array.isArray(d.lines) ? d.lines : [], travel: Array.isArray(d.travel) ? d.travel : [], crew: Array.isArray(d.crew) ? d.crew : [], updatedAt: Date.now() };
      setDB('eventCosts', next);
      return next[String(eventId)];
    }
    function costsFindEvent(eventId) {
      const evs = getDB('events');
      const list = Array.isArray(evs) ? evs : [];
      return list.find(e => e && String(e.id) === String(eventId)) || list.find(e => e && costsQ(e.id) === String(eventId)) || null;
    }

    // ── line math ────────────────────────────────────────────────────────────
    // Counted amount of a line = round(amountC * chargePct / 100). chargePct is 1-100 (default 100); bought gear is reusable, so only part may be charged.
    function costsLineAmountC(line) {
      const amt = costsInt(line && line.amountC);
      let pct = (line && line.chargePct !== undefined && line.chargePct !== null && line.chargePct !== '') ? Number(line.chargePct) : 100;
      if (!isFinite(pct) || pct <= 0) pct = 100;
      if (pct > 100) pct = 100;
      return Math.round(amt * pct / 100);
    }
    // Pure: totals from a list of lines and a revenue figure. profitC is "if fully paid" (billed minus costs); profitSoFarC uses what is collected.
    function costsTotalsFrom(lines, revenue, minMargin) {
      const out = { countedC: 0, estC: 0, paidC: 0, byCat: {}, billedC: 0, collectedC: 0, profitC: 0, profitSoFarC: 0, marginPct: null, marginSoFarPct: null, hasRevenue: false, thin: false };
      (lines || []).forEach(l => {
        if (!l) return;
        const c = costsLineAmountC(l);
        out.countedC += c;
        if (l.status === 'paid') out.paidC += c; else out.estC += c;
        const cat = COST_CATS.indexOf(l.cat) > -1 ? l.cat : 'Other';
        out.byCat[cat] = (out.byCat[cat] || 0) + c;
      });
      const r = revenue || {};
      out.billedC = costsInt(r.billedC);
      out.collectedC = costsInt(r.collectedC);
      out.hasRevenue = out.billedC > 0;
      out.profitC = out.billedC - out.countedC;
      out.profitSoFarC = out.collectedC - out.countedC;
      out.marginPct = out.billedC > 0 ? Math.round(out.profitC / out.billedC * 1000) / 10 : null;
      out.marginSoFarPct = out.collectedC > 0 ? Math.round(out.profitSoFarC / out.collectedC * 1000) / 10 : null;
      const mm = minMargin === undefined || minMargin === null ? 30 : Number(minMargin);
      out.thin = out.hasRevenue && out.countedC > 0 && out.marginPct !== null && out.marginPct < mm;
      return out;
    }
    function costsInvVoid(inv) { return /^(void|voided|cancelled|canceled)$/i.test(String((inv && inv.status) || '')); }
    function costsInvPaidC(inv) {
      if (inv && Array.isArray(inv.payments) && inv.payments.length) return inv.payments.reduce((s, p) => s + Math.round(costsNum(p && p.amount) * 100), 0);
      return String((inv && inv.status) || '').toLowerCase() === 'paid' ? Math.round(costsNum(inv.total) * 100) : 0;
    }
    // Billed and collected for one event, in cents. Uses the payment schedule when the event has a price, else the non-void invoices.
    function costsRevenue(eventId) {
      const all = getDB('invoices');
      const invs = Array.isArray(all) ? all : [];
      const ev = costsFindEvent(eventId);
      if (ev && typeof _mnySchedule === 'function') {
        try {
          const terms = (typeof _mnyTerms === 'function') ? _mnyTerms() : null;
          const sc = _mnySchedule(ev, invs, terms, new Date());
          if (sc && sc.ok) return { billedC: costsInt(sc.totalC), collectedC: costsInt(sc.paidC) };
        } catch (e) { console.warn('[costs] schedule', e); }
      }
      const mine = invs.filter(i => i && String(i.eventId) === String(eventId) && !costsInvVoid(i));
      return { billedC: mine.reduce((s, i) => s + Math.round(costsNum(i.total) * 100), 0), collectedC: mine.reduce((s, i) => s + costsInvPaidC(i), 0) };
    }
    function costsTotals(eventId) {
      return costsTotalsFrom(costsGet(eventId).lines, costsRevenue(eventId), costsSettings().minMargin);
    }

    // ── travel math ──────────────────────────────────────────────────────────
    // miles: a typed total (milesOverride) wins as written. Otherwise the looked-up one-way miles, doubled for a round trip
    // (unless the row says the lookup already returned the whole loop: milesIsLoop).
    function costsTravelCalc(row, settings, ev) {
      const r = row || {};
      const s = settings || costsSettings();
      const person = costsPerson(s, r.who);
      const mode = (person && (person.mode === 'irs' || person.mode === 'gas')) ? person.mode : (s.mode === 'irs' ? 'irs' : 'gas');
      const ov = costsNumOrNull(r.milesOverride);
      let miles;
      if (ov !== null && ov >= 0) miles = ov;
      else { const base = Math.max(0, costsNum(r.miles)); miles = (r.roundTrip !== false && !r.milesIsLoop) ? base * 2 : base; }
      miles = Math.round(miles * 10) / 10;
      const rowMpg = costsNumOrNull(r.mpg), pMpg = person ? costsNumOrNull(person.mpg) : null;
      const mpg = rowMpg > 0 ? rowMpg : (pMpg > 0 ? pMpg : (s.mpg > 0 ? s.mpg : 15));
      const rowGas = costsNumOrNull(r.gasPrice);
      const gasPrice = rowGas !== null && rowGas >= 0 ? rowGas : s.gasPrice;
      const gasC = mode === 'gas' ? Math.round(miles / mpg * gasPrice * 100) : 0;
      const mileageC = mode === 'irs' ? Math.round(miles * costsNum(s.irsRate, 0.70) * 100) : 0;
      const wearC = Math.round(miles * costsNum(s.wearPerMile) * 100);
      const tollsC = Math.max(0, costsInt(r.tollsC)), parkingC = Math.max(0, costsInt(r.parkingC));
      return { miles: miles, mpg: mpg, gasPrice: gasPrice, mode: mode, gasC: gasC, mileageC: mileageC, wearC: wearC, tollsC: tollsC, parkingC: parkingC,
        totalC: gasC + mileageC + wearC + tollsC + parkingC };
    }
    function costsTravelResultText(calc) {
      if (!calc || !(calc.miles > 0)) return 'Look up the distance or type the miles to see the cost.';
      const what = calc.mode === 'irs' ? 'mileage' : 'gas';
      const base = calc.mode === 'irs' ? calc.mileageC : calc.gasC;
      let t = '~' + costsMilesText(calc.miles) + ', about ' + costsFmtC(base) + ' ' + what;
      const extra = calc.wearC + calc.tollsC + calc.parkingC;
      if (extra > 0) t += ' (' + costsFmtC(calc.totalC) + ' with extras)';
      return t;
    }
    // One cost line per travel row: save again and it updates, never duplicates. Returns the line.
    function costsUpsertTravelLine(data, row, calc, ev) {
      const lines = data.lines;
      let line = lines.find(l => l && l.kind === 'travel' && String(l.refId) === String(row.id));
      const who = String(row.who || '').trim();
      const label = who ? 'Travel for ' + who : 'Travel';
      if (!line) {
        line = { id: costsNewId('cl'), cat: 'Travel', label: label, amountC: 0, date: (ev && ev.date) || '', vendor: '', status: 'est', kind: 'travel', refId: row.id, chargePct: 100, note: '' };
        lines.push(line);
      }
      line.amountC = costsInt(calc.totalC);
      line.label = label;
      line.cat = 'Travel';
      row.lineId = line.id;
      return line;
    }

    // ── distance lookup (OpenStreetMap Nominatim + OSRM, no keys). Runs on click only, one geocode at a time, 1.1 s apart. ──
    function costsSleep(ms) { return new Promise(res => setTimeout(res, ms)); }
    function costsFetchJson(url) {
      return new Promise((resolve, reject) => {
        let ctl = null, timer = null;
        try { ctl = (typeof AbortController === 'function') ? new AbortController() : null; } catch (e) { ctl = null; }
        if (ctl) timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 9000);
        fetch(url, ctl ? { signal: ctl.signal, headers: { 'Accept': 'application/json' } } : { headers: { 'Accept': 'application/json' } })
          .then(r => { if (timer) clearTimeout(timer); if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(resolve, err => { if (timer) clearTimeout(timer); reject(err); });
      });
    }
    function costsGeocode(addr) {
      const key = String(addr || '').trim().toLowerCase();
      if (!key) return Promise.resolve(null);
      if (_costsGeoCache[key]) return Promise.resolve(_costsGeoCache[key]);
      const run = () => {
        if (_costsGeoCache[key]) return Promise.resolve(_costsGeoCache[key]);
        const wait = Math.max(0, _costsGeoLast + 1100 - Date.now());
        return costsSleep(wait).then(() => {
          _costsGeoLast = Date.now();
          return costsFetchJson('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(String(addr).trim()));
        }).then(arr => {
          const hit = Array.isArray(arr) && arr[0];
          const lat = hit ? parseFloat(hit.lat) : NaN, lon = hit ? parseFloat(hit.lon) : NaN;
          if (!isFinite(lat) || !isFinite(lon)) return null;
          _costsGeoCache[key] = { lat: lat, lon: lon };
          return _costsGeoCache[key];
        });
      };
      const p = (_costsGeoChain || Promise.resolve()).then(run, run);
      _costsGeoChain = p.then(() => null, () => null);
      return p;
    }
    // Resolves { ok:true, miles, oneWayMiles } or { ok:false }. `miles` is the one-way path start > stops > destination, doubled when roundTrip.
    function costsLookupMiles(startAddr, stops, destAddr, roundTrip) {
      const addrs = [startAddr].concat(Array.isArray(stops) ? stops : [], [destAddr]).map(a => String(a || '').trim()).filter(Boolean);
      if (addrs.length < 2) return Promise.resolve({ ok: false });
      const pts = [];
      let chain = Promise.resolve();
      addrs.forEach(a => { chain = chain.then(() => costsGeocode(a)).then(pt => { if (!pt) throw new Error('geocode'); pts.push(pt); }); });
      return chain.then(() => {
        const coords = pts.map(p => p.lon + ',' + p.lat).join(';');
        return costsFetchJson('https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=false');
      }).then(j => {
        const meters = j && j.routes && j.routes[0] && Number(j.routes[0].distance);
        if (!isFinite(meters) || meters <= 0) return { ok: false };
        const oneWay = Math.round(meters / 1609.344 * 10) / 10;
        return { ok: true, oneWayMiles: oneWay, miles: roundTrip === false ? oneWay : Math.round(oneWay * 20) / 10 };
      }).catch(() => ({ ok: false }));
    }

    // ── suggestions from the booked services ─────────────────────────────────
    function costsKw(text, kw) {
      const k = String(kw || '').toLowerCase();
      if (!k) return false;
      const rx = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (k.length <= 3 ? new RegExp('(^|[^a-z0-9])' + rx + '($|[^a-z0-9])') : new RegExp('(^|[^a-z0-9])' + rx)).test(text);
    }
    function costsServiceTexts(ev) {
      const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080)).replace(/\s+/g, ' ').trim();
      if (typeof invEventServiceTexts === 'function') { try { return invEventServiceTexts(ev); } catch (e) {} }
      const out = [];
      ((ev && ev.services) || []).forEach(s => {
        if (s == null) return;
        out.push(norm(typeof s === 'string' ? s : [s.service || s.name || '', s.subOption || '', s.customNote || ''].join(' ')));
      });
      return out.filter(Boolean);
    }
    function costsSuggestions(ev) {
      const texts = costsServiceTexts(ev || {});
      const out = [];
      const seen = {};
      const add = (it, svc) => { const k = it.label.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push({ label: it.label, cat: it.cat, service: svc || '' }); };
      Object.keys(COST_SUGGEST).forEach(k => {
        const def = COST_SUGGEST[k];
        if (def.match.some(kw => texts.some(t => costsKw(t, kw)))) def.items.forEach(it => add(it, k));
      });
      COST_ALWAYS.forEach(it => add(it, ''));
      return out;
    }

    // ── copy from another event: estimates only, dates cleared, no gear lines ──
    function costsCopyLines(src) {
      const out = [];
      ((src && src.lines) || []).forEach(l => {
        if (!l || l.kind === 'gear' || l.cat === 'Gear bought') return;
        if (l.kind === 'crew' && l.refId) return;   // pay lines that belong to a crew row come over with the row (costsCopyCrew)
        out.push({ id: costsNewId('cl'), cat: COST_CATS.indexOf(l.cat) > -1 ? l.cat : 'Other', label: l.label || '', amountC: costsInt(l.amountC), date: '',
          vendor: l.vendor || '', status: 'est', kind: l.kind === 'crew' ? 'crew' : 'manual', refId: '', chargePct: 100, note: l.note || '' });
      });
      return out;
    }

    // ── CSV ──────────────────────────────────────────────────────────────────
    function costsCsvCell(v) {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // spreadsheets run text that starts with these as formulas
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function costsCsvRows(data, settings) {
      const rows = [['Date', 'Category', 'Item', 'Vendor', 'Status', 'Amount', 'Charged amount', 'Miles']];
      let amt = 0, chg = 0;
      ((data && data.lines) || []).forEach(l => {
        if (!l) return;
        let miles = '';
        if (l.kind === 'travel') {
          const tr = ((data && data.travel) || []).find(t => t && String(t.id) === String(l.refId));
          if (tr) miles = String(costsTravelCalc(tr, settings, null).miles);
        }
        const a = costsInt(l.amountC), c = costsLineAmountC(l);
        amt += a; chg += c;
        rows.push([l.date || '', l.cat || 'Other', l.label || '', l.vendor || '', l.status === 'paid' ? 'Paid' : 'Estimate', (a / 100).toFixed(2), (c / 100).toFixed(2), miles]);
      });
      rows.push(['', '', 'Total', '', '', (amt / 100).toFixed(2), (chg / 100).toFixed(2), '']);
      return rows;
    }
    function costsCsvText(rows) { return rows.map(r => r.map(costsCsvCell).join(',')).join('\r\n') + '\r\n'; }
    function costsExportCsv(eventId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const text = costsCsvText(costsCsvRows(costsGet(eventId), costsSettings()));
      try {
        const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug = String(ev.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
        a.href = url; a.download = 'costs-' + slug + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('Costs exported.', 'success');
      } catch (e) { console.warn('[costs] csv', e); showToast('Could not export. Try again.', 'error'); }
    }

    // ── gear bought for an event: makes the inventory item(s) and one cost line ──
    function costsRecordGearPurchase(opts) {
      const o = opts || {};
      if (typeof invStore !== 'function' || typeof invNextTag !== 'function' || typeof invNormItem !== 'function' || typeof invLog !== 'function') return { ok: false, reason: 'inventory' };
      const name = String(o.name || '').trim();
      if (!name) return { ok: false, reason: 'name' };
      const ev = costsFindEvent(o.eventId) || {};
      const qty = Math.max(1, Math.round(costsNum(o.qty, 1)) || 1);
      const unitC = Math.max(0, costsInt(o.unitPriceC));
      let tracking = o.tracking === 'consumable' ? 'consumable' : (o.tracking === 'bulk' ? 'bulk' : (o.tracking === 'serialized' || o.serial ? 'serialized' : 'bulk'));
      if (qty > 1 && tracking === 'serialized') tracking = 'bulk';
      const date = o.date || costsToday();
      const store = invStore();
      const items = store.list();
      const tag = invNextTag(items);
      const it = {
        id: (typeof genId === 'function') ? genId() : costsNewId('i'),
        name: name, category: o.category || 'Other', serial: tracking === 'serialized' ? String(o.serial || '').trim() : '',
        value: unitC ? (unitC / 100).toFixed(2) : '', notes: o.note || '', status: 'available',
        tracking: tracking, qty: qty, unit: 'pcs', tag: tag, kit: null, buffers: { before: 2, after: 2 }, condition: 'A', maintenance: [], history: [],
        purchase: { date: date, priceC: unitC, qty: qty, vendor: o.vendor || '', orderNo: o.orderNo || '', paidWith: o.paidWith || '', warrantyUntil: o.warrantyUntil || '',
          receiptNote: o.receiptNote || '', eventId: String(o.eventId || ''), eventName: ev.name || '', source: 'event' }
      };
      invNormItem(it);
      invLog(it, 'register', o.eventId || null, 'Bought for ' + (ev.name || 'an event'));
      items.push(it);
      store.save(items);
      let pct = Math.round(costsNum(o.chargePct, 100));
      if (!(pct >= 1)) pct = 100;
      if (pct > 100) pct = 100;
      const data = costsGet(o.eventId);
      const line = { id: costsNewId('cl'), cat: 'Gear bought', label: qty > 1 ? name + ' x' + qty : name, amountC: unitC * qty, date: date, vendor: o.vendor || '',
        status: 'paid', kind: 'gear', refId: it.id, chargePct: pct, note: o.note || '' };
      data.lines.push(line);
      costsSave(o.eventId, data);
      return { ok: true, item: it, line: line, tag: tag };
    }

    // ============================================================================
    //  UI
    // ============================================================================
    function costsIcon(name, size) { return (window.CRMUI && typeof CRMUI.icon === 'function') ? CRMUI.icon(name, size || 16) : ''; }
    function costsRerender(eventId) {
      const el = document.getElementById('tabCosts');
      const ev = costsFindEvent(eventId);
      if (el && ev) el.innerHTML = costsRenderTab(ev);
    }
    function costsOnTabOpen(eventId) { _costsUI.openEvent = String(eventId || ''); }

    function costsStat(label, val, sub, cls) {
      return '<div class="cst-stat"><div class="cst-stat-label">' + esc(label) + '</div><div class="cst-stat-val num' + (cls ? ' ' + cls : '') + '">' + val + '</div>' + (sub ? '<div class="cst-stat-sub">' + sub + '</div>' : '') + '</div>';
    }
    function costsSummaryHtml(eventId) {
      const t = costsTotals(eventId), s = costsSettings();
      const profitCls = !t.hasRevenue ? '' : (t.profitC < 0 ? 'is-danger' : (t.thin ? 'is-warn' : 'is-ok'));
      let costsSub = '';
      if (t.countedC > 0) costsSub = esc(costsFmtC(t.estC)) + ' estimated, ' + esc(costsFmtC(t.paidC)) + ' paid';
      const thin = t.thin ? '<span class="pill pill-warn" data-ui="pill">Thin margin</span>' : '';
      const note = !t.hasRevenue ? '<p class="cst-note">No price or invoices on this event yet, so profit is not shown.</p>' : '';
      return '<div class="cst-stats">'
        + costsStat('Collected', t.hasRevenue || t.collectedC ? esc(costsFmtC(t.collectedC)) : '-', t.hasRevenue ? 'of ' + esc(costsFmtC(t.billedC)) + ' billed' : '')
        + costsStat('Costs', esc(costsFmtC(t.countedC)), costsSub)
        + costsStat('Profit if fully paid', t.hasRevenue ? esc(costsFmtC(t.profitC)) : '-', t.hasRevenue ? 'So far ' + esc(costsFmtC(t.profitSoFarC)) : '', profitCls)
        + costsStat('Margin', t.marginPct === null ? '-' : esc(t.marginPct + '%'), thin || (t.hasRevenue ? 'Aim for ' + esc(String(s.minMargin)) + '% or more' : ''))
        + '</div>' + note;
    }
    function costsLineHtml(eventId, l) {
      const eid = costsQ(eventId), lid = costsQ(l.id), isGear = l.kind === 'gear' || l.cat === 'Gear bought';
      const paid = l.status === 'paid';
      const counted = costsLineAmountC(l);
      const partial = counted !== costsInt(l.amountC);
      const catOpts = COST_CATS.map(c => '<option value="' + esc(c) + '"' + (c === l.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
      return '<li class="cst-line" data-line="' + lid + '" data-user-content>'
        + '<div class="cst-line-main">'
        +   '<input class="input cst-label" type="text" value="' + esc(l.label || '') + '" aria-label="Cost name" placeholder="What was it" onchange="costsLineSet(\'' + eid + '\',\'' + lid + '\',\'label\',this.value)">'
        +   '<div class="input-wrap input-money cst-amt-wrap"><span class="input-prefix">$</span><input class="input cst-amt" type="text" inputmode="decimal" value="' + esc(costsInputC(l.amountC)) + '" placeholder="0.00" aria-label="Amount" onchange="costsLineSet(\'' + eid + '\',\'' + lid + '\',\'amount\',this.value)"></div>'
        +   '<button type="button" class="chip cst-status' + (paid ? ' is-selected' : '') + '" aria-pressed="' + paid + '" onclick="costsLineToggle(\'' + eid + '\',\'' + lid + '\')" title="Tap to switch between estimate and paid">' + (paid ? 'Paid' : 'Estimate') + '</button>'
        +   '<button type="button" class="btn btn-ghost btn-icon cst-del" aria-label="Remove ' + esc(l.label || 'cost') + '" onclick="costsLineDelete(\'' + eid + '\',\'' + lid + '\')">' + costsIcon('trash-2', 18) + '</button>'
        + '</div>'
        + '<div class="cst-line-sub">'
        +   '<select class="input cst-cat" aria-label="Category" onchange="costsLineSet(\'' + eid + '\',\'' + lid + '\',\'cat\',this.value)">' + catOpts + '</select>'
        +   '<input class="input cst-vendor" type="text" value="' + esc(l.vendor || '') + '" placeholder="Vendor" aria-label="Vendor" onchange="costsLineSet(\'' + eid + '\',\'' + lid + '\',\'vendor\',this.value)">'
        +   '<input class="input cst-date" type="date" value="' + esc(l.date || '') + '" aria-label="Date" onchange="costsLineSet(\'' + eid + '\',\'' + lid + '\',\'date\',this.value)">'
        +   (isGear ? '<label class="cst-charge">Charge this event <input class="input cst-pct" type="number" min="1" max="100" step="1" inputmode="numeric" value="' + esc(String(l.chargePct == null ? 100 : l.chargePct)) + '" aria-label="Percent charged to this event" onchange="costsLineSet(\'' + eid + '\',\'' + lid + '\',\'chargePct\',this.value)">%</label>' : '')
        +   '<span class="cst-counted t-meta num" data-counted="' + lid + '">' + (partial ? 'Charged ' + esc(costsFmtC(counted)) : '') + '</span>'
        + '</div></li>';
    }
    function costsLinesHtml(eventId, data) {
      if (!data.lines.length) return '<div class="empty cst-empty"><p class="empty-text">No costs yet. Add one below or tap a suggestion.</p></div>';
      const groups = {};
      data.lines.forEach(l => { if (!l) return; const c = COST_CATS.indexOf(l.cat) > -1 ? l.cat : 'Other'; (groups[c] = groups[c] || []).push(l); });
      return COST_CATS.filter(c => groups[c]).map(c => {
        const sum = groups[c].reduce((s, l) => s + costsLineAmountC(l), 0);
        return '<section class="cst-group" aria-label="' + esc(c) + '"><div class="cst-group-head"><h3 class="section-label">' + esc(c) + '</h3><span class="cst-cat-total num" data-cat-total="' + esc(c) + '">' + esc(costsFmtC(sum)) + '</span></div>'
          + '<ul class="cst-lines">' + groups[c].map(l => (l.kind === 'crew' && costsCrewRow(data, l.refId)) ? costsCrewLineHtml(l) : costsLineHtml(eventId, l)).join('') + '</ul></section>';
      }).join('');
    }
    function costsAddFormHtml(eventId) {
      const eid = costsQ(eventId);
      const catOpts = COST_CATS.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
      return '<form class="cst-add" onsubmit="costsAddFromForm(\'' + eid + '\');return false;" aria-label="Add a cost">'
        + '<div class="section-label">Add a cost</div>'
        + '<div class="cst-add-grid">'
        +   (typeof lfBlockHtml === 'function' ? lfBlockHtml('cstAdd') : '')
        +   '<div class="field"><label class="field-label" for="cstAddCat">Category</label><select class="input" id="cstAddCat">' + catOpts + '</select></div>'
        +   '<div class="field cst-add-wide"><label class="field-label" for="cstAddLabel">What was it</label><input class="input" id="cstAddLabel" type="text" autocomplete="off" placeholder="Example: Truck rental"></div>'
        +   '<div class="field"><label class="field-label" for="cstAddAmt">Amount</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="cstAddAmt" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></div></div>'
        +   '<div class="field"><label class="field-label" for="cstAddVendor">Vendor</label><input class="input" id="cstAddVendor" type="text" autocomplete="off" placeholder="Optional"></div>'
        +   '<div class="field"><label class="field-label" for="cstAddDate">Date</label><input class="input" id="cstAddDate" type="date"></div>'
        +   '<div class="field"><span class="field-label" id="cstAddPaidLbl">Status</span><label class="check cst-add-paid"><input type="checkbox" id="cstAddPaid" aria-labelledby="cstAddPaidLbl"><span class="check-box" aria-hidden="true"></span><span class="check-text">Already paid</span></label></div>'
        + '</div>'
        + '<button type="submit" class="btn btn-secondary">' + costsIcon('plus', 16) + '<span>Add cost</span></button>'
        + '</form>';
    }
    function costsSuggestHtml(eventId, ev, data) {
      const have = {};
      data.lines.forEach(l => { have[String(l.label || '').toLowerCase()] = 1; });
      const list = costsSuggestions(ev);
      const chips = list.map((s, i) => have[s.label.toLowerCase()] ? '' : '<button type="button" class="chip" onclick="costsAddSuggestion(\'' + costsQ(eventId) + '\',' + i + ')">' + costsIcon('plus', 14) + esc(s.label) + '</button>').join('');
      if (!chips) return '';
      return '<div class="card cst-card"><div class="card-head"><h2 class="card-title">Suggested costs</h2></div><p class="cst-note">Tap one to add it as an estimate, then fill in the amount.</p><div class="cst-chips">' + chips + '</div></div>';
    }

    // Travel
    function costsEffStart(row, s) {
      if (row.startMode === 'other') return String(row.startAddr || '').trim();
      const p = costsPerson(s, row.who);
      return String((p && p.startAddr) || s.homeBase || '').trim();
    }
    function costsEffDest(row, ev) { return String(row.destAddr || (ev && (ev.venueAddress || ev.venueName)) || '').trim(); }
    function costsRowKey(row, s, ev) { return JSON.stringify([costsEffStart(row, s), row.stops || [], costsEffDest(row, ev)]); }
    function costsTravelResultHtml(row, s, ev, data) {
      const calc = costsTravelCalc(row, s, ev);
      const linked = (data.lines || []).find(l => l && l.kind === 'travel' && String(l.refId) === String(row.id));
      let t = esc(costsTravelResultText(calc));
      if (calc.miles > 0) t += ' <span class="t-meta">at ' + esc(String(calc.mpg)) + ' mpg, ' + esc('$' + calc.gasPrice.toFixed(2)) + ' a gallon</span>';
      let warn = '';
      if (row.miles && row.lookedUp && row.lookedUp !== costsRowKey(row, s, ev) && costsNumOrNull(row.milesOverride) === null) warn = '<div class="cst-warn">The addresses changed since the last lookup. Look up the distance again.</div>';
      if (linked && linked.amountC !== calc.totalC) warn += '<div class="cst-warn">The costs list still shows ' + esc(costsFmtC(linked.amountC)) + '. Update it to ' + esc(costsFmtC(calc.totalC)) + '.</div>';
      return t + warn;
    }
    function costsTravelRowHtml(eventId, row, s, ev, data, crewNames) {
      const eid = costsQ(eventId), rid = costsQ(row.id);
      const set = (f, el) => 'onchange="costsTravelSet(\'' + eid + '\',\'' + rid + '\',\'' + f + '\',' + (el || 'this.value') + ')"';
      const home = row.startMode !== 'other';
      const p = costsPerson(s, row.who);
      const homeAddr = String((p && p.startAddr) || s.homeBase || '').trim();
      const calc = costsTravelCalc(row, s, ev);
      const linked = (data.lines || []).find(l => l && l.kind === 'travel' && String(l.refId) === String(row.id));
      const stops = (row.stops || []).map((a, i) => '<div class="cst-stop"><input class="input" type="text" value="' + esc(a) + '" placeholder="Stop address" aria-label="Stop ' + (i + 1) + '" autocomplete="off" onchange="costsTravelStop(\'' + eid + '\',\'' + rid + '\',' + i + ',this.value)">'
        + '<button type="button" class="btn btn-ghost btn-icon" aria-label="Remove stop ' + (i + 1) + '" onclick="costsTravelStopRemove(\'' + eid + '\',\'' + rid + '\',' + i + ')">' + costsIcon('x', 18) + '</button></div>').join('');
      const milesShown = calc.miles > 0 ? String(calc.miles) : '';
      return '<div class="cst-trip" data-trip="' + rid + '" data-user-content>'
        + '<div class="cst-trip-head"><div class="field cst-who"><label class="field-label" for="cstWho_' + rid + '">Who is driving</label><input class="input" id="cstWho_' + rid + '" type="text" list="cstCrew_' + rid + '" value="' + esc(row.who || '') + '" placeholder="Pick a crew member or type a name" autocomplete="off" ' + set('who') + '>'
        +   '<datalist id="cstCrew_' + rid + '">' + crewNames.map(n => '<option value="' + esc(n) + '"></option>').join('') + '</datalist></div>'
        + '<button type="button" class="btn btn-ghost" onclick="costsTravelRemove(\'' + eid + '\',\'' + rid + '\')">' + costsIcon('trash-2', 16) + '<span>Remove trip</span></button></div>'
        + '<div class="field"><span class="field-label">Starts from</span><div class="seg cst-seg" role="group" aria-label="Starts from">'
        +   '<button type="button" class="seg-btn' + (home ? ' active' : '') + '" aria-pressed="' + home + '" onclick="costsTravelMode(\'' + eid + '\',\'' + rid + '\',\'home\')">Home base</button>'
        +   '<button type="button" class="seg-btn' + (!home ? ' active' : '') + '" aria-pressed="' + (!home) + '" onclick="costsTravelMode(\'' + eid + '\',\'' + rid + '\',\'other\')">Somewhere else today</button></div>'
        +   (home ? (homeAddr ? '<div class="cst-from t-meta">' + esc(homeAddr) + '</div>' : '<div class="cst-warn">No home base is set yet. Add it in Settings, or choose Somewhere else today and type an address.</div>')
                  : '<input class="input" type="text" value="' + esc(row.startAddr || '') + '" placeholder="Where are you starting from" aria-label="Start address" autocomplete="off" ' + set('startAddr') + '>')
        + '</div>'
        + '<div class="field"><span class="field-label">Stops on the way</span>' + stops
        +   '<button type="button" class="btn btn-ghost btn-sm cst-addstop" onclick="costsTravelStopAdd(\'' + eid + '\',\'' + rid + '\')">' + costsIcon('plus', 16) + '<span>Add a stop</span></button></div>'
        + '<div class="field"><label class="field-label" for="cstDest_' + rid + '">Destination</label><input class="input" id="cstDest_' + rid + '" type="text" value="' + esc(row.destAddr || '') + '" placeholder="' + esc((ev && (ev.venueAddress || ev.venueName)) || 'Venue address') + '" autocomplete="off" ' + set('destAddr') + '></div>'
        + '<label class="check cst-round"><input type="checkbox"' + (row.roundTrip !== false ? ' checked' : '') + ' onchange="costsTravelSet(\'' + eid + '\',\'' + rid + '\',\'roundTrip\',this.checked)"><span class="check-box" aria-hidden="true"></span><span class="check-text">Round trip</span></label>'
        + '<div class="cst-lookup"><button type="button" class="btn btn-secondary btn-sm" id="cstLook_' + rid + '" onclick="costsTravelLookup(\'' + eid + '\',\'' + rid + '\')">' + costsIcon('map-pin', 16) + '<span>Look up distance</span></button>'
        +   '<span class="cst-msg t-meta" id="cstMsg_' + rid + '" role="status" aria-live="polite"></span></div>'
        + '<p class="cst-privacy t-meta">The lookup sends the addresses to OpenStreetMap services. You can type the miles instead.</p>'
        + '<div class="cst-nums">'
        +   '<div class="field"><label class="field-label" for="cstMi_' + rid + '">Total miles</label><input class="input" id="cstMi_' + rid + '" type="text" inputmode="decimal" value="' + esc(milesShown) + '" placeholder="0" ' + set('miles') + '></div>'
        +   '<div class="field"><label class="field-label" for="cstMpg_' + rid + '">Miles per gallon</label><input class="input" id="cstMpg_' + rid + '" type="text" inputmode="decimal" value="' + esc(row.mpg == null ? '' : String(row.mpg)) + '" placeholder="' + esc(String(calc.mpg)) + '" ' + set('mpg') + '></div>'
        +   '<div class="field"><label class="field-label" for="cstGas_' + rid + '">Gas price a gallon</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="cstGas_' + rid + '" type="text" inputmode="decimal" value="' + esc(row.gasPrice == null ? '' : String(row.gasPrice)) + '" placeholder="' + esc(s.gasPrice.toFixed(2)) + '" ' + set('gasPrice') + '></div></div>'
        +   '<div class="field"><label class="field-label" for="cstToll_' + rid + '">Tolls</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="cstToll_' + rid + '" type="text" inputmode="decimal" value="' + esc(costsInputC(row.tollsC)) + '" placeholder="0.00" ' + set('tolls') + '></div></div>'
        +   '<div class="field"><label class="field-label" for="cstPark_' + rid + '">Parking</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="cstPark_' + rid + '" type="text" inputmode="decimal" value="' + esc(costsInputC(row.parkingC)) + '" placeholder="0.00" ' + set('parking') + '></div></div>'
        + '</div>'
        + '<div class="cst-result"><div class="cst-result-text" id="cstRes_' + rid + '" aria-live="polite">' + costsTravelResultHtml(row, s, ev, data) + '</div>'
        +   '<button type="button" class="btn btn-primary" onclick="costsTravelAdd(\'' + eid + '\',\'' + rid + '\')">' + (linked ? 'Update costs' : 'Add to costs') + '</button></div>'
        + '</div>';
    }
    function costsTravelHtml(eventId, ev, data) {
      const s = costsSettings();
      const crew = (typeof _evCrewList === 'function') ? (function() { try { return _evCrewList(ev).map(c => c.name); } catch (e) { return []; } })() : [];
      const rows = data.travel.length ? data.travel.map(r => costsTravelRowHtml(eventId, r, s, ev, data, crew)).join('')
        : '<div class="empty cst-empty"><p class="empty-text">No trips yet. Add one to estimate gas from your home base to the venue.</p></div>';
      return '<div class="card cst-card"><div class="card-head"><h2 class="card-title">Travel</h2>'
        + '<button type="button" class="btn btn-secondary btn-sm" onclick="costsTravelAddRow(\'' + costsQ(eventId) + '\')">' + costsIcon('plus', 16) + '<span>Add a trip</span></button></div>'
        + '<div class="cst-trips">' + rows + '</div></div>';
    }

    // The tab. Returns HTML for #tabCosts. Not for crew: they get a short note (the tab button is hidden for them too).
    function costsRenderTab(ev) {
      if (!costsCanView()) return '<div class="empty"><p class="empty-text">Costs are only visible to the owner and managers.</p></div>';
      if (!ev) return '';
      const eid = costsQ(ev.id);
      const data = costsGet(ev.id);
      return '<div class="cst-tab" data-event-id="' + esc(ev.id) + '">'
        + '<div id="cstSummary">' + costsSummaryHtml(ev.id) + '</div>'
        + '<div class="card cst-card"><div class="card-head"><h2 class="card-title">Costs</h2>'
        +   '<button type="button" class="btn btn-secondary btn-sm" onclick="costsOpenGearModal(\'' + eid + '\')">' + costsIcon('package', 16) + '<span>Bought gear for this event</span></button></div>'
        +   '<div id="cstLines">' + costsLinesHtml(ev.id, data) + '</div>'
        +   costsAddFormHtml(ev.id)
        + '</div>'
        + costsSuggestHtml(ev.id, ev, data)
        + costsTravelHtml(ev.id, ev, data)
        + '<div class="cst-foot"><button type="button" class="btn btn-secondary" onclick="costsOpenCopyModal(\'' + eid + '\')">' + costsIcon('copy', 16) + '<span>Copy costs from another event</span></button>'
        +   '<button type="button" class="btn btn-secondary" onclick="costsExportCsv(\'' + eid + '\')">' + costsIcon('download', 16) + '<span>Export CSV</span></button></div>'
        + '</div>';
    }

    // Light refresh after an inline edit: the summary and subtotals, not the whole tab (so focus stays where it is).
    function costsRefreshTotals(eventId) {
      const sum = document.getElementById('cstSummary');
      if (sum) sum.innerHTML = costsSummaryHtml(eventId);
      const t = costsTotals(eventId);
      document.querySelectorAll('[data-cat-total]').forEach(el => { el.textContent = costsFmtC(t.byCat[el.getAttribute('data-cat-total')] || 0); });
    }

    // ── line handlers ────────────────────────────────────────────────────────
    function costsAddLine(eventId, fields) {
      const data = costsGet(eventId);
      const line = Object.assign({ id: costsNewId('cl'), cat: 'Other', label: '', amountC: 0, date: '', vendor: '', status: 'est', kind: 'manual', refId: '', chargePct: 100, note: '' }, fields || {});
      data.lines.push(line);
      costsSave(eventId, data);
      return line;
    }
    function costsAddFromForm(eventId) {
      if (!costsCanView()) return;
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const label = v('cstAddLabel').trim();
      if (!label) { showToast('Give the cost a name first.', 'info'); const el = document.getElementById('cstAddLabel'); if (el) el.focus(); return; }
      const c = costsParseC(v('cstAddAmt'));
      if (c === null) { showToast('Enter an amount like 25 or 25.50.', 'error'); return; }
      const paidEl = document.getElementById('cstAddPaid');
      costsAddLine(eventId, { cat: COST_CATS.indexOf(v('cstAddCat')) > -1 ? v('cstAddCat') : 'Other', label: label, amountC: c, vendor: v('cstAddVendor').trim(), date: v('cstAddDate'), status: paidEl && paidEl.checked ? 'paid' : 'est' });
      costsRerender(eventId);
      showToast('Cost added.', 'success');
    }
    function costsAddSuggestion(eventId, idx) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId);
      const s = costsSuggestions(ev || {})[idx];
      if (!s) return;
      const line = costsAddLine(eventId, { cat: s.cat, label: s.label, amountC: 0, status: 'est', date: (ev && ev.date) || '' });
      costsRerender(eventId);
      const amt = document.querySelector('[data-line="' + costsQ(line.id) + '"] .cst-amt');
      if (amt) { try { amt.focus(); } catch (e) {} }
    }
    function costsLineSet(eventId, lineId, field, value) {
      if (!costsCanView()) return;
      const data = costsGet(eventId);
      const l = data.lines.find(x => x && String(x.id) === String(lineId));
      if (!l) return;
      if (field === 'amount') {
        const c = costsParseC(value);
        if (c === null) { showToast('Enter an amount like 25 or 25.50.', 'error'); costsRerender(eventId); return; }
        l.amountC = c;
      } else if (field === 'chargePct') {
        const p = Math.round(Number(value));
        l.chargePct = isFinite(p) && p >= 1 ? Math.min(100, p) : 100;
      } else if (field === 'cat') {
        l.cat = COST_CATS.indexOf(value) > -1 ? value : 'Other';
      } else if (field === 'label' || field === 'vendor' || field === 'date' || field === 'note') {
        l[field] = String(value == null ? '' : value).trim();
      } else return;
      costsSave(eventId, data);
      if (field === 'cat') { costsRerender(eventId); return; }
      costsRefreshTotals(eventId);
      const cEl = document.querySelector('[data-counted="' + costsQ(l.id) + '"]');
      if (cEl) { const c = costsLineAmountC(l); cEl.textContent = c !== costsInt(l.amountC) ? 'Charged ' + costsFmtC(c) : ''; }
      if (field === 'amount') { const el = document.querySelector('[data-line="' + costsQ(l.id) + '"] .cst-amt'); if (el) el.value = costsInputC(l.amountC); }
      if (field === 'amount' || field === 'chargePct') {
        // a travel line edited by hand no longer matches its trip; the trip card says so
        const tr = l.kind === 'travel' ? data.travel.find(t => t && String(t.id) === String(l.refId)) : null;
        if (tr) costsTravelRefresh(eventId, tr.id);
      }
    }
    function costsLineToggle(eventId, lineId) {
      if (!costsCanView()) return;
      const data = costsGet(eventId);
      const l = data.lines.find(x => x && String(x.id) === String(lineId));
      if (!l) return;
      l.status = l.status === 'paid' ? 'est' : 'paid';
      costsSave(eventId, data);
      costsRerender(eventId);
    }
    function costsLineDelete(eventId, lineId) {
      if (!costsCanView()) return;
      const data = costsGet(eventId);
      const idx = data.lines.findIndex(x => x && String(x.id) === String(lineId));
      if (idx < 0) return;
      const removed = data.lines.splice(idx, 1)[0];
      costsSave(eventId, data);
      costsRerender(eventId);
      const gear = removed.kind === 'gear';
      showUndoToast(gear ? 'Removed from costs. The item stays in Inventory.' : 'Cost removed.', function() {
        const d = costsGet(eventId);
        if (d.lines.some(x => x && x.id === removed.id)) return;
        d.lines.splice(Math.min(idx, d.lines.length), 0, removed);
        costsSave(eventId, d);
        costsRerender(eventId);
      });
    }

    // ── travel handlers ──────────────────────────────────────────────────────
    function costsTravelRow(data, rowId) { return data.travel.find(t => t && String(t.id) === String(rowId)) || null; }
    function costsTravelAddRow(eventId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId);
      const crew = (typeof _evCrewList === 'function') ? (function() { try { return _evCrewList(ev); } catch (e) { return []; } })() : [];
      const used = data.travel.map(t => String(t.who || '').toLowerCase());
      const next = crew.find(c => used.indexOf(String(c.name).toLowerCase()) < 0);
      data.travel.push({ id: costsNewId('tr'), who: next ? next.name : '', startMode: 'home', startAddr: '', stops: [], destAddr: '', roundTrip: true, milesOverride: null, miles: null,
        mpg: null, gasPrice: null, tollsC: 0, parkingC: 0, lineId: '', lookedUp: '' });
      costsSave(eventId, data);
      costsRerender(eventId);
    }
    function costsTravelRemove(eventId, rowId) {
      if (!costsCanView()) return;
      const data = costsGet(eventId);
      const idx = data.travel.findIndex(t => t && String(t.id) === String(rowId));
      if (idx < 0) return;
      const removed = data.travel.splice(idx, 1)[0];
      costsSave(eventId, data);
      costsRerender(eventId);
      showUndoToast('Trip removed. Its cost line, if any, stays in the list.', function() {
        const d = costsGet(eventId);
        if (d.travel.some(t => t && t.id === removed.id)) return;
        d.travel.splice(Math.min(idx, d.travel.length), 0, removed);
        costsSave(eventId, d);
        costsRerender(eventId);
      });
    }
    function costsTravelMode(eventId, rowId, mode) {
      if (!costsCanView()) return;
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row) return;
      row.startMode = mode === 'other' ? 'other' : 'home';
      costsSave(eventId, data);
      costsRerender(eventId);
    }
    function costsTravelStopAdd(eventId, rowId) {
      if (!costsCanView()) return;
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row) return;
      row.stops = (row.stops || []).concat(['']);
      costsSave(eventId, data);
      costsRerender(eventId);
    }
    function costsTravelStopRemove(eventId, rowId, i) {
      if (!costsCanView()) return;
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row) return;
      row.stops = (row.stops || []).filter((a, k) => k !== i);
      costsSave(eventId, data);
      costsRerender(eventId);
    }
    function costsTravelStop(eventId, rowId, i, value) {
      if (!costsCanView()) return;
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row || !Array.isArray(row.stops)) return;
      row.stops[i] = String(value || '').trim();
      costsSave(eventId, data);
      costsTravelRefresh(eventId, rowId);
    }
    // Field edits on a trip. Saves, then redraws only the result line.
    function costsTravelSet(eventId, rowId, field, value) {
      if (!costsCanView()) return;
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row) return;
      const money = v => { const c = costsParseC(v); if (c === null) { showToast('Enter an amount like 5 or 5.50.', 'error'); } return c; };
      if (field === 'who' || field === 'startAddr' || field === 'destAddr') row[field] = String(value || '').trim();
      else if (field === 'roundTrip') row.roundTrip = !!value;
      else if (field === 'miles') {
        const t = String(value == null ? '' : value).trim();
        if (t === '') row.milesOverride = null;
        else { const n = Number(t.replace(/,/g, '')); if (!isFinite(n) || n < 0) { showToast('Enter the miles as a number.', 'error'); costsRerender(eventId); return; } row.milesOverride = n; }
      } else if (field === 'mpg' || field === 'gasPrice') {
        const t = String(value == null ? '' : value).replace(/[$,\s]/g, '');
        if (t === '') row[field] = null;
        else { const n = Number(t); if (!isFinite(n) || n < 0 || (field === 'mpg' && n === 0)) { showToast('Enter a number.', 'error'); costsRerender(eventId); return; } row[field] = n; }
      } else if (field === 'tolls' || field === 'parking') {
        const c = money(value);
        if (c === null) { costsRerender(eventId); return; }
        row[field === 'tolls' ? 'tollsC' : 'parkingC'] = c;
      } else return;
      costsSave(eventId, data);
      costsTravelRefresh(eventId, rowId);
      if (field === 'who') costsRerender(eventId);   // the person's usual start address and mpg may change
      else if (field === 'roundTrip' || field === 'miles') { const mi = document.getElementById('cstMi_' + costsQ(rowId)); if (mi && field === 'roundTrip' && row.milesOverride === null) mi.value = costsTravelCalc(row, costsSettings(), null).miles || ''; }
    }
    function costsTravelRefresh(eventId, rowId) {
      const el = document.getElementById('cstRes_' + costsQ(rowId));
      if (!el) return;
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (row) el.innerHTML = costsTravelResultHtml(row, costsSettings(), costsFindEvent(eventId), data);
    }
    function costsTravelLookup(eventId, rowId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const s = costsSettings();
      let data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row) return;
      const rid = costsQ(rowId);
      const msg = document.getElementById('cstMsg_' + rid), btn = document.getElementById('cstLook_' + rid);
      const say = t => { const m = document.getElementById('cstMsg_' + rid); if (m) m.textContent = t; };
      const start = costsEffStart(row, s), dest = costsEffDest(row, ev);
      if (!start || !dest) { say('Add a start and a destination first, or type the miles.'); return; }
      if (btn) btn.disabled = true;
      say('Looking up the distance...');
      const key = costsRowKey(row, s, ev);
      costsLookupMiles(start, row.stops || [], dest, row.roundTrip !== false).then(function(res) {
        const b = document.getElementById('cstLook_' + rid); if (b) b.disabled = false;
        if (!res || !res.ok) { say("Couldn't look that up. Type the miles instead."); return; }
        data = costsGet(eventId); row = costsTravelRow(data, rowId);
        if (!row) return;
        row.miles = res.oneWayMiles;
        row.milesIsLoop = false;
        row.milesOverride = null;
        row.lookedUp = key;
        costsSave(eventId, data);
        costsRerender(eventId);
      });
    }
    function costsTravelAdd(eventId, rowId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId), row = costsTravelRow(data, rowId);
      if (!row) return;
      const calc = costsTravelCalc(row, costsSettings(), ev);
      if (!(calc.miles > 0) && calc.totalC <= 0) { showToast('Look up the distance or type the miles first.', 'info'); return; }
      const existed = data.lines.some(l => l && l.kind === 'travel' && String(l.refId) === String(row.id));
      costsUpsertTravelLine(data, row, calc, ev);
      costsSave(eventId, data);
      costsRerender(eventId);
      showToast(existed ? 'Travel cost updated.' : 'Travel added to costs.', 'success');
    }

    // ── crew pay (the Crew pay tab) ──────────────────────────────────────────
    // data.crew[] = { id, who, role, payType: 'flat'|'hourly', rateC (flat pay, or pay per hour), hours, status: 'est'|'paid', paidDate, method, note, lineId }
    // Every crew row keeps ONE cost line (kind 'crew', cat Crew, refId = row id), so the Costs tab and profit always include crew pay.
    function costsCrewRow(data, id) { return ((data && data.crew) || []).find(r => r && String(r.id) === String(id)) || null; }
    function costsCrewPayC(row) {
      if (!row) return 0;
      const rate = Math.max(0, costsInt(row.rateC));
      if (row.payType === 'hourly') { const h = costsNum(row.hours, 0); return h > 0 ? Math.round(rate * h) : 0; }
      return rate;
    }
    function costsCrewTotals(crew) {
      const out = { totalC: 0, paidC: 0, owedC: 0, count: 0, owedCount: 0 };
      (crew || []).forEach(r => {
        if (!r) return;
        const c = costsCrewPayC(r);
        out.count++; out.totalC += c;
        if (r.status === 'paid') out.paidC += c; else { out.owedC += c; if (c > 0) out.owedCount++; }
      });
      return out;
    }
    function costsCrewLabel(row) { const who = String((row && row.who) || '').trim(); return who ? 'Crew pay: ' + who : 'Crew pay'; }
    // One cost line per crew row: change the row and the line follows, never duplicates. A row with no pay yet makes no line.
    function costsUpsertCrewLine(data, row, ev) {
      const payC = costsCrewPayC(row);
      let line = data.lines.find(l => l && l.kind === 'crew' && String(l.refId) === String(row.id));
      if (!line) {
        if (payC <= 0) return null;
        line = { id: costsNewId('cl'), cat: 'Crew', label: '', amountC: 0, date: '', vendor: '', status: 'est', kind: 'crew', refId: row.id, chargePct: 100, note: '' };
        data.lines.push(line);
      }
      const paid = row.status === 'paid';
      line.amountC = payC;
      line.label = costsCrewLabel(row);
      line.cat = 'Crew';
      line.status = paid ? 'paid' : 'est';
      line.date = (paid && row.paidDate) || (ev && ev.date) || '';
      line.vendor = paid ? String(row.method || '') : '';
      line.note = String(row.role || '');
      row.lineId = line.id;
      return line;
    }
    function costsCrewDropLine(data, row) {
      const i = data.lines.findIndex(l => l && l.kind === 'crew' && String(l.refId) === String(row.id));
      return i > -1 ? { idx: i, line: data.lines.splice(i, 1)[0] } : null;
    }
    // A person's most recent crew pay on any other event, so a new row starts from what they were paid last time.
    function costsLastPay(who, exceptEventId) {
      const k = String(who || '').trim().toLowerCase();
      if (!k) return null;
      const map = costsMap();
      let best = null;
      Object.keys(map).forEach(id => {
        const e = map[id];
        if (id === String(exceptEventId) || !e || !Array.isArray(e.crew)) return;
        e.crew.forEach(r => {
          if (r && String(r.who || '').trim().toLowerCase() === k && costsCrewPayC(r) > 0 && (!best || (e.updatedAt || 0) > best.at)) best = { at: e.updatedAt || 0, payType: r.payType === 'hourly' ? 'hourly' : 'flat', rateC: costsInt(r.rateC) };
        });
      });
      return best;
    }
    function costsCrewNewRow(eventId, who, role) {
      const last = costsLastPay(who, eventId);
      return { id: costsNewId('cw'), who: who || '', role: role || '', payType: last ? last.payType : 'flat', rateC: last ? last.rateC : 0, hours: null, status: 'est', paidDate: '', method: '', note: '', lineId: '' };
    }
    // Copying from another event: same people and same pay, as estimates, skipping anyone already listed.
    function costsCopyCrew(src, existing) {
      const have = {};
      (existing || []).forEach(r => { have[String((r && r.who) || '').trim().toLowerCase()] = 1; });
      const out = [];
      ((src && src.crew) || []).forEach(r => {
        if (!r) return;
        const k = String(r.who || '').trim().toLowerCase();
        if (k && have[k]) return;
        if (k) have[k] = 1;
        out.push({ id: costsNewId('cw'), who: r.who || '', role: r.role || '', payType: r.payType === 'hourly' ? 'hourly' : 'flat', rateC: costsInt(r.rateC),
          hours: r.payType === 'hourly' ? costsNum(r.hours, 0) : null, status: 'est', paidDate: '', method: '', note: r.note || '', lineId: '' });
      });
      return out;
    }
    function costsCrewEventList(ev) {
      try { return (typeof _evCrewList === 'function') ? _evCrewList(ev || {}) : []; } catch (e) { return []; }
    }

    function costsCrewSummaryHtml(crew) {
      const t = costsCrewTotals(crew);
      return '<div class="cst-stats cst-stats-3">'
        + costsStat('Crew pay', esc(costsFmtC(t.totalC)), t.count ? esc(String(t.count)) + (t.count === 1 ? ' person' : ' people') : '')
        + costsStat('Paid', esc(costsFmtC(t.paidC)), '', t.paidC > 0 ? 'is-ok' : '')
        + costsStat('Still owed', esc(costsFmtC(t.owedC)), t.owedCount ? esc(String(t.owedCount)) + (t.owedCount === 1 ? ' payment to send' : ' payments to send') : '', t.owedC > 0 ? 'is-warn' : '')
        + '</div>';
    }
    // The read-only version of a crew line in the Costs list: pay is edited on the Crew pay tab so the two never disagree.
    function costsCrewLineHtml(l) {
      const paid = l.status === 'paid';
      return '<li class="cst-line cst-line-crew" data-line="' + costsQ(l.id) + '" data-user-content><div class="cst-ro">'
        + '<span class="cst-ro-label">' + esc(l.label || 'Crew pay') + '</span>'
        + '<span class="cst-ro-amt num">' + esc(costsFmtC(costsLineAmountC(l))) + '</span>'
        + '<span class="pill ' + (paid ? 'pill-ok' : 'pill-warn') + '" data-ui="pill">' + (paid ? 'Paid' : 'Estimate') + '</span>'
        + '<button type="button" class="btn btn-ghost btn-sm" onclick="costsGoCrewTab()">Edit in Crew pay</button></div></li>';
    }
    function costsGoCrewTab() {
      const b = Array.prototype.find.call(document.querySelectorAll('#detailContent .tab-btn'), x => /'crewpay'/.test(x.getAttribute('onclick') || ''));
      if (b) b.click();
    }
    function costsCrewRowHtml(eventId, r, crewList) {
      const eid = costsQ(eventId), rid = costsQ(r.id);
      const hourly = r.payType === 'hourly', paid = r.status === 'paid';
      const set = (f, el) => 'onchange="costsCrewSet(\'' + eid + '\',\'' + rid + '\',\'' + f + '\',' + (el || 'this.value') + ')"';
      const money = (id, label, val, ph, f) => '<div class="field"><label class="field-label" for="' + id + '">' + label + '</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(costsInputC(val)) + '" placeholder="' + ph + '" ' + set(f) + '></div></div>';
      const methods = '<option value="">How paid</option>' + COST_PAY_METHODS.map(m => '<option value="' + esc(m) + '"' + (m === r.method ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
      return '<div class="cst-crew" data-crew="' + rid + '" data-user-content>'
        + '<div class="cst-crew-head">'
        +   '<div class="field cst-who"><label class="field-label" for="cstCwWho_' + rid + '">Who</label><input class="input" id="cstCwWho_' + rid + '" type="text" list="cstCwList_' + rid + '" value="' + esc(r.who || '') + '" placeholder="Pick a crew member or type a name" autocomplete="off" ' + set('who') + '>'
        +     '<datalist id="cstCwList_' + rid + '">' + crewList.map(c => '<option value="' + esc(c.name) + '"></option>').join('') + '</datalist></div>'
        +   '<div class="field cst-crew-role"><label class="field-label" for="cstCwRole_' + rid + '">Job on this event</label><input class="input" id="cstCwRole_' + rid + '" type="text" value="' + esc(r.role || '') + '" placeholder="Example: DJ, lighting tech" autocomplete="off" ' + set('role') + '></div>'
        +   '<button type="button" class="btn btn-ghost btn-icon cst-del" aria-label="Remove ' + esc(r.who || 'this person') + '" onclick="costsCrewRemove(\'' + eid + '\',\'' + rid + '\')">' + costsIcon('trash-2', 18) + '</button>'
        + '</div>'
        + '<div class="cst-crew-pay">'
        +   '<div class="field"><span class="field-label">Pay type</span><div class="seg cst-seg" role="group" aria-label="Pay type">'
        +     '<button type="button" class="seg-btn' + (!hourly ? ' active' : '') + '" aria-pressed="' + (!hourly) + '" onclick="costsCrewSet(\'' + eid + '\',\'' + rid + '\',\'payType\',\'flat\')">Flat</button>'
        +     '<button type="button" class="seg-btn' + (hourly ? ' active' : '') + '" aria-pressed="' + hourly + '" onclick="costsCrewSet(\'' + eid + '\',\'' + rid + '\',\'payType\',\'hourly\')">By the hour</button></div></div>'
        +   (hourly ? money('cstCwRate_' + rid, 'Pay an hour', r.rateC, '0.00', 'rate')
                      + '<div class="field"><label class="field-label" for="cstCwHrs_' + rid + '">Hours</label><input class="input" id="cstCwHrs_' + rid + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(r.hours == null || r.hours === 0 ? '' : String(r.hours)) + '" placeholder="0" ' + set('hours') + '></div>'
                    : money('cstCwRate_' + rid, 'Pay for the event', r.rateC, '0.00', 'rate'))
        +   '<div class="cst-crew-total"><span class="t-meta">Total</span><span class="cst-crew-amt num" id="cstCwTot_' + rid + '">' + esc(costsFmtC(costsCrewPayC(r))) + '</span></div>'
        + '</div>'
        + '<div class="cst-crew-foot">'
        +   '<button type="button" class="chip cst-status' + (paid ? ' is-selected' : '') + '" aria-pressed="' + paid + '" onclick="costsCrewToggle(\'' + eid + '\',\'' + rid + '\')" title="Tap to switch between not paid yet and paid">' + (paid ? 'Paid' : 'Not paid yet') + '</button>'
        +   (paid ? '<input class="input cst-date" type="date" value="' + esc(r.paidDate || '') + '" aria-label="Date paid" ' + set('paidDate') + '><select class="input" aria-label="How paid" ' + set('method') + '>' + methods + '</select>' : '')
        +   '<input class="input cst-crew-note" type="text" value="' + esc(r.note || '') + '" placeholder="Note, optional" aria-label="Note" autocomplete="off" ' + set('note') + '>'
        + '</div></div>';
    }
    function costsCrewRenderTab(ev) {
      if (!costsCanView()) return '<div class="empty"><p class="empty-text">Crew pay is only visible to the owner and managers.</p></div>';
      if (!ev) return '';
      const eid = costsQ(ev.id);
      const data = costsGet(ev.id);
      const crewList = costsCrewEventList(ev);
      const have = {};
      data.crew.forEach(r => { have[String((r && r.who) || '').trim().toLowerCase()] = 1; });
      const missing = crewList.filter(c => !have[String(c.name || '').trim().toLowerCase()]);
      const t = costsCrewTotals(data.crew);
      const actions = '<div class="cst-crew-actions">'
        + (missing.length > 1 ? '<button type="button" class="btn btn-secondary btn-sm" onclick="costsCrewAddAll(\'' + eid + '\')">' + costsIcon('users', 16) + '<span>Add everyone on this event</span></button>' : '')
        + (t.owedCount > 0 ? '<button type="button" class="btn btn-secondary btn-sm" onclick="costsCrewMarkAllPaid(\'' + eid + '\')">' + costsIcon('check', 16) + '<span>Mark all paid</span></button>' : '')
        + '<button type="button" class="btn btn-secondary btn-sm" onclick="costsCrewAddRow(\'' + eid + '\')">' + costsIcon('plus', 16) + '<span>Add crew member</span></button></div>';
      const rows = data.crew.length ? '<div class="cst-crews">' + data.crew.map(r => costsCrewRowHtml(ev.id, r, crewList)).join('') + '</div>'
        : '<div class="empty cst-empty"><p class="empty-text">' + (crewList.length ? 'No crew pay yet. Add everyone on this event, then set what each person gets.' : 'No crew pay yet. Add a crew member to set what they get.') + '</p></div>';
      return '<div class="cst-tab" data-event-id="' + esc(ev.id) + '">'
        + '<div id="cstCrewSummary">' + costsCrewSummaryHtml(data.crew) + '</div>'
        + '<div class="card cst-card"><div class="card-head"><h2 class="card-title">Crew pay</h2>' + actions + '</div>' + rows + '</div>'
        + '<p class="cst-note">Pay set here counts in Costs under Crew, so your profit already includes it.</p>'
        + '</div>';
    }

    function costsCrewRerender(eventId) {
      const el = document.getElementById('tabCrewpay');
      const ev = costsFindEvent(eventId);
      if (el && ev) el.innerHTML = costsCrewRenderTab(ev);
    }
    function costsCrewAddRow(eventId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId);
      const used = data.crew.map(r => String((r && r.who) || '').trim().toLowerCase());
      const next = costsCrewEventList(ev).find(c => used.indexOf(String(c.name || '').trim().toLowerCase()) < 0);
      data.crew.push(costsCrewNewRow(eventId, next ? next.name : '', next ? next.role : ''));
      costsSave(eventId, data);
      costsCrewRerender(eventId);
    }
    function costsCrewAddAll(eventId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId);
      const used = {};
      data.crew.forEach(r => { used[String((r && r.who) || '').trim().toLowerCase()] = 1; });
      let n = 0;
      costsCrewEventList(ev).forEach(c => {
        const k = String(c.name || '').trim().toLowerCase();
        if (!k || used[k]) return;
        used[k] = 1;
        const row = costsCrewNewRow(eventId, c.name, c.role);
        data.crew.push(row); costsUpsertCrewLine(data, row, ev); n++;
      });
      if (!n) { showToast('Everyone on this event is already listed.', 'info'); return; }
      costsSave(eventId, data);
      costsCrewRerender(eventId);
      showToast('Added ' + n + (n === 1 ? ' person.' : ' people.'), 'success');
    }
    function costsCrewRefresh(eventId, data, row) {
      const sum = document.getElementById('cstCrewSummary');
      if (sum) sum.innerHTML = costsCrewSummaryHtml(data.crew);
      const tot = document.getElementById('cstCwTot_' + costsQ(row.id));
      if (tot) tot.textContent = costsFmtC(costsCrewPayC(row));
    }
    function costsCrewSet(eventId, rowId, field, value) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId), row = costsCrewRow(data, rowId);
      if (!row) return;
      let redraw = false;
      if (field === 'who') {
        row.who = String(value == null ? '' : value).trim();
        const match = costsCrewEventList(ev).find(c => String(c.name || '').trim().toLowerCase() === row.who.toLowerCase());
        if (match && !row.role) row.role = match.role || '';
        if (!costsCrewPayC(row)) { const last = costsLastPay(row.who, eventId); if (last) { row.payType = last.payType; row.rateC = last.rateC; } }
        redraw = true;
      } else if (field === 'payType') {
        row.payType = value === 'hourly' ? 'hourly' : 'flat';
        redraw = true;
      } else if (field === 'rate') {
        const c = costsParseC(value);
        if (c === null) { showToast('Enter an amount like 150 or 150.50.', 'error'); costsCrewRerender(eventId); return; }
        row.rateC = c;
      } else if (field === 'hours') {
        const t = String(value == null ? '' : value).trim();
        const h = t === '' ? 0 : Number(t);
        if (!isFinite(h) || h < 0 || h > 999) { showToast('Enter hours like 6 or 6.5.', 'error'); costsCrewRerender(eventId); return; }
        row.hours = h;
      } else if (field === 'role' || field === 'note' || field === 'method') {
        row[field] = String(value == null ? '' : value).trim();
      } else if (field === 'paidDate') {
        row.paidDate = String(value == null ? '' : value);
      } else return;
      costsUpsertCrewLine(data, row, ev);
      costsSave(eventId, data);
      if (redraw) { costsCrewRerender(eventId); return; }
      costsCrewRefresh(eventId, data, row);
      if (field === 'rate') { const el = document.getElementById('cstCwRate_' + costsQ(row.id)); if (el) el.value = costsInputC(row.rateC); }
    }
    function costsCrewToggle(eventId, rowId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId), row = costsCrewRow(data, rowId);
      if (!row) return;
      if (row.status === 'paid') { row.status = 'est'; row.paidDate = ''; row.method = ''; }
      else { row.status = 'paid'; if (!row.paidDate) row.paidDate = costsToday(); }
      costsUpsertCrewLine(data, row, ev);
      costsSave(eventId, data);
      costsCrewRerender(eventId);
    }
    function costsCrewMarkAllPaid(eventId) {
      if (!costsCanView()) return;
      const ev = costsFindEvent(eventId) || {};
      const data = costsGet(eventId);
      const today = costsToday();
      let n = 0;
      data.crew.forEach(r => {
        if (!r || r.status === 'paid' || costsCrewPayC(r) <= 0) return;
        r.status = 'paid'; if (!r.paidDate) r.paidDate = today;
        costsUpsertCrewLine(data, r, ev); n++;
      });
      if (!n) return;
      costsSave(eventId, data);
      costsCrewRerender(eventId);
      showToast('Marked ' + n + (n === 1 ? ' payment' : ' payments') + ' as paid.', 'success');
    }
    function costsCrewRemove(eventId, rowId) {
      if (!costsCanView()) return;
      const data = costsGet(eventId);
      const idx = data.crew.findIndex(r => r && String(r.id) === String(rowId));
      if (idx < 0) return;
      const removed = data.crew.splice(idx, 1)[0];
      const dropped = costsCrewDropLine(data, removed);
      costsSave(eventId, data);
      costsCrewRerender(eventId);
      showUndoToast('Removed from crew pay and costs.', function() {
        const d = costsGet(eventId);
        if (d.crew.some(r => r && r.id === removed.id)) return;
        d.crew.splice(Math.min(idx, d.crew.length), 0, removed);
        if (dropped && !d.lines.some(l => l && l.id === dropped.line.id)) d.lines.splice(Math.min(dropped.idx, d.lines.length), 0, dropped.line);
        costsSave(eventId, d);
        costsCrewRerender(eventId);
      });
    }

    // ── modals ───────────────────────────────────────────────────────────────
    function costsCloseModal(id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (window.CRMUI && CRMUI.close) { try { CRMUI.close(el, { force: true }); } catch (e) {} }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    function costsOpenModal(id, title, inner, width) {
      costsCloseModal(id);
      const m = document.createElement('div');
      m.id = id;
      m.className = 'modal-backdrop';
      m.innerHTML = '<div class="modal" style="--mw:' + (width || 480) + 'px" role="document">'
        + '<button type="button" class="modal-close btn btn-ghost btn-icon" onclick="costsCloseModal(\'' + id + '\')" aria-label="Close">' + costsIcon('x', 20) + '</button>'
        + '<div class="modal-title">' + esc(title) + '</div>' + inner + '</div>';
      document.body.appendChild(m);
      if (window.CRMUI && CRMUI.open) CRMUI.open(m, { dirty: function() { return false; }, onClose: function() { if (m.parentNode) m.parentNode.removeChild(m); } });
      else m.classList.add('active');
      return m;
    }
    function costsOpenGearModal(eventId) {
      if (!costsCanView()) return;
      if (typeof invStore !== 'function') { showToast('Inventory is not available right now.', 'error'); return; }
      const cats = (typeof INV_CATEGORIES !== 'undefined' && Array.isArray(INV_CATEGORIES)) ? INV_CATEGORIES : ['Other'];
      const eid = costsQ(eventId);
      const inner = '<form class="cst-gear" onsubmit="costsSubmitGear(\'' + eid + '\');return false;">'
        + (typeof lfBlockHtml === 'function' ? lfBlockHtml('cstG') : '')
        + '<div class="field"><label class="field-label" for="cstGName">What did you buy</label><input class="input" id="cstGName" type="text" required autocomplete="off" placeholder="Example: Wireless mic"></div>'
        + '<div class="cst-two"><div class="field"><label class="field-label" for="cstGCat">Category</label><select class="input" id="cstGCat">' + cats.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('') + '</select></div>'
        +   '<div class="field"><label class="field-label" for="cstGQty">How many</label><input class="input" id="cstGQty" type="number" min="1" step="1" value="1" inputmode="numeric" oninput="costsGearPreview()"></div></div>'
        + '<div class="cst-two"><div class="field"><label class="field-label" for="cstGPrice">Price each</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input class="input" id="cstGPrice" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" oninput="costsGearPreview()"></div></div>'
        +   '<div class="field"><label class="field-label" for="cstGDate">Date bought</label><input class="input" id="cstGDate" type="date" value="' + esc(costsToday()) + '"></div></div>'
        + '<div class="cst-two"><div class="field"><label class="field-label" for="cstGVendor">Where from</label><input class="input" id="cstGVendor" type="text" autocomplete="off" placeholder="Store or website"></div>'
        +   '<div class="field"><label class="field-label" for="cstGOrder">Order number</label><input class="input" id="cstGOrder" type="text" autocomplete="off" placeholder="Optional"></div></div>'
        + '<div class="field"><label class="field-label" for="cstGSerial">Serial number</label><input class="input" id="cstGSerial" type="text" autocomplete="off" placeholder="Optional, for a single item"></div>'
        + '<div class="field"><label class="field-label" for="cstGPct">Charge this event (%)</label><input class="input" id="cstGPct" type="number" min="1" max="100" step="1" value="100" inputmode="numeric" oninput="costsGearPreview()">'
        +   '<span class="field-hint">Will you use it again? Charge this event only part of the price. The rest stays in your gear value.</span>'
        +   '<span class="field-hint cst-gear-prev" id="cstGPrev" aria-live="polite"></span></div>'
        + '<div class="cst-modal-foot"><button type="button" class="btn btn-ghost" onclick="costsCloseModal(\'costsGearModal\')">Cancel</button><button type="submit" class="btn btn-primary">Add to Inventory and costs</button></div>'
        + '</form>';
      costsOpenModal('costsGearModal', 'Bought gear for this event', inner, 520);
    }
    function costsGearPreview() {
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const out = document.getElementById('cstGPrev');
      if (!out) return;
      const price = costsParseC(v('cstGPrice')), qty = Math.max(1, Math.round(costsNum(v('cstGQty'), 1)) || 1);
      let pct = Math.round(costsNum(v('cstGPct'), 100)); if (!(pct >= 1)) pct = 100; if (pct > 100) pct = 100;
      if (price === null || price === 0) { out.textContent = ''; return; }
      const total = price * qty, charged = costsLineAmountC({ amountC: total, chargePct: pct });
      out.textContent = 'This event is charged ' + costsFmtC(charged) + ' of ' + costsFmtC(total) + '.';
    }
    function costsSubmitGear(eventId) {
      if (!costsCanView()) return;
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const name = v('cstGName').trim();
      if (!name) { showToast('Give the gear a name first.', 'info'); return; }
      const price = costsParseC(v('cstGPrice'));
      if (price === null) { showToast('Enter the price like 25 or 25.50.', 'error'); return; }
      const res = costsRecordGearPurchase({ eventId: eventId, name: name, category: v('cstGCat'), qty: costsNum(v('cstGQty'), 1), unitPriceC: price, vendor: v('cstGVendor').trim(),
        date: v('cstGDate') || costsToday(), serial: v('cstGSerial').trim(), orderNo: v('cstGOrder').trim(), chargePct: costsNum(v('cstGPct'), 100) });
      if (!res.ok) { showToast(res.reason === 'inventory' ? 'Inventory is not available right now.' : 'Could not add that. Check the details and try again.', 'error'); return; }
      costsCloseModal('costsGearModal');
      costsRerender(eventId);
      if (typeof invRefreshView === 'function') { try { invRefreshView(); } catch (e) {} }
      showToast('Added to Inventory as ' + res.tag + " and to this event's costs.", 'success');
    }
    function costsOpenCopyModal(eventId) {
      if (!costsCanView()) return;
      const map = costsMap();
      const evs = (getDB('events') || []).filter(e => e && String(e.id) !== String(eventId) && map[String(e.id)] && ((Array.isArray(map[String(e.id)].lines) && map[String(e.id)].lines.some(l => l && l.kind !== 'gear')) || (Array.isArray(map[String(e.id)].crew) && map[String(e.id)].crew.length)));
      evs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const eid = costsQ(eventId);
      const inner = evs.length
        ? '<form onsubmit="costsCopyFromSelected(\'' + eid + '\');return false;"><div class="field"><label class="field-label" for="cstCopySrc">Copy from</label><select class="input" id="cstCopySrc">'
          + evs.map(e => '<option value="' + esc(costsQ(e.id)) + '">' + esc((e.name || 'Event') + (e.date ? ' (' + e.date + ')' : '')) + '</option>').join('') + '</select>'
          + '<span class="field-hint">Copies the costs as estimates with the same amounts. Dates are cleared and gear purchases are left out.</span></div>'
          + '<div class="cst-modal-foot"><button type="button" class="btn btn-ghost" onclick="costsCloseModal(\'costsCopyModal\')">Cancel</button><button type="submit" class="btn btn-primary">Copy costs</button></div></form>'
        : '<p class="dlg-text">No other event has costs yet.</p><div class="cst-modal-foot"><button type="button" class="btn btn-secondary" onclick="costsCloseModal(\'costsCopyModal\')">Close</button></div>';
      costsOpenModal('costsCopyModal', 'Copy costs from another event', inner, 460);
    }
    function costsCopyFromSelected(eventId) {
      if (!costsCanView()) return;
      const sel = document.getElementById('cstCopySrc');
      if (!sel || !sel.value) return;
      const srcEv = costsFindEvent(sel.value);
      const src = srcEv ? costsGet(srcEv.id) : null;
      const lines = costsCopyLines(src);
      const data = costsGet(eventId);
      const crew = costsCopyCrew(src, data.crew);
      if (!lines.length && !crew.length) { showToast('Nothing to copy from that event.', 'info'); costsCloseModal('costsCopyModal'); return; }
      lines.forEach(l => data.lines.push(l));
      const ev = costsFindEvent(eventId) || {};
      crew.forEach(r => { data.crew.push(r); costsUpsertCrewLine(data, r, ev); });
      costsSave(eventId, data);
      costsCloseModal('costsCopyModal');
      costsRerender(eventId);
      const n = lines.length + crew.length;
      showToast('Copied ' + n + (n === 1 ? ' cost' : ' costs') + ' as estimates.', 'success');
    }
