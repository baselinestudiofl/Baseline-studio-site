// ============================================================================
// portal-provider/60-library.js  -  library: vendors, template editor, equipment and staff
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    function renderVendors() {
      let vendors = getDB('vendors');
      const currentUser = BSPortal.getCurrentUser();
      const searchVal = document.getElementById('vendorsSearch')?.value || '';
      const categoryFilter = document.getElementById('vendorCategoryFilter')?.value || '';

      if (searchVal) vendors = vendors.filter(v => v.name.toLowerCase().includes(searchVal.toLowerCase()));
      if (categoryFilter) vendors = vendors.filter(v => v.category === categoryFilter);

      let html = '';
      vendors.forEach(v => {
        const deleteBtn = currentUser.role === 'dj' ? '' : `<button class="btn btn-danger" style="padding:6px 10px;font-size:12px;" onclick="event.stopPropagation();deleteVendor('${v.id}')">Delete</button>`;
        const loginBtn  = currentUser.role !== 'dj' ? `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;color:var(--cyan);border-color:rgba(31,163,224,0.65);" onclick="event.stopPropagation();sendLoginInfo('vendor',{name:'${v.name.replace(/'/g,"\\'")}',email:'${v.email||''}'})">🔑 Send Info</button>` : '';
        html += `<div class="vendor-card" role="button" tabindex="0" onclick="openVendorDetail('${v.id}')">
          <div class="vendor-name">${v.name} <span style="font-size:12px;color:var(--text-3);float:right;">→</span></div>
          <div class="vendor-category">${v.category}</div>
          <div class="vendor-contact">${v.contact}</div>
          ${v.email ? `<div class="vendor-contact"><a href="mailto:${v.email}" onclick="event.stopPropagation()" style="color:var(--cyan);text-decoration:none;">✉ ${v.email}</a></div>` : ''}
          ${v.phone ? `<div class="vendor-contact"><a href="tel:${v.phone}" onclick="event.stopPropagation()" style="color:var(--cyan);text-decoration:none;">📞 ${v.phone}</a></div>` : ''}
          <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">${deleteBtn}${loginBtn}</div>
        </div>`;
      });
      document.getElementById('vendorsGrid').innerHTML = html || '<div class="empty-state">No vendors yet. <button class="btn btn-secondary" style="margin-top:8px;" onclick="openAddVendorModal()">Add your first one →</button></div>';

      // Also load shared vendor library from Supabase
      loadVendorLibrary();
    }

    async function loadVendorLibrary() {
      const libEl = document.getElementById('vendorLibraryContainer');
      if (!libEl) return;
      const token = window._sbToken;
      if (!token) { libEl.innerHTML = '<p style="color:rgba(255,255,255,0.55);font-size:13px;padding:12px 0;">Sign in as provider to view the shared vendor library.</p>'; return; }

      libEl.innerHTML = '<p style="color:rgba(255,255,255,0.55);font-size:13px;">Loading...</p>';
      try {
        const r = await fetch('https://jkdhkwcxnwpiufeyrnso.supabase.co/rest/v1/vendor_library?order=times_used.desc&limit=200', {
          headers: { 'apikey': 'sb_publishable_6xcEpHwIJi8bq4XuSyLCGg_3A30raS9', 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        if (!r.ok) { libEl.innerHTML = '<p style="color:#ff6464;font-size:13px;padding:12px 0;">Could not load vendor library. Run the Step A SQL in your Supabase dashboard first.</p>'; return; }
        const rows = await r.json();
        if (!rows.length) { libEl.innerHTML = '<p style="color:rgba(255,255,255,0.55);font-size:13px;padding:12px 0;">No vendors in the shared library yet. They appear here when clients add vendors or you add them manually.</p>'; return; }
        libEl.innerHTML = `
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <th style="text-align:left;padding:8px 12px;color:rgba(255,255,255,0.55);font-weight:500;">Name</th>
                  <th style="text-align:left;padding:8px 12px;color:rgba(255,255,255,0.55);font-weight:500;">Category</th>
                  <th style="text-align:left;padding:8px 12px;color:rgba(255,255,255,0.55);font-weight:500;">Contact</th>
                  <th style="text-align:left;padding:8px 12px;color:rgba(255,255,255,0.55);font-weight:500;">Used</th>
                  <th style="text-align:left;padding:8px 12px;color:rgba(255,255,255,0.55);font-weight:500;">Source</th>
                  <th style="padding:8px 12px;"></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(v => `
                  <tr id="vlrow_${v.id}" style="border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='rgba(255,255,255,0.03)'" onmouseleave="this.style.background=''" onclick="openVendorLibraryEdit('${v.id}',this)">
                    <td style="padding:10px 12px;color:#fff;font-weight:500;">${v.name} <span style="color:var(--text-3);font-size:12px;">→</span></td>
                    <td style="padding:10px 12px;color:rgba(255,255,255,0.55);">${v.category || '—'}</td>
                    <td style="padding:10px 12px;color:rgba(255,255,255,0.55);">
                      ${v.email ? `<a href="mailto:${v.email}" onclick="event.stopPropagation()" style="color:rgba(255,255,255,0.55);text-decoration:none;">${v.email}</a>` : ''}
                      ${v.phone ? ` · <a href="tel:${v.phone}" onclick="event.stopPropagation()" style="color:rgba(255,255,255,0.55);text-decoration:none;">${v.phone}</a>` : ''}
                      ${v.contact_name ? (v.email||v.phone?' · ':'')+v.contact_name : ''}
                      ${(!v.email&&!v.phone&&!v.contact_name)?'—':''}
                    </td>
                    <td style="padding:10px 12px;color:#1FA3E0;">${v.times_used}</td>
                    <td style="padding:10px 12px;"><span style="font-size:12px;padding:2px 7px;border-radius:10px;background:${v.source==='client'?'rgba(31,163,224,0.12)':'rgba(255,255,255,0.06)'};color:${v.source==='client'?'#1FA3E0':'var(--text-3)'};">${v.source}</span></td>
                    <td style="padding:10px 12px;text-align:right;" onclick="event.stopPropagation()">
                      <button onclick="deleteVendorFromLibrary('${v.id}')" style="background:none;border:1px solid var(--border-ui);color:rgba(255,255,255,0.55);font-size:12px;padding:3px 8px;border-radius:4px;cursor:pointer;">Delete</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
      } catch(e) {
        libEl.innerHTML = '<p style="color:#ff6464;font-size:13px;padding:12px 0;">Error loading vendor library.</p>';
      }
    }

    async function deleteVendorFromLibrary(id) {
      const token = window._sbToken;
      if (!token) return;
      confirmDestructive('Remove from Library', 'Remove this vendor from the shared library? This cannot be undone.', async function() {
        await fetch('https://jkdhkwcxnwpiufeyrnso.supabase.co/rest/v1/vendor_library?id=eq.' + id, {
          method: 'DELETE',
          headers: { 'apikey': 'sb_publishable_6xcEpHwIJi8bq4XuSyLCGg_3A30raS9', 'Authorization': 'Bearer ' + token, 'Prefer': 'return=minimal' }
        });
        const row = document.getElementById('vlrow_' + id);
        if (row) row.remove();
        showToast('Removed from library', 'success');
      }, 'Remove');
    }

    // Inline edit for vendor library rows
    function openVendorLibraryEdit(id, row) {
      // Don't double-open
      if (row.classList.contains('vl-row-edit')) return;
      const cells = row.querySelectorAll('td');
      const origName    = cells[0].textContent.replace('→','').trim();
      const origCat     = cells[1].textContent.trim();
      row.classList.add('vl-row-edit');
      row.removeAttribute('onclick');
      row.onmouseenter = null; row.onmouseleave = null;
      row.innerHTML = `
        <td colspan="4" style="padding:8px 12px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input id="vle_name" value="${origName}" placeholder="Name" style="flex:1;min-width:120px;background:var(--black-3);border:1px solid var(--border-ui);border-radius:3px;color:#fff;padding:5px 8px;font-size:12px;">
            <input id="vle_cat"  value="${origCat}"  placeholder="Category" style="width:120px;background:var(--black-3);border:1px solid var(--border-ui);border-radius:3px;color:#fff;padding:5px 8px;font-size:12px;">
          </div>
        </td>
        <td colspan="2" style="padding:8px 12px;text-align:right;">
          <button onclick="saveVendorLibraryEdit('${id}',this.closest('tr'))" style="background:var(--cyan);border:none;color:#000;font-size:12px;font-weight:700;padding:5px 12px;border-radius:4px;cursor:pointer;margin-right:6px;">Save</button>
          <button onclick="loadVendorLibrary()" style="background:none;border:1px solid var(--border-ui);color:rgba(255,255,255,0.55);font-size:12px;padding:5px 10px;border-radius:4px;cursor:pointer;">Cancel</button>
        </td>`;
    }

    async function saveVendorLibraryEdit(id, row) {
      const token = window._sbToken;
      if (!token) { showToast('Not authenticated', 'error'); return; }
      const name     = row.querySelector('#vle_name')?.value.trim();
      const category = row.querySelector('#vle_cat')?.value.trim();
      if (!name) { showToast('Name is required', 'error'); return; }
      await fetch('https://jkdhkwcxnwpiufeyrnso.supabase.co/rest/v1/vendor_library?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'apikey': 'sb_publishable_6xcEpHwIJi8bq4XuSyLCGg_3A30raS9', 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ name, category })
      });
      showToast('Vendor updated', 'success');
      loadVendorLibrary();
    }

    function saveVendor(e) {
      e.preventDefault();
      const vendors = getDB('vendors');
      vendors.push({
        id: genId(),
        name: document.getElementById('vendorName').value,
        category: document.getElementById('vendorCategory').value,
        contact: document.getElementById('vendorContact').value,
        email: document.getElementById('vendorEmail').value,
        phone: document.getElementById('vendorPhone').value
      });
      setDB('vendors', vendors);
      closeModal('addVendorModal');
      renderVendors();
      showToast('Added', 'success');
      document.getElementById('addVendorForm').reset();
    }

    function openAddVendorModal() { document.getElementById('addVendorForm').reset(); openModal('addVendorModal'); }

    function openVendorDetail(vendorId) {
      const vendors = getDB('vendors');
      const v = vendors.find(x => x.id === vendorId);
      if (!v) return;
      const currentUser = BSPortal.getCurrentUser();
      const canEdit = currentUser.role !== 'dj';
      document.getElementById('clientDetailContent').innerHTML = `
        <div class="modal-title">${v.name}</div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label" for="editVdrName">Name</label><input type="text" class="form-input" id="editVdrName" value="${v.name}" ${canEdit?'':'readonly'}></div>
          <div class="form-group"><label class="form-label" for="editVdrCategory">Category</label><input type="text" class="form-input" id="editVdrCategory" value="${v.category}" ${canEdit?'':'readonly'}></div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label" for="editVdrEmail">Email</label>
            <input type="email" class="form-input" id="editVdrEmail" value="${v.email||''}" ${canEdit?'':'readonly'}>
            ${v.email ? `<a href="mailto:${v.email}" style="display:inline-block;margin-top:4px;font-size:12px;color:var(--cyan);">✉ ${v.email}</a>` : ''}
          </div>
          <div class="form-group">
            <label class="form-label" for="editVdrPhone">Phone</label>
            <input type="tel" class="form-input" id="editVdrPhone" value="${v.phone||''}" ${canEdit?'':'readonly'}>
            ${v.phone ? `<a href="tel:${v.phone}" style="display:inline-block;margin-top:4px;font-size:12px;color:var(--cyan);">📞 ${v.phone}</a>` : ''}
          </div>
        </div>
        <div class="form-group"><label class="form-label" for="editVdrContact">Contact Name</label><input type="text" class="form-input" id="editVdrContact" value="${v.contact||''}" ${canEdit?'':'readonly'}></div>
        ${canEdit ? `<div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="saveVendorChanges('${vendorId}')">Save Changes</button>
          <button class="btn btn-secondary" onclick="sendLoginInfo('vendor',{name:'${v.name.replace(/'/g,"\\'")}',email:'${v.email||''}'})" style="color:var(--cyan);border-color:rgba(31,163,224,0.65);">🔑 Send Login Info</button>
          ${v.email ? `<a href="mailto:${v.email}" class="btn btn-secondary">✉ Email Vendor</a>` : ''}
        </div>` : ''}`;
      openModal('clientDetailModal');
    }

    function saveVendorChanges(vendorId) {
      const vendors = getDB('vendors');
      const v = vendors.find(x => x.id === vendorId);
      if (!v) return;
      v.name     = document.getElementById('editVdrName').value    || v.name;
      v.category = document.getElementById('editVdrCategory').value || v.category;
      v.email    = document.getElementById('editVdrEmail').value;
      v.phone    = document.getElementById('editVdrPhone').value;
      v.contact  = document.getElementById('editVdrContact').value;
      setDB('vendors', vendors);
      showToast('Vendor saved', 'success');
      closeModal('clientDetailModal');
      renderVendors();
    }

    function deleteVendor(vendorId) {
      const vendors = getDB('vendors');
      window.confirmCallback = () => {
        const updated = vendors.filter(v => v.id !== vendorId);
        setDB('vendors', updated);
        closeModal('confirmDialog');
        renderVendors();
        showToast('Deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete Vendor';
      document.getElementById('confirmMessage').textContent = 'Delete this vendor?';
      openModal('confirmDialog');
    }

    // Document Editor Functions
    function renderDocuments() {
      seedDefaultTemplates(); // populate starter library if empty
      const templates = getDB('templates');
      const currentUser = BSPortal.getCurrentUser();
      const isDJ = currentUser.role === 'dj';

      // Show/hide read-only banner for DJ
      const banner = document.getElementById('djReadOnlyBanner');
      if (banner) banner.style.display = isDJ ? 'block' : 'none';

      // Render document list
      let html = '';
      templates.forEach(t => {
        const preview = t.contentHTML ? t.contentHTML.substring(0, 60) : t.content ? t.content.substring(0, 60) : '';
        const cleanPreview = preview.replace(/<[^>]*>/g, '');
        const shared = !!t.sharedWithClient;
        html += `
          <div class="doc-list-item" role="button" tabindex="0" onclick="loadDocument('${t.id}')">
            <div class="doc-list-item-name">${t.name}${shared ? ' <span style="color:var(--success);font-size:12px;font-weight:600;">SHARED</span>' : ''}</div>
            <div class="doc-list-item-preview">${cleanPreview || '(empty)'}</div>
            ${!isDJ ? `<label class="doc-share-toggle" onclick="event.stopPropagation()"><input type="checkbox" ${shared ? 'checked' : ''} onchange="toggleDocClientShare('${t.id}', this.checked)"><span class="${shared ? 'doc-shared-label' : ''}">Share with client</span></label>` : ''}
          </div>
        `;
      });
      document.getElementById('docList').innerHTML = html || '<div style="padding: 15px; text-align: center; color: var(--gray); font-size: 12px;">No documents</div>';

      // Show/hide controls based on role
      document.getElementById('newDocButton').style.display = isDJ ? 'none' : 'block';
      document.getElementById('renameDocButton').style.display = isDJ ? 'none' : 'block';
      document.getElementById('deleteDocButton').style.display = isDJ ? 'none' : 'block';

      const docEditor = document.getElementById('docEditor');
      if (docEditor) {
        docEditor.contentEditable = isDJ ? 'false' : 'true';
      }

      document.getElementById('docToolbar').style.display = isDJ ? 'none' : 'flex';

      // Load first document or clear
      if (templates.length > 0) {
        loadDocument(templates[0].id);
      } else {
        document.getElementById('docEditor').innerHTML = '';
        window.currentDocumentId = null;
      }
    }

    function loadDocument(templateId) {
      const templates = getDB('templates');
      const template = templates.find(t => t.id === templateId);
      if (!template) return;

      window.currentDocumentId = templateId;
      const docEditor = document.getElementById('docEditor');
      docEditor.innerHTML = template.contentHTML || template.content || '';

      // Update active state in list
      document.querySelectorAll('.doc-list-item').forEach(item => {
        item.classList.remove('active');
      });
      event?.currentTarget?.classList.add('active');
    }

    function createNewDocument() {
      const templates = getDB('templates');
      const newTemplate = {
        id: genId(),
        name: 'Untitled Document',
        contentHTML: '',
        content: '' // backward compat
      };
      templates.push(newTemplate);
      setDB('templates', templates);
      renderDocuments();
      window.currentDocumentId = newTemplate.id;
      showToast('Document created', 'success');
    }

    function saveCurrentDocument() {
      if (!window.currentDocumentId) {
        showToast('No document selected', 'error');
        return;
      }
      const templates = getDB('templates');
      const template = templates.find(t => t.id === window.currentDocumentId);
      if (template) {
        template.contentHTML = document.getElementById('docEditor').innerHTML;
        template.content = template.contentHTML; // backward compat
        setDB('templates', templates);
        showToast('Document saved', 'success');
      }
    }

    function openRenameDocumentModal() {
      if (!window.currentDocumentId) {
        showToast('No document selected', 'error');
        return;
      }
      const templates = getDB('templates');
      const template = templates.find(t => t.id === window.currentDocumentId);
      if (template) {
        document.getElementById('renameDocumentInput').value = template.name;
        openModal('renameDocumentModal');
      }
    }

    function saveDocumentRename(e) {
      e.preventDefault();
      if (!window.currentDocumentId) return;
      const templates = getDB('templates');
      const template = templates.find(t => t.id === window.currentDocumentId);
      if (template) {
        template.name = document.getElementById('renameDocumentInput').value;
        setDB('templates', templates);
        closeModal('renameDocumentModal');
        renderDocuments();
        showToast('Document renamed', 'success');
      }
    }

    function deleteCurrentDocument() {
      if (!window.currentDocumentId) {
        showToast('No document selected', 'error');
        return;
      }
      window.confirmCallback = () => {
        const templates = getDB('templates');
        const updated = templates.filter(t => t.id !== window.currentDocumentId);
        setDB('templates', updated);
        closeModal('confirmDialog');
        window.currentDocumentId = null;
        renderDocuments();
        showToast('Document deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete Document';
      document.getElementById('confirmMessage').textContent = 'Delete this document? This cannot be undone.';
      openModal('confirmDialog');
    }

    function execCommand(command, arg1, arg2) {
      if (command === 'formatBlock') {
        document.execCommand(command, false, arg1);
      } else if (command === 'fontSize') {
        document.execCommand(command, false, arg1);
      } else {
        document.execCommand(command, false, arg2);
      }
      document.getElementById('docEditor').focus();
    }

    function changeFontSize(size) {
      if (size) {
        document.execCommand('fontSize', false, size);
        document.getElementById('fontSizeSelect').value = '';
      }
    }

    function insertVariable(variable) {
      if (variable) {
        document.execCommand('insertText', false, variable);
        document.getElementById('insertVariableSelect').value = '';
      }
    }

    // Keep backward compat functions
    function saveTemplate(e) {
      e.preventDefault();
      const templates = getDB('templates');
      templates.push({
        id: genId(),
        name: document.getElementById('templateName').value,
        contentHTML: document.getElementById('templateContent').value,
        content: document.getElementById('templateContent').value
      });
      setDB('templates', templates);
      closeModal('newTemplateModal');
      renderDocuments();
      showToast('Created', 'success');
      document.getElementById('newTemplateForm').reset();
    }

    function openNewTemplateModal() {
      document.getElementById('newTemplateForm').reset();
      openModal('newTemplateModal');
    }

    function deleteTemplate(templateId) {
      window.currentDocumentId = templateId;
      deleteCurrentDocument();
    }

    function viewDocument(templateId) {
      loadDocument(templateId);
    }

    function editDocument(templateId) {
      loadDocument(templateId);
    }

    function saveTemplateEdit(templateId) {
      window.currentDocumentId = templateId;
      saveCurrentDocument();
    }

    // 
    //  EQUIPMENT MANAGEMENT
    // 
    function renderEquipment() {
      if (!getDB('equipment') || getDB('equipment').length === 0) setDB('equipment', []);
      if (!getDB('staffroster') || getDB('staffroster').length === 0) setDB('staffroster', []);
      const equip = getDB('equipment');
      const staff = getDB('staffroster');

      // Equipment cards
      let eHtml = '';
      if (!equip.length) {
        eHtml = '<div class="empty-state" style="padding:20px;">No equipment added yet.</div>';
      } else {
        equip.forEach(e => {
          const statusClass = e.status === 'available' ? 'equip-available' : e.status === 'assigned' ? 'equip-assigned' : 'equip-maintenance';
          eHtml += `<div class="equip-card" style="margin-bottom:10px;">
            <div class="equip-card-header">
              <div class="equip-card-title">${e.name}</div>
              <span class="equip-badge ${statusClass}">${e.status}</span>
            </div>
            <div class="equip-meta">
              Category: ${e.category}<br>
              ${e.serial ? 'S/N: ' + e.serial + '<br>' : ''}
              ${e.value ? 'Value: $' + parseFloat(e.value).toLocaleString() + '<br>' : ''}
              ${e.notes ? 'Notes: ' + e.notes : ''}
            </div>
            <div style="display:flex;gap:6px;margin-top:10px;">
              <button class="btn btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="cycleEquipStatus('${e.id}')">Change Status</button>
              <button class="btn btn-danger" style="font-size:12px;padding:4px 8px;" onclick="deleteEquipment('${e.id}')">Remove</button>
            </div>
          </div>`;
        });
      }
      document.getElementById('equipmentList').innerHTML = eHtml;

      // Staff list
      let sHtml = '';
      if (!staff.length) {
        sHtml = '<div class="empty-state" style="padding:20px;">No staff added yet.</div>';
      } else {
        staff.forEach(s => {
          sHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-weight:600;">${s.name}</div>
              <div style="font-size:12px;color:var(--gray);">${s.title || ''} ${s.phone ? '· ' + s.phone : ''}</div>
            </div>
            <button class="btn btn-danger" style="font-size:12px;padding:4px 8px;" onclick="deleteStaff('${s.id}')">Remove</button>
          </div>`;
        });
      }
      document.getElementById('staffList').innerHTML = sHtml;
    }

    function openAddEquipmentModal() { openModal('addEquipmentModal'); }
    function openAddStaffModal() { openModal('addStaffModal'); }

    function saveEquipment(e) {
      e.preventDefault();
      const equip = getDB('equipment');
      equip.push({
        id: genId(),
        name: document.getElementById('equipName').value,
        category: document.getElementById('equipCategory').value,
        serial: document.getElementById('equipSerial').value,
        value: document.getElementById('equipValue').value,
        notes: document.getElementById('equipNotes').value,
        status: 'available'
      });
      setDB('equipment', equip);
      document.getElementById('addEquipmentForm').reset();
      closeModal('addEquipmentModal');
      renderEquipment();
      showToast('Equipment added', 'success');
    }

    function saveStaffMember(e) {
      e.preventDefault();
      const staff = getDB('staffroster');
      staff.push({
        id: genId(),
        name: document.getElementById('staffName').value,
        title: document.getElementById('staffTitle').value,
        phone: document.getElementById('staffPhone').value,
        email: document.getElementById('staffEmail').value
      });
      setDB('staffroster', staff);
      document.getElementById('addStaffForm').reset();
      closeModal('addStaffModal');
      renderEquipment();
      showToast('Staff member added', 'success');
    }

    function cycleEquipStatus(id) {
      const equip = getDB('equipment');
      const item = equip.find(e => e.id === id);
      if (!item) return;
      const cycle = ['available', 'assigned', 'maintenance'];
      item.status = cycle[(cycle.indexOf(item.status) + 1) % cycle.length];
      setDB('equipment', equip);
      renderEquipment();
    }

    function deleteEquipment(id) {
      confirmDestructive('Delete Equipment', 'Delete this equipment item? This cannot be undone.', function() {
        setDB('equipment', getDB('equipment').filter(e => e.id !== id));
        renderEquipment();
        showToast('Equipment deleted', 'info');
      });
    }

    function deleteStaff(id) {
      confirmDestructive('Remove Staff Member', 'Remove this person from the staff roster?', function() {
        setDB('staffroster', getDB('staffroster').filter(s => s.id !== id));
        renderEquipment();
        showToast('Removed from roster', 'info');
      }, 'Remove');
    }
