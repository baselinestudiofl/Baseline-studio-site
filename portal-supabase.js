/**
 * portal-supabase.js — Baseline Studio Portal Data Layer
 * v2 — bulletproof saving: token refresh, retry queue, localStorage backup,
 *       pre-load write queue, save-status pill, beforeunload guard.
 */

const SUPABASE_URL  = 'https://jkdhkwcxnwpiufeyrnso.supabase.co';
const SUPABASE_ANON = 'sb_publishable_6xcEpHwIJi8bq4XuSyLCGg_3A30raS9';
const EDGE_FN_URL   = `${SUPABASE_URL}/functions/v1/send-email`;
const INVITE_FN_URL = `${SUPABASE_URL}/functions/v1/invite-provider`;

// ── In-memory cache ────────────────────────────────────────────────────────────
window.DB = {};

// ── Private state ──────────────────────────────────────────────────────────────
let _token        = null;   // current JWT
let _session      = null;   // full session object
let _ready        = false;  // true after initProvider() resolves
let _writeQueue   = [];     // writes that arrived before _ready
let _retryQueue   = [];     // failed writes waiting for retry
let _retrying     = false;  // retry loop running
let _refreshTimer = null;   // setInterval handle

// ── A1: Token refresh ──────────────────────────────────────────────────────────
async function _refreshToken() {
  const s = _loadSession();
  if (!s || !s.refresh_token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) return false;
    const data = await r.json();
    if (!data.access_token) return false;
    _token = data.access_token;
    window._sbToken = _token;
    _session = Object.assign({}, _session, {
      access_token:  data.access_token,
      refresh_token: data.refresh_token || s.refresh_token
    });
    _saveSession(_session);
    return true;
  } catch { return false; }
}

function _startRefreshTimer() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => _refreshToken(), 45 * 60 * 1000);
}

// ── A2: Save-status pill ───────────────────────────────────────────────────────
let _pillEl = null;
let _pillTimeout = null;

function _setSaveStatus(state) {
  if (!document.body) return;
  if (!_pillEl) {
    _pillEl = document.createElement('div');
    _pillEl.id = 'bs-save-pill';
    _pillEl.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:500;font-family:Barlow,system-ui,sans-serif;letter-spacing:0.02em;transition:opacity 0.3s,transform 0.3s;pointer-events:none;opacity:0;transform:translateY(8px)';
    document.body.appendChild(_pillEl);
  }
  clearTimeout(_pillTimeout);
  if (state === 'saving') {
    _pillEl.textContent = 'Saving…';
    _pillEl.style.cssText += ';background:rgba(31,163,224,0.15);border:1px solid rgba(31,163,224,0.3);color:#1FA3E0;opacity:1;transform:translateY(0)';
  } else if (state === 'saved') {
    _pillEl.textContent = 'Saved';
    _pillEl.style.cssText += ';background:rgba(31,163,224,0.12);border:1px solid rgba(31,163,224,0.25);color:#1FA3E0;opacity:1;transform:translateY(0)';
    _pillTimeout = setTimeout(() => {
      if (_pillEl) { _pillEl.style.opacity = '0'; _pillEl.style.transform = 'translateY(8px)'; }
    }, 2000);
  } else if (state === 'error') {
    _pillEl.textContent = 'Not saved — retrying';
    _pillEl.style.cssText += ';background:rgba(220,53,69,0.12);border:1px solid rgba(220,53,69,0.3);color:#ff6b6b;opacity:1;transform:translateY(0)';
    _showRetryBanner();
  }
}

