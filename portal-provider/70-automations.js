// ============================================================================
// portal-provider/70-automations.js  -  automations: rules UI, engine, logs, stage-jump prompts
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── P7 shared helpers (used by 70, 75 and 80). Call-time only. Files that tests extract call them behind typeof. ──
    function _p7Icon(name, size) { return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(name, size || 16) : ''; }
    // The screen's page-head buttons. switchSection empties #pageActions, so a screen writes them from its render function.
    function _p7Actions(sectionId, html) {
      const sec = document.getElementById(sectionId), pa = document.getElementById('pageActions');
      if (sec && pa && sec.classList && sec.classList.contains('active')) pa.innerHTML = html || '';
    }
    function _p7CloseSheet(id) {
      const d = document.getElementById(id);
      if (!d) return;
      if (window.CRMUI && CRMUI.close) CRMUI.close(d, { force: true });
      else if (d.parentNode) d.parentNode.removeChild(d);
    }
    // Primary button of a built sheet: submit the sheet's form (so native validation runs) and keep the sheet open.
    // The form's own submit handler closes the sheet once it has saved.
    function _p7Submit(d) {
      const f = d && d.querySelector('form');
      if (!f) return false;
      if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return false;
    }
    // Display only: stored labels keep their dashes, the screen shows a colon.
    function _p7Dash(s) { return String(s == null ? '' : s).replace(/\s*[—–]\s*/g, ': '); }

    // ── Automations screen ────────────────────────────────────────────────────
    function _autoStageName(s) {
      const m = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', booked: 'Booked', archived: 'Archived' };
      if (m[s]) return m[s];
      const t = String(s || 'any stage');
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    function _autoPlural(n, word) { n = Number(n) || 0; return n + ' ' + word + (n === 1 ? '' : 's'); }

    // One sentence per rule, built from the rule's own fields (never from stored label text alone).
    function _autoSentence(rule) {
      const q = t => '"' + _p7Dash(t) + '"';
      if (rule && rule.trigger && typeof rule.trigger === 'object') {
        const tg = rule.trigger, ac = rule.action || {};
        const when = tg.type === 'status_change' ? 'When an event moves to ' + _autoStageName(tg.value)
          : tg.type === 'deposit_received' ? 'When a deposit is marked received'
          : tg.type === 'balance_received' ? 'When a balance is marked received'
          : tg.type === 'new_lead' ? 'When a new lead comes in'
          : tg.type === 'new_event' ? 'When an event is created'
          : tg.type === 'days_before' ? 'When an event is ' + _autoPlural(tg.value, 'day') + ' away'
          : tg.type === 'days_after' ? 'When an event was ' + _autoPlural(tg.value, 'day') + ' ago'
          : 'When ' + String(getTriggerDescription(tg)).toLowerCase();
        const then = ac.type === 'notification' ? 'show ' + q(ac.message)
          : ac.type === 'create_task' ? 'add the task ' + q(ac.task)
          : ac.type === 'add_note' ? 'add the note ' + q(ac.note)
          : ac.type === 'change_status' ? 'change the event status to ' + _autoStageName(ac.status)
          : ac.type === 'flag_review' ? 'flag the event for review'
          : String(getActionDescription(ac)).toLowerCase();
        return when + ', ' + then + '.';
      }
      const stage = _autoStageName(rule && rule.stage);
      let when;
      if (rule.trigger === 'enter') when = rule.stage === 'new' ? 'When a lead is new' : 'When a lead moves to ' + stage;
      else if (rule.trigger === 'after_days') when = 'When a lead has been in ' + stage + ' for ' + _autoPlural(rule.days, 'day');
      else if (rule.trigger === 'days_before_event') when = 'When an event is ' + _autoPlural(rule.days || 21, 'day') + ' away';
      else when = 'When ' + String(rule.trigger || 'this happens');
      let then;
      if (rule.action === 'email') then = 'send ' + q(rule.label || 'an email');
      else if (rule.action === 'task') then = 'add the task ' + q(rule.taskTemplate || rule.label || 'Task');
      else if (rule.action === 'advance') then = 'move the lead to ' + _autoStageName(rule.toStage);
      else then = String(rule.action || 'do something');
      return when + ', ' + then + (rule.trigger === 'enter' ? ' right away.' : '.');
    }

    function _autoKind(rule) {
      if (rule && typeof rule.trigger === 'object') {
        const t = (rule.action || {}).type;
        return t === 'notification' ? 'Notification' : t === 'create_task' ? 'Task' : t === 'add_note' ? 'Note' : t === 'change_status' ? 'Status' : 'Action';
      }
      return rule.action === 'email' ? 'Email' : rule.action === 'task' ? 'Task' : rule.action === 'advance' ? 'Move stage' : 'Action';
    }

    function _autoResultPill(result) {
      const m = { sent: ['pill-ok', 'Sent'], task_created: ['pill-ok', 'Task added'], advanced: ['pill-info', 'Moved'], skipped: ['pill-neutral', 'Skipped'],
        fallback: ['pill-danger', 'Failed, send by hand'], error: ['pill-danger', 'Failed'], pending: ['pill-warn', 'Pending'], noop: ['pill-neutral', 'No action'] };
      const x = m[result] || ['pill-neutral', String(result || 'Done')];
      return '<span class="pill ' + x[0] + ' pill-sm" data-ui="pill">' + esc(x[1]) + '</span>';
    }

    // The section shell is written once; render functions fill the mounts.
    function _autoShell() {
      const sec = document.getElementById('automations');
      if (!sec || sec.getAttribute('data-p7') === '1') return;
      sec.setAttribute('data-p7', '1');
      sec.innerHTML = `
        <div class="auto-wrap">
          <div class="banner banner-info" id="autoHonesty">${_p7Icon('info', 20)}<div class="banner-body">Timed automations fire when the portal is open. Keep a tab open on event days or check in daily.</div></div>
          <section class="auto-card" aria-labelledby="autoRulesH">
            <h3 class="auto-h" id="autoRulesH">Rules</h3>
            <div id="automationsContainer" class="auto-list"></div>
            <div id="noAutomationsMessage" class="empty" hidden>
              <h4 class="empty-title">No rules yet</h4>
              <p class="empty-text">A rule sends an email, adds a task or moves a lead when something happens.</p>
              <button type="button" class="btn btn-secondary" onclick="openAutomationEditor()">Create your first rule</button>
            </div>
          </section>
          <section class="auto-card" aria-labelledby="autoLogH">
            <h3 class="auto-h" id="autoLogH">Recent activity</h3>
            <div id="autoLogList"></div>
          </section>
        </div>`;
    }

    function renderAutomations() {
      const rules = getDB('automations') || [];
      _autoShell();
      const rows = rules.map(rule => {
        const on = !!rule.enabled;
        const custom = typeof rule.trigger === 'object';
        const nm = _p7Dash(rule.label || rule.name || rule.id);
        const id = esc(rule.id);
        return `<div class="auto-row${on ? '' : ' is-off'}" data-rule="${id}">
          <div class="auto-main">
            <div class="auto-sentence"${custom ? ' data-user-content' : ''}>${esc(_autoSentence(rule))}</div>
            <div class="auto-meta"><span class="pill pill-neutral pill-sm" data-ui="pill">${esc(_autoKind(rule))}</span>${on ? '' : '<span class="auto-paused">Paused</span>'}</div>
          </div>
          <div class="auto-trail">
            <button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(nm)}" onclick="_autoSwitch(this,'${id}')"></button>
            <button type="button" class="btn btn-ghost btn-icon" aria-label="More actions for ${esc(nm)}" aria-haspopup="menu" onclick="_autoMenu(this,'${id}')">${_p7Icon('ellipsis-vertical', 20)}</button>
          </div>
        </div>`;
      }).join('');
      const list = document.getElementById('automationsContainer');
      if (list) list.innerHTML = rows;
      const none = document.getElementById('noAutomationsMessage');
      if (none) none.hidden = rules.length > 0;
      _autoRenderLog();
      _p7Actions('automations', `<button type="button" class="btn btn-primary" onclick="openAutomationEditor()">${_p7Icon('plus', 18)} New rule</button>`);
    }

    function _autoSwitch(btn, ruleId) {
      const on = btn.getAttribute('aria-checked') !== 'true';
      toggleAutomationRule(ruleId, on);
      renderAutomations();
      const again = document.querySelector('.auto-row[data-rule="' + ruleId + '"] .switch');
      if (again) again.focus();
    }

    function _autoMenu(btn, ruleId) {
      if (!window.CRMUI || !CRMUI.menu) return;
      const rule = (getDB('automations') || []).find(r => r.id === ruleId);
      const items = [{ label: 'Edit', icon: 'pencil', onSelect: () => openAutomationEditor(ruleId) }];
      // Built-in pipeline rules (string trigger) can be switched off or edited, not deleted, same as before the redesign.
      if (rule && typeof rule.trigger === 'object') items.push({ label: 'Delete', icon: 'trash-2', danger: true, onSelect: () => deleteAutomationRule(ruleId) });
      CRMUI.menu(btn, items, { align: 'right' });
    }

    // Recent activity across all leads (the per-lead view is renderAutomationLog below).
    function _autoRenderLog() {
      const mount = document.getElementById('autoLogList');
      if (!mount) return;
      const logs = _getAutoLogs(), rules = getDB('automations') || [], leads = window._inquiries || [];
      const all = [];
      Object.keys(logs).forEach(id => (logs[id] || []).forEach(l => all.push(Object.assign({ leadId: id }, l))));
      all.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      if (!all.length) { mount.innerHTML = '<p class="t-meta">No automation activity yet.</p>'; return; }
      mount.innerHTML = all.slice(0, 12).map(l => {
        const rule = rules.find(r => r.id === l.ruleId);
        const lead = leads.find(x => String(x.id) === String(l.leadId));
        const failed = l.result === 'error' || l.result === 'fallback';
        return `<div class="auto-log-row${failed ? ' is-failed' : ''}">
          ${_autoResultPill(l.result)}
          <span class="auto-log-what">${esc(_p7Dash((rule && rule.label) || l.ruleId))}${lead ? ' <span class="auto-log-who" data-user-content>for ' + esc(lead.name || 'a lead') + '</span>' : ''}</span>
          <span class="auto-log-when">${esc(l.at ? timeAgo(l.at) : '')}</span>
        </div>`;
      }).join('');
    }

    // Create (no id) or edit (id). Rules written by the builder get the trigger/action form; the built-in pipeline rules
    // get a small form for their wording and timing. Rule ids and keys are never changed here.
    function openAutomationEditor(ruleId) {
      window._autoEditingId = ruleId || null;
      _p7CloseSheet('autoSheet');
      const rule = ruleId ? (getDB('automations') || []).find(r => r.id === ruleId) : null;
      if (ruleId && !rule) return;
      if (rule && typeof rule.trigger !== 'object') { _autoEditPipelineRule(rule); return; }
      const trigOpts = [['status_change', 'An event moves to a new status'], ['deposit_received', 'A deposit is marked received']];
      const actOpts = [['notification', 'Show a notification on Home'], ['create_task', 'Create a task'], ['add_note', 'Add a note to the event']];
      if (rule && !trigOpts.some(o => o[0] === rule.trigger.type)) trigOpts.push([rule.trigger.type, String(getTriggerDescription(rule.trigger))]);
      if (rule && rule.action && !actOpts.some(o => o[0] === rule.action.type)) actOpts.push([rule.action.type, String(getActionDescription(rule.action))]);
      const opt = o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`;
      const html = `<form id="automationBuilderForm" onsubmit="saveNewAutomation(event)">
        <div class="field"><label class="field-label" for="automationRuleName">Rule name</label>
          <input type="text" id="automationRuleName" class="form-input automation-builder-input" placeholder="e.g. New booking alert" required></div>
        <fieldset class="auto-fs"><legend>When</legend>
          <div class="field"><label class="field-label" for="automationTriggerType">Trigger</label>
            <select id="automationTriggerType" class="form-select automation-builder-select" onchange="updateTriggerOptions()" required><option value="">Choose a trigger</option>${trigOpts.map(opt).join('')}</select></div>
        </fieldset>
        <fieldset class="auto-fs" id="autoOnlyIf" hidden><legend>Only if</legend><div id="triggerOptionsContainer"></div></fieldset>
        <fieldset class="auto-fs"><legend>Then</legend>
          <div class="field"><label class="field-label" for="automationActionType">Action</label>
            <select id="automationActionType" class="form-select automation-builder-select" onchange="updateActionOptions()" required><option value="">Choose an action</option>${actOpts.map(opt).join('')}</select></div>
          <div id="actionOptionsContainer"></div>
        </fieldset>
      </form>`;
      CRMUI.sheet({ id: 'autoSheet', drawer: true, title: rule ? 'Edit rule' : 'New rule', html,
        primary: { label: 'Save rule', onClick: _p7Submit }, secondary: { label: 'Cancel' } });
      if (rule) {
        const g = id => document.getElementById(id);
        g('automationRuleName').value = rule.name || rule.label || '';
        g('automationTriggerType').value = rule.trigger.type || '';
        updateTriggerOptions();
        if (g('triggerValue')) g('triggerValue').value = rule.trigger.value || '';
        const at = (rule.action || {}).type || '';
        g('automationActionType').value = at;
        updateActionOptions();
        if (g('actionValue')) g('actionValue').value = (rule.action || {}).message || (rule.action || {}).task || (rule.action || {}).note || (rule.action || {}).status || '';
      }
    }

    function _autoEditPipelineRule(rule) {
      const hasDays = rule.trigger === 'after_days' || rule.trigger === 'days_before_event';
      const isEmail = rule.action === 'email', isTask = rule.action === 'task';
      const html = `<form id="autoEditForm" onsubmit="saveAutomationEdit(event)">
        <p class="field-hint" style="margin-bottom:var(--sp-4);">${esc(_autoSentence(rule))}</p>
        <div class="field"><label class="field-label" for="autoEditName">Rule name</label>
          <input type="text" id="autoEditName" class="form-input" value="${esc(_p7Dash(rule.label || ''))}" required></div>
        ${hasDays ? `<div class="field"><label class="field-label" for="autoEditDays">${rule.trigger === 'after_days' ? 'Days in the stage before it runs' : 'Days before the event'}</label>
          <input type="number" id="autoEditDays" class="form-input" value="${esc(rule.days || 0)}" min="0" max="365" inputmode="numeric"></div>` : ''}
        ${isEmail ? `<div class="field"><label class="field-label" for="autoEditSubject">Email subject</label>
          <input type="text" id="autoEditSubject" class="form-input" value="${esc(rule.subject || '')}" placeholder="From Baseline Studio"></div>
        <div class="field"><label class="field-label" for="autoEditBody">Email message</label>
          <textarea id="autoEditBody" class="form-textarea" rows="6">${esc(rule.emailBody || '')}</textarea>
          <span class="field-hint">{name} becomes the lead's name.</span></div>` : ''}
        ${isTask ? `<div class="field"><label class="field-label" for="autoEditTask">Task text</label>
          <input type="text" id="autoEditTask" class="form-input" value="${esc(rule.taskTemplate || '')}">
          <span class="field-hint">{name} becomes the lead's name.</span></div>` : ''}
      </form>`;
      CRMUI.sheet({ id: 'autoSheet', drawer: true, title: 'Edit rule', html,
        primary: { label: 'Save rule', onClick: _p7Submit }, secondary: { label: 'Cancel' } });
    }

    function saveAutomationEdit(e) {
      e.preventDefault();
      const rules = getDB('automations') || [];
      const rule = rules.find(r => r.id === window._autoEditingId);
      if (!rule) { _p7CloseSheet('autoSheet'); return; }
      const v = id => { const el = document.getElementById(id); return el ? el.value : null; };
      const name = (v('autoEditName') || '').trim();
      if (!name) { showToast('Give the rule a name.', 'warning'); return; }
      rule.label = name;
      if (v('autoEditDays') !== null) rule.days = Math.max(0, Math.min(365, parseInt(v('autoEditDays'), 10) || 0));
      if (v('autoEditSubject') !== null) rule.subject = v('autoEditSubject').trim();
      if (v('autoEditBody') !== null) rule.emailBody = v('autoEditBody');
      if (v('autoEditTask') !== null) rule.taskTemplate = v('autoEditTask').trim() || rule.taskTemplate;
      setDB('automations', rules);
      window._autoEditingId = null;
      _p7CloseSheet('autoSheet');
      renderAutomations();
      showToast('Rule updated', 'success');
    }

    // Automation builder functions (the builder writes rules with an object trigger; the pipeline engine reads string triggers)
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
          <div class="field"><label class="field-label" for="triggerValue">Status</label>
          <select id="triggerValue" class="form-select automation-builder-select" required>
            <option value="">Choose a status</option>
            <option value="proposal">Proposal</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
          </select></div>
        `;
      } else if (triggerType === 'days_before' || triggerType === 'days_after') {
        html = `
          <div class="field"><label class="field-label" for="triggerValue">Number of days</label>
          <input type="number" id="triggerValue" class="form-input automation-builder-number" placeholder="Number of days" min="1" max="365" inputmode="numeric" required></div>
        `;
      }

      document.getElementById('triggerOptionsContainer').innerHTML = html;
      const fs = document.getElementById('autoOnlyIf');
      if (fs) fs.hidden = !html;
    }

    function updateActionOptions() {
      const actionType = document.getElementById('automationActionType').value;
      let html = '';
      const text = (label, ph) => `<div class="field"><label class="field-label" for="actionValue">${label}</label><input type="text" id="actionValue" class="form-input automation-builder-input" placeholder="${ph}" required></div>`;

      if (actionType === 'notification') {
        html = text('Message', 'Enter notification message');
      } else if (actionType === 'create_task') {
        html = text('Task', 'Enter task description');
      } else if (actionType === 'change_status') {
        html = `
          <div class="field"><label class="field-label" for="actionValue">Status</label>
          <select id="actionValue" class="form-select automation-builder-select" required>
            <option value="">Choose a status</option>
            <option value="proposal">Proposal</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
          </select></div>
        `;
      } else if (actionType === 'add_note') {
        html = text('Note', 'Enter note text');
      }

      document.getElementById('actionOptionsContainer').innerHTML = html;
    }

    function saveNewAutomation(e) {
      e.preventDefault();
      const ruleName = document.getElementById('automationRuleName').value.trim();
      const triggerType = document.getElementById('automationTriggerType').value;
      const triggerValue = document.getElementById('triggerValue')?.value || '';
      const actionType = document.getElementById('automationActionType').value;
      const actionValue = document.getElementById('actionValue')?.value || '';

      if (!ruleName || !triggerType || !actionType) {
        showToast('Fill in the rule name, the trigger and the action.', 'warning');
        return;
      }

      const automationRules = (getDB('automations') || []);
      const editing = window._autoEditingId ? automationRules.find(r => r.id === window._autoEditingId) : null;
      if (editing) {
        editing.name = ruleName;
        editing.trigger = { type: triggerType, value: triggerValue };
        editing.action = createActionObject(actionType, actionValue);
      } else {
        automationRules.push({
          id: genId(),
          name: ruleName,
          enabled: true,
          trigger: { type: triggerType, value: triggerValue },
          action: createActionObject(actionType, actionValue),
          createdAt: new Date().toISOString()
        });
      }
      setDB('automations', automationRules);
      window._autoEditingId = null;

      _p7CloseSheet('autoSheet');
      renderAutomations();
      showToast(editing ? 'Rule updated' : 'Rule created', 'success');
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

    // Is this email rule marketing (nurture, follow-up, review request) or transactional (about something they asked for or booked)?
    // Marketing rules honor the opt-out list. Transactional ones never do. Unsure means marketing, the safe side:
    //   transactional: only the two seed rules auto1 (acknowledge an inquiry) and auto7 (final details before the event), any rule in the booked
    //                  stage, the invoice/quote/invite/thank-you templates, and a rule that carries marketing:false on purpose.
    //   marketing:     everything else, including the quote follow-up (auto3), any new-lead or days-before-event email someone adds later,
    //                  and every rule Ask creates (those carry marketing:true).
    // rule.marketing === true or false overrides the guess. Rule keys and seed labels are untouched.
    function _autoIsMarketing(rule) {
      if (!rule || rule.action !== 'email') return false;
      if (rule.marketing === true) return true;
      if (rule.marketing === false) return false;
      if (rule.createdBy === 'ask') return true;
      if (rule.id === 'auto1' || rule.id === 'auto7') return false;
      if (rule.stage === 'booked') return false;
      if (['quote', 'invoice', 'client_invite', 'provider_invite', 'contact_thankyou', 'internal_lead'].includes(rule.template)) return false;
      return true;
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
        const marketing = sendType === 'generic' && _autoIsMarketing(rule);
        if (marketing && typeof _optoutIs === 'function' && _optoutIs(email)) return 'skipped'; // opted out of marketing email: do not send
        try {
          const payload = sendType === 'generic' ? { email, clientName: name, body, subject: subj } : { email, clientName: name, body };
          if (marketing) payload.marketing = true; // the server re-checks the list and adds the unsubscribe link
          const r = await BSPortal.sendEmail(sendType, payload);
          if (r?.ok && r.skipped === 'opted_out') return 'skipped';
          if (r?.ok) return 'sent';
          if (marketing) { showToast('Automation email was not sent (' + (r?.error || 'unknown error') + '). Nothing went out.', 'error'); return 'error'; } // fail closed: no manual fallback for marketing
          showEmailFallback(email, subj, body, 'Automation email failed (' + (r?.error || 'unknown error') + '). Send manually:');
          return 'fallback';
        } catch(e) {
          if (marketing) { showToast('Automation email was not sent. Nothing went out.', 'error'); return 'error'; }
          showEmailFallback(email, subj, body, 'Automation email failed. Send it manually:');
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
      if (typeof loadOptouts === 'function') { try { await loadOptouts(); } catch (e) { /* the server still checks the list */ } }
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
      if (!logs.length) return `<p class="t-meta" style="padding:var(--sp-2) 0;">No automation activity yet.</p>`;
      return `<div class="auto-log">` + logs.map(l => {
        const rule = rules.find(r => r.id === l.ruleId);
        const label = _p7Dash((rule && rule.label) || l.ruleId);
        const when  = l.at ? timeAgo(l.at) : '';
        const failed = l.result === 'error' || l.result === 'fallback';
        return `<div class="auto-log-row${failed ? ' is-failed' : ''}">
          ${_autoResultPill(l.result)}
          <span class="auto-log-what">${esc(label)}</span>
          <span class="auto-log-when">${esc(when)}</span>
        </div>`;
      }).join('') + `</div>`;
    }

    // Run now from the lead sheet. An email rule sends a real email, so it names the recipient and asks first.
    async function _autoRunNow(leadId, ruleId) {
      const lead = (window._inquiries || []).find(l => l.id === leadId);
      const rule = (getDB('automations') || []).find(r => r.id === ruleId);
      if (rule && rule.action === 'email' && lead) {
        const to = lead.email ? (lead.name ? lead.name + ' (' + lead.email + ')' : lead.email) : (lead.name || 'this lead');
        const ok = await CRMUI.confirm({ title: 'Send this email now?', body: '"' + _p7Dash(rule.label || 'Email') + '" goes to ' + to + ' right away. It cannot be undone.', confirmLabel: 'Send now' });
        if (!ok) return;
      }
      runSingleAutomation(leadId, ruleId, false);
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
      return `<div class="auto-log">` + pending.map(p => {
        const when = p.daysLeft < 0.5 ? 'runs now' : `runs in about ${Math.ceil(p.daysLeft)} day${Math.ceil(p.daysLeft)===1?'':'s'}`;
        return `<div class="auto-log-row">
          <span class="auto-log-what">${_p7Icon('clock', 14)} ${esc(_p7Dash(p.rule.label))} <span class="auto-log-when">(${when})</span></span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="_autoRunNow('${esc(lead.id)}','${esc(p.rule.id)}')">Run now</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="runSingleAutomation('${esc(lead.id)}','${esc(p.rule.id)}',true)">Skip</button>
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
      _closeStageJump();
      const modal = document.createElement('div');
      modal.id = 'stageJumpModal';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal" style="--mw:420px" role="document">
          <div class="modal-title">Stage jump</div>
          <p class="dlg-text" style="margin-bottom:var(--sp-4);">
            Moving <strong data-user-content>${esc(lead.name)}</strong> from ${esc(_autoStageName(fromLabel))} to ${esc(_autoStageName(toLabel))}.
            ${applicable.length} automation${applicable.length===1?'':'s'} would normally run in between.
          </p>
          <div style="margin-bottom:var(--sp-4);">
            ${applicable.map(r => `
              <label class="check" style="display:flex;width:100%;">
                <input type="checkbox" checked value="${esc(r.id)}">
                <span class="check-box" aria-hidden="true"></span>
                <span class="check-text">${esc(_p7Dash(r.label))}</span>
              </label>`).join('')}
          </div>
          <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap;justify-content:flex-end;">
            <button type="button" class="btn btn-ghost" onclick="_closeStageJump()">Cancel</button>
            <button type="button" class="btn btn-secondary" onclick="_resolveStageJump('${esc(lead.id)}','${esc(toStage)}','skip')">Skip all</button>
            <button type="button" class="btn btn-primary" onclick="_resolveStageJump('${esc(lead.id)}','${esc(toStage)}','run')">Run checked</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      if (window.CRMUI && CRMUI.open) CRMUI.open(modal); else modal.classList.add('active');
    }

    function _closeStageJump() {
      const el = document.getElementById('stageJumpModal');
      if (!el) return;
      if (window.CRMUI && CRMUI.close) CRMUI.close(el, { force: true });
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    async function _resolveStageJump(leadId, toStage, mode) {
      // BUG FIX: Read checkbox selections BEFORE removing the modal
      const checked = mode === 'run'
        ? [...document.querySelectorAll('#stageJumpModal input[type=checkbox]:checked')].map(c => c.value)
        : [];
      _closeStageJump();
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
