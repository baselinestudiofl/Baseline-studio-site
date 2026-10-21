// ============================================================================
// portal-provider/34-event-wizard.js  -  new-event wizard and the double-booking check
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    function openNewEventModal() {
      const steps = [
        { title: 'Type', content: renderEventTypeStep() },
        { title: 'Basics', content: renderEventBasicsStep() },
        { title: 'Client', content: renderEventClientStep() },
        { title: 'Venue', content: renderEventVenueStep() },
        { title: 'Services', content: renderEventServicesStep() }
      ];

      let html = '';
      steps.forEach((step, idx) => {
        html += `<div id="wizardStep${idx}" class="wizard-step" style="${idx === 0 ? '' : 'display:none;'}"><div style="font-size: 13px; color: var(--gray); margin-bottom: 15px;">Step ${idx + 1} of ${steps.length}</div>${step.content}</div>`;
      });
      html += `<div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;"><button class="btn btn-secondary" id="wizardBack" onclick="wizardPrevStep()" style="display:none;">Back</button><button class="btn btn-primary" id="wizardNext" onclick="wizardNextStep()">Next</button></div>`;

      document.getElementById('eventWizardSteps').innerHTML = html;
      window.currentWizardStep = 0;
      window.wizardData = {};
      openModal('newEventModal');
    }

    function renderEventTypeStep() {
      const types = [
        { value: 'wedding', label: 'Wedding', color: '#e91e63' },
        { value: 'quince', label: 'Quince/Sweet 16', color: '#9c27b0' },
        { value: 'sweet16', label: 'Sweet 16', color: '#9c27b0' },
        { value: 'mitzvah', label: 'Bar/Bat Mitzvah', color: '#9c27b0' },
        { value: 'corporate', label: 'Corporate', color: '#2196f3' },
        { value: 'gala', label: 'Gala/Fundraiser', color: '#673ab7' },
        { value: 'birthday', label: 'Birthday/Private Party', color: '#ff6f00' },
        { value: 'concert', label: 'Concert/Festival', color: '#00bcd4' }
      ];

      let html = '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">';
      types.forEach(t => {
        html += `<div style="background: var(--black-4); border: 2px solid transparent; padding: 20px; border-radius: 8px; cursor: pointer; text-align: center; transition: all 0.2s;" onclick="selectEventType('${t.value}', this)" class="event-type-tile"><div style="width: 30px; height: 30px; border-radius: 50%; background: ${t.color}; margin: 0 auto 10px;"></div><div style="font-weight: 600;">${t.label}</div></div>`;
      });
      html += '</div>';
      return html;
    }

    function selectEventType(type, el) {
      document.querySelectorAll('.event-type-tile').forEach(t => t.style.borderColor = 'transparent');
      el.style.borderColor = 'var(--cyan)';
      window.wizardData.type = type;
      window.wizardData.typeNeedsReview = false;
    }

    function renderEventBasicsStep() {
      return `<div class="form-group"><label class="form-label" for="wizardEventName">Event Name</label><input type="text" class="form-input" id="wizardEventName" placeholder="e.g., Smith Wedding"></div><div class="form-group"><label class="form-label" for="wizardEventDate">Event Date</label><input type="date" class="form-input" id="wizardEventDate"></div><div class="grid-2"><div class="form-group"><label class="form-label" for="wizardStartTime">Start Time</label><input type="time" class="form-input" id="wizardStartTime"></div><div class="form-group"><label class="form-label" for="wizardEndTime">End Time</label><input type="time" class="form-input" id="wizardEndTime"></div></div>`;
    }

    function renderEventClientStep() {
      const clients = getDB('clients');
      let html = `<div class="form-group"><label class="form-label" for="wizardClientSelect">Client</label><select class="form-select" id="wizardClientSelect" onchange="selectWizardClient(this.value)"><option value="new">+ New Client</option>`;
      clients.forEach(c => { html += `<option value="${c.id}">${c.name}</option>`; });
      html += `</select></div><div id="wizardClientForm"><div class="form-group"><label class="form-label" for="wizardClientName">Name</label><input type="text" class="form-input" id="wizardClientName"></div><div class="form-group"><label class="form-label" for="wizardClientEmail">Email</label><input type="email" class="form-input" id="wizardClientEmail"></div><div class="form-group"><label class="form-label" for="wizardClientPhone">Phone</label><input type="tel" class="form-input" id="wizardClientPhone"></div></div>`;
      return html;
    }

    function selectWizardClient(clientId) {
      const form = document.getElementById('wizardClientForm');
      if (clientId === 'new') {
        form.style.display = 'block';
      } else {
        const clients = getDB('clients');
        const client = clients.find(c => c.id === clientId);
        if (client) {
          window.wizardData.clientId = clientId;
          window.wizardData.clientName = client.name;
          window.wizardData.clientEmail = client.email;
          window.wizardData.clientPhone = client.phone;
          form.style.display = 'none';
        }
      }
    }

    function renderEventVenueStep() {
      const vendors = getDB('vendors').filter(v => (v.category || '').toLowerCase() === 'venue');
      let html = `<div class="form-group"><label class="form-label" for="wizardVenueSelect">Venue</label><select class="form-select" id="wizardVenueSelect" onchange="selectWizardVenue(this.value)"><option value="new">+ Add New Venue</option>`;
      vendors.forEach(v => { html += `<option value="${v.id}">${v.name}</option>`; });
      html += `</select></div><div id="wizardVenueForm"><div class="form-group"><label class="form-label" for="wizardVenueName">Venue Name</label><input type="text" class="form-input" id="wizardVenueName"></div><div class="form-group"><label class="form-label" for="wizardVenueAddress">Address</label><input type="text" class="form-input" id="wizardVenueAddress"></div></div>`;
      return html;
    }

    function selectWizardVenue(venueId) {
      const form = document.getElementById('wizardVenueForm');
      if (venueId === 'new') {
        form.style.display = 'block';
      } else {
        const vendors = getDB('vendors');
        const venue = vendors.find(v => v.id === venueId);
        if (venue) {
          window.wizardData.venueName = venue.name;
          window.wizardData.venueAddress = venue.contact;
          form.style.display = 'none';
        }
      }
    }

    function renderEventServicesStep() {
      const categories = [
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

      let html = '<div class="form-group"><label class="form-label">Services</label>';
      categories.forEach((cat, catIdx) => {
        html += `<div class="accordion-section">
          <div class="accordion-header" role="button" tabindex="0" onclick="toggleAccordion(this)"><span>${cat.name}</span><span class="accordion-toggle"></span></div>
          <div class="accordion-content">`;
        cat.services.forEach((svc, svcIdx) => {
          const uniqueId = `service_${catIdx}_${svcIdx}`;
          html += `<div class="service-checkbox">
            <input type="checkbox" id="${uniqueId}" onchange="toggleServiceOptions(this, '${catIdx}', '${svcIdx}')">
            <label for="${uniqueId}">${svc.name}</label>
          </div>`;
          if (svc.options) {
            html += `<div class="sub-options" id="opts_${catIdx}_${svcIdx}" style="display:none;">
              <select onchange="updateServiceOption('${catIdx}', '${svcIdx}', this.value)">
                <option value="">Select option...</option>`;
            svc.options.forEach(opt => html += `<option value="${opt}">${opt}</option>`);
            html += `</select></div>`;
          }
          if (svc.textInput) {
            html += `<div class="sub-options" id="opts_${catIdx}_${svcIdx}" style="display:none;">
              <input type="text" placeholder="Enter details" onchange="updateServiceOption('${catIdx}', '${svcIdx}', this.value)">
            </div>`;
          }
        });
        html += `</div></div>`;
      });

      html += `</div><div class="grid-2"><div class="form-group"><label class="form-label" for="wizardBasePrice">Base Price</label><input type="number" class="form-input" id="wizardBasePrice" placeholder="2500"></div><div class="form-group"><label class="form-label" for="wizardDepositAmount">Deposit (50%)</label><input type="number" class="form-input" id="wizardDepositAmount" placeholder="1250"></div></div>`;
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
      if (!window.wizardServices) window.wizardServices = [];
      window.wizardServices[`${catIdx}_${svcIdx}`] = value;
    }

    function wizardNextStep() {
      if (window.currentWizardStep === 0) {
        if (!window.wizardData.type || window.wizardData.typeNeedsReview) { showToast('Select event type', 'error'); return; }
      }
      if (window.currentWizardStep === 1) {
        window.wizardData.name = document.getElementById('wizardEventName').value;
        window.wizardData.date = document.getElementById('wizardEventDate').value;
        window.wizardData.startTime = document.getElementById('wizardStartTime').value;
        window.wizardData.endTime = document.getElementById('wizardEndTime').value;
        if (!window.wizardData.name || !window.wizardData.date) { showToast('Fill all fields', 'error'); return; }
      }
      if (window.currentWizardStep === 4) {
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
            const categories = ['Entertainment', 'Sound & Audio', 'Lighting', 'Special Effects', 'Visual & Display', 'Other'];
            selectedServices.push({
              category: categories[catIdx],
              service: label,
              subOption: optValue || '',
              customNote: ''
            });
          }
        });
        window.wizardData.services = selectedServices;
        window.wizardData.basePrice = parseInt(document.getElementById('wizardBasePrice').value) || 2500;
        window.wizardData.depositAmount = parseInt(document.getElementById('wizardDepositAmount').value) || 1250;
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
      for (let i = 0; i < 5; i++) {
        const el = document.getElementById('wizardStep' + i);
        if (el) el.style.display = i === window.currentWizardStep ? 'block' : 'none';
      }
      document.getElementById('wizardBack').style.display = window.currentWizardStep > 0 ? 'block' : 'none';
      document.getElementById('wizardNext').textContent = window.currentWizardStep === 4 ? 'Create Event' : 'Next';
    }

    function createEventFromWizard() {
      const events = getDB('events');
      const clients = getDB('clients');

      let clientId = window.wizardData.clientId;
      if (!clientId) {
        const newClient = {
          id: genId(),
          name: document.getElementById('wizardClientName').value,
          email: document.getElementById('wizardClientEmail').value,
          phone: document.getElementById('wizardClientPhone').value,
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

      let venueName = window.wizardData.venueName;
      if (!venueName) {
        venueName = document.getElementById('wizardVenueName').value;
        window.wizardData.venueName = venueName;
        window.wizardData.venueAddress = document.getElementById('wizardVenueAddress').value;
      }

      // Reuse existing password if this client already has events — repeat clients use the same login
      const existingPw = (getDB('events') || [])
        .filter(e => e.clientId === clientId && e.portalPassword)
        .map(e => e.portalPassword)[0] || null;
      const password = existingPw || genPortalPassword(); // K: readable format e.g. ocean-beats42
      const newEvent = {
        id: genId(),
        name: window.wizardData.name,
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
        notes: '',
        checklist: { soundCheck: false, timelineSent: false, depositReceived: false, equipmentLoaded: false }
      };

      events.push(newEvent);
      setDB('events', events);
      // Sync credentials to clients record via single write path
      setClientCredentials(window.wizardData.clientEmail, newEvent.portalEmail, password);
      closeModal('newEventModal');
      renderDashboard();
      showPortalReadyNotification(newEvent); // K: instant portal-ready confirmation
    }

    function checkDoubleBooking() {
      const date = document.getElementById('doubleBookDate').value;
      if (!date) { showToast('Please select a date', 'warning'); return; }
      checkAvailability(date, 'doubleBookResult');
    }
