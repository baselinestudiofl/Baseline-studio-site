// ============================================================================
// portal-provider/62-link-fill.js  -  "Paste a link" on the cost and purchase forms. Fetch details sends the link to the fetch-product edge
// function, which reads the product page on the server and answers { name, price, retailer, category_hint, image_url }. This file fills the
// form with what came back. It never saves: the person reviews, edits and presses the form's own button. Classic script, loads after
// 55-costs.js and 61-inv-buy.js (their forms call lfBlockHtml when they open).
//
// Forms: 'cstAdd' (Costs tab, Add a cost), 'cstG' (Bought gear for this event), 'ibp' (Inventory, Log a purchase).
// Category: matched only against the options that form already has (its own select), by simple keywords on the product name first, then the
// page's own category text. No match leaves the category as it is.
// No image field exists on any of these forms, so image_url is not used.
// ============================================================================

    const LF_FORMS = {
      cstAdd: { name: 'cstAddLabel', price: 'cstAddAmt', vendor: 'cstAddVendor', date: 'cstAddDate', cat: 'cstAddCat', after: '' },
      cstG:   { name: 'cstGName', price: 'cstGPrice', vendor: 'cstGVendor', date: 'cstGDate', cat: 'cstGCat', after: 'costsGearPreview' },
      ibp:    { name: 'ibpName', price: 'ibpPrice', vendor: 'ibpVendor', date: 'ibpDate', cat: 'ibpCat', after: 'invbPurchasePreview' }
    };
    const LF_LABELS = { name: 'name', price: 'price', vendor: 'where from', cat: 'category' };

    // Each rule: [test on lower-case text, categories to try in order]. The first rule that matches AND has a category this form offers wins.
    // Cables come before generators so "generator extension cord" lands on cables.
    const LF_RULES = [
      [/\b(subwoofers?|subs?)\b/, ['Subwoofers', 'Speakers', 'Audio', 'Gear bought']],
      [/\b(co2|cold spark|confetti|fogger|haze|smoke machine|pyro|streamer)/, ['Special Effects', 'Gear bought']],
      [/\b(speakers?|loudspeakers?|monitor wedge|line array|pa system)\b/, ['Speakers', 'Audio', 'Gear bought']],
      [/\b(microphones?|mics?|headsets?|lavalier|lapel)\b/, ['Microphones', 'Audio', 'Gear bought']],
      [/\b(dj controller|turntable|cdj|mixer|headphones?)\b/, ['DJ Gear', 'Audio', 'Gear bought']],
      [/\b(amplifier|amp|audio interface|in-ear|wireless system|receiver|transmitter)\b/, ['Audio', 'Gear bought']],
      [/\b(extension cords?|power strips?|power cords?|cords?|cables?|adapters?|adaptors?|surge|outlets?|connectors?|plugs?)\b/, ['Cables & Power', 'Supplies']],
      [/\b(generators?|inverter)\b/, ['Generators', 'Gear bought']],
      [/\b(tripods?|stands?|boom)\b/, ['Tripods & Stands', 'Staging', 'Gear bought']],
      [/\b(truss|stage|riser|backdrop|drape)\b/, ['Staging', 'Tripods & Stands', 'Gear bought']],
      [/\b(lights?|lighting|led|laser|strobe|dmx|par can|moving head|uplights?|gobo)\b/, ['Lighting', 'Gear bought']],
      [/\b(projector|screen|video wall|led wall|hdmi)\b/, ['Visual', 'Gear bought']],
      [/\b(snacks?|water|ice|beverages?|drinks?|coffee|lunch|dinner)\b/, ['Food']],
      [/\b(parking|toll)\b/, ['Parking & tolls']],
      [/\b(road case|flight case|case|cart|dolly|hand truck|trailer|bag)\b/, ['Cases & Transport', 'Supplies']],
      [/\b(tape|gaff|batteries|battery|zip ties?|velcro|markers?|gloves?|bulbs?|fuses?|gels?|clamps?)\b/, ['Supplies', 'Gear bought']]
    ];

    // ── pure helpers ────────────────────────────────────────────────────────
    // options: the category names this form offers. Returns one of them, or ''.
    function lfPickCategory(name, hint, options) {
      const opts = Array.isArray(options) ? options.map(String) : [];
      const find = (want) => { for (let i = 0; i < opts.length; i++) { if (opts[i].toLowerCase() === want.toLowerCase()) return opts[i]; } return ''; };
      const sources = [String(name || '').toLowerCase(), String(hint || '').toLowerCase()];
      for (let s = 0; s < sources.length; s++) {
        if (!sources[s]) continue;
        for (let r = 0; r < LF_RULES.length; r++) {
          if (!LF_RULES[r][0].test(sources[s])) continue;
          for (let c = 0; c < LF_RULES[r][1].length; c++) { const hit = find(LF_RULES[r][1][c]); if (hit) return hit; }
        }
      }
      return '';
    }
    function lfPriceText(n) { return (typeof n === 'number' && isFinite(n) && n > 0) ? n.toFixed(2) : ''; }
    function lfTodayIso() {
      if (typeof costsToday === 'function') return costsToday();
      if (typeof invbToday === 'function') return invbToday();
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function lfNoteText(filled, missing, kept) {
      const names = (list) => list.map(k => LF_LABELS[k] || k).join(', ');
      const parts = [];
      if (filled.length) parts.push('Filled in: ' + names(filled) + '.');
      if (kept && kept.length) parts.push('Left as you typed it: ' + names(kept) + '.');
      if (missing.length) parts.push("Couldn't fill: " + names(missing) + '.');
      parts.push('Check everything, then save.');
      return parts.join(' ');
    }
    // What the form should receive from one answer. fields = the edge function's fields; options = this form's category names.
    function lfPlan(fields, options) {
      const f = fields || {};
      const out = { values: {}, filled: [], missing: [] };
      const name = typeof f.name === 'string' ? f.name.trim() : '';
      if (name) { out.values.name = name; out.filled.push('name'); } else out.missing.push('name');
      const price = lfPriceText(f.price);
      if (price) { out.values.price = price; out.filled.push('price'); } else out.missing.push('price');
      const vendor = typeof f.retailer === 'string' ? f.retailer.trim() : '';
      if (vendor) { out.values.vendor = vendor; out.filled.push('vendor'); } else out.missing.push('vendor');
      const cat = lfPickCategory(name, f.category_hint, options);
      if (cat) { out.values.cat = cat; out.filled.push('cat'); } else out.missing.push('cat');
      return out;
    }

    // ── the field on each form ───────────────────────────────────────────────
    function lfBlockHtml(form) {
      if (!LF_FORMS[form]) return '';
      return '<div class="field lf-field"><label class="field-label" for="' + form + 'LfUrl">Paste a product link</label>'
        + '<div class="lf-row"><input class="input" id="' + form + 'LfUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" onkeydown="lfKey(event,\'' + form + '\')">'
        + '<button type="button" class="btn btn-secondary lf-btn" id="' + form + 'LfBtn" onclick="lfFetch(\'' + form + '\')">Fetch details</button></div>'
        + '<span class="field-hint lf-note" id="' + form + 'LfNote" role="status" aria-live="polite">Fills the form from the page. Nothing is saved until you save.</span></div>';
    }
    // Enter in the link box fetches. It must never submit the form around it.
    function lfKey(ev, form) {
      if (!ev || ev.key !== 'Enter') return;
      ev.preventDefault();
      lfFetch(form);
    }
    function lfSetNote(form, text, tone) {
      const n = document.getElementById(form + 'LfNote');
      if (!n) return;
      n.textContent = text;
      n.classList.toggle('lf-note-bad', tone === 'bad');
    }
    function lfOptions(form) {
      const sel = document.getElementById(LF_FORMS[form].cat);
      if (!sel || !sel.options) return [];
      return Array.prototype.map.call(sel.options, o => o.value).filter(v => v && v !== '__new');
    }
    // Writes a value into a field. A field the person typed in is left alone unless this tool filled it earlier or it is empty.
    function lfPut(id, value, force) {
      const el = document.getElementById(id);
      if (!el) return false;
      if (!force && el.value && el.getAttribute('data-lf') !== '1') return false;
      el.value = value;
      el.setAttribute('data-lf', '1');
      return true;
    }
    function lfApply(form, fields) {
      const cfg = LF_FORMS[form];
      const plan = lfPlan(fields, lfOptions(form));
      const filled = [], kept = [];
      ['name', 'price', 'vendor', 'cat'].forEach(k => {
        if (plan.values[k] === undefined) return;
        // A select always shows some option, so its value is never "typed"; a matched category replaces it.
        if (lfPut(cfg[k], plan.values[k], k === 'cat')) filled.push(k); else kept.push(k);
      });
      lfPut(cfg.date, lfTodayIso(), false);
      if (cfg.after && typeof window[cfg.after] === 'function') { try { window[cfg.after](); } catch (e) {} }
      return { filled: filled, kept: kept, missing: plan.missing };
    }
    async function lfCall(url, retried) {
      const token = window._sbToken;
      if (!token) return { ok: false, error: 'Sign in again, then try the link.' };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(SUPABASE_URL + '/functions/v1/fetch-product', {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ url: url })
        });
        if (r.status === 401 && !retried && typeof _refreshToken === 'function' && await _refreshToken()) return lfCall(url, true);
        if (r.status === 404) return { ok: false, error: "The link reader isn't set up yet. Fill it in by hand." };
        let data = null;
        try { data = await r.json(); } catch (e) { data = null; }
        if (!data) return { ok: false, error: "Couldn't read that link. Fill it in by hand." };
        return data;
      } catch (e) {
        return { ok: false, error: ctl.signal.aborted ? 'That site took too long. Fill it in by hand.' : "Couldn't reach the link reader. Fill it in by hand." };
      } finally { clearTimeout(timer); }
    }
    let _lfBusy = {};
    async function lfFetch(form) {
      if (!LF_FORMS[form] || _lfBusy[form]) return;
      const input = document.getElementById(form + 'LfUrl'), btn = document.getElementById(form + 'LfBtn');
      const url = input ? input.value.trim() : '';
      if (!url) { lfSetNote(form, 'Paste a product link first.', 'bad'); if (input && input.focus) input.focus(); return; }
      _lfBusy[form] = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
      lfSetNote(form, 'Reading the page...');
      const res = await lfCall(url, false);
      _lfBusy[form] = false;
      const btn2 = document.getElementById(form + 'LfBtn');
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Fetch details'; }
      if (!document.getElementById(form + 'LfNote')) return;           // the form was closed while waiting
      if (!res || res.ok !== true) { lfSetNote(form, (res && res.error) || "Couldn't read that link. Fill it in by hand.", 'bad'); return; }
      const out = lfApply(form, res.fields);
      let text = lfNoteText(out.filled, out.missing, out.kept);
      if (res.note) text = res.note + ' ' + text;
      lfSetNote(form, text);
    }
