/* Lead source capture.
   Records how a visitor arrived so every inquiry says where it came from.
   - First touch: kept 30 days in localStorage (people often visit, leave, come back).
   - This visit: kept in sessionStorage (where they landed today).
   Only the referring site's hostname and the page path are stored, never full
   URLs or search terms. If storage is blocked, everything degrades silently and
   the forms still submit. */
(function () {
  var FIRST = 'bs_first_touch';
  var VISIT = 'bs_visit_touch';
  var TTL = 30 * 24 * 60 * 60 * 1000;

  function read(store, key) {
    try { return JSON.parse(store.getItem(key)) || null; } catch (e) { return null; }
  }
  function write(store, key, val) {
    try { store.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function channel(refHost, q) {
    var src = (q.get('utm_source') || '').toLowerCase();
    var med = (q.get('utm_medium') || '').toLowerCase();
    if (q.get('gclid') || q.get('gbraid') || q.get('wbraid')) return 'Google Ads';
    if (src) return src + (med ? ' / ' + med : '');
    if (!refHost) return 'Direct (typed URL, bookmark, text message or app)';
    var h = refHost.replace(/^www\./, '');
    if (/gemini\.google\.com|bard\.google\.com/.test(h)) return 'Gemini';
    if (/(^|\.)google\./.test(h)) return 'Google Search';
    if (/chatgpt\.com|openai\.com/.test(h)) return 'ChatGPT';
    if (/perplexity\.ai/.test(h)) return 'Perplexity';
    if (/claude\.ai/.test(h)) return 'Claude';
    if (/copilot\.microsoft\.com/.test(h)) return 'Copilot';
    if (/bing\.com|duckduckgo\.com|yahoo\./.test(h)) return 'Other search (' + h + ')';
    if (/instagram\.com/.test(h)) return 'Instagram';
    if (/facebook\.com|fb\.com|messenger\.com/.test(h)) return 'Facebook';
    if (/tiktok\.com/.test(h)) return 'TikTok';
    if (/theknot\.com|weddingwire\.com/.test(h)) return 'The Knot / WeddingWire';
    return 'Referral (' + h + ')';
  }

  var q = new URLSearchParams(location.search);
  var here = location.hostname.replace(/^www\./, '');
  var refHost = '';
  try { if (document.referrer) refHost = new URL(document.referrer).hostname; } catch (e) {}
  var internal = refHost.replace(/^www\./, '') === here;
  var campaign = !!(q.get('utm_source') || q.get('gclid') || q.get('gbraid') || q.get('wbraid'));
  var now = Date.now();

  var touch = {
    channel: channel(internal ? '' : refHost, q),
    landing: location.pathname,
    date: new Date(now).toISOString().slice(0, 10),
    t: now
  };

  // This visit: set on the first page of the session, or when a tagged link brings them back.
  if (!read(sessionStorage, VISIT) || (campaign && !internal)) write(sessionStorage, VISIT, touch);

  // First touch: keep the original arrival for 30 days.
  var first = read(localStorage, FIRST);
  if (!first || now - (first.t || 0) > TTL) write(localStorage, FIRST, touch);

  // Called by the inquiry forms. Returns a short block appended to the message.
  window.bsLeadSource = function () {
    var v = read(sessionStorage, VISIT) || touch;
    var f = read(localStorage, FIRST);
    var out = '\n\n---\nHow they found us: ' + v.channel +
              '\nLanded on: ' + v.landing +
              '\nSubmitted from: ' + location.pathname;
    if (f && f.date !== v.date) {
      out += '\nFirst visit: ' + f.date + ' via ' + f.channel + ', landed on ' + f.landing;
    }
    return out;
  };
})();
