// ============================================================================
// portal-provider/75-marketing.js  -  marketing: campaigns
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    //
    //  MARKETING / CAMPAIGNS
    //
    function renderMarketing() {
      if (!getDB('campaigns') || getDB('campaigns').length === 0) setDB('campaigns', []);
      const campaigns = getDB('campaigns');

      let html = '';
      if (!campaigns.length) {
        html = '<div class="empty-state" style="padding:30px;">No campaigns yet. Create one on the right.</div>';
      } else {
        campaigns.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(c => {
          // Campaigns marked "sent" before sending was real have no sentCount: nothing was ever emailed for them.
          const legacySent = c.status === 'sent' && c.sentCount === undefined;
          const statusClass = c.status === 'sent' && !legacySent ? 'campaign-sent' : c.status === 'scheduled' ? 'campaign-scheduled' : 'campaign-draft';
          const statusText = legacySent ? 'NOT EMAILED' : String(c.status || 'draft').toUpperCase();
          const sentDate = c.sentAt ? new Date(c.sentAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : null;
          const failed = Array.isArray(c.failures) ? c.failures : [];
          const sendInfo = (c.status === 'sent' && !legacySent)
            ? ` · Sent ${sentDate || ''} · ${c.sentCount} delivered${c.failedCount ? ', ' + c.failedCount + ' failed' : ''}`
            : (legacySent ? ' · Marked sent earlier, but nothing was emailed' : '');
          html += `<div class="campaign-card">
            <div class="campaign-card-info">
              <div class="campaign-card-title">${esc(c.name)}</div>
              <div class="campaign-card-meta">${esc(String(c.type || '').toUpperCase())} · Audience: ${esc(c.audience)}${sendInfo}</div>
              <div class="campaign-card-meta" style="margin-top:4px;font-style:italic;">${esc(c.subject||'')}</div>
              ${failed.length ? `<div class="campaign-card-meta" style="margin-top:4px;">Did not send to: ${esc(failed.slice(0, 5).map(f => f.email).join(', '))}${failed.length > 5 ? ' and ' + (failed.length - 5) + ' more' : ''}</div>` : ''}
              ${(c.status !== 'sent' && c.lastSendError) ? `<div class="campaign-card-meta" style="margin-top:4px;color:var(--danger);">Last attempt: ${esc(c.lastSendError)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
              <span class="campaign-status ${statusClass}">${statusText}</span>
              ${(c.status !== 'sent' || legacySent) ? `<button class="btn btn-primary" style="font-size:12px;padding:4px 10px;" onclick="sendCampaign('${esc(c.id)}')">Send Now</button>` : ''}
              <button class="btn btn-danger" style="font-size:12px;padding:4px 8px;" onclick="deleteCampaign('${esc(c.id)}')">Delete</button>
            </div>
          </div>`;
        });
      }
      document.getElementById('campaignsList').innerHTML = html;
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
      for (let i = 0; i < recipients.length; i += CAMPAIGN_CHUNK) {
        const chunk = recipients.slice(i, i + CAMPAIGN_CHUNK);
        const results = await Promise.all(chunk.map(async r => {
          try {
            return await send('generic', {
              email: r.email,
              clientName: r.name || '',
              subject: _campaignFill(c.subject, r),
              body: _campaignFill(c.message, r)
            });
          } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
        }));
        results.forEach((res, k) => {
          if (res && res.ok) sent.push(chunk[k]);
          else failed.push({ email: chunk[k].email, name: chunk[k].name, error: (res && res.error) || 'unknown error' });
        });
        if (gap && i + CAMPAIGN_CHUNK < recipients.length) await new Promise(r => setTimeout(r, gap));
      }
      return { sent, failed };
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
      const shown = found.list.slice(0, 8).map(r => `<li>${esc(r.name || r.email)} <span style="color:var(--text-3);">${esc(r.email)}</span></li>`).join('');
      document.getElementById('campaignSendTitle').textContent = 'Send campaign';
      document.getElementById('campaignSendBody').innerHTML = `
        <p style="margin-bottom:10px;"><strong>${esc(c.name)}</strong><br><span style="color:var(--text-2);">Subject: ${esc(c.subject)}</span></p>
        <p style="margin-bottom:10px;">This sends a real email to <strong>${found.list.length}</strong> ${found.list.length === 1 ? 'person' : 'people'} right now. It cannot be undone.</p>
        <ul style="margin:0 0 10px 18px;font-size:13px;color:var(--text-2);">${shown}${found.list.length > 8 ? `<li>and ${found.list.length - 8} more</li>` : ''}</ul>
        ${found.noEmail ? `<p style="font-size:12px;color:var(--text-3);">${found.noEmail} matching ${found.noEmail === 1 ? 'record has' : 'records have'} no valid email and ${found.noEmail === 1 ? 'is' : 'are'} skipped.</p>` : ''}
        ${note ? `<p style="font-size:12px;color:var(--text-3);">${esc(note)}</p>` : ''}`;
      document.getElementById('campaignSendActions').innerHTML = `
        <button class="btn btn-secondary" id="campaignSendCancel" onclick="closeModal('campaignSendModal')">Cancel</button>
        <button class="btn btn-primary" id="campaignSendGo" onclick="confirmCampaignSend()">Send to ${found.list.length}</button>`;
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
      const failList = outcome.failed.map(f => `<li>${esc(f.email)} <span style="color:var(--text-3);">${esc(f.error)}</span></li>`).join('');
      document.getElementById('campaignSendTitle').textContent = marked ? 'Campaign sent' : 'Campaign not sent';
      document.getElementById('campaignSendBody').innerHTML = `
        <p style="margin-bottom:10px;"><strong>${outcome.sent.length}</strong> of ${n} sent${outcome.failed.length ? `, <strong style="color:var(--danger);">${outcome.failed.length} failed</strong>` : ''}.</p>
        ${outcome.failed.length ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:6px;">Did not send to:</div><ul style="margin:0 0 10px 18px;font-size:13px;max-height:180px;overflow:auto;">${failList}</ul>` : ''}
        ${marked ? '' : '<p style="font-size:12px;color:var(--text-3);">Nothing went out, so the campaign is still a draft. You can try again.</p>'}`;
      document.getElementById('campaignSendActions').innerHTML = `<button class="btn btn-secondary" onclick="closeModal('campaignSendModal')">Close</button>`;
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
