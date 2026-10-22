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
      showToast(shared ? 'Shared. The client can now see this document.' : 'Removed from client view', shared ? 'success' : 'info');
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
      return `<div class="evdoc-sig">
              ${src ? `<div class="evdoc-sig-img"><img src="${esc(src)}" alt="Client signature" onload="_sigDetectInk(this)" style="display:block;max-height:56px;max-width:200px;filter:invert(1);"></div>` : ''}
              <div class="evdoc-sig-meta">
                <div class="evdoc-sig-name">${esc(doc.clientSignedName || 'Client')}</div>
                ${when ? `<div class="evdoc-sig-when">Signed ${esc(when)}</div>` : ''}
                <div class="evdoc-sig-note">Signed electronically</div>
              </div>
            </div>`;
    }

    // Row menu for one event document (the kebab). Opens a CRMUI menu; each item calls the same global function the old buttons called.
    function openEventDocMenu(anchor, eventId, docId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      const doc = ev && ev.docs && ev.docs.find(d => d.id === docId);
      if (!doc) return;
      if (typeof CRMUI === 'undefined' || !CRMUI.menu) { showToast('Reload the page to use document actions.', 'warning'); return; }
      const signed = !!(doc.signedAt || _docClientSigned(doc));
      const items = [];
      items.push({ label: doc.sharedWithClient ? 'Stop sharing with client' : 'Share with client', icon: doc.sharedWithClient ? 'ban' : 'send', onSelect: () => toggleEventDocShare(eventId, docId, !doc.sharedWithClient) });
      if (!signed) items.push({ label: 'Edit', icon: 'pencil', onSelect: () => editEventDoc(eventId, docId) });
      if (!signed) items.push({ label: doc.requiresSignature ? 'Signature not required' : 'Require client signature', icon: 'file-signature', onSelect: () => toggleDocRequiresSignature(eventId, docId, !doc.requiresSignature) });
      items.push({ label: 'Remove document', icon: 'trash-2', danger: true, onSelect: () => deleteEventDoc(eventId, docId) });
      CRMUI.menu(anchor, items, { label: 'Document actions', align: 'right' });
    }

    // ── Contract text editor (review before sending, and Edit on an unsigned event document) ──
    // A contenteditable area with three tools: bold, bullet list, undo. Saved text always goes through _sanitizeDocHtml.
    function _ceEditorHtml(html) {
      const ic = n => (typeof CRMUI !== 'undefined' && CRMUI.icon) ? CRMUI.icon(n, 18) : '';
      let raw = String(html == null ? '' : html);
      if (raw && !/<[a-zA-Z][^>]*>/.test(raw)) raw = '<p>' + esc(raw).replace(/\n/g, '<br>') + '</p>';
      const safe = (typeof _sanitizeDocHtml === 'function') ? _sanitizeDocHtml(raw) : raw;
      return `<div class="ce-wrap">
        ${_aiBoxHtml()}
        <div class="ce-toolbar" role="toolbar" aria-label="Text tools">
          <button type="button" class="btn btn-secondary btn-icon" data-ce="bold" aria-label="Bold" title="Bold">${ic('bold')}</button>
          <button type="button" class="btn btn-secondary btn-icon" data-ce="insertUnorderedList" aria-label="Bullet list" title="Bullet list">${ic('list')}</button>
          <button type="button" class="btn btn-secondary btn-icon" data-ce="undo" aria-label="Undo" title="Undo">${ic('undo-2')}</button>
        </div>
        <div class="ce-area" id="ceArea" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Contract text" spellcheck="true">${safe}</div>
      </div>`;
    }
    function _ceWire(root, ev) {
      if (!root) return;
      try { _aiWire(root, ev); } catch (e) { console.warn('[contract assistant]', e); }
      root.querySelectorAll('[data-ce]').forEach(b => {
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => {
          const area = root.querySelector('#ceArea');
          if (area) area.focus();
          try { document.execCommand(b.getAttribute('data-ce'), false, null); } catch (e) {}
        });
      });
    }
    function _ceRead(root) {
      const area = root && root.querySelector('#ceArea');
      if (!area) return '';
      const raw = area.innerHTML;
      return (typeof _sanitizeDocHtml === 'function') ? _sanitizeDocHtml(raw) : raw;
    }
    function _ceHasText(html) { return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0; }

    // ── Contract assistant: optional AI suggestions in the contract editor ──
    // Hidden unless Settings has a Contract assistant link (settings.contractAiUrl). Nothing is sent until the user presses Suggest changes.
    // Every proposal is shown as a card. Accepted HTML goes through _sanitizeDocHtml before it is written into the editor.
    function _aiUrl() {
      const s = (typeof getDB === 'function' && getDB('settings')) || {};
      const u = String(s.contractAiUrl || '').trim();
      return (/^https:\/\/[^\s]+$/i.test(u) || /^http:\/\/localhost(:\d+)?(\/\S*)?$/i.test(u)) ? u : '';
    }
    function _aiMsg(kind) {
      switch (kind) {
        case 'limit': return 'The free AI limit for today is used up. Edit by hand or try again tomorrow.';
        case 'auth': return 'Sign in again to use suggestions.';
        case 'forbidden': return 'This login is not set up to use suggestions.';
        case 'network': return 'Could not reach the assistant. Check the link in Settings and your connection.';
        case 'empty': return 'Describe the change first.';
        case 'long': return 'Keep the description under 600 characters.';
        case 'big': return 'This contract is too long for the assistant. Edit it by hand.';
        case 'stale': return 'The text changed after the suggestions were made. Press Suggest changes again.';
        case 'none': return 'No change needed.';
        default: return 'The assistant could not answer. Try again, or edit by hand.';
      }
    }
    // Top-level blocks of the editor content as [{ i, html }]. Loose text and inline tags are wrapped in a paragraph.
    function _aiSplitBlocks(html) {
      const s = String(html == null ? '' : html);
      const INLINE = /^(a|abbr|b|bdi|bdo|br|cite|code|em|font|i|mark|q|s|small|span|strike|strong|sub|sup|u|wbr)$/i;
      const VOID = /^(br|hr|img|input|meta|link|wbr|col|area|base|embed|source|track)$/i;
      const blocks = [];
      const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
      let depth = 0, start = 0, loose = 0, m;
      const flush = (to) => {
        const t = s.slice(loose, to);
        if (t.replace(/&nbsp;|<br\s*\/?>|\s/gi, '')) blocks.push('<p>' + t.trim() + '</p>');
      };
      while ((m = re.exec(s))) {
        const closing = m[1] === '/', tag = m[2], selfClose = /\/>$/.test(m[0]);
        if (depth === 0) {
          if (closing || INLINE.test(tag)) continue;
          flush(m.index);
          if (VOID.test(tag) || selfClose) { blocks.push(m[0]); loose = re.lastIndex; continue; }
          start = m.index; depth = 1;
        } else if (!VOID.test(tag) && !selfClose) {
          depth += closing ? -1 : 1;
          if (depth === 0) { blocks.push(s.slice(start, re.lastIndex)); loose = re.lastIndex; }
        }
      }
      if (depth > 0) blocks.push(s.slice(start)); else flush(s.length);
      return blocks.map((h, i) => ({ i: i, html: h }));
    }
    // Compare editor text without caring about whitespace between tags.
    function _aiNorm(html) { return String(html == null ? '' : html).replace(/>\s+</g, '><').trim(); }
    // Proposed HTML: sanitized, and wrapped in a paragraph when it is plain text.
    function _aiCleanHtml(html) {
      let h = (typeof _sanitizeDocHtml === 'function') ? _sanitizeDocHtml(String(html == null ? '' : html)) : String(html || '');
      h = h.trim();
      if (h && !/^<(p|h[1-6]|ul|ol|div|table|blockquote|pre|hr)\b/i.test(h)) h = '<p>' + h + '</p>';
      return h;
    }
    // New blocks joined as editor HTML. blocks: [{ i, html }] from the split. accepted: [{ i, html }]. i is a number or "after:<n>".
    function _aiApply(blocks, accepted) {
      const rep = new Map(), after = new Map();
      (accepted || []).forEach(c => {
        const h = _aiCleanHtml(c.html);
        if (typeof c.i === 'number') rep.set(c.i, h);
        else {
          const n = Number(String(c.i).slice(6));
          if (!after.has(n)) after.set(n, []);
          if (h) after.get(n).push(h);
        }
      });
      const out = [];
      blocks.forEach(b => {
        if (rep.has(b.i)) { if (rep.get(b.i)) out.push(rep.get(b.i)); } else out.push(b.html);
        (after.get(b.i) || []).forEach(h => out.push(h));
      });
      return out.join('\n');
    }
    // Check the assistant reply again on this side. Returns { changes: [{ key, i, html, why, status }], notes }.
    function _aiParseReply(data, blocks) {
      const ids = new Set((blocks || []).map(b => b.i));
      const byId = new Map((blocks || []).map(b => [b.i, b.html]));
      const out = [];
      const seen = new Set();
      const list = data && Array.isArray(data.changes) ? data.changes : [];
      list.slice(0, 20).forEach(c => {
        if (!c || typeof c.html !== 'string') return;
        let id = c.i;
        if (typeof id === 'string' && /^\d+$/.test(id.trim())) id = Number(id);
        const m = typeof id === 'string' ? id.trim().match(/^after:(\d+)$/i) : null;
        if (m) id = 'after:' + Number(m[1]);
        if (typeof id === 'number') { if (!ids.has(id)) return; }
        else if (!(m && ids.has(Number(m[1])))) return;
        const html = _aiCleanHtml(c.html);
        if (typeof id === 'number' && _aiNorm(html) === _aiNorm(_aiCleanHtml(byId.get(id)))) return;
        if (typeof id !== 'number' && !html) return;
        const key = typeof id === 'number' ? 'r' + id : 'a' + id + ':' + html;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key: String(out.length), i: id, html: html, why: String(c.why == null ? '' : c.why).slice(0, 200), status: 'open' });
      });
      return { changes: out, notes: String(data && data.notes != null ? data.notes : '').slice(0, 300) };
    }
    function _aiEventInfo(ev) {
      const e = ev || {};
      const s = v => String(v == null ? '' : v).slice(0, 200);
      return { name: s(e.name), date: s(e.date), venue: s(e.venueName || e.venue), company: s(e.clientCompany || e.company),
        contact: s([e.clientName, e.clientEmail || e.portalEmail, e.clientPhone].filter(Boolean).join(', ')) };
    }
    // Returns a message when the request should not be sent, or ''.
    function _aiPrecheck(instruction, blocks) {
      const t = String(instruction || '').trim();
      if (!t) return _aiMsg('empty');
      if (t.length > 600) return _aiMsg('long');
      const chars = (blocks || []).reduce((n, b) => n + b.html.length, 0);
      if (!blocks || !blocks.length || blocks.length > 40 || chars > 30000) return _aiMsg('big');
      return '';
    }
    // Posts to the assistant link with the session token. Resolves to { ok: true, data } or { error, message }.
    async function _aiRequest(url, token, payload, fetchFn, signal) {
      if (!token) return { error: 'auth', message: _aiMsg('auth') };
      let r;
      try {
        r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(payload), signal: signal });
      } catch (e) { return { error: 'network', message: _aiMsg('network') }; }
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      const code = data && typeof data.error === 'string' ? data.error : '';
      if (r.status === 429 || code === 'limit') return { error: 'limit', message: _aiMsg('limit') };
      if (r.status === 401 || code === 'auth') return { error: 'auth', message: _aiMsg('auth') };
      if (r.status === 403 && code === 'forbidden') return { error: 'forbidden', message: _aiMsg('forbidden') };
      if (!r.ok) return { error: 'other', message: (r.status === 400 && /\s/.test(code)) ? code : _aiMsg('other') };
      if (!data || !Array.isArray(data.changes)) return { error: 'other', message: _aiMsg('other') };
      return { ok: true, data: data };
    }
    function _aiBoxHtml() {
      if (!_aiUrl()) return '';
      return `<section class="ce-ai" data-ce-ai aria-labelledby="ceAiL">
        <label class="field-label" id="ceAiL" for="ceAiText">Describe a change</label>
        <textarea class="input" id="ceAiText" data-ai-input rows="2" maxlength="600" placeholder="Example: the client provides a loading dock pass for load in"></textarea>
        <div class="ce-ai-row"><button type="button" class="btn btn-secondary" data-ai-go>Suggest changes</button><span class="field-hint">Nothing changes until you accept it.</span></div>
        <p class="ce-ai-status" data-ai-status role="status" aria-live="polite"></p>
        <div class="ce-ai-list" data-ai-list></div>
      </section>`;
    }
    function _aiCardsHtml(st) {
      if (!st || !st.changes.length) return '';
      const byId = new Map(st.blocks.map(b => [b.i, b.html]));
      const open = st.changes.filter(c => c.status === 'open').length;
      const head = open > 1 ? `<div class="ce-ai-all"><button type="button" class="btn btn-primary" data-ai-act="all">Accept all (${open})</button></div>` : '';
      const cards = st.changes.map(c => {
        const isNew = typeof c.i !== 'number';
        const n = (isNew ? Number(String(c.i).slice(6)) : c.i) + 1;
        const label = isNew ? 'New paragraph after paragraph ' + n : 'Paragraph ' + n;
        const before = isNew ? '' : `<div class="ce-ai-before" data-user-content>${_aiCleanHtml(byId.get(c.i)) || '<p>(empty)</p>'}</div>`;
        const after = `<div class="ce-ai-after" data-user-content>${c.html || '<p>(removed)</p>'}</div>`;
        const why = c.why ? `<p class="ce-ai-why" data-user-content>${esc(c.why)}</p>` : '';
        const acts = c.status === 'open'
          ? `<div class="ce-ai-acts"><button type="button" class="btn btn-primary" data-ai-act="accept" data-ai-key="${c.key}">Accept</button><button type="button" class="btn btn-secondary" data-ai-act="skip" data-ai-key="${c.key}">Skip</button></div>`
          : `<p class="ce-ai-state">${c.status === 'accepted' ? 'Accepted' : 'Skipped'}</p>`;
        return `<article class="ce-ai-card" data-status="${c.status}" aria-label="${label}"><h4 class="ce-ai-h">${label}</h4>${before}${after}${why}${acts}</article>`;
      }).join('');
      return head + cards;
    }
    function _aiWire(root, ev) {
      const box = root && root.querySelector('[data-ce-ai]');
      const area = root && root.querySelector('#ceArea');
      if (!box || !area) return;
      const input = box.querySelector('[data-ai-input]'), go = box.querySelector('[data-ai-go]');
      const status = box.querySelector('[data-ai-status]'), list = box.querySelector('[data-ai-list]');
      let st = null, busy = false;
      const say = (msg, kind) => { status.textContent = msg || ''; status.setAttribute('data-kind', kind || ''); };
      const now = () => _aiNorm(_sanitizeDocHtml(area.innerHTML));
      const render = () => { list.innerHTML = _aiCardsHtml(st); };
      const setBusy = on => {
        busy = on; go.disabled = on; go.textContent = on ? 'Working...' : 'Suggest changes';
        if (on) { go.setAttribute('aria-busy', 'true'); go.setAttribute('aria-disabled', 'true'); } else { go.removeAttribute('aria-busy'); go.removeAttribute('aria-disabled'); }
      };
      const accept = keys => {
        if (!st) return;
        if (now() !== st.lastHtml) { st = null; render(); say(_aiMsg('stale'), 'warn'); return; }
        st.changes.forEach(c => { if (c.status === 'open' && keys.includes(c.key)) c.status = 'accepted'; });
        area.innerHTML = _aiApply(st.blocks, st.changes.filter(c => c.status === 'accepted'));
        st.lastHtml = now();
        try { area.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        render();
        say(st.changes.some(c => c.status === 'open') ? '' : 'Done. Read the text once more before you send it.', 'ok');
      };
      list.addEventListener('click', e => {
        const b = e.target && e.target.closest ? e.target.closest('[data-ai-act]') : null;
        if (!b || !st) return;
        const act = b.getAttribute('data-ai-act'), key = b.getAttribute('data-ai-key');
        if (act === 'skip') { const c = st.changes.find(x => x.key === key); if (c) c.status = 'skipped'; render(); }
        else if (act === 'accept') accept([key]);
        else if (act === 'all') accept(st.changes.filter(c => c.status === 'open').map(c => c.key));
      });
      go.addEventListener('click', async () => {
        if (busy) return;
        const blocks = _aiSplitBlocks(_sanitizeDocHtml(area.innerHTML));
        const bad = _aiPrecheck(input.value, blocks);
        if (bad) { say(bad, 'warn'); return; }
        const url = _aiUrl();
        if (!url) { say(_aiMsg('other'), 'warn'); return; }
        const lastHtml = now();
        setBusy(true); say('Reading the contract...', '');
        st = null; render();
        const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
        const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 60000);
        let res;
        try { res = await _aiRequest(url, window._sbToken, { instruction: input.value.trim(), paragraphs: blocks, event: _aiEventInfo(ev) }, window.fetch.bind(window), ctl ? ctl.signal : undefined); }
        catch (e) { res = { error: 'other', message: _aiMsg('other') }; }
        clearTimeout(timer);
        setBusy(false);
        if (!res.ok) { say(res.message, 'error'); return; }
        const parsed = _aiParseReply(res.data, blocks);
        if (!parsed.changes.length) { say(parsed.notes || _aiMsg('none'), ''); return; }
        st = { blocks: blocks, changes: parsed.changes, lastHtml: lastHtml };
        say((parsed.changes.length === 1 ? '1 suggestion. ' : parsed.changes.length + ' suggestions. ') + (parsed.notes || ''), '');
        render();
      });
    }

    // Edit an unsigned event document. Signed documents are never editable.
    function editEventDoc(eventId, docId) {
      const ev = (getDB('events') || []).find(e => e.id === eventId);
      const doc = ev && ev.docs && ev.docs.find(d => d.id === docId);
      if (!doc) return;
      if (doc.signedAt || _docClientSigned(doc)) { showToast('A signed document cannot be edited.', 'warning'); return; }
      if (!(window.CRMUI && CRMUI.sheet)) { showToast('Reload the page to edit documents.', 'warning'); return; }
      const old = document.getElementById('docEditSheet');
      if (old) { try { CRMUI.close(old, { force: true }); } catch (e) {} if (old.parentNode) old.parentNode.removeChild(old); }
      const note = doc.sharedWithClient ? '<p class="ev-sheet-note" data-user-content>The client sees the updated version.</p>' : '';
      const dlg = CRMUI.sheet({
        id: 'docEditSheet', title: 'Edit ' + (doc.name || 'document'), className: 'ce-sheet',
        html: note + _ceEditorHtml(doc.contentHTML || doc.content || ''),
        secondary: { label: 'Cancel' },
        primary: { label: 'Save changes', onClick: function (d) {
          const events = getDB('events');
          const e2 = events.find(e => e.id === eventId);
          const d2 = e2 && e2.docs && e2.docs.find(x => x.id === docId);
          if (!d2) return false;
          if (d2.signedAt || _docClientSigned(d2)) { showToast('This document was signed, so it cannot be edited.', 'warning'); return false; }
          const clean = _ceRead(d);
          if (!_ceHasText(clean)) { showToast('The document cannot be empty.', 'warning'); return false; }
          d2.contentHTML = clean;
          if (typeof _evSyncClientDocs === 'function' && d2.sharedWithClient) _evSyncClientDocs(e2);
          setDB('events', events);
          window.currentEvent = e2;
          const tabDocs = document.getElementById('tabDocuments');
          if (tabDocs) tabDocs.innerHTML = renderEventDocuments(e2);
          showToast(d2.sharedWithClient ? 'Saved. The client sees the updated version.' : 'Saved.', 'success');
          return true;
        } }
      });
      _ceWire(dlg, ev);
      return dlg;
    }

    function renderEventDocuments(event) {
      const templates = getDB('templates');
      if (!event.docs) event.docs = [];
      const eid = event.id;
      const allInvoices = (getDB('invoices') || []).filter(i => i.eventId === eid);
      const allQuotes   = event.quotes || [];
      const ic = (n, s) => (typeof CRMUI !== 'undefined' && CRMUI.icon) ? CRMUI.icon(n, s || 16) : '';
      const dShort = ts => { const d = new Date(ts); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
      const money = n => (typeof CRMUI !== 'undefined' && CRMUI.fmt) ? CRMUI.fmt.money(n || 0) : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const secHead = (icon, label) => `<h4 class="evdoc-sec-head">${ic(icon, 16)}<span>${label}</span></h4>`;

      // ── INVOICES ──────────────────────────────────────────────────
      let invoiceHtml = '';
      if (allInvoices.length) {
        invoiceHtml = `<section class="evdoc-sec">${secHead('credit-card', 'Invoices')}`;
        allInvoices.forEach(inv => {
          const isPaid = inv.status === 'paid';
          const statusLabel = String(inv.status || 'pending').replace(/^./, c => c.toUpperCase());
          invoiceHtml += `<div class="evdoc-row">
            <div class="evdoc-main">
              <div class="evdoc-title"><span class="evdoc-name">${esc(inv.invoiceNum || 'Invoice')}</span><span class="pill ${isPaid ? 'pill-ok' : 'pill-warn'}" data-ui="pill">${esc(statusLabel)}</span></div>
              <div class="evdoc-meta">${esc(inv.clientName || '')}${inv.clientName ? ' &middot; ' : ''}${money(inv.total)}</div>
            </div>
            <div class="evdoc-actions">
              <button type="button" class="btn btn-secondary btn-sm" onclick="exportInvoicePDF('${inv.id}')">${ic('download', 16)} PDF</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="sendInvoice('${inv.id}')">${ic('mail', 16)} Send</button>
            </div>
          </div>`;
        });
        invoiceHtml += `</section>`;
      }

      // ── QUOTES ────────────────────────────────────────────────────
      let quotesHtml = '';
      if (allQuotes.length) {
        quotesHtml = `<section class="evdoc-sec">${secHead('file-text', 'Saved quotes')}`;
        allQuotes.forEach(q => {
          const sentBadge = q.sentAt
            ? `<span class="pill pill-info" data-ui="pill">Sent ${dShort(q.sentAt)}</span>`
            : `<span class="pill pill-neutral" data-ui="pill">Draft</span>`;
          quotesHtml += `<div class="evdoc-row">
            <div class="evdoc-main">
              <div class="evdoc-title"><span class="evdoc-name">Quote for ${esc(q.clientName || event.clientName || 'Client')}</span>${sentBadge}</div>
              <div class="evdoc-meta">${money(q.total)} &middot; ${dShort(q.createdAt)}</div>
            </div>
            <div class="evdoc-actions">
              <button type="button" class="btn btn-secondary btn-sm" onclick="exportSavedQuotePDF('${q.id}','${eid}')">${ic('download', 16)} PDF</button>
            </div>
          </div>`;
        });
        quotesHtml += `</section>`;
      }

      // ── CONTRACTS ─────────────────────────────────────────────────
      let docListHtml = '';
      if (event.docs.length) {
        docListHtml = `<section class="evdoc-sec">${secHead('file-signature', 'Contracts and agreements')}`;
        event.docs.forEach(doc => {
          const clientSigned = _docClientSigned(doc);
          const isSigned = !!(doc.signedAt || clientSigned);
          const signedOn = doc.signedAt || doc.clientSignedAt;
          const signedBadge = isSigned
            ? `<span class="pill pill-ok" data-ui="pill">SIGNED${dShort(signedOn) ? ' ' + dShort(signedOn) : ''}</span>`
            : `<span class="pill pill-warn" data-ui="pill">UNSIGNED</span>`;
          const clientShared = doc.sharedWithClient;
          const requiresSig  = doc.requiresSignature;
          // Four-dot stepper: Draft, Shared, Viewed (only when the client's first view is recorded), Signed.
          const steps = [['Draft', true], ['Shared', !!clientShared]];
          if (doc.clientViewedAt) steps.push(['Viewed', true]);
          steps.push(['Signed', isSigned]);
          const curIdx = steps.findIndex(s => !s[1]);
          const stepsHtml = steps.map((s, i) => `<li class="${s[1] ? 'is-done' : (i === curIdx ? 'is-current' : '')}"><span class="evdoc-dot" aria-hidden="true"></span>${s[0]}</li>`).join('');
          const stateWord = (steps.filter(s => s[1]).pop() || steps[0])[0];
          docListHtml += `
          <div class="evdoc-row evdoc-row-doc${clientShared ? ' is-shared' : ''}">
            <div class="evdoc-main">
              <div class="evdoc-title"><span class="evdoc-name">${esc(doc.name)}</span>${signedBadge}</div>
              <div class="evdoc-meta">Created ${dShort(doc.createdAt)}${requiresSig && !isSigned ? ' &middot; <span class="pill pill-info pill-sm" data-ui="pill">Signature required</span>' : ''}</div>
              <ol class="evdoc-steps" aria-label="Status: ${stateWord}">${stepsHtml}</ol>
            </div>
            <div class="evdoc-actions">
              ${doc.contentHTML ? `<button type="button" class="btn btn-secondary btn-sm" onclick="viewEventDoc('${eid}','${doc.id}')">View</button>` : ''}
              ${doc.contentHTML && isSigned ? `<button type="button" class="btn btn-secondary btn-sm" onclick="downloadEventDoc('${eid}','${doc.id}')">Download</button>` : ''}
              ${!isSigned ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openSignatureModal('${eid}','${doc.id}')">Sign</button>` : `<button type="button" class="btn btn-secondary btn-sm" onclick="viewEventDocSignature('${eid}','${doc.id}')">View Sig</button>`}
              ${clientSigned && !doc.signedAt ? `<button type="button" class="btn btn-primary btn-sm" onclick="openSignatureModal('${eid}','${doc.id}')">Countersign</button>` : ''}
              <button type="button" class="btn btn-ghost btn-icon btn-sm evdoc-kebab" aria-label="More actions for ${esc(doc.name)}" aria-haspopup="menu" onclick="openEventDocMenu(this,'${eid}','${doc.id}')">${ic('ellipsis', 20)}</button>
            </div>
            ${_clientSigBlock(doc)}
          </div>`;
        });
        docListHtml += `</section>`;
      }

      const isEmpty = !allInvoices.length && !allQuotes.length && !event.docs.length;
      const _pick = (typeof BSContracts !== 'undefined') ? BSContracts.pickTemplate(event, templates) : { template: null, kind: 'generic', typeUnknown: false };
      const templateOptions = templates.map(t => `<option value="${esc(t.id)}"${_pick.template && _pick.template.id === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
      const _pickHint = !_pick.template ? ''
        : _pick.typeUnknown ? 'This event has no recognized type, so the generic agreement is selected. Set the event type to get the matching one.'
        : 'Selected for this event: ' + esc(_pick.template.name) + '. Pick another from the list if you need a different one.';

      return `
        <div class="evdoc">
        ${isEmpty ? `<div class="empty evdoc-empty">${ic('file-text', 32)}<p class="empty-title">No documents yet</p><p class="empty-text">Invoices, quotes and contracts show up here as you create them.</p></div>` : ''}
        ${invoiceHtml}${quotesHtml}${docListHtml}
        <section class="card evdoc-create">
          <h4 class="evdoc-sec-head"><span>Create from template</span></h4>
          <div class="field">
            <label class="field-label" for="evtDocTemplate_${eid}">Template</label>
            <div class="evdoc-create-line">
              <select class="form-select" id="evtDocTemplate_${eid}"><option value="">From template…</option>${templateOptions}</select>
              <button type="button" class="btn btn-secondary" onclick="createEventDocFromTemplate('${eid}')">${ic('plus', 16)} Create</button>
            </div>
            ${_pickHint ? `<div class="field-hint">${_pickHint}</div>` : ''}
          </div>
          <div class="field">
            <label class="field-label" for="evtDocBlankName_${eid}">Blank document</label>
            <div class="evdoc-create-line">
              <input type="text" class="form-input" id="evtDocBlankName_${eid}" placeholder="Document name">
              <button type="button" class="btn btn-secondary" onclick="createBlankEventDoc('${eid}')">${ic('plus', 16)} Add blank</button>
            </div>
          </div>
        </section>
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
.bar button{font:inherit;font-weight:600;min-height:44px;padding:8px 18px;border:0;border-radius:6px;background:#1fa3e0;color:#04121a;cursor:pointer}
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
      let body = _sanitizeDocHtml(doc.contentHTML || doc.content || '') || '<p>(Empty document)</p>';
      // A signed document carries the real signature block below, so the template's blank signature lines are dropped.
      if (sigs.length) body = body.replace(/<table\b[\s\S]*?<\/table>/gi, t => (/signature/i.test(t) && /(?:Date|Printed Name):\s*_{3,}/i.test(t)) ? '' : t);
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
      document.getElementById('sigViewMeta').textContent = sigs.map(x => 'Signed' + (x.at ? ' ' + _sigWhen(x.at) : '') + ' by ' + x.name).join('. ');
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
      showToast('Document signed and saved.', 'success');

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

        showToast('Contract signed. Creating the client portal.', 'info');

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
        title: 'Cold Spark Towers: Safety & Liability Addendum',
        content: `<p>This addendum governs the use of Cold Spark Towers ("pyrotechnic-style cold spark devices") at the Event.</p>
<p><strong>1. Venue Approval.</strong> Client is solely responsible for obtaining written venue approval for cold spark effects prior to the event date. If approval is not obtained, Baseline Studio reserves the right to omit this effect without issuing a refund for its line item.</p>
<p><strong>2. Safety Clearance.</strong> Cold spark towers require a minimum clearance of 6 feet on all sides and 12 feet of vertical clearance. Client and venue are responsible for ensuring these conditions are met.</p>
<p><strong>3. Fire Safety.</strong> A fire extinguisher must be accessible within 15 feet of each device during operation. Baseline Studio is not responsible for venue compliance with local fire codes.</p>
<p><strong>4. Liability.</strong> Client assumes all liability for any injury or property damage resulting from failure to maintain required clearances or from unauthorized guest contact with operating devices.</p>` },
      { keywords: ['co₂ jets', 'co2 jets', 'co₂ jet', 'co2 jet'],
        title: 'CO₂ Jets: Safety & Operations Addendum',
        content: `<p>This addendum governs the use of CO₂ Jets at the Event.</p>
<p><strong>1. Indoor Use.</strong> CO₂ jet effects require adequate venue ventilation. Use in sealed or poorly ventilated spaces may be restricted or prohibited at Baseline Studio's discretion.</p>
<p><strong>2. Safe Zone.</strong> A minimum 8-foot guest-free safety perimeter must be maintained around active CO₂ jet devices during operation. Venue and Client are jointly responsible for crowd management in this zone.</p>
<p><strong>3. Supply.</strong> CO₂ canisters are provided for the contracted duration only. Additional activations beyond the quoted scope may not be available on-site.</p>
<p><strong>4. Liability.</strong> Client assumes responsibility for ensuring no guests approach active equipment during operation. Baseline Studio is not liable for injury resulting from unauthorized contact with CO₂ jet devices.</p>` },
      { keywords: ['co₂ cannon', 'co2 cannon', 'co₂ cannons', 'co2 cannons'],
        title: 'CO₂ Cannons: Safety & Operations Addendum',
        content: `<p>This addendum governs the use of CO₂ Cannons ("handheld or mounted cryo cannons") at the Event.</p>
<p><strong>1. Operator Control.</strong> CO₂ cannons are operated exclusively by Baseline Studio personnel. No guest or venue staff shall operate the equipment under any circumstance.</p>
<p><strong>2. Direction of Effect.</strong> CO₂ cannon blasts shall not be directed at any individual's face at close range. A minimum stand-off distance of 4 feet is required for any directed guest interaction.</p>
<p><strong>3. Venue Consent.</strong> Client is responsible for confirming venue consent to CO₂ cannon use. Condensation and CO₂ gas may affect certain surfaces and HVAC systems.</p>
<p><strong>4. Liability.</strong> Baseline Studio is not liable for injury or property damage caused by guests attempting to operate or interfere with CO₂ cannon equipment.</p>` },
      { keywords: ['dancing on cloud', 'dancing on clouds'],
        title: 'Dancing on Clouds / Low-Lying Fog: Safety Addendum',
        content: `<p>This addendum governs the use of the Dancing on Clouds low-lying fog effect at the Event.</p>
<p><strong>1. Effect Description.</strong> The Dancing on Clouds effect uses a low-lying fog machine to create a ground-level cloud layer, typically for the first dance or a designated ceremony moment.</p>
<p><strong>2. Slip Hazard.</strong> Low-lying fog may reduce visibility of the floor surface. Client and venue are responsible for ensuring the dance floor is dry and free of trip hazards prior to activation.</p>
<p><strong>3. Duration.</strong> The effect is designed for a single designated moment (typically 3–5 minutes per activation). Extended continuous use is not included unless separately quoted.</p>
<p><strong>4. Ventilation.</strong> Adequate venue ventilation is required. Baseline Studio reserves the right to halt the effect if CO₂ levels or visibility impairment present a safety concern.</p>` },
      { keywords: ['led video wall', 'video wall'],
        title: 'LED Video Wall: Setup & Power Requirements Addendum',
        content: `<p>This addendum governs the installation and operation of an LED Video Wall at the Event.</p>
<p><strong>1. Power Requirements.</strong> The LED Video Wall requires dedicated 20-amp circuits. Client is responsible for confirming power availability with the venue prior to the event date.</p>
<p><strong>2. Setup Time.</strong> Installation requires a minimum of 2 hours of unobstructed venue access before guest arrival. Any reduction of this window due to venue scheduling is not the liability of Baseline Studio.</p>
<p><strong>3. Content.</strong> Standard motion background content is included. Custom graphics, logos, or video must be delivered to Baseline Studio no later than 72 hours before the event date.</p>
<p><strong>4. Structural Safety.</strong> The LED Video Wall will be ground-supported or rigged per the venue's approved plan. No modification to the panel arrangement shall be made without written consent from Baseline Studio.</p>` },
      { keywords: ['fog', 'haze', 'fog / haze', 'fog/haze'],
        title: 'Fog / Haze Machine: Operations Addendum',
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
        <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.1em;color:#111;margin-bottom:24px;font-family:Arial,sans-serif;">Addenda: Service-Specific Terms</h2>`;
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
      const rawHtml = (typeof _sanitizeDocHtml === 'function') ? _sanitizeDocHtml(editor.innerHTML) : editor.innerHTML;
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
        ? `<div style="background:#fffbe6;border:1px solid #c9a227;color:#6b4f00;padding:8px 16px;font-size:13px;border-radius:4px;margin-bottom:20px;">Filled with data from event: <strong>${esc(ev.name)}</strong>, ${esc(ev.clientName)}</div>`
        : `<div style="background:#f5f5f5;border:1px solid #bbb;color:#555;padding:8px 16px;font-size:13px;border-radius:4px;margin-bottom:20px;">No event context. Open a document from inside an event for real data. Showing placeholder labels.</div>`;

      const w = window.open('', '_blank', 'width=920,height=800,menubar=yes');
      if (!w) { showToast('Allow pop-ups to preview documents', 'warning'); return; }
      w.document.write(`<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <title>Preview: ${esc(templateName)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { background: #eceae6; color: #111; }
          body { font-family: Georgia, 'Times New Roman', serif; }
          .page-wrap { padding: 40px 20px; max-width: 820px; margin: 0 auto; }
          .doc-header { text-align:center; border-bottom: 3px solid #0b5f87; padding-bottom:20px; margin-bottom:28px; }
          .doc-header .brand { font-size:22px; font-weight:900; letter-spacing:.08em; color:#0b5f87; font-family:Arial,sans-serif; }
          .doc-header .tagline { font-size:12px; color:#555; margin-top:4px; font-family:Arial,sans-serif; letter-spacing:.05em; }
          .doc-page { background:#fff; padding:72px 80px 100px; box-shadow:0 4px 40px rgba(0,0,0,.12); min-height:1000px; }
          .doc-page h1 { font-size:2em; margin:0 0 .5em; }
          .doc-page h2 { font-size:1.5em; margin:1em 0 .4em; }
          .doc-page h3 { font-size:1.2em; margin:1em 0 .3em; }
          .doc-page p  { margin-bottom:.9em; line-height:1.7; }
          .doc-page ul, .doc-page ol { margin:0 0 .9em 1.5em; line-height:1.7; }
          .doc-footer { text-align:center; font-size:12px; color:#555; font-family:Arial,sans-serif; border-top:1px solid #eee; padding-top:18px; margin-top:32px; }
          .print-bar { background:#111118; color:#fff; padding:12px 24px; display:flex; align-items:center; justify-content:space-between; font-family:Arial,sans-serif; font-size:13px; }
          .print-bar button { background:#1FA3E0; color:#07070d; border:none; padding:7px 18px; border-radius:5px; cursor:pointer; font-weight:600; font-size:13px; }
          @media print { .print-bar { display:none!important; } }
        </style>
      </head><body>
        <div class="print-bar">
          <span>Preview: <strong>${esc(templateName)}</strong></span>
          <button type="button" onclick="window.print()">Print or save PDF</button>
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
        { id: genId(), name: 'DJ / Performer: Independent Contractor Agreement', category: 'employee', contentHTML: `<h1>Independent Contractor Agreement</h1><p>This agreement is entered into as of <strong>{{current_date}}</strong>, between <strong>Baseline Studio</strong> ("Company") and <strong>_______________________</strong> ("Contractor").</p><h2>1. Services</h2><p>Contractor agrees to provide DJ/Performer services at events as assigned by Baseline Studio, including DJing, MCing, equipment operation, and professional client interaction.</p><h2>2. Independent Contractor Status</h2><p>Contractor is an independent contractor, not an employee. Contractor is responsible for their own taxes, insurance, and expenses unless otherwise agreed in writing.</p><h2>3. Compensation</h2><p>Per-event rate: $____________<br>Payment method: ___________________________<br>Payment timing: Within 5 business days of completed event.</p><h2>4. Equipment</h2><p>Baseline Studio will provide equipment as specified per event. Contractor is responsible for any damage caused by negligence or misuse.</p><h2>5. Confidentiality</h2><p>Contractor agrees not to disclose client information, pricing, or any proprietary business information of Baseline Studio to any third party.</p><h2>6. Cancellation Policy</h2><p>If Contractor cannot perform an assigned event, they must notify Baseline Studio at least 72 hours in advance. Failure to provide adequate notice without a documented emergency may result in forfeiture of that event's compensation.</p><h2>7. Term</h2><p>This agreement is in effect on a per-event basis until terminated in writing by either party.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;padding-right:20px;vertical-align:top;"><p><strong>Contractor Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;padding-left:20px;vertical-align:top;"><p><strong>Baseline Studio</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Authorized Signature<br>Date: ______________</p></td></tr></table>` },
        { id: genId(), name: 'Non-Disclosure Agreement (NDA)', category: 'employee', contentHTML: `<h1>Non-Disclosure Agreement</h1><p>This NDA is entered into as of <strong>{{current_date}}</strong>, between <strong>Baseline Studio</strong> ("Company") and <strong>_______________________</strong> ("Recipient").</p><h2>1. Confidential Information</h2><p>"Confidential Information" includes all business information, client data, event details, pricing, and proprietary processes of Baseline Studio not publicly available.</p><h2>2. Obligations</h2><p>Recipient agrees to: (a) keep all Confidential Information strictly confidential; (b) not disclose to any third party without written consent; (c) use it only in connection with services provided to Baseline Studio.</p><h2>3. Duration</h2><p>These obligations remain in effect for 2 years from the date of this agreement, and indefinitely with respect to client personal data.</p><h2>4. Agreement</h2><p>Both parties confirm they have read and agree to these terms.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;padding-right:20px;vertical-align:top;"><p><strong>Recipient Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;padding-left:20px;vertical-align:top;"><p><strong>Baseline Studio</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Date: ______________</p></td></tr></table>` },
        { id: genId(), name: 'Equipment Use Policy: Acknowledgment', category: 'employee', contentHTML: `<h1>Equipment Use Policy: Acknowledgment</h1><p>Date: <strong>{{current_date}}</strong></p><p>By signing below, <strong>_______________________</strong> acknowledges receipt and understanding of Baseline Studio's Equipment Use Policy.</p><h2>Policy Summary</h2><ol><li><strong>Care:</strong> All equipment must be handled carefully and transported in provided cases.</li><li><strong>Setup/Teardown:</strong> Follow Baseline Studio's setup and breakdown procedures at every event.</li><li><strong>Damage Reporting:</strong> Any damage, loss, or theft must be reported immediately. Damage from negligence may be charged to the responsible party.</li><li><strong>No Modifications:</strong> No modifications to equipment without written authorization.</li><li><strong>Return:</strong> All equipment returned within 24 hours of the event, in the condition received.</li></ol><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;vertical-align:top;"><p><strong>Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;"></td></tr></table>` },
        { id: genId(), name: 'Code of Conduct Agreement', category: 'employee', contentHTML: `<h1>Code of Conduct Agreement</h1><p>Date: <strong>{{current_date}}</strong></p><p>All Baseline Studio representatives are expected to maintain the highest standards of professionalism. By signing, <strong>_______________________</strong> agrees to the following:</p><ol><li><strong>Appearance:</strong> Arrive professionally dressed per management's guidelines for each event.</li><li><strong>Punctuality:</strong> Arrive at least 90 minutes before event start for setup, or as directed.</li><li><strong>Client Interaction:</strong> Be courteous and professional with all clients and guests at all times.</li><li><strong>No Substances:</strong> No alcohol or impairing substances before or during events while on duty.</li><li><strong>Social Media:</strong> Do not post content from events without explicit written permission from Baseline Studio and the client.</li><li><strong>Confidentiality:</strong> Client names, event details, and pricing are confidential and not to be shared externally.</li></ol><p>Violations may result in removal from an event and/or termination of the working relationship.</p><br><table style="width:100%;border-collapse:collapse;"><tr><td style="width:50%;vertical-align:top;"><p><strong>Signature</strong></p><div style="border-bottom:2px solid #333;height:50px;margin-bottom:8px;"></div><p style="font-size:12px;">Printed Name: ______________________________<br>Date: ______________</p></td><td style="width:50%;"></td></tr></table>` },
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
      if (isDJ) { document.getElementById('docTabSend').innerHTML = '<div class="empty"><p class="empty-title">Send access is not available for your role</p></div>'; return; }

      const tOpts = templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.category === 'employee' ? ' [Employee]' : ' [Client]'}</option>`).join('');
      const evOpts = events.map(e => `<option value="${esc(e.id)}">${esc(e.clientName || 'Client')} &middot; ${esc(e.name || e.type || '')} (${esc(e.date || '')})</option>`).join('') || '<option value="">No client events with email on file</option>';
      const empOpts = accounts.map(a => `<option value="${encodeURIComponent(a.email)}|${encodeURIComponent(a.name)}|${encodeURIComponent(a.role || '')}">${esc(a.name)} (${esc(a.role || 'staff')}), ${esc(a.email)}</option>`).join('') || '<option value="">No team accounts</option>';

      document.getElementById('docTabSend').innerHTML = `
        <div class="docsend">
          <h3 class="docsend-title">Send a document for signature</h3>
          <p class="docsend-sub">Pick a template, choose who receives it, and send. They sign from their portal.</p>
          <div class="docsend-grid">
            <div class="docsend-form">
              <section class="docsend-chunk">
                <h4 class="evdoc-sec-head"><span>What</span></h4>
                <div class="field">
                  <label class="form-label" for="sendDocTemplate">Document template</label>
                  <select class="form-select" id="sendDocTemplate" onchange="previewSendDoc()">
                    <option value="">Select a template</option>${tOpts}
                  </select>
                </div>
              </section>
              <section class="docsend-chunk">
                <h4 class="evdoc-sec-head"><span>Who</span></h4>
                <div class="docsend-radios" role="radiogroup" aria-label="Send to">
                  <label class="check check-radio"><input type="radio" name="sendDocTarget" value="client" checked onchange="toggleSendDocRecipient()"><span class="check-box"></span><span class="check-text">Client</span></label>
                  <label class="check check-radio"><input type="radio" name="sendDocTarget" value="employee" onchange="toggleSendDocRecipient()"><span class="check-box"></span><span class="check-text">Employee or team</span></label>
                </div>
                <div class="field" id="sendDocClientWrap">
                  <label class="form-label" for="sendDocClientEvent">Client event</label>
                  <select class="form-select" id="sendDocClientEvent">${evOpts}</select>
                </div>
                <div class="field" id="sendDocEmployeeWrap" style="display:none;">
                  <label class="form-label" for="sendDocEmployee">Team member</label>
                  <select class="form-select" id="sendDocEmployee">${empOpts}</select>
                </div>
              </section>
              <section class="docsend-chunk">
                <h4 class="evdoc-sec-head"><span>Message</span></h4>
                <div class="field">
                  <label class="form-label" for="sendDocMessage">Note to recipient (optional)</label>
                  <textarea class="form-textarea" id="sendDocMessage" rows="3" placeholder="Add a short note"></textarea>
                </div>
              </section>
              <button type="button" class="btn btn-primary docsend-send" onclick="sendDocumentForSignature()">Send for signature</button>
            </div>
            <div class="docsend-side">
              <h4 class="evdoc-sec-head"><span>Preview</span></h4>
              <div id="sendDocPreviewWrap" class="docsend-preview">
                <div class="docsend-preview-empty">Select a template to preview</div>
              </div>
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
      if (!t) { wrap.innerHTML = '<div class="docsend-preview-empty">Select a template to preview</div>'; return; }
      const raw = t.contentHTML || t.content || '';
      const safe = (raw && typeof _sanitizeDocHtml === 'function') ? _sanitizeDocHtml(raw) : raw;
      wrap.innerHTML = `<div class="docsend-paper">${safe || '(empty)'}</div>`;
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
      const ic = (n, s) => (typeof CRMUI !== 'undefined' && CRMUI.icon) ? CRMUI.icon(n, s || 16) : '';
      const dShort = ts => { const d = new Date(ts); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
      // Status stepper: Sent, Viewed, Signed. A declined document shows a danger pill instead.
      const stepper = inst => {
        if (inst.status === 'declined') return '<span class="pill pill-danger" data-ui="pill">Declined</span>';
        const viewed = inst.status === 'viewed' || inst.status === 'signed';
        const signed = inst.status === 'signed';
        const steps = [['Sent', true], ['Viewed', viewed], ['Signed', signed]];
        const cur = steps.findIndex(s => !s[1]);
        const word = (steps.filter(s => s[1]).pop() || steps[0])[0];
        return `<ol class="evdoc-steps" aria-label="Status: ${word}">${steps.map((s, i) => `<li class="${s[1] ? 'is-done' : (i === cur ? 'is-current' : '')}"><span class="evdoc-dot" aria-hidden="true"></span>${s[0]}</li>`).join('')}</ol>`;
      };
      const kind = inst => esc(inst.recipientType === 'client' ? 'Client' : (inst.recipientRole || 'Employee'));
      const resend = inst => (inst.status === 'signed' || inst.status === 'declined') ? '' : `<button type="button" class="btn btn-secondary btn-sm" onclick="resendDocInstance('${inst.id}')">Resend</button>`;
      const kebab = inst => resend(inst) + `<button type="button" class="btn btn-ghost btn-icon btn-sm evdoc-kebab" aria-label="More actions for ${esc(inst.templateName)}" aria-haspopup="menu" onclick="openTrackRowMenu(this,'${inst.id}')">${ic('ellipsis', 20)}</button>`;
      const tableHtml = list => `<table class="tbl track-tbl">
        <thead><tr><th>Document</th><th>Recipient</th><th>Type</th><th>Sent</th><th>Status</th><th>Signed</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.map(inst => `<tr>
          <td class="track-doc">${esc(inst.templateName)}</td>
          <td>${esc(inst.recipientName)}<div class="t-meta">${esc(inst.recipientEmail)}</div></td>
          <td><span class="pill pill-neutral pill-sm" data-ui="pill">${kind(inst)}</span></td>
          <td class="num">${dShort(inst.sentAt)}</td>
          <td>${stepper(inst)}</td>
          <td class="num">${inst.signedAt ? dShort(inst.signedAt) : '-'}</td>
          <td class="track-act">${kebab(inst)}</td>
        </tr>`).join('')}</tbody></table>`;
      const cardHtml = inst => `<div class="row track-card">
          <div class="row-main">
            <div class="row-title">${esc(inst.templateName)}</div>
            <div class="row-sub">${esc(inst.recipientName)} &middot; ${kind(inst)} &middot; Sent ${dShort(inst.sentAt)}</div>
            ${stepper(inst)}
          </div>
          <div class="row-trail">${kebab(inst)}</div>
        </div>`;
      let body;
      if (!instances.length) {
        body = `<div class="empty">${ic('send', 32)}<p class="empty-title">Nothing sent yet</p><p class="empty-text">Documents you send for signature show up here with their status.</p><button type="button" class="btn btn-secondary" onclick="switchDocTab('send')">Send a document</button></div>`;
      } else if (typeof CRMUI !== 'undefined' && CRMUI.renderList) {
        body = CRMUI.renderList(instances, { table: tableHtml, card: cardHtml });
      } else {
        body = `<div class="tbl-wrap">${tableHtml(instances)}</div>`;
      }
      document.getElementById('docTabTrack').innerHTML = `
        <div class="docsend">
          <h3 class="docsend-title">Sent and tracking</h3>
          ${body}
        </div>`;
    }

    // Row menu for one sent document (the kebab on Sent and tracking).
    function openTrackRowMenu(anchor, instanceId) {
      const inst = (getDB('document_instances') || []).find(i => i.id === instanceId);
      if (!inst) return;
      if (typeof CRMUI === 'undefined' || !CRMUI.menu) { showToast('Reload the page to use document actions.', 'warning'); return; }
      const items = [];
      if (inst.status === 'signed') items.push({ label: 'View signature', icon: 'eye', onSelect: () => viewDocSignature(instanceId) });
      else items.push({ label: 'Resend reminder', icon: 'send', onSelect: () => resendDocInstance(instanceId) });
      items.push({ label: 'Delete record', icon: 'trash-2', danger: true, onSelect: () => deleteDocInstance(instanceId) });
      CRMUI.menu(anchor, items, { label: 'Sent document actions', align: 'right' });
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
      const _rSubject = `Reminder: signature needed for ${inst.templateName}`;
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
      confirmDestructive('Delete document record', 'Remove this sent document record? The signature data will be lost.', function() {
        const updated = (getDB('document_instances') || []).filter(i => i.id !== instanceId);
        setDB('document_instances', updated);
        renderTrackTab();
        showToast('Deleted', 'success');
      }, 'Delete');
    }
