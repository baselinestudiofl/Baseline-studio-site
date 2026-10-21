// ============================================================================
// portal-provider/35-documents.js  -  documents and contracts: event documents tab, e-signature, paper view, contract creation, addenda, send for signature, tracking
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Document: share with client + require signature ───────────────────────
    function toggleEventDocShare(eventId, docId, shared) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev || !ev.docs) return;
      const doc = ev.docs.find(d => d.id === docId);
      if (!doc) return;
      doc.sharedWithClient = shared;
      // Sync ev.documents (what the client reads) with all shared docs
      const _prevDocs = ev.documents || [];
      const _sigKeys = ['clientSignature','clientSignedAt','clientSignedName','clientSignedIp','clientSignedUa','clientSignedHash','consentVersion'];
      ev.documents = ev.docs
        .filter(d => d.sharedWithClient)
        .map(d => {
          const prev = _prevDocs.find(x => x.id === d.id) || {};
          const out = {
            id: d.id, name: d.name, label: d.name,
            contentHtml: d.contentHTML || d.content || '',
            requiresSignature: !!d.requiresSignature,
            sharedAt: prev.sharedAt || Date.now()
          };
          // Keep the client's signature (written server-side by client_sign_document) on re-share.
          _sigKeys.forEach(k => { const v = d[k] != null ? d[k] : prev[k]; if (v != null) out[k] = v; });
          return out;
        });
      setDB('events', events);
      window.currentEvent = ev;
      document.getElementById('tabDocuments').innerHTML = renderEventDocuments(ev);
      showToast(shared ? 'Shared — client can now see this document' : 'Removed from client view', shared ? 'success' : 'info');
    }

    function toggleDocRequiresSignature(eventId, docId, requires) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev || !ev.docs) return;
      const doc = ev.docs.find(d => d.id === docId);
      if (!doc) return;
      doc.requiresSignature = requires;
      // Keep ev.documents in sync
      if (ev.documents) {
        const clientDoc = ev.documents.find(d => d.id === docId);
        if (clientDoc) clientDoc.requiresSignature = requires;
      }
      setDB('events', events);
      window.currentEvent = ev;
      document.getElementById('tabDocuments').innerHTML = renderEventDocuments(ev);
      showToast(requires ? 'Client signature required on this document' : 'Signature no longer required', 'info');
    }

    // ── Client e-signature (P0.1): fields written by the client_sign_document RPC ──
    // clientSignature (PNG, data URL or raw base64), clientSignedAt, clientSignedName
    function _sigSrc(sig) {
      const s = String(sig || '').trim();
      if (!s) return '';
      if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s)) return s;
      if (/^[A-Za-z0-9+\/=]{20,}$/.test(s)) return 'data:image/png;base64,' + s;
      return '';
    }
    function _docClientSigned(doc) { return !!(doc && (doc.clientSignature || doc.clientSignedAt)); }
    function _sigWhen(ts) {
      const v = typeof ts === 'string' && /^\d{9,}$/.test(ts.trim()) ? Number(ts) : ts;
      const d = new Date(v);
      return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).replace(/\u202f/g, ' ');
    }
    function _clientSigBlock(doc) {
      if (!_docClientSigned(doc)) return '';
      const src = _sigSrc(doc.clientSignature);
      const when = doc.clientSignedAt ? _sigWhen(doc.clientSignedAt) : '';
      return `<div style="display:flex;align-items:center;gap:16px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05);">
              ${src ? `<div style="background:#fff;border-radius:4px;padding:6px 10px;flex-shrink:0;"><img src="${esc(src)}" alt="Client signature" onload="_sigDetectInk(this)" style="display:block;max-height:56px;max-width:200px;filter:invert(1);"></div>` : ''}
              <div style="font-size:12px;min-width:0;">
                <div style="font-weight:600;color:var(--text-1);font-size:13px;">${esc(doc.clientSignedName || 'Client')}</div>
                ${when ? `<div style="color:var(--text-2);margin-top:2px;">Signed ${esc(when)}</div>` : ''}
                <div style="color:var(--text-3);margin-top:2px;">Signed electronically</div>
              </div>
            </div>`;
    }

    function renderEventDocuments(event) {
      const templates = getDB('templates');
      if (!event.docs) event.docs = [];
      const eid = event.id;
      const allInvoices = (getDB('invoices') || []).filter(i => i.eventId === eid);
      const allQuotes   = event.quotes || [];

      // ── INVOICES ──────────────────────────────────────────────────
      let invoiceHtml = '';
      if (allInvoices.length) {
        invoiceHtml = `<div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:10px;">💳 Invoices</div>`;
        allInvoices.forEach(inv => {
          const isPaid = inv.status === 'paid';
          const statusColor = isPaid ? 'var(--success)' : 'var(--warning)';
          const statusLabel = (inv.status || 'pending').toUpperCase();
          invoiceHtml += `<div style="padding:12px 16px;background:var(--black-4);border:1px solid var(--border);border-radius:6px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;">${inv.invoiceNum || 'Invoice'}</div>
              <div style="font-size:12px;color:var(--gray);margin-top:3px;">${inv.clientName || ''} &middot; $${(inv.total||0).toFixed(2)} &middot; <span style="color:${statusColor};font-weight:700;">${statusLabel}</span></div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="exportInvoicePDF('${inv.id}')">⬇ PDF</button>
              <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="sendInvoice('${inv.id}')">✉ Send</button>
            </div>
          </div>`;
        });
        invoiceHtml += `</div>`;
      }

      // ── QUOTES ────────────────────────────────────────────────────
      let quotesHtml = '';
      if (allQuotes.length) {
        quotesHtml = `<div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:10px;">📋 Saved Quotes</div>`;
        allQuotes.forEach(q => {
          const sentBadge = q.sentAt
            ? `<span style="color:var(--cyan);font-weight:700;font-size:12px;">SENT ${new Date(q.sentAt).toLocaleDateString()}</span>`
            : `<span style="color:var(--gray);font-size:12px;">Draft</span>`;
          quotesHtml += `<div style="padding:12px 16px;background:var(--black-4);border:1px solid var(--border);border-radius:6px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;">Quote — ${q.clientName || event.clientName || 'Client'}</div>
              <div style="font-size:12px;color:var(--gray);margin-top:3px;">$${(q.total||0).toLocaleString()} &middot; ${new Date(q.createdAt).toLocaleDateString()} &middot; ${sentBadge}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="exportSavedQuotePDF('${q.id}','${eid}')">⬇ PDF</button>
            </div>
          </div>`;
        });
        quotesHtml += `</div>`;
      }

      // ── CONTRACTS ─────────────────────────────────────────────────
      let docListHtml = '';
      if (event.docs.length) {
        docListHtml = `<div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:10px;">📄 Contracts & Agreements</div>`;
        event.docs.forEach(doc => {
          const clientSigned = _docClientSigned(doc);
          const isSigned = !!(doc.signedAt || clientSigned);
          const signedOn = doc.signedAt || doc.clientSignedAt;
          const signedBadge = isSigned
            ? `<span style="background:var(--success);color:#07070d;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:.04em;">SIGNED ${new Date(signedOn).toLocaleDateString()}</span>`
            : `<span style="background:var(--warning);color:#000;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:.04em;">UNSIGNED</span>`;
          const clientShared = doc.sharedWithClient;
          const requiresSig  = doc.requiresSignature;
          docListHtml += `
          <div style="padding:14px 16px;background:var(--black-4);border:1px solid ${clientShared ? 'rgba(31,163,224,0.3)' : 'var(--border)'};border-radius:6px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;">
                  <span style="font-weight:600;font-size:13px;">${esc(doc.name)}</span>
                  ${clientShared ? `<span style="background:rgba(31,163,224,0.2);color:var(--cyan);padding:1px 7px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:.04em;">VISIBLE TO CLIENT</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">${signedBadge}<span style="font-size:12px;color:var(--gray);">Created ${new Date(doc.createdAt).toLocaleDateString()}</span></div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;">
                ${doc.contentHTML ? `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="viewEventDoc('${eid}','${doc.id}')">View</button>` : ''}
                ${doc.contentHTML && isSigned ? `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="downloadEventDoc('${eid}','${doc.id}')">Download</button>` : ''}
                ${!isSigned ? `<button class="btn btn-primary" style="padding:6px 10px;font-size:12px;" onclick="openSignatureModal('${eid}','${doc.id}')">✎ Sign</button>` : `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="viewEventDocSignature('${eid}','${doc.id}')">View Sig</button>`}
                <button class="btn btn-danger" style="padding:6px 10px;font-size:12px;" onclick="deleteEventDoc('${eid}','${doc.id}')">✕</button>
              </div>
            </div>
            ${_clientSigBlock(doc)}
            <div style="display:flex;gap:20px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05);">
              <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.6);">
                <input type="checkbox" ${clientShared ? 'checked' : ''} onchange="toggleEventDocShare('${eid}','${doc.id}',this.checked)" style="width:14px;height:14px;accent-color:var(--cyan);">
                Share with client
              </label>
              <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.6);">
                <input type="checkbox" ${requiresSig ? 'checked' : ''} onchange="toggleDocRequiresSignature('${eid}','${doc.id}',this.checked)" style="width:14px;height:14px;accent-color:var(--cyan);">
                Require client signature
              </label>
            </div>
          </div>`;
        });
        docListHtml += `</div>`;
      }

      const isEmpty = !allInvoices.length && !allQuotes.length && !event.docs.length;
      const _pick = (typeof BSContracts !== 'undefined') ? BSContracts.pickTemplate(event, templates) : { template: null, kind: 'generic', typeUnknown: false };
      const templateOptions = templates.map(t => `<option value="${esc(t.id)}"${_pick.template && _pick.template.id === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
      const _pickHint = !_pick.template ? ''
        : _pick.typeUnknown ? 'This event has no recognized type, so the generic agreement is selected. Set the event type to get the matching one.'
        : 'Selected for this event: ' + esc(_pick.template.name) + '. Pick another from the list if you need a different one.';

      return `
        ${isEmpty ? '<div style="padding:20px;text-align:center;color:var(--gray);font-size:13px;border:1px dashed var(--border);border-radius:6px;margin-bottom:16px;">No documents yet — invoices, quotes, and contracts will appear here automatically</div>' : ''}
        ${invoiceHtml}${quotesHtml}${docListHtml}
        <div style="background:var(--black-4);border:1px solid var(--border);border-radius:6px;padding:16px;margin-top:${isEmpty ? '0' : '8px'};">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:12px;">Add Contract / Agreement</div>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <select class="form-select" id="evtDocTemplate_${eid}" style="flex:1;margin:0;font-size:12px;"><option value="">From template…</option>${templateOptions}</select>
            <button class="btn btn-primary" style="white-space:nowrap;" onclick="createEventDocFromTemplate('${eid}')">+ From Template</button>
          </div>
          ${_pickHint ? `<div style="font-size:12px;color:var(--text-2);margin:-2px 0 10px;">${_pickHint}</div>` : ''}
          <div style="display:flex;gap:8px;">
            <input type="text" class="form-input" id="evtDocBlankName_${eid}" placeholder="Blank document name…" style="flex:1;margin:0;font-size:12px;">
            <button class="btn btn-secondary" style="white-space:nowrap;" onclick="createBlankEventDoc('${eid}')">+ Blank</button>
          </div>
        </div>`;
    }

    // Data the contract engine reads (prices from invoices, terms from settings).
    function _contractEnv() { return { invoices: getDB('invoices') || [], settings: getDB('settings') || {} }; }

    // Add the standard contract templates once, rename untouched legacy agreements, report edited ones.
    function _contractsBoot() {
      try {
        if (typeof BSContracts === 'undefined') return;
        const u = BSPortal.getCurrentUser();
        if (!u || (u.role !== 'master' && u.role !== 'admin')) return;
        const r = BSContracts.ensureTemplates(getDB('templates'), getDB('settings') || {});
        if (!r.changed) return;
        setDB('templates', r.templates);
        const st = Object.assign({}, r.settings);
        st.contractMigration = { at: Date.now(), added: r.added, renamed: r.renamed, keptEdited: r.keptEdited };
        setDB('settings', st);
        if (r.keptEdited.length) {
          console.info('[contracts] Edited older agreements left as they are (they still carry their own terms):', r.keptEdited);
          showToast(r.keptEdited.length + ' older agreement' + (r.keptEdited.length > 1 ? 's were' : ' was') + ' edited, so ' + (r.keptEdited.length > 1 ? 'they were' : 'it was') + ' left unchanged. Check the terms in Documents.', 'warning');
        }
      } catch (e) { console.warn('[contracts]', e); }
    }

    function createEventDocFromTemplate(eventId) {
      const sel = document.getElementById('evtDocTemplate_' + eventId);
      const templateId = sel ? sel.value : '';
      if (!templateId) { showToast('Select a template first', 'warning'); return; }
      const templates = getDB('templates');
      const tmpl = templates.find(t => t.id === templateId);
      if (!tmpl) return;
      if (typeof BSContracts === 'undefined') { showToast('The contract engine did not load. Refresh the page and try again.', 'error'); return; }
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      if (!ev.docs) ev.docs = [];

      // ── Variable substitution: one merge engine (contract-templates.js) ──
      let docHTML = BSContracts.mergeForEvent(tmpl.contentHTML || tmpl.content || '', ev, _contractEnv());

      // ── Auto-inject addenda for agreements/contracts/proposals ─────
      if (/agreement|contract|proposal/i.test(tmpl.name || '')) {
        docHTML = _injectAddenda(docHTML, ev);
      }

      ev.docs.push({
        id: genId(), name: tmpl.name, contentHTML: docHTML, templateId: tmpl.id,
        createdAt: Date.now(), signedAt: null, signature: null,
        fromTemplate: true, requiresSignature: false, sharedWithClient: false
      });
      setDB('events', events);
      window.currentEvent = ev;
      document.getElementById('tabDocuments').innerHTML = renderEventDocuments(ev);
      if (/^tpl-contract-/.test(tmpl.id || '') && !BSContracts.resolveKind(ev)) {
        showToast('Document created. This event has no recognized type, so check that this is the right agreement.', 'warning');
      } else {
        showToast('Document created from template', 'success');
      }
    }

    function createBlankEventDoc(eventId) {
      const nameEl = document.getElementById('evtDocBlankName_' + eventId);
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) { showToast('Enter a document name', 'warning'); return; }
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      if (!ev.docs) ev.docs = [];
      ev.docs.push({ id: genId(), name, contentHTML: '<p>Document content…</p>', createdAt: Date.now(), signedAt: null, signature: null });
      setDB('events', events);
      window.currentEvent = ev;
      document.getElementById('tabDocuments').innerHTML = renderEventDocuments(ev);
      showToast('Document created', 'success');
    }

    // ── Document paper view (docview) ─────────────────────────────────────────
    // One white-paper renderer behind View, View Sig and Download. Stored document HTML was authored in the
    // dark CRM (inline light text colors, theme CSS variables), so it is sanitized and rendered on paper with
    // forced dark text. The old popup linked fable.css, whose black body background sat under default black text.
    const _CSS_NAMED = { white:'#ffffff', black:'#000000', snow:'#fffafa', ghostwhite:'#f8f8ff', whitesmoke:'#f5f5f5', ivory:'#fffff0', floralwhite:'#fffaf0',
      aliceblue:'#f0f8ff', azure:'#f0ffff', mintcream:'#f5fffa', honeydew:'#f0fff0', seashell:'#fff5ee', linen:'#faf0e6', beige:'#f5f5dc', oldlace:'#fdf5e6',
      lavender:'#e6e6fa', lightgray:'#d3d3d3', lightgrey:'#d3d3d3', gainsboro:'#dcdcdc', silver:'#c0c0c0', lightyellow:'#ffffe0', lightcyan:'#e0ffff',
      darkgray:'#a9a9a9', darkgrey:'#a9a9a9', gray:'#808080', grey:'#808080', dimgray:'#696969', dimgrey:'#696969', navy:'#000080', midnightblue:'#191970',
      darkslategray:'#2f4f4f', darkblue:'#00008b', darkgreen:'#006400', darkred:'#8b0000', maroon:'#800000' };

    // Parse a CSS color. Returns { l: relative luminance after blending onto white, a: alpha } or null.
    function _cssColor(v) {
      let s = String(v || '').trim().toLowerCase();
      if (s === 'transparent') return { l: 1, a: 0 };
      if (_CSS_NAMED[s]) s = _CSS_NAMED[s];
      let r, g, b, a = 1, m;
      if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
        if (h.length !== 6 && h.length !== 8) return null;
        r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
        if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
      } else if ((m = s.match(/^rgba?\(\s*([^)]+)\)$/))) {
        const p = m[1].split(/[\s,\/]+/).filter(Boolean);
        if (p.length < 3) return null;
        const ch = x => (/%$/.test(x) ? parseFloat(x) * 2.55 : parseFloat(x));
        r = ch(p[0]); g = ch(p[1]); b = ch(p[2]);
        if (p[3] != null) a = /%$/.test(p[3]) ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      } else if ((m = s.match(/^hsla?\(\s*([^)]+)\)$/))) {
        const p = m[1].split(/[\s,\/]+/).filter(Boolean);
        if (p.length < 3) return null;
        const h = ((parseFloat(p[0]) % 360) + 360) % 360 / 360, sat = parseFloat(p[1]) / 100, lig = parseFloat(p[2]) / 100;
        const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat, pp = 2 * lig - q;
        const f = t => { t = (t + 1) % 1; return (t < 1/6 ? pp + (q - pp) * 6 * t : t < 1/2 ? q : t < 2/3 ? pp + (q - pp) * (2/3 - t) * 6 : pp) * 255; };
        r = f(h + 1/3); g = f(h); b = f(h - 1/3);
        if (p[3] != null) a = /%$/.test(p[3]) ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      } else return null;
      if ([r, g, b, a].some(x => isNaN(x))) return null;
      a = Math.max(0, Math.min(1, a));
      const lin = c => { c = Math.max(0, Math.min(255, c)) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const bl = c => a * c + (1 - a) * 255;
      return { l: 0.2126 * lin(bl(r)) + 0.7152 * lin(bl(g)) + 0.0722 * lin(bl(b)), a };
    }

    // Split inline CSS on ';' outside parentheses and quotes (data: URLs contain ';').
    function _splitDecls(css) {
      const out = []; let cur = '', depth = 0, q = '';
      for (const ch of String(css || '')) {
        if (q) { if (ch === q) q = ''; cur += ch; continue; }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === '(') depth++;
        if (ch === ')' && depth) depth--;
        if (ch === ';' && !depth) { out.push(cur); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) out.push(cur);
      return out;
    }

    // Drop declarations that would make text unreadable on white paper (light text, theme variables, dark fills).
    function _cleanStyleAttr(css) {
      const keep = [];
      _splitDecls(css).forEach(d => {
        const i = d.indexOf(':');
        if (i < 0) return;
        const prop = d.slice(0, i).trim().toLowerCase();
        let val = d.slice(i + 1).trim();
        if (!prop || !val) return;
        if (/expression\(|javascript:|behavior\s*:|-moz-binding/i.test(d)) return;
        if (/^(text-shadow|-webkit-text-fill-color|filter|backdrop-filter|mix-blend-mode)$/.test(prop)) return;
        if (prop === 'position' && /fixed|sticky/i.test(val)) return;
        if (prop === 'opacity' && parseFloat(val) < 0.7) return;
        if (/^(border|outline)/.test(prop)) val = val.replace(/var\([^)]*\)/gi, '#999');
        else if (/var\(/i.test(val)) return;
        if (prop === 'color') {
          const c = _cssColor(val);
          if (c && c.l > 0.183) return;
        }
        if (prop === 'background' || prop === 'background-color' || prop === 'background-image') {
          if (/gradient|url\(/i.test(val)) return;
          const toks = val.match(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)|[a-z]+/gi) || [];
          for (const t of toks) {
            const c = _cssColor(t);
            if (c) { if (c.a > 0.3 && c.l < 0.5) return; break; }
          }
        }
        keep.push(prop + ':' + val);
      });
      return keep.join(';');
    }

    // String-level sanitizer for stored document HTML (no DOM needed, so it is unit-testable).
    function _sanitizeDocHtml(html) {
      let s = String(html == null ? '' : html);
      s = s.replace(new RegExp('<!' + '--[\\s\\S]*?--' + '>', 'g'), '').replace(/<!doctype[^>]*>/gi, '');
      s = s.replace(/<(script|style|iframe|frameset|frame|object|embed|applet|noscript|template|title|head)\b[\s\S]*?<\/\1\s*>/gi, '');
      s = s.replace(/<\/?(script|style|iframe|frameset|frame|object|embed|applet|noscript|template|title|head|html|body|link|meta|base)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, '');
      const DROP = /^(on\w+|color|bgcolor|text|link|vlink|alink|background|srcdoc|formaction|contenteditable|autofocus|nonce)$/i;
      const decode = v => v.replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);?/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
        .replace(/&colon;/gi, ':').replace(/&(tab|newline);/gi, '').replace(/[\u0000- ]/g, '');
      return s.replace(/<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, (all, tag, rest) => {
        const selfClose = /\/\s*$/.test(rest);
        const attrs = [];
        const re = /([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
        let m;
        while ((m = re.exec(rest))) {
          const name = m[1], raw = m[2];
          if (DROP.test(name)) continue;
          const val = raw == null ? '' : raw.replace(/^["']|["']$/g, '');
          if (/^(href|src|xlink:href|action|poster|data)$/i.test(name)) {
            const dv = decode(val).toLowerCase();
            if (/^(javascript|vbscript|livescript):/.test(dv)) continue;
            if (/^data:/.test(dv) && !(name.toLowerCase() === 'src' && /^data:image\/(png|jpe?g|gif|webp);/.test(dv))) continue;
          }
          if (/^style$/i.test(name)) {
            const cleaned = _cleanStyleAttr(val.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
            if (cleaned) attrs.push('style="' + cleaned.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"');
            continue;
          }
          attrs.push(raw == null ? name : name + '=' + raw);
        }
        return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + (selfClose ? ' /' : '') + '>';
      });
    }

    // Short device label from a user agent string.
    function _uaShort(ua) {
      const s = String(ua || '').trim();
      if (!s) return '';
      let os = '', br = '', m;
      if (/iPhone/.test(s)) os = 'iPhone';
      else if (/iPad/.test(s)) os = 'iPad';
      else if (/Android/.test(s)) os = 'Android';
      else if (/Windows NT/.test(s)) os = 'Windows';
      else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
      else if (/CrOS/.test(s)) os = 'ChromeOS';
      else if (/Linux/.test(s)) os = 'Linux';
      if ((m = s.match(/Edg(?:A|e|iOS)?\/(\d+)/))) br = 'Edge ' + m[1];
      else if ((m = s.match(/OPR\/(\d+)/))) br = 'Opera ' + m[1];
      else if ((m = s.match(/(?:Firefox|FxiOS)\/(\d+)/))) br = 'Firefox ' + m[1];
      else if ((m = s.match(/(?:Chrome|CriOS)\/(\d+)/))) br = 'Chrome ' + m[1];
      else if ((m = s.match(/Version\/(\d+)[\d.]*.*Safari/))) br = 'Safari ' + m[1];
      else if (/Safari/.test(s)) br = 'Safari';
      if (br && os) return br + ' on ' + os;
      if (br || os) return br || os;
      return s.length > 60 ? s.slice(0, 57) + '...' : s;
    }

    // Decide ink from the pixels: light ink on a transparent PNG gets inverted to dark, dark ink is left alone,
    // opaque images (a JPEG with a white background) are left alone. Runs in the CRM page and, via toString, in the paper window.
    function _sigDetectInk(img) {
      function run() {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) return;
          const k = Math.min(1, 240 / w);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0, c.width, c.height);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let sum = 0, wt = 0, solid = 0;
          for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3];
            if (a < 32) continue;
            solid++;
            sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a;
            wt += a;
          }
          if (!wt || solid > (d.length / 4) * 0.95) return;
          img.style.filter = (sum / wt) > 140 ? 'invert(1)' : 'none';
        } catch (e) { /* keep the default */ }
      }
      if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run, { once: true });
    }

    // Collect every signature on a doc: the client's e-signature and the provider's manual signature.
    function _docSignatures(doc, ev) {
      const out = [];
      if (_docClientSigned(doc)) {
        out.push({ role: 'Client', ink: 'light', src: _sigSrc(doc.clientSignature),
          name: doc.clientSignedName || (ev && ev.clientName) || 'Client', at: doc.clientSignedAt,
          ip: doc.clientSignedIp, ua: doc.clientSignedUa, hash: doc.clientSignedHash, consent: doc.consentVersion });
      }
      if (doc.signature || doc.signedAt) {
        out.push({ role: 'Baseline Studio', ink: 'dark', src: _sigSrc(doc.signature),
          name: doc.signedBy || 'Authorized Signatory', at: doc.signedAt });
      }
      return out;
    }

    function _docSigBlockHtml(sigs) {
      if (!sigs.length) return '';
      const cards = sigs.map(s => {
        const when = s.at ? _sigWhen(s.at) : '';
        return `<div class="sig">
          <div class="sig-img">${s.src ? `<img class="sigimg" src="${esc(s.src)}" alt="${esc(s.role)} signature" style="filter:${s.ink === 'light' ? 'invert(1)' : 'none'};">` : `<span class="muted">Signature image not on file</span>`}</div>
          <div class="sig-name">${esc(s.name)}</div>
          <div class="muted">${esc(s.role)}${when ? ', signed ' + esc(when) : ''}</div>
        </div>`;
      }).join('');
      const rec = s => {
        const rows = [['Signer name', s.name], ['Signed at', s.at ? _sigWhen(s.at) : ''], ['IP address', s.ip],
          ['Device', _uaShort(s.ua)], ['Document fingerprint (SHA-256)', s.hash, 'mono'], ['Consent version', s.consent]]
          .filter(r => r[1] != null && String(r[1]).trim() !== '');
        const title = s.ua ? ` title="${esc(s.ua)}"` : '';
        return (sigs.length > 1 ? `<h4>${esc(s.role)}</h4>` : '') + '<dl>' + rows.map(r =>
          `<dt>${esc(r[0])}</dt><dd${r[0] === 'Device' ? title : ''}${r[2] ? ` class="${r[2]}"` : ''}>${esc(r[1])}</dd>`).join('') + '</dl>';
      };
      return `<section class="sigblock" id="sigblock">
        <h2>Signatures</h2>
        <div class="sig-grid">${cards}</div>
        <div class="esign">
          <h3>Electronic signature record</h3>
          ${sigs.map(rec).join('')}
          <p class="esign-note">Signed electronically under the U.S. ESIGN Act.</p>
        </div>
      </section>`;
    }

    function _docPaperCss() {
      return `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#e6e8eb;color:#111;font-family:Georgia,'Times New Roman',serif}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 16px;padding:10px 20px;background:#14161a;color:#f4f6f8;font:14px/1.4 system-ui,-apple-system,'Segoe UI',Arial,sans-serif}
.bar-title{font-weight:600;min-width:0;flex:1 1 240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-hint{color:#c3c8d0;font-size:13px}
.bar button{font:inherit;font-weight:600;padding:8px 16px;border:0;border-radius:6px;background:#1fa3e0;color:#04121a;cursor:pointer}
.bar button:hover{background:#6fd0ff}
.sheet{padding:28px 16px 64px}
.paper{background:#fff;color:#111;max-width:800px;margin:0 auto;padding:56px 64px;font-size:16px;line-height:1.6;box-shadow:0 2px 14px rgba(0,0,0,.18);border-radius:2px;overflow-wrap:anywhere}
.paper * { color: inherit !important; }
.paper a { color: #0b57d0 !important; text-decoration: underline; }
.paper .muted { color: #4b5563 !important; }
.paper h1{font-size:28px;line-height:1.25;margin:0 0 24px;padding-bottom:12px;border-bottom:2px solid #111}
.paper h2{font-size:21px;line-height:1.3;margin:32px 0 10px}
.paper h3{font-size:17px;line-height:1.35;margin:24px 0 8px}
.paper p,.paper ul,.paper ol{margin:0 0 14px}
.paper ul,.paper ol{padding-left:1.6em}
.paper li{margin:0 0 6px}
.paper table{border-collapse:collapse;max-width:100%}
.paper td,.paper th{vertical-align:top}
.paper img{max-width:100%;height:auto}
.paper hr{border:0;border-top:1px solid #bbb;margin:24px 0}
.paper .sigblock{margin-top:44px;padding-top:20px;border-top:2px solid #111;break-inside:avoid;page-break-inside:avoid}
.paper .sigblock h2{margin:0 0 16px;font-size:20px}
.paper .sig-grid{display:flex;flex-wrap:wrap;gap:28px 40px}
.paper .sig{flex:1 1 280px;min-width:240px;break-inside:avoid;page-break-inside:avoid}
.paper .sig-img{min-height:84px;display:flex;align-items:flex-end;border-bottom:2px solid #111;padding:0 4px 4px;background:#fff}
.paper .sig-img img{max-height:76px;max-width:100%;display:block}
.paper .sig-name{font-weight:700;margin-top:6px}
.paper .muted{font-size:14px}
.paper .esign{margin-top:24px;padding:14px 18px;border:1px solid #8b929c;border-radius:6px;background:#f6f7f9;font:13.5px/1.5 system-ui,-apple-system,'Segoe UI',Arial,sans-serif;break-inside:avoid;page-break-inside:avoid}
.paper .esign h3{margin:0 0 10px;font-size:15px}
.paper .esign h4{margin:12px 0 6px;font-size:13.5px}
.paper .esign dl{margin:0;display:grid;grid-template-columns:200px 1fr;gap:4px 14px}
.paper .esign dt{font-weight:600}
.paper .esign dd{margin:0}
.paper .esign .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;word-break:break-all}
.paper .esign-note{margin:12px 0 0;font-weight:600}
@page{size:letter;margin:0.75in}
@media print{
  html,body{background:#fff !important}
  .no-print,.bar{display:none !important}
  .sheet{padding:0}
  .paper{max-width:none;margin:0;padding:0;box-shadow:none;border-radius:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .paper h1,.paper h2,.paper h3{break-after:avoid;page-break-after:avoid}
  .paper table,.paper tr,.paper img{break-inside:avoid;page-break-inside:avoid}
  .paper .sigblock,.paper .sig,.paper .esign{break-inside:avoid;page-break-inside:avoid}
}
@media (max-width:640px){
  .paper{padding:28px 20px}
  .paper .esign dl{grid-template-columns:1fr}
  .paper .esign dt{margin-top:6px}
}`;
    }

    function _docNonce() {
      const a = new Uint8Array(16);
      try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
      return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // "<Doc name> - <Client name> - Signed 2026-10-20": the window title becomes the default "Save as PDF" file name.
    function _docFileTitle(doc, ev) {
      const clean = t => String(t || '').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
      const sigs = _docSignatures(doc, ev);
      let latest = 0;
      sigs.forEach(s => {
        const v = typeof s.at === 'string' && /^\d{9,}$/.test(s.at.trim()) ? Number(s.at) : s.at;
        const t = s.at ? new Date(v).getTime() : NaN;
        if (!isNaN(t) && t > latest) latest = t;
      });
      const day = latest ? new Date(latest).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : '';
      return [clean(doc.name) || 'Document', clean(ev && ev.clientName), day ? 'Signed ' + day : ''].filter(Boolean).join(' - ');
    }

    // The whole paper page as one HTML string. opts: { scrollToSig, autoPrint }
    function buildDocPaperHtml(doc, ev, opts) {
      opts = opts || {};
      const nonce = _docNonce();
      const sigs = _docSignatures(doc, ev);
      const title = _docFileTitle(doc, ev);
      const body = _sanitizeDocHtml(doc.contentHTML || doc.content || '') || '<p>(Empty document)</p>';
      const heading = /^\s*(?:<[^>]+>\s*)*<h1\b/i.test(body) ? '' : `<h1>${esc(doc.name || 'Document')}</h1>`;
      const csp = `default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src data:; base-uri 'none'; form-action 'none'`;
      const script = `(function(){
  var detect = ${_sigDetectInk.toString()};
  Array.prototype.forEach.call(document.querySelectorAll('img.sigimg'), detect);
  var b = document.getElementById('bsDownloadPdf');
  if (b) b.addEventListener('click', function(){ window.print(); });
  ${opts.scrollToSig ? "var sb = document.getElementById('sigblock'); if (sb) sb.scrollIntoView({block:'start'});" : ''}
  ${opts.autoPrint ? "window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 500); });" : ''}
})();`;
      return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${_docPaperCss()}</style></head><body>
<div class="bar no-print"><div class="bar-title">${esc(title)}</div><div class="bar-hint">In the print window, choose Save as PDF.</div><button type="button" id="bsDownloadPdf">Download PDF</button></div>
<div class="sheet"><main class="paper" id="paper">${heading}${body}${_docSigBlockHtml(sigs)}</main></div>
<script nonce="${nonce}">${script}<\/script>
</body></html>`;
    }

    function openDocPaper(eventId, docId, opts) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      const doc = ev && ev.docs && ev.docs.find(d => d.id === docId);
      if (!doc) return false;
      const win = window.open('', '_blank');
      if (!win) { showToast('Allow pop-ups to view documents', 'warning'); return false; }
      win.document.open();
      win.document.write(buildDocPaperHtml(doc, ev, opts));
      win.document.close();
      return true;
    }

    function viewEventDoc(eventId, docId) { openDocPaper(eventId, docId, {}); }

    // Download = the same paper view, opened straight into the print dialog (choose Save as PDF).
    function downloadEventDoc(eventId, docId) { openDocPaper(eventId, docId, { autoPrint: true }); }

    function viewEventDocSignature(eventId, docId) {
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      const doc = ev && ev.docs && ev.docs.find(d => d.id === docId);
      if (!doc || !_docSignatures(doc, ev).length) return;
      if (openDocPaper(eventId, docId, { scrollToSig: true })) return;
      // Pop-up blocked: fall back to the small modal, with the ink handled.
      const sigs = _docSignatures(doc, ev);
      const s = sigs.find(x => x.src) || sigs[0];
      const img = document.getElementById('sigViewImg');
      img.style.filter = s.ink === 'light' ? 'invert(1)' : 'none';
      img.src = s.src || '';
      _sigDetectInk(img);
      document.getElementById('sigViewMeta').textContent = 'Signed' + (s.at ? ' ' + _sigWhen(s.at) : '') + ' by ' + s.name;
      openModal('sigViewModal');
    }

    function deleteEventDoc(eventId, docId) {
      confirmDestructive('Remove Document', 'Remove this document from the event?', function() {
        const events = getDB('events');
        const ev = events.find(e => e.id === eventId);
        if (!ev || !ev.docs) return;
        ev.docs = ev.docs.filter(d => d.id !== docId);
        setDB('events', events);
        window.currentEvent = ev;
        document.getElementById('tabDocuments').innerHTML = renderEventDocuments(ev);
        showToast('Document removed', 'success');
      }, 'Remove');
    }

    // ── E-Signature Pad ──────────────────────────────────────────────────────
    let _sigCanvas = null, _sigCtx = null, _sigDrawing = false;
    let _sigEventId = null, _sigDocId = null;

    function openSignatureModal(eventId, docId) {
      _sigEventId = eventId; _sigDocId = docId;
      const events = getDB('events');
      const ev = events.find(e => e.id === eventId);
      const doc = ev && ev.docs && ev.docs.find(d => d.id === docId);
      if (!doc) return;
      document.getElementById('sigDocName').textContent = 'Signing: ' + doc.name;
      openModal('signatureModal');
      setTimeout(() => {
        _sigCanvas = document.getElementById('signatureCanvas');
        if (!_sigCanvas) return;
        _sigCtx = _sigCanvas.getContext('2d');
        _sigCtx.clearRect(0, 0, _sigCanvas.width, _sigCanvas.height);
        _sigCtx.strokeStyle = '#111111'; _sigCtx.lineWidth = 2.5; _sigCtx.lineCap = 'round'; _sigCtx.lineJoin = 'round';
        const getPos = (e) => { const r = _sigCanvas.getBoundingClientRect(); const sx = _sigCanvas.width / r.width; const sy = _sigCanvas.height / r.height; return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy]; };
        _sigCanvas.onmousedown = (e) => { _sigDrawing = true; _sigCtx.beginPath(); _sigCtx.moveTo(...getPos(e)); };
        _sigCanvas.onmousemove = (e) => { if (!_sigDrawing) return; _sigCtx.lineTo(...getPos(e)); _sigCtx.stroke(); };
        _sigCanvas.onmouseup = _sigCanvas.onmouseleave = () => { _sigDrawing = false; };
        _sigCanvas.ontouchstart = (e) => { e.preventDefault(); _sigDrawing = true; _sigCtx.beginPath(); const t = e.touches[0]; _sigCtx.moveTo(...getPos(t)); };
        _sigCanvas.ontouchmove = (e) => { e.preventDefault(); if (!_sigDrawing) return; const t = e.touches[0]; _sigCtx.lineTo(...getPos(t)); _sigCtx.stroke(); };
        _sigCanvas.ontouchend = () => { _sigDrawing = false; };
      }, 150);
    }

    function clearSignature() { if (_sigCtx && _sigCanvas) _sigCtx.clearRect(0, 0, _sigCanvas.width, _sigCanvas.height); }

    async function saveSignature() {
      if (!_sigCanvas) return;
      // Check if canvas is blank
      const px = _sigCtx.getImageData(0, 0, _sigCanvas.width, _sigCanvas.height).data;
      const hasContent = Array.from(px).some(v => v !== 0);
      if (!hasContent) { showToast('Please draw your signature first', 'warning'); return; }
      const sig = _sigCanvas.toDataURL('image/png');
      const events = getDB('events');
      const ev = events.find(e => e.id === _sigEventId);
      const doc = ev && ev.docs && ev.docs.find(d => d.id === _sigDocId);
      if (!doc) return;
      doc.signature = sig; doc.signedAt = Date.now(); doc.signedBy = BSPortal.getCurrentUser()?.name || 'Authorized Signatory';

      // Auto-advance pipeline stage when a contract is signed
      const isContract = doc.name && /agreement|contract/i.test(doc.name);
      if (isContract && ev && !['booked','confirmed','completed'].includes(ev.status)) {
        ev.status = 'booked';
      }

      setDB('events', events);
      closeModal('signatureModal');
      window.currentEvent = ev;
      document.getElementById('tabDocuments').innerHTML = renderEventDocuments(ev);
      showToast('Document signed and saved!', 'success');

      // If this is a contract AND client has an email, create their portal account + send invite
      if (isContract && ev && ev.clientEmail) {
        const clientEmail = ev.clientEmail;
        const clientName  = ev.clientName || 'Client';
        // Generate portal password if not already set, then sync via single write path
        if (!ev.portalPassword) {
          const newPw = genPortalPassword(); // K: readable format
          setClientCredentials(clientEmail, ev.portalEmail || clientEmail, newPw);
          // Refresh ev reference after sync
          const freshEvents = getDB('events');
          const freshEv = freshEvents.find(e => e.id === ev.id);
          if (freshEv) { Object.assign(ev, freshEv); }
        }
        const pass = ev.portalPassword;
        const eventDate = ev.date ? new Date(ev.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : 'your event date';

        showToast('Contract signed — creating client portal…', 'info');

        // Create Supabase auth user for client via Edge Function (client_invite handles this)
        const r = await BSPortal.sendEmail('client_invite', {
          email: clientEmail, clientName, password: pass,
          eventName: ev.name || 'Your Event', eventDate
        });
        if (r.ok) {
          showToast('Client portal invite sent to ' + clientEmail, 'success');
        } else {
          showToast('The portal invite email did not send. Send it manually from the event detail page. (' + r.error + ')', 'warning');
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────
    //  ADDENDUM LIBRARY — auto-injected into contracts based on services
    // ─────────────────────────────────────────────────────────────────
    const ADDENDUM_LIBRARY = [
      { keywords: ['cold spark'],
        title: 'Cold Spark Towers — Safety & Liability Addendum',
        content: `<p>This addendum governs the use of Cold Spark Towers ("pyrotechnic-style cold spark devices") at the Event.</p>
<p><strong>1. Venue Approval.</strong> Client is solely responsible for obtaining written venue approval for cold spark effects prior to the event date. If approval is not obtained, Baseline Studio reserves the right to omit this effect without issuing a refund for its line item.</p>
<p><strong>2. Safety Clearance.</strong> Cold spark towers require a minimum clearance of 6 feet on all sides and 12 feet of vertical clearance. Client and venue are responsible for ensuring these conditions are met.</p>
<p><strong>3. Fire Safety.</strong> A fire extinguisher must be accessible within 15 feet of each device during operation. Baseline Studio is not responsible for venue compliance with local fire codes.</p>
<p><strong>4. Liability.</strong> Client assumes all liability for any injury or property damage resulting from failure to maintain required clearances or from unauthorized guest contact with operating devices.</p>` },
      { keywords: ['co₂ jets', 'co2 jets', 'co₂ jet', 'co2 jet'],
        title: 'CO₂ Jets — Safety & Operations Addendum',
        content: `<p>This addendum governs the use of CO₂ Jets at the Event.</p>
<p><strong>1. Indoor Use.</strong> CO₂ jet effects require adequate venue ventilation. Use in sealed or poorly ventilated spaces may be restricted or prohibited at Baseline Studio's discretion.</p>
<p><strong>2. Safe Zone.</strong> A minimum 8-foot guest-free safety perimeter must be maintained around active CO₂ jet devices during operation. Venue and Client are jointly responsible for crowd management in this zone.</p>
<p><strong>3. Supply.</strong> CO₂ canisters are provided for the contracted duration only. Additional activations beyond the quoted scope may not be available on-site.</p>
<p><strong>4. Liability.</strong> Client assumes responsibility for ensuring no guests approach active equipment during operation. Baseline Studio is not liable for injury resulting from unauthorized contact with CO₂ jet devices.</p>` },
      { keywords: ['co₂ cannon', 'co2 cannon', 'co₂ cannons', 'co2 cannons'],
        title: 'CO₂ Cannons — Safety & Operations Addendum',
        content: `<p>This addendum governs the use of CO₂ Cannons ("handheld or mounted cryo cannons") at the Event.</p>
<p><strong>1. Operator Control.</strong> CO₂ cannons are operated exclusively by Baseline Studio personnel. No guest or venue staff shall operate the equipment under any circumstance.</p>
<p><strong>2. Direction of Effect.</strong> CO₂ cannon blasts shall not be directed at any individual's face at close range. A minimum stand-off distance of 4 feet is required for any directed guest interaction.</p>
<p><strong>3. Venue Consent.</strong> Client is responsible for confirming venue consent to CO₂ cannon use. Condensation and CO₂ gas may affect certain surfaces and HVAC systems.</p>
<p><strong>4. Liability.</strong> Baseline Studio is not liable for injury or property damage caused by guests attempting to operate or interfere with CO₂ cannon equipment.</p>` },
      { keywords: ['dancing on cloud', 'dancing on clouds'],
        title: 'Dancing on Clouds / Low-Lying Fog — Safety Addendum',
        content: `<p>This addendum governs the use of the Dancing on Clouds low-lying fog effect at the Event.</p>
<p><strong>1. Effect Description.</strong> The Dancing on Clouds effect uses a low-lying fog machine to create a ground-level cloud layer, typically for the first dance or a designated ceremony moment.</p>
<p><strong>2. Slip Hazard.</strong> Low-lying fog may reduce visibility of the floor surface. Client and venue are responsible for ensuring the dance floor is dry and free of trip hazards prior to activation.</p>
<p><strong>3. Duration.</strong> The effect is designed for a single designated moment (typically 3–5 minutes per activation). Extended continuous use is not included unless separately quoted.</p>
<p><strong>4. Ventilation.</strong> Adequate venue ventilation is required. Baseline Studio reserves the right to halt the effect if CO₂ levels or visibility impairment present a safety concern.</p>` },
      { keywords: ['led video wall', 'video wall'],
        title: 'LED Video Wall — Setup & Power Requirements Addendum',
        content: `<p>This addendum governs the installation and operation of an LED Video Wall at the Event.</p>
<p><strong>1. Power Requirements.</strong> The LED Video Wall requires dedicated 20-amp circuits. Client is responsible for confirming power availability with the venue prior to the event date.</p>
<p><strong>2. Setup Time.</strong> Installation requires a minimum of 2 hours of unobstructed venue access before guest arrival. Any reduction of this window due to venue scheduling is not the liability of Baseline Studio.</p>
<p><strong>3. Content.</strong> Standard motion background content is included. Custom graphics, logos, or video must be delivered to Baseline Studio no later than 72 hours before the event date.</p>
<p><strong>4. Structural Safety.</strong> The LED Video Wall will be ground-supported or rigged per the venue's approved plan. No modification to the panel arrangement shall be made without written consent from Baseline Studio.</p>` },
      { keywords: ['fog', 'haze', 'fog / haze', 'fog/haze'],
        title: 'Fog / Haze Machine — Operations Addendum',
        content: `<p>This addendum governs the use of fog or haze machines at the Event.</p>
<p><strong>1. Fire Alarm Systems.</strong> Fog and haze effects may trigger venue smoke detectors. Client and venue are solely responsible for coordinating with venue management to disable or cover applicable detectors prior to use. Baseline Studio is not liable for any false alarms or associated costs.</p>
<p><strong>2. Effect Type.</strong> Haze machines produce a fine atmospheric haze to enhance lighting. Standard fog machines produce denser, more visible clouds. The contracted equipment type determines which is deployed.</p>
<p><strong>3. Fluid.</strong> Only water-based, venue-safe fog/haze fluid is used. Oil-based fluids are not used by Baseline Studio.</p>
<p><strong>4. Ventilation.</strong> Adequate venue ventilation is required. Baseline Studio reserves the right to reduce effect intensity if air quality or floor visibility is impaired beyond safe levels.</p>` },
    ];

    function _detectEventServices(ev) {
      const descs = [];
      (ev.quotes || []).forEach(q => (q.lines || []).forEach(l => descs.push((l.desc || '').toLowerCase())));
      const invoices = (getDB('invoices') || []).filter(i => i.eventId === ev.id);
      invoices.forEach(inv => (inv.lines || []).forEach(l => descs.push((l.desc || '').toLowerCase())));
      return descs;
    }

    function _injectAddenda(docHTML, ev) {
      // Contracts built from the standard templates already carry service sections for every booked service.
      if (typeof BSContracts !== 'undefined' && BSContracts.hasModules(docHTML)) return docHTML;
      const descs = _detectEventServices(ev);
      if (!descs.length) return docHTML;
      const matched = [];
      const seen = new Set();
      ADDENDUM_LIBRARY.forEach(addendum => {
        if (seen.has(addendum.title)) return;
        const hit = addendum.keywords.some(kw => descs.some(d => d.includes(kw)));
        if (hit) { matched.push(addendum); seen.add(addendum.title); }
      });
      if (!matched.length) return docHTML;
      let addendaHTML = `<div style="page-break-before:always;margin-top:48px;padding-top:32px;border-top:3px solid #1FA3E0;">
        <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.1em;color:#111;margin-bottom:24px;font-family:Arial,sans-serif;">Addenda — Service-Specific Terms</h2>`;
      matched.forEach((a, idx) => {
        addendaHTML += `<div style="margin-bottom:32px;${idx > 0 ? 'padding-top:24px;border-top:1px solid #ddd;' : ''}">
          <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#111;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:12px;font-family:Arial,sans-serif;">${a.title}</h3>
          <div style="font-size:12px;line-height:1.8;color:#333;font-family:Arial,sans-serif;">${a.content}</div>
        </div>`;
      });
      addendaHTML += `</div>`;
      return docHTML + addendaHTML;
    }

    // ─────────────────────────────────────────────────────────────────
    //  SMART PAYMENT TERMS (used in doc preview and placeholder fill)
    // ─────────────────────────────────────────────────────────────────
    function computeSmartPaymentTerms(eventDateStr) {
      // Terms (deposit percent, balance days) come from Settings > Contract terms via BSContracts.
      const r = BSContracts.paymentTermsFor(eventDateStr, BSContracts.getTerms(getDB('settings')), {});
      return { paymentTerms: r.paymentTerms, depositDueDate: r.depositDueDate, balanceDueDate: r.balanceDueDate };
    }

    // Resolve {{placeholder}} tokens in document HTML with real event data (preview).
    // Pass ev = an event object, or null to show generic fallback labels. Same engine as the saved contracts.
    function resolveDocPlaceholders(html, ev) {
      if (typeof BSContracts === 'undefined') return html;
      return BSContracts.mergeForEvent(html, ev, _contractEnv(), {
        wrap: (val, key, isHtml) => isHtml ? val : `<span style="background:rgba(31,163,224,0.15);color:#0b4f6c;border-radius:3px;padding:0 3px;">${val}</span>`
      });
    }

    // Open a preview window showing the current document with placeholders filled.
    function previewCurrentDocument() {
      const editor = document.getElementById('docEditor');
      if (!editor) { showToast('Open a document first', 'warning'); return; }
      const rawHtml = editor.innerHTML;
      if (!rawHtml.trim()) { showToast('Document is empty', 'warning'); return; }

      // Get event context (from event detail view or from currentEvent)
      const ev = window.currentDetailEvent || window.currentEvent || null;

      const resolved = resolveDocPlaceholders(rawHtml, ev);

      const templateName = (() => {
        if (!window.currentDocumentId) return 'Document Preview';
        const t = (getDB('templates')||[]).find(t=>t.id===window.currentDocumentId);
        return t?.name || 'Document Preview';
      })();

      const contextNote = ev
        ? `<div style="background:#fffbe6;border:1px solid #ffd966;color:#7a5c00;padding:8px 16px;font-size:12px;border-radius:4px;margin-bottom:20px;">Filled with data from event: <strong>${ev.name}</strong> — ${ev.clientName}</div>`
        : `<div style="background:#f5f5f5;border:1px solid #ddd;color:#666;padding:8px 16px;font-size:12px;border-radius:4px;margin-bottom:20px;">No event context — open a document from inside an event for real data. Showing placeholder labels.</div>`;

      const w = window.open('', '_blank', 'width=920,height=800,menubar=yes');
      w.document.write(`<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <title>Preview — ${templateName}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Georgia, 'Times New Roman', serif; background: #eceae6; }
          .page-wrap { padding: 40px 20px; max-width: 820px; margin: 0 auto; }
          .doc-header { text-align:center; border-bottom: 3px solid #1FA3E0; padding-bottom:20px; margin-bottom:28px; }
          .doc-header .brand { font-size:22px; font-weight:900; letter-spacing:.08em; color:#1FA3E0; font-family:Arial,sans-serif; }
          .doc-header .tagline { font-size:12px; color:#666; margin-top:4px; font-family:Arial,sans-serif; letter-spacing:.05em; }
          .doc-page { background:#fff; padding:72px 80px 100px; box-shadow:0 4px 40px rgba(0,0,0,.12); min-height:1000px; }
          .doc-page h1 { font-size:2em; margin:0 0 .5em; }
          .doc-page h2 { font-size:1.5em; margin:1em 0 .4em; }
          .doc-page h3 { font-size:1.2em; margin:1em 0 .3em; }
          .doc-page p  { margin-bottom:.9em; line-height:1.7; }
          .doc-page ul, .doc-page ol { margin:0 0 .9em 1.5em; line-height:1.7; }
          .doc-footer { text-align:center; font-size:12px; color:#666; font-family:Arial,sans-serif; border-top:1px solid #eee; padding-top:18px; margin-top:32px; }
          .print-bar { background:#111118; color:#fff; padding:12px 24px; display:flex; align-items:center; justify-content:space-between; font-family:Arial,sans-serif; font-size:13px; }
          .print-bar button { background:#1FA3E0; color:#07070d; border:none; padding:7px 18px; border-radius:5px; cursor:pointer; font-weight:600; font-size:13px; }
          @media print { .print-bar { display:none!important; } }
        </style>
      </head><body>
        <div class="print-bar">
          <span>👁 Preview — <strong>${templateName}</strong></span>
          <button onclick="window.print()">🖨 Print / Save PDF</button>
        </div>
        <div class="page-wrap">
          ${contextNote}
          <div class="doc-page">
            <div class="doc-header">
              <div class="brand">BASELINE STUDIO</div>
              <div class="tagline">Miami Event Production · (786) 302-6056 · baselinestudiofl.com</div>
            </div>
            ${resolved}
            <div class="doc-footer">
              Baseline Studio · (786) 302-6056 · Hello@baselinestudiofl.com · baselinestudiofl.com
            </div>
          </div>
        </div>
      </body></html>`);
      w.document.close();
    }

    // 
    //  DOCUMENT SHARE WITH CLIENT
    // 
    function toggleDocClientShare(docId, shared) {
      const templates = getDB('templates');
      const doc = templates.find(t => t.id === docId);
      if (doc) {
        doc.sharedWithClient = shared;
        setDB('templates', templates);
        showToast(shared ? 'Document shared with client portal' : 'Document unshared', shared ? 'success' : 'info');
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DOCUMENT SYSTEM v2 — Templates, Send, Track, Blasts
    // ══════════════════════════════════════════════════════════════════════════

    // ── Tab switching ──────────────────────────────────────────────────────────
    function switchDocTab(tab) {
      document.querySelectorAll('.doc-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.doc-tab-content').forEach(c => c.classList.remove('active'));
      const btnId = 'docTabBtn' + tab.charAt(0).toUpperCase() + tab.slice(1);
      const panelId = 'docTab' + tab.charAt(0).toUpperCase() + tab.slice(1);
      const btn = document.getElementById(btnId);
      const panel = document.getElementById(panelId);
      if (btn) btn.classList.add('active');
      if (panel) panel.classList.add('active');
      if (tab === 'send') renderSendDocTab();
      if (tab === 'track') renderTrackTab();
      if (tab === 'blasts') renderBlastsTab();
    }

    // ── Seed default templates ────────────────────────────────────────────────
    function seedDefaultTemplates() {
      const existing = getDB('templates');
      if (existing && existing.length > 0) return;
      const T = [
        { id: genId(), name: 'Cancellation Agreement', category: 'client', contentHTML: `<h1>Event Cancellation Agreement</h1><p>Date: <strong>{{current_date}}</strong></p><p>This agreement is between <strong>Baseline Studio</strong> and <strong>{{client_name}}</strong> regarding the event originally scheduled for <strong>{{event_date}}</strong> at <strong>{{venue_name}}</strong>.</p><h2>Cancellation Terms</h2><p>The parties agree that the DJ Services Agreement for the above event is hereby cancelled effective today.</p><h2>Financial Settlement</h2><ul><li>Original contract total: {{total_price}}</li><li>Deposit previously paid: {{deposit_amount}}</li><li>Additional amount owed by Client: $____________</li><li>Refund to be issued by Baseline Studio: $____________</li></ul><h2>Release</h2><p>Upon settlement of any amounts owed, both parties release each other from all claims arising from the original agreement.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;padding-right:20px;vertical-align:top;"><p><strong>Client Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________</p><p style="font-size:12px;">Date: ______________</p></td><td style="width:50%;padding-left:20px;vertical-align:top;"><p><strong>Baseline Studio</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Date: ______________</p></td></tr></table>` },
        { id: genId(), name: 'Services Adjustment Agreement', category: 'client', contentHTML: `<h1>Services Adjustment Agreement</h1><p>Date: <strong>{{current_date}}</strong></p><p>This agreement modifies the original DJ Services Agreement between <strong>Baseline Studio</strong> and <strong>{{client_name}}</strong> for the event on <strong>{{event_date}}</strong>.</p><h2>Original Agreement</h2><p>Original Services: [list from original contract]<br>Original Total: [original amount]</p><h2>Modifications</h2><p><strong>Services Added:</strong></p><ul><li>___________________________________________</li></ul><p><strong>Services Removed:</strong></p><ul><li>___________________________________________</li></ul><h2>Revised Pricing</h2><p>Revised Total: {{total_price}}<br>Additional Balance Due: $____________<br>Due Date: {{balance_due_date}}</p><h2>All Other Terms Unchanged</h2><p>All other terms from the original agreement remain in full force.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;padding-right:20px;vertical-align:top;"><p><strong>Client Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Date: ______________</p></td><td style="width:50%;padding-left:20px;vertical-align:top;"><p><strong>Baseline Studio</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Date: ______________</p></td></tr></table>` },
        { id: genId(), name: 'Photo & Video Release', category: 'client', contentHTML: `<h1>Photo &amp; Video Release Form</h1><p>Date: <strong>{{current_date}}</strong> &nbsp;&bull;&nbsp; Event: <strong>{{event_type}}</strong> on <strong>{{event_date}}</strong></p><p>I, <strong>{{client_name}}</strong>, grant Baseline Studio permission to use photos and video from the above event for marketing purposes (website, social media, portfolio). No names or personal details will be shared without additional written consent.</p><p><strong>Optional social media tag permission:</strong><br>[ ] I consent to being tagged in posts featuring my event.<br>Preferred handle: ___________________________</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;vertical-align:top;"><p><strong>Client Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;"></td></tr></table>` },
        { id: genId(), name: 'DJ / Performer — Independent Contractor Agreement', category: 'employee', contentHTML: `<h1>Independent Contractor Agreement</h1><p>This agreement is entered into as of <strong>{{current_date}}</strong>, between <strong>Baseline Studio</strong> ("Company") and <strong>_______________________</strong> ("Contractor").</p><h2>1. Services</h2><p>Contractor agrees to provide DJ/Performer services at events as assigned by Baseline Studio, including DJing, MCing, equipment operation, and professional client interaction.</p><h2>2. Independent Contractor Status</h2><p>Contractor is an independent contractor, not an employee. Contractor is responsible for their own taxes, insurance, and expenses unless otherwise agreed in writing.</p><h2>3. Compensation</h2><p>Per-event rate: $____________<br>Payment method: ___________________________<br>Payment timing: Within 5 business days of completed event.</p><h2>4. Equipment</h2><p>Baseline Studio will provide equipment as specified per event. Contractor is responsible for any damage caused by negligence or misuse.</p><h2>5. Confidentiality</h2><p>Contractor agrees not to disclose client information, pricing, or any proprietary business information of Baseline Studio to any third party.</p><h2>6. Cancellation Policy</h2><p>If Contractor cannot perform an assigned event, they must notify Baseline Studio at least 72 hours in advance. Failure to provide adequate notice without a documented emergency may result in forfeiture of that event's compensation.</p><h2>7. Term</h2><p>This agreement is in effect on a per-event basis until terminated in writing by either party.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;padding-right:20px;vertical-align:top;"><p><strong>Contractor Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;padding-left:20px;vertical-align:top;"><p><strong>Baseline Studio</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Authorized Signature<br>Date: ______________</p></td></tr></table>` },
        { id: genId(), name: 'Non-Disclosure Agreement (NDA)', category: 'employee', contentHTML: `<h1>Non-Disclosure Agreement</h1><p>This NDA is entered into as of <strong>{{current_date}}</strong>, between <strong>Baseline Studio</strong> ("Company") and <strong>_______________________</strong> ("Recipient").</p><h2>1. Confidential Information</h2><p>"Confidential Information" includes all business information, client data, event details, pricing, and proprietary processes of Baseline Studio not publicly available.</p><h2>2. Obligations</h2><p>Recipient agrees to: (a) keep all Confidential Information strictly confidential; (b) not disclose to any third party without written consent; (c) use it only in connection with services provided to Baseline Studio.</p><h2>3. Duration</h2><p>These obligations remain in effect for 2 years from the date of this agreement, and indefinitely with respect to client personal data.</p><h2>4. Agreement</h2><p>Both parties confirm they have read and agree to these terms.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;padding-right:20px;vertical-align:top;"><p><strong>Recipient Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;padding-left:20px;vertical-align:top;"><p><strong>Baseline Studio</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Date: ______________</p></td></tr></table>` },
        { id: genId(), name: 'Equipment Use Policy — Acknowledgment', category: 'employee', contentHTML: `<h1>Equipment Use Policy — Acknowledgment</h1><p>Date: <strong>{{current_date}}</strong></p><p>By signing below, <strong>_______________________</strong> acknowledges receipt and understanding of Baseline Studio's Equipment Use Policy.</p><h2>Policy Summary</h2><ol><li><strong>Care:</strong> All equipment must be handled carefully and transported in provided cases.</li><li><strong>Setup/Teardown:</strong> Follow Baseline Studio's setup and breakdown procedures at every event.</li><li><strong>Damage Reporting:</strong> Any damage, loss, or theft must be reported immediately. Damage from negligence may be charged to the responsible party.</li><li><strong>No Modifications:</strong> No modifications to equipment without written authorization.</li><li><strong>Return:</strong> All equipment returned within 24 hours of the event, in the condition received.</li></ol><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;vertical-align:top;"><p><strong>Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;"></td></tr></table>` },
        { id: genId(), name: 'Code of Conduct Agreement', category: 'employee', contentHTML: `<h1>Code of Conduct Agreement</h1><p>Date: <strong>{{current_date}}</strong></p><p>All Baseline Studio representatives are expected to maintain the highest standards of professionalism. By signing, <strong>_______________________</strong> agrees to the following:</p><ol><li><strong>Appearance:</strong> Arrive professionally dressed per management's guidelines for each event.</li><li><strong>Punctuality:</strong> Arrive at least 90 minutes before event start for setup, or as directed.</li><li><strong>Client Interaction:</strong> Be courteous and professional with all clients and guests at all times.</li><li><strong>No Substances:</strong> No alcohol or impairing substances before or during events while on duty.</li><li><strong>Social Media:</strong> Do not post content from events without explicit written permission from Baseline Studio and the client.</li><li><strong>Confidentiality:</strong> Client names, event details, and pricing are confidential — not to be shared externally.</li></ol><p>Violations may result in removal from an event and/or termination of the working relationship.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;vertical-align:top;"><p><strong>Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;"></td></tr></table>` },
        { id: genId(), name: 'Emergency Contact Form', category: 'employee', contentHTML: `<h1>Emergency Contact Information</h1><p>Date: <strong>{{current_date}}</strong></p><p>Team Member Name: ___________________________<br>Phone: ___________________________<br>Email: ___________________________</p><h2>Primary Emergency Contact</h2><p>Name: ___________________________<br>Relationship: ___________________________<br>Phone: ___________________________</p><h2>Secondary Emergency Contact</h2><p>Name: ___________________________<br>Relationship: ___________________________<br>Phone: ___________________________</p><h2>Medical Information (Optional)</h2><p>Allergies or medical conditions we should be aware of:<br>_______________________________________________</p><p>I confirm the above information is accurate and I will notify Baseline Studio of any changes.</p><br><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;width:50%;"></div><p style="font-size:12px;">Signature &nbsp;&nbsp;&nbsp; Date: ______________</p>` }
      ];
      setDB('templates', T);
    }

    // ── Send for Signature tab ─────────────────────────────────────────────────
    function renderSendDocTab() {
      const templates = getDB('templates') || [];
      const events = (getDB('events') || []).filter(e => e.clientEmail || e.portalEmail);
      const accounts = getDB('accounts') || [];
      const currentUser = BSPortal.getCurrentUser();
      const isDJ = currentUser?.role === 'dj';
      if (isDJ) { document.getElementById('docTabSend').innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray);">Send access is not available for your role.</div>'; return; }

      const tOpts = templates.map(t => `<option value="${t.id}">${t.name}${t.category === 'employee' ? ' [Employee]' : ' [Client]'}</option>`).join('');
      const evOpts = events.map(e => `<option value="${e.id}">${e.clientName || 'Client'} — ${e.name || e.type || ''} (${e.date || ''})</option>`).join('') || '<option value="">No client events with email on file</option>';
      const empOpts = accounts.map(a => `<option value="${encodeURIComponent(a.email)}|${encodeURIComponent(a.name)}|${encodeURIComponent(a.role || '')}">${a.name} (${a.role || 'staff'}) — ${a.email}</option>`).join('') || '<option value="">No team accounts yet</option>';

      document.getElementById('docTabSend').innerHTML = `
        <div style="font-family:'Anton',sans-serif;font-size:22px;margin-bottom:6px;">Send Document for Signature</div>
        <div style="color:var(--gray);font-size:13px;margin-bottom:28px;">Pick a template, choose who receives it, and send. They sign from their portal.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;max-width:1000px;">
          <div>
            <div class="form-group">
              <label class="form-label" for="sendDocTemplate">Document Template</label>
              <select class="form-select" id="sendDocTemplate" onchange="previewSendDoc()">
                <option value="">Select template...</option>${tOpts}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Send to</label>
              <div style="display:flex;gap:16px;margin-bottom:14px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;"><input type="radio" name="sendDocTarget" value="client" checked onchange="toggleSendDocRecipient()"> Client</label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;"><input type="radio" name="sendDocTarget" value="employee" onchange="toggleSendDocRecipient()"> Employee / Team</label>
              </div>
              <div id="sendDocClientWrap">
                <label class="form-label" style="font-size:12px;" for="sendDocClientEvent">Select Client Event</label>
                <select class="form-select" id="sendDocClientEvent">${evOpts}</select>
              </div>
              <div id="sendDocEmployeeWrap" style="display:none;">
                <label class="form-label" style="font-size:12px;" for="sendDocEmployee">Select Team Member</label>
                <select class="form-select" id="sendDocEmployee">${empOpts}</select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="sendDocMessage">Note to Recipient (Optional)</label>
              <textarea class="form-textarea" id="sendDocMessage" rows="3" placeholder="Add a short note..."></textarea>
            </div>
            <button class="btn btn-primary" style="width:100%;padding:14px;font-size:14px;" onclick="sendDocumentForSignature()">Send for Signature</button>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:10px;">Document Preview</div>
            <div id="sendDocPreviewWrap" style="background:var(--black-4);border:1px solid var(--border);border-radius:8px;padding:16px;min-height:400px;max-height:600px;overflow-y:auto;">
              <div style="color:var(--gray);font-size:13px;text-align:center;padding-top:60px;">Select a template to preview</div>
            </div>
          </div>
        </div>
      `;
    }

    function toggleSendDocRecipient() {
      const val = document.querySelector('input[name="sendDocTarget"]:checked')?.value;
      const cw = document.getElementById('sendDocClientWrap');
      const ew = document.getElementById('sendDocEmployeeWrap');
      if (cw) cw.style.display = val === 'client' ? 'block' : 'none';
      if (ew) ew.style.display = val === 'employee' ? 'block' : 'none';
    }

    function previewSendDoc() {
      const tid = document.getElementById('sendDocTemplate')?.value;
      const templates = getDB('templates') || [];
      const t = templates.find(t => t.id === tid);
      const wrap = document.getElementById('sendDocPreviewWrap');
      if (!wrap) return;
      if (!t) { wrap.innerHTML = '<div style="color:var(--gray);font-size:13px;text-align:center;padding-top:60px;">Select a template to preview</div>'; return; }
      wrap.innerHTML = `<div style="background:#fff;color:#111;border-radius:4px;padding:28px 32px;font-family:Georgia,serif;font-size:13px;line-height:1.7;">${t.contentHTML || t.content || '(empty)'}</div>`;
    }

    async function _hashDoc(content) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,20);
      } catch { return genId(); }
    }

    async function sendDocumentForSignature() {
      const tid = document.getElementById('sendDocTemplate')?.value;
      if (!tid) { showToast('Select a template first', 'error'); return; }
      const targetType = document.querySelector('input[name="sendDocTarget"]:checked')?.value;
      const templates = getDB('templates') || [];
      const template = templates.find(t => t.id === tid);
      if (!template) return;
      let recipientEmail = '', recipientName = '', recipientRole = '', recipientType = targetType;
      let mergedHtml = null;
      if (targetType === 'client') {
        const evId = document.getElementById('sendDocClientEvent')?.value;
        if (!evId) { showToast('Select a client event', 'error'); return; }
        const ev = (getDB('events') || []).find(e => e.id === evId);
        if (!ev) return;
        recipientEmail = ev.clientEmail || ev.portalEmail || '';
        recipientName = ev.clientName || 'Client';
        recipientRole = 'client';
        if (typeof BSContracts !== 'undefined') mergedHtml = BSContracts.mergeForEvent(template.contentHTML || template.content || '', ev, _contractEnv());
      } else {
        const empVal = document.getElementById('sendDocEmployee')?.value;
        if (!empVal) { showToast('Select a team member', 'error'); return; }
        const [e, n, r] = empVal.split('|').map(v => decodeURIComponent(v));
        recipientEmail = e; recipientName = n; recipientRole = r;
      }
      if (!recipientEmail) { showToast('Recipient has no email on file', 'error'); return; }
      const message = document.getElementById('sendDocMessage')?.value || '';
      const hash = await _hashDoc(template.contentHTML || '');
      const inst = {
        id: genId(), templateId: tid, templateName: template.name, category: template.category || '',
        recipientEmail, recipientName, recipientRole, recipientType,
        htmlContent: mergedHtml !== null ? mergedHtml : (template.contentHTML || template.content || ''),
        message, status: 'pending', sentAt: Date.now(), documentHash: hash,
        signedAt: null, signatureData: null
      };
      const instances = getDB('document_instances') || [];
      instances.push(inst);
      setDB('document_instances', instances);
      // Email notification
      const _docSubject = `Document ready for your signature: ${template.name}`;
      const _docBody = `Hi ${recipientName},\n\nA document has been sent to you for your e-signature: ${template.name}.\n\n${message ? message + '\n\n' : ''}Please log in to your Baseline Studio portal to review and sign it.\n\nPortal: ${window.location.origin}/portal-employee.html\n\nBaseline Studio`;
      const _docRes = await BSPortal.sendEmail('generic', {
        email: recipientEmail,
        clientName: recipientName,
        subject: _docSubject,
        body: _docBody
      });
      if (_docRes.ok) {
        showToast(`Sent to ${recipientName}`, 'success');
      } else {
        showToast(`Document saved, but the email to ${recipientName} did not send: ${_docRes.error || 'unknown error'}`, 'error');
        showEmailFallback(recipientEmail, _docSubject, _docBody, 'Could not send (' + (_docRes.error || 'unknown error') + '). Send it manually:');
      }
      setTimeout(() => switchDocTab('track'), 1100);
    }

    // ── Track tab ──────────────────────────────────────────────────────────────
    function renderTrackTab() {
      const instances = [...(getDB('document_instances') || [])].sort((a,b) => b.sentAt - a.sentAt);
      const statusBadge = s => ({ pending:`<span class="track-status-badge track-status-pending">Pending</span>`, viewed:`<span class="track-status-badge" style="background:rgba(31,163,224,0.18);color:var(--cyan);">Viewed</span>`, signed:`<span class="track-status-badge track-status-signed">Signed</span>`, declined:`<span class="track-status-badge track-status-declined">Declined</span>` }[s] || `<span class="track-status-badge track-status-pending">Pending</span>`);
      const rows = instances.map(inst => `<tr>
        <td style="font-weight:600;max-width:200px;">${inst.templateName}</td>
        <td>${inst.recipientName}<br><span style="font-size:12px;color:var(--gray);">${inst.recipientEmail}</span></td>
        <td><span class="badge" style="background:rgba(31,163,224,0.12);color:var(--cyan);font-size:12px;">${inst.recipientType === 'client' ? 'Client' : (inst.recipientRole || 'Employee')}</span></td>
        <td>${new Date(inst.sentAt).toLocaleDateString()}</td>
        <td>${statusBadge(inst.status)}</td>
        <td>${inst.signedAt ? new Date(inst.signedAt).toLocaleDateString() : '—'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          ${inst.status === 'signed' ? `<button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="viewDocSignature('${inst.id}')">View Sig</button>` : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="resendDocInstance('${inst.id}')">Resend</button>`}
          <button class="btn btn-danger" style="padding:4px 8px;font-size:12px;" onclick="deleteDocInstance('${inst.id}')">Del</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--gray);">No documents sent yet. Go to "Send for Signature" to start.</td></tr>`;
      document.getElementById('docTabTrack').innerHTML = `
        <div style="font-family:'Anton',sans-serif;font-size:22px;margin-bottom:20px;">Sent Documents &amp; Signatures</div>
        <div style="background:var(--black-3);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th>Document</th><th>Recipient</th><th>Type</th><th>Sent</th><th>Status</th><th>Signed</th><th>Actions</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    function viewDocSignature(instanceId) {
      const inst = (getDB('document_instances') || []).find(i => i.id === instanceId);
      if (!inst || !inst.signatureData) { showToast('No signature on file', 'error'); return; }
      const sig = inst.signatureData;
      const img = document.getElementById('sigViewImg');
      img.style.filter = 'none';
      img.src = _sigSrc(sig.signatureDataUrl);
      _sigDetectInk(img);
      document.getElementById('sigViewMeta').innerHTML =
        `Signed by: <strong>${esc(sig.typedName || 'Unknown')}</strong><br>
         Email: ${esc(inst.recipientEmail)}<br>
         Signed: ${esc(_sigWhen(sig.signedAt))}<br>
         Document: ${esc(inst.templateName)}<br>
         Hash: <code style="font-size:12px;">${esc(inst.documentHash || 'N/A')}</code>`;
      openModal('sigViewModal');
    }

    async function resendDocInstance(instanceId) {
      const inst = (getDB('document_instances') || []).find(i => i.id === instanceId);
      if (!inst) return;
      const _rSubject = `Reminder: Signature needed — ${inst.templateName}`;
      const _rBody = `Hi ${inst.recipientName},\n\nThis is a reminder that the document "${inst.templateName}" is waiting for your signature.\n\nLog in here: ${window.location.origin}/portal-employee.html\n\nBaseline Studio`;
      const _rRes = await BSPortal.sendEmail('generic', {
        email: inst.recipientEmail, clientName: inst.recipientName,
        subject: _rSubject,
        body: _rBody
      });
      if (_rRes.ok) {
        showToast(`Reminder sent to ${inst.recipientName}`, 'success');
      } else {
        showToast(`Reminder to ${inst.recipientName} did not send: ${_rRes.error || 'unknown error'}`, 'error');
        showEmailFallback(inst.recipientEmail, _rSubject, _rBody, 'Could not send (' + (_rRes.error || 'unknown error') + '). Send it manually:');
      }
    }

    function deleteDocInstance(instanceId) {
      window.confirmCallback = () => {
        const updated = (getDB('document_instances') || []).filter(i => i.id !== instanceId);
        setDB('document_instances', updated);
        closeModal('confirmDialog');
        renderTrackTab();
        showToast('Deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete Document Record';
      document.getElementById('confirmMessage').textContent = 'Remove this sent document record? The signature data will be lost.';
      openModal('confirmDialog');
    }
