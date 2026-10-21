// ============================================================================
// portal-provider/75-marketing.js  -  marketing: campaigns
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    //
    //  MARKETING / CAMPAIGNS
    //
    // Marketing section shell. Written once; renderMarketing fills #campaignsList.
    function _mktShell() {
      const sec = document.getElementById('marketing');
      if (!sec || sec.getAttribute('data-p7') === '1') return;
      sec.setAttribute('data-p7', '1');
      sec.innerHTML = `
        <div class="mk-wrap">
          <div id="campaignsList" class="mk-list"></div>
          <section class="mk-import" aria-labelledby="mkImportH">
            <h3 class="mk-h" id="mkImportH">WeddingWire and The Knot import</h3>
            <p class="t-meta" style="margin-bottom:var(--sp-3);">Paste the lead notification email below and press Import to add the lead to your Pipeline.</p>
            <div class="field">
              <label class="field-label" for="knotiImportText">Lead notification text</label>
              <textarea class="form-textarea import-paste-area" id="knotiImportText" rows="5" placeholder="Paste the lead notification here"></textarea>
            </div>
            <button type="button" class="btn btn-secondary" onclick="importKnotLead()">Import lead</button>
          </section>
        </div>`;
    }

    // CAN-SPAM: no campaign goes out without the business mailing address, and every email ends with it plus an opt-out line.
    function _mktBiz() { const st = getDB('settings') || {}; return Object.assign({ name: '', address: '' }, st.business || {}); }
    function _mktBlocked() { return !String(_mktBiz().address || '').trim(); }
    function _mktFooter() {
      const b = _mktBiz();
      return '\n\n--\n' + (String(b.name || '').trim() ? String(b.name).trim() + '\n' : '') + String(b.address || '').trim() + '\nTo stop getting these emails, reply with the word UNSUBSCRIBE and we will remove you.';
    }
    function _mktOpenBusiness() {
      _p7CloseSheet('campaignSheet');
      switchSection('settings');
      if (typeof settingsGo === 'function') settingsGo('business');
    }

    function _mktAudienceLabel(a) {
      return { all: 'All clients', leads: 'Leads only', booked: 'Booked events', completed: 'Past clients', weddings: 'Wedding clients', corporate: 'Corporate clients' }[a] || String(a || '');
    }

    // How many people an audience reaches right now (pure; same rules as sending).
    function _mktAudienceCount(audience) {
      try {
        const found = _campaignRecipientsFrom({ clients: getDB('clients') || [], events: getDB('events') || [], inquiries: audience === 'leads' ? (window._inquiries || []) : [] }, audience);
        return found.list.length;
      } catch (e) { return null; }
    }

    function renderMarketing() {
      if (!getDB('campaigns') || getDB('campaigns').length === 0) setDB('campaigns', []);
      const campaigns = getDB('campaigns');
      const blocked = typeof _mktBlocked === 'function' && _mktBlocked();
      if (typeof _mktShell === 'function') _mktShell();

      let html = '';
      if (!campaigns.length) {
        html = '<div class="empty"><h3 class="empty-title">No campaigns yet</h3><p class="empty-text">Write one email, pick who gets it, and send it when you are ready.</p></div>';
      } else {
        campaigns.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(c => {
          // Campaigns marked "sent" before sending was real have no sentCount: nothing was ever emailed for them.
          const legacySent = c.status === 'sent' && c.sentCount === undefined;
          const statusClass = legacySent ? 'pill-warn' : c.status === 'sent' ? 'pill-ok' : c.status === 'scheduled' ? 'pill-info' : 'pill-neutral';
          const statusText = legacySent ? 'NOT EMAILED' : String(c.status || 'draft').toUpperCase();
          const sentDate = c.sentAt ? new Date(c.sentAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : null;
          const failed = Array.isArray(c.failures) ? c.failures : [];
          const sendInfo = (c.status === 'sent' && !legacySent)
            ? ` · Sent ${sentDate || ''} · ${c.sentCount} delivered${c.failedCount ? ', ' + c.failedCount + ' failed' : ''}`
            : (legacySent ? ' · Marked sent earlier, but nothing was emailed' : '');
          const count = (c.status !== 'sent' || legacySent) && typeof _mktAudienceCount === 'function' ? _mktAudienceCount(c.audience) : null;
          const countText = count === null ? '' : ` · ${count} ${count === 1 ? 'person' : 'people'}`;
          html += `<article class="mk-card">
            <div class="mk-card-main">
              <div class="mk-card-head">
                <h3 class="mk-card-title" data-user-content>${esc(c.name)}</h3>
                <span class="pill ${statusClass} pill-sm" data-ui="pill">${statusText}</span>
              </div>
              <div class="mk-card-meta">${esc(String(c.type || '').toUpperCase())} · Audience: ${esc(typeof _mktAudienceLabel === 'function' ? _mktAudienceLabel(c.audience) : c.audience)}${countText}${sendInfo}</div>
              ${c.subject ? `<div class="mk-card-subject" data-user-content>${esc(c.subject)}</div>` : ''}
              ${failed.length ? `<div class="mk-card-meta">Did not send to: <span data-user-content>${esc(failed.slice(0, 5).map(f => f.email).join(', '))}${failed.length > 5 ? ' and ' + (failed.length - 5) + ' more' : ''}</span></div>` : ''}
              ${blocked && (c.status !== 'sent' || legacySent) ? `<div class="mk-card-meta mk-card-err">Sending is off until your business mailing address is saved. <button type="button" class="link" onclick="_mktOpenBusiness()">Open Settings, Business</button></div>` : ''}
              ${(c.status !== 'sent' && c.lastSendError) ? `<div class="mk-card-meta mk-card-err">Last attempt: ${esc(c.lastSendError)}</div>` : ''}
            </div>
            <div class="mk-card-actions">
              ${(c.status !== 'sent' || legacySent) ? `<button type="button" class="btn btn-secondary" ${blocked ? 'disabled aria-disabled="true"' : ''} onclick="sendCampaign('${esc(c.id)}')">Send Now</button>` : ''}
              <button type="button" class="btn btn-ghost" onclick="deleteCampaign('${esc(c.id)}')" aria-label="Delete ${esc(c.name)}">Delete</button>
            </div>
          </article>`;
        });
      }
      document.getElementById('campaignsList').innerHTML = html;
      if (typeof _p7Actions === 'function') _p7Actions('marketing', `<button type="button" class="btn btn-primary" onclick="openCampaignComposer()">${_p7Icon('plus', 18)} New campaign</button>`);
    }

    // Composer: a drawer on desktop, a full sheet on phone. Four chunks: Basics, Who, Message, When.
    function openCampaignComposer() {
      _p7CloseSheet('campaignSheet');
      const html = `<form id="campaignForm" onsubmit="saveCampaign(event)">
        <div class="banner banner-warn" id="campaignCanSpam">${_p7Icon('triangle-alert', 20)}<div class="banner-body"><div class="banner-title">Required before marketing use</div>Sending needs your business mailing address saved in Settings. We add it, plus an unsubscribe line, to the bottom of every email. Sending is limited to ${CAMPAIGN_MAX_RECIPIENTS} people at a time.</div></div>
        <fieldset class="mk-fs"><legend>Basics</legend>
          <div class="field"><label class="field-label" for="campaignName">Campaign name</label><input type="text" class="form-input" id="campaignName" required placeholder="e.g. Spring promo"></div>
          <div class="field"><label class="field-label" for="campaignType">Type</label>
            <select class="form-select" id="campaignType">
              <option value="email">Email blast</option>
              <option value="sms">Text message (not connected yet)</option>
              <option value="drip">Drip sequence (not connected yet)</option>
            </select></div>
        </fieldset>
        <fieldset class="mk-fs"><legend>Who gets it</legend>
          <div class="field"><label class="field-label" for="campaignAudience">Audience</label>
            <select class="form-select" id="campaignAudience" onchange="_mktShowCount()">
              <option value="all">All clients</option>
              <option value="leads">Leads only</option>
              <option value="booked">Booked events</option>
              <option value="completed">Past clients</option>
              <option value="weddings">Wedding clients</option>
              <option value="corporate">Corporate clients</option>
            </select>
            <span class="field-hint" id="campaignAudienceCount" aria-live="polite"></span></div>
        </fieldset>
        <fieldset class="mk-fs"><legend>Message</legend>
          <div class="field"><label class="field-label" for="campaignSubject">Subject</label><input type="text" class="form-input" id="campaignSubject" placeholder="Subject line or text opener"></div>
          <div class="field"><label class="field-label" for="campaignMessage">Message</label><textarea class="form-textarea" id="campaignMessage" rows="7" placeholder="Write your message here"></textarea>
            <span class="field-hint">Use {{client_name}} and {{event_date}} to fill in each person's details.</span></div>
        </fieldset>
        <fieldset class="mk-fs"><legend>When</legend>
          <div class="field"><label class="field-label" for="campaignSchedule">Send</label>
            <select class="form-select" id="campaignSchedule">
              <option value="draft">Save as draft</option>
              <option value="now"${_mktBlocked() ? ' disabled' : ''}>Send now (email it)</option>
            </select>${_mktBlocked() ? '<span class="field-hint">Sending is off until your business mailing address is saved. <button type="button" class="link" onclick="_mktOpenBusiness()">Open Settings, Business</button></span>' : ''}</div>
        </fieldset>
      </form>`;
      CRMUI.sheet({ id: 'campaignSheet', drawer: true, title: 'New campaign', html,
        dirty: () => { const n = document.getElementById('campaignName'), m = document.getElementById('campaignMessage'); return !!((n && n.value) || (m && m.value)); },
        primary: { label: 'Save campaign', onClick: _p7Submit }, secondary: { label: 'Cancel' } });
      _mktShowCount();
    }

    function _mktShowCount() {
      const sel = document.getElementById('campaignAudience'), out = document.getElementById('campaignAudienceCount');
      if (!sel || !out) return;
      const n = _mktAudienceCount(sel.value);
      out.textContent = n === null ? '' : 'Reaches ' + n + (n === 1 ? ' person' : ' people') + ' right now.' + (sel.value === 'leads' ? ' Website inquiries are counted when you send.' : '');
    }

    function saveCampaign(e) {
      e.preventDefault();
      const campaigns = getDB('campaigns');
      const schedule = document.getElementById('campaignSchedule').value;
      // Saving never marks a campaign as sent. "Send now" saves a draft, then opens the send dialog.
      const c = {
        id: genId(),
        name: document.getElementById('campaignName').value,
        type: document.getElementById('campaignType').value,
        audience: document.getElementById('campaignAudience').value,
        subject: document.getElementById('campaignSubject').value,
        message: document.getElementById('campaignMessage').value,
        status: 'draft',
        sentAt: null,
        createdAt: Date.now()
      };
      campaigns.push(c);
      setDB('campaigns', campaigns);
      document.getElementById('campaignForm').reset();
      if (typeof _p7CloseSheet === 'function') _p7CloseSheet('campaignSheet');
      renderMarketing();
      if (schedule === 'now') sendCampaign(c.id);
      else showToast('Campaign saved as draft', 'success');
    }

    // ── Campaign send (P0.6) ─────────────────────────────────────────────────
    // Real sends only: one BSPortal.sendEmail('generic') per recipient, max 100, per-recipient results.
    const CAMPAIGN_MAX_RECIPIENTS = 100;
    const CAMPAIGN_CHUNK = 2;        // sends in flight at once (Resend allows about 2 requests per second)
    const CAMPAIGN_CHUNK_GAP_MS = 600;
    let _campaignPending = null;     // { id, recipients } while the confirm dialog is open
    let _campaignBusy = false;

    // Pure: who gets this campaign. src = { clients, events, inquiries }. Returns { list, noEmail }.
    function _campaignRecipientsFrom(src, audience) {
      const clients = (src && src.clients) || [];
      const events = (src && src.events) || [];
      const inquiries = (src && src.inquiries) || [];
      const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
      const OPEN_EVENT = ['lead', 'quote_sent', 'proposal', 'negotiation'];
      const DEAD_EVENT = ['cancelled', 'ghosted'];
      const OPEN_INQ = ['new', 'contacted', 'quoted'];
      const cand = []; // { email, name, eventDate }
      const addEvent = e => cand.push({ email: e.clientEmail, name: e.clientName, eventDate: e.date || '' });
      const addClient = c => cand.push({ email: c.email, name: c.name, eventDate: '' });
      if (audience === 'leads') {
        events.filter(e => OPEN_EVENT.includes(e.status)).forEach(addEvent);
        inquiries.filter(i => OPEN_INQ.includes(i.status || 'new')).forEach(i => cand.push({ email: i.email, name: i.name, eventDate: i.event_date || '' }));
      } else if (audience === 'booked') {
        events.filter(e => e.status === 'booked' || e.status === 'confirmed').forEach(addEvent);
      } else if (audience === 'completed') {
        events.filter(e => e.status === 'completed').forEach(addEvent);
      } else if (audience === 'weddings') {
        events.filter(e => e.type === 'wedding' && !DEAD_EVENT.includes(e.status)).forEach(addEvent);
      } else if (audience === 'corporate') {
        clients.filter(c => c.type === 'corporate').forEach(addClient);
        events.filter(e => e.type === 'corporate' && !DEAD_EVENT.includes(e.status)).forEach(addEvent);
      } else { // all
        clients.forEach(addClient);
        events.filter(e => !DEAD_EVENT.includes(e.status)).forEach(addEvent);
      }
      const seen = new Map();
      let noEmail = 0;
      cand.forEach(p => {
        const em = String(p.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(em)) { noEmail++; return; }
        const prev = seen.get(em);
        if (!prev) seen.set(em, { email: String(p.email).trim(), name: String(p.name || '').trim(), eventDate: p.eventDate || '' });
        else {
          if (!prev.name && p.name) prev.name = String(p.name).trim();
          if (p.eventDate && (!prev.eventDate || p.eventDate > prev.eventDate)) prev.eventDate = p.eventDate; // keep the latest event
        }
      });
      return { list: Array.from(seen.values()), noEmail };
    }

    function _campaignFill(text, r) {
      const dateStr = r.eventDate ? new Date(String(r.eventDate).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      return String(text || '')
        .replace(/\{\{\s*client_name\s*\}\}/gi, r.name || 'there')
        .replace(/\{\{\s*event_date\s*\}\}/gi, dateStr === 'Invalid Date' ? '' : dateStr);
    }

    // Sends to every recipient and counts results. send(type, payload) defaults to BSPortal.sendEmail.
    // Returns { sent:[recipient], failed:[{email,name,error}] }. Never throws.
    async function _campaignDeliver(c, recipients, send, gapMs) {
      send = send || ((t, p) => BSPortal.sendEmail(t, p));
      const gap = (gapMs === undefined) ? CAMPAIGN_CHUNK_GAP_MS : gapMs;
      const sent = [], failed = [];
      let dry = 0;
      for (let i = 0; i < recipients.length; i += CAMPAIGN_CHUNK) {
        const chunk = recipients.slice(i, i + CAMPAIGN_CHUNK);
        const results = await Promise.all(chunk.map(async r => {
          try {
            return await send('generic', {
              email: r.email,
              clientName: r.name || '',
              subject: _campaignFill(c.subject, r),
              body: _campaignFill(c.message, r) + (typeof _mktFooter === 'function' ? _mktFooter() : '')
            });
          } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
        }));
        results.forEach((res, k) => {
          if (res && res.ok) { sent.push(chunk[k]); if (res.dryRun) dry++; }
          else failed.push({ email: chunk[k].email, name: chunk[k].name, error: (res && res.error) || 'unknown error' });
        });
        if (gap && i + CAMPAIGN_CHUNK < recipients.length) await new Promise(r => setTimeout(r, gap));
      }
      return { sent, failed, dry };
    }

    // Records the outcome on the campaign. Only marks it sent when at least one email went out.
    function _campaignRecord(id, outcome) {
      const campaigns = getDB('campaigns') || [];
      const c = campaigns.find(x => x.id === id);
      if (!c) return false;
      if (outcome.sent.length > 0) {
        c.status = 'sent';
        c.sentAt = Date.now();
        c.sentCount = outcome.sent.length;
        c.failedCount = outcome.failed.length;
        c.failures = outcome.failed.slice(0, 100).map(f => ({ email: f.email, error: String(f.error).slice(0, 200) }));
        delete c.lastSendError;
      } else {
        c.lastSendError = 'None of ' + outcome.failed.length + ' emails sent (' + String((outcome.failed[0] || {}).error || 'unknown error').slice(0, 120) + ')';
      }
      setDB('campaigns', campaigns);
      return outcome.sent.length > 0;
    }

    async function sendCampaign(id) {
      if (_campaignBusy) return;
      const campaigns = getDB('campaigns') || [];
      const c = campaigns.find(x => x.id === id);
      if (!c) return;
      if (typeof _mktBlocked === 'function' && _mktBlocked()) { showToast('Add your business mailing address in Settings, Business, before sending.', 'warning'); return; }
      if (c.type !== 'email') { showToast('Only email campaigns can be sent from here. SMS and drip are not connected yet.', 'warning'); return; }
      if (!String(c.subject || '').trim() || !String(c.message || '').trim()) { showToast('Add a subject and a message before sending.', 'warning'); return; }
      let inquiries = [], note = '';
      if (c.audience === 'leads') {
        try { inquiries = await _fetchInquiryRows(200); }
        catch (e) { note = 'Website inquiries could not be loaded, so they are not included.'; }
      }
      const found = _campaignRecipientsFrom({ clients: getDB('clients') || [], events: getDB('events') || [], inquiries }, c.audience);
      if (!found.list.length) { showToast('No one with an email address matches this audience.', 'warning'); return; }
      if (found.list.length > CAMPAIGN_MAX_RECIPIENTS) {
        showToast('This audience has ' + found.list.length + ' people. The limit is ' + CAMPAIGN_MAX_RECIPIENTS + ' per send. Pick a narrower audience.', 'error');
        return;
      }
      _campaignPending = { id, recipients: found.list };
      const shown = found.list.slice(0, 8).map(r => `<li><span data-user-content>${esc(r.name || r.email)}</span> <span class="t-meta" data-user-content>${esc(r.email)}</span></li>`).join('');
      document.getElementById('campaignSendTitle').textContent = 'Send campaign';
      document.getElementById('campaignSendBody').innerHTML = `
        <p class="mk-send-p"><strong data-user-content>${esc(c.name)}</strong><br><span class="t-meta">Subject: <span data-user-content>${esc(c.subject)}</span></span></p>
        <p class="mk-send-p">This sends a real email to <strong>${found.list.length}</strong> ${found.list.length === 1 ? 'person' : 'people'} right now. It cannot be undone.</p>
        ${typeof _mktBiz === 'function' ? `<p class="t-meta">Every email ends with your business address and an unsubscribe line: <span data-user-content>${esc(String(_mktBiz().address || '').replace(/\s+/g, ' '))}</span></p>` : ''}
        <ul class="mk-send-list">${shown}${found.list.length > 8 ? `<li>and ${found.list.length - 8} more</li>` : ''}</ul>
        ${found.noEmail ? `<p class="t-meta">${found.noEmail} matching ${found.noEmail === 1 ? 'record has' : 'records have'} no valid email and ${found.noEmail === 1 ? 'is' : 'are'} skipped.</p>` : ''}
        ${note ? `<p class="t-meta">${esc(note)}</p>` : ''}`;
      document.getElementById('campaignSendActions').innerHTML = `
        <button type="button" class="btn btn-secondary" id="campaignSendCancel" onclick="closeModal('campaignSendModal')">Cancel</button>
        <button type="button" class="btn btn-primary" id="campaignSendGo" onclick="confirmCampaignSend()">Send to ${found.list.length}</button>`;
      openModal('campaignSendModal');
    }

    async function confirmCampaignSend() {
      if (_campaignBusy || !_campaignPending) return;
      const { id, recipients } = _campaignPending;
      const c = (getDB('campaigns') || []).find(x => x.id === id);
      if (!c) { closeModal('campaignSendModal'); return; }
      _campaignBusy = true;
      const go = document.getElementById('campaignSendGo'), cancel = document.getElementById('campaignSendCancel');
      if (go) { go.disabled = true; go.textContent = 'Sending…'; }
      if (cancel) cancel.disabled = true;
      let outcome;
      try { outcome = await _campaignDeliver(c, recipients); }
      finally { _campaignBusy = false; _campaignPending = null; }
      const marked = _campaignRecord(id, outcome);
      const n = recipients.length;
      const failList = outcome.failed.map(f => `<li><span data-user-content>${esc(f.email)}</span> <span class="t-meta">${esc(f.error)}</span></li>`).join('');
      document.getElementById('campaignSendTitle').textContent = marked ? 'Campaign sent' : 'Campaign not sent';
      document.getElementById('campaignSendBody').innerHTML = `
        <p class="mk-send-p"><strong>${outcome.sent.length}</strong> of ${n} sent${outcome.failed.length ? `, <strong class="mk-send-bad">${outcome.failed.length} failed</strong>` : ''}.</p>
        ${outcome.dry ? '<p class="mk-send-p"><span class="pill pill-warn pill-sm" data-ui="pill">Dry run</span> <span class="t-meta">Email is in test mode, so nothing was delivered.</span></p>' : ''}
        ${outcome.failed.length ? `<div class="t-meta">Did not send to:</div><ul class="mk-send-list mk-send-fails">${failList}</ul>` : ''}
        ${marked ? '' : '<p class="t-meta">Nothing went out, so the campaign is still a draft. You can try again.</p>'}`;
      document.getElementById('campaignSendActions').innerHTML = `<button type="button" class="btn btn-secondary" onclick="closeModal('campaignSendModal')">Close</button>`;
      renderMarketing();
      if (marked && !outcome.failed.length) showToast('Campaign sent to ' + outcome.sent.length, 'success');
      else if (marked) showToast('Campaign sent to ' + outcome.sent.length + ', ' + outcome.failed.length + ' failed', 'warning');
      else showToast('Campaign not sent: ' + String((outcome.failed[0] || {}).error || 'unknown error'), 'error');
    }

    function deleteCampaign(id) {
      confirmDestructive('Delete Campaign', 'Delete this campaign? This cannot be undone.', function() {
        setDB('campaigns', getDB('campaigns').filter(c => c.id !== id));
        renderMarketing();
        showToast('Campaign deleted', 'info');
      });
    }
