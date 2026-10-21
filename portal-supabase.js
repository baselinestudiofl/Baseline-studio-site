/**
 * portal-supabase.js — Baseline Studio Portal Data Layer
 * v14 (+1C client magic links) — clients can sign in with an emailed link (Supabase Auth OTP). Their session holds a JWT (authMode 'magic'); every client call goes to the authenticated twin RPC (*_jwt) with no email or password in the request. completeMagicLink() consumes the redirect hash. The password session path is unchanged and stays for the 30 day fallback.
 * v13 (+0D staff access) — provider data is read and written under ownerId (org_members lookup at initProvider; own uid when master / no membership / lookup fails).
 * v13 — client signDocument (RPC client_sign_document), refreshClientEvent, client save payload whitelisted (no money/identity fields), provider alert via send-email internal_client_update (old form-service call removed), client RPCs no longer return portalPassword.
 * v12 — sendEmail returns {ok,id}|{ok:false,error,detail} on every status; createProviderUser uses the signed-in JWT and no longer sends email.
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

  // Whose provider_data rows this login works on: the org owner's for a staff member, own uid otherwise.
  dataOwnerId() {
    return (_session && (_session.owner_id || _session.user_id)) || null;
  },

  // Resolves the owner at provider login. RLS on org_members lets a member read their own row.
  // Any failure (table not created yet, network, no row) falls back to own uid, which is the
  // behaviour before org_members existed, so shipping this JS before the SQL is safe.
  async resolveOwnerId() {
    const uid = _session && _session.user_id;
    if (!uid) return null;
    const url = `${SUPABASE_URL}/rest/v1/org_members?select=org_owner_id&member_id=eq.${encodeURIComponent(uid)}&active=eq.true&limit=1`;
    try {
      let r = await fetch(url, { headers: this.headers() });
      if (r && r.status === 401 && await _refreshToken()) r = await fetch(url, { headers: this.headers() });
      if (!r || !r.ok) {
        console.warn('[ownerId] org_members lookup failed (' + (r && r.status) + '); using own user id');
        delete _session.owner_id; _saveSession(_session);
        return uid;
      }
      const rows = await r.json();
      const owner = Array.isArray(rows) && rows[0] && rows[0].org_owner_id;
      if (owner && owner !== uid) { _session.owner_id = owner; } else { delete _session.owner_id; }
      _saveSession(_session);
      return owner && owner !== uid ? owner : uid;
    } catch (e) {
      console.warn('[ownerId] org_members lookup error; using own user id', e);
      delete _session.owner_id; _saveSession(_session);
      return uid;
    }
  },

  async loadAll() {
    const owner = this.dataOwnerId();
    const ownerFilter = owner ? `&user_id=eq.${encodeURIComponent(owner)}` : '';
    const r = await fetch(`${SUPABASE_URL}/rest/v1/provider_data?select=data_key,data_value${ownerFilter}`, { headers: this.headers() });
    if (!r.ok) return {};
    const rows = await r.json();
    const out = {};
    rows.forEach(row => { out[row.data_key] = row.data_value; });
    return out;
  },

  // skipRetry=true prevents infinite loops when called from _flushRetryQueue
  async upsert(key, value, skipRetry) {
    const uid = this.dataOwnerId();
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
      body: JSON.stringify({ p_email: email.toLowerCase(), p_password: password, p_event_data: _clientSavePayload(eventData) })
    });
    if (!r.ok) { console.warn('[updateClientEvent] failed', r.status); return false; }
    return true;
  },

  // ── Magic-link (JWT) twins. No email, no password in the request: the server reads the
  //    caller's email from the Auth token. One retry after a token refresh on 401.
  async clientRpcJwt(name, body, extra) {
    const mk = () => Object.assign({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + _token },
      body: JSON.stringify(body || {})
    }, extra || {});
    const url = `${SUPABASE_URL}/rest/v1/rpc/${name}`;
    let r = await fetch(url, mk());
    if (r && r.status === 401) {
      if (await _refreshToken()) r = await fetch(url, mk());
      if (r && r.status === 401) _showClientLinkExpiredBanner();
    }
    return r;
  },

  async getAllClientEventsJwt() {
    const r = await this.clientRpcJwt('get_all_client_events_jwt', {});
    if (!r || !r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) && data.length ? data : null;
  },

  async updateClientEventJwt(eventData) {
    const r = await this.clientRpcJwt('update_client_event_jwt', { p_event_data: _clientSavePayload(eventData) });
    if (!r || !r.ok) { console.warn('[updateClientEventJwt] failed', r && r.status); return false; }
    return (await r.json()) === true;
  }
};

// ── Client session helpers (password OR magic link) ────────────────────────────
function _isMagicClient() {
  return !!(_session && _session.type === 'client' && _session.authMode === 'magic' && _token);
}
function _clientReady() {
  return !!(_session && _session.type === 'client' && _session.email && (_isMagicClient() || _session.portalPw));
}
function _showClientLinkExpiredBanner() {
  if (!document.body || document.getElementById('bs-expired-banner')) return;
  const b = document.createElement('div');
  b.id = 'bs-expired-banner';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(220,53,69,0.95);color:#fff;font-family:Barlow,system-ui,sans-serif;font-size:14px;font-weight:500;padding:14px 20px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap';
  b.innerHTML = '<span>Your sign-in timed out. Ask for a new link to keep saving. Your changes are safe on this device.</span><a href="login.html?role=client" style="color:#fff;font-weight:700;text-decoration:underline;">Get a new link</a>';
  document.body.insertBefore(b, document.body.firstChild);
}
function _b64urlJson(seg) {
  try {
    let t = String(seg).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return JSON.parse(decodeURIComponent(escape(atob(t))));
  } catch (e) { return null; }
}
// Event to open first after a magic-link sign-in: the next upcoming one, else the most recent.
function _pickDefaultClientEvent(list) {
  const d = e => String(e.date || e.eventDate || '');
  const today = new Date().toISOString().slice(0, 10);
  const dated = list.filter(e => d(e));
  const upcoming = dated.filter(e => d(e) >= today).sort((a, b) => d(a).localeCompare(d(b)));
  if (upcoming.length) return upcoming[0];
  const past = dated.sort((a, b) => d(b).localeCompare(d(a)));
  return past[0] || list[0];
}

// ── Client save payload ────────────────────────────────────────────────────────
// update_client_event only accepts these fields. Everything else (money, names, dates, venue,
// documents, signatures, password, invoices) belongs to the provider and is never sent.
const CLIENT_WRITABLE_FIELDS = [
  'clientEnhancements', 'clientPrefs', 'clientVendors', 'timeline', 'messages',
  'music', 'clientMusic', 'clientPlaylists', 'doNotPlay', 'clientNotes',
  'clientOnboarding', 'onboardingComplete'
];
const CLIENT_NEVER_SEND = [
  'depositPaid', 'balancePaid', 'basePrice', 'depositAmount', 'portalPassword', 'invoices',
  'documents', 'docs', 'name', 'date', 'type', 'venue', 'venueName', 'venueAddress',
  'clientName', 'clientPhone'
];
function _clientSavePayload(ev) {
  const src = ev || {};
  const out = { id: src.id };
  CLIENT_WRITABLE_FIELDS.forEach(k => { if (src[k] !== undefined) out[k] = src[k]; });
  CLIENT_NEVER_SEND.forEach(k => { delete out[k]; });
  return out;
}

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
    if ((s.type === 'provider' || s.authMode === 'magic') && s.refresh_token) _startRefreshTimer();
  } else if (s.type === 'client' && s.event) {
    // Password client sessions have no access_token (credential-based, not JWT)
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

  if (!_token || (_session && _session.type === 'client')) return; // not logged in as provider (a client magic-link token never writes provider_data) — skip cloud write

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

// ── Provider alert on client changes ───────────────────────────────────────────
// Baseline of the five watched fields as of load or the last successful save.
let _notifyBaseline = null;
let _alertLastAt = 0, _alertPending = null, _alertTimer = null;
const ALERT_MIN_GAP_MS = 5 * 60 * 1000;   // at most one alert email per 5 minutes per tab

function _setNotifyBaseline(ev) {
  if (!ev) { _notifyBaseline = null; return; }
  try {
    _notifyBaseline = JSON.parse(JSON.stringify({
      clientVendors: ev.clientVendors, timeline: ev.timeline, clientPrefs: ev.clientPrefs,
      clientEnhancements: ev.clientEnhancements, messages: ev.messages
    }));
  } catch (e) { _notifyBaseline = null; }
}

function _alertSummary(ev, fields) {
  const parts = [];
  if (fields.includes('vendors') && Array.isArray(ev.clientVendors)) parts.push('Vendors on file: ' + ev.clientVendors.length + '.');
  if (fields.includes('timeline') && Array.isArray(ev.timeline)) parts.push('Timeline items: ' + ev.timeline.length + '.');
  if (fields.includes('preferences') && ev.clientPrefs && ev.clientPrefs.vibe) parts.push('Vibe: ' + ev.clientPrefs.vibe + '.');
  if (fields.includes('message') && Array.isArray(ev.messages)) {
    const last = ev.messages.filter(m => m && m.from === 'client').pop();
    if (last && last.text) parts.push('Latest message: "' + String(last.text).slice(0, 300) + '"');
  }
  return parts.join(' ');
}

function _sendProviderAlert(p) {
  // sendEmail never throws; a failed alert must never affect the client's save.
  return window.BSPortal.sendEmail('internal_client_update', {
    eventId: p.eventId, eventName: p.eventName, clientName: p.clientName,
    changed: p.changed, summary: p.summary
  });
}

function _queueProviderAlert(ev, fields) {
  const merged = _alertPending ? Array.from(new Set(_alertPending.changed.concat(fields))) : fields;
  _alertPending = {
    eventId: ev.id || '', eventName: ev.name || ev.title || '',
    clientName: ev.clientName || (_session && _session.name) || (_session && _session.email) || 'Client',
    changed: merged, summary: _alertSummary(ev, merged)
  };
  const wait = _alertLastAt + ALERT_MIN_GAP_MS - Date.now();
  if (wait <= 0 && !_alertTimer) {
    const p = _alertPending; _alertPending = null; _alertLastAt = Date.now();
    _sendProviderAlert(p);
  } else if (!_alertTimer) {
    _alertTimer = setTimeout(() => {
      _alertTimer = null;
      if (!_alertPending) return;
      const p = _alertPending; _alertPending = null; _alertLastAt = Date.now();
      _sendProviderAlert(p);
    }, Math.max(wait, 1000));
  }
}

// ── BSPortal public API ────────────────────────────────────────────────────────
window.BSPortal = {

  getCurrentUser() {
    return _session ? {
      id:         _session.user_id || _session.eventId || '',
      userId:     _session.user_id || _session.eventId || '',
      ownerId:    _session.owner_id || _session.user_id || null,
      role:       _session.role || 'master',
      name:       _session.name || '',
      email:      _session.email || '',
      eventId:    _session.eventId || null,
      authMode:   _session.type === 'client' ? (_session.authMode === 'magic' ? 'magic' : 'password') : null,
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

  // True when the page was opened from a Supabase Auth email link (tokens or an error in the URL hash).
  hasMagicLinkHash() {
    try {
      const h = (window.location && window.location.hash) || '';
      return /(^|[#&])(access_token|error_code|error)=/.test(h);
    } catch (e) { return false; }
  },

  // Finishes a magic-link sign-in on the redirect back. Parses the tokens from the URL hash, wipes the
  // hash, confirms the user with Auth, loads the client's events through the JWT twin, and stores a
  // client session like the provider one (access + refresh token, authMode 'magic').
  // Returns {ok:true, event} or {ok:false, error, message}. Nothing here sends a password.
  async completeMagicLink() {
    const fail = (error, message) => ({ ok: false, error, message });
    const hash = ((window.location && window.location.hash) || '').replace(/^#/, '');
    const p = new URLSearchParams(hash);
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
    if (p.get('error') || p.get('error_code')) {
      const code = p.get('error_code') || p.get('error');
      return fail(code, code === 'otp_expired'
        ? 'That link expired or was already used. Ask for a new one and it will come right over.'
        : 'That link did not work. Ask for a new one and try again.');
    }
    const access = p.get('access_token'), refresh = p.get('refresh_token');
    if (!access || p.get('type') === 'recovery') return fail('invalid_link', 'That link did not work. Ask for a new one and try again.');
    try {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + access } });
      if (!ur || !ur.ok) return fail('invalid_link', 'That link did not work. Ask for a new one and try again.');
      const user = await ur.json();
      const email = String((user && user.email) || (_b64urlJson(access.split('.')[1]) || {}).email || '').toLowerCase();
      if (!email) return fail('invalid_link', 'That link did not work. Ask for a new one and try again.');

      _token = access; window._sbToken = access;
      _session = { type: 'client', authMode: 'magic', role: 'client-private', email, name: email,
                   user_id: user && user.id, access_token: access, refresh_token: refresh || null };
      let list = await SB.getAllClientEventsJwt();
      if (!list) {
        _token = null; window._sbToken = null; _session = null; sessionStorage.removeItem('bs_sb_session');
        return fail('no_events', 'We could not find an event for that email. Check which address you gave us, or call (786) 302-6056.');
      }
      const event = _pickDefaultClientEvent(list);
      _session.role = event.type === 'corporate' ? 'client-corporate' : 'client-private';
      _session.name = event.clientName || email;
      _session.eventId = event.id; _session.event = event; _session.allEvents = list;
      _saveSession(_session);
      _startRefreshTimer();
      return { ok: true, event };
    } catch (e) {
      _token = null; window._sbToken = null; _session = null;
      try { sessionStorage.removeItem('bs_sb_session'); } catch (e2) {}
      return fail('network', 'We could not reach the server. Check your connection and try the link again.');
    }
  },

  getAuthMode() {
    return _session && _session.type === 'client' ? (_session.authMode === 'magic' ? 'magic' : 'password') : null;
  },

  async initProvider() {
    if (!_token || !_session || _session.type !== 'provider') { window.location.href = 'login.html'; return false; }
    if (_session.role && _session.role.startsWith('client-')) { window.location.href = 'portal-client.html'; return false; }
    await SB.resolveOwnerId();
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
    _setNotifyBaseline(_session.event);
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
    _setNotifyBaseline(ev);
    return ev;
  },

  // Force an immediate sync from Supabase — callable from the portal
  syncNow() { return _syncFromServer(); },

  async saveClientEvent(eventData) {
    if (!_clientReady()) {
      console.warn('[saveClientEvent] no client session'); return false;
    }
    // The page edits _session.event in place, so the previous state comes from the baseline
    // captured at load and after each successful save, not from _session.event.
    const prev = _notifyBaseline || {};
    const vendorsDiff       = JSON.stringify(eventData.clientVendors)      !== JSON.stringify(prev.clientVendors);
    const timelineDiff      = JSON.stringify(eventData.timeline)           !== JSON.stringify(prev.timeline);
    const prefsDiff         = JSON.stringify(eventData.clientPrefs)        !== JSON.stringify(prev.clientPrefs);
    const enhancementsDiff  = JSON.stringify(eventData.clientEnhancements) !== JSON.stringify(prev.clientEnhancements);
    const messagesDiff      = JSON.stringify(eventData.messages)           !== JSON.stringify(prev.messages);
    const changed = vendorsDiff || timelineDiff || prefsDiff || enhancementsDiff || messagesDiff;
    _session.event = Object.assign({}, _session.event, eventData);
    _saveSession(_session);
    const ok = _isMagicClient()
      ? await SB.updateClientEventJwt(eventData)
      : await SB.updateClientEvent(_session.email, _session.portalPw, eventData);
    if (ok) {
      _setNotifyBaseline(eventData);
      if (changed) {
        // Provider notification preferences live on the event (provider Settings page).
        // Default is OFF: the provider must explicitly enable it.
        const ns = eventData.providerNotify || {};
        if (ns.enabled === true) {
          const fields = [
            vendorsDiff      && (ns.vendors  !== false) && 'vendors',
            timelineDiff     && (ns.timeline !== false) && 'timeline',
            prefsDiff        && (ns.prefs    !== false) && 'preferences',
            enhancementsDiff && (ns.vendors  !== false) && 'enhancements',
            messagesDiff     && (ns.messages !== false) && 'message'
          ].filter(Boolean);
          if (fields.length) _queueProviderAlert(eventData, fields);
        }
      }
    }
    return ok;
  },

  // Same save, built for page unload: keepalive fetch, session credentials, whitelisted payload.
  saveClientEventOnUnload(eventData) {
    if (!_clientReady() || !eventData) return false;
    try {
      if (_isMagicClient()) {
        fetch(`${SUPABASE_URL}/rest/v1/rpc/update_client_event_jwt`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + _token },
          body: JSON.stringify({ p_event_data: _clientSavePayload(eventData) })
        }).catch(() => {});
        return true;
      }
      fetch(`${SUPABASE_URL}/rest/v1/rpc/update_client_event`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ p_email: _session.email.toLowerCase(), p_password: _session.portalPw, p_event_data: _clientSavePayload(eventData) })
      }).catch(() => {});
      return true;
    } catch (e) { return false; }
  },

  // Client e-sign. Calls RPC client_sign_document with the session email and the password the
  // client logged in with. Returns {ok:true, signedAt} or {ok:false, error, message}.
  // The RPC answers {ok:false,...} for every refusal (already_signed, consent_required, ...).
  async signDocument(eventId, docId, signaturePng, signedName, consentVersion) {
    if (!_clientReady()) {
      return { ok: false, error: 'not_authorized', message: 'Your session ended. Sign in again and try once more.' };
    }
    try {
      const r = _isMagicClient()
        ? await SB.clientRpcJwt('client_sign_document_jwt', {
            p_event_id: eventId,
            p_doc_id: docId,
            p_signature_png: signaturePng,
            p_signed_name: signedName,
            p_consent_version: consentVersion
          })
        : await fetch(`${SUPABASE_URL}/rest/v1/rpc/client_sign_document`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
            body: JSON.stringify({
              p_email: _session.email.toLowerCase(),
              p_password: _session.portalPw,
              p_event_id: eventId,
              p_doc_id: docId,
              p_signature_png: signaturePng,
              p_signed_name: signedName,
              p_consent_version: consentVersion
            })
          });
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      if (data && data.ok === true) return { ok: true, signedAt: data.signedAt || null };
      if (data && data.ok === false) {
        return { ok: false, error: data.error || 'unknown', message: data.message || 'That signature did not go through. Try again, or call us at (786) 302-6056.' };
      }
      return { ok: false, error: 'http_' + r.status, message: 'We could not save your signature. Check your connection and try again.' };
    } catch (e) {
      return { ok: false, error: 'network', message: 'We could not reach the server. Check your connection and try again.' };
    }
  },

  // Re-fetch the signed-in client's current event from the server and refresh it in place.
  // Pass the page's live event object: server values win, except the fields the client edits,
  // which keep the live copy so unsaved typing is not lost. Updates that object (and the
  // session copy) and returns it, or null if the fetch failed.
  async refreshClientEvent(liveEvent) {
    if (!_clientReady()) return null;
    try {
      const target = liveEvent || _session.event || {};
      const wantId = target.id || _session.eventId;
      let list = _isMagicClient() ? await SB.getAllClientEventsJwt() : await SB.getAllClientEvents(_session.email, _session.portalPw);
      let fresh = list ? list.find(e => e.id === wantId) : null;
      if (!fresh && !_isMagicClient()) {
        const one = await SB.getClientEvent(_session.email, _session.portalPw);
        if (one && one.id === wantId) fresh = one;
      }
      if (!fresh) return null;
      const merged = Object.assign({}, fresh);
      CLIENT_WRITABLE_FIELDS.forEach(k => { if (target[k] !== undefined) merged[k] = target[k]; });
      Object.keys(merged).forEach(k => { target[k] = merged[k]; });
      _session.event = target;
      const base = list || _session.allEvents || [];
      _session.allEvents = base.map(e => e.id === wantId ? target : e);
      _saveSession(_session);
      return target;
    } catch (e) { return null; }
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
      const r = _isMagicClient()
        ? await SB.clientRpcJwt('client_search_vendors_jwt', { p_query: query })
        : await fetch(`${SUPABASE_URL}/rest/v1/rpc/client_search_vendors`, {
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
    if (_isMagicClient()) { SB.clientRpcJwt('client_add_vendor_jwt', { p_vendor: vendorObj }).catch(() => {}); return; }
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
    // Creates / updates the Supabase auth user via the invite-provider edge function.
    // Authenticated with the signed-in user's JWT (master role required server-side), NOT the anon key.
    // Does NOT send the invite email; callers send provider_invite themselves and report that result separately.
    if (!_token) return { ok: false, error: 'Not signed in. Sign in again and retry.' };
    try {
      const r = await fetch(INVITE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${_token}` },
        body: JSON.stringify({ email, password, name, role })
      });
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      if (!data) return { ok: false, error: 'HTTP ' + r.status };
      if (!r.ok || data.ok === false || data.error) {
        return { ok: false, error: data.error || data.message || data.msg || ('HTTP ' + r.status), detail: data.detail };
      }
      return { ok: true, userId: data.userId };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },

  async sendEmail(type, payload) {
    try {
      const r = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
        body: JSON.stringify({ type, ...payload })
      });
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      if (!data) { console.warn('[sendEmail] non-JSON response, status', r.status); return { ok: false, error: 'HTTP ' + r.status }; }
      if (!r.ok || data.ok === false || data.error) {
        console.warn('[sendEmail] error:', data);
        return { ok: false, error: data.error || ('HTTP ' + r.status), detail: data.detail };
      }
      return { ok: true, id: data.id };
    } catch (e) { console.warn('[sendEmail] network error:', e); return { ok: false, error: String(e) }; }
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
    const wasClient = !!(_session && _session.type === 'client');
    sessionStorage.removeItem('bs_sb_session');
    _session = null; _token = null;
    window.location.href = wasClient ? 'login.html?role=client' : 'login.html';
  }
};

// ── A5: beforeunload guard — warn if unsaved writes are queued ─────────────────
window.addEventListener('beforeunload', e => {
  if (_retryQueue.length > 0) { e.preventDefault(); e.returnValue = ''; }
});

// ── Promise used by provider portal ────────────────────────────────────────────
window._sbDataReady = null;
