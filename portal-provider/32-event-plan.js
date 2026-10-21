// ============================================================================
// portal-provider/32-event-plan.js  -  event planning: client plan tab, timeline tab, timeline PDF, run of show print
// Classic script (no modules, no build step). Split verbatim from portal-provider.html (task 1A).
// Shares the global scope with the other portal-provider/*.js files; load order is set by the script tags in portal-provider.html.
// ============================================================================

    // ── Client plan (P0.4): read-only view of what the client entered in their portal ──
    // Real field names written by portal-client.html:
    //   clientMusic [{moment,title,artist,category}], clientPlaylists [{url,label}], doNotPlay (text),
    //   clientVendors [{type,name,contactName,phone,email,notes}], clientPrefs {...}, clientEnhancements {...},
    //   clientNotes {venue,parking}. The RPC whitelist calls the music key "music", so that is read too.
    // Nothing writes per-section "updated" times yet; they show when present (clientUpdatedAt map, <key>UpdatedAt, or obj.updatedAt).
    function _cpTime(ts) {
      if (ts === null || ts === undefined || ts === '') return '';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function _cpUpdated(ev, key, obj) {
      const m = ev && ev.clientUpdatedAt;
      let ts = (m && typeof m === 'object') ? m[key] : null;
      if ((ts === null || ts === undefined) && ev) ts = ev[key + 'UpdatedAt'];
      if ((ts === null || ts === undefined) && obj && typeof obj === 'object' && !Array.isArray(obj)) ts = obj.updatedAt;
      return (ts === null || ts === undefined) ? '' : _cpTime(ts);
    }
    function _cpText(s) { return esc(s).replace(/\n/g, '<br>'); }
    function _cpSafeColor(c) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? String(c) : ''; }
    function _cpSafeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }
    function _cpSwatch(c) {
      const hex = _cpSafeColor(c);
      if (!hex) return c ? esc(c) : '';
      return `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${hex};border:1px solid var(--border-ui);vertical-align:-1px;margin-right:6px;"></span>${esc(hex)}`;
    }
    const _CP_CAT_ORDER = { 'must play': 0, 'nice to have': 1, 'do not play': 2 };
    function _cpCatRank(c) { const r = _CP_CAT_ORDER[String(c || '').toLowerCase()]; return r === undefined ? 1 : r; }

    // Normalises everything the client entered into one object so the screen and the print sheet agree.
    function _cpData(ev) {
      ev = ev || {};
      const objs = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
      const txt = v => (typeof v === 'string' ? v.trim() : '');
      let songs = objs(ev.clientMusic);
      let lists = objs(ev.clientPlaylists);
      let dnp = txt(ev.doNotPlay);
      const m = ev.music;
      if (Array.isArray(m)) songs = songs.concat(objs(m));
      else if (m && typeof m === 'object') {
        songs = songs.concat(objs(m.moments || m.songs));
        lists = lists.concat(objs(m.playlists));
        if (!dnp) dnp = txt(m.doNotPlay);
      }
      songs = songs.slice().sort((a, b) => _cpCatRank(a.category) - _cpCatRank(b.category));
      const prefs = (ev.clientPrefs && typeof ev.clientPrefs === 'object' && !Array.isArray(ev.clientPrefs)) ? ev.clientPrefs : {};
      const enh = (ev.clientEnhancements && typeof ev.clientEnhancements === 'object' && !Array.isArray(ev.clientEnhancements)) ? ev.clientEnhancements : {};
      const notes = (ev.clientNotes && typeof ev.clientNotes === 'object' && !Array.isArray(ev.clientNotes)) ? ev.clientNotes : {};
      const vendors = objs(ev.clientVendors);
      const momentSongs = (prefs.momentSongs && typeof prefs.momentSongs === 'object') ? Object.entries(prefs.momentSongs).filter(([k, v]) => k && txt(v)) : [];
      const prefMoments = Array.isArray(prefs.moments) ? prefs.moments.filter(Boolean) : [];
      const lightColors = (enh.lighting && Array.isArray(enh.lighting.colors)) ? enh.lighting.colors.filter(Boolean) : [];
      const d = {
        songs, lists, dnp, vendors, prefs, enh, notes, momentSongs, prefMoments, lightColors,
        musicDesc: txt(prefs.musicDesc)
      };
      d.hasMusic = !!(songs.length || lists.length || dnp || momentSongs.length || d.musicDesc);
      d.hasVendors = vendors.length > 0;
      d.hasPrefs = !!(txt(prefs.vibe) || txt(prefs.vibeOther) || txt(prefs.colorPrimary) || txt(prefs.colorAccent) || txt(prefs.colorNotes) ||
        txt(String(prefs.guestCount == null ? '' : prefs.guestCount)) || prefMoments.length || txt(prefs.specialRequests));
      d.hasEnh = !!(enh.uplightingEnabled || enh.photboothEnabled || enh.projectionEnabled || txt(enh.otherEnhancements) || lightColors.length);
      d.hasNotes = !!(txt(notes.venue) || txt(notes.parking));
      d.any = d.hasMusic || d.hasVendors || d.hasPrefs || d.hasEnh || d.hasNotes;
      return d;
    }

    function _cpRow(label, valueHtml) {
      if (!valueHtml) return '';
      return `<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><div style="flex:0 0 140px;color:var(--text-3);">${label}</div><div style="flex:1;min-width:0;color:var(--text-1);word-break:break-word;">${valueHtml}</div></div>`;
    }
    function _cpSection(title, updated, hasData, bodyHtml) {
      const stamp = updated ? `<span style="font-size:12px;color:var(--text-3);font-weight:400;text-transform:none;letter-spacing:0;">Updated ${esc(updated)}</span>` : '';
      return `<div style="margin-bottom:20px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:10px;"><span>${title}</span>${stamp}</div>
        <div style="padding:14px 16px;background:var(--black-4);border:1px solid var(--border);border-radius:6px;">${hasData ? bodyHtml : '<div style="font-size:13px;color:var(--text-3);">Nothing entered yet.</div>'}</div>
      </div>`;
    }

    // Answers from the client portal onboarding wizard and Settings (stored in ev.clientOnboarding,
    // because clients cannot write core event fields). Shown so the provider can copy them in.
    function _cpOnboardingSection(ev) {
      const ob = (ev && ev.clientOnboarding) || {};
      const rows = [['Venue', ob.venueName], ['Venue address', ob.venueAddress], ['Event type', ob.eventType],
                    ['Name', ob.clientName], ['Phone', ob.phone], ['Guest count', ob.guestCount]]
        .filter(r => r[1] != null && String(r[1]).trim() !== '');
      if (!rows.length) return '';
      const body = rows.map(r => `<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><div style="width:120px;color:var(--text-3);flex-shrink:0;">${esc(r[0])}</div><div>${esc(String(r[1]))}</div></div>`).join('');
      return _cpSection('Onboarding answers', _cpUpdated(ev, 'clientOnboarding', ob), true, body);
    }

    function renderEventClientPlan(event) {
      const ev = event || {};
      const d = _cpData(ev);
      const head = `<div style="font-size:12px;color:var(--text-3);margin-bottom:16px;">What the client entered in their portal. Read only. Changes they make show up here the next time you open this tab.</div>`;
      if (!d.any) {
        return head + `<div style="padding:28px 20px;text-align:center;color:var(--text-2);font-size:13px;border:1px dashed var(--border-ui);border-radius:6px;">Nothing from the client yet. Their music, vendors, preferences, enhancements and notes will show up here once they fill them in on their portal.</div>`;
      }

      // Music
      let music = '';
      if (d.songs.length) {
        music += `<div style="margin-bottom:12px;">${d.songs.map(s => {
          const cat = String(s.category || '');
          const isDnp = cat.toLowerCase() === 'do not play';
          return `<div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <div style="flex:1;min-width:0;"><span style="font-weight:600;color:var(--text-1);">${esc(s.title || 'Untitled')}</span>${s.artist ? ` <span style="color:var(--text-2);">${esc(s.artist)}</span>` : ''}${s.moment ? `<div style="font-size:12px;color:var(--text-3);margin-top:2px;">${esc(s.moment)}</div>` : ''}</div>
            ${cat ? `<span style="flex-shrink:0;font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid ${isDnp ? 'var(--danger)' : 'var(--border-ui)'};color:${isDnp ? 'var(--danger)' : 'var(--text-2)'};">${esc(cat)}</span>` : ''}
          </div>`;
        }).join('')}</div>`;
      }
      music += _cpRow('Music direction', d.musicDesc ? _cpText(d.musicDesc) : '');
      if (d.momentSongs.length) music += _cpRow('Songs by moment', d.momentSongs.map(([k, v]) => `<div><span style="color:var(--text-3);">${esc(k)}:</span> ${esc(v)}</div>`).join(''));
      if (d.lists.length) music += _cpRow('Playlists', d.lists.map(p => {
        const u = _cpSafeUrl(p.url);
        const label = esc(p.label || 'Playlist');
        return `<div>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener" style="color:var(--cyan);">${label}</a>` : label}</div>`;
      }).join(''));
      music += _cpRow('Do not play', d.dnp ? _cpText(d.dnp) : '');

      // Vendors
      const vendors = d.vendors.map(v => `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <div><span style="font-weight:600;color:var(--text-1);">${esc(v.name || 'Unnamed')}</span>${v.type ? ` <span style="color:var(--text-3);">${esc(v.type)}</span>` : ''}</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:2px;">${[v.contactName, v.phone, v.email].filter(Boolean).map(esc).join(' · ')}</div>
          ${v.notes ? `<div style="font-size:12px;color:var(--text-3);margin-top:2px;">${_cpText(v.notes)}</div>` : ''}
        </div>`).join('');

      // Preferences
      const p = d.prefs;
      const vibe = [p.vibe, p.vibeOther].filter(x => x && String(x).trim()).map(esc).join(' · ');
      let prefs = _cpRow('Vibe', vibe);
      prefs += _cpRow('Colors', [p.colorPrimary, p.colorAccent].filter(Boolean).map(_cpSwatch).join('&nbsp;&nbsp;'));
      prefs += _cpRow('Color notes', p.colorNotes ? _cpText(p.colorNotes) : '');
      prefs += _cpRow('Guest count', (p.guestCount !== undefined && p.guestCount !== null && String(p.guestCount).trim()) ? esc(p.guestCount) : '');
      prefs += _cpRow('Key moments', d.prefMoments.map(esc).join(', '));
      prefs += _cpRow('Special requests', p.specialRequests ? _cpText(p.specialRequests) : '');

      // Enhancements
      const e = d.enh;
      let enh = '';
      if (e.uplightingEnabled) enh += _cpRow('LED uplighting', [e.uplightColor1, e.uplightColor2].filter(Boolean).map(_cpSwatch).join('&nbsp;&nbsp;') + (e.uplightNotes ? `<div style="color:var(--text-2);margin-top:2px;">${_cpText(e.uplightNotes)}</div>` : '') || 'Yes');
      if (d.lightColors.length) enh += _cpRow('Lighting colors', d.lightColors.map(_cpSwatch).join('&nbsp;&nbsp;'));
      if (e.photboothEnabled) enh += _cpRow('Photo booth', [e.photoboothTheme ? 'Theme: ' + esc(e.photoboothTheme) : '', e.photoboothText ? 'Overlay text: ' + esc(e.photoboothText) : ''].filter(Boolean).join('<br>') || 'Yes');
      if (e.projectionEnabled) enh += _cpRow('Projection / video wall', e.projectionDesc ? _cpText(e.projectionDesc) : 'Yes');
      enh += _cpRow('Anything else', e.otherEnhancements ? _cpText(e.otherEnhancements) : '');

      // Notes
      const n = d.notes;
      let notes = _cpRow('Venue notes', n.venue ? _cpText(n.venue) : '') + _cpRow('Parking and directions', n.parking ? _cpText(n.parking) : '');

      const overall = _cpTime(ev.clientUpdatedAt && typeof ev.clientUpdatedAt !== 'object' ? ev.clientUpdatedAt : '');
      return head + (overall ? `<div style="font-size:12px;color:var(--text-3);margin:-8px 0 16px;">Client last updated ${esc(overall)}</div>` : '') +
        _cpSection('Music', _cpUpdated(ev, 'music', ev.music), d.hasMusic, music) +
        _cpSection('Vendors', _cpUpdated(ev, 'clientVendors'), d.hasVendors, vendors) +
        _cpSection('Preferences', _cpUpdated(ev, 'clientPrefs', ev.clientPrefs), d.hasPrefs, prefs) +
        _cpSection('Enhancements', _cpUpdated(ev, 'clientEnhancements', ev.clientEnhancements), d.hasEnh, enh) +
        _cpSection('Notes', _cpUpdated(ev, 'clientNotes', ev.clientNotes), d.hasNotes, notes) +
        _cpOnboardingSection(ev);
    }

    // Print-sheet blocks (inline styles only: the print window has its own stylesheet)
    function _cpPrintHtml(ev) {
      const d = _cpData(ev);
      const cell = 'padding:8px 14px;font-size:13px;border-bottom:1px solid #e8e8e8;vertical-align:top;';
      const none = t => `<div style="padding:14px 20px;font-size:13px;color:#999;border-bottom:1px solid #eee;">${t}</div>`;
      let music = '<div class="section-head">Client Music</div>';
      if (!d.hasMusic) music += none('No music entered by the client.');
      else {
        if (d.songs.length) {
          music += `<table><thead><tr><th>Song</th><th>Artist</th><th>Moment</th><th style="width:110px;">Type</th></tr></thead><tbody>${d.songs.map((s, i) => {
            const dnp = String(s.category || '').toLowerCase() === 'do not play';
            return `<tr style="${i % 2 === 0 ? 'background:#f9f9f9;' : ''}"><td style="${cell}font-weight:600;">${esc(s.title || '')}</td><td style="${cell}">${esc(s.artist || '')}</td><td style="${cell}">${esc(s.moment || '')}</td><td style="${cell}font-weight:${dnp ? '700' : '400'};">${esc(s.category || '')}</td></tr>`;
          }).join('')}</tbody></table>`;
        }
        const lines = [];
        if (d.musicDesc) lines.push(`<div><strong>Music direction:</strong> ${_cpText(d.musicDesc)}</div>`);
        if (d.momentSongs.length) lines.push(`<div><strong>Songs by moment:</strong> ${d.momentSongs.map(([k, v]) => esc(k) + ': ' + esc(v)).join(' &middot; ')}</div>`);
        if (d.lists.length) lines.push(`<div><strong>Playlists:</strong> ${d.lists.map(p => { const u = _cpSafeUrl(p.url); return u ? `<a href="${esc(u)}">${esc(p.label || u)}</a>` : esc(p.label || 'Playlist'); }).join(' &middot; ')}</div>`);
        if (d.dnp) lines.push(`<div><strong>Do not play:</strong> ${_cpText(d.dnp)}</div>`);
        if (lines.length) music += `<div style="padding:12px 20px;font-size:13px;line-height:1.7;border-bottom:1px solid #eee;">${lines.join('')}</div>`;
      }
      let vendors = '<div class="section-head">Client Vendors</div>';
      if (!d.hasVendors) vendors += none('No vendors entered by the client.');
      else vendors += `<table><thead><tr><th>Vendor</th><th>Type</th><th>Contact</th><th>Phone</th><th>Email</th><th>Notes</th></tr></thead><tbody>${d.vendors.map((v, i) =>
        `<tr style="${i % 2 === 0 ? 'background:#f9f9f9;' : ''}"><td style="${cell}font-weight:600;">${esc(v.name || '')}</td><td style="${cell}">${esc(v.type || '')}</td><td style="${cell}">${esc(v.contactName || '')}</td><td style="${cell}white-space:nowrap;">${esc(v.phone || '')}</td><td style="${cell}">${esc(v.email || '')}</td><td style="${cell}">${esc(v.notes || '')}</td></tr>`).join('')}</tbody></table>`;
      return { music, vendors };
    }

    const TIMELINE_SUGGESTIONS = {
      wedding:  [['Guests arrive','17:30'],['Ceremony','18:00'],['Cocktail hour','18:45'],['Grand entrance','20:00'],['First dance','20:10'],['Dinner','20:30'],['Toasts','21:15'],['Parent dances','21:30'],['Open dancefloor','21:45'],['Cake cutting','22:30'],['Last song','23:55']],
      gala:     [['Doors open','18:00'],['Cocktail reception','18:15'],['Welcome remarks','19:30'],['Dinner service','19:45'],['Program / awards','20:30'],['Live entertainment','21:15'],['Dancing','21:45'],['Event close','23:00']],
      corporate:[['Registration','17:30'],['Networking','18:00'],['Opening remarks','19:00'],['Keynote / program','19:15'],['Dinner','20:00'],['Entertainment','21:00'],['Close','22:30']],
      mitzvah:  [['Guests arrive','18:00'],['Grand entrance','18:30'],['Hora & candle lighting','19:00'],['Dinner','19:45'],['Games & dancing','20:30'],['Montage','21:30'],['Last song','22:45']],
      quince:   [['Guests arrive','18:30'],['Grand entrance','19:00'],['Waltz','19:15'],['Toast','19:45'],['Dinner','20:00'],['Surprise dance','21:00'],['Open dancefloor','21:30'],['Last song','23:30']],
      default:  [['Guests arrive','18:00'],['Kickoff','19:00'],['Dinner','20:00'],['Peak dancefloor','21:30'],['Last song','23:30']]
    };

    function getProviderTimelineSuggestions(event) {
      const type = (event.type || 'default').toLowerCase();
      const suggestions = TIMELINE_SUGGESTIONS[type] || TIMELINE_SUGGESTIONS.default;
      const existing = new Set((event.timeline || []).map(t => (t.label||'').toLowerCase()));
      return suggestions.filter(([label]) => !existing.has(label.toLowerCase()));
    }

    function addProviderSuggestedMoment(eventId, label, time) {
      saveEventTimeline(eventId); // save current DOM first
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;
      if (!event.timeline) event.timeline = [];
      event.timeline.push({ label, time });
      setDB('events', events);
      window.currentDetailEvent = event;
      const tabEl = document.getElementById('tabTimeline');
      if (tabEl) { tabEl.innerHTML = renderEventTimeline(event); tabEl.classList.add('active'); }
    }

    function addAllProviderSuggestions(eventId) {
      saveEventTimeline(eventId);
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;
      if (!event.timeline) event.timeline = [];
      const toAdd = getProviderTimelineSuggestions(event);
      toAdd.forEach(([label, time]) => event.timeline.push({ label, time }));
      setDB('events', events);
      window.currentDetailEvent = event;
      const tabEl = document.getElementById('tabTimeline');
      if (tabEl) { tabEl.innerHTML = renderEventTimeline(event); tabEl.classList.add('active'); }
    }

    function renderEventTimeline(event) {
      if (!event.timeline) event.timeline = [];
      const suggestions = getProviderTimelineSuggestions(event);
      let html = '<div class="form-group"><label class="form-label">Event Timeline</label>';
      // Suggestion chips
      if (suggestions.length > 0) {
        html += `<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--gray);margin-bottom:8px;">Quick add</div><div style="display:flex;flex-wrap:wrap;gap:6px;">`;
        suggestions.forEach(([label, time]) => {
          html += `<button onclick="addProviderSuggestedMoment('${event.id}','${label.replace(/'/g,"\\'")}','${time}')" style="padding:5px 11px;background:rgba(31,163,224,0.08);border:1px solid rgba(31,163,224,0.65);color:rgba(255,255,255,0.7);border-radius:20px;font-size:12px;cursor:pointer;font-family:'Barlow',sans-serif;">+ ${label} <span style="color:#1FA3E0;">${time}</span></button>`;
        });
        html += `<button onclick="addAllProviderSuggestions('${event.id}')" style="padding:5px 11px;background:rgba(31,163,224,0.15);border:1px solid rgba(31,163,224,0.65);color:#1FA3E0;border-radius:20px;font-size:12px;cursor:pointer;font-weight:600;font-family:'Barlow',sans-serif;">Add all</button>`;
        html += `</div></div>`;
      }
      event.timeline.forEach((entry, idx) => {
        html += `<div class="timeline-row"><input type="time" value="${entry.time}" id="timelineTime${idx}"><input type="text" placeholder="Label/Description" value="${entry.label}" id="timelineLabel${idx}"><button class="btn btn-danger" onclick="removeTimelineEntry('${event.id}', ${idx})">Remove</button></div>`;
      });
      html += `</div><button class="btn btn-secondary" style="margin-bottom: 15px;" onclick="addTimelineEntry('${event.id}')">+ Add Entry</button>`;
      html += `<div style="display: flex; gap: 10px; flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="saveEventTimeline('${event.id}')">Save Timeline</button>
        <button class="btn btn-secondary" onclick="exportTimelinePDF('${event.id}')">Export PDF</button>
        <button class="btn btn-secondary" onclick="printRunOfShow('${event.id}')" style="background:rgba(31,163,224,0.12);border-color:rgba(31,163,224,0.65);color:var(--cyan);font-weight:600;" title="Print a branded Run of Show sheet — great to hand out to vendors at the event">🎧 Print Run of Show</button>
      </div>`;
      return html;
    }

    function addTimelineEntry(eventId) {
      // Save current DOM values before modifying
      saveEventTimeline(eventId);
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (event) {
        if (!event.timeline) event.timeline = [];
        event.timeline.push({ time: '', label: '' });
        setDB('events', events);
        // Re-render only the timeline tab in-place, keep it active
        const tabEl = document.getElementById('tabTimeline');
        if (tabEl) {
          tabEl.innerHTML = renderEventTimeline(event);
          const detailEl = document.getElementById('detailContent');
          (detailEl || document).querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          (detailEl || document).querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
          (detailEl || document).querySelector('.tab-btn[onclick*="timeline"]').classList.add('active');
          tabEl.classList.add('active');
          // Scroll new row into view
          const rows = tabEl.querySelectorAll('.timeline-row');
          if (rows.length) rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        window.currentDetailEvent = event;
      }
    }

    function removeTimelineEntry(eventId, idx) {
      // Save current DOM values before modifying
      saveEventTimeline(eventId);
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event || !event.timeline) return;
      const rerender = () => {
        // Re-render only the timeline tab in-place, keep it active
        const tabEl = document.getElementById('tabTimeline');
        if (tabEl) {
          tabEl.innerHTML = renderEventTimeline(event);
          const detailEl3 = document.getElementById('detailContent');
          (detailEl3 || document).querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          (detailEl3 || document).querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
          (detailEl3 || document).querySelector('.tab-btn[onclick*="timeline"]').classList.add('active');
          tabEl.classList.add('active');
        }
        window.currentDetailEvent = event;
      };
      const removed = event.timeline.splice(idx, 1)[0];
      setDB('events', events);
      rerender();
      showUndoToast('Timeline entry removed', () => {
        event.timeline.splice(idx, 0, removed);
        setDB('events', events);
        rerender();
      });
    }

    function saveEventTimeline(eventId) {
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (event) {
        if (!event.timeline) event.timeline = [];
        event.timeline.forEach((entry, idx) => {
          entry.time = document.getElementById(`timelineTime${idx}`)?.value || '';
          entry.label = document.getElementById(`timelineLabel${idx}`)?.value || '';
        });
        setDB('events', events);
        showToast('Timeline saved', 'success');
      }
    }

    function exportTimelinePDF(eventId) {
      const events = getDB('events');
      const event = events.find(e => e.id === eventId);
      if (!event) return;

      const printContent = `
        <html>
        <head>
          <title>${event.name} Timeline</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: white; color: black; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1FA3E0; padding-bottom: 20px; }
            .header h1 { margin: 0; color: #1FA3E0; }
            .event-info { margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .info-block { padding: 10px; background: #f5f5f5; border-radius: 4px; }
            .info-label { font-weight: bold; color: #333; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #1FA3E0; color: #07070d; font-weight: bold; }
            .services { margin-bottom: 20px; }
            .services h3 { margin-top: 0; }
            .services ul { margin-left: 20px; }
            .footer { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 20px; text-align: center; color: #666; font-size: 12px; }
            body { background: #fff; color: #111; }
          </style>
</head>
        <body>
          <div class="header">
            <h1>Baseline Studio</h1>
            <h2>${event.name}</h2>
          </div>
          <div class="event-info">
            <div class="info-block"><div class="info-label">Date:</div>${event.date}</div>
            <div class="info-block"><div class="info-label">Time:</div>${event.startTime} - ${event.endTime}</div>
            <div class="info-block"><div class="info-label">Venue:</div>${event.venueName}</div>
            <div class="info-block"><div class="info-label">Client:</div>${event.clientName}</div>
          </div>
          <h3>Timeline</h3>
          <table>
            <thead>
              <tr><th>Time</th><th>Event</th></tr>
            </thead>
            <tbody>
              ${event.timeline && event.timeline.length ? event.timeline.map(t => `<tr><td>${t.time}</td><td>${t.label}</td></tr>`).join('') : '<tr><td colspan="2">No timeline entries</td></tr>'}
            </tbody>
          </table>
          <div class="services">
            <h3>Services</h3>
            <ul>
              ${event.services && event.services.length ? event.services.map(s => `<li>${s.category}: ${s.service}${s.subOption ? ' - ' + s.subOption : ''}</li>`).join('') : '<li>No services listed</li>'}
            </ul>
          </div>
          ${event.notes ? `<div><h3>Notes</h3><p>${event.notes}</p></div>` : ''}
          <div class="footer">Prepared by Baseline Studio | (786) 302-6056</div>
        </body>
        </html>
      `;

      const printWindow = window.open('', '', 'height=600,width=800');
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }

    // ─────────────────────────────────────────────────────────────────
    //  RUN OF SHOW — branded printable DJ/vendor sheet
    // ─────────────────────────────────────────────────────────────────
    function printRunOfShow(eventId) {
      // Save current DOM timeline inputs before printing
      saveEventTimeline(eventId);

      const events = getDB('events') || [];
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;

      const sorted = [...(ev.timeline || [])].sort((a, b) => {
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      });

      const fmtTime = (t) => {
        if (!t) return '—';
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
      };

      const fmtDate = ev.date
        ? new Date(ev.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
        : '—';

      // Staff assigned to event
      const staff = getDB('staffroster') || [];
      const assigned = (ev.assignedAccounts || []).map(uid => {
        const s = staff.find(p => p.id === uid);
        return s ? `${s.name} (${s.role || 'Staff'})` : null;
      }).filter(Boolean);

      const timelineRows = sorted.length
        ? sorted.map((entry, i) => `
            <tr style="${i % 2 === 0 ? 'background:#f9f9f9;' : ''}">
              <td style="padding:10px 14px;font-weight:700;font-size:15px;white-space:nowrap;color:#1FA3E0;border-bottom:1px solid #e8e8e8;">${fmtTime(entry.time)}</td>
              <td style="padding:10px 14px;font-size:14px;border-bottom:1px solid #e8e8e8;">${entry.label || ''}</td>
              <td style="padding:10px 14px;font-size:13px;color:#8a8f98;border-bottom:1px solid #e8e8e8;"></td>
            </tr>`).join('')
        : `<tr><td colspan="3" style="padding:16px;text-align:center;color:#999;">No timeline entries yet — save the timeline first.</td></tr>`;

      const services = ev.services?.length
        ? ev.services.map(s => `<span style="display:inline-block;background:#f0f9ff;border:1px solid #c5e5f6;color:#1565a9;border-radius:4px;padding:3px 10px;margin:3px;font-size:12px;">${s.category}: ${s.service}${s.subOption?' — '+s.subOption:''}</span>`).join('')
        : '<span style="color:#aaa;font-size:13px;">No services listed</span>';

      const _cp = _cpPrintHtml(ev); // client music + vendors (P0.4)
      const w = window.open('', '_blank', 'width=900,height=900,menubar=yes');
      w.document.write(`<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <title>Run of Show — ${ev.name}</title>
        <style>
          * { box-sizing:border-box; margin:0; padding:0; }
          body { font-family: Arial, Helvetica, sans-serif; background: #f4f4f4; }
          .print-bar { background:#111118; color:#fff; padding:12px 24px; display:flex; align-items:center; justify-content:space-between; font-size:13px; }
          .print-bar button { background:#1FA3E0; color:#07070d; border:none; padding:7px 18px; border-radius:5px; cursor:pointer; font-weight:600; font-size:13px; }
          .page { max-width:780px; margin:30px auto; background:#fff; border-radius:6px; overflow:hidden; box-shadow:0 4px 30px rgba(0,0,0,.12); }
          .top-bar { background:#111118; padding:26px 32px; display:flex; align-items:center; justify-content:space-between; }
          .top-bar .brand { font-size:22px; font-weight:900; color:#1FA3E0; letter-spacing:.08em; }
          .top-bar .doc-label { font-size:11px; color:rgba(255,255,255,.5); letter-spacing:.12em; text-transform:uppercase; margin-top:3px; }
          .top-bar .event-name { font-size:18px; font-weight:700; color:#fff; text-align:right; }
          .top-bar .event-date-sub { font-size:12px; color:#1FA3E0; text-align:right; margin-top:3px; }
          .info-strip { display:grid; grid-template-columns:repeat(4,1fr); background:#f7f7f7; border-bottom:1px solid #eee; }
          .info-cell { padding:14px 18px; border-right:1px solid #eee; }
          .info-cell:last-child { border-right:none; }
          .info-cell .lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#666; margin-bottom:4px; }
          .info-cell .val { font-size:14px; font-weight:600; color:#111; }
          .section-head { padding:12px 20px; background:#1FA3E0; color:#07070d; font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
          table { width:100%; border-collapse:collapse; }
          thead tr th { background:#1b1b2f; color:#fff; padding:10px 14px; font-size:11px; letter-spacing:.07em; text-transform:uppercase; text-align:left; }
          .services-area { padding:16px 20px; border-bottom:1px solid #eee; }
          .notes-area { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:20px; }
          .notes-box { border:1px solid #ddd; border-radius:4px; padding:14px; min-height:100px; }
          .notes-box .lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#666; margin-bottom:8px; }
          .signature-strip { background:#f7f7f7; border-top:2px solid #1FA3E0; padding:16px 20px; display:flex; justify-content:space-between; align-items:flex-end; }
          .sig-block { flex:1; padding:0 20px; text-align:center; }
          .sig-line { border-bottom:1px solid #aaa; height:40px; margin-bottom:6px; }
          .sig-label { font-size:12px; color:#666; }
          .footer-bar { background:#111118; color:rgba(255,255,255,0.55); font-size:12px; padding:10px 24px; display:flex; justify-content:space-between; }
          @media print { .print-bar { display:none!important; } body { background:white; } .page { box-shadow:none; margin:0; max-width:100%; border-radius:0; } }
        </style>
      </head><body>
        <div class="print-bar">
          <span>🎧 Run of Show — <strong>${ev.name}</strong></span>
          <button onclick="window.print()">🖨 Print / Save PDF</button>
        </div>
        <div class="page">
          <div class="top-bar">
            <div>
              <div class="brand">BASELINE STUDIO</div>
              <div class="doc-label">Run of Show</div>
            </div>
            <div>
              <div class="event-name">${ev.name}</div>
              <div class="event-date-sub">${fmtDate}</div>
            </div>
          </div>

          <div class="info-strip">
            <div class="info-cell">
              <div class="lbl">Venue</div>
              <div class="val">${ev.venueName || '—'}</div>
            </div>
            <div class="info-cell">
              <div class="lbl">Client</div>
              <div class="val">${ev.clientName || '—'}</div>
            </div>
            <div class="info-cell">
              <div class="lbl">Start / End</div>
              <div class="val">${ev.startTime || '—'} – ${ev.endTime || '—'}</div>
            </div>
            <div class="info-cell">
              <div class="lbl">Staff / DJ</div>
              <div class="val">${assigned.length ? assigned.join(', ') : 'See team notes'}</div>
            </div>
          </div>

          <div class="services-area">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:8px;">Services</div>
            ${services}
          </div>

          <div class="section-head">Event Timeline</div>
          <table>
            <thead>
              <tr>
                <th style="width:120px;">Time</th>
                <th>Item / Description</th>
                <th style="width:200px;">Notes for DJ/MC</th>
              </tr>
            </thead>
            <tbody>${timelineRows}</tbody>
          </table>

          ${_cp.music}
          ${_cp.vendors}

          <div class="notes-area">
            <div class="notes-box">
              <div class="lbl">Music Notes / Special Requests</div>
              <div style="font-size:13px;color:#6b7078;line-height:1.6;">${esc(ev.notes || '').replace(/\n/g,'<br>') || '<span style="color:#666;">—</span>'}</div>
            </div>
            <div class="notes-box">
              <div class="lbl">DJ/MC Instructions</div>
              <div style="font-size:13px;color:#6b7078;">&nbsp;</div>
            </div>
          </div>

          <div class="signature-strip">
            <div class="sig-block">
              <div class="sig-line"></div>
              <div class="sig-label">DJ / MC Signature</div>
            </div>
            <div class="sig-block">
              <div class="sig-line"></div>
              <div class="sig-label">Client Approval</div>
            </div>
            <div class="sig-block">
              <div class="sig-line"></div>
              <div class="sig-label">Date</div>
            </div>
          </div>

          <div class="footer-bar">
            <span>Baseline Studio · (786) 302-6056 · Hello@baselinestudiofl.com</span>
            <span>Prepared for: ${ev.clientName || ev.name} · Confidential</span>
          </div>
        </div>
      </body></html>`);
      w.document.close();
    }
