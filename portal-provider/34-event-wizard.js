// ============================================================================
// portal-provider/34-event-wizard.js  -  new-event wizard and the double-booking check
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A), redesigned in UI lane P2.
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// Four steps: Type and date, Client, Venue, Services. Step ids are wizStep0..3 (class wizard-step).
// ============================================================================

    const WIZ_TYPES = [
      { value: 'wedding', label: 'Wedding' },
      { value: 'quince', label: 'Quince/Sweet 16' },
      { value: 'sweet16', label: 'Sweet 16' },
      { value: 'mitzvah', label: 'Bar/Bat Mitzvah' },
      { value: 'corporate', label: 'Corporate' },
      { value: 'gala', label: 'Gala/Fundraiser' },
      { value: 'birthday', label: 'Birthday/Private Party' },
      { value: 'concert', label: 'Concert/Festival' }
    ];
    const WIZ_STEP_TITLES = ['Type and date', 'Client', 'Venue', 'Services'];

    function openNewEventModal(prefill) {
      const steps = [
        { title: WIZ_STEP_TITLES[0], content: renderEventTypeStep() + renderEventBasicsStep() },
        { title: WIZ_STEP_TITLES[1], content: renderEventClientStep() },
        { title: WIZ_STEP_TITLES[2], content: renderEventVenueStep() },
        { title: WIZ_STEP_TITLES[3], content: renderEventServicesStep() }
      ];

      let html = `<div class="wiz-progress" id="wizardProgress" aria-live="polite">Step 1 of ${steps.length}: ${steps[0].title}</div><div class="wiz-body">`;
      steps.forEach((step, idx) => {
        html += `<div id="wizStep${idx}" class="wizard-step" data-step="${idx}"${idx === 0 ? '' : ' hidden'}>${step.content}</div>`;
      });
      html += `</div><div class="wiz-foot"><button type="button" class="btn btn-secondary" id="wizardBack" onclick="wizardPrevStep()" hidden>Back</button><button type="button" class="btn btn-primary" id="wizardNext" onclick="wizardNextStep()">Next</button></div>`;

      document.getElementById('eventWizardSteps').innerHTML = html;
      window.currentWizardStep = 0;
      window.wizardData = {};
      window.wizardServices = {};
      // An inquiry can hand over what it knows (window.wizardPrefill). Used once.
      let pf = prefill || null;
      if (!pf && window.wizardPrefill && !window.wizardPrefill._used) { pf = window.wizardPrefill; window.wizardPrefill._used = true; }
      if (pf) _wizardApplyPrefill(pf);
      // Opening right after the inquiry window closes: wait for the route step-back to settle so it cannot close the wizard.
      if (typeof _routeBackPending !== 'undefined' && _routeBackPending) {
        let tries = 0;
        const t = setInterval(function () {
          if (!_routeBackPending || ++tries > 20) { clearInterval(t); openModal('newEventModal'); }
        }, 50);
      } else {
        openModal('newEventModal');
      }
    }

    function _wizardApplyPrefill(pf) {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
      if (pf.type) {
        window.wizardData.type = pf.type;
        window.wizardData.typeNeedsReview = !!pf.typeNeedsReview;
        if (!pf.typeNeedsReview) {
          const tile = document.querySelector('.event-type-tile[data-type="' + pf.type + '"]');
          if (tile) { tile.classList.add('is-selected'); tile.setAttribute('aria-pressed', 'true'); }
        }
      }
      if (pf.notes) window.wizardData.notes = pf.notes;
      set('wizardEventName', pf.name);
      set('wizardEventDate', pf.date);
      if (pf.date) _wizardCheckDate(pf.date);
      const clients = (getDB('clients') || []).filter(c => !c.archived);
      const known = pf.clientEmail ? clients.find(c => (c.email || '').toLowerCase() === String(pf.clientEmail).toLowerCase()) : null;
      if (known) {
        const sel = document.getElementById('wizardClientSelect');
        if (sel) { sel.value = known.id; selectWizardClient(known.id); }
      } else {
        set('wizardClientName', pf.clientName);
        set('wizardClientEmail', pf.clientEmail);
        set('wizardClientPhone', pf.clientPhone);
      }
      set('wizardVenueName', pf.venueName);
    }

    function renderEventTypeStep() {
      let html = '<div class="field"><span class="field-label" id="wizTypeLabel">Type of event</span><div class="wiz-types" role="group" aria-labelledby="wizTypeLabel">';
      WIZ_TYPES.forEach(t => {
        html += `<button type="button" class="event-type-tile wiz-type" data-type="${t.value}" aria-pressed="false" onclick="selectEventType('${t.value}', this)">${t.label}</button>`;
      });
      html += '</div></div>';
      return html;
    }

    function selectEventType(type, el) {
      document.querySelectorAll('.event-type-tile').forEach(t => { if (t.classList) t.classList.remove('is-selected'); if (t.setAttribute) t.setAttribute('aria-pressed', 'false'); });
      if (el && el.classList) el.classList.add('is-selected');
      if (el && el.setAttribute) el.setAttribute('aria-pressed', 'true');
      window.wizardData.type = type;
      window.wizardData.typeNeedsReview = false;
    }

    function renderEventBasicsStep() {
      return `<div class="field"><label class="field-label" for="wizardEventDate">Event date</label><input type="date" class="input" id="wizardEventDate" onchange="_wizardCheckDate(this.value)"><div class="field-hint wiz-avail" id="wizardAvail" aria-live="polite"></div><div class="field-msg" id="wizardDateMsg" role="alert" hidden></div></div>
        <div class="wiz-two"><div class="field"><label class="field-label" for="wizardStartTime">Start time</label><input type="time" class="input" id="wizardStartTime"></div><div class="field"><label class="field-label" for="wizardEndTime">End time</label><input type="time" class="input" id="wizardEndTime"></div></div>
        <div class="field"><label class="field-label" for="wizardEventName">Event name</label><input type="text" class="input" id="wizardEventName" placeholder="Smith Wedding"><div class="field-hint">Leave it blank and it is named after the client.</div></div>`;
    }

    function _wizardCheckDate(v) {
      const msg = document.getElementById('wizardDateMsg');
      if (msg && v) msg.hidden = true;
      if (typeof checkAvailability === 'function') { try { checkAvailability(v, 'wizardAvail'); } catch (e) {} }
    }

    function renderEventClientStep() {
      const clients = (getDB('clients') || []).filter(c => !c.archived);
      let html = `<div class="field"><label class="field-label" for="wizardClientSelect">Client</label><select class="input" id="wizardClientSelect" onchange="selectWizardClient(this.value)"><option value="new">New client</option>`;
      clients.forEach(c => { html += `<option value="${esc(c.id)}">${esc(c.name)}</option>`; });
      html += `</select></div><div id="wizardClientForm"><div class="field"><label class="field-label" for="wizardClientName">Name</label><input type="text" class="input" id="wizardClientName" autocomplete="off"></div><div class="field"><label class="field-label" for="wizardClientEmail">Email</label><input type="email" class="input" id="wizardClientEmail" inputmode="email" autocomplete="off" autocapitalize="off"></div><div class="field"><label class="field-label" for="wizardClientPhone">Phone</label><input type="tel" class="input" id="wizardClientPhone" inputmode="tel" autocomplete="off"></div></div><div class="field-msg" id="wizardClientMsg" role="alert" hidden></div>`;
      return html;
    }

    function selectWizardClient(clientId) {
      const form = document.getElementById('wizardClientForm');
      if (clientId === 'new') {
        delete window.wizardData.clientId;
        form.hidden = false;
      } else {
        const clients = getDB('clients');
        const client = clients.find(c => c.id === clientId);
        if (client) {
          window.wizardData.clientId = clientId;
          window.wizardData.clientName = client.name;
          window.wizardData.clientEmail = client.email;
          window.wizardData.clientPhone = client.phone;
          form.hidden = true;
        }
      }
    }

    function renderEventVenueStep() {
      const vendors = (getDB('vendors') || []).filter(v => (v.category || '').toLowerCase() === 'venue');
      let html = `<div class="field"><label class="field-label" for="wizardVenueSelect">Venue</label><select class="input" id="wizardVenueSelect" onchange="selectWizardVenue(this.value)"><option value="new">New venue</option>`;
      vendors.forEach(v => { html += `<option value="${esc(v.id)}">${esc(v.name)}</option>`; });
      html += `</select></div><div id="wizardVenueForm"><div class="field"><label class="field-label" for="wizardVenueName">Venue name</label><input type="text" class="input" id="wizardVenueName" autocomplete="off"></div><div class="field"><label class="field-label" for="wizardVenueAddress">Address</label><input type="text" class="input" id="wizardVenueAddress" autocomplete="off"></div></div>`;
      return html;
    }

    function selectWizardVenue(venueId) {
      const form = document.getElementById('wizardVenueForm');
      if (venueId === 'new') {
        form.hidden = false;
      } else {
        const vendors = getDB('vendors');
        const venue = vendors.find(v => v.id === venueId);
        if (venue) {
          window.wizardData.venueName = venue.name;
          window.wizardData.venueAddress = venue.contact;
          form.hidden = true;
        }
      }
    }

    const WIZ_SERVICE_CATEGORIES = [
      { name: 'Entertainment', services: [
        { name: 'DJ Services', options: ['Standard DJ', 'Premium DJ Package', 'DJ + MC'] },
        { name: 'Live Musician', textInput: true },
        { name: 'Band', options: ['Cover Band', 'Latin Band', 'Jazz Band'] },
        { name: 'Fusion/Hybrid', options: ['DJ + Live Musician'] }
      ]},
      { name: 'Sound & Audio', services: [
        { name: 'Live Sound System' },
        { name: 'Speech/Podium Audio' },
        { name: 'Distributed Audio (multi-zone)' }
      ]},
      { name: 'Lighting', services: [
        { name: 'Uplighting (ambient color wash)' },
        { name: 'Bistro String Lights' },
        { name: 'Dance Floor Lighting (moving heads/wash)' },
        { name: 'Stage Lighting' },
        { name: 'Gobo / Logo Projection' }
      ]},
      { name: 'Special Effects', services: [
        { name: 'Cold Spark Fountains' },
        { name: 'CO2 Cannon' },
        { name: 'CO2 Jets' },
        { name: 'Dancing on Cloud (low-lying fog)' },
        { name: 'Confetti Cannon' }
      ]},
      { name: 'Visual & Display', services: [
        { name: 'LED Video Wall' },
        { name: 'Event Projection / Backdrop' },
        { name: 'TV Display Screens' },
        { name: 'IMAG (live camera feed to screen)' }
      ]},
      { name: 'Other', services: [
        { name: 'Custom Services', textInput: true }
      ]}
    ];

    function renderEventServicesStep() {
      let html = '<div class="field-label wiz-svc-head">Services</div>';
      WIZ_SERVICE_CATEGORIES.forEach((cat, catIdx) => {
        html += `<div class="wiz-cat"><div class="section-label">${cat.name}</div><div class="wiz-svcs">`;
        cat.services.forEach((svc, svcIdx) => {
          const uniqueId = `service_${catIdx}_${svcIdx}`;
          html += `<div class="wiz-svc-item"><div class="service-checkbox">
            <input type="checkbox" id="${uniqueId}" onchange="toggleServiceOptions(this, '${catIdx}', '${svcIdx}')">
            <label for="${uniqueId}">${svc.name}</label>
          </div>`;
          if (svc.options) {
            html += `<div class="sub-options" id="opts_${catIdx}_${svcIdx}" style="display:none;">
              <select class="input" aria-label="${svc.name} option" onchange="updateServiceOption('${catIdx}', '${svcIdx}', this.value)">
                <option value="">Select option</option>`;
            svc.options.forEach(opt => html += `<option value="${opt}">${opt}</option>`);
            html += `</select></div>`;
          }
          if (svc.textInput) {
            html += `<div class="sub-options" id="opts_${catIdx}_${svcIdx}" style="display:none;">
              <input type="text" class="input" aria-label="${svc.name} details" placeholder="Details" onchange="updateServiceOption('${catIdx}', '${svcIdx}', this.value)">
            </div>`;
          }
          html += '</div>';
        });
        html += `</div></div>`;
      });

      html += `<div class="wiz-two wiz-price"><div class="field"><label class="field-label" for="wizardBasePrice">Base price</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input type="text" inputmode="numeric" class="input" id="wizardBasePrice" placeholder="2500"></div></div><div class="field"><label class="field-label" for="wizardDepositAmount">Deposit</label><div class="input-wrap input-money"><span class="input-prefix">$</span><input type="text" inputmode="numeric" class="input" id="wizardDepositAmount" placeholder="1250"></div></div></div><p class="field-hint">Leave these blank to start at $2,500 with a $1,250 deposit. You can change both later.</p>`;
      return html;
    }

    function toggleAccordion(header) {
      const content = header.nextElementSibling;
      header.classList.toggle('open');
      content.classList.toggle('open');
    }

    function toggleServiceOptions(checkbox, catIdx, svcIdx) {
      const optionsDiv = document.getElementById(`opts_${catIdx}_${svcIdx}`);
      if (optionsDiv) optionsDiv.style.display = checkbox.checked ? 'block' : 'none';
    }

    function updateServiceOption(catIdx, svcIdx, value) {
      if (!window.wizardServices) window.wizardServices = {};
      window.wizardServices[`${catIdx}_${svcIdx}`] = value;
    }

    // Checks one step on screen and points at the problem. Returns true when the step can move on.
    function _wizardValidateStep(step) {
      const msg = (id, text) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.hidden = !text; } };
      if (step === 0) {
        if (!window.wizardData.date) { msg('wizardDateMsg', 'Pick the event date to continue.'); const d = document.getElementById('wizardEventDate'); if (d) d.focus(); return false; }
        msg('wizardDateMsg', '');
      }
      if (step === 1) {
        const sel = document.getElementById('wizardClientSelect');
        if (sel && sel.value === 'new') {
          const nm = (document.getElementById('wizardClientName').value || '').trim();
          if (!nm) { msg('wizardClientMsg', 'Add the client name to continue.'); document.getElementById('wizardClientName').focus(); return false; }
          const N = window.CRMUI && CRMUI.norm;
          const em = document.getElementById('wizardClientEmail'), ph = document.getElementById('wizardClientPhone');
          if (N && em && em.value.trim()) { const r = N.email(em.value); if (!r.ok) { msg('wizardClientMsg', r.message); em.focus(); return false; } }
          if (N && ph && ph.value.trim()) { const r = N.phone(ph.value); if (!r.ok) { msg('wizardClientMsg', r.message); ph.focus(); return false; } }
        }
        msg('wizardClientMsg', '');
      }
      return true;
    }

    function wizardNextStep() {
      const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      if (window.currentWizardStep === 0) {
        if (!window.wizardData.type || window.wizardData.typeNeedsReview) { showToast('Select event type', 'error'); return; }
        window.wizardData.name = val('wizardEventName');
        window.wizardData.date = val('wizardEventDate');
        window.wizardData.startTime = val('wizardStartTime');
        window.wizardData.endTime = val('wizardEndTime');
        if (typeof _wizardValidateStep === 'function' && !_wizardValidateStep(0)) return;
      }
      if (window.currentWizardStep === 1 && typeof _wizardValidateStep === 'function' && !_wizardValidateStep(1)) return;
      if (window.currentWizardStep === 3) {
        const selectedServices = [];
        document.querySelectorAll('.service-checkbox input:checked').forEach((checkbox, idx) => {
          const parent = checkbox.closest('.service-checkbox');
          const label = parent.querySelector('label').textContent;
          const uniqueId = checkbox.id;
          const matches = uniqueId.match(/service_(\d+)_(\d+)/);
          if (matches) {
            const catIdx = matches[1];
            const svcIdx = matches[2];
            const optValue = window.wizardServices ? window.wizardServices[`${catIdx}_${svcIdx}`] : '';
            selectedServices.push({
              category: WIZ_SERVICE_CATEGORIES[catIdx].name,
              service: label,
              subOption: optValue || '',
              customNote: ''
            });
          }
        });
        window.wizardData.services = selectedServices;
        // Prices may carry cents ("2100.50"): parse as money, never strip the dot.
        const dollars = id => {
          const t = val(id).trim();
          if (!t) return 0;
          const N = window.CRMUI && CRMUI.norm;
          if (N) { const r = N.money(t); return r.ok && r.value ? r.value / 100 : 0; }
          const n = parseFloat(t.replace(/[^\d.]/g, ''));
          return isNaN(n) ? 0 : Math.round(n * 100) / 100;
        };
        const baseTyped = dollars('wizardBasePrice');
        const depTyped = dollars('wizardDepositAmount');
        let pct = 50;
        try { if (typeof BSContracts !== 'undefined') pct = BSContracts.getTerms(getDB('settings')).depositPercent || 50; } catch (e) {}
        window.wizardData.basePrice = baseTyped || 2500;
        window.wizardData.depositAmount = depTyped || (baseTyped ? Math.round(baseTyped * pct) / 100 : 1250);
        createEventFromWizard();
        return;
      }

      window.currentWizardStep++;
      updateWizardDisplay();
    }

    function wizardPrevStep() {
      if (window.currentWizardStep > 0) {
        window.currentWizardStep--;
        updateWizardDisplay();
      }
    }

    function updateWizardDisplay() {
      const total = WIZ_STEP_TITLES.length;
      for (let i = 0; i < total; i++) {
        const el = document.getElementById('wizStep' + i);
        if (el) el.hidden = i !== window.currentWizardStep;
      }
      const back = document.getElementById('wizardBack');
      if (back) back.hidden = window.currentWizardStep === 0;
      const next = document.getElementById('wizardNext');
      if (next) next.textContent = window.currentWizardStep === total - 1 ? 'Create event' : 'Next';
      const prog = document.getElementById('wizardProgress');
      if (prog) prog.textContent = 'Step ' + (window.currentWizardStep + 1) + ' of ' + total + ': ' + WIZ_STEP_TITLES[window.currentWizardStep];
      const body = document.querySelector('#newEventModal .wiz-body');
      if (body) body.scrollTop = 0;
    }

    function createEventFromWizard() {
      const events = getDB('events');
      const clients = getDB('clients');
      const N = window.CRMUI && CRMUI.norm;
      const dom = id => { const el = document.getElementById(id); return el ? el.value : ''; };

      let clientId = window.wizardData.clientId;
      if (!clientId) {
        let email = dom('wizardClientEmail').trim(), phone = dom('wizardClientPhone').trim();
        if (N && email) { const r = N.email(email); if (r.ok && r.value) email = r.value; }
        if (N && phone) { const r = N.phone(phone); if (r.ok && r.echo) phone = r.echo; }
        const newClient = {
          id: genId(),
          name: dom('wizardClientName').trim(),
          email: email,
          phone: phone,
          type: 'private',
          notes: ''
        };
        clients.push(newClient);
        clientId = newClient.id;
        window.wizardData.clientName = newClient.name;
        window.wizardData.clientEmail = newClient.email;
        window.wizardData.clientPhone = newClient.phone;
        setDB('clients', clients);
      }

      const vSel = document.getElementById('wizardVenueSelect');
      let venueName = window.wizardData.venueName;
      if (!vSel || vSel.value === 'new' || !venueName) {
        venueName = dom('wizardVenueName');
        window.wizardData.venueName = venueName;
        window.wizardData.venueAddress = dom('wizardVenueAddress');
      }

      if (!window.wizardData.date) {
        // The date is checked on step one; if it is missing here, go back to it.
        window.currentWizardStep = 0; updateWizardDisplay();
        _wizardValidateStep(0);
        return;
      }
      let evName = (window.wizardData.name || '').trim();
      if (!evName) {
        const last = String(window.wizardData.clientName || '').trim().split(/\s+/).pop();
        const t = (WIZ_TYPES.find(x => x.value === window.wizardData.type) || { label: 'Event' }).label;
        evName = last ? last + ' ' + t : t;
      }

      // Reuse existing password if this client already has events: repeat clients use the same login
      const existingPw = (getDB('events') || [])
        .filter(e => e.clientId === clientId && e.portalPassword)
        .map(e => e.portalPassword)[0] || null;
      const password = existingPw || genPortalPassword(); // K: readable format e.g. ocean-beats42
      const newEvent = {
        id: genId(),
        name: evName,
        type: window.wizardData.type,
        date: window.wizardData.date,
        startTime: window.wizardData.startTime,
        endTime: window.wizardData.endTime,
        clientId: clientId,
        clientName: window.wizardData.clientName,
        clientEmail: window.wizardData.clientEmail,
        clientPhone: window.wizardData.clientPhone,
        venueName: venueName,
        venueAddress: window.wizardData.venueAddress || '',
        venueContact: '',
        venuePhone: '',
        status: 'lead',
        basePrice: window.wizardData.basePrice,
        depositAmount: window.wizardData.depositAmount,
        depositPaid: false,
        balancePaid: false,
        services: window.wizardData.services,
        staff: [],
        portalEmail: window.wizardData.clientEmail || '',  // K: explicit portal credential
        portalPassword: password,
        portalDisabled: false,
        timeline: [],
        vendors: [],
        music: [],
        documents: [],
        notes: window.wizardData.notes || '',
        checklist: { soundCheck: false, timelineSent: false, depositReceived: false, equipmentLoaded: false }
      };

      events.push(newEvent);
      setDB('events', events);
      // Sync credentials to clients record via single write path
      setClientCredentials(window.wizardData.clientEmail, newEvent.portalEmail, password);
      closeModal('newEventModal');
      // The new event has to show up everywhere it is listed, not only on Home
      renderEvents();
      renderDashboard();
      if (typeof renderPipeline === 'function') { try { renderPipeline(); } catch (e) {} }
      showPortalReadyNotification(newEvent); // K: instant portal-ready confirmation
    }

    function checkDoubleBooking() {
      const date = document.getElementById('doubleBookDate').value;
      if (!date) { showToast('Please select a date', 'warning'); return; }
      checkAvailability(date, 'doubleBookResult');
    }