function _showRetryBanner() {
  if (document.getElementById('bs-retry-banner')) return;
  const b = document.createElement('div');
  b.id = 'bs-retry-banner';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:rgba(220,53,69,0.12);border-bottom:1px solid rgba(220,53,69,0.3);color:#ff6b6b;font-family:Barlow,system-ui,sans-serif;font-size:13px;padding:10px 20px;display:flex;align-items:center;justify-content:space-between';
  b.innerHTML = '<span>Some changes didn\'t make it to the cloud. Your work is safe locally.</span><button id="bs-retry-btn" style="background:#dc3545;color:#fff;border:none;border-radius:4px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600;margin-left:16px;">Retry now</button>';
  document.body.insertBefore(b, document.body.firstChild);
  document.getElementById('bs-retry-btn').addEventListener('click', () => _flushRetryQueue(true));
}

function _hideRetryBanner() {
  const b = document.getElementById('bs-retry-banner');
  if (b) b.remove();
}

function _showSessionExpiredBanner() {
  if (document.getElementById('bs-expired-banner')) return;
  const b = document.createElement('div');
  b.id = 'bs-expired-banner';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(220,53,69,0.95);color:#fff;font-family:Barlow,system-ui,sans-serif;font-size:14px;font-weight:500;padding:14px 20px;display:flex;align-items:center;justify-content:center;gap:16px';
  b.innerHTML = '<span>Your session expired. Log back in to keep saving — your local changes are safe.</span><a href="login.html" style="color:#fff;font-weight:700;text-decoration:underline;">Log in</a>';
  document.body.insertBefore(b, document.body.firstChild);
}

// ── Retry queue ────────────────────────────────────────────────────────────────
async function _flushRetryQueue(immediate) {
  if (_retrying || !_retryQueue.length) return;
  _retrying = true;
  const delays = immediate ? [0] : [2000, 6000, 15000];
  for (const delay of delays) {
    if (!_retryQueue.length) break;
    if (delay) await new Promise(res => setTimeout(res, delay));
    const batch = _retryQueue.slice(); _retryQueue = [];
    for (const { key, value } of batch) {
      const ok = await SB.upsert(key, value, true);
      if (!ok) _retryQueue.push({ key, value });
    }
  }
  _retrying = false;
  if (_retryQueue.length === 0) { _setSaveStatus('saved'); _hideRetryBanner(); }
}

