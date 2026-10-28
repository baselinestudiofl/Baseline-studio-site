// ============================================================================
// portal-provider/60-library.js  -  library: vendors, template editor, inventory (equipment) and staff helpers
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A); vendors and inventory redesigned in CRM v2 (lane P6).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Vendors & Venues (UI-PLAN 3.10) ──────────────────────────────────────
    const VENDOR_CATEGORIES = [
      { id: 'venue', label: 'Venues' }, { id: 'photographer', label: 'Photographers' }, { id: 'videographer', label: 'Videographers' },
      { id: 'caterer', label: 'Caterers' }, { id: 'florist', label: 'Florists' }, { id: 'planner', label: 'Event planners' },
      { id: 'coordinator', label: 'Day-of coordinators' }, { id: 'hair-makeup', label: 'Hair and makeup' }, { id: 'band', label: 'Bands and live music' },
      { id: 'other', label: 'Other' }
    ];

    function _vendorCatLabel(id) {
      const c = VENDOR_CATEGORIES.find(x => x.id === id);
      return c ? c.label : (id ? String(id).replace(/-/g, ' ') : 'Other');
    }

    function _vendorInitials(name) {
      const parts = String(name || '?').replace(/[^A-Za-z0-9\u00C0-\u024F\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      return parts.map(p => p.charAt(0)).join('').toUpperCase() || '?';
    }

    function _vendorIcon(name, size) {
      return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(name, size || 20) : '';
    }

    function _vendorFold(s) {
      if (window.CRMUI && CRMUI.norm && CRMUI.norm.fold) return CRMUI.norm.fold(s);
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function _vendorCanEdit() {
      const u = (window.BSPortal && BSPortal.getCurrentUser && BSPortal.getCurrentUser()) || {};
      return u.role !== 'dj';
    }

    function _vendorMapHref(v) {
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([v.name, v.address || ''].join(' ').trim());
    }

    function _vendorTelHref(phone) {
      return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
    }

    function _vendorCleanPhone(raw) {
      const s = String(raw || '').trim();
      if (!s || !(window.CRMUI && CRMUI.norm && CRMUI.norm.phone)) return s;
      const r = CRMUI.norm.phone(s);
      return r && r.ok && r.value ? (CRMUI.fmt.phone(r.value) || s) : s;
    }

    function _vendorCleanEmail(raw) {
      const s = String(raw || '').trim();
      if (!s || !(window.CRMUI && CRMUI.norm && CRMUI.norm.email)) return s;
      const r = CRMUI.norm.email(s);
      return r && r.ok && r.value ? r.value : s;
    }

    function _vendorActions(html) {
      // The page head hosts each screen's one primary action. Only fill it while this section is the visible one.
      const sec = document.getElementById('vendors');
      const pa = document.getElementById('pageActions');
      if (pa && sec && sec.classList.contains('active')) pa.innerHTML = html;
    }

    function renderVendors() {
      let vendors = getDB('vendors');
      if (!Array.isArray(vendors)) vendors = [];
      const canEdit = _vendorCanEdit();
      const searchVal = document.getElementById('vendorsSearch')?.value || '';
      const categoryFilter = document.getElementById('vendorCategoryFilter')?.value || '';
      const total = vendors.length;

      _vendorActions(canEdit ? `<button type="button" class="btn btn-primary" onclick="openAddVendorModal()">${_vendorIcon('plus', 18)} Add vendor</button>` : '');

      // Category chips (phone). The select stays in the markup for desktop; CSS shows one of the two.
      let chipHost = document.getElementById('vendorChips');
      const grid = document.getElementById('vendorsGrid');
      if (!grid) return;
      if (!chipHost) {
        chipHost = document.createElement('div');
        chipHost.id = 'vendorChips';
        chipHost.className = 'vend-chips';
        chipHost.setAttribute('role', 'group');
        chipHost.setAttribute('aria-label', 'Filter by category');
        grid.parentNode.insertBefore(chipHost, grid);
      }
      const counts = {};
      vendors.forEach(v => { counts[v.category] = (counts[v.category] || 0) + 1; });
      const usedCats = VENDOR_CATEGORIES.filter(c => counts[c.id]);
      chipHost.innerHTML = [`<button type="button" class="chip${categoryFilter ? '' : ' is-selected'}" aria-pressed="${categoryFilter ? 'false' : 'true'}" onclick="_vendorSetCategory('')">All ${total}</button>`]
        .concat(usedCats.map(c => `<button type="button" class="chip${categoryFilter === c.id ? ' is-selected' : ''}" aria-pressed="${categoryFilter === c.id ? 'true' : 'false'}" onclick="_vendorSetCategory('${c.id}')">${esc(c.label)} ${counts[c.id]}</button>`)).join('');

      if (searchVal) {
        const q = _vendorFold(searchVal);
        vendors = vendors.filter(v => _vendorFold(v.name).includes(q) || _vendorFold(v.contact).includes(q));
      }
      if (categoryFilter) vendors = vendors.filter(v => v.category === categoryFilter);

      let html = '';
      vendors.forEach(v => {
        const id = esc(String(v.id).replace(/[^\w.-]/g, ''));
        const nm = esc(v.name);
        html += `<div class="vend-card" data-vendor-id="${id}">
          <button type="button" class="vend-open" onclick="openVendorDetail('${id}')" aria-label="Open ${nm}"></button>
          <span class="avatar avatar-40" aria-hidden="true">${esc(_vendorInitials(v.name))}</span>
          <div class="vend-main">
            <div class="vend-name" data-user-content>${nm}</div>
            <div class="vend-sub"><span class="pill pill-sm pill-neutral">${esc(_vendorCatLabel(v.category))}</span></div>
            ${v.contact ? `<div class="vend-sub" data-user-content>${esc(v.contact)}</div>` : ''}
          </div>
          <div class="vend-acts">
            ${v.phone ? `<a class="btn btn-secondary btn-icon" href="${esc(_vendorTelHref(v.phone))}" aria-label="Call ${nm}">${_vendorIcon('phone', 18)}</a>` : ''}
            ${v.email ? `<a class="btn btn-secondary btn-icon" href="mailto:${esc(v.email)}" aria-label="Email ${nm}">${_vendorIcon('mail', 18)}</a>` : ''}
          </div>
        </div>`;
      });
      if (!html) {
        html = total
          ? `<div class="empty vend-empty">${_vendorIcon('search', 32)}<div class="empty-title">No vendors match</div><div class="empty-text">Clear the search or pick another category.</div></div>`
          : `<div class="empty vend-empty">${_vendorIcon('users', 32)}<div class="empty-title">No vendors yet</div><div class="empty-text">Add the ones you work with so they show up on run-of-shows.</div>${canEdit ? '<button type="button" class="btn btn-secondary" onclick="openAddVendorModal()">Add vendor</button>' : ''}</div>`;
      }
      grid.innerHTML = html;

      // Also load the shared vendor library from Supabase (not on every keystroke of the search box)
      if (!window._vendorLibAt || Date.now() - window._vendorLibAt > 20000) loadVendorLibrary();
    }

    function _vendorSetCategory(cat) {
      const sel = document.getElementById('vendorCategoryFilter');
      if (sel) sel.value = cat;
      renderVendors();
    }

    function _vendorLibFetch(path, opts) {
      const token = window._sbToken;
      const headers = Object.assign({ 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + token }, (opts && opts.headers) || {});
      return fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opts || {}, { headers: headers }));
    }

    async function loadVendorLibrary() {
      const libEl = document.getElementById('vendorLibraryContainer');
      if (!libEl) return;
      const token = window._sbToken;
      if (!token) { libEl.innerHTML = '<p class="vend-note">Sign in as provider to view the shared vendor library.</p>'; return; }

      libEl.innerHTML = '<p class="vend-note">Loading.</p>';
      try {
        const r = await _vendorLibFetch('vendor_library?order=times_used.desc&limit=200', { headers: { 'Content-Type': 'application/json' } });
        if (!r.ok) { libEl.innerHTML = '<p class="vend-note is-error">Could not load the vendor library. Run the Step A SQL in your Supabase dashboard first.</p>'; return; }
        const rows = await r.json();
        window._vendorLib = Array.isArray(rows) ? rows : [];
        window._vendorLibAt = Date.now();
        if (!rows.length) { libEl.innerHTML = '<p class="vend-note">No vendors in the shared library yet. They appear here when clients add vendors or you add them manually.</p>'; return; }
        const canEdit = _vendorCanEdit();
        const contactOf = v => [v.email, v.phone, v.contact_name].filter(Boolean).map(esc).join(' · ') || '-';
        const srcPill = v => `<span class="pill pill-sm ${v.source === 'client' ? 'pill-info' : 'pill-neutral'}">${esc(v.source || 'manual')}</span>`;
        const vid = v => esc(String(v.id).replace(/[^\w.-]/g, ''));
        libEl.innerHTML = `
          <div class="tbl-wrap">
            <table class="tbl tbl-compact">
              <thead><tr><th>Name</th><th>Category</th><th>Contact</th><th class="num">Used</th><th>Source</th><th><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>
                ${rows.map(v => `
                  <tr id="vlrow_${vid(v)}" data-user-content class="vend-lib-row"${canEdit ? ` onclick="openVendorLibraryEdit('${vid(v)}')"` : ''}>
                    <td><strong>${esc(v.name)}</strong></td>
                    <td class="meta">${esc(_vendorCatLabel(v.category))}</td>
                    <td class="meta">${contactOf(v)}</td>
                    <td class="num">${esc(v.times_used)}</td>
                    <td>${srcPill(v)}</td>
                    <td class="num">${canEdit ? `<button type="button" class="btn btn-ghost btn-icon" aria-label="Remove ${esc(v.name)} from the library" onclick="event.stopPropagation();deleteVendorFromLibrary('${vid(v)}')">${_vendorIcon('trash-2', 18)}</button>` : ''}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="row-list" data-user-content>
            ${rows.map(v => `
              <div class="row vend-lib-card"${canEdit ? ` onclick="openVendorLibraryEdit('${vid(v)}')"` : ''}>
                <div class="row-main"><div class="row-title">${esc(v.name)}</div><div class="row-sub">${esc(_vendorCatLabel(v.category))} · Used ${esc(v.times_used)}</div></div>
                <div class="row-trail">${srcPill(v)}${canEdit ? `<button type="button" class="btn btn-ghost btn-icon" aria-label="Remove ${esc(v.name)} from the library" onclick="event.stopPropagation();deleteVendorFromLibrary('${vid(v)}')">${_vendorIcon('trash-2', 18)}</button>` : ''}</div>
              </div>`).join('')}
          </div>`;
      } catch(e) {
        libEl.innerHTML = '<p class="vend-note is-error">Could not load the vendor library.</p>';
      }
    }

    async function deleteVendorFromLibrary(id) {
      const token = window._sbToken;
      if (!token) return;
      confirmDestructive('Remove from Library', 'Remove this vendor from the shared library? This cannot be undone.', async function() {
        await _vendorLibFetch('vendor_library?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
        showToast('Removed from library', 'success');
        loadVendorLibrary();
      }, 'Remove');
    }

    // Edit a shared-library row in a small sheet (name and category only, as before)
    function openVendorLibraryEdit(id) {
      const row = (window._vendorLib || []).find(v => String(v.id) === String(id));
      if (!row) return;
      const catOpts = VENDOR_CATEGORIES.map(c => `<option value="${c.id}"${row.category === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
      CRMUI.sheet({
        title: 'Edit library vendor',
        html: `<div class="form-section">
          <div class="field"><label class="field-label" for="vle_name">Name</label><input class="input" id="vle_name" type="text" value="${esc(row.name)}" autocomplete="off"></div>
          <div class="field"><label class="field-label" for="vle_cat">Category</label><select class="input" id="vle_cat"><option value="">Select...</option>${catOpts}</select></div>
        </div>`,
        primary: { label: 'Save', onClick: () => saveVendorLibraryEdit(id) },
        secondary: { label: 'Cancel' }
      });
    }

    async function saveVendorLibraryEdit(id) {
      const token = window._sbToken;
      if (!token) { showToast('Not authenticated', 'error'); return false; }
      const name     = (document.getElementById('vle_name')?.value || '').trim();
      const category = (document.getElementById('vle_cat')?.value || '').trim();
      if (!name) { showToast('Name is required', 'error'); return false; }
      await _vendorLibFetch('vendor_library?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ name, category })
      });
      showToast('Vendor updated', 'success');
      loadVendorLibrary();
    }

    function saveVendor(e) {
      e.preventDefault();
      const vendors = getDB('vendors');
      vendors.push({
        id: genId(),
        name: document.getElementById('vendorName').value.trim(),
        category: document.getElementById('vendorCategory').value,
        contact: document.getElementById('vendorContact').value.trim(),
        email: _vendorCleanEmail(document.getElementById('vendorEmail').value),
        phone: _vendorCleanPhone(document.getElementById('vendorPhone').value)
      });
      setDB('vendors', vendors);
      closeModal('addVendorModal');
      renderVendors();
      showToast('Vendor added', 'success');
      document.getElementById('addVendorForm').reset();
    }

    function openAddVendorModal() { document.getElementById('addVendorForm').reset(); openModal('addVendorModal'); }

    function openVendorDetail(vendorId) {
      const vendors = getDB('vendors');
      const v = vendors.find(x => String(x.id) === String(vendorId));
      if (!v) return;
      const canEdit = _vendorCanEdit();
      const ro = canEdit ? '' : ' readonly';
      const id = esc(String(v.id).replace(/[^\w.-]/g, ''));
      const known = VENDOR_CATEGORIES.some(c => c.id === v.category);
      const catOpts = (known || !v.category ? '' : `<option value="${esc(v.category)}" selected>${esc(_vendorCatLabel(v.category))}</option>`)
        + VENDOR_CATEGORIES.map(c => `<option value="${c.id}"${v.category === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
      document.getElementById('clientDetailContent').innerHTML = `
        <div class="vend-detail" data-user-content>
          <div class="modal-title">${esc(v.name)}</div>
          <div class="vend-detail-sub"><span class="pill pill-neutral">${esc(_vendorCatLabel(v.category))}</span>${v.contact ? `<span class="t-meta">${esc(v.contact)}</span>` : ''}</div>
          <div class="vend-detail-acts">
            ${v.phone ? `<a class="btn btn-secondary" href="${esc(_vendorTelHref(v.phone))}">${_vendorIcon('phone', 18)} Call</a>` : ''}
            ${v.email ? `<a class="btn btn-secondary" href="mailto:${esc(v.email)}">${_vendorIcon('mail', 18)} Email</a>` : ''}
            <a class="btn btn-secondary" href="${esc(_vendorMapHref(v))}" target="_blank" rel="noopener">${_vendorIcon('map-pin', 18)} Map</a>
          </div>
          <div class="form-section">
            <div class="grid-2">
              <div class="form-group"><label class="form-label" for="editVdrName">Name</label><input type="text" class="form-input" id="editVdrName" value="${esc(v.name)}"${ro}></div>
              <div class="form-group"><label class="form-label" for="editVdrCategory">Category</label><select class="form-select" id="editVdrCategory"${canEdit ? '' : ' disabled'}>${catOpts}</select></div>
            </div>
            <div class="grid-2">
              <div class="form-group"><label class="form-label" for="editVdrEmail">Email</label><input type="email" class="form-input" id="editVdrEmail" value="${esc(v.email || '')}" autocomplete="off"${ro}></div>
              <div class="form-group"><label class="form-label" for="editVdrPhone">Phone</label><input type="tel" class="form-input" id="editVdrPhone" value="${esc(v.phone || '')}" autocomplete="off"${ro}></div>
            </div>
            <div class="form-group"><label class="form-label" for="editVdrContact">Contact name</label><input type="text" class="form-input" id="editVdrContact" value="${esc(v.contact || '')}"${ro}></div>
          </div>
          ${canEdit ? `<div class="vend-detail-foot">
            <button type="button" class="btn btn-primary" onclick="saveVendorChanges('${id}')">Save changes</button>
            <button type="button" class="btn btn-secondary" onclick="_vendorSendInfo('${id}')">${_vendorIcon('send', 18)} Send login info</button>
            <button type="button" class="btn btn-ghost vend-del" onclick="closeModal('clientDetailModal');deleteVendor('${id}')">${_vendorIcon('trash-2', 18)} Delete vendor</button>
          </div>` : ''}
        </div>`;
      openModal('clientDetailModal');
    }

    function _vendorSendInfo(vendorId) {
      const v = getDB('vendors').find(x => String(x.id) === String(vendorId));
      if (v && typeof sendLoginInfo === 'function') sendLoginInfo('vendor', { name: v.name, email: v.email || '' });
    }

    function saveVendorChanges(vendorId) {
      const vendors = getDB('vendors');
      const v = vendors.find(x => String(x.id) === String(vendorId));
      if (!v) return;
      v.name     = document.getElementById('editVdrName').value.trim() || v.name;
      v.category = document.getElementById('editVdrCategory').value || v.category;
      v.email    = _vendorCleanEmail(document.getElementById('editVdrEmail').value);
      v.phone    = _vendorCleanPhone(document.getElementById('editVdrPhone').value);
      v.contact  = document.getElementById('editVdrContact').value.trim();
      setDB('vendors', vendors);
      showToast('Vendor saved', 'success');
      closeModal('clientDetailModal');
      renderVendors();
    }

    function deleteVendor(vendorId) {
      const vendors = getDB('vendors');
      window.confirmCallback = () => {
        const updated = vendors.filter(v => String(v.id) !== String(vendorId));
        setDB('vendors', updated);
        closeModal('confirmDialog');
        renderVendors();
        showToast('Vendor deleted', 'success');
      };
      document.getElementById('confirmTitle').textContent = 'Delete vendor';
      document.getElementById('confirmMessage').textContent = 'Delete this vendor? This cannot be undone.';
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

    // ══════════════════════════════════════════════════════════════════════════
    //  INVENTORY (UI-PLAN 3.13). Runs on the existing `equipment` blob; item shape is extended additively.
    //  Section 1: data and pure logic (no DOM). Section 2: views. generatePullList(ev) is called by the event Crew & Gear tab.
    // ══════════════════════════════════════════════════════════════════════════

    const INV_CATEGORIES = ['DJ Gear', 'Audio', 'Speakers', 'Subwoofers', 'Microphones', 'Lighting', 'Visual', 'Special Effects', 'Staging', 'Tripods & Stands', 'Generators', 'Cables & Power', 'Cases & Transport', 'Other'];

    // Generic industry defaults, one entry per service. Owner decision: ship defaults, label them, let the owner replace them later.
    // A service is booked when any `match` keyword appears (word start) in the event's service names, sub-options or quote/invoice line descriptions.
    // Edits made in Inventory > Defaults are saved to settings.inventory.pullDefaults and override `lines` here.
    const INV_DEFAULT_PULL_LISTS = {
      dj: { label: 'DJ', match: ['dj'], lines: [
        { name: 'DJ controller', qty: 1, cat: 'DJ Gear' },
        { name: 'Laptop', qty: 1, cat: 'DJ Gear' },
        { name: 'Powered speaker', qty: 2, cat: 'Audio' },
        { name: 'Speaker stand', qty: 2, cat: 'Audio' },
        { name: 'Subwoofer', qty: 1, cat: 'Audio' },
        { name: 'Wireless mic', qty: 2, cat: 'Audio' },
        { name: 'XLR cable 25 ft', qty: 6, cat: 'Cables & Power' },
        { name: 'Power strip', qty: 2, cat: 'Cables & Power' },
        { name: 'Table + facade', qty: 1, cat: 'Staging' }
      ] },
      mc: { label: 'MC', match: ['mc', 'emcee'], lines: [
        { name: 'Wireless handheld mic', qty: 2, cat: 'Audio' },
        { name: 'Spare AA batteries', qty: 1, unit: 'pcs', consumable: true, note: 'Pack of 8', cat: 'Other' }
      ] },
      sound: { label: 'Sound system', match: ['sound', 'audio', 'speaker', 'pa system'], lines: [
        { name: 'PA speaker', qty: 2, cat: 'Audio' },
        { name: 'PA subwoofer', qty: 2, cat: 'Audio' },
        { name: 'Mixer (8 channel)', qty: 1, cat: 'Audio' },
        { name: 'Speaker stand', qty: 2, cat: 'Audio' },
        { name: 'XLR cable 25 ft', qty: 6, cat: 'Cables & Power' },
        { name: 'Power strip', qty: 2, cat: 'Cables & Power' }
      ] },
      uplighting: { label: 'Uplighting', match: ['uplight'], lines: [
        { name: 'Uplight', qty: 12, cat: 'Lighting' },
        { name: 'Uplight charging case', qty: 2, cat: 'Lighting' },
        { name: 'Power strip', qty: 2, cat: 'Cables & Power' },
        { name: 'Gaff tape roll', qty: 1, unit: 'pcs', consumable: true, cat: 'Other' }
      ] },
      dancefloor_lighting: { label: 'Dance floor lighting', match: ['dance floor light', 'dancefloor', 'intelligent light', 'moving head', 'stage lighting'], lines: [
        { name: 'Moving head', qty: 4, cat: 'Lighting' },
        { name: 'Lighting stand (T-bar)', qty: 2, cat: 'Lighting' },
        { name: 'DMX controller', qty: 1, cat: 'Lighting' },
        { name: 'DMX cable 25 ft', qty: 4, cat: 'Cables & Power' },
        { name: 'Power cable 25 ft', qty: 4, cat: 'Cables & Power' },
        { name: 'Clamp + safety cable', qty: 4, cat: 'Lighting' }
      ] },
      co2: { label: 'CO2 jets', match: ['co2', 'cryo'], lines: [
        { name: 'CO2 jet', qty: 2, cat: 'Special Effects' },
        { name: 'CO2 tank 20 lb', qty: 3, note: '2 + 1 spare', cat: 'Special Effects' },
        { name: 'High-pressure hose 25 ft', qty: 2, cat: 'Special Effects' },
        { name: 'DMX cable 25 ft', qty: 2, cat: 'Cables & Power' }
      ] },
      cold_spark: { label: 'Cold spark', match: ['cold spark', 'spark'], lines: [
        { name: 'Cold spark machine', qty: 2, cat: 'Special Effects' },
        { name: 'Spark granules 200 g', qty: 2, unit: 'pcs', consumable: true, cat: 'Special Effects' },
        { name: 'DMX cable 25 ft', qty: 2, cat: 'Cables & Power' },
        { name: 'Power cable 25 ft', qty: 2, cat: 'Cables & Power' },
        { name: 'Remote / controller', qty: 1, cat: 'Special Effects' }
      ] },
      led_wall: { label: 'LED wall', match: ['led wall', 'video wall', 'led panel'], lines: [
        { name: 'LED panel', qty: 6, cat: 'Visual' },
        { name: 'Processor', qty: 1, cat: 'Visual' },
        { name: 'Ground stack / stand', qty: 2, cat: 'Visual' },
        { name: 'Data cable', qty: 8, cat: 'Cables & Power' },
        { name: 'Power distro', qty: 1, cat: 'Cables & Power' }
      ] },
      dancing_on_clouds: { label: 'Dancing on clouds', match: ['cloud', 'low fog', 'dry ice'], lines: [
        { name: 'Low fog machine', qty: 1, cat: 'Special Effects' },
        { name: 'Fog fluid 1 gal', qty: 1, unit: 'pcs', consumable: true, cat: 'Special Effects' },
        { name: 'Water / ice', qty: 1, note: 'Cooler and ice for the chiller', cat: 'Other' }
      ] },
      live_musicians: { label: 'Live musicians', match: ['musician', 'violin', 'sax', 'percussion', 'band'], lines: [
        { name: 'Mic', qty: 3, cat: 'Audio' },
        { name: 'Mic stand', qty: 3, cat: 'Audio' },
        { name: 'DI box', qty: 2, cat: 'Audio' },
        { name: 'Monitor wedge', qty: 2, cat: 'Audio' }
      ] },
      projection: { label: 'Projection', match: ['projector', 'projection', 'gobo'], lines: [
        { name: 'Projector', qty: 1, cat: 'Visual' },
        { name: 'Projection screen', qty: 1, cat: 'Visual' },
        { name: 'Projector stand', qty: 1, cat: 'Visual' },
        { name: 'HDMI cable 25 ft', qty: 2, cat: 'Cables & Power' },
        { name: 'Power cable 25 ft', qty: 2, cat: 'Cables & Power' }
      ] },
      tv: { label: 'TV displays', match: ['tv', 'display', 'screen'], lines: [
        { name: 'TV display', qty: 2, cat: 'Visual' },
        { name: 'TV floor stand', qty: 2, cat: 'Visual' },
        { name: 'HDMI cable 25 ft', qty: 2, cat: 'Cables & Power' },
        { name: 'Power cable 25 ft', qty: 2, cat: 'Cables & Power' }
      ] }
    };

    let _invUI = { view: 'catalog', arg: '', tab: 'all', q: '', cat: '', month: '', availItem: '', mode: 'out', bound: false, camera: null, flashT: 0 };

    // ── small helpers ────────────────────────────────────────────────────────
    function invPad2(n) { return (n < 10 ? '0' : '') + n; }
    function invNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
    function invId(prefix) { return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function invQ(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_.:-]/g, ''); }
    function invSlug(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
    function invNormText(s) {
      return String(s == null ? '' : s).toLowerCase().replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080)).replace(/\s+/g, ' ').trim();
    }
    function invFold(s) {
      if (typeof window !== 'undefined' && window.CRMUI && CRMUI.norm && CRMUI.norm.fold) return CRMUI.norm.fold(s);
      return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
    function invTodayIso() { const d = new Date(); return d.getFullYear() + '-' + invPad2(d.getMonth() + 1) + '-' + invPad2(d.getDate()); }
    function invClockMin(t) {
      if (t == null || t === '') return null;
      const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(t));
      if (!m) return null;
      let h = +m[1]; const mi = m[2] ? +m[2] : 0; const ap = m[3] ? m[3].toLowerCase() : '';
      if (ap === 'p' && h < 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
      if (h > 24 || mi > 59) return null;
      return h * 60 + mi;
    }

    // ── settings (settings.inventory) ────────────────────────────────────────
    function invGetSettings() {
      const s = getDB('settings');
      const base = (s && !Array.isArray(s) && typeof s === 'object') ? s : {};
      const inv = (base.inventory && typeof base.inventory === 'object') ? base.inventory : {};
      return Object.assign({ enabled: true, scan: true, nextTag: 1, pullDefaults: {}, kits: [], bannerDismissed: false }, inv);
    }
    function invSaveSettings(patch) {
      const s = getDB('settings');
      const base = (s && !Array.isArray(s) && typeof s === 'object') ? s : {};
      base.inventory = Object.assign({}, base.inventory || {}, patch);
      setDB('settings', base);
    }

    // ── store wrapper: swapping the blob for tables later is a change to this one function ──
    function invStore() {
      return {
        list: function() { const a = getDB('equipment'); return Array.isArray(a) ? a : []; },
        get: function(id) { return this.list().find(i => String(i.id) === String(id)) || null; },
        save: function(items) { setDB('equipment', items); }
      };
    }
    function invEventsStore() {
      return {
        list: function() { const a = getDB('events'); return Array.isArray(a) ? a : []; },
        get: function(id) { return this.list().find(e => String(e.id) === String(id)) || null; },
        save: function(events) { setDB('events', events); }
      };
    }

    function invRole() {
      const u = (typeof BSPortal !== 'undefined' && BSPortal.getCurrentUser && BSPortal.getCurrentUser()) || {};
      return u.role || 'master';
    }
    // Crew (dj and other staff roles) pick and scan; they do not change the catalog, the lists or the defaults.
    function invCanEdit() { return ['master', 'admin', 'event-architect'].indexOf(invRole()) > -1; }

    // ── items ────────────────────────────────────────────────────────────────
    // Fill the additive fields on a legacy item. Returns true when something changed.
    function invNormItem(e) {
      let ch = false;
      const set = (k, v) => { if (e[k] === undefined || e[k] === null || e[k] === '') { e[k] = v; ch = true; } };
      set('status', 'available');
      set('tracking', e.serial ? 'serialized' : 'bulk');
      set('qty', 1);
      set('unit', 'pcs');
      if (e.kit === undefined) { e.kit = null; ch = true; }
      if (!e.buffers || typeof e.buffers !== 'object') { e.buffers = { before: 2, after: 2 }; ch = true; }
      set('condition', 'A');
      if (!Array.isArray(e.maintenance)) { e.maintenance = []; ch = true; }
      if (!Array.isArray(e.history)) { e.history = []; ch = true; }
      return ch;
    }
    function invFmtTag(n) { return 'BL-' + String(n).padStart(6, '0'); }
    function invEnsureTags(items) {
      const st = invGetSettings();
      let next = Math.max(1, parseInt(st.nextTag, 10) || 1);
      const used = {};
      items.forEach(i => { if (i.tag) used[String(i.tag).toUpperCase()] = 1; });
      let ch = false;
      items.forEach(i => {
        if (i.tag) return;
        while (used[invFmtTag(next)]) next++;
        i.tag = invFmtTag(next); used[i.tag] = 1; next++; ch = true;
      });
      if (ch) invSaveSettings({ nextTag: next });
      return ch;
    }
    function invNextTag(items) {
      const st = invGetSettings();
      let next = Math.max(1, parseInt(st.nextTag, 10) || 1);
      const used = {};
      (items || []).forEach(i => { if (i.tag) used[String(i.tag).toUpperCase()] = 1; });
      while (used[invFmtTag(next)]) next++;
      const tag = invFmtTag(next);
      invSaveSettings({ nextTag: next + 1 });
      return tag;
    }
    function invItems() {
      const items = invStore().list();
      let ch = false;
      items.forEach(it => { if (invNormItem(it)) ch = true; });
      if (invEnsureTags(items)) ch = true;
      if (ch) invStore().save(items);
      return items;
    }
    function invIsRetired(it) { return !!it && it.status === 'retired'; }
    // Retired items never count as available; items in maintenance are blocked until the work order closes.
    function invIsAvailable(it) { return !!it && it.status !== 'retired' && it.status !== 'maintenance'; }
    function invLog(it, action, evId, note) {
      if (!it) return;
      if (!Array.isArray(it.history)) it.history = [];
      let by = '';
      try { const u = BSPortal.getCurrentUser(); by = (u && (u.name || u.email)) || ''; } catch (e) {}
      it.history.unshift({ at: Date.now(), action: action, eventId: evId || null, by: by, note: note || '' });
      if (it.history.length > 50) it.history.length = 50;
    }
    // ── Purchase info (item.purchase). Lives on the inventory item only: saving it never creates an event cost line.
    // Items bought through the Costs tab (costsRecordGearPurchase in 55-costs.js) already carry item.purchase with an eventId.
    function invFmtC(c) {
      if (typeof costsFmtC === 'function') return costsFmtC(c);
      const v = Math.round(Number(c)) || 0, a = Math.abs(v);
      return (v < 0 ? '-' : '') + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: a % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
    }
    // "25", "$25.50", "1,200" -> cents. Blank -> 0. Anything else -> null.
    function invParsePriceC(v) {
      if (typeof costsParseC === 'function') return costsParseC(v);
      const t = String(v == null ? '' : v).replace(/[$,\s]/g, '');
      if (t === '') return 0;
      if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
      return Math.round(parseFloat(t) * 100);
    }
    // How many units the purchase covered: the recorded qty, else what is on hand now, else 1.
    function invPurchaseQty(it) {
      const q = Math.round(Number(it && it.purchase && it.purchase.qty));
      if (q > 0) return q;
      const n = Math.round(Number(it && it.qty));
      return n > 0 ? n : 1;
    }
    // One item's total paid in cents (price each times units), 0 when there is no price.
    function invPurchaseItemC(it) {
      const p = it && it.purchase;
      const each = Math.round(Number(p && p.priceC));
      return each > 0 ? each * invPurchaseQty(it) : 0;
    }
    // Total spent on gear across a list of items, in cents. Retired items still count: the money was spent.
    function invPurchaseTotalC(items) {
      return (items || []).reduce((s, it) => s + invPurchaseItemC(it), 0);
    }
    function invPurchaseCount(items) { return (items || []).filter(it => invPurchaseItemC(it) > 0).length; }
    // Validate typed purchase fields and merge them onto an existing purchase. Returns { ok, purchase } (purchase null = none) or { ok:false, error }.
    // raw = { date, price, vendor, orderNo, receiptNote }. Clearing every field removes the purchase unless it is linked to an event.
    function invPurchaseBuild(raw, existing, qty) {
      const r = raw || {};
      const priceC = invParsePriceC(r.price);
      if (priceC === null) return { ok: false, error: 'Enter the price like 25 or 25.50' };
      const date = String(r.date || '').trim(), vendor = String(r.vendor || '').trim(), orderNo = String(r.orderNo || '').trim(), receiptNote = String(r.receiptNote || '').trim();
      const ex = (existing && typeof existing === 'object') ? existing : null;
      const any = !!(date || priceC > 0 || vendor || orderNo || receiptNote);
      if (!any && !(ex && ex.eventId)) return { ok: true, purchase: null };
      const p = Object.assign({}, ex || {}, { date: date, priceC: priceC, vendor: vendor, orderNo: orderNo, receiptNote: receiptNote });
      if (!(Math.round(Number(p.qty)) > 0)) p.qty = Math.max(1, Math.round(Number(qty)) || 1);
      if (p.eventId === undefined) p.eventId = '';
      if (p.eventName === undefined) p.eventName = '';
      if (!p.source) p.source = 'inventory';
      return { ok: true, purchase: p };
    }
    function invPurchaseFieldsHtml(pre, p, canEdit) {
      const v = k => esc(p && p[k] != null ? String(p[k]) : '');
      const price = p && Math.round(Number(p.priceC)) > 0 ? (Math.round(Number(p.priceC)) / 100).toFixed(2) : '';
      return '<div class="field"><label class="field-label" for="' + pre + 'Date">Date bought</label><input id="' + pre + 'Date" class="input" type="date" value="' + v('date') + '"></div>'
        + '<div class="field"><label class="field-label" for="' + pre + 'Price">Price each ($)</label><input id="' + pre + 'Price" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(price) + '"></div>'
        + '<div class="field"><label class="field-label" for="' + pre + 'Vendor">Vendor</label><input id="' + pre + 'Vendor" class="input" type="text" autocomplete="off" placeholder="Where you bought it" value="' + v('vendor') + '"></div>'
        + '<div class="field"><label class="field-label" for="' + pre + 'Order">Order number</label><input id="' + pre + 'Order" class="input" type="text" autocomplete="off" value="' + v('orderNo') + '"></div>';
    }
    function invPurchaseReadFields(pre) {
      const g = k => { const el = document.getElementById(pre + k); return el ? el.value : ''; };
      return { date: g('Date'), price: g('Price'), vendor: g('Vendor'), orderNo: g('Order'), receiptNote: g('Note') };
    }
    function invPurchOpenEvent(evId) {
      if (window.CRMUI && CRMUI.closeAll) CRMUI.closeAll();
      if (typeof navigateToEvent === 'function') navigateToEvent(evId);
    }
    function invPurchShow() {
      const f = document.getElementById('invFPFields'), e = document.getElementById('invFPEmpty');
      if (f) f.hidden = false;
      if (e) e.hidden = true;
      const d = document.getElementById('invFPDate'); if (d && d.focus) d.focus();
    }
    // The Purchase block in the item drawer. Editors see fields (or an "Add purchase info" link); everyone else reads a summary.
    function invPurchaseBlockHtml(it, events, canEdit) {
      const p = it.purchase && typeof it.purchase === 'object' ? it.purchase : null;
      const has = !!(p && (p.date || Math.round(Number(p.priceC)) > 0 || p.vendor || p.orderNo || p.receiptNote || p.eventId));
      const head = '<legend class="section-label">Purchase</legend>';
      if (!canEdit) return '';   // what gear cost is owner and manager information; crew never see it
      if (!has) {
        return '<fieldset class="form-section inv-fs">' + head
          + '<div id="invFPEmpty"><p class="t-meta">No purchase info. <button type="button" class="btn btn-ghost btn-sm inv-purch-add" onclick="invPurchShow()">Add purchase info</button></p></div>'
          + '<div id="invFPFields" hidden>' + invPurchaseFieldsHtml('invFP', null, true)
          + '<div class="field"><label class="field-label" for="invFPNote">Receipt note</label><input id="invFPNote" class="input" type="text" autocomplete="off" placeholder="Where the receipt is kept"></div>'
          + '<p class="t-meta">Saved on this item only. It does not add a cost to any event.</p></div></fieldset>';
      }
      const qty = invPurchaseQty(it), each = Math.round(Number(p.priceC)) || 0;
      let evRow = '';
      if (p.eventId) {
        const ev = (events || []).find(e => String(e.id) === String(p.eventId));
        const name = (ev && ev.name) || p.eventName || 'an event';
        evRow = '<div class="inv-purch-ev">Bought for ' + (ev ? '<button type="button" class="btn btn-ghost btn-sm inv-purch-link" onclick="invPurchOpenEvent(\'' + invQ(p.eventId) + '\')">' + esc(name) + '</button>' : '<strong>' + esc(name) + '</strong>') + '</div>';
      }
      const total = each > 0 && qty > 1 ? '<p class="t-meta">' + qty + ' bought, ' + esc(invFmtC(each * qty)) + ' in all.</p>' : '';
      return '<fieldset class="form-section inv-fs">' + head + evRow + invPurchaseFieldsHtml('invFP', p, true)
        + '<div class="field"><label class="field-label" for="invFPNote">Receipt note</label><input id="invFPNote" class="input" type="text" autocomplete="off" placeholder="Where the receipt is kept" value="' + esc(p.receiptNote || '') + '"></div>'
        + total + (p.eventId ? '<p class="t-meta">Changing the price here does not change that event\'s costs.</p>' : '') + '</fieldset>';
    }
    function invSpentHtml(items) {
      const n = invPurchaseCount(items);
      if (!n) return '';
      return '<div class="inv-spent" role="status"><span class="inv-spent-label">Spent on gear</span><span class="inv-spent-val num">' + esc(invFmtC(invPurchaseTotalC(items))) + '</span>'
        + '<span class="t-meta">across ' + n + (n === 1 ? ' item' : ' items') + ' with purchase info</span></div>';
    }
    function invFindItemByCode(items, raw) {
      let c = String(raw == null ? '' : raw).trim();
      if (!c) return null;
      const url = /\/t\/([A-Za-z0-9-]+)\s*$/.exec(c);
      if (url) c = url[1];
      c = c.toUpperCase().replace(/\s+/g, '');
      const digits = /^(?:BL-?)?(\d{1,6})$/.exec(c);
      const tag = digits ? invFmtTag(parseInt(digits[1], 10)) : c;
      return items.find(i => i.tag && String(i.tag).toUpperCase() === tag)
          || items.find(i => i.serial && String(i.serial).toUpperCase().replace(/\s+/g, '') === c) || null;
    }
    function invTokens(name) {
      const stop = { ft: 1, lb: 1, pcs: 1, the: 1, and: 1, with: 1, for: 1, set: 1, unit: 1, gal: 1 };
      return invFold(name).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !/^\d+$/.test(t) && !stop[t]);
    }
    // How well does a stock item fit a pull-list line? 0 to 1 (shared words over the shorter name, plus a category nudge).
    function invMatchScore(line, item) {
      const a = invTokens(line.name), b = invTokens(item.name);
      if (!a.length || !b.length) return 0;
      let shared = 0;
      a.forEach(t => { if (b.indexOf(t) > -1) shared++; });
      let s = shared / Math.min(a.length, b.length);
      if (line.cat && item.category && String(line.cat).toLowerCase() === String(item.category).toLowerCase()) s += 0.15;
      return Math.min(1, s);
    }

    // ── pull list generation ─────────────────────────────────────────────────
    function invDefaultLists() {
      const ov = invGetSettings().pullDefaults || {};
      const out = {};
      Object.keys(INV_DEFAULT_PULL_LISTS).forEach(k => {
        const base = INV_DEFAULT_PULL_LISTS[k];
        const o = ov[k];
        out[k] = { key: k, label: base.label, match: base.match, lines: (o && Array.isArray(o.lines)) ? o.lines : base.lines, edited: !!(o && Array.isArray(o.lines)) };
      });
      return out;
    }
    function invKeywordHit(text, kw) {
      const k = invNormText(kw);
      if (!k) return false;
      const rx = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = k.length <= 3 ? new RegExp('(^|[^a-z0-9])' + rx + '($|[^a-z0-9])') : new RegExp('(^|[^a-z0-9])' + rx);
      return re.test(text);
    }
    // The wizard stores picked services on ev.services; quotes and invoices carry line descriptions (_detectEventServices in 35-documents.js).
    function invEventServiceTexts(ev) {
      const out = [];
      (ev.services || []).forEach(s => {
        if (s == null) return;
        if (typeof s === 'string') { out.push(invNormText(s)); return; }
        out.push(invNormText([s.service || s.name || '', s.subOption || '', s.customNote || ''].join(' ')));
      });
      if (typeof _detectEventServices === 'function') {
        try { _detectEventServices(ev).forEach(d => out.push(invNormText(d))); } catch (e) {}
      }
      return out.filter(Boolean);
    }
    function invModulesFor(ev, lists) {
      const texts = invEventServiceTexts(ev);
      const L = lists || invDefaultLists();
      return Object.keys(L).filter(k => (L[k].match || []).some(kw => texts.some(t => invKeywordHit(t, kw))));
    }
    function invBuildLines(keys, lists) {
      const L = lists || invDefaultLists();
      const map = {};
      const out = [];
      keys.forEach(k => {
        ((L[k] && L[k].lines) || []).forEach(src => {
          if (!src || !src.name) return;
          const unit = src.unit || '';
          const key = invSlug(src.name) + (unit ? '|' + unit : '');
          const qty = Math.max(0, Math.round(invNum(src.qty)) || 0);
          if (map[key]) {
            map[key].qty += qty;
            if (map[key].modules.indexOf(k) < 0) map[key].modules.push(k);
            if (src.note && map[key].note.indexOf(src.note) < 0) map[key].note = map[key].note ? map[key].note + '; ' + src.note : src.note;
            return;
          }
          const line = { id: invId('pl'), key: key, name: src.name, qty: qty, unit: unit, consumable: !!src.consumable, cat: src.cat || '',
                         modules: [k], note: src.note || '', itemId: null, itemIds: [], picked: 0, out: 0, 'in': 0, damaged: 0 };
          map[key] = line; out.push(line);
        });
      });
      return out;
    }
    function invDiffText(diff) {
      const parts = [];
      (diff.added || []).forEach(a => parts.push('+' + a.qty + ' ' + a.name));
      (diff.changed || []).forEach(c => { const d = c.to - c.from; parts.push((d > 0 ? '+' : '-') + Math.abs(d) + ' ' + c.name); });
      (diff.removed || []).forEach(r => parts.push('-' + r.qty + ' ' + r.name));
      if (!parts.length) return '';
      return parts.length > 4 ? parts.slice(0, 4).join(', ') + ' and ' + (parts.length - 4) + ' more' : parts.join(', ');
    }
    // Build or rebuild ev.pullList. Never clears picked/out/in counts; lines you added by hand stay.
    // opts.dry: compute only, touch nothing. Returns { list, diff, created }.
    function invSyncPullList(ev, opts) {
      opts = opts || {};
      const lists = invDefaultLists();
      const keys = invModulesFor(ev, lists);
      const fresh = invBuildLines(keys, lists);
      const prev = ev.pullList && Array.isArray(ev.pullList.lines) ? ev.pullList : null;
      const diff = { added: [], removed: [], changed: [], kept: [] };
      let lines;
      if (!prev) {
        lines = fresh;
        fresh.forEach(f => { if (f.qty) diff.added.push({ name: f.name, qty: f.qty }); });
      } else {
        const byKey = {};
        prev.lines.forEach(l => { if (l.key) byKey[l.key] = l; });
        const seen = {};
        lines = [];
        fresh.forEach(f => {
          const o = byKey[f.key];
          if (o) {
            seen[f.key] = 1;
            if (invNum(o.qty) !== f.qty) diff.changed.push({ name: f.name, from: invNum(o.qty), to: f.qty });
            lines.push(Object.assign({}, o, { qty: f.qty, modules: f.modules, unit: f.unit, consumable: f.consumable, cat: f.cat, stale: false }));
          } else {
            lines.push(f);
            if (f.qty) diff.added.push({ name: f.name, qty: f.qty });
          }
        });
        prev.lines.forEach(o => {
          if (o.key && seen[o.key]) return;
          const worked = invNum(o.picked) > 0 || invNum(o.out) > 0 || invNum(o['in']) > 0;
          if (o.manual || !o.key || worked) { lines.push(o.manual || !o.key ? o : Object.assign({}, o, { stale: true })); if (!o.manual && o.key) diff.kept.push({ name: o.name, qty: invNum(o.qty) }); }
          else diff.removed.push({ name: o.name, qty: invNum(o.qty) });
        });
      }
      const changed = !!(prev && (diff.added.length || diff.removed.length || diff.changed.length));
      const list = {
        generatedAt: Date.now(),
        from: keys,
        status: prev ? (prev.status || 'draft') : 'draft',
        edited: keys.some(k => lists[k].edited),
        lines: lines
      };
      if (prev) {
        ['readyAt', 'outAt', 'closedAt', 'lastChange', 'changed'].forEach(k => { if (prev[k] !== undefined) list[k] = prev[k]; });
        if (changed) {
          list.lastChange = { at: Date.now(), text: invDiffText(diff) };
          if (list.status === 'ready' || list.status === 'out') list.changed = true;
        }
      }
      if (!opts.dry) {
        ev.pullList = list;
        const events = invEventsStore().list();
        const mine = events.find(e => e && String(e.id) === String(ev.id));
        if (mine && mine !== ev) mine.pullList = list;
        invEventsStore().save(events);
      }
      return { list: list, diff: diff, created: !prev };
    }
    // Public (UI-PLAN contract): P2's Crew & Gear tab calls this. Returns the list object.
    function generatePullList(ev, opts) {
      opts = opts || {};
      if (!ev) return null;
      const r = invSyncPullList(ev, opts);
      if (!opts.silent && typeof showToast === 'function') {
        if (r.created) showToast('Pull list ready: ' + r.list.lines.length + ' lines', 'success');
        else { const t = invDiffText(r.diff); showToast(t ? 'Pull list updated: ' + t : 'Pull list is up to date', t ? 'success' : 'info'); }
      }
      return r.list;
    }
    function invQty(l) { return Math.max(0, invNum(l && l.qty)); }
    function invPullSummary(ev) {
      const pl = ev && ev.pullList;
      if (!pl || !Array.isArray(pl.lines)) return { has: false, status: 'none', total: 0, picked: 0, out: 0, back: 0, lines: 0 };
      let total = 0, picked = 0, out = 0, back = 0;
      pl.lines.forEach(l => {
        const q = invQty(l);
        total += q; picked += Math.min(q, invNum(l.picked)); out += Math.min(q, invNum(l.out)); back += Math.min(q, invNum(l['in']));
      });
      return { has: true, status: pl.status || 'draft', total: total, picked: picked, out: out, back: back, lines: pl.lines.length };
    }

    // ── availability and conflicts ───────────────────────────────────────────
    function invEventLive(ev) { return !!ev && ev.status !== 'cancelled'; }
    function invEventWindow(ev, item) {
      if (!ev || !ev.date) return null;
      const st = invClockMin(ev.startTime), en = invClockMin(ev.endTime);
      const base = new Date(String(ev.date).slice(0, 10) + 'T00:00:00').getTime();
      if (isNaN(base)) return null;
      let start = base + (st == null ? 0 : st) * 60000;
      let end = base + (en == null ? 23 * 60 + 59 : en) * 60000;
      if (end <= start) end += 86400000;
      const b = (item && item.buffers) || {};
      const before = b.before === undefined || b.before === '' ? 2 : invNum(b.before);
      const after = b.after === undefined || b.after === '' ? 2 : invNum(b.after);
      return [start - before * 3600000, end + after * 3600000];
    }
    function invLineItemIds(l) {
      const arr = Array.isArray(l.itemIds) ? l.itemIds.slice() : [];
      if (l.itemId && arr.indexOf(l.itemId) < 0) arr.unshift(l.itemId);
      return arr;
    }
    function invUseQty(l, it) {
      const ids = invLineItemIds(l);
      if (it.tracking === 'serialized') return 1;
      return ids.length > 1 ? Math.max(1, Math.round(invQty(l) / ids.length)) : Math.max(1, invQty(l));
    }
    function invEvCmp(a, b) {
      return String(a.date || '').localeCompare(String(b.date || '')) || (invClockMin(a.startTime) || 0) - (invClockMin(b.startTime) || 0);
    }
    function invUsesOf(events, it) {
      const uses = [];
      (events || []).forEach(ev => {
        if (!invEventLive(ev) || !ev.pullList || !Array.isArray(ev.pullList.lines) || ev.pullList.status === 'closed') return;
        const win = invEventWindow(ev, it);
        if (!win) return;
        ev.pullList.lines.forEach(l => { if (invLineItemIds(l).indexOf(it.id) > -1) uses.push({ ev: ev, line: l, win: win, qty: invUseQty(l, it) }); });
      });
      return uses;
    }
    // Warn, never block. Serialized items conflict when two events overlap; bulk items when peak demand passes stock.
    // Retired items are skipped. A line with an override note marks the conflict as overridden.
    function invFindConflicts(events, items) {
      const out = [];
      (items || []).forEach(it => {
        if (!it || invIsRetired(it)) return;
        const uses = invUsesOf(events, it);
        if (uses.length < 2) return;
        const bulk = it.tracking === 'bulk' || it.tracking === 'consumable';
        if (!bulk) {
          for (let i = 0; i < uses.length; i++) for (let j = i + 1; j < uses.length; j++) {
            const a = uses[i], b = uses[j];
            if (String(a.ev.id) === String(b.ev.id)) continue;
            if (!(a.win[0] < b.win[1] && b.win[0] < a.win[1])) continue;
            const ov = a.line.override || b.line.override || '';
            out.push({ kind: 'double', itemId: it.id, itemName: it.name, events: [a.ev, b.ev].sort(invEvCmp), lines: [a.line, b.line],
                       overlap: [Math.max(a.win[0], b.win[0]), Math.min(a.win[1], b.win[1])], overridden: !!ov, note: ov });
          }
        } else {
          const have = Math.max(1, parseInt(it.qty, 10) || 1);
          const seen = {};
          uses.forEach(u => {
            const group = uses.filter(v => v.win[0] < u.win[1] && u.win[0] < v.win[1]);
            const ids = [];
            group.forEach(g => { if (ids.indexOf(String(g.ev.id)) < 0) ids.push(String(g.ev.id)); });
            if (ids.length < 2) return;
            const need = group.reduce((s, g) => s + g.qty, 0);
            if (need <= have) return;
            const k = ids.slice().sort().join('|');
            if (seen[k]) return;
            seen[k] = 1;
            const evs = [];
            group.forEach(g => { if (!evs.some(e => String(e.id) === String(g.ev.id))) evs.push(g.ev); });
            const ov = group.map(g => g.line.override).filter(Boolean)[0] || '';
            out.push({ kind: 'short', itemId: it.id, itemName: it.name, events: evs.sort(invEvCmp), lines: group.map(g => g.line),
                       overlap: [Math.max.apply(null, group.map(g => g.win[0])), Math.min.apply(null, group.map(g => g.win[1]))],
                       need: need, have: have, overridden: !!ov, note: ov });
          });
        }
      });
      return out;
    }
    function invDayShort(ms) {
      const d = new Date(ms);
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate();
    }
    function invConflictText(c) {
      if (c.kind === 'short') return c.itemName + ': need ' + c.need + ', have ' + c.have + ' on ' + invDayShort(c.overlap[0]);
      return c.itemName + ' is on two events ' + invDayShort(c.overlap[0]);
    }
    // The next event (today or later) that holds this item on a pull list that has not closed.
    function invNextUse(events, it) {
      const today = invTodayIso();
      const uses = invUsesOf(events, it).filter(u => String(u.ev.date).slice(0, 10) >= today);
      uses.sort((a, b) => invEvCmp(a.ev, b.ev));
      return uses[0] || null;
    }
    // Is the item out right now (on an event whose list is checked out and not closed)?
    function invIsOut(events, it) {
      return invUsesOf(events, it).some(u => u.ev.pullList.status === 'out');
    }

    // ── Section 2: views ─────────────────────────────────────────────────────
    function invIcon(n, s) { return (window.CRMUI && CRMUI.icon) ? CRMUI.icon(n, s || 20) : ''; }
    function invIsPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches); }
    function invBody() { return document.getElementById('invBody'); }
    function invActions(html) {
      const sec = document.getElementById('equipment');
      const pa = document.getElementById('pageActions');
      if (pa && sec && sec.classList.contains('active')) pa.innerHTML = html || '';
    }
    function invPill(label, tone) { return '<span class="pill pill-' + (tone || 'neutral') + '" data-ui="pill">' + esc(label) + '</span>'; }
    function invFmtDate(iso, style) {
      if (!iso) return '';
      if (window.CRMUI && CRMUI.fmt && CRMUI.fmt.date) { try { return CRMUI.fmt.date(String(iso).slice(0, 10), style || 'list'); } catch (e) {} }
      const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
      return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function invFmtTime(t) {
      const m = invClockMin(t);
      if (m == null) return '';
      const h = Math.floor(m / 60) % 24, mi = m % 60;
      return (h % 12 || 12) + ':' + invPad2(mi) + ' ' + (h < 12 ? 'AM' : 'PM');
    }
    function invEmpty(icon, title, text, btn) {
      return '<div class="empty">' + invIcon(icon, 32) + '<div class="empty-title">' + esc(title) + '</div><div class="empty-text">' + esc(text) + '</div>' + (btn || '') + '</div>';
    }
    // Events this person may see. Crew (dj) only see events they are assigned to.
    function invVisibleEvents() {
      const events = invEventsStore().list();
      let u = null;
      try { u = BSPortal.getCurrentUser(); } catch (e) {}
      if (u && u.role === 'dj') return events.filter(e => (e.staff || []).indexOf(u.id) > -1);
      return events;
    }
    function invCatList(items) {
      const seen = {};
      INV_CATEGORIES.forEach(c => { seen[c] = 1; });
      items.forEach(i => { if (i.category && !seen[i.category]) seen[i.category] = 1; });
      return Object.keys(seen);
    }
    function invStatePill(it, events) {
      if (invIsRetired(it)) return invPill('Retired', 'neutral');
      if (it.status === 'maintenance') return invPill('Maintenance', 'warn');
      if (invIsOut(events, it)) return invPill('Out', 'info');
      if (it.status === 'assigned') return invPill('Assigned', 'info');
      return invPill('Available', 'ok');
    }
    function invQtyText(it) {
      if (it.tracking === 'serialized') return '1';
      const u = it.unit && it.unit !== 'pcs' ? ' ' + it.unit : '';
      return invNum(it.qty) + u;
    }
    function invOffHtml() {
      return '<div class="inv">' + invEmpty('boxes', 'Inventory is turned off', 'Turn it on to track gear, build pull lists for each event and check gear out and back in.',
        invCanEdit() ? '<button type="button" class="btn btn-secondary" onclick="invSetEnabled(true)">Turn on inventory</button>' : '') + '</div>';
    }
    function invSetEnabled(on) {
      invSaveSettings({ enabled: !!on });
      renderEquipment();
    }

    // ── routing (sub-views live under #/equipment/<view>[/<arg>]) ─────────────
    function invParseHash(hash) {
      const m = /^#\/equipment\/([a-z-]+)(?:\/([^\/?]+))?\/?$/.exec(String(hash || ''));
      if (!m) return { view: 'catalog', arg: '' };
      const v = m[1];
      let view = 'catalog';
      if (v === 'availability' || v === 'calendar') view = 'availability';
      else if (v === 'defaults' || v === 'pull-defaults' || v === 'pulllist-defaults') view = 'defaults';
      else if (/^pull(-?list)?s?$/.test(v)) view = 'pulllist';
      else if (v === 'scan') view = 'scan';
      else if (v === 'maintenance' || v === 'work-orders') view = 'maintenance';
      else if (v === 'purchases') view = 'purchases';
      else if (v === 'subscriptions') view = 'subscriptions';
      let arg = '';
      if (m[2]) { try { arg = decodeURIComponent(m[2]); } catch (e) { arg = m[2]; } }
      return { view: view, arg: arg };
    }
    function invHashFor(view, arg) {
      const a = arg ? '/' + encodeURIComponent(arg) : '';
      if (view === 'availability') return '#/equipment/availability';
      if (view === 'pulllist') return '#/equipment/pulllist' + a;
      if (view === 'scan') return '#/equipment/scan' + a;
      if (view === 'maintenance') return '#/equipment/maintenance';
      if (view === 'defaults') return '#/equipment/defaults';
      if (view === 'purchases') return '#/equipment/purchases';
      if (view === 'subscriptions') return '#/equipment/subscriptions';
      return '#/equipment';
    }
    // The router leaves #/equipment/<view> alone (it ignores hashes it cannot parse), so this file listens for it.
    // Bound lazily from renderEquipment, from the helpers other lanes call, and (ask) from the boot sequence: invBindRoutes().
    function invBindRoutes() {
      if (_invUI.bound) return;
      _invUI.bound = true;
      window.addEventListener('hashchange', invOnHash);
      window.addEventListener('pagehide', invStopCamera);
      if (window.matchMedia) {
        const mq = window.matchMedia('(max-width: 767.98px)');
        const f = function() {
          const sec = document.getElementById('equipment');
          if (sec && sec.classList.contains('active') && (_invUI.view === 'catalog' || _invUI.view === 'pulllist')) invRenderBody();
        };
        if (mq.addEventListener) mq.addEventListener('change', f);
      }
    }
    function invOnHash() {
      if (!/^#\/equipment(\/|$)/.test(location.hash)) { invStopCamera(); return; }
      invRenderFromHash();
    }
    function invRenderFromHash() {
      const sec = document.getElementById('equipment');
      if (!sec) return;
      if (!sec.classList.contains('active')) {
        // Come in from another section without the router rewriting the hash we were given.
        const guard = typeof _routeApplying === 'number';
        try { if (guard) _routeApplying++; switchSection('equipment'); }
        finally { if (guard) _routeApplying--; }
        return;
      }
      renderEquipment();
    }
    function invGo(view, arg) {
      invBindRoutes();
      const h = invHashFor(view, arg);
      if (location.hash === h || (view === 'catalog' && (location.hash === '' || location.hash === '#/equipment/'))) { invRenderFromHash(); return; }
      location.hash = h;
      setTimeout(function() {
        const r = invParseHash(location.hash);
        if (document.getElementById('equipment') && document.getElementById('equipment').classList.contains('active') && (r.view !== _invUI.view || r.arg !== _invUI.arg)) invRenderFromHash();
      }, 80);
    }
    // For other lanes: the event Crew and Gear tab opens these.
    function openPullList(eventId) { invGo('pulllist', eventId); }
    function openInventoryScan(eventId) { invGo('scan', eventId); }
    function openInventoryAvailability() { invGo('availability'); }

    function invNavHtml(view) {
      const cur = view === 'scan' ? 'pulllist' : view;
      const tabs = [['catalog', 'Catalog'], ['availability', 'Availability'], ['pulllist', 'Pull lists'], ['maintenance', 'Maintenance']];
      if (invCanEdit()) { tabs.push(['purchases', 'Purchases']); tabs.push(['subscriptions', 'Subscriptions']); tabs.push(['defaults', 'Defaults']); }
      return '<div class="tabs inv-tabs" role="tablist" aria-label="Inventory views">' + tabs.map(t =>
        '<button type="button" class="tab-btn' + (cur === t[0] ? ' active' : '') + '" role="tab" aria-selected="' + (cur === t[0]) + '" data-inv-view="' + t[0] + '" onclick="invGo(\'' + t[0] + '\')">' + t[1] + '</button>').join('') + '</div>';
    }

    // Section entry point (switchSection calls this). Rewrites #equipment completely; the old static markup is gone.
    function renderEquipment() {
      const root = document.getElementById('equipment');
      if (!root) return;
      invBindRoutes();
      invStopCamera();
      const st = invGetSettings();
      if (!st.enabled) { invActions(''); root.innerHTML = invOffHtml(); return; }
      const r = invParseHash(location.hash);
      if ((r.view === 'defaults' || r.view === 'purchases' || r.view === 'subscriptions') && !invCanEdit()) { r.view = 'catalog'; r.arg = ''; }
      _invUI.view = r.view;
      _invUI.arg = r.arg;
      if (r.view !== 'scan') _invUI.scanFor = '';   // the next visit to the scan screen picks Out or In from the list status again
      invItems();   // one-time migration of legacy items (tag, tracking, qty, buffers, history)
      root.innerHTML = '<div class="inv" id="invRoot">' + ((r.view === 'scan' || (r.view === 'pulllist' && r.arg)) ? '' : invNavHtml(r.view)) + '<div class="inv-body" id="invBody" data-inv-view="' + r.view + '"></div></div>';
      invRenderBody();
    }
    function invRenderBody() {
      const b = invBody();
      if (!b) return;
      const v = _invUI.view;
      try {
        if (v === 'availability') invViewAvailability(b);
        else if (v === 'pulllist') invViewPullList(b, _invUI.arg);
        else if (v === 'scan') invViewScan(b, _invUI.arg);
        else if (v === 'maintenance') invViewMaintenance(b);
        else if (v === 'defaults') invViewDefaults(b);
        else if (v === 'purchases' && typeof invViewPurchases === 'function') invViewPurchases(b);
        else if (v === 'subscriptions' && typeof invViewSubscriptions === 'function') invViewSubscriptions(b);
        else invViewCatalog(b);
      } catch (e) {
        console.warn('[inventory]', e);
        b.innerHTML = invEmpty('circle-alert', 'This view did not load', 'Refresh the page and try again. Your gear list is safe.');
      }
    }
    function invRerender(focusSel) {
      invRenderBody();
      if (focusSel) { const el = document.querySelector(focusSel); if (el && el.focus) el.focus({ preventScroll: true }); }
    }

    // ── Catalog ──────────────────────────────────────────────────────────────
    function invViewCatalog(b) {
      const items = invItems();
      const events = invEventsStore().list();
      const canEdit = invCanEdit();
      invActions(canEdit ? '<button type="button" class="btn btn-primary" onclick="openAddEquipmentModal()">' + invIcon('plus', 18) + ' Add item</button>'
        + '<button type="button" class="btn btn-secondary" onclick="invPrintLabels()">' + invIcon('printer', 18) + ' Print labels</button>' : '');
      const st = invGetSettings();
      const conflicts = invFindConflicts(events, items).filter(c => !c.overridden);
      const banner = conflicts.length
        ? '<div class="banner banner-warn" role="status">' + invIcon('triangle-alert', 20) + '<div class="banner-body"><div class="banner-title">' + esc(invConflictText(conflicts[0])) + (conflicts.length > 1 ? ' and ' + (conflicts.length - 1) + ' more' : '') + '</div></div>'
          + '<button type="button" class="btn btn-secondary btn-sm" onclick="invGo(\'availability\')">See availability</button></div>' : '';
      const cnt = t => items.filter(i => i.tracking === t).length;
      const tabs = [['all', 'All', items.length], ['serialized', 'Serialized', cnt('serialized')], ['bulk', 'Bulk', cnt('bulk')], ['consumable', 'Consumables', cnt('consumable')], ['kits', 'Kits', (st.kits || []).length]];
      const seg = '<div class="seg inv-seg" role="group" aria-label="Item type">' + tabs.map(t =>
        '<button type="button" class="seg-btn' + (_invUI.tab === t[0] ? ' active' : '') + '" aria-pressed="' + (_invUI.tab === t[0]) + '" onclick="invSetTab(\'' + t[0] + '\')">' + t[1] + '</button>').join('') + '</div>';
      const cats = invCatList(items).filter(c => items.some(i => (i.category || 'Other') === c));
      const chips = _invUI.tab === 'kits' ? '' : '<div class="inv-chips" role="group" aria-label="Filter by category"><button type="button" class="chip' + (_invUI.cat ? '' : ' is-selected') + '" aria-pressed="' + (!_invUI.cat) + '" onclick="invSetCat(\'\')">All</button>'
        + cats.map((c, i) => '<button type="button" class="chip' + (_invUI.cat === c ? ' is-selected' : '') + '" aria-pressed="' + (_invUI.cat === c) + '" onclick="invSetCat(' + i + ')">' + esc(c) + '</button>').join('') + '</div>';
      _invUI.cats = cats;
      b.innerHTML = banner
        + (canEdit ? invSpentHtml(items) : '')
        + '<div class="inv-toolbar">' + seg
        + '<div class="input-wrap input-search inv-search">' + invIcon('search', 18) + '<input id="invSearch" class="input" type="search" placeholder="Search name, tag, serial, vendor or order number" aria-label="Search inventory" value="' + esc(_invUI.q) + '" oninput="invOnSearch(this.value)" autocomplete="off"></div></div>'
        + chips + '<div id="invList"></div>';
      invRenderList();
    }
    function invSetTab(t) { _invUI.tab = t; _invUI.cat = ''; invRenderBody(); }
    function invSetCat(i) { _invUI.cat = i === '' ? '' : ((_invUI.cats || [])[i] || ''); invRenderBody(); }
    function invOnSearch(v) { _invUI.q = v; invRenderList(); }
    function invFilteredItems(items) {
      let list = items.slice();
      if (_invUI.tab !== 'all' && _invUI.tab !== 'kits') list = list.filter(i => i.tracking === _invUI.tab);
      if (_invUI.cat) list = list.filter(i => (i.category || 'Other') === _invUI.cat);
      if (_invUI.q) {
        const f = invFold(_invUI.q);
        const canBuy = invCanEdit();   // vendor and order number are searchable by owner and managers only
        list = list.filter(i => [i.name, i.tag, i.serial, i.category, i.notes, canBuy && i.purchase && i.purchase.vendor, canBuy && i.purchase && i.purchase.orderNo].some(x => invFold(x).indexOf(f) > -1));
      }
      list.sort((a, b) => String(a.category || 'Other').localeCompare(String(b.category || 'Other')) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    function invRenderList() {
      const host = document.getElementById('invList');
      if (!host) return;
      if (_invUI.tab === 'kits') { host.innerHTML = invKitsHtml(); return; }
      const items = invItems();
      const events = invEventsStore().list();
      const list = invFilteredItems(items);
      const canEdit = invCanEdit();
      if (!list.length) {
        host.innerHTML = items.length
          ? invEmpty('search', 'Nothing matches', 'Clear the search or pick another category.')
          : invEmpty('boxes', 'No gear yet', 'Add your first item or import later from a spreadsheet.', canEdit ? '<button type="button" class="btn btn-secondary" onclick="openAddEquipmentModal()">Add item</button>' : '');
        return;
      }
      const nextOf = it => { const u = invNextUse(events, it); return u ? { date: u.ev.date, name: u.ev.name } : null; };
      const kebab = it => '<button type="button" class="btn btn-ghost btn-icon" aria-label="More actions for ' + esc(it.name) + '" aria-haspopup="menu" onclick="event.stopPropagation();invItemMenu(this,\'' + invQ(it.id) + '\')">' + invIcon('ellipsis-vertical', 20) + '</button>';
      if (invIsPhone()) {
        host.innerHTML = '<div class="row-list">' + list.map(it => {
          const nx = nextOf(it);
          return '<div class="row inv-row" data-item-id="' + esc(invQ(it.id)) + '" onclick="invOpenItem(\'' + invQ(it.id) + '\')">'
            + '<button type="button" class="row-link row-main" aria-label="Open ' + esc(it.name) + '"><span class="row-title" data-user-content>' + esc(it.name) + '</span>'
            + '<span class="row-sub">' + esc(it.tag) + ' · ' + esc(it.category || 'Other') + (it.tracking !== 'serialized' ? ' · ' + esc(invQtyText(it)) : '') + '</span>'
            + (nx ? '<span class="row-sub">Next: ' + esc(invFmtDate(nx.date)) + '</span>' : '') + '</button>'
            + '<div class="row-trail">' + invStatePill(it, events) + kebab(it) + '</div></div>';
        }).join('') + '</div>';
        return;
      }
      host.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tag</th><th>Name</th><th class="hide-tablet">Category</th><th class="num">On hand</th><th>Status</th><th class="hide-tablet">Next event</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>'
        + list.map(it => {
          const nx = nextOf(it);
          return '<tr class="inv-tr" tabindex="0" data-item-id="' + esc(invQ(it.id)) + '" data-user-content onclick="invOpenItem(\'' + invQ(it.id) + '\')" onkeydown="if(event.key===\'Enter\'){invOpenItem(\'' + invQ(it.id) + '\')}">'
            + '<td class="inv-tag-cell">' + esc(it.tag) + '</td><td><strong>' + esc(it.name) + '</strong>' + (it.serial ? '<div class="t-meta">S/N ' + esc(it.serial) + '</div>' : '') + '</td>'
            + '<td class="meta hide-tablet">' + esc(it.category || 'Other') + '</td><td class="num">' + esc(invQtyText(it)) + '</td><td>' + invStatePill(it, events) + '</td>'
            + '<td class="meta hide-tablet">' + (nx ? esc(invFmtDate(nx.date)) + ' · ' + esc(nx.name) : '-') + '</td><td class="num">' + kebab(it) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    function invItemMenu(btn, id) {
      const it = invStore().get(id);
      if (!it || !(window.CRMUI && CRMUI.menu)) return;
      const rows = [{ label: 'Open', icon: 'eye', onSelect: () => invOpenItem(id) }, { label: 'Print label', icon: 'printer', onSelect: () => invPrintLabels([id]) }];
      if (invCanEdit()) {
        if (!invIsRetired(it)) rows.push({ label: 'Open work order', icon: 'wrench', onSelect: () => invOpenWorkOrder(id) });
        if (it.status === 'maintenance' || invIsRetired(it)) rows.push({ label: 'Mark available', icon: 'circle-check', onSelect: () => invSetItemStatus(id, 'available') });
        rows.push({ label: 'Remove', icon: 'trash-2', danger: true, onSelect: () => deleteEquipment(id) });
      }
      CRMUI.menu(btn, rows);
    }

    // ── Kits (a named group of items; stored in settings.inventory.kits, items carry item.kit) ──
    function invKitsHtml() {
      const kits = invGetSettings().kits || [];
      const items = invItems();
      const canEdit = invCanEdit();
      const head = canEdit ? '<div class="inv-kit-head"><button type="button" class="btn btn-secondary" onclick="invNewKit()">' + invIcon('plus', 18) + ' New kit</button></div>' : '';
      if (!kits.length) return head + invEmpty('package', 'No kits yet', 'A kit groups gear that travels together, like a cold spark machine with its cables and case.');
      return head + '<div class="row-list">' + kits.map(k => {
        const mem = items.filter(i => i.kit === k.id);
        return '<div class="row inv-row" onclick="invOpenKit(\'' + invQ(k.id) + '\')"><span class="row-ic">' + invIcon('package', 20) + '</span><button type="button" class="row-link row-main"><span class="row-title">' + esc(k.name) + '</span>'
          + '<span class="row-sub">' + (mem.length ? esc(mem.map(m => m.name).join(', ')) : 'No items yet') + '</span></button><div class="row-trail">' + invPill(mem.length + (mem.length === 1 ? ' item' : ' items'), 'neutral') + '</div></div>';
      }).join('') + '</div>';
    }
    function invNewKit() {
      CRMUI.sheet({
        title: 'New kit',
        html: '<div class="form-section"><div class="field"><label class="field-label" for="invKitName">Kit name</label><input id="invKitName" class="input" type="text" autocomplete="off" placeholder="Cold spark kit A"></div></div>',
        primary: { label: 'Create kit', onClick: () => {
          const name = (document.getElementById('invKitName').value || '').trim();
          if (!name) { showToast('Give the kit a name', 'error'); return false; }
          const kits = (invGetSettings().kits || []).slice();
          kits.push({ id: invId('kit'), name: name });
          invSaveSettings({ kits: kits });
          invRerender();
          showToast('Kit created. Add items to it from each item.', 'success');
        } },
        secondary: { label: 'Cancel' }
      });
    }
    function invOpenKit(id) {
      const kits = invGetSettings().kits || [];
      const k = kits.find(x => x.id === id);
      if (!k) return;
      const mem = invItems().filter(i => i.kit === id);
      const canEdit = invCanEdit();
      CRMUI.sheet({
        title: k.name,
        html: '<div class="form-section"><div class="field"><label class="field-label" for="invKitRename">Kit name</label><input id="invKitRename" class="input" type="text" value="' + esc(k.name) + '"' + (canEdit ? '' : ' readonly') + '></div></div>'
          + '<div class="section-label">In this kit</div>' + (mem.length ? '<div class="row-list">' + mem.map(m => '<div class="row row-compact"><div class="row-main"><div class="row-title">' + esc(m.name) + '</div><div class="row-sub">' + esc(m.tag) + '</div></div></div>').join('') + '</div>' : '<p class="t-meta">No items yet. Pick this kit on an item to add it.</p>')
          + (canEdit ? '<div class="inv-kit-del"><button type="button" class="btn btn-ghost" onclick="invDeleteKit(\'' + invQ(id) + '\')">' + invIcon('trash-2', 18) + ' Delete kit</button></div>' : ''),
        primary: canEdit ? { label: 'Save', onClick: () => {
          const name = (document.getElementById('invKitRename').value || '').trim();
          if (!name) { showToast('Give the kit a name', 'error'); return false; }
          invSaveSettings({ kits: kits.map(x => x.id === id ? Object.assign({}, x, { name: name }) : x) });
          invRerender();
        } } : undefined,
        secondary: { label: canEdit ? 'Cancel' : 'Close' }
      });
    }
    function invDeleteKit(id) {
      CRMUI.confirm({ title: 'Delete this kit?', body: 'The items stay in your catalog. They just leave the kit.', confirmLabel: 'Delete kit', danger: true }).then(ok => {
        if (!ok) return;
        const items = invItems();
        items.forEach(i => { if (i.kit === id) i.kit = null; });
        invStore().save(items);
        invSaveSettings({ kits: (invGetSettings().kits || []).filter(k => k.id !== id) });
        CRMUI.closeAll();
        invRerender();
        showToast('Kit deleted', 'info');
      });
    }

    // ── Item drawer ──────────────────────────────────────────────────────────
    function invOpenItem(id) {
      const it = invStore().get(id);
      if (!it || !(window.CRMUI && CRMUI.sheet)) return;
      invNormItem(it);
      const canEdit = invCanEdit();
      const d = CRMUI.sheet({
        id: 'invItemDrawer',
        title: it.name,
        drawer: true,
        html: invItemDrawerHtml(it, canEdit),
        dirty: () => !!(document.getElementById('invItemDrawer') && document.getElementById('invItemDrawer').dataset.dirty === '1'),
        primary: canEdit ? { label: 'Save changes', onClick: () => invSaveItem(id) } : undefined,
        secondary: { label: canEdit ? 'Cancel' : 'Close' }
      });
      if (d) {
        d.setAttribute('data-inv-drawer', id);
        d.addEventListener('input', function() { d.dataset.dirty = '1'; });
        d.addEventListener('change', function() { d.dataset.dirty = '1'; });
        d.addEventListener('close', function() { if (d.parentNode) d.parentNode.removeChild(d); });
      }
    }
    function invKitOptions(it) {
      const kits = invGetSettings().kits || [];
      return '<option value="">No kit</option>' + kits.map(k => '<option value="' + esc(k.id) + '"' + (it.kit === k.id ? ' selected' : '') + '>' + esc(k.name) + '</option>').join('');
    }
    function invItemDrawerHtml(it, canEdit) {
      const ro = canEdit ? '' : ' readonly';
      const dis = canEdit ? '' : ' disabled';
      const events = invEventsStore().list();
      const cats = invCatList([it]);
      const catOpts = cats.map(c => '<option' + (it.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
      const track = it.tracking || 'serialized';
      const trackSeg = [['serialized', 'Serialized'], ['bulk', 'Bulk'], ['consumable', 'Consumable']].map(t =>
        '<button type="button" class="seg-btn' + (track === t[0] ? ' active' : '') + '" data-val="' + t[0] + '" aria-pressed="' + (track === t[0]) + '"' + dis + ' onclick="invSetTrack(this,\'' + t[0] + '\')">' + t[1] + '</button>').join('');
      const unitOpts = ['pcs', 'lb', 'g', 'L'].map(u => '<option' + (it.unit === u ? ' selected' : '') + '>' + u + '</option>').join('');
      const condOpts = [['A', 'A  Like new'], ['B', 'B  Good'], ['C', 'C  Worn'], ['D', 'D  Needs work']].map(c => '<option value="' + c[0] + '"' + (it.condition === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('');
      const buf = it.buffers || {};
      return '<div class="inv-dr" data-user-content>'
        + '<div class="inv-dr-top">' + invPill(it.tag || 'No tag', 'neutral') + ' <span id="invDrState">' + invStatePill(it, events) + '</span></div>'
        + '<fieldset class="form-section inv-fs"><legend class="section-label">Basics</legend>'
        + '<div class="field"><label class="field-label" for="invFName">Name</label><input id="invFName" class="input" type="text" value="' + esc(it.name) + '"' + ro + ' autocomplete="off"></div>'
        + '<div class="field"><label class="field-label" for="invFCat">Category</label><select id="invFCat" class="input"' + dis + '>' + catOpts + '</select></div>'
        + '<div class="field"><span class="field-label" id="invFTrackLbl">Tracking</span><div class="seg inv-track" role="group" aria-labelledby="invFTrackLbl">' + trackSeg + '</div><input type="hidden" id="invFTrack" value="' + esc(track) + '"></div>'
        + '<div class="field" data-for="bulk consumable"' + (track === 'serialized' ? ' hidden' : '') + '><label class="field-label" for="invFQty">On hand</label><input id="invFQty" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + esc(it.qty) + '"' + ro + '></div>'
        + '<div class="field" data-for="bulk consumable"' + (track === 'serialized' ? ' hidden' : '') + '><label class="field-label" for="invFUnit">Unit</label><select id="invFUnit" class="input"' + dis + '>' + unitOpts + '</select></div>'
        + '<div class="field" data-for="serialized"' + (track === 'serialized' ? '' : ' hidden') + '><label class="field-label" for="invFSerial">Serial number</label><input id="invFSerial" class="input" type="text" value="' + esc(it.serial || '') + '"' + ro + ' autocomplete="off"></div>'
        + '</fieldset>'
        + '<fieldset class="form-section inv-fs"><legend class="section-label">Value and care</legend>'
        + '<div class="field"><label class="field-label" for="invFValue">Purchase value ($)</label><input id="invFValue" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(it.value || '') + '"' + ro + '></div>'
        + '<div class="field"><label class="field-label" for="invFCond">Condition</label><select id="invFCond" class="input"' + dis + '>' + condOpts + '</select></div>'
        + '<div class="field inv-pair"><div><label class="field-label" for="invFBefore">Prep hours before</label><input id="invFBefore" class="input" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(buf.before == null ? 2 : buf.before) + '"' + ro + '></div>'
        + '<div><label class="field-label" for="invFAfter">Reset hours after</label><input id="invFAfter" class="input" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(buf.after == null ? 2 : buf.after) + '"' + ro + '></div></div>'
        + '<div class="field"><label class="field-label" for="invFKit">Kit</label><select id="invFKit" class="input"' + dis + '>' + invKitOptions(it) + '</select></div>'
        + '<div class="field"><label class="field-label" for="invFNotes">Notes</label><textarea id="invFNotes" class="input" rows="3"' + ro + '>' + esc(it.notes || '') + '</textarea></div>'
        + '</fieldset>'
        + invPurchaseBlockHtml(it, events, canEdit)
        + '<div class="section-label">Status</div><div id="invDrStatus">' + invDrStatusHtml(it, canEdit) + '</div>'
        + '<div class="section-label">Events using this item</div><div id="invDrAssign">' + invDrAssignHtml(it, events) + '</div>'
        + '<div class="section-label">Maintenance</div><div id="invDrMaint">' + invDrMaintHtml(it, canEdit) + '</div>'
        + '<div class="section-label">History</div><div id="invDrHist">' + invDrHistHtml(it) + '</div>'
        + '<div class="inv-dr-acts"><button type="button" class="btn btn-secondary" onclick="invPrintLabels([\'' + invQ(it.id) + '\'])">' + invIcon('printer', 18) + ' Print label</button>'
        + (canEdit ? '<button type="button" class="btn btn-ghost inv-del" onclick="deleteEquipment(\'' + invQ(it.id) + '\')">' + invIcon('trash-2', 18) + ' Remove item</button>' : '') + '</div>'
        + '</div>';
    }
    function invSetTrack(btn, val) {
      const seg = btn.closest('.seg');
      seg.querySelectorAll('.seg-btn').forEach(b => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      const hid = seg.parentNode.querySelector('input[type=hidden]');
      if (hid) hid.value = val;
      const scope = btn.closest('fieldset, form, .modal, dialog') || document;
      scope.querySelectorAll('[data-for]').forEach(f => { f.hidden = (' ' + f.getAttribute('data-for') + ' ').indexOf(' ' + val + ' ') < 0; });
      const dlg = btn.closest('dialog, .modal-backdrop'); if (dlg) dlg.dataset.dirty = '1';
    }
    function invDrStatusHtml(it, canEdit) {
      if (invIsRetired(it)) return '<div class="inv-dr-row">' + invPill('Retired', 'neutral') + (canEdit ? ' <button type="button" class="btn btn-secondary" onclick="invSetItemStatus(\'' + invQ(it.id) + '\',\'available\')">Bring back</button>' : '') + '</div>';
      const on = it.status === 'maintenance' ? 'maintenance' : 'available';
      return '<div class="seg inv-status" role="group" aria-label="Availability">'
        + '<button type="button" class="seg-btn' + (on === 'available' ? ' active' : '') + '" aria-pressed="' + (on === 'available') + '"' + (canEdit ? '' : ' disabled') + ' onclick="invSetItemStatus(\'' + invQ(it.id) + '\',\'available\')">Available</button>'
        + '<button type="button" class="seg-btn' + (on === 'maintenance' ? ' active' : '') + '" aria-pressed="' + (on === 'maintenance') + '"' + (canEdit ? '' : ' disabled') + ' onclick="invSetItemStatus(\'' + invQ(it.id) + '\',\'maintenance\')">Maintenance</button></div>';
    }
    function invDrAssignHtml(it, events) {
      const uses = invUsesOf(events, it).sort((a, b) => invEvCmp(a.ev, b.ev));
      if (!uses.length) return '<p class="t-meta">Not on any open pull list.</p>';
      const conf = invFindConflicts(events, [it]);
      return '<div class="row-list">' + uses.map(u => {
        const bad = conf.some(c => c.events.some(e => String(e.id) === String(u.ev.id)));
        return '<button type="button" class="row row-compact" onclick="invOpenFromDrawer(\'' + invQ(u.ev.id) + '\')"><span class="row-main"><span class="row-title">' + esc(u.ev.name) + '</span><span class="row-sub">' + esc(invFmtDate(u.ev.date)) + ' · ' + esc(u.line.name) + '</span></span>'
          + '<span class="row-trail">' + (bad ? invPill('Conflict', 'warn') : invPill(u.ev.pullList.status || 'draft', 'neutral')) + '</span></button>';
      }).join('') + '</div>';
    }
    function invOpenFromDrawer(evId) { if (window.CRMUI) CRMUI.closeAll(); invGo('pulllist', evId); }
    function invDrMaintHtml(it, canEdit) {
      const wos = (it.maintenance || []).slice().sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')));
      const rows = wos.length ? '<div class="row-list">' + wos.map(w => {
        const open = !w.closedAt;
        return '<div class="row row-compact"><div class="row-main"><div class="row-title">' + esc(invCap(w.kind || 'repair')) + (w.writtenOff ? ' (written off)' : '') + '</div><div class="row-sub">' + esc(w.note || 'No note') + ' · ' + (open ? 'Opened ' + esc(invFmtDate(w.openedAt)) : 'Closed ' + esc(invFmtDate(w.closedAt))) + (w.due && open ? ' · Due ' + esc(invFmtDate(w.due)) : '') + '</div></div>'
          + '<div class="row-trail">' + (open ? invPill('Open', 'warn') + (canEdit ? '<button type="button" class="btn btn-secondary btn-sm" onclick="invCloseWorkOrder(\'' + invQ(it.id) + '\',\'' + invQ(w.id) + '\',\'done\')">Done</button>' : '') : invPill('Closed', 'neutral')) + '</div></div>';
      }).join('') + '</div>' : '<p class="t-meta">No work orders.</p>';
      return rows + (canEdit && !invIsRetired(it) ? '<div class="inv-dr-acts"><button type="button" class="btn btn-secondary" onclick="invOpenWorkOrder(\'' + invQ(it.id) + '\')">' + invIcon('wrench', 18) + ' Open work order</button></div>' : '');
    }
    function invCap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function invDrHistHtml(it) {
      const h = (it.history || []).slice(0, 8);
      if (!h.length) return '<p class="t-meta">Nothing yet. Check-outs, check-ins and damage show up here.</p>';
      const label = { out: 'Checked out', 'in': 'Checked in', pick: 'Picked', register: 'Added', damage: 'Damaged', service: 'Service' };
      return '<div class="row-list">' + h.map(x => '<div class="row row-compact"><div class="row-main"><div class="row-title">' + esc(label[x.action] || x.action) + '</div><div class="row-sub">' + esc(new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + (x.by ? ' · ' + esc(x.by) : '') + (x.note ? ' · ' + esc(x.note) : '') + '</div></div></div>').join('') + '</div>';
    }
    // Refresh only the live sections of an open drawer so typed edits are not lost.
    function invRefreshDrawer(id) {
      const d = document.getElementById('invItemDrawer');
      const it = invStore().get(id);
      if (!d || !it) return;
      const events = invEventsStore().list();
      const set = (sel, html) => { const el = d.querySelector(sel); if (el) el.innerHTML = html; };
      set('#invDrState', invStatePill(it, events));
      set('#invDrStatus', invDrStatusHtml(it, invCanEdit()));
      set('#invDrAssign', invDrAssignHtml(it, events));
      set('#invDrMaint', invDrMaintHtml(it, invCanEdit()));
      set('#invDrHist', invDrHistHtml(it));
    }
    function invSaveItem(id) {
      const items = invStore().list();
      const it = items.find(i => String(i.id) === String(id));
      if (!it) return;
      const v = k => { const el = document.getElementById(k); return el ? el.value : ''; };
      const name = v('invFName').trim();
      if (!name) { showToast('Give the item a name', 'error'); return false; }
      const track = v('invFTrack') || it.tracking;
      // Purchase info is checked first so a bad price changes nothing. It never touches an event's costs.
      let pb = null;
      if (document.getElementById('invFPPrice')) {
        pb = invPurchaseBuild(invPurchaseReadFields('invFP'), it.purchase, track === 'serialized' ? 1 : Math.max(1, Math.round(invNum(v('invFQty'))) || 1));
        if (!pb.ok) { showToast(pb.error, 'error'); return false; }
      }
      it.name = name;
      it.category = v('invFCat') || it.category;
      it.tracking = track;
      if (track === 'serialized') { it.qty = 1; it.serial = v('invFSerial').trim(); }
      else { it.qty = Math.max(0, Math.round(invNum(v('invFQty')))); it.unit = v('invFUnit') || 'pcs'; }
      it.value = v('invFValue');
      it.condition = v('invFCond') || 'A';
      it.buffers = { before: Math.max(0, invNum(v('invFBefore'))), after: Math.max(0, invNum(v('invFAfter'))) };
      it.kit = v('invFKit') || null;
      it.notes = v('invFNotes');
      if (pb) { if (pb.purchase) it.purchase = pb.purchase; else delete it.purchase; }
      invStore().save(items);
      showToast('Saved', 'success');
      invRefreshView();
    }
    function invRefreshView() {
      const sec = document.getElementById('equipment');
      if (sec && sec.classList.contains('active') && _invUI.view !== 'scan') invRenderBody();
    }
    function invSetItemStatus(id, status) {
      const items = invStore().list();
      const it = items.find(i => String(i.id) === String(id));
      if (!it) return;
      if (status === 'available' && (it.maintenance || []).some(w => !w.closedAt)) { showToast('Close the open work order first', 'warning'); return; }
      it.status = status;
      invLog(it, 'service', null, status === 'maintenance' ? 'Set to maintenance' : 'Back in service');
      invStore().save(items);
      invRefreshDrawer(id);
      invRefreshView();
    }

    // ── Work orders ──────────────────────────────────────────────────────────
    function invOpenWorkOrder(itemId) {
      const items = invItems().filter(i => !invIsRetired(i));
      const pick = itemId ? '' : '<div class="field"><label class="field-label" for="woItem">Item</label><select id="woItem" class="input"><option value="">Choose an item</option>' + items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name) + ' (' + esc(i.tag) + ')</option>').join('') + '</select></div>';
      CRMUI.sheet({
        title: 'Open work order',
        html: '<div class="form-section">' + pick
          + '<div class="field"><label class="field-label" for="woKind">Type</label><select id="woKind" class="input"><option value="repair">Repair</option><option value="preventive">Preventive</option><option value="inspection">Inspection</option></select></div>'
          + '<div class="field"><label class="field-label" for="woDue">Due</label><input id="woDue" class="input" type="date"></div>'
          + '<div class="field"><label class="field-label" for="woNote">What needs doing</label><textarea id="woNote" class="input" rows="3" placeholder="Panel 4 flickers"></textarea></div></div>'
          + '<p class="t-meta">The item shows as in maintenance until you close the work order.</p>',
        primary: { label: 'Open work order', onClick: () => {
          const id = itemId || (document.getElementById('woItem') || {}).value;
          if (!id) { showToast('Choose an item', 'error'); return false; }
          const all = invStore().list();
          const it = all.find(i => String(i.id) === String(id));
          if (!it) return false;
          invNormItem(it);
          it.maintenance.push({ id: invId('wo'), kind: document.getElementById('woKind').value, note: document.getElementById('woNote').value.trim(), openedAt: invTodayIso(), due: document.getElementById('woDue').value || '', closedAt: null });
          it.status = 'maintenance';
          invLog(it, 'service', null, 'Work order opened');
          invStore().save(all);
          showToast('Work order opened for ' + it.name, 'success');
          invRefreshDrawer(it.id);
          invRefreshView();
        } },
        secondary: { label: 'Cancel' }
      });
    }
    function invCloseWorkOrder(itemId, woId, how) {
      const run = () => {
        const items = invStore().list();
        const it = items.find(i => String(i.id) === String(itemId));
        const wo = it && (it.maintenance || []).find(w => w.id === woId);
        if (!it || !wo) return;
        wo.closedAt = invTodayIso();
        if (how === 'writeoff') { wo.writtenOff = true; it.status = 'retired'; invLog(it, 'service', null, 'Written off'); }
        else {
          if (it.status === 'maintenance' && !(it.maintenance || []).some(w => !w.closedAt)) it.status = 'available';
          invLog(it, 'service', null, 'Work order done');
        }
        invStore().save(items);
        showToast(how === 'writeoff' ? it.name + ' written off' : it.name + ' is back in service', 'success');
        invRefreshDrawer(itemId);
        invRefreshView();
      };
      if (how === 'writeoff') {
        CRMUI.confirm({ title: 'Write this item off?', body: 'It stops showing as available and leaves every future pull list. You can bring it back from the item.', confirmLabel: 'Write off', danger: true }).then(ok => { if (ok) run(); });
      } else run();
    }

    // ── Add equipment modal (static markup in portal-provider.html; this adds Tracking and Qty and fixes the category list) ──
    function invPrepAddForm() {
      const form = document.getElementById('addEquipmentForm');
      if (!form) return;
      form.reset();
      const cat = document.getElementById('equipCategory');
      if (cat && cat.dataset.inv !== '1') {
        cat.innerHTML = '<option value="">Select...</option>' + INV_CATEGORIES.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
        cat.dataset.inv = '1';
      }
      const serialGroup = document.getElementById('equipSerial') && document.getElementById('equipSerial').closest('.form-group');
      if (serialGroup && !document.getElementById('equipTracking')) {
        serialGroup.insertAdjacentHTML('beforebegin',
          '<div class="form-group"><span class="form-label" id="equipTrackLbl">Tracking</span><div class="seg inv-track" role="group" aria-labelledby="equipTrackLbl">'
          + '<button type="button" class="seg-btn active" aria-pressed="true" onclick="invSetTrack(this,\'serialized\')">Serialized</button>'
          + '<button type="button" class="seg-btn" aria-pressed="false" onclick="invSetTrack(this,\'bulk\')">Bulk</button>'
          + '<button type="button" class="seg-btn" aria-pressed="false" onclick="invSetTrack(this,\'consumable\')">Consumable</button></div><input type="hidden" id="equipTracking" value="serialized"></div>'
          + '<div class="form-group" data-for="bulk consumable" hidden><label class="form-label" for="equipQty">How many</label><input type="number" class="form-input" id="equipQty" min="1" step="1" value="1" inputmode="numeric"></div>'
          + '<div class="form-group" data-for="bulk consumable" hidden><label class="form-label" for="equipUnit">Unit</label><select class="form-select" id="equipUnit"><option>pcs</option><option>lb</option><option>g</option><option>L</option></select></div>');
        serialGroup.setAttribute('data-for', 'serialized');
        const t = form.parentNode.querySelector('.modal-title'); if (t) t.textContent = 'Add item';
        const sb = form.querySelector('[type=submit]'); if (sb) sb.textContent = 'Add item';
      }
      // Optional purchase info, collapsed. Added once; form.reset() clears the typed values each time.
      if (!document.getElementById('equipPurchPrice')) {
        const sub = form.querySelector('[type=submit]');
        if (sub) sub.insertAdjacentHTML('beforebegin', '<details class="inv-purch-det" id="equipPurchDet"><summary>Purchase info (optional)</summary>'
          + invPurchaseFieldsHtml('equipPurch', null, true).replace(/class="field"/g, 'class="form-group"').replace(/class="field-label"/g, 'class="form-label"').replace(/class="input"/g, 'class="form-input"')
          + '<p class="t-meta">Saved on the item only. It does not add a cost to any event.</p></details>');
      }
      const pdet = document.getElementById('equipPurchDet'); if (pdet) pdet.open = false;
      // reset the visual state of the tracking control
      const seg = form.querySelector('.inv-track .seg-btn');
      if (seg) invSetTrack(seg, 'serialized');
      const dlg = form.closest('.modal-backdrop'); if (dlg) dlg.dataset.dirty = '';
    }
    function openAddEquipmentModal(opts) {
      invPrepAddForm();
      window._invPendingTag = opts && opts.tag ? String(opts.tag) : '';
      openModal('addEquipmentModal');
    }
    function saveEquipment(e) {
      e.preventDefault();
      const items = invItems();
      const track = (document.getElementById('equipTracking') || {}).value || (document.getElementById('equipSerial').value ? 'serialized' : 'bulk');
      const qty = track === 'serialized' ? 1 : Math.max(1, Math.round(invNum((document.getElementById('equipQty') || {}).value)) || 1);
      // Check the optional purchase price before a tag number is used up.
      const pb = invPurchaseBuild(invPurchaseReadFields('equipPurch'), null, qty);
      if (!pb.ok) { showToast(pb.error, 'error'); return; }
      const tag = window._invPendingTag && !items.some(i => i.tag === window._invPendingTag) ? window._invPendingTag : invNextTag(items);
      window._invPendingTag = '';
      const it = {
        id: genId(),
        name: document.getElementById('equipName').value.trim(),
        category: document.getElementById('equipCategory').value,
        serial: track === 'serialized' ? document.getElementById('equipSerial').value.trim() : '',
        value: document.getElementById('equipValue').value,
        notes: document.getElementById('equipNotes').value,
        status: 'available',
        tracking: track, qty: qty, unit: track === 'serialized' ? 'pcs' : ((document.getElementById('equipUnit') || {}).value || 'pcs'),
        tag: tag, kit: null, buffers: { before: 2, after: 2 }, condition: 'A', maintenance: [], history: []
      };
      if (pb.purchase) it.purchase = pb.purchase;
      invLog(it, 'register', null, 'Added to inventory');
      items.push(it);
      invStore().save(items);
      document.getElementById('addEquipmentForm').reset();
      closeModal('addEquipmentModal');
      invRefreshView();
      showToast('Added ' + it.name + ' as ' + it.tag, 'success');
    }

    // ── Labels (plain tag labels; a QR code is an owner to-do, see the lane notes) ──
    function invPrintLabels(ids) {
      const items = invItems();
      const sel = (ids && ids.length) ? items.filter(i => ids.indexOf(i.id) > -1) : invFilteredItems(items).filter(i => !invIsRetired(i));
      if (!sel.length) { showToast('No items to label', 'info'); return; }
      const copies = ids && ids.length === 1 ? 6 : 1;
      let cells = '';
      sel.forEach(it => { for (let k = 0; k < copies; k++) cells += '<div class="lb"><div class="lb-tag">' + esc(it.tag) + '</div><div class="lb-name">' + esc(it.name) + '</div><div class="lb-cat">' + esc(it.category || '') + (it.serial ? ' · S/N ' + esc(it.serial) : '') + '</div>' + invBarcodeSvg(it.tag) + '</div>'; });
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>Gear labels</title><style>'
        + '@page{margin:0.4in}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}'
        + '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0.12in}'
        + '.lb{border:1px solid #111;border-radius:6px;padding:0.1in 0.12in;break-inside:avoid;min-height:1.1in}'
        + '.lb-tag{font:700 22px/1.1 "Courier New",monospace;letter-spacing:1px}.lb-name{font:600 13px/1.25 Arial,sans-serif;margin-top:4px}.lb-cat{font:11px/1.3 Arial,sans-serif;color:#333}'
        + '.lb svg{display:block;margin-top:6px;width:100%;height:0.38in}'
        + '.note{font:12px Arial;color:#333;margin:0 0 0.15in}@media print{.note{display:none}}'
        + '</style></head><body><p class="note">Print on adhesive label stock. Use polyester labels for road cases.</p><div class="grid">' + cells + '</div></body></html>';
      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to print labels', 'warning'); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(function() { try { w.focus(); w.print(); } catch (e) {} }, 350);
    }
    // Code 128 (subset B). Widths below are the standard bar/space patterns, values 0 to 106.
    function invBarcodeSvg(text) {
      const P = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
      const s = String(text || '');
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 || c > 126) return ''; }
      const vals = [104];
      for (let i = 0; i < s.length; i++) vals.push(s.charCodeAt(i) - 32);
      let sum = 104;
      for (let i = 0; i < s.length; i++) sum += (s.charCodeAt(i) - 32) * (i + 1);
      vals.push(sum % 103);
      vals.push(106);
      let x = 10, bars = '';   // 10 module quiet zone
      vals.forEach(v => {
        const p = P[v];
        for (let k = 0; k < p.length; k++) {
          const w = +p[k];
          if (k % 2 === 0) bars += '<rect x="' + x + '" y="0" width="' + w + '" height="40"/>';
          x += w;
        }
      });
      const total = x + 10;
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' 40" preserveAspectRatio="none" fill="#111" aria-hidden="true">' + bars + '</svg>';
    }

    // ── Legacy entry points kept by name ─────────────────────────────────────
    function deleteEquipment(id) {
      const it = invStore().get(id);
      CRMUI.confirm({ title: 'Remove ' + (it ? it.name : 'this item') + '?', body: 'It leaves your catalog and any pull list it was assigned to. Retire it from a work order instead if you want to keep the history.', confirmLabel: 'Remove', danger: true }).then(ok => {
        if (!ok) return;
        invStore().save(invStore().list().filter(e => String(e.id) !== String(id)));
        const events = invEventsStore().list();
        let ch = false;
        events.forEach(ev => { if (ev.pullList && ev.pullList.lines) ev.pullList.lines.forEach(l => {
          if (invLineItemIds(l).indexOf(id) > -1) { l.itemIds = invLineItemIds(l).filter(x => x !== id); l.itemId = l.itemIds[0] || null; ch = true; }
        }); });
        if (ch) invEventsStore().save(events);
        if (window.CRMUI) CRMUI.closeAll();
        invRefreshView();
        showToast('Item removed', 'info');
      });
    }
    function cycleEquipStatus(id) {
      const equip = invStore().list();
      const item = equip.find(e => String(e.id) === String(id));
      if (!item) return;
      const cycle = ['available', 'assigned', 'maintenance'];
      item.status = cycle[(cycle.indexOf(item.status) + 1) % cycle.length];
      invStore().save(equip);
      invRefreshView();
    }

    // ── Availability: month grid (agenda on phone) ───────────────────────────
    function invMonthLabel(ym) {
      const p = ym.split('-');
      return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+p[1] - 1] + ' ' + p[0];
    }
    function invShiftMonth(ym, delta) {
      const p = ym.split('-').map(Number);
      const d = new Date(p[0], p[1] - 1 + delta, 1);
      return d.getFullYear() + '-' + invPad2(d.getMonth() + 1);
    }
    function invSetMonth(delta) { _invUI.month = delta === 0 ? invTodayIso().slice(0, 7) : invShiftMonth(_invUI.month || invTodayIso().slice(0, 7), delta); invRenderBody(); }
    function invSetAvailItem(id) { _invUI.availItem = id; invRenderBody(); }
    function invOpenPull(evId) { invGo('pulllist', evId); }
    function invEventListState(ev) {
      const s = invPullSummary(ev);
      if (!s.has) return { label: 'No list', tone: 'neutral', text: 'No pull list yet' };
      const tone = { draft: 'neutral', ready: 'info', out: 'warn', closed: 'ok' }[s.status] || 'neutral';
      return { label: invCap(s.status), tone: tone, text: invCap(s.status) + ', ' + s.picked + ' of ' + s.total + ' picked' };
    }
    function invViewAvailability(b) {
      const items = invItems();
      const all = invVisibleEvents().filter(invEventLive);
      invActions('');
      const today = invTodayIso();
      if (!_invUI.month) {
        // first visit: this month, or the month of the next booked event when this month is empty
        const cur = today.slice(0, 7);
        const upcoming = all.filter(e => e.date && String(e.date).slice(0, 10) >= today && (e.pullList || ['booked', 'confirmed'].indexOf(e.status) > -1)).sort(invEvCmp)[0];
        _invUI.month = all.some(e => e.date && String(e.date).slice(0, 7) === cur && (e.pullList || ['booked', 'confirmed'].indexOf(e.status) > -1)) || !upcoming ? cur : String(upcoming.date).slice(0, 7);
      }
      const ym = _invUI.month;
      const sel = _invUI.availItem ? items.find(i => i.id === _invUI.availItem) : null;
      const conflictsAll = invFindConflicts(all, items);
      const open = conflictsAll.filter(c => !c.overridden);
      let evs = all.filter(e => e.date && String(e.date).slice(0, 7) === ym && (e.pullList || ['booked', 'confirmed'].indexOf(e.status) > -1));
      if (sel) evs = evs.filter(e => e.pullList && e.pullList.lines && e.pullList.lines.some(l => invLineItemIds(l).indexOf(sel.id) > -1));
      evs.sort(invEvCmp);
      const conflictEv = {};
      conflictsAll.forEach(c => c.events.forEach(e => { conflictEv[e.id] = true; }));

      const bannerRows = open.length ? '<div class="banner banner-warn" role="status">' + invIcon('triangle-alert', 20) + '<div class="banner-body"><div class="banner-title">' + open.length + (open.length === 1 ? ' gear conflict' : ' gear conflicts') + '</div><div class="t-meta">Nothing is blocked. Resolve each one or keep it with a note.</div></div></div>'
        + '<div class="row-list inv-conf">' + open.map(c => invConflictRow(c)).join('') + '</div>' : '';
      const overridden = conflictsAll.filter(c => c.overridden);
      const ovRows = overridden.length ? '<div class="inv-note t-meta">' + overridden.map(c => esc(invConflictText(c)) + '. Kept: ' + esc(c.note)).join('<br>') + '</div>' : '';

      const itemSel = '<div class="field inv-fld"><label class="field-label" for="invAvailItem">Show</label><select id="invAvailItem" class="input" onchange="invSetAvailItem(this.value)"><option value="">All gear</option>'
        + items.filter(i => !invIsRetired(i)).sort((a, c) => String(a.name).localeCompare(String(c.name))).map(i => '<option value="' + esc(i.id) + '"' + (sel && sel.id === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('') + '</select></div>';
      const nav = '<div class="inv-monthbar"><button type="button" class="btn btn-secondary btn-icon" aria-label="Previous month" onclick="invSetMonth(-1)">' + invIcon('chevron-left', 20) + '</button>'
        + '<div class="inv-month" aria-live="polite">' + esc(invMonthLabel(ym)) + '</div>'
        + '<button type="button" class="btn btn-secondary btn-icon" aria-label="Next month" onclick="invSetMonth(1)">' + invIcon('chevron-right', 20) + '</button>'
        + '<button type="button" class="btn btn-secondary inv-today" onclick="invSetMonth(0)">Today</button></div>';

      let body;
      if (invIsPhone()) {
        if (!evs.length) body = invEmpty('calendar', 'Nothing booked in ' + invMonthLabel(ym).split(' ')[0], 'Pull lists for booked events show up here.');
        else {
          const byDay = {};
          evs.forEach(e => { const k = String(e.date).slice(0, 10); (byDay[k] = byDay[k] || []).push(e); });
          body = '<div class="inv-agenda">' + Object.keys(byDay).sort().map(k => '<div class="section-label' + (k === today ? ' is-today' : '') + '">' + esc(invFmtDate(k)) + (k === today ? ' · Today' : '') + '</div><div class="row-list">'
            + byDay[k].map(e => {
              const st = invEventListState(e);
              return '<button type="button" class="row inv-ag' + (e.pullList ? '' : ' is-dashed') + '" onclick="invOpenPull(\'' + invQ(e.id) + '\')"><span class="row-main"><span class="row-title" data-user-content>' + esc(e.name) + '</span><span class="row-sub">' + esc(st.text) + (e.startTime ? ' · ' + esc(invFmtTime(e.startTime)) : '') + '</span></span>'
                + '<span class="row-trail">' + (conflictEv[e.id] ? invPill('Conflict', 'warn') : invPill(st.label, st.tone)) + '</span></button>';
            }).join('') + '</div>').join('') + '</div>';
        }
      } else {
        const p = ym.split('-').map(Number);
        const first = new Date(p[0], p[1] - 1, 1);
        const days = new Date(p[0], p[1], 0).getDate();
        const lead = first.getDay();
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push('<div class="inv-cal-day is-pad" aria-hidden="true"></div>');
        for (let d = 1; d <= days; d++) {
          const iso = ym + '-' + invPad2(d);
          const dayEvs = evs.filter(e => String(e.date).slice(0, 10) === iso);
          const chips = dayEvs.slice(0, 3).map(e => '<button type="button" class="inv-chip ' + (e.pullList ? 'is-solid' : 'is-dashed') + (conflictEv[e.id] ? ' is-conflict' : '') + '" title="' + esc(e.name + ' · ' + invEventListState(e).text) + '" onclick="invOpenPull(\'' + invQ(e.id) + '\')" data-user-content>' + esc(e.name) + '</button>').join('');
          cells.push('<div class="inv-cal-day' + (iso === today ? ' is-today' : '') + '" role="gridcell"><span class="inv-cal-n">' + d + '</span>' + chips + (dayEvs.length > 3 ? '<span class="t-meta">+' + (dayEvs.length - 3) + ' more</span>' : '') + '</div>');
        }
        body = '<div class="inv-cal" role="grid" aria-label="' + esc(invMonthLabel(ym)) + '">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => '<div class="inv-cal-dow" role="columnheader">' + d + '</div>').join('') + cells.join('') + '</div>'
          + '<div class="inv-legend t-meta"><span class="inv-chip is-solid is-key" aria-hidden="true"></span> Has a pull list <span class="inv-chip is-dashed is-key" aria-hidden="true"></span> Booked, no list yet</div>';
      }
      const check = '<div class="card inv-check"><div class="card-head"><h3 class="card-title">Check a date</h3></div><div class="inv-check-row"><div class="field inv-fld"><label class="field-label" for="invCheckDate">Date</label><input id="invCheckDate" class="input" type="date"></div>'
        + '<button type="button" class="btn btn-secondary" onclick="invCheckDate()">Check availability</button></div><div id="invCheckOut" role="status" aria-live="polite"></div></div>';
      b.innerHTML = bannerRows + ovRows + '<div class="inv-avail-bar">' + nav + itemSel + '</div>'
        + (sel ? '<p class="t-meta inv-sel-note">' + esc(sel.name) + ' (' + esc(sel.tag) + '). ' + (evs.length ? 'On ' + evs.length + (evs.length === 1 ? ' event' : ' events') + ' in ' + esc(invMonthLabel(ym).split(' ')[0]) + '.' : 'Not on any event in ' + esc(invMonthLabel(ym).split(' ')[0]) + '.') + '</p>' : '')
        + body + check;
    }
    function invConflictRow(c) {
      const second = c.events[c.events.length - 1];
      return '<div class="row row-compact inv-conf-row"><span class="row-ic is-warn">' + invIcon('triangle-alert', 20) + '</span><div class="row-main"><div class="row-title">' + esc(invConflictText(c)) + '</div><div class="row-sub">' + c.events.map(e => esc(e.name)).join(' and ') + '</div></div>'
        + '<div class="row-trail"><button type="button" class="btn btn-secondary btn-sm" onclick="invResolve(\'' + invQ(second.id) + '\')">Resolve</button></div></div>';
    }
    // Resolve opens the later event's gear tab, where units can be reassigned.
    function invResolve(evId) { location.hash = '#/event/' + encodeURIComponent(evId) + '/gear'; }
    function invCheckDate() {
      const date = (document.getElementById('invCheckDate') || {}).value;
      const out = document.getElementById('invCheckOut');
      if (!out) return;
      if (!date) { out.innerHTML = '<div class="avail-result avail-busy">Pick a date first.</div>'; return; }
      const events = invVisibleEvents().filter(invEventLive);
      const items = invItems().filter(i => !invIsRetired(i));
      const dayStart = new Date(date + 'T00:00:00').getTime(), dayEnd = dayStart + 86400000;
      const onDay = events.filter(e => String(e.date).slice(0, 10) === date && ['booked', 'confirmed'].indexOf(e.status) > -1);
      const busy = items.filter(it => invUsesOf(events, it).some(u => u.win[0] < dayEnd && dayStart < u.win[1]));
      const blocked = items.filter(it => it.status === 'maintenance');
      const free = items.length - busy.length - blocked.length;
      const head = onDay.length ? '<div class="avail-result avail-busy">' + esc(invFmtDate(date)) + ': ' + onDay.map(e => esc(e.name) + (e.startTime ? ' (' + esc(invFmtTime(e.startTime)) + ')' : '')).join(', ') + ' already booked.</div>'
        : '<div class="avail-result avail-free">' + esc(invFmtDate(date)) + ' is open. No booked events.</div>';
      out.innerHTML = head + '<p class="t-meta">' + free + ' of ' + items.length + ' items are free that day.' + (busy.length ? ' In use: ' + busy.map(i => esc(i.name)).join(', ') + '.' : '') + (blocked.length ? ' In maintenance: ' + blocked.map(i => esc(i.name)).join(', ') + '.' : '') + '</p>';
    }

    // ── Pull lists: index ────────────────────────────────────────────────────
    function invViewPullIndex(b) {
      invActions('');
      const today = invTodayIso();
      const lowBound = new Date(Date.now() - 7 * 86400000);
      const low = lowBound.getFullYear() + '-' + invPad2(lowBound.getMonth() + 1) + '-' + invPad2(lowBound.getDate());
      const evs = invVisibleEvents().filter(e => invEventLive(e) && e.date && (String(e.date).slice(0, 10) >= low || (e.pullList && e.pullList.status !== 'closed'))
        && (e.pullList || ['booked', 'confirmed'].indexOf(e.status) > -1)).sort(invEvCmp);
      if (!evs.length) { b.innerHTML = invEmpty('package-check', 'No pull lists yet', 'Booked events show up here. Each one gets a pull list built from the services on it.'); return; }
      b.innerHTML = '<div class="row-list">' + evs.map(e => {
        const st = invEventListState(e);
        const s = invPullSummary(e);
        const d = new Date(String(e.date).slice(0, 10) + 'T12:00:00');
        return '<button type="button" class="row row-event inv-evrow' + (e.pullList ? '' : ' is-dashed') + '" onclick="invOpenPull(\'' + invQ(e.id) + '\')">'
          + '<span class="date-block"><span class="dow">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + '</span><span class="day">' + d.getDate() + '</span></span>'
          + '<span class="row-main"><span class="row-title" data-user-content>' + esc(e.name) + '</span><span class="row-sub">' + esc(e.venueName || 'Venue to be confirmed') + (String(e.date).slice(0, 10) === today ? ' · Today' : '') + '</span>'
          + '<span class="row-sub">' + (s.has ? s.picked + ' of ' + s.total + ' picked' : 'Tap to preview the list') + '</span></span>'
          + '<span class="row-trail">' + invPill(st.label, st.tone) + invIcon('chevron-right', 18) + '</span></button>';
      }).join('') + '</div>';
    }

    // ── Pull list: one event ─────────────────────────────────────────────────
    function invModLabel(k) { const L = INV_DEFAULT_PULL_LISTS[k]; return L ? L.label : k; }
    function invLineUnits(l, items) {
      return invLineItemIds(l).map(id => items.find(i => i.id === id)).filter(Boolean);
    }
    function invViewPullList(b, evId) {
      if (!evId) { invViewPullIndex(b); return; }
      const ev = invEventsStore().get(evId);
      invActions('');
      if (!ev) { b.innerHTML = invEmpty('circle-alert', 'That event is not here anymore', 'Pick another one from the list.', '<button type="button" class="btn btn-secondary" onclick="invGo(\'pulllist\')">Back to pull lists</button>'); return; }
      const canEdit = invCanEdit();
      const items = invItems();
      const events = invEventsStore().list();
      const has = !!(ev.pullList && Array.isArray(ev.pullList.lines));
      const preview = has ? null : invSyncPullList(ev, { dry: true });
      const list = has ? ev.pullList : preview.list;
      const sum = invPullSummary({ pullList: list });
      const status = has ? (list.status || 'draft') : 'none';
      const conf = invFindConflicts(events, items);
      const pct = sum.total ? Math.round(sum.picked / sum.total * 100) : 0;

      // page-level actions: one primary
      let primary = '';
      if (!has) primary = canEdit ? '<button type="button" class="btn btn-primary" id="invGenerate" onclick="invDoGenerate(\'' + invQ(ev.id) + '\')">Generate pull list</button>' : '';
      else if (status === 'draft') primary = canEdit ? '<button type="button" class="btn btn-primary" onclick="invSetListStatus(\'' + invQ(ev.id) + '\',\'ready\')">Mark ready</button>' : '';
      else if (status === 'ready') primary = '<button type="button" class="btn btn-primary" onclick="invGo(\'scan\',\'' + invQ(ev.id) + '\')">' + invIcon('scan-line', 18) + ' Open check-out</button>';
      else if (status === 'out') primary = '<button type="button" class="btn btn-primary" onclick="invGo(\'scan\',\'' + invQ(ev.id) + '\')">' + invIcon('scan-line', 18) + ' Open check-in</button>';
      const sec = has ? '<button type="button" class="btn btn-secondary" onclick="invPrintPullList(\'' + invQ(ev.id) + '\')">' + invIcon('printer', 18) + ' Print</button>'
        + (canEdit ? '<button type="button" class="btn btn-secondary" onclick="invRegenerate(\'' + invQ(ev.id) + '\')">' + invIcon('refresh-cw', 18) + ' Regenerate</button>' : '') : '';
      invActions(primary + sec);

      // banner: at most one
      const st = invGetSettings();
      let banner = '';
      if (has && list.changed && (status === 'ready' || status === 'out')) {
        banner = '<div class="banner banner-warn" role="status">' + invIcon('triangle-alert', 20) + '<div class="banner-body"><div class="banner-title">This list changed after it was marked ready</div><div class="t-meta">' + esc((list.lastChange && list.lastChange.text) || 'Lines were added or removed.') + '</div></div>'
          + '<button type="button" class="btn btn-ghost btn-icon banner-x" aria-label="Dismiss" onclick="invAckChange(\'' + invQ(ev.id) + '\')">' + invIcon('x', 18) + '</button></div>';
      } else if (!st.bannerDismissed) {
        banner = '<div class="banner banner-info" role="status">' + invIcon('info', 20) + '<div class="banner-body"><div class="banner-title">Industry default. Edit to match your gear.</div><div class="t-meta">These lists are a starting point. Change them under Defaults.</div></div>'
          + '<button type="button" class="btn btn-ghost btn-icon banner-x" aria-label="Dismiss" onclick="invDismissBanner()">' + invIcon('x', 18) + '</button></div>';
      }

      const meta = [invFmtDate(ev.date), ev.startTime ? invFmtTime(ev.startTime) + (ev.endTime ? ' to ' + invFmtTime(ev.endTime) : '') : '', ev.venueName].filter(Boolean).map(esc).join(' · ');
      const statusSeg = has && canEdit ? '<div class="seg inv-status" role="group" aria-label="List status">' + ['draft', 'ready', 'out', 'closed'].map(s =>
        '<button type="button" class="seg-btn' + (status === s ? ' active' : '') + '" aria-pressed="' + (status === s) + '" onclick="invSetListStatus(\'' + invQ(ev.id) + '\',\'' + s + '\')">' + invCap(s) + '</button>').join('') + '</div>' : '';
      const pills = (has ? invPill(invCap(status), { draft: 'neutral', ready: 'info', out: 'warn', closed: 'ok' }[status]) : invPill('Preview', 'neutral'))
        + ' ' + (list.edited ? invPill('Your list', 'violet') : invPill('Industry default', 'neutral'));
      const head = '<div class="card inv-hd">'
        + '<button type="button" class="btn btn-ghost inv-back" onclick="invGo(\'pulllist\')">' + invIcon('chevron-left', 18) + ' Pull lists</button>'
        + '<h2 class="inv-h2" data-user-content>' + esc(ev.name) + '</h2><div class="t-meta" data-user-content>' + meta + '</div>'
        + '<div class="inv-hd-state">' + pills + '<span class="t-meta">' + sum.picked + ' of ' + sum.total + ' picked</span></div>'
        + '<div class="sched-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Picked"><span style="width:' + pct + '%"></span></div>'
        + statusSeg
        + '<a class="inv-evlink" href="#/event/' + encodeURIComponent(ev.id) + '/gear">Open event ' + invIcon('arrow-up-right', 14) + '</a></div>';

      let body;
      if (!list.lines.length) body = invEmpty('package', 'No lines yet', has ? 'Add the gear this event needs.' : 'No booked service matches a default list. Generate it, then add lines by hand.');
      else {
        const groups = [];
        const gmap = {};
        list.lines.forEach(l => {
          const k = l.manual ? 'extra' : ((l.modules && l.modules[0]) || 'extra');
          if (!gmap[k]) { gmap[k] = { key: k, lines: [] }; groups.push(gmap[k]); }
          gmap[k].lines.push(l);
        });
        body = groups.map(g => '<div class="section-label">' + esc(g.key === 'extra' ? 'Added by hand' : invModLabel(g.key)) + '</div><div class="row-list">'
          + g.lines.map(l => invPullLineHtml(ev, l, items, conf, has, canEdit)).join('') + '</div>').join('');
      }
      const addBtn = has && canEdit ? '<div class="inv-addline"><button type="button" class="btn btn-secondary" onclick="invEditLine(\'' + invQ(ev.id) + '\',\'\')">' + invIcon('plus', 18) + ' Add line</button></div>' : '';
      b.innerHTML = banner + head + (has ? '' : '<p class="t-meta inv-prevnote">This is a preview built from the booked services. Nothing is saved until you generate it.</p>') + body + addBtn;
    }
    function invPullLineHtml(ev, l, items, conf, live, canEdit) {
      const q = invQty(l);
      const picked = Math.min(q, invNum(l.picked));
      const units = invLineUnits(l, items);
      const lineConflict = conf.some(c => !c.overridden && c.lines.indexOf(l) > -1);
      const done = q > 0 && picked >= q;
      const e = invQ(ev.id), id = invQ(l.id);
      const unitTxt = units.length ? units.map(u => esc(u.name)).join(', ') : '';
      const sub = [l.note ? esc(l.note) : '', unitTxt ? 'Assigned: ' + unitTxt : '', l.stale ? 'No longer on the booked services' : '', l.override ? 'Kept with a note' : ''].filter(Boolean).join(' · ');
      let ctl = '';
      if (live) {
        if (q <= 1) ctl = '<button type="button" class="btn btn-secondary btn-icon inv-tick' + (done ? ' is-done' : '') + '" aria-pressed="' + done + '" aria-label="' + (done ? 'Unpick ' : 'Pick ') + esc(l.name) + '" data-act="tick" onclick="invPick(\'' + e + '\',\'' + id + '\',' + (done ? -1 : 1) + ')">' + invIcon(done ? 'circle-check' : 'circle', 22) + '</button>';
        else ctl = '<div class="inv-step" role="group" aria-label="Picked ' + esc(l.name) + '"><button type="button" class="btn btn-secondary btn-icon" aria-label="One less ' + esc(l.name) + '" onclick="invPick(\'' + e + '\',\'' + id + '\',-1)"' + (picked <= 0 ? ' disabled' : '') + '>' + invIcon('minus', 18) + '</button>'
          + '<span class="inv-step-n num" data-act="count">' + picked + ' / ' + q + '</span><button type="button" class="btn btn-secondary btn-icon" data-act="plus" aria-label="One more ' + esc(l.name) + '" onclick="invPick(\'' + e + '\',\'' + id + '\',1)"' + (picked >= q ? ' disabled' : '') + '>' + invIcon('plus', 18) + '</button></div>';
        if (canEdit && !l.consumable) ctl += '<button type="button" class="btn btn-secondary btn-sm inv-assign" onclick="invAssignUnit(\'' + e + '\',\'' + id + '\')">' + (units.length ? 'Change unit' : 'Assign unit') + '</button>';
        if (canEdit) ctl += '<button type="button" class="btn btn-ghost btn-icon" aria-label="More for ' + esc(l.name) + '" aria-haspopup="menu" onclick="invLineMenu(this,\'' + e + '\',\'' + id + '\')">' + invIcon('ellipsis-vertical', 20) + '</button>';
      }
      return '<div class="row inv-line' + (done ? ' is-done' : '') + (live ? '' : ' row-compact') + '" data-line-id="' + esc(id) + '"><div class="row-main"><div class="row-title"><span data-user-content>' + esc(l.name) + '</span> <span class="inv-qty num">x' + q + (l.unit && l.unit !== 'pcs' ? ' ' + esc(l.unit) : '') + '</span>'
        + (l.consumable ? ' ' + invPill('Consumable', 'neutral') : '') + (lineConflict ? ' ' + invPill('Conflict', 'warn') : '') + '</div>'
        + (sub ? '<div class="row-sub">' + sub + '</div>' : '') + '</div><div class="inv-line-ctl">' + ctl + '</div></div>';
    }
    function invSaveEvents(events) { invEventsStore().save(events || invEventsStore().list()); }
    function invLineOf(evId, lineId) {
      const ev = invEventsStore().get(evId);
      const l = ev && ev.pullList && ev.pullList.lines ? ev.pullList.lines.find(x => x.id === lineId) : null;
      return { ev: ev, line: l };
    }
    function invPick(evId, lineId, delta) {
      const r = invLineOf(evId, lineId);
      if (!r.line) return;
      const q = invQty(r.line);
      const before = invNum(r.line.picked);
      r.line.picked = Math.max(0, Math.min(q, before + delta));
      if (r.line.picked === before) return;
      invSaveEvents();
      invRerender('[data-line-id="' + lineId + '"] [data-act="plus"], [data-line-id="' + lineId + '"] [data-act="tick"]');
    }
    function invDoGenerate(evId) {
      const ev = invEventsStore().get(evId);
      if (!ev) return;
      generatePullList(ev);
      invRerender();
    }
    function invRegenerate(evId) {
      const ev = invEventsStore().get(evId);
      if (!ev) return;
      generatePullList(ev);
      invRerender();
    }
    function invAckChange(evId) {
      const ev = invEventsStore().get(evId);
      if (ev && ev.pullList) { ev.pullList.changed = false; invSaveEvents(); }
      invRerender();
    }
    function invDismissBanner() { invSaveSettings({ bannerDismissed: true }); invRerender(); }
    function invSetListStatus(evId, status) {
      const ev = invEventsStore().get(evId);
      if (!ev || !ev.pullList) return;
      const apply = () => {
        ev.pullList.status = status;
        if (status === 'ready') { ev.pullList.readyAt = Date.now(); ev.pullList.changed = false; }
        if (status === 'out') ev.pullList.outAt = Date.now();
        if (status === 'closed') ev.pullList.closedAt = Date.now();
        invSaveEvents();
        showToast('List marked ' + status, 'success');
        invRerender();
      };
      const s = invPullSummary(ev);
      if (status === 'closed' && s.out > s.back) {
        CRMUI.confirm({ title: 'Close this list?', body: (s.out - s.back) + ' items are not back yet. Closing frees them for other events.', confirmLabel: 'Close list' }).then(ok => { if (ok) apply(); });
        return;
      }
      apply();
    }
    function invLineMenu(btn, evId, lineId) {
      const r = invLineOf(evId, lineId);
      if (!r.line || !(window.CRMUI && CRMUI.menu)) return;
      const rows = [{ label: 'Edit line', icon: 'pencil', onSelect: () => invEditLine(evId, lineId) }];
      const items = invItems();
      if (invFindConflicts(invEventsStore().list(), items).some(c => !c.overridden && c.lines.indexOf(r.line) > -1)) rows.push({ label: 'Keep with a note', icon: 'lock', onSelect: () => invOverrideLine(evId, lineId) });
      rows.push({ label: 'Remove line', icon: 'trash-2', danger: true, onSelect: () => invRemoveLine(evId, lineId) });
      CRMUI.menu(btn, rows);
    }
    function invEditLine(evId, lineId) {
      const r = invLineOf(evId, lineId);
      if (!r.ev || !r.ev.pullList) return;
      const l = r.line || { name: '', qty: 1, note: '' };
      CRMUI.sheet({
        title: r.line ? 'Edit line' : 'Add line',
        html: '<div class="form-section"><div class="field"><label class="field-label" for="plName">Name</label><input id="plName" class="input" type="text" value="' + esc(l.name) + '" autocomplete="off"></div>'
          + '<div class="field"><label class="field-label" for="plQty">How many</label><input id="plQty" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + esc(l.qty) + '"></div>'
          + '<div class="field"><label class="field-label" for="plNote">Note</label><input id="plNote" class="input" type="text" value="' + esc(l.note || '') + '" autocomplete="off"></div></div>',
        primary: { label: r.line ? 'Save line' : 'Add line', onClick: () => {
          const name = document.getElementById('plName').value.trim();
          if (!name) { showToast('Give the line a name', 'error'); return false; }
          const qty = Math.max(0, Math.round(invNum(document.getElementById('plQty').value)));
          const note = document.getElementById('plNote').value.trim();
          if (r.line) { r.line.name = name; r.line.qty = qty; r.line.note = note; }
          else r.ev.pullList.lines.push({ id: invId('pl'), key: 'manual:' + invSlug(name) + ':' + invId(''), name: name, qty: qty, unit: '', consumable: false, cat: '', modules: [], note: note, manual: true, itemId: null, itemIds: [], picked: 0, out: 0, 'in': 0, damaged: 0 });
          invSaveEvents();
          invRerender();
        } },
        secondary: { label: 'Cancel' }
      });
    }
    function invRemoveLine(evId, lineId) {
      const r = invLineOf(evId, lineId);
      if (!r.line) return;
      const idx = r.ev.pullList.lines.indexOf(r.line);
      const removed = r.ev.pullList.lines.splice(idx, 1)[0];
      invSaveEvents();
      invRerender();
      showUndoToast('Removed ' + removed.name + '. Undo', function() {
        const ev2 = invEventsStore().get(evId);
        if (ev2 && ev2.pullList) { ev2.pullList.lines.splice(Math.min(idx, ev2.pullList.lines.length), 0, removed); invSaveEvents(); invRerender(); }
      });
    }
    function invOverrideLine(evId, lineId) {
      const r = invLineOf(evId, lineId);
      if (!r.line) return;
      CRMUI.sheet({
        title: 'Keep this double booking',
        html: '<div class="form-section"><div class="field"><label class="field-label" for="plOv">Why is this ok</label><textarea id="plOv" class="input" rows="3" placeholder="Second event is 4 hours later across town"></textarea></div></div><p class="t-meta">Nothing is blocked. The note stays on the line so the next person knows.</p>',
        primary: { label: 'Keep with note', onClick: () => {
          const note = document.getElementById('plOv').value.trim();
          if (!note) { showToast('Add a short note first', 'error'); return false; }
          r.line.override = note; invSaveEvents(); invRerender();
        } },
        secondary: { label: 'Cancel' }
      });
    }
    // Assign stock units to a line. Suggestions first (matching words), then everything else. Conflicts warn; keeping one needs a note.
    function invAssignUnit(evId, lineId) {
      const r = invLineOf(evId, lineId);
      if (!r.line) return;
      const items = invItems().filter(i => !invIsRetired(i));
      const events = invEventsStore().list();
      const cur = invLineItemIds(r.line);
      const scored = items.map(i => ({ i: i, s: invMatchScore(r.line, i) })).sort((a, b) => b.s - a.s || String(a.i.name).localeCompare(String(b.i.name)));
      const sug = scored.filter(x => x.s >= 0.5), rest = scored.filter(x => x.s < 0.5);
      const row = x => {
        const it = x.i;
        const others = invUsesOf(events, it).filter(u => String(u.ev.id) !== String(evId) && u.win[0] < (invEventWindow(r.ev, it) || [0, 0])[1] && (invEventWindow(r.ev, it) || [0, 0])[0] < u.win[1]);
        const note = it.status === 'maintenance' ? 'In maintenance' : others.length ? 'Also on ' + others[0].ev.name : (it.tracking !== 'serialized' ? invQtyText(it) + ' on hand' : '');
        return '<label class="check inv-pick"><input type="checkbox" value="' + esc(it.id) + '"' + (cur.indexOf(it.id) > -1 ? ' checked' : '') + '><span class="check-box"></span><span class="check-text"><strong>' + esc(it.name) + '</strong> <span class="t-meta">' + esc(it.tag) + (note ? ' · ' + esc(note) : '') + '</span></span></label>';
      };
      CRMUI.sheet({
        title: 'Assign units to ' + r.line.name,
        html: '<p class="t-meta">Pick the units that go out for this line (' + invQty(r.line) + ' needed).</p>'
          + (sug.length ? '<div class="section-label">Suggested</div>' + sug.map(row).join('') : '')
          + '<div class="section-label">' + (sug.length ? 'All other gear' : 'All gear') + '</div>' + (rest.length ? rest.map(row).join('') : '<p class="t-meta">No other items.</p>'),
        primary: { label: 'Assign', onClick: (d) => {
          const ids = Array.prototype.slice.call(d.querySelectorAll('input[type=checkbox]:checked')).map(x => x.value);
          const prevIds = invLineItemIds(r.line), prevItem = r.line.itemId, prevOv = r.line.override;
          r.line.itemIds = ids; r.line.itemId = ids[0] || null;
          const mine = invFindConflicts(invEventsStore().list(), invItems()).filter(c => !c.overridden && c.lines.indexOf(r.line) > -1);
          if (mine.length) {
            r.line.itemIds = prevIds; r.line.itemId = prevItem; r.line.override = prevOv;
            invConfirmAssignConflict(evId, lineId, ids, mine[0]);
            return;
          }
          invSaveEvents(); invRerender();
        } },
        secondary: { label: 'Cancel' }
      });
    }
    function invConfirmAssignConflict(evId, lineId, ids, c) {
      CRMUI.sheet({
        title: 'Double booking',
        html: '<div class="banner banner-warn">' + invIcon('triangle-alert', 20) + '<div class="banner-body"><div class="banner-title">' + esc(invConflictText(c)) + '</div><div class="t-meta">' + c.events.map(e => esc(e.name)).join(' and ') + '</div></div></div>'
          + '<div class="form-section"><div class="field"><label class="field-label" for="plOv2">Keep it anyway? Say why</label><textarea id="plOv2" class="input" rows="3" placeholder="Second event is 4 hours later across town"></textarea></div></div>',
        primary: { label: 'Keep with note', onClick: () => {
          const note = document.getElementById('plOv2').value.trim();
          if (!note) { showToast('Add a short note first', 'error'); return false; }
          const r = invLineOf(evId, lineId);
          if (!r.line) return;
          r.line.itemIds = ids; r.line.itemId = ids[0] || null; r.line.override = note;
          invSaveEvents(); invRerender();
        } },
        secondary: { label: 'Choose another unit' }
      });
    }
    function invPrintPullList(evId) {
      const ev = invEventsStore().get(evId);
      if (!ev || !ev.pullList) return;
      const items = invItems();
      const rows = ev.pullList.lines.map(l => '<tr><td class="bx"></td><td>' + esc(l.name) + (l.note ? '<div class="nt">' + esc(l.note) + '</div>' : '') + '</td><td class="q">' + invQty(l) + (l.unit && l.unit !== 'pcs' ? ' ' + esc(l.unit) : '') + '</td><td>' + esc(invLineUnits(l, items).map(u => u.tag).join(', ')) + '</td></tr>').join('');
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>Pull list</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0.5in}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 14px;color:#333;font-size:13px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #bbb;padding:7px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#333}.bx{width:18px}.bx:before{content:"";display:inline-block;width:14px;height:14px;border:1.5px solid #111;border-radius:3px}.q{width:60px;font-weight:700}.nt{font-size:11px;color:#444}</style></head><body>'
        + '<h1>' + esc(ev.name) + '</h1><p>' + esc(invFmtDate(ev.date, 'long')) + (ev.venueName ? ' · ' + esc(ev.venueName) : '') + '</p><table><thead><tr><th></th><th>Item</th><th>Qty</th><th>Units</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>';
      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to print', 'warning'); return; }
      w.document.write(html); w.document.close();
      setTimeout(function() { try { w.focus(); w.print(); } catch (e) {} }, 350);
    }

    // ── Check-out / check-in (#/equipment/scan/<eventId>) ────────────────────
    // One screen; the hash never changes while it is open (a hash change can reset the camera on iOS).
    function invHasDetector() { return typeof window !== 'undefined' && 'BarcodeDetector' in window; }
    // Out: everything on the line. In: what actually left. If nothing was counted out (the list was flipped to Out by hand), expect it all back.
    function invScanTarget(l, mode, ev) {
      const q = invQty(l);
      if (mode !== 'in') return q;
      const lines = ev && ev.pullList && ev.pullList.lines ? ev.pullList.lines : [];
      return lines.some(x => invNum(x.out) > 0) ? Math.min(q, invNum(l.out)) : q;
    }
    function invScanHave(l, mode) { return mode === 'in' ? invNum(l['in']) : invNum(l.out); }
    function invScanMissing(ev, mode) {
      return ev.pullList.lines.filter(l => invQty(l) > 0 && invScanHave(l, mode) < invScanTarget(l, mode, ev));
    }
    function invMissingText(ev, mode) {
      const miss = invScanMissing(ev, mode);
      if (!miss.length) return '';
      const part = miss.slice(0, 3).map(l => (invScanTarget(l, mode, ev) - invScanHave(l, mode)) + ' x ' + l.name);
      return part.join(', ') + (miss.length > 3 ? ' and ' + (miss.length - 3) + ' more' : '');
    }
    function invViewScan(b, evId) {
      invActions('');
      const ev = invEventsStore().get(evId);
      if (!ev) { b.innerHTML = invEmpty('circle-alert', 'That event is not here anymore', 'Pick one from the pull lists.', '<button type="button" class="btn btn-secondary" onclick="invGo(\'pulllist\')">Pull lists</button>'); return; }
      // Opening check-out on an event with booked services but no list builds the draft list for you.
      if ((!ev.pullList || !Array.isArray(ev.pullList.lines)) && invCanEdit() && invModulesFor(ev).length) {
        generatePullList(ev, { silent: true });
        showToast('Built the pull list from the booked services', 'info');
      }
      if (!ev.pullList || !Array.isArray(ev.pullList.lines)) {
        b.innerHTML = '<div class="inv-scan">' + invEmpty('package-check', 'Generate the pull list first', 'Check-out works from the list of gear this event needs.',
          invCanEdit() ? '<button type="button" class="btn btn-secondary" onclick="invDoGenerate(\'' + invQ(ev.id) + '\');invGo(\'scan\',\'' + invQ(ev.id) + '\')">Generate pull list</button>' : '') + '</div>';
        return;
      }
      if (_invUI.scanFor !== evId) { _invUI.scanFor = evId; _invUI.mode = ev.pullList.status === 'out' ? 'in' : 'out'; }
      const st = invGetSettings();
      b.innerHTML = '<div class="inv-scan" data-mode="' + _invUI.mode + '" id="invScan">'
        + '<div class="inv-scan-top"><button type="button" class="btn btn-ghost inv-back" onclick="invGo(\'pulllist\',\'' + invQ(ev.id) + '\')">' + invIcon('chevron-left', 18) + ' Pull list</button>'
        + '<div class="inv-scan-ev"><div class="inv-scan-name" data-user-content>' + esc(ev.name) + '</div><div class="t-meta" id="invScanMeta"></div></div></div>'
        + '<div class="inv-exc" id="invExc" role="status" aria-live="polite"></div>'
        + (st.scan ? '<div class="inv-scan-in"><div class="inv-tagrow"><input id="invTag" class="input" type="text" inputmode="text" enterkeyhint="done" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Item tag" placeholder="Type a tag, like BL-000123" onkeydown="if(event.key===\'Enter\'){event.preventDefault();invScanSubmit()}">'
          + '<button type="button" class="btn btn-secondary" onclick="invScanSubmit()">Add</button></div>'
          + (invHasDetector() ? '<button type="button" class="btn btn-secondary inv-cambtn" id="invCamBtn" onclick="invToggleCamera()">' + invIcon('camera', 18) + ' Scan with camera</button>' : '<p class="t-meta inv-camnote">Camera scanning is not available in this browser. Type the tag, or use a scanner that types it.</p>')
          + '<div class="inv-camera" id="invCam" hidden><video id="invVideo" playsinline muted></video></div></div>' : '')
        + '<div class="inv-last" id="invLast" role="status" aria-live="polite"></div>'
        + '<div class="row-list inv-sl" id="invScanLines"></div>'
        + '<div class="inv-bar"><div class="seg inv-mode" role="group" aria-label="Mode"><button type="button" class="seg-btn" data-mode="out" onclick="invSetMode(\'out\')">Out</button><button type="button" class="seg-btn" data-mode="in" onclick="invSetMode(\'in\')">In</button></div>'
        + '<button type="button" class="btn btn-primary inv-finish" id="invFinish" onclick="invFinishScan(\'' + invQ(ev.id) + '\')"></button></div></div>'
        + '<div class="inv-flash" id="invFlash" aria-hidden="true"></div>';
      invScanRefresh();
    }
    function invScanRefresh() {
      const root = document.getElementById('invScan');
      if (!root) return;
      const ev = invEventsStore().get(_invUI.scanFor);
      if (!ev || !ev.pullList) return;
      const mode = _invUI.mode;
      root.setAttribute('data-mode', mode);
      root.querySelectorAll('.inv-mode .seg-btn').forEach(bt => { const on = bt.getAttribute('data-mode') === mode; bt.classList.toggle('active', on); bt.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      const s = invPullSummary(ev);
      const meta = document.getElementById('invScanMeta');
      if (meta) meta.textContent = invFmtDate(ev.date) + ' · ' + (mode === 'in' ? s.back + ' of ' + (s.out || s.total) + ' back' : s.out + ' of ' + s.total + ' out');
      const miss = invMissingText(ev, mode);
      const exc = document.getElementById('invExc');
      if (exc) {
        exc.classList.toggle('is-ok', !miss);
        exc.innerHTML = miss ? invIcon('triangle-alert', 20) + '<span><strong>' + (mode === 'in' ? 'Not back: ' : 'Missing: ') + '</strong>' + esc(miss) + '</span>'
          : invIcon('circle-check', 20) + '<span>' + (mode === 'in' ? 'Everything is back.' : 'Everything is checked out.') + '</span>';
      }
      const fin = document.getElementById('invFinish');
      if (fin) fin.textContent = mode === 'in' ? 'Finish check-in' : 'Finish check-out';
      const items = invItems();
      const lines = document.getElementById('invScanLines');
      if (lines) lines.innerHTML = ev.pullList.lines.filter(l => invScanTarget(l, mode, ev) > 0).map(l => invScanLineHtml(ev, l, mode, items)).join('') || (mode === 'in' ? invEmpty('package', 'Nothing is out', 'Check gear out first, then come back to check it in.') : invEmpty('package', 'No lines on this list', 'Add lines to the pull list first.'));
    }
    function invScanLineHtml(ev, l, mode, items) {
      const need = invScanTarget(l, mode, ev), have = invScanHave(l, mode);
      const done = need > 0 && have >= need;
      const e = invQ(ev.id), id = invQ(l.id);
      const units = invLineUnits(l, items);
      const sub = (have + ' of ' + need + (mode === 'in' ? ' back' : ' out')) + (invNum(l.damaged) ? ' · ' + l.damaged + ' damaged' : '') + (units.length ? ' · ' + units.map(u => esc(u.tag)).join(', ') : '');
      let ctl;
      if (mode === 'in') {
        ctl = '<button type="button" class="btn btn-secondary btn-icon" aria-label="Undo one ' + esc(l.name) + '" onclick="invScanBump(\'' + e + '\',\'' + id + '\',-1)"' + (have <= 0 ? ' disabled' : '') + '>' + invIcon('undo-2', 18) + '</button>'
          + '<button type="button" class="btn btn-secondary inv-cond" data-act="ok" onclick="invScanBump(\'' + e + '\',\'' + id + '\',1,\'ok\')"' + (have >= need ? ' disabled' : '') + '>OK</button>'
          + '<button type="button" class="btn btn-secondary inv-cond" onclick="invScanBump(\'' + e + '\',\'' + id + '\',1,\'minor\')"' + (have >= need ? ' disabled' : '') + '>Minor wear</button>'
          + '<button type="button" class="btn btn-secondary inv-cond is-bad" onclick="invScanBump(\'' + e + '\',\'' + id + '\',1,\'damaged\')"' + (have >= need ? ' disabled' : '') + '>Damaged</button>';
      } else if (need <= 1) {
        ctl = '<button type="button" class="btn btn-secondary btn-icon inv-tick' + (done ? ' is-done' : '') + '" aria-pressed="' + done + '" aria-label="' + (done ? 'Undo ' : 'Check out ') + esc(l.name) + '" onclick="invScanBump(\'' + e + '\',\'' + id + '\',' + (done ? -1 : 1) + ')">' + invIcon(done ? 'circle-check' : 'circle', 24) + '</button>';
      } else {
        ctl = '<div class="inv-step"><button type="button" class="btn btn-secondary btn-icon" aria-label="One less ' + esc(l.name) + '" onclick="invScanBump(\'' + e + '\',\'' + id + '\',-1)"' + (have <= 0 ? ' disabled' : '') + '>' + invIcon('minus', 18) + '</button>'
          + '<span class="inv-step-n num">' + have + ' / ' + need + '</span><button type="button" class="btn btn-secondary btn-icon" aria-label="One more ' + esc(l.name) + '" onclick="invScanBump(\'' + e + '\',\'' + id + '\',1)"' + (have >= need ? ' disabled' : '') + '>' + invIcon('plus', 18) + '</button></div>';
      }
      return '<div class="row inv-sline' + (done ? ' is-done' : '') + (mode === 'in' ? ' is-in' : '') + '" data-line-id="' + esc(id) + '"><div class="row-main"><div class="row-title"><span data-user-content>' + esc(l.name) + '</span></div><div class="row-sub">' + sub + '</div></div><div class="inv-sline-ctl">' + ctl + '</div></div>';
    }
    function invSetMode(m) {
      _invUI.mode = m === 'in' ? 'in' : 'out';
      invBeep(true, true);
      invScanRefresh();
    }
    // Count one unit on a line. cond (check-in only): ok | minor | damaged. itemId: the unit that was scanned, when known.
    function invScanBump(evId, lineId, dir, cond, itemId) {
      const r = invLineOf(evId, lineId);
      if (!r.line) return false;
      const l = r.line, mode = _invUI.mode;
      const need = invScanTarget(l, mode, r.ev);
      const key = mode === 'in' ? 'in' : 'out';
      const before = invNum(l[key]);
      const next = Math.max(0, Math.min(need, before + dir));
      if (next === before) return false;
      l[key] = next;
      if (!Array.isArray(l.outIds)) l.outIds = [];
      if (!Array.isArray(l.inIds)) l.inIds = [];
      const idsKey = mode === 'in' ? 'inIds' : 'outIds';
      const items = invStore().list();
      const unit = itemId ? items.find(i => i.id === itemId) : (invLineItemIds(l).length === 1 ? items.find(i => i.id === invLineItemIds(l)[0]) : null);
      if (dir > 0) {
        if (unit && l[idsKey].indexOf(unit.id) < 0) l[idsKey].push(unit.id);
        if (mode === 'out') l.picked = Math.max(invNum(l.picked), next);
        if (unit) invLog(unit, mode === 'in' ? 'in' : 'out', r.ev.id, cond && cond !== 'ok' ? (cond === 'minor' ? 'Minor wear' : 'Damaged') : '');
        if (mode === 'in' && cond === 'damaged') invMarkDamaged(r.ev, l, unit, items);
      } else {
        if (unit) l[idsKey] = l[idsKey].filter(x => x !== unit.id);
        else l[idsKey].pop();
        if (mode === 'in' && invNum(l.damaged) > next) l.damaged = next;
      }
      invStore().save(items);
      invSaveEvents();
      invScanRefresh();
      return true;
    }
    function invMarkDamaged(ev, l, unit, items) {
      l.damaged = invNum(l.damaged) + 1;
      if (unit) {
        invNormItem(unit);
        unit.maintenance.push({ id: invId('wo'), kind: 'repair', note: 'Damaged on return from ' + ev.name, openedAt: invTodayIso(), due: '', closedAt: null });
        unit.status = 'maintenance';
        invLog(unit, 'damage', ev.id, 'Damaged on return');
        showToast(unit.name + ' is in maintenance. A work order is open.', 'warning');
      } else showToast('Marked damaged. Assign a unit to the line to open a repair.', 'warning');
    }
    function invBeep(ok, soft) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!_invUI.audio) _invUI.audio = new AC();
        const a = _invUI.audio;
        if (a.state === 'suspended') a.resume();
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = ok ? (soft ? 520 : 880) : 220;
        g.gain.value = 0.08;
        o.connect(g); g.connect(a.destination);
        o.start(); o.stop(a.currentTime + (ok ? 0.08 : 0.22));
      } catch (e) {}
    }
    function invFlash(tone) {
      const f = document.getElementById('invFlash');
      if (!f) return;
      f.className = 'inv-flash';
      void f.offsetWidth;
      f.className = 'inv-flash is-' + tone;
      clearTimeout(_invUI.flashT);
      _invUI.flashT = setTimeout(function() { f.className = 'inv-flash'; }, 700);
    }
    function invShowLast(tone, title, sub, actionsHtml) {
      const el = document.getElementById('invLast');
      if (!el) return;
      el.innerHTML = '<div class="inv-last-card is-' + tone + '"><div class="inv-last-main"><div class="inv-last-title" data-user-content>' + esc(title) + '</div><div class="inv-last-sub">' + esc(sub) + '</div></div>' + (actionsHtml || '') + '</div>';
      invFlash(tone);
      invBeep(tone === 'ok');
    }
    function invScanSubmit() {
      const inp = document.getElementById('invTag');
      if (!inp) return;
      const v = inp.value.trim();
      inp.value = '';
      if (!v) return;
      invScanCode(v);
      if (!invIsPhone() && inp.focus) inp.focus();
    }
    function invLineHasCapacity(l, mode, ev) { return invScanHave(l, mode) < invScanTarget(l, mode, ev); }
    function invScanCode(raw) {
      const ev = invEventsStore().get(_invUI.scanFor);
      if (!ev || !ev.pullList) return;
      const items = invItems();
      const it = invFindItemByCode(items, raw);
      const mode = _invUI.mode;
      if (!it) {
        invShowLast('bad', 'No item with that tag', String(raw).slice(0, 40), invCanEdit() ? '<button type="button" class="btn btn-secondary" onclick="openAddEquipmentModal({tag:\'' + invQ(String(raw).toUpperCase()) + '\'})">Register it</button>' : '');
        return;
      }
      if (invIsRetired(it)) { invShowLast('bad', it.name, 'This item is retired.'); return; }
      const lines = ev.pullList.lines;
      let line = lines.find(l => invLineItemIds(l).indexOf(it.id) > -1 && invLineHasCapacity(l, mode, ev));
      const assignedHere = lines.find(l => invLineItemIds(l).indexOf(it.id) > -1);
      const doneIds = l => (mode === 'in' ? l.inIds : l.outIds) || [];
      if (assignedHere && (!line || doneIds(line).indexOf(it.id) > -1)) { invShowLast('warn', it.name, mode === 'in' ? 'Already checked in.' : 'Already checked out.'); return; }
      if (!line) {
        let best = null, score = 0;
        lines.forEach(l => { if (l.consumable || !invLineHasCapacity(l, mode, ev)) return; const s = invMatchScore(l, it); if (s > score) { score = s; best = l; } });
        if (best && score >= 0.5) {
          if (!Array.isArray(best.itemIds)) best.itemIds = [];
          best.itemIds.push(it.id); best.itemId = best.itemId || it.id; line = best;
        }
      }
      if (!line) {
        invShowLast('bad', it.name, 'Not on this list.', '<button type="button" class="btn btn-secondary" onclick="invAddScanned(\'' + invQ(it.id) + '\')">Add to list</button>');
        return;
      }
      const ok = invScanBump(ev.id, line.id, 1, 'ok', it.id);
      if (!ok) { invShowLast('warn', it.name, 'Nothing more needed for ' + line.name + '.'); return; }
      _invUI.lastScan = { evId: ev.id, lineId: line.id, itemId: it.id };
      const have = invScanHave(line, mode), need = invScanTarget(line, mode, ev);
      const extra = mode === 'in' ? '<div class="inv-last-acts"><button type="button" class="btn btn-secondary" onclick="invAmendLast(\'minor\')">Minor wear</button><button type="button" class="btn btn-secondary is-bad" onclick="invAmendLast(\'damaged\')">Damaged</button></div>' : '';
      invShowLast(it.status === 'maintenance' ? 'warn' : 'ok', it.name, (mode === 'in' ? 'Back. ' : 'Out. ') + have + ' of ' + need + ' for ' + line.name + (it.status === 'maintenance' ? '. This unit is in maintenance.' : ''), extra);
    }
    function invAmendLast(cond) {
      const s = _invUI.lastScan;
      if (!s) return;
      const r = invLineOf(s.evId, s.lineId);
      const items = invStore().list();
      const unit = items.find(i => i.id === s.itemId);
      if (!r.line || !unit) return;
      if (cond === 'damaged') { invMarkDamaged(r.ev, r.line, unit, items); invStore().save(items); invSaveEvents(); }
      else { invLog(unit, 'in', r.ev.id, 'Minor wear'); invStore().save(items); }
      _invUI.lastScan = null;
      const el = document.getElementById('invLast');
      if (el) el.innerHTML = '<div class="inv-last-card is-warn"><div class="inv-last-main"><div class="inv-last-title" data-user-content>' + esc(unit.name) + '</div><div class="inv-last-sub">' + (cond === 'damaged' ? 'Marked damaged.' : 'Noted minor wear.') + '</div></div></div>';
      invScanRefresh();
    }
    function invAddScanned(itemId) {
      const ev = invEventsStore().get(_invUI.scanFor);
      const it = invStore().get(itemId);
      if (!ev || !it) return;
      const l = { id: invId('pl'), key: 'manual:' + invSlug(it.name) + ':' + invId(''), name: it.name, qty: 1, unit: '', consumable: false, cat: it.category || '', modules: [], note: 'Added at check-out', manual: true,
                  itemId: it.id, itemIds: [it.id], picked: 0, out: 0, 'in': 0, damaged: 0 };
      ev.pullList.lines.push(l);
      invSaveEvents();
      invScanBump(ev.id, l.id, 1, 'ok', it.id);
      invShowLast('ok', it.name, 'Added to the list and counted.');
    }
    function invFinishScan(evId) {
      const ev = invEventsStore().get(evId);
      if (!ev || !ev.pullList) return;
      const mode = _invUI.mode;
      const miss = invMissingText(ev, mode);
      const done = () => {
        if (mode === 'out') {
          ev.pullList.status = 'out'; ev.pullList.outAt = Date.now(); ev.pullList.changed = false;
          const s = invPullSummary(ev);
          showToast('Checked out ' + s.out + ' of ' + s.total + ' items', 'success');
        } else {
          const s = invPullSummary(ev);
          const all = !invScanMissing(ev, 'in').length;
          if (all) { ev.pullList.status = 'closed'; ev.pullList.closedAt = Date.now(); showToast('Everything is back. List closed.', 'success'); }
          else showToast(s.out - s.back + ' items are not back yet. The list stays open.', 'info');
        }
        invSaveEvents();
        _invUI.lastScan = null;
        invGo('pulllist', evId);
      };
      if (miss && window.CRMUI && CRMUI.confirm) {
        CRMUI.confirm({ title: mode === 'in' ? 'Finish check-in?' : 'Finish check-out?', body: (mode === 'in' ? 'Not back: ' : 'Missing: ') + miss + '. They stay on the list.', confirmLabel: 'Finish anyway' }).then(ok => { if (ok) done(); });
      } else done();
    }
    // Camera (BarcodeDetector only; no libraries tonight, see the lane notes for the iPhone fallback)
    function invToggleCamera() { if (_invUI.camera) invStopCamera(); else invStartCamera(); }
    async function invStartCamera() {
      invBeep(true, true);
      const panel = document.getElementById('invCam'), video = document.getElementById('invVideo'), btn = document.getElementById('invCamBtn');
      if (!panel || !video || !invHasDetector()) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = stream;
        await video.play();
        const det = new BarcodeDetector({ formats: ['qr_code', 'code_128'] });
        const cam = { stream: stream, last: '', lastAt: 0, busy: false, timer: 0 };
        cam.timer = setInterval(function() {
          if (cam.busy || video.readyState < 2) return;
          cam.busy = true;
          det.detect(video).then(function(codes) {
            cam.busy = false;
            if (!codes || !codes.length) return;
            const v = codes[0].rawValue, now = Date.now();
            if (v === cam.last && now - cam.lastAt < 2500) return;
            cam.last = v; cam.lastAt = now;
            invScanCode(v);
          }).catch(function() { cam.busy = false; });
        }, 250);
        _invUI.camera = cam;
        panel.hidden = false;
        if (btn) btn.innerHTML = invIcon('x', 18) + ' Stop camera';
      } catch (e) {
        showToast('The camera is not available. Type the tag instead.', 'warning');
      }
    }
    function invStopCamera() {
      const cam = _invUI.camera;
      if (cam) {
        clearInterval(cam.timer);
        try { cam.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
        _invUI.camera = null;
      }
      const panel = document.getElementById('invCam'), btn = document.getElementById('invCamBtn'), video = document.getElementById('invVideo');
      if (video) { try { video.srcObject = null; } catch (e) {} }
      if (panel) panel.hidden = true;
      if (btn) btn.innerHTML = invIcon('camera', 18) + ' Scan with camera';
    }

    // ── Maintenance ──────────────────────────────────────────────────────────
    function invViewMaintenance(b) {
      const items = invItems();
      const events = invEventsStore().list();
      const canEdit = invCanEdit();
      invActions(canEdit ? '<button type="button" class="btn btn-primary" onclick="invOpenWorkOrder()">' + invIcon('wrench', 18) + ' Open work order</button>' : '');
      const open = [];
      items.forEach(it => (it.maintenance || []).forEach(w => { if (!w.closedAt) open.push({ it: it, w: w, next: invNextUse(events, it) }); }));
      open.sort((a, c) => (a.next ? String(a.next.ev.date) : '9999').localeCompare(c.next ? String(c.next.ev.date) : '9999') || String(a.w.openedAt).localeCompare(String(c.w.openedAt)));
      // Items flipped to maintenance the old way (no work order) still belong in the queue
      const bare = items.filter(it => it.status === 'maintenance' && !(it.maintenance || []).some(w => !w.closedAt));
      if (!open.length && !bare.length) { b.innerHTML = invEmpty('wrench', 'Nothing in the shop', 'Open a work order when something breaks or needs a check. It will show up here, soonest event first.'); return; }
      const today = invTodayIso();
      const bareHtml = bare.length ? '<div class="section-label">In maintenance, no work order yet</div><div class="row-list">' + bare.map(it => {
        const nx = invNextUse(events, it);
        return '<div class="row inv-wo"><div class="row-main"><div class="row-title"><span data-user-content>' + esc(it.name) + '</span> <span class="t-meta">' + esc(it.tag) + '</span></div>'
          + (it.notes ? '<div class="row-sub" data-user-content>' + esc(it.notes) + '</div>' : '') + '<div class="row-sub">' + (nx ? 'Next event: ' + esc(invFmtDate(nx.ev.date)) + ' · ' + esc(nx.ev.name) : 'No upcoming event') + '</div></div>'
          + (canEdit ? '<div class="inv-wo-ctl"><button type="button" class="btn btn-secondary btn-sm" onclick="invOpenWorkOrder(\'' + invQ(it.id) + '\')">Open work order</button><button type="button" class="btn btn-ghost btn-sm" onclick="invSetItemStatus(\'' + invQ(it.id) + '\',\'available\')">Back in service</button></div>' : '') + '</div>';
      }).join('') + '</div>' : '';
      b.innerHTML = (open.length ? '<p class="t-meta inv-sortnote">Sorted by the next event that needs each item.</p><div class="row-list">' : '<div class="row-list" hidden>') + open.map(x => {
        const late = x.w.due && x.w.due < today;
        const sub = [esc(x.w.note || 'No note'), 'Opened ' + esc(invFmtDate(x.w.openedAt)), x.w.due ? 'Due ' + esc(invFmtDate(x.w.due)) : ''].filter(Boolean).join(' · ');
        return '<div class="row inv-wo"><div class="row-main"><div class="row-title"><span data-user-content>' + esc(x.it.name) + '</span> <span class="t-meta">' + esc(x.it.tag) + '</span></div><div class="row-sub">' + sub + '</div>'
          + '<div class="row-sub">' + (x.next ? 'Next event: ' + esc(invFmtDate(x.next.ev.date)) + ' · ' + esc(x.next.ev.name) : 'No upcoming event') + '</div></div>'
          + '<div class="inv-wo-ctl">' + invPill(invCap(x.w.kind || 'repair'), 'warn') + (late ? invPill('Overdue', 'danger') : '')
          + (canEdit ? '<button type="button" class="btn btn-secondary btn-sm" onclick="invCloseWorkOrder(\'' + invQ(x.it.id) + '\',\'' + invQ(x.w.id) + '\',\'done\')">Done</button><button type="button" class="btn btn-ghost btn-sm" onclick="invCloseWorkOrder(\'' + invQ(x.it.id) + '\',\'' + invQ(x.w.id) + '\',\'writeoff\')">Write off</button>' : '') + '</div></div>';
      }).join('') + '</div>' + bareHtml;
    }

    // ── Pull list defaults (editable; saved to settings.inventory.pullDefaults) ──
    function invViewDefaults(b) {
      invActions('');
      const lists = invDefaultLists();
      const st = invGetSettings();
      const banner = !st.bannerDismissed ? '<div class="banner banner-info" role="status">' + invIcon('info', 20) + '<div class="banner-body"><div class="banner-title">Industry default. Edit to match your gear.</div><div class="t-meta">Each service builds its pull list from the lines below. Your edits replace the default for that service.</div></div>'
        + '<button type="button" class="btn btn-ghost btn-icon banner-x" aria-label="Dismiss" onclick="invDismissBanner()">' + invIcon('x', 18) + '</button></div>' : '';
      b.innerHTML = banner + '<div class="row-list inv-defs">' + Object.keys(lists).map(k => {
        const L = lists[k];
        return '<div class="row inv-row" onclick="invEditDefaults(\'' + k + '\')"><button type="button" class="row-link row-main" aria-label="Edit ' + esc(L.label) + '"><span class="row-title">' + esc(L.label) + '</span><span class="row-sub">Matches: ' + esc(L.match.join(', ')) + '</span></button>'
          + '<div class="row-trail"><span class="t-meta">' + L.lines.length + (L.lines.length === 1 ? ' line' : ' lines') + '</span>' + (L.edited ? invPill('Edited', 'violet') : invPill('Default', 'neutral')) + invIcon('chevron-right', 18) + '</div></div>';
      }).join('') + '</div>';
    }
    function invEditDefaults(key) {
      const lists = invDefaultLists();
      const L = lists[key];
      if (!L) return;
      _invUI.defKey = key;
      _invUI.defLines = L.lines.map(x => Object.assign({}, x));
      CRMUI.sheet({
        id: 'invDefSheet',
        title: L.label + ' pull list',
        html: '<div id="invDefBody"></div>',
        primary: { label: 'Save list', onClick: () => {
          const st = invGetSettings();
          const pd = Object.assign({}, st.pullDefaults || {});
          pd[key] = { lines: _invUI.defLines };
          invSaveSettings({ pullDefaults: pd });
          showToast(L.label + ' list saved', 'success');
          invRerender();
        } },
        secondary: { label: 'Cancel' }
      });
      invDefBody();
    }
    function invDefBody() {
      const host = document.getElementById('invDefBody');
      if (!host) return;
      const lines = _invUI.defLines || [];
      const base = INV_DEFAULT_PULL_LISTS[_invUI.defKey];
      host.innerHTML = '<p class="t-meta">Tap a line to change it.</p><div class="row-list">' + lines.map((x, i) =>
        '<button type="button" class="row row-compact" onclick="invEditDefLine(' + i + ')"><span class="row-main"><span class="row-title">' + esc(x.name) + '</span>' + (x.note ? '<span class="row-sub">' + esc(x.note) + '</span>' : '') + '</span><span class="row-trail"><span class="num">x' + invNum(x.qty) + '</span>' + invIcon('pencil', 16) + '</span></button>').join('')
        + '</div><div class="inv-def-acts"><button type="button" class="btn btn-secondary" onclick="invEditDefLine(-1)">' + invIcon('plus', 18) + ' Add line</button>'
        + '<button type="button" class="btn btn-ghost" onclick="invResetDef()">Reset to default</button></div>';
    }
    function invResetDef() {
      const base = INV_DEFAULT_PULL_LISTS[_invUI.defKey];
      if (!base) return;
      _invUI.defLines = base.lines.map(x => Object.assign({}, x));
      invDefBody();
    }
    function invEditDefLine(i) {
      const lines = _invUI.defLines || [];
      const x = i >= 0 ? lines[i] : { name: '', qty: 1, note: '' };
      CRMUI.sheet({
        title: i >= 0 ? 'Edit line' : 'Add line',
        html: '<div class="form-section"><div class="field"><label class="field-label" for="dlName">Name</label><input id="dlName" class="input" type="text" value="' + esc(x.name) + '" autocomplete="off"></div>'
          + '<div class="field"><label class="field-label" for="dlQty">How many</label><input id="dlQty" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + esc(x.qty) + '"></div>'
          + '<div class="field"><label class="field-label" for="dlNote">Note</label><input id="dlNote" class="input" type="text" value="' + esc(x.note || '') + '" autocomplete="off"></div></div>'
          + (i >= 0 ? '<div class="inv-kit-del"><button type="button" class="btn btn-ghost" onclick="invRemoveDefLine(' + i + ')">' + invIcon('trash-2', 18) + ' Remove line</button></div>' : ''),
        primary: { label: i >= 0 ? 'Save line' : 'Add line', onClick: () => {
          const name = document.getElementById('dlName').value.trim();
          if (!name) { showToast('Give the line a name', 'error'); return false; }
          const next = Object.assign({}, x, { name: name, qty: Math.max(0, Math.round(invNum(document.getElementById('dlQty').value))), note: document.getElementById('dlNote').value.trim() });
          if (!next.note) delete next.note;
          if (i >= 0) lines[i] = next; else lines.push(next);
          invDefBody();
        } },
        secondary: { label: 'Cancel' }
      });
    }
    function invRemoveDefLine(i) {
      (_invUI.defLines || []).splice(i, 1);
      const sheets = document.querySelectorAll('dialog[data-crm-built]');
      if (sheets.length) CRMUI.close(sheets[sheets.length - 1], { force: true });
      invDefBody();
    }

    // ── Staff roster helpers (the roster itself now renders in Team; these keep their names) ──
    function openAddStaffModal() { openModal('addStaffModal'); }
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
      invAfterStaffChange();
      showToast('Staff member added', 'success');
    }
    function deleteStaff(id) {
      confirmDestructive('Remove Staff Member', 'Remove this person from the staff roster?', function() {
        setDB('staffroster', getDB('staffroster').filter(s => s.id !== id));
        invAfterStaffChange();
        showToast('Removed from roster', 'info');
      }, 'Remove');
    }
    // Team (lane P7) shows the roster. Tell it to redraw; also listen with document.addEventListener('bs:staff-changed', ...).
    function invAfterStaffChange() {
      try { document.dispatchEvent(new CustomEvent('bs:staff-changed')); } catch (e) {}
      const acc = document.getElementById('accounts');
      if (acc && acc.classList.contains('active') && typeof renderAccounts === 'function') renderAccounts();
    }
