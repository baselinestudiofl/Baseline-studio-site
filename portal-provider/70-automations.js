// ============================================================================
// portal-provider/70-automations.js  -  automations: rules UI, engine, logs, stage-jump prompts
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // Automation Builder Functions
    function renderAutomations() {
      const automationRules = (getDB('automations') || []);

      let html = '';
      automationRules.forEach(rule => {
        const triggerDesc = getTriggerDescription(rule.trigger);
        const actionDesc = getActionDescription(rule.action);
        html += `
          <div class="automation-card">
            <div class="automation-card-content">
              <div class="automation-card-name">${rule.name}</div>
              <div class="automation-card-trigger">Trigger: ${triggerDesc}</div>
              <div class="automation-card-action">Action: ${actionDesc}</div>
            </div>
            <div class="automation-card-actions">
              <label class="toggle-switch" style="margin: 0;">
                <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleAutomationRule('${rule.id}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
              <button class="btn btn-secondary" onclick="deleteAutomationRule('${rule.id}')" style="padding: 6px 10px; font-size: 12px;">Delete</button>
            </div>
          </div>
        `;
      });

      document.getElementById('automationsContainer').innerHTML = html;
      document.getElementById('noAutomationsMessage').style.display = automationRules.length > 0 ? 'none' : 'block';
    }

    function getTriggerDescription(trigger) {
      const descriptions = {
        new_lead: 'New lead received from contact form',
        status_change: `Event status changes to: ${trigger.value || ''}`,
        deposit_received: 'Deposit is marked as received',
        balance_received: 'Balance is marked as received',
        days_before: `${trigger.value} days before event`,
        days_after: `${trigger.value} days after event`,
        new_event: 'New event created'
      };
      return descriptions[trigger.type] || trigger.type;
    }

    function getActionDescription(action) {
      const descriptions = {
        notification: `Show notification: "${action.message || ''}"`,
        create_task: `Create task: "${action.task || ''}"`,
        change_status: `Change event status to: ${action.status || ''}`,
        add_note: `Add note: "${action.note || ''}"`,
        flag_review: 'Flag event for review'
      };
      return descriptions[action.type] || action.type;
    }

    function updateTriggerOptions() {
      const triggerType = document.getElementById('automationTriggerType').value;
      let html = '';

      if (triggerType === 'status_change') {
        html = `
          <select id="triggerValue" class="automation-builder-select" required>
            <option value="">Select status...</option>
            <option value="proposal">Proposal</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
          </select>
        `;
      } else if (triggerType === 'days_before' || triggerType === 'days_after') {
        html = `
          <input type="number" id="triggerValue" class="automation-builder-number" placeholder="Number of days" min="1" max="365" required>
        `;
      }

      document.getElementById('triggerOptionsContainer').innerHTML = html;
    }

    function updateActionOptions() {
      const actionType = document.getElementById('automationActionType').value;
      let html = '';

      if (actionType === 'notification') {
        html = `
          <input type="text" id="actionValue" class="automation-builder-input" placeholder="Enter notification message" required>
        `;
      } else if (actionType === 'create_task') {
        html = `
          <input type="text" id="actionValue" class="automation-builder-input" placeholder="Enter task description" required>
        `;
      } else if (actionType === 'change_status') {
        html = `
          <select id="actionValue" class="automation-builder-select" required>
            <option value="">Select status...</option>
            <option value="proposal">Proposal</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
          </select>
        `;
      } else if (actionType === 'add_note') {
        html = `
          <input type="text" id="actionValue" class="automation-builder-input" placeholder="Enter note text" required>
        `;
      }

      document.getElementById('actionOptionsContainer').innerHTML = html;
    }

    function saveNewAutomation(e) {
      e.preventDefault();
      const ruleName = document.getElementById('automationRuleName').value;
      const triggerType = document.getElementById('automationTriggerType').value;
      const triggerValue = document.getElementById('triggerValue')?.value || '';
      const actionType = document.getElementById('automationActionType').value;
      const actionValue = document.getElementById('actionValue')?.value || '';

      if (!ruleName || !triggerType || !actionType) {
        showToast('Please fill in all required fields', 'error');
        return;
      }

      const automationRules = (getDB('automations') || []);
      const newRule = {
        id: genId(),
        name: ruleName,
        enabled: true,
        trigger: { type: triggerType, value: triggerValue },
        action: createActionObject(actionType, actionValue),
        createdAt: new Date().toISOString()
      };

      automationRules.push(newRule);
      setDB('automations', automationRules);

      // Reset form
      document.getElementById('automationBuilderForm').reset();
      document.getElementById('triggerOptionsContainer').innerHTML = '';
      document.getElementById('actionOptionsContainer').innerHTML = '';

      renderAutomations();
      showToast('Automation rule created', 'success');
    }

    function createActionObject(actionType, actionValue) {
      const actions = {
        notification: { type: 'notification', message: actionValue },
        create_task: { type: 'create_task', task: actionValue },
        change_status: { type: 'change_status', status: actionValue },
        add_note: { type: 'add_note', note: actionValue },
        flag_review: { type: 'flag_review' }
      };
      return actions[actionType] || { type: actionType };
    }

    function toggleAutomationRule(ruleId, enabled) {
      const automationRules = (getDB('automations') || []);
      const rule = automationRules.find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;
        setDB('automations', automationRules);
        showToast('Rule ' + (enabled ? 'enabled' : 'disabled'), 'success');
      }
    }

    function deleteAutomationRule(ruleId) {
      confirmDestructive('Delete Rule', 'Delete this automation rule? It will stop running immediately.', function() {
        const automationRules = (getDB('automations') || []);
        setDB('automations', automationRules.filter(r => r.id !== ruleId));
        renderAutomations();
        showToast('Rule deleted', 'success');
      });
    }

    async function executeAutomations(triggerType, triggerValue, eventId) {
      const automationRules = (getDB('automations') || []);
      for (const rule of automationRules) {
        if (!rule.enabled) continue;
        if (!rule.trigger || rule.trigger.type !== triggerType) continue;
        if (triggerValue && rule.trigger.value !== triggerValue) continue;
        if (!(await _claimFire(eventId, rule.id, rule.action && rule.action.type))) continue; // same rule+event never fires twice
        try { executeAction(rule.action, eventId); _logAutomation(eventId, rule.id, rule.action && rule.action.type, 'done'); }
        catch (e) { _logAutomation(eventId, rule.id, rule.action && rule.action.type, 'error'); }
      }
    }

    // Builder triggers status_change / deposit_received: diff events against a persisted snapshot after every
    // setDB('events'). First sight of an event only records it (no fire), so turning this on never mass-fires.
    function _checkEventTriggers() {
      const evs = getDB('events');
      if (!Array.isArray(evs)) return;
      const raw = getDB('automationEventSnap');
      const hadSnap = raw && typeof raw === 'object' && !Array.isArray(raw);
      const snap = hadSnap ? raw : {}; const fire = []; let dirty = !hadSnap;
      evs.forEach(e => {
        const prev = snap[e.id], cur = { status: e.status || '', depositPaid: !!e.depositPaid };
        if (!prev) { snap[e.id] = cur; dirty = true; return; }
        if (prev.status !== cur.status) { fire.push(['status_change', cur.status, e.id]); dirty = true; }
        if (!prev.depositPaid && cur.depositPaid) { fire.push(['deposit_received', '', e.id]); dirty = true; }
        snap[e.id] = cur;
      });
      if (dirty) setDB('automationEventSnap', snap);
      if (hadSnap) fire.forEach(f => executeAutomations(f[0], f[1], f[2]).catch(e => console.warn('[automation]', e)));
    }

    function executeAction(action, eventId) {
      if (action.type === 'notification') {
        showToast(action.message, 'info');
      } else if (action.type === 'create_task') {
        const tasks = (getDB('tasks') || []);
        tasks.push({
          id: genId(),
          description: action.task,
          eventId: eventId,
          eventName: ((getDB('events') || []).find(e => e.id === eventId) || {}).name || '',
          completed: false,
          createdAt: new Date().toISOString()
        });
        setDB('tasks', tasks);
      } else if (action.type === 'add_note') {
        // Add note to event
        const events = getDB('events');
        const event = events.find(e => e.id === eventId);
        if (event) {
          event.notes = (event.notes || '') + '\n[Auto] ' + action.note;
          setDB('events', events);
        }
      }
    }

    // Keep backward compat
    function updateAutomation(key, enabled) {
      const rules = getDB('automations');
      if (Array.isArray(rules)) { const r = rules.find(x=>x.id===key); if(r) r.enabled=enabled; setDB('automations',rules); }
      showToast('Automation ' + (enabled ? 'enabled' : 'disabled'), 'success');
    }

    // ── F: Pipeline Automation Engine ─────────────────────────────────────────
    // Fired/skip markers persist as a plain object { leadId: [ {ruleId, action, at, result} ] }.
    // getDB() returns [] for a missing key, and properties set on an array are dropped by JSON.stringify,
    // so anything that is not a plain object is replaced with a fresh {}.
    function _getAutoLogs() {
      const raw = getDB('automationLogs');
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    }
    function _saveAutoLogs(logs) { setDB('automationLogs', logs); }

    // Completes a 'pending' claim entry if one exists, otherwise appends a new entry.
    function _logAutomation(leadId, ruleId, action, result) {
      const logs = _getAutoLogs();
      if (!logs[leadId]) logs[leadId] = [];
      const pend = logs[leadId].find(l => l.ruleId === ruleId && l.result === 'pending');
      if (pend) { pend.action = action; pend.at = new Date().toISOString(); pend.result = result; }
      else logs[leadId].push({ ruleId, action, at: new Date().toISOString(), result });
      _saveAutoLogs(logs);
    }

    function _firedInLogs(leadId, ruleId) {
      return (_getAutoLogs()[leadId] || []).some(l => l.ruleId === ruleId);
    }

    // Any logged result (sent, task_created, fallback, skipped, pending...) counts as fired, so Skip sticks.
    // The localStorage claim covers other tabs in this browser before the server copy catches up.
    function _alreadyFired(leadId, ruleId) {
      if (_firedInLogs(leadId, ruleId)) return true;
      try { return !!JSON.parse(localStorage.getItem('bs_autofire_claims') || '{}')[leadId + '|' + ruleId]; } catch { return false; }
    }

    // Pulls the server copy of automationLogs and merges in entries this tab does not have (other tab/device).
    async function _mergeServerAutoLogs() {
      try {
        if (typeof SB === 'undefined') return;
        const r = await fetch(`${SUPABASE_URL}/rest/v1/provider_data?select=data_value&data_key=eq.automationLogs${(BSPortal.getCurrentUser && BSPortal.getCurrentUser() && BSPortal.getCurrentUser().ownerId) ? '&user_id=eq.' + BSPortal.getCurrentUser().ownerId : ''}`, { headers: SB.headers() });
        if (!r.ok) return;
        const rows = await r.json();
        const logs = _getAutoLogs(); let changed = false;
        (rows || []).forEach(row => {
          const srv = row && row.data_value;
          if (!srv || typeof srv !== 'object' || Array.isArray(srv)) return;
          Object.keys(srv).forEach(id => (srv[id] || []).forEach(e => {
            if (!(logs[id] || []).some(x => x.ruleId === e.ruleId)) { (logs[id] = logs[id] || []).push(e); changed = true; }
          }));
        });
        if (changed) _saveAutoLogs(logs);
      } catch {}
    }

    // Claim a rule+lead pair before acting on it. Returns false if it already fired or another tab/device got it first.
    // Order: logs check -> same-browser lock (localStorage, under navigator.locks when available) -> server merge -> write-ahead 'pending' entry.
    async function _claimFire(leadId, ruleId, action) {
      if (_alreadyFired(leadId, ruleId)) return false;
      const key = leadId + '|' + ruleId;
      const token = Math.random().toString(36).slice(2) + Date.now();
      const tryClaim = () => {
        try {
          const claims = JSON.parse(localStorage.getItem('bs_autofire_claims') || '{}');
          if (claims[key]) return false;
          claims[key] = token;
          localStorage.setItem('bs_autofire_claims', JSON.stringify(claims));
          return JSON.parse(localStorage.getItem('bs_autofire_claims') || '{}')[key] === token;
        } catch { return true; }
      };
      const won = (navigator.locks && navigator.locks.request) ? await navigator.locks.request('bs_autofire_claim', tryClaim) : tryClaim();
      if (!won) return false;
      await _mergeServerAutoLogs();
      if (_firedInLogs(leadId, ruleId)) return false;
      const logs = _getAutoLogs();
      (logs[leadId] = logs[leadId] || []).push({ ruleId, action, at: new Date().toISOString(), result: 'pending' });
      _saveAutoLogs(logs);
      return true;
    }

    // Stage-entry times persist in 'inquiryStages' { leadId: {status, at} } because the inquiries table has no column for it.
    function _stageMap() {
      const m = getDB('inquiryStages');
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    }
    function _recordStage(leadId, status) {
      const m = _stageMap();
      m[leadId] = { status, at: new Date().toISOString() };
      setDB('inquiryStages', m);
    }
    // Stamps stageEnteredAt onto rows. First sighting uses created_at; a status that differs from the recorded one
    // (changed by any writer, tab or device) restarts the clock now.
    function _applyStageTimes(rows) {
      const m = _stageMap(); let dirty = false;
      rows.forEach(l => {
        const st = l.status || 'new', rec = m[l.id];
        if (!rec) { m[l.id] = { status: st, at: l.created_at || new Date().toISOString() }; dirty = true; }
        else if (rec.status !== st) { m[l.id] = { status: st, at: new Date().toISOString() }; dirty = true; }
        l.stageEnteredAt = m[l.id].at;
      });
      if (dirty) setDB('inquiryStages', m);
    }

    // Engine only acts on leads whose stage was entered after this moment, so switching the engine on never
    // mass-fires on the existing backlog. Stored once; delete the 'automationBaseline' key to reset.
    function _autoBaselineMs() {
      let b = getDB('automationBaseline');
      if (!b || typeof b !== 'object' || Array.isArray(b) || !b.at) { b = { at: new Date().toISOString() }; setDB('automationBaseline', b); }
      return new Date(b.at).getTime();
    }

    async function _executeAutoAction(rule, lead) {
      const name = lead.name || 'Client';
      if (rule.action === 'email') {
        const email = lead.email || '';
        const body  = (rule.emailBody || '').replace(/\{name\}/g, name);
        // Only 'generic' is a valid send-email type for automation emails. Legacy template names
        // (quote_followup, final_details, ack) map to generic with a subject.
        const AUTO_SUBJECTS = { quote_followup: 'Checking in on your quote', final_details: 'Final details for your event' };
        const VALID_TYPES = ['quote','invoice','client_invite','provider_invite','generic','contact_thankyou','internal_lead'];
        const tpl   = rule.template || 'generic';
        const sendType = VALID_TYPES.includes(tpl) ? tpl : 'generic';
        const subj  = rule.subject || AUTO_SUBJECTS[tpl] || 'From Baseline Studio';
        try {
          const payload = sendType === 'generic' ? { email, clientName: name, body, subject: subj } : { email, clientName: name, body };
          const r = await BSPortal.sendEmail(sendType, payload);
          if (r?.ok) return 'sent';
          showEmailFallback(email, subj, body, 'Automation email failed (' + (r?.error || 'unknown error') + '). Send manually:');
          return 'fallback';
        } catch(e) {
          showEmailFallback(email, subj, body, 'Automation email — send manually:');
          return 'fallback';
        }
      } else if (rule.action === 'task') {
        const desc = (rule.taskTemplate || rule.label || 'Task').replace(/\{name\}/g, name);
        const tasks = getDB('tasks') || [];
        tasks.push({ id: genId(), description: desc, leadId: lead.id, leadName: lead.name || '', completed: false, createdAt: new Date().toISOString() });
        setDB('tasks', tasks);
        return 'task_created';
      } else if (rule.action === 'advance') {
        await saveInquiryStatus_silent(lead.id, rule.toStage || lead.status);
        if (window._inquiries) { const i = window._inquiries.find(x=>x.id===lead.id); if(i) i.status=rule.toStage||i.status; }
        lead.status = rule.toStage || lead.status; lead.stageEnteredAt = new Date().toISOString();
        return 'advanced';
      }
      return 'noop';
    }

    async function runSingleAutomation(leadId, ruleId, skipIt) {
      const leads = window._inquiries || [];
      const lead  = leads.find(l => l.id === leadId);
      const rules = getDB('automations') || [];
      const rule  = rules.find(r => r.id === ruleId);
      if (!lead || !rule) return;
      if (skipIt) {
        if (!_alreadyFired(leadId, ruleId)) _logAutomation(leadId, ruleId, rule.action, 'skipped');
        showToast('Automation skipped', 'info');
      } else {
        if (!(await _claimFire(leadId, ruleId, rule.action))) { showToast('Already handled', 'info'); openInquiry(leadId); return; }
        const result = await _executeAutoAction(rule, lead);
        _logAutomation(leadId, ruleId, rule.action, result);
        showToast('Automation fired', 'success');
      }
      // Refresh inquiry view
      openInquiry(leadId);
    }

    // One-time migration: rewrite stored default rules that still carry template values send-email does not accept
    function _migrateAutomationRules() {
      const all = getDB('automations');
      if (!Array.isArray(all)) return;
      let changed = false;
      all.forEach(r => {
        if (r.id === 'auto3' && r.template === 'quote_followup') {
          r.template = 'generic'; r.subject = 'Checking in on your quote';
          if (r.emailBody === 'Wanted to make sure the quote landed. Any questions, I\'m here.') {
            r.emailBody = 'Wanted to make sure your quote landed. If anything in it is unclear, or you want to adjust the hours or the lineup to fit your budget, just reply here and we will work it out. How does that sound?';
          }
          changed = true;
        } else if (r.id === 'auto7' && r.template === 'final_details') {
          r.template = 'generic'; r.subject = 'Final details for your event';
          if (r.emailBody === 'Your event is coming up. Let\'s make sure everything is locked in.') {
            r.emailBody = 'Your event is coming up and we love this part. Take a few minutes to look over the timeline, the music, and the vendor list, and send me anything that has changed. You enjoy the build-up. We will handle the rest.';
          }
          changed = true;
        } else if (r.id === 'auto5' && r.action === 'email' && r.template === 'client_invite') {
          r.action = 'task'; delete r.template; delete r.emailBody;
          r.label = 'Booked — send portal invite to {name}';
          r.taskTemplate = 'Send portal invite to {name}';
          changed = true;
        }
      });
      if (changed) setDB('automations', all);
    }

    let _engineBusy = false;
    async function _runAutomationEngine() {
      if (_engineBusy) return;
      _engineBusy = true;
      try {
      _migrateAutomationRules();
      const rules = (getDB('automations') || []).filter(r => r.enabled);
      if (!rules.length) return;
      // Load leads here instead of relying on the Pipeline tab having been opened.
      let leads;
      try { leads = await _fetchInquiryRows(200); } catch (e) { return; }
      if (!window._inquiries && leads.length) window._inquiries = leads.slice(0, 50);
      const baseMs = _autoBaselineMs();
      for (const lead of leads) {
        const now      = Date.now();
        const enteredAt = lead.stageEnteredAt || lead.created_at;
        const enteredMs = enteredAt ? new Date(enteredAt).getTime() : now;
        if (enteredMs < baseMs) continue; // pre-existing lead: engine only handles leads that entered a stage after it was switched on
        const daysInStage = (now - enteredMs) / 86400000;
        for (const rule of rules) {
          if (_alreadyFired(lead.id, rule.id)) continue;
          const matchStage = rule.stage && rule.stage === (lead.status || 'new');
          const matchDays = rule.trigger === 'after_days' && matchStage && daysInStage >= (rule.days || 0);
          const matchEnter = rule.trigger === 'enter' && matchStage;
          const matchEventDay = rule.trigger === 'days_before_event' && lead.event_date && (() => {
            const diff = (new Date(lead.event_date).getTime() - now) / 86400000;
            return diff >= 0 && diff <= (rule.days || 21);
          })();
          if (matchEnter || matchDays || matchEventDay) {
            if (!(await _claimFire(lead.id, rule.id, rule.action))) continue;
            let result;
            try { result = await _executeAutoAction(rule, lead); } catch (e) { result = 'error'; }
            _logAutomation(lead.id, rule.id, rule.action, result);
          }
        }
      }
      const _tc = document.getElementById('dashTasksCard'); if (_tc) _tc.outerHTML = _renderTasksCard();
      } finally { _engineBusy = false; }
    }

    function renderAutomationLog(leadId) {
      const logs  = (_getAutoLogs()[leadId] || []).slice().reverse();
      const rules = getDB('automations') || [];
      if (!logs.length) return `<div style="font-size:12px;color:var(--gray);padding:8px 0;">No automation activity yet.</div>`;
      return logs.map(l => {
        const rule = rules.find(r => r.id === l.ruleId);
        const label = rule?.label || l.ruleId;
        const when  = l.at ? timeAgo(l.at) : '';
        const badge = { sent:'✅',task_created:'📋',skipped:'⏭',fallback:'✉',advanced:'→',noop:'—' }[l.result] || '·';
        const isPending = false; // already fired
        return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">
          <span>${badge}</span>
          <span style="flex:1;color:rgba(255,255,255,0.7);">${label}</span>
          <span style="color:var(--gray);">${l.result} · ${when}</span>
        </div>`;
      }).join('');
    }

    function renderPendingAutomations(lead) {
      const rules = (getDB('automations') || []).filter(r => r.enabled);
      const now   = Date.now();
      const enteredMs = lead.stageEnteredAt ? new Date(lead.stageEnteredAt).getTime() : (lead.created_at ? new Date(lead.created_at).getTime() : now);
      const daysInStage = (now - enteredMs) / 86400000;
      const pending = [];
      rules.forEach(rule => {
        if (_alreadyFired(lead.id, rule.id)) return;
        const matchStage = rule.stage && rule.stage === (lead.status || 'new');
        const matchDays  = rule.trigger === 'after_days' && matchStage;
        const matchEnter = rule.trigger === 'enter' && matchStage;
        if ((matchEnter || matchDays) && matchStage) {
          const daysLeft = matchDays ? Math.max(0, (rule.days || 0) - daysInStage) : 0;
          pending.push({ rule, daysLeft });
        }
      });
      if (!pending.length) return '';
      return `<div style="margin-top:6px;">` + pending.map(p => {
        const when = p.daysLeft < 0.5 ? 'fires now' : `fires in ~${Math.ceil(p.daysLeft)} day${Math.ceil(p.daysLeft)===1?'':'s'}`;
        return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">
          <span style="flex:1;color:rgba(255,255,255,0.65);">⏳ ${p.rule.label} <span style="color:var(--gray);">(${when})</span></span>
          <button onclick="runSingleAutomation('${lead.id}','${p.rule.id}',false)" style="padding:3px 9px;background:rgba(31,163,224,0.15);border:1px solid rgba(31,163,224,0.65);color:#1FA3E0;border-radius:5px;font-size:12px;cursor:pointer;">Run now</button>
          <button onclick="runSingleAutomation('${lead.id}','${p.rule.id}',true)"  style="padding:3px 9px;background:rgba(255,255,255,0.05);border:1px solid var(--border-ui);color:rgba(255,255,255,0.5);border-radius:5px;font-size:12px;cursor:pointer;">Skip</button>
        </div>`;
      }).join('') + `</div>`;
    }

    // Stage-jump modal: called when lead advances more than 1 step
    const STAGE_ORDER = ['new','contacted','quoted','booked','archived'];
    let _stagePendingRules = [];
    let _stagePendingLeadId = null;

    async function setInquiryStageWithCheck(leadId, newStage) {
      const lead = (window._inquiries || []).find(l => l.id === leadId);
      if (!lead) return;
      const curIdx = STAGE_ORDER.indexOf(lead.status || 'new');
      const newIdx = STAGE_ORDER.indexOf(newStage);
      const skipping = newIdx - curIdx > 1;
      if (skipping) {
        // Collect all rules that would fire for intermediate stages
        const rules = (getDB('automations') || []).filter(r => r.enabled);
        const inBetween = STAGE_ORDER.slice(curIdx + 1, newIdx);
        const applicable = rules.filter(r => inBetween.includes(r.stage) && !_alreadyFired(leadId, r.id));
        if (applicable.length) {
          _stagePendingRules   = applicable;
          _stagePendingLeadId  = leadId;
          _showStageJumpModal(lead, curIdx, newIdx, newStage, applicable);
          return;
        }
      }
      // No modal needed — proceed
      await _doSetStage(leadId, newStage);
    }

    function _showStageJumpModal(lead, curIdx, newIdx, toStage, applicable) {
      const fromLabel = STAGE_ORDER[curIdx];
      const toLabel   = toStage;
      const existing  = document.getElementById('stageJumpModal');
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.id = 'stageJumpModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:2000;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:#111118;border:1px solid rgba(31,163,224,0.25);border-radius:14px;padding:28px 24px;width:400px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.7);animation:scaleIn 0.18s ease forwards;">
          <div style="font-family:var(--font-head);font-size:20px;margin-bottom:8px;">Stage Jump</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:18px;">
            Moving <strong style="color:#fff">${lead.name}</strong> from <span style="color:#1FA3E0">${fromLabel}</span> → <span style="color:#2ecc71">${toLabel}</span>.
            ${applicable.length} automation${applicable.length===1?'':'s'} would normally fire in between.
          </div>
          <div style="margin-bottom:18px;">
            ${applicable.map(r => `
              <label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;cursor:pointer;">
                <input type="checkbox" checked value="${r.id}" style="accent-color:#1FA3E0;">
                ${r.label}
              </label>`).join('')}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="_resolveStageJump('${lead.id}','${toStage}','run')" style="flex:1;padding:10px;background:#1FA3E0;border:none;border-radius:7px;color:#000;font-weight:700;cursor:pointer;font-size:13px;font-family:'Barlow',sans-serif;">Run checked</button>
            <button onclick="_resolveStageJump('${lead.id}','${toStage}','skip')" style="flex:1;padding:10px;background:rgba(255,255,255,0.07);border:1px solid var(--border-ui);border-radius:7px;color:#fff;cursor:pointer;font-size:13px;font-family:'Barlow',sans-serif;">Skip all</button>
            <button onclick="document.getElementById('stageJumpModal').remove();" style="padding:10px 14px;background:none;border:1px solid var(--border-ui);border-radius:7px;color:rgba(255,255,255,0.55);cursor:pointer;font-size:13px;font-family:'Barlow',sans-serif;">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    async function _resolveStageJump(leadId, toStage, mode) {
      // BUG FIX: Read checkbox selections BEFORE removing the modal
      const checked = mode === 'run'
        ? [...document.querySelectorAll('#stageJumpModal input[type=checkbox]:checked')].map(c => c.value)
        : [];
      document.getElementById('stageJumpModal')?.remove();
      const rules = _stagePendingRules;
      if (mode === 'run') {
        // Run only the rules the user checked; if somehow none were checked, run all
        const toRun = checked.length ? rules.filter(r => checked.includes(r.id)) : rules;
        for (const r of toRun) {
          const lead = (window._inquiries||[]).find(l=>l.id===leadId);
          if (lead && await _claimFire(leadId, r.id, r.action)) { const res = await _executeAutoAction(r, lead); _logAutomation(leadId, r.id, r.action, res); }
        }
        rules.filter(r => !toRun.includes(r) && !_alreadyFired(leadId, r.id)).forEach(r => _logAutomation(leadId, r.id, r.action, 'skipped'));
      } else {
        rules.filter(r => !_alreadyFired(leadId, r.id)).forEach(r => _logAutomation(leadId, r.id, r.action, 'skipped'));
      }
      await _doSetStage(leadId, toStage);
    }

    async function _doSetStage(leadId, newStage) {
      document.querySelectorAll('.stage-step').forEach(el => el.classList.toggle('active', el.textContent.trim() === newStage));
      const inq = (window._inquiries||[]).find(i=>i.id===leadId);
      if (inq) { inq.prevStatus = inq.status; inq.status = newStage; inq.stageEnteredAt = new Date().toISOString(); }
      await saveInquiryStatus_silent(leadId, newStage);
      showToast('Stage updated to ' + newStage, 'success');
      // Refresh view to show updated automation log
      setTimeout(() => openInquiry(leadId), 300);
    }

    function renderAutomations() {
      const rules = (getDB('automations') || []);
      let html = '';
      rules.forEach(rule => {
        html += `<div class="automation-card">
          <div class="automation-card-content">
            <div class="automation-card-name">${esc(rule.label || rule.name || rule.id)}</div>
            <div class="automation-card-trigger" style="font-size:12px;color:var(--gray);">${typeof rule.trigger === 'object' ? 'Trigger: ' + esc(getTriggerDescription(rule.trigger)) + ' · Action: ' + esc(getActionDescription(rule.action || {})) : `Stage: ${rule.stage || 'any'} · Trigger: ${rule.trigger}${rule.days?' ('+rule.days+' days)':''} · Action: ${rule.action}`}</div>
          </div>
          <div class="automation-card-actions">${typeof rule.trigger === 'object' ? `<button class="btn btn-secondary" onclick="deleteAutomationRule('${rule.id}')" style="padding:6px 10px;font-size:12px;">Delete</button>` : ''}
            <label class="toggle-switch" style="margin:0;">
              <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleAutomationRule('${rule.id}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>`;
      });
      const container = document.getElementById('automationsContainer');
      if (container) container.innerHTML = html || '<p style="color:var(--gray);font-size:13px;">No rules.</p>';
      const noMsg = document.getElementById('noAutomationsMessage');
      if (noMsg) noMsg.style.display = rules.length > 0 ? 'none' : 'block';
      // Honesty note
      const layout = document.getElementById('automationsLayout');
      if (layout && !document.getElementById('autoHonesty')) {
        const note = document.createElement('div');
        note.id = 'autoHonesty';
        note.style.cssText = 'margin-top:12px;padding:12px 16px;background:rgba(243,156,18,0.08);border:1px solid rgba(243,156,18,0.2);border-radius:8px;font-size:12px;color:rgba(243,156,18,0.8);';
        note.textContent = 'Timed automations fire when the portal is open. Keep a tab open on event days or check in daily.';
        layout.appendChild(note);
      }
    }