// ── REST helpers ───────────────────────────────────────────────────────────────
const SB = {
  headers(extra) {
    const h = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON };
    if (_token) h['Authorization'] = 'Bearer ' + _token;
    return Object.assign(h, extra || {});
  },

  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ email, password })
    });
    return r.json();
  },

  async signOut() {
    if (!_token) return;
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: this.headers() }).catch(() => {});
    _token = null;
  },

  async loadAll() {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/provider_data?select=data_key,data_value`, { headers: this.headers() });
    if (!r.ok) return {};
    const rows = await r.json();
    const out = {};
    rows.forEach(row => { out[row.data_key] = row.data_value; });
    return out;
  },

  // skipRetry=true prevents infinite loops when called from _flushRetryQueue
  async upsert(key, value, skipRetry) {
    const uid = _session && _session.user_id;
    const payload = { data_key: key, data_value: value };
    if (uid) payload.user_id = uid;
    const opts = {
      method: 'POST',
      headers: this.headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(payload)
    };
    let r = await fetch(`${SUPABASE_URL}/rest/v1/provider_data?on_conflict=user_id,data_key`, opts).catch(() => null);

    // A1: 401 → try token refresh once, then retry
    if (r && r.status === 401 && !skipRetry) {
      const refreshed = await _refreshToken();
      if (refreshed) {
        opts.headers = this.headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        r = await fetch(`${SUPABASE_URL}/rest/v1/provider_data?on_conflict=user_id,data_key`, opts).catch(() => null);
      } else {
        _showSessionExpiredBanner();
        return false;
      }
    }
    return !!(r && r.ok);
  },

  async createAuthUser(email, password, name, role) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ email, password, data: { name, role } })
    });
    const data = await r.json();
    if (!r.ok || !data.id) return { error: data.message || data.msg || data.error_description || JSON.stringify(data) };
    return { ok: true, user: data };
  },

  async getClientEvent(email, password) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_client_event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ p_email: email.toLowerCase(), p_password: password })
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data || null;
  },

  // Returns ALL events for this client's email+password — powers the multi-event switcher.
  // Requires the get_all_client_events RPC to be created in Supabase (see SQL block in docs).
  // Falls back gracefully to single-event if the RPC doesn't exist yet.
  async getAllClientEvents(email, password) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_all_client_events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ p_email: email.toLowerCase(), p_password: password })
    });
    if (!r.ok) return null; // RPC not yet created — caller will fall back to single event
    const data = await r.json();
    return Array.isArray(data) && data.length ? data : null;
  },

  async updateClientEvent(email, password, eventData) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_client_event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ p_email: email.toLowerCase(), p_password: password, p_event_data: eventData })
    });
    if (!r.ok) { console.warn('[updateClientEvent] failed', r.status); return false; }
    return true;
  }
};

// ── Session helpers ────────────────────────────────────────────────────────────
function _saveSession(s) { sessionStorage.setItem('bs_sb_session', JSON.stringify(s)); }
function _loadSession() { try { return JSON.parse(sessionStorage.getItem('bs_sb_session')); } catch { return null; } }

// Restore on page load
(function _restoreToken() {
  const s = _loadSession();
  if (!s) return;
  if (s.access_token) {
    // Provider session — restore JWT and start refresh timer
    _token = s.access_token; window._sbToken = s.access_token; _session = s;
    if (s.type === 'provider' && s.refresh_token) _startRefreshTimer();
  } else if (s.type === 'client' && s.event) {
    // Client sessions have no access_token (credential-based, not JWT)
    // Still need to restore _session so initClient() can return the event
    _session = s;
  }
})();

// ── A3: localStorage backup recovery ──────────────────────────────────────────
// Two cases handled silently — no banner, no user action needed:
//   1. Supabase missing a key but localStorage has it → push localStorage up to Supabase
//      (covers failed saves, offline sessions, etc.)
//   2. Both have data → Supabase wins; sync localStorage to match
function _checkLocalBackup(serverData) {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('bs_backup_'));
  if (!keys.length) return;
  for (const lsKey of keys) {
    const k = lsKey.slice('bs_backup_'.length);
    try {
      const stored = JSON.parse(localStorage.getItem(lsKey));
      if (!stored || stored.data === undefined) continue;
      if (serverData[k] === undefined) {
        // Supabase has nothing for this key — recover from localStorage silently
        window.DB[k] = stored.data;
        SB.upsert(k, stored.data);
        localStorage.setItem(lsKey, JSON.stringify({ data: stored.data, ts: Date.now() }));
      } else {
        // Both have data — Supabase is truth; update localStorage to match
        localStorage.setItem(lsKey, JSON.stringify({ data: serverData[k], ts: Date.now() }));
      }
    } catch {}
  }
}

// ── Live sync: pull from server, update window.DB, fire event if anything changed ──
let _syncInFlight = false;
async function _syncFromServer() {
  if (!_session || !_session.user_id || _syncInFlight) return;
  _syncInFlight = true;
  try {
    const fresh = await SB.loadAll();
    let changed = false;
    for (const [k, v] of Object.entries(fresh)) {
      if (JSON.stringify(window.DB[k]) !== JSON.stringify(v)) {
        window.DB[k] = v;
        try { localStorage.setItem('bs_backup_' + k, JSON.stringify({ data: v, ts: Date.now() })); } catch {}
        changed = true;
      }
    }
    if (changed) document.dispatchEvent(new CustomEvent('bs:data-synced'));
  } catch {}
  _syncInFlight = false;
}

let _syncInterval = null;
function _startLiveSync() {
  if (_syncInterval) clearInterval(_syncInterval);
  // Poll Supabase every 30s — catches changes from other tabs/devices
  // Tab-focus sync is handled separately by portal-provider.html's visibilitychange handler
  _syncInterval = setInterval(_syncFromServer, 30000);
}

// ── DB wrappers ────────────────────────────────────────────────────────────────
window.getDB = function getDB(key) {
  const k = key.startsWith('bs_') ? key.slice(3) : key;
  const val = window.DB[k];
  if (val === undefined) return [];
  return Array.isArray(val) ? val : val;
};

window.setDB = function setDB(key, data) {
  const k = key.startsWith('bs_') ? key.slice(3) : key;
  window.DB[k] = data;

  // A3: always mirror to localStorage as safety net
  try { localStorage.setItem('bs_backup_' + k, JSON.stringify({ data, ts: Date.now() })); } catch {}

  if (!_token) return; // not logged in as provider — skip cloud write

  if (!_ready) {
    // A4: queue writes that arrive before initProvider resolves
    _writeQueue.push({ key: k, value: data });
    return;
  }

  _setSaveStatus('saving');
  SB.upsert(k, data).then(ok => {
    if (ok) {
      _setSaveStatus('saved');
    } else {
      _retryQueue.push({ key: k, value: data });
      _setSaveStatus('error');
      _flushRetryQueue(false);
    }
  }).catch(() => {
    _retryQueue.push({ key: k, value: data });
    _setSaveStatus('error');
    _flushRetryQueue(false);
  });
};

// ── BSPortal public API ────────────────────────────────────────────────────────
window.BSPortal = {

  getCurrentUser() {
    return _session ? {
      id:         _session.user_id || _session.eventId || '',
      userId:     _session.user_id || _session.eventId || '',
      role:       _session.role || 'master',
      name:       _session.name || '',
      email:      _session.email || '',
      eventId:    _session.eventId || null,
      profilePic: _session.profilePic || null
    } : null;
  },

  updateProfilePic(url) {
    if (_session) { _session.profilePic = url; _saveSession(_session); }
  },

  // Called after client successfully changes their own password via RPC
  _updateSessionPw(newPassword) {
    if (_session && _session.type === 'client') {
      _session.portalPw = newPassword;
      if (_session.event) _session.event.portalPassword = newPassword;
      if (_session.allEvents) _session.allEvents.forEach(ev => { ev.portalPassword = newPassword; });
      _saveSession(_session);
    }
  },

  async signInProvider(email, password) {
    const data = await SB.signIn(email, password);
    if (data.error || !data.access_token) return { error: data.error || 'Invalid credentials' };
    _token = data.access_token;
    window._sbToken = _token;
    _session = {
      type:          'provider',
      access_token:  data.access_token,
      refresh_token: data.refresh_token || null,   // A1: store refresh token
      user_id:       data.user.id,
      email:         data.user.email,
      name:          data.user.user_metadata?.name || email.split('@')[0],
      role:          data.user.user_metadata?.role || 'master'
    };
    _saveSession(_session);
    _startRefreshTimer(); // A1: start 45-min refresh cycle
    return { ok: true };
  },

  async signInClient(email, password) {
    // Verify credentials by fetching one event first
    const event = await SB.getClientEvent(email, password);
    if (!event) return { error: 'Email or portal password not found.' };

    // Try to fetch ALL events for this client (repeat client support).
    // Falls back to single event if get_all_client_events RPC isn't deployed yet.
    let allEvents = await SB.getAllClientEvents(email, password);
    if (!allEvents) allEvents = [event];

    const role = event.type === 'corporate' ? 'client-corporate' : 'client-private';
    _session = {
      type:      'client',
      role,
      email,
      portalPw:  password,
      name:      event.clientName || email,
      eventId:   event.id,
      event,
      allEvents
    };
    _saveSession(_session);
    return { ok: true, event };
  },

  async initProvider() {
    if (!_token || !_session || _session.type !== 'provider') { window.location.href = 'login.html'; return false; }
    if (_session.role && _session.role.startsWith('client-')) { window.location.href = 'portal-client.html'; return false; }
    const data = await SB.loadAll();
    window.DB = data;
    _ready = true;
    window._sbToken = _token;

    // A3: offer restore if local backup differs from server
    _checkLocalBackup(data);

    // A3b: after backup check, sync localStorage to server for all keys that now match.
    // This prevents false-positive "restore" banners on future loads caused by
    // format differences (ordering, type coercion) rather than genuine unsaved changes.
    for (const [k, v] of Object.entries(data)) {
      const lsKey = 'bs_backup_' + k;
      try {
        const stored = localStorage.getItem(lsKey);
        if (!stored || JSON.stringify(JSON.parse(stored).data) !== JSON.stringify(v)) {
          localStorage.setItem(lsKey, JSON.stringify({ data: v, ts: Date.now() }));
        }
      } catch {}
    }

    // A4: flush writes that queued before we were ready
    for (const { key, value } of _writeQueue) SB.upsert(key, value);
    _writeQueue = [];

    // A5: start live sync — poll every 30s + on tab focus
    _startLiveSync();

    return true;
  },

  initClient() {
    if (!_session || _session.type !== 'client' || !_session.event) { window.location.href = 'login.html?role=client'; return null; }
    if (!_session.allEvents || !_session.allEvents.length) { _session.allEvents = [_session.event]; _saveSession(_session); }
    return _session.event;
  },

  getClientAllEvents() {
    if (!_session) return [];
    return _session.allEvents || (_session.event ? [_session.event] : []);
  },

  switchClientEvent(eventId) {
    if (!_session || !_session.allEvents) return false;
    const ev = _session.allEvents.find(e => e.id === eventId);
    if (!ev) return false;
    _session.event   = ev;
    _session.eventId = ev.id;
    _session.role    = ev.type === 'corporate' ? 'client-corporate' : 'client-private';
    _saveSession(_session);
    return ev;
  },

  // Force an immediate sync from Supabase — callable from the portal
  syncNow() { return _syncFromServer(); },

  async saveClientEvent(eventData) {
    if (!_session || _session.type !== 'client' || !_session.email || !_session.portalPw) {
      console.warn('[saveClientEvent] no client session'); return false;
    }
    const prev = _session.event || {};
    const vendorsDiff       = JSON.stringify(eventData.clientVendors)      !== JSON.stringify(prev.clientVendors);
    const timelineDiff      = JSON.stringify(eventData.timeline)           !== JSON.stringify(prev.timeline);
    const prefsDiff         = JSON.stringify(eventData.clientPrefs)        !== JSON.stringify(prev.clientPrefs);
    const enhancementsDiff  = JSON.stringify(eventData.clientEnhancements) !== JSON.stringify(prev.clientEnhancements);
    const messagesDiff      = JSON.stringify(eventData.messages)           !== JSON.stringify(prev.messages);
    const changed = vendorsDiff || timelineDiff || prefsDiff || enhancementsDiff || messagesDiff;
    _session.event = Object.assign({}, _session.event, eventData);
    _saveSession(_session);
    const ok = await SB.updateClientEvent(_session.email, _session.portalPw, eventData);
    if (ok && changed) {
      // Check provider notification preferences stored on the event.
      // Default is OFF — provider must explicitly enable via Settings page.
      const ns = eventData.providerNotify || {};
      const notifyEnabled = ns.enabled === true;
      if (notifyEnabled) {
        const what = [
          vendorsDiff      && (ns.vendors  !== false) && 'vendors',
          timelineDiff     && (ns.timeline !== false) && 'timeline',
          prefsDiff        && (ns.prefs    !== false) && 'preferences',
          enhancementsDiff && (ns.vendors  !== false) && 'enhancements',
          messagesDiff     && (ns.messages !== false) && 'message'
        ].filter(Boolean).join(', ');
        if (what) {
          fetch('https://api.web3forms.com/submit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_key: '8eb161bf-d25e-41f4-8111-e5ea9a8a200e',
              subject: 'Portal update — ' + (eventData.name || _session.name || 'Client'),
              message: 'A client updated their portal.\n\nEvent: ' + (eventData.name || '') + '\nClient: ' + _session.email + '\nChanged: ' + what
            })
          }).catch(() => {});
        }
      }
    }
    return ok;
  },

  // Push provider notification settings into a specific client's event in Supabase.
  // Called from the provider Settings page — uses the client's own credentials.
  async pushNotifySettingsToEvent(email, password, notifySettings) {
    if (!email || !password) return false;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_client_event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ p_email: email.toLowerCase(), p_password: password })
      });
      if (!r.ok) return false;
      const eventData = await r.json();
      if (!eventData) return false;
      eventData.providerNotify = notifySettings;
      return await SB.updateClientEvent(email, password, eventData);
    } catch { return false; }
  },

  async searchVendors(query) {
    if (!_session || _session.type !== 'client' || !query || query.length < 2) return [];
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/client_search_vendors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ p_email: _session.email, p_password: _session.portalPw, p_query: query })
      });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },

  addVendorToLibrary(vendorObj) {
    if (!_session || _session.type !== 'client') return;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/client_add_vendor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ p_email: _session.email, p_password: _session.portalPw, p_vendor: vendorObj })
    }).catch(() => {});
  },

  async resetPassword(email) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ email: email.toLowerCase(), redirect_to: 'https://www.baselinestudiofl.com/reset-password.html' })
    });
    return { ok: r.ok };
  },

  async updatePassword(accessToken, newPassword) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify({ password: newPassword })
    });
    const data = await r.json();
    if (!r.ok) return { error: data.message || data.msg || 'Could not update password.' };
    return { ok: true };
  },

  async createProviderUser(email, password, name, role) {
    // Step 1: Create / update the Supabase auth user via invite-provider edge function.
    // This function uses the service role key (set as a secret in the dashboard by Saul).
    // Account creation succeeds even if the follow-up email fails.
    let accountResult = { error: 'invite-provider function not deployed' };
    try {
      const r = await fetch(INVITE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
        body: JSON.stringify({ email, password, name, role })
      });
      accountResult = await r.json();
    } catch (e) {
      accountResult = { error: String(e) };
    }

    // Step 2: Send invitation email — non-blocking; email failure does NOT affect account creation.
    this.sendEmail('provider_invite', { email, password, name, role }).catch(() => {});

    return accountResult;
  },

  async sendEmail(type, payload) {
    try {
      const r = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
        body: JSON.stringify({ type, ...payload })
      });
      const data = await r.json();
      if (!r.ok) { console.warn('[sendEmail] error:', data); return { error: data.error || 'Email failed' }; }
      return { ok: true };
    } catch (e) { console.warn('[sendEmail] network error:', e); return { error: String(e) }; }
  },

  // Re-fetch all provider data from Supabase and refresh window.DB
  // Call after visibilitychange to catch updates from other tabs/devices
  async reloadDB() {
    if (!_token || !_session || _session.type !== 'provider') return false;
    try {
      const data = await SB.loadAll();
      window.DB = data;
      return true;
    } catch { return false; }
  },

  async logout() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    _writeQueue = []; _retryQueue = [];
    await SB.signOut();
    sessionStorage.removeItem('bs_sb_session');
    _session = null; _token = null;
    window.location.href = 'login.html';
  }
};

// ── A5: beforeunload guard — warn if unsaved writes are queued ─────────────────
window.addEventListener('beforeunload', e => {
  if (_retryQueue.length > 0) { e.preventDefault(); e.returnValue = ''; }
});

// ── Promise used by provider portal ────────────────────────────────────────────
window._sbDataReady = null;
