/* crm-ui.js v1 : window.CRMUI for the Baseline Studio CRM (provider, client, login, employee pages).
 * Classic script, one IIFE, one global (window.CRMUI). Needs crm-icons.js loaded first for CRMUI.icon().
 * Pairs with crm-tokens.css + crm-ui.css. No network, no storage except an optional recent-searches list.
 * API reference: _DEV/crm-v2/ui-notes/F.md
 */
(function (root) {
  'use strict';

  var DOC = typeof document !== 'undefined' ? document : null;
  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function warn() { if (typeof console !== 'undefined' && console.warn) console.warn.apply(console, arguments); }
  function mk(tag, cls, html) {
    var e = DOC.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function reduced() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function coarse() {
    try { return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
  }
  var _uid = 0;
  function uid(p) { _uid += 1; return (p || 'crm') + '-' + _uid; }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function visible(e) { return !!(e.offsetWidth || e.offsetHeight || (e.getClientRects && e.getClientRects().length)); }
  function focusables(scope) {
    return Array.prototype.slice.call(scope.querySelectorAll(FOCUSABLE)).filter(visible);
  }
  function isThenable(x) { return x && typeof x.then === 'function'; }

  /* ------------------------------------------------------------------ icon */
  function icon(name, size) {
    size = size || 20;
    var set = root.CRMUI_ICONS || {};
    var d = set[name];
    if (!d) {
      warn('CRMUI.icon: unknown icon "' + name + '", using "circle"');
      d = set.circle || '<circle cx="12" cy="12" r="10"/>';
    }
    return '<svg class="i i-' + size + '" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' + d + '</svg>';
  }

  /* ------------------------------------------------------------------ formatters */
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MO_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function parseISO(s) {
    if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s == null ? '' : s));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);   /* local date, no UTC shift */
    if (s == null || s === '') return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function group3(str) { return str.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var fmt = {
    /* money(x) takes DOLLARS (number or numeric string). money(x, {cents:true}) takes integer cents. Always 2 decimals. */
    money: function (v, o) {
      if (v == null || v === '') return '';
      var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      if (!isFinite(n)) return '';
      var isCents = o === true || o === 'cents' || (o && o.cents === true);
      var c = isCents ? Math.round(n) : Math.round(n * 100);
      var neg = c < 0; c = Math.abs(c);
      var dollars = Math.floor(c / 100), cents = c % 100;
      return (neg ? '-' : '') + '$' + group3(String(dollars)) + '.' + pad2(cents);
    },
    /* phone('+13055550142' | any 10 or 11 digit string) -> "(305) 555-0142". Anything else comes back unchanged. */
    phone: function (v) {
      if (v == null) return '';
      var s = String(v).trim();
      var digits = s.replace(/\D/g, '');
      if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
      if (digits.length === 10 && !(/^\+(?!1)/.test(s))) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
      return s;
    },
    /* date(iso, 'list'|'long'|'short'|'full'): list "Fri, Oct 23", long "Fri, Oct 23, 2026", short "Oct 23", full "Friday, October 23, 2026" */
    date: function (v, style) {
      var d = parseISO(v);
      if (!d) return '';
      var base = MO[d.getMonth()] + ' ' + d.getDate();
      switch (style || 'list') {
        case 'short': return base;
        case 'long': return WD[d.getDay()] + ', ' + base + ', ' + d.getFullYear();
        case 'full': return WD_FULL[d.getDay()] + ', ' + MO_FULL[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
        default: return WD[d.getDay()] + ', ' + base;
      }
    },
    /* time('18:00') -> "6:00 PM". Unparseable input comes back unchanged. */
    time: function (v) {
      var m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(v == null ? '' : v));
      if (!m) return v == null ? '' : String(v);
      var h = +m[1], mi = +m[2];
      if (h > 23 || mi > 59) return String(v);
      var ap = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12; if (h12 === 0) h12 = 12;
      return h12 + ':' + pad2(mi) + ' ' + ap;
    },
    int: function (v) {
      var n = typeof v === 'number' ? v : parseFloat(v);
      if (!isFinite(n)) return '';
      var r = Math.round(n);
      return (r < 0 ? '-' : '') + group3(String(Math.abs(r)));
    },
    /* invoiceNo(42) -> "0042" */
    invoiceNo: function (v) {
      var s = String(v == null ? '' : v).replace(/\D/g, '');
      if (!s) return '';
      while (s.length < 4) s = '0' + s;
      return s;
    }
  };

  /* ------------------------------------------------------------------ Postel normalizers */
  function res(ok, value, echo, message, extra) {
    var r = { ok: ok, value: value, echo: echo || '', message: message || '' };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
    return r;
  }
  function emptyRes() { return res(true, null, '', ''); }
  function fold(s) {
    var v = String(s == null ? '' : s);
    if (v.normalize) { try { v = v.normalize('NFD').replace(/\p{M}/gu, ''); } catch (e) { v = v.normalize('NFD').replace(/[̀-ͯ]/g, ''); } }
    return v.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function nPhone(s) {
    var raw = String(s == null ? '' : s).trim();
    if (!raw) return emptyRes();
    var ext = '';
    var em = /\s*(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i.exec(raw);
    if (em) { ext = em[1]; raw = raw.slice(0, em.index); }
    var digits = raw.replace(/\D/g, '');
    var plus = /^\s*\+/.test(raw);
    if (plus && digits.charAt(0) !== '1') {
      if (digits.length >= 8 && digits.length <= 15) return res(true, '+' + digits, '+' + digits, '', { ext: ext });
      return res(false, null, '', 'International numbers need 8 to 15 digits. Found ' + digits.length + '.');
    }
    var d = digits;
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if (d.length !== 10) {
      var hint = d.length === 7 ? ' Add the area code.' : '';
      return res(false, null, '', 'Phone numbers need 10 digits. Found ' + digits.length + '.' + hint);
    }
    return res(true, '+1' + d, fmt.phone(d), '', { ext: ext });
  }

  function nMoney(s, o) {
    o = o || {};
    var raw = typeof s === 'number' ? String(s) : String(s == null ? '' : s);
    raw = raw.replace(/usd|us dollars?|dollars?|bucks/gi, '').replace(/[$\s ]/g, '');
    if (!raw) return emptyRes();
    var neg = false;
    if (/^\(.*\)$/.test(raw)) { neg = true; raw = raw.slice(1, -1); }
    if (/^[-−]/.test(raw)) { neg = true; raw = raw.slice(1); }
    if (!/^[0-9.,]+$/.test(raw)) return res(false, null, '', 'Use numbers only, like 2,100 or 2100.50.');
    var hasC = raw.indexOf(',') >= 0, hasD = raw.indexOf('.') >= 0;
    if (hasC && hasD) {
      var decSep = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.';
      var thouSep = decSep === ',' ? '.' : ',';
      raw = raw.split(thouSep).join('');
      if (decSep === ',') raw = raw.replace(',', '.');
    } else if (hasC) {
      if (/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g, '');
      else if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.');
      else if (/^[\d,]+$/.test(raw) && raw.split(',').length > 1 && raw.split(',').slice(1).every(function (g) { return g.length === 3; })) raw = raw.replace(/,/g, '');
      else return res(false, null, '', 'That amount has commas in odd places. Try 2,100 or 2100.50.');
    } else if (hasD) {
      var dots = raw.split('.').length - 1;
      if (dots > 1) {
        if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, '');
        else return res(false, null, '', 'That amount has more than one decimal point.');
      }
    }
    var parts = raw.split('.');
    var ip = parts[0] || '0', fp = parts[1] || '';
    if (!/^\d+$/.test(ip) || (fp && !/^\d+$/.test(fp))) return res(false, null, '', 'Use numbers only, like 2,100 or 2100.50.');
    if (ip.replace(/^0+/, '').length > 9) return res(false, null, '', 'That amount looks too large.');
    var f3 = (fp + '000').slice(0, 3);
    var cents = parseInt(ip, 10) * 100 + parseInt(f3.slice(0, 2), 10) + (parseInt(f3.charAt(2), 10) >= 5 ? 1 : 0);
    if (neg && cents !== 0) {
      if (!o.allowNegative) return res(false, null, '', 'Enter an amount of $0 or more.');
      cents = -cents;
    }
    return res(true, cents, fmt.money(cents, { cents: true }), '');
  }

  function nTime(s, o) {
    o = o || {};
    var assume = o.assume || 'pm';
    var raw = String(s == null ? '' : s).toLowerCase().trim();
    if (!raw) return emptyRes();
    raw = raw.replace(/\s+/g, ' ').replace(/\b([ap])\.?\s?m\.?/g, '$1m').replace(/(\d)\.(\d)/g, '$1:$2');
    if (/^(12 )?noon$/.test(raw)) return res(true, '12:00', fmt.time('12:00'), '');
    if (/^(12 )?midnight$/.test(raw)) return res(true, '00:00', fmt.time('00:00'), '');
    var m = /^(\d{1,4})(?::(\d{1,2}))?\s*([ap]m?)?$/.exec(raw);
    if (!m) return res(false, null, '', 'Try a time like 6 PM, 6:30 PM or 18:30.');
    var h, mi, military = false, colon = m[2] != null;
    if (colon) { h = parseInt(m[1], 10); mi = parseInt(m[2].length === 1 ? m[2] + '0' : m[2], 10); military = m[1].length === 2 && m[1].charAt(0) === '0'; }
    else if (m[1].length <= 2) { h = parseInt(m[1], 10); mi = 0; }
    else if (m[1].length === 3) { h = parseInt(m[1].charAt(0), 10); mi = parseInt(m[1].slice(1), 10); }
    else { h = parseInt(m[1].slice(0, 2), 10); mi = parseInt(m[1].slice(2), 10); military = true; }
    var suffix = m[3] ? m[3].charAt(0) : '';
    if (mi > 59) return res(false, null, '', 'Minutes go from 00 to 59.');
    var assumed = false;
    if (suffix) {
      if (h < 1 || h > 12) return res(false, null, '', 'With AM or PM the hour goes from 1 to 12.');
      if (suffix === 'a') h = h === 12 ? 0 : h; else h = h === 12 ? 12 : h + 12;
    } else if (military || h === 0 || h >= 13) {
      if (h > 23) return res(false, null, '', 'Hours go from 0 to 23.');
    } else if (h >= 1 && h <= 11) {
      assumed = true;
      if (assume !== 'am') h += 12;
    }
    var value = pad2(h) + ':' + pad2(mi);
    return res(true, value, fmt.time(value), assumed ? 'Read as ' + fmt.time(value) + '.' : '');
  }

  var DOMAIN_FIX = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'gmil.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmaill.com': 'gmail.com',
    'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhoo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
    'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com',
    'aol.con': 'aol.com'
  };
  function nEmail(s) {
    var raw = String(s == null ? '' : s).trim();
    if (!raw) return emptyRes();
    var ang = /<([^<>]+)>/.exec(raw);
    if (ang) raw = ang[1];
    raw = raw.replace(/^mailto:/i, '').replace(/^["'<\s]+|["'>\s]+$/g, '').replace(/[.,;:]+$/, '').trim();
    if (!raw) return res(false, null, '', 'Enter an email address like name@example.com.');
    if (/\s/.test(raw)) return res(false, null, '', 'Email addresses cannot contain spaces.');
    var at = raw.indexOf('@');
    if (at < 0) return res(false, null, '', 'That email is missing an @.');
    if (raw.indexOf('@', at + 1) >= 0) return res(false, null, '', 'That email has more than one @.');
    var local = raw.slice(0, at), domain = raw.slice(at + 1).toLowerCase();
    if (!local) return res(false, null, '', 'Add the part before the @.');
    if (!/^[^\s@.][^\s@]*\.[^\s@.]{2,}$/.test(domain) || /\.\./.test(domain) || /\.$/.test(domain)) return res(false, null, '', 'That email needs a domain like example.com after the @.');
    var value = (local + '@' + domain).toLowerCase();
    var fix = DOMAIN_FIX[domain];
    if (!fix) {
      var tm = /^(.*)\.(con|cmo|comm|vom|xom)$/.exec(domain);
      if (tm) fix = tm[1] + '.com';
    }
    if (fix) {
      var suggestion = local.toLowerCase() + '@' + fix;
      return res(true, value, value, 'Did you mean ' + suggestion + '?', { suggestion: suggestion });
    }
    return res(true, value, value, '');
  }

  function dateObj(y, m, d) {
    var dt = new Date(y, m - 1, d);
    return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? dt : null;
  }
  function monthFromWord(w) {
    w = w.toLowerCase().replace(/\.$/, '');
    if (w.length < 3) return 0;
    for (var i = 0; i < 12; i++) if (MO_FULL[i].toLowerCase().indexOf(w) === 0) return i + 1;
    return 0;
  }
  function weekdayFromWord(w) {
    w = w.toLowerCase();
    if (w.length < 3) return -1;
    for (var i = 0; i < 7; i++) if (WD_FULL[i].toLowerCase().indexOf(w) === 0) return i;
    if (w === 'thur' || w === 'thurs') return 4;
    if (w === 'tues') return 2;
    return -1;
  }
  function todayOf(o) {
    var t = o && o.today ? parseISO(o.today) : null;
    t = t || new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function nDate(s, o) {
    o = o || {};
    var raw = String(s == null ? '' : s).toLowerCase().trim();
    if (!raw) return emptyRes();
    var today = todayOf(o);
    var cleaned = raw.replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/^on /, '').trim();
    var y, mo, d, m, dt = null, note = '';

    function addDays(n) { return new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); }

    if (cleaned === 'today' || cleaned === 'tonight') dt = today;
    else if (cleaned === 'tomorrow' || cleaned === 'tmrw' || cleaned === 'tmr') dt = addDays(1);
    else if (cleaned === 'yesterday') dt = addDays(-1);
    else if ((m = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(cleaned))) dt = addDays(parseInt(m[1], 10) * (m[2].charAt(0) === 'w' ? 7 : 1));
    else if ((m = /^(?:(next|this|coming) )?([a-z]{3,9})$/.exec(cleaned)) && weekdayFromWord(m[2]) >= 0) {
      var wd = weekdayFromWord(m[2]);
      var delta = (wd - today.getDay() + 7) % 7;
      if (m[1] === 'next' && delta === 0) delta = 7;
      dt = addDays(delta);
    } else {
      var yearGiven = true;
      if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(cleaned))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if ((m = /^(\d{1,2})[-\/.](\d{1,2})(?:[-\/.](\d{2}|\d{4}))?$/.exec(cleaned))) {
        var a = +m[1], b = +m[2];
        mo = a; d = b;
        if (a > 12 && b <= 12) { mo = b; d = a; note = 'Read as day first because ' + a + ' is not a month.'; }
        if (m[3]) y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : +m[3]; else yearGiven = false;
      } else if ((m = /^(\d{8})$/.exec(cleaned))) {
        if (/^(19|20)\d{2}/.test(m[1]) && +m[1].slice(4, 6) <= 12 && +m[1].slice(0, 2) > 12) { y = +m[1].slice(0, 4); mo = +m[1].slice(4, 6); d = +m[1].slice(6, 8); }
        else { mo = +m[1].slice(0, 2); d = +m[1].slice(2, 4); y = +m[1].slice(4, 8); }
      } else if ((m = /^(\d{6})$/.exec(cleaned))) { mo = +m[1].slice(0, 2); d = +m[1].slice(2, 4); y = 2000 + parseInt(m[1].slice(4, 6), 10); }
      else if ((m = /^(\d{4})$/.exec(cleaned))) { mo = +m[1].slice(0, 2); d = +m[1].slice(2, 4); yearGiven = false; }
      else if ((m = /^([a-z]{3,9})\.? ?(\d{1,2})(?: (\d{2}|\d{4}))?$/.exec(cleaned)) && monthFromWord(m[1])) {
        mo = monthFromWord(m[1]); d = +m[2];
        if (m[3]) y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : +m[3]; else yearGiven = false;
      } else if ((m = /^(\d{1,2}) ([a-z]{3,9})\.?(?: (\d{2}|\d{4}))?$/.exec(cleaned)) && monthFromWord(m[2])) {
        d = +m[1]; mo = monthFromWord(m[2]);
        if (m[3]) y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : +m[3]; else yearGiven = false;
      } else {
        return res(false, null, '', 'Try a date like 10/24, Oct 24 or Oct 24 2026.');
      }
      if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return res(false, null, '', 'That date does not exist. Try 10/24 or Oct 24.');
      if (!yearGiven) {
        y = today.getFullYear();
        var cand = dateObj(y, mo, d);
        if (cand && cand.getTime() < today.getTime()) y += 1;
        if (mo === 2 && d === 29) { while (!dateObj(y, mo, d) && y < today.getFullYear() + 8) y += 1; }
      }
      dt = dateObj(y, mo, d);
      if (!dt) return res(false, null, '', 'That date does not exist. Check the day and month.');
    }
    var value = toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    var past = dt.getTime() < today.getTime();
    var message = note;
    if (o.warnPast && past) message = 'That date has already passed.';
    return res(true, value, fmt.date(value, 'long'), message, past && o.warnPast ? { warn: true } : null);
  }

  /* search(): the plan says each normalizer returns {ok,value,echo,message}, and also that search "strips accents and
   * lowercases" so callers can use it as a string. This returns a String object that is both: String(x), x.includes(),
   * x + '' and x.length work, and x.value / x.echo / x.ok / x.message exist. For a primitive use norm.fold(s). */
  function nSearch(s) {
    var v = fold(s);
    var o = new String(v);
    o.ok = true; o.value = v; o.echo = v; o.message = '';
    return o;
  }

  var norm = { date: nDate, time: nTime, phone: nPhone, money: nMoney, email: nEmail, search: nSearch, fold: fold };

  /* ------------------------------------------------------------------ toasts */
  var toasts = [];
  function toastBox() {
    var c = DOC.getElementById('toastContainer');
    if (!c) { c = mk('div', 'toast-container'); c.id = 'toastContainer'; DOC.body.appendChild(c); }
    if (!c.getAttribute('aria-live')) c.setAttribute('aria-live', 'polite');
    if (!c.getAttribute('role')) c.setAttribute('role', 'region');
    if (!c.getAttribute('aria-label')) c.setAttribute('aria-label', 'Notifications');
    return c;
  }
  var TOAST_ICON = { info: 'info', success: 'circle-check', error: 'circle-alert', warning: 'triangle-alert' };
  function toastCore(msg, type, ms, undoFn) {
    if (!DOC) return null;
    type = TOAST_ICON[type] ? type : 'info';
    var box = toastBox();
    if (ms == null) ms = undoFn ? 8000 : type === 'error' ? 8000 : type === 'warning' ? 6000 : 4000;
    var text = String(msg == null ? '' : msg);
    /* same message already showing: refresh it instead of stacking a copy */
    for (var i = 0; i < toasts.length; i++) {
      if (toasts[i].text === text && toasts[i].type === type && !undoFn && !toasts[i].undo) { toasts[i].arm(ms); return toasts[i].handle; }
    }
    var el = mk('div', 'toast toast-' + type);
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var ic = mk('span', 'toast-icon', icon(TOAST_ICON[type], 20));
    var tx = mk('span', 'toast-msg'); tx.textContent = text;
    el.appendChild(ic); el.appendChild(tx);
    var t = { el: el, text: text, type: type, undo: !!undoFn, timer: null, left: ms, started: 0, gone: false };
    if (undoFn) {
      var ub = mk('button', 'toast-undo'); ub.type = 'button'; ub.textContent = 'Undo';
      ub.addEventListener('click', function () {
        if (t.gone) return;
        dismiss();
        try { undoFn(); } catch (e) { warn('CRMUI.undoToast onUndo threw', e); }
      });
      el.appendChild(ub);
    }
    function clear() { if (t.timer) { clearTimeout(t.timer); t.timer = null; } }
    function start(left) {
      clear(); t.left = left; t.started = Date.now();
      if (left > 0) t.timer = setTimeout(dismiss, left);
    }
    function dismiss() {
      if (t.gone) return; t.gone = true; clear();
      var idx = toasts.indexOf(t); if (idx >= 0) toasts.splice(idx, 1);
      if (reduced() || !el.parentNode) { if (el.parentNode) el.parentNode.removeChild(el); return; }
      el.classList.add('is-leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180);
    }
    el.addEventListener('mouseenter', function () { if (t.timer) { t.left = Math.max(1500, t.left - (Date.now() - t.started)); clear(); } });
    el.addEventListener('mouseleave', function () { if (!t.gone && !t.timer && t.left > 0) start(t.left); });
    el.addEventListener('focusin', function () { if (t.timer) { t.left = Math.max(1500, t.left - (Date.now() - t.started)); clear(); } });
    el.addEventListener('focusout', function () { if (!t.gone && !t.timer && t.left > 0) start(t.left); });
    t.arm = start;
    t.handle = { el: el, dismiss: dismiss };
    toasts.push(t);
    box.appendChild(el);
    while (toasts.length > 3) { var old = toasts[0]; old.handle.dismiss(); if (toasts[0] === old) toasts.shift(); }
    start(ms);
    return t.handle;
  }
  function toast(msg, type, ms) { return toastCore(msg, type || 'info', ms, null); }
  function undoToast(msg, onUndo, ms) { return toastCore(msg, 'info', ms == null ? 8000 : ms, typeof onUndo === 'function' ? onUndo : function () {}); }

  /* ------------------------------------------------------------------ dialogs, sheets, drawers */
  var stack = [];     /* open entries, last is top */
  function entryOf(el) { for (var i = 0; i < stack.length; i++) if (stack[i].el === el) return stack[i]; return null; }
  function isDialogEl(el) { return !!el && el.tagName === 'DIALOG'; }
  function isDirty(entry) {
    var f = entry.opts && entry.opts.dirty;
    if (typeof f === 'function') { try { return !!f(); } catch (e) { return false; } }
    return entry.el.classList.contains('is-dirty');
  }
  function syncDirty(entry) { entry.el.classList.toggle('is-dirty', isDirty(entry)); }

  function focusInitial(el) {
    var target = el.querySelector('[data-autofocus],[autofocus]');
    if (!target && coarse()) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); return; }
    if (!target) {
      var body = el.querySelector('.dlg-body,.modal') || el;
      target = body.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])');
      if (!target || !visible(target)) { var fs = focusables(body); target = fs[0] || null; }
      if (!target) { var all = focusables(el); target = all[0] || null; }
    }
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
    else { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  }

  function askDiscard() {
    return confirm({ title: 'Discard changes?', body: 'Your edits have not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
  }
  /* user-intent close (Esc, backdrop, close button): asks first when dirty */
  function requestClose(entry, how) {
    if (!entry || entry.closing) return false;
    syncDirty(entry);
    if (isDirty(entry)) {
      if (how === 'backdrop') return false;
      if (entry.asking) return false;
      entry.asking = true;
      askDiscard().then(function (yes) { entry.asking = false; if (yes) closeEntry(entry); });
      return false;
    }
    closeEntry(entry);
    return true;
  }

  function onKeydownLegacy(e) {
    var entry = entryOf(e.currentTarget);
    if (!entry) return;
    if (e.key === 'Escape') {
      if (stack[stack.length - 1] !== entry) return;
      e.stopPropagation(); e.preventDefault();
      requestClose(entry, 'esc');
    } else if (e.key === 'Tab') {
      var scope = entry.el.querySelector('.modal') || entry.el;
      var fs = focusables(scope);
      if (!fs.length) { e.preventDefault(); return; }
      var first = fs[0], last = fs[fs.length - 1], cur = DOC.activeElement;
      if (e.shiftKey && (cur === first || !scope.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !scope.contains(cur))) { e.preventDefault(); first.focus(); }
    }
  }
  function onCancel(e) {
    var entry = entryOf(e.currentTarget);
    e.preventDefault();
    if (entry) requestClose(entry, 'esc');
  }
  function onBackdropClick(e) {
    var entry = entryOf(e.currentTarget);
    if (!entry) return;
    var el = entry.el;
    if (isDialogEl(el)) {
      if (e.target !== el || e.detail === 0) return;
      var r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
      requestClose(entry, 'backdrop');
    } else if (e.target === el) {
      requestClose(entry, 'backdrop');
    }
  }
  function onNativeClose(e) {
    var entry = entryOf(e.currentTarget);
    if (entry && !entry.closing) closeEntry(entry, true);
  }

  function open(el, opts) {
    if (!DOC || !el) return el;
    opts = opts || {};
    var entry = entryOf(el);
    if (entry) { if (opts.dirty) entry.opts.dirty = opts.dirty; if (opts.onClose) entry.opts.onClose = opts.onClose; return el; }
    entry = { el: el, opts: opts, opener: DOC.activeElement, legacy: !isDialogEl(el), closing: false, asking: false };
    stack.push(entry);
    if (entry.legacy) {
      el.classList.add('active');
      el.setAttribute('role', el.getAttribute('role') || 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.addEventListener('keydown', onKeydownLegacy);
      el.addEventListener('click', onBackdropClick);
    } else {
      if (!el.classList.contains('dlg')) el.classList.add('dlg');
      el.addEventListener('cancel', onCancel);
      el.addEventListener('click', onBackdropClick);
      el.addEventListener('close', onNativeClose);
      if (!el.open) { try { el.showModal(); } catch (err) { el.setAttribute('open', ''); } }
    }
    syncDirty(entry);
    focusInitial(el);
    return el;
  }

  function closeEntry(entry, fromNative) {
    if (entry.closing) return;
    entry.closing = true;
    var el = entry.el;
    var idx = stack.indexOf(entry); if (idx >= 0) stack.splice(idx, 1);
    el.removeEventListener('click', onBackdropClick);
    if (entry.legacy) {
      el.classList.remove('active');
      el.removeEventListener('keydown', onKeydownLegacy);
      el.removeAttribute('aria-modal');
    } else {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('close', onNativeClose);
      if (!fromNative && el.open) { try { el.close(); } catch (err) { el.removeAttribute('open'); } }
    }
    el.classList.remove('is-dirty');
    var op = entry.opener;
    if (el.getAttribute('data-crm-built') === '1' && el.parentNode) el.parentNode.removeChild(el);
    if (op && op !== DOC.body && op.focus && DOC.contains(op)) { try { op.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
    if (typeof entry.opts.onClose === 'function') { try { entry.opts.onClose(el); } catch (err) { warn('CRMUI.open onClose threw', err); } }
  }

  /* close(el): returns true when it closed now. If dirty() is true and force is not set it asks "Discard changes?"
   * first and returns false. After a successful save call close(el, {force:true}). */
  function close(el, o) {
    var entry = entryOf(el);
    if (!entry) {
      if (el && isDialogEl(el) && el.open) { try { el.close(); } catch (e) { el.removeAttribute('open'); } return true; }
      if (el && el.classList && el.classList.contains('active')) { el.classList.remove('active'); return true; }
      return false;
    }
    if (o && o.force) { closeEntry(entry); return true; }
    return requestClose(entry, 'api');
  }

  function closeAll() {
    if (!DOC) return;
    closeMenu();
    var list = stack.slice().reverse();
    list.forEach(function (en) { closeEntry(en); });
    Array.prototype.forEach.call(DOC.querySelectorAll('dialog[open]'), function (d) { try { d.close(); } catch (e) { d.removeAttribute('open'); } if (d.getAttribute('data-crm-built') === '1' && d.parentNode) d.parentNode.removeChild(d); });
    Array.prototype.forEach.call(DOC.querySelectorAll('.modal-backdrop.active'), function (m) { m.classList.remove('active'); });
    pendingConfirms.slice().forEach(function (f) { f(false); });
  }

  /* ------------------------------------------------------------------ confirm */
  var pendingConfirms = [];
  function confirm(o) {
    o = o || {};
    if (!DOC) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false;
      var tid = uid('crm-ct'), bid = uid('crm-cb');
      var d = mk('dialog', 'dlg dlg-confirm');
      d.setAttribute('data-crm-built', '1');
      if (!DOC.getElementById('crmConfirm')) d.id = 'crmConfirm'; // stable hook for flows and tests; a second stacked confirm keeps no id (ids stay unique)
      d.setAttribute('role', 'alertdialog');
      d.setAttribute('aria-labelledby', tid);
      if (o.body) d.setAttribute('aria-describedby', bid);
      var body = mk('div', 'dlg-body');
      var h = mk('h2', 'dlg-title'); h.id = tid; h.textContent = o.title || 'Are you sure?';
      body.appendChild(h);
      if (o.body) { var p = mk('p', 'dlg-text'); p.id = bid; p.textContent = o.body; body.appendChild(p); }
      var foot = mk('div', 'dlg-foot');
      var cancel = mk('button', 'btn btn-secondary'); cancel.type = 'button'; cancel.textContent = o.cancelLabel || 'Cancel'; cancel.setAttribute('data-autofocus', '');
      var ok = mk('button', 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary')); ok.type = 'button'; ok.textContent = o.confirmLabel || 'Confirm';
      foot.appendChild(cancel); foot.appendChild(ok);
      d.appendChild(body); d.appendChild(foot);
      DOC.body.appendChild(d);
      function finish(v) {
        if (done) return; done = true;
        var i = pendingConfirms.indexOf(finish); if (i >= 0) pendingConfirms.splice(i, 1);
        resolve(v);
        if (entryOf(d)) closeEntry(entryOf(d));
      }
      pendingConfirms.push(finish);
      cancel.addEventListener('click', function () { finish(false); });
      ok.addEventListener('click', function () { finish(true); });
      open(d, { onClose: function () { finish(false); } });
      cancel.focus();
    });
  }

  /* ------------------------------------------------------------------ menu */
  var menuState = null;
  function closeMenu(noFocus) {
    var s = menuState; if (!s) return;
    menuState = null;
    DOC.removeEventListener('pointerdown', s.onDown, true);
    DOC.removeEventListener('keydown', s.onKey, true);
    root.removeEventListener('resize', s.onResize);
    if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
    if (s.anchor) { s.anchor.setAttribute('aria-expanded', 'false'); if (!noFocus && DOC.contains(s.anchor)) { try { s.anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  }
  function menu(anchor, items, o) {
    if (!DOC || !anchor) return null;
    o = o || {};
    closeMenu(true);
    items = (items || []).slice();
    if (items.length > 6) { warn('CRMUI.menu: max 6 items (L2), extra items dropped'); items = items.slice(0, 6); }
    var host = (anchor.closest && anchor.closest('dialog[open]')) || DOC.body;
    var m = mk('dialog', 'menu');
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', o.label || 'Actions');
    var btns = [];
    items.forEach(function (it) {
      var b = mk('button', 'menu-item' + (it.danger ? ' is-danger' : ''));
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      if (it.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      b.innerHTML = (it.icon ? icon(it.icon, 16) : '') + '<span class="menu-label"></span>';
      b.querySelector('.menu-label').textContent = it.label || '';
      b.addEventListener('click', function () {
        if (it.disabled) return;
        closeMenu(true);
        try { anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        if (typeof it.onSelect === 'function') it.onSelect();
      });
      m.appendChild(b); btns.push(b);
    });
    host.appendChild(m);
    try { m.show(); } catch (e) { m.setAttribute('open', ''); }
    anchor.setAttribute('aria-haspopup', 'menu');
    anchor.setAttribute('aria-expanded', 'true');
    function place() {
      var r = anchor.getBoundingClientRect();
      var vw = root.innerWidth, vh = root.innerHeight;
      var mw = m.offsetWidth, mh = m.offsetHeight;
      var left = r.left;
      if (o.align === 'right' || left + mw > vw - 8) left = r.right - mw;
      left = Math.max(8, Math.min(left, vw - mw - 8));
      var top = r.bottom + 4;
      if (top + mh > vh - 8 && r.top - 4 - mh >= 8) top = r.top - 4 - mh;
      top = Math.max(8, Math.min(top, vh - mh - 8));
      m.style.left = left + 'px'; m.style.top = top + 'px';
    }
    place();
    function enabled() { return btns.filter(function (b) { return !b.disabled; }); }
    var state = {
      el: m, anchor: anchor,
      onDown: function (e) { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(true); },
      onKey: function (e) {
        if (!m.parentNode) return;
        var list = enabled(), i = list.indexOf(DOC.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); if (list.length) list[(i + 1) % list.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (list.length) list[(i <= 0 ? list.length : i) - 1].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); if (list.length) list[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); if (list.length) list[list.length - 1].focus(); }
        else if (e.key === 'Tab') { closeMenu(true); }
      },
      onResize: function () { closeMenu(true); }
    };
    menuState = state;
    DOC.addEventListener('pointerdown', state.onDown, true);
    DOC.addEventListener('keydown', state.onKey, true);
    root.addEventListener('resize', state.onResize);
    var first = enabled()[0]; if (first) first.focus({ preventScroll: true });
    return { el: m, close: function () { if (menuState === state) closeMenu(); } };
  }

  /* ------------------------------------------------------------------ sheet (built dialog) */
  function sheet(o) {
    if (!DOC) return null;
    o = o || {};
    var d = mk('dialog', 'dlg ' + (o.drawer ? 'dlg-drawer' : 'dlg-sheet') + (o.className ? ' ' + o.className : ''));
    d.setAttribute('data-crm-built', '1');
    if (o.id) d.id = o.id;
    var tid = uid('crm-st');
    d.setAttribute('aria-labelledby', tid);
    var head = mk('div', 'dlg-head');
    var h = mk('h2', 'dlg-title'); h.id = tid; h.textContent = o.title || '';
    var x = mk('button', 'btn btn-ghost btn-icon dlg-x', icon('x', 20)); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.setAttribute('data-crm-close', '');
    head.appendChild(h); head.appendChild(x);
    var body = mk('div', 'dlg-body');
    if (o.html != null && typeof o.html === 'object' && o.html.nodeType) body.appendChild(o.html); else body.innerHTML = o.html == null ? '' : String(o.html);
    d.appendChild(head); d.appendChild(body);
    function wire(btn, spec) {
      btn.addEventListener('click', function () {
        var r;
        try { r = spec.onClick ? spec.onClick(d) : undefined; } catch (e) { warn('CRMUI.sheet button threw', e); return; }
        if (isThenable(r)) {
          btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
          r.then(function (v) { btn.removeAttribute('aria-busy'); btn.disabled = false; if (v !== false) close(d, { force: true }); },
                 function () { btn.removeAttribute('aria-busy'); btn.disabled = false; });
        } else if (r !== false) close(d, { force: true });
      });
    }
    if (o.primary || o.secondary) {
      var foot = mk('div', 'dlg-foot');
      if (o.secondary) { var sb = mk('button', 'btn btn-secondary'); sb.type = 'button'; sb.textContent = o.secondary.label || 'Cancel'; wire(sb, o.secondary); foot.appendChild(sb); }
      if (o.primary) { var pb = mk('button', 'btn btn-primary'); pb.type = 'button'; pb.setAttribute('data-primary', ''); pb.textContent = o.primary.label || 'Save'; wire(pb, o.primary); foot.appendChild(pb); }
      d.appendChild(foot);
    }
    DOC.body.appendChild(d);
    if (o.open !== false) open(d, { dirty: o.dirty, onClose: o.onClose });
    return d;
  }

  /* ------------------------------------------------------------------ save pill */
  function savePill(host) {
    if (!DOC || !host) return { set: function () {}, el: null };
    var pill = host.classList && host.classList.contains('save-pill') ? host : null;
    if (!pill) { for (var i = 0; i < host.children.length; i++) if (host.children[i].classList.contains('save-pill')) { pill = host.children[i]; break; } }
    if (!pill) { pill = mk('span', 'save-pill'); host.appendChild(pill); }
    pill.setAttribute('aria-live', 'polite');
    pill.setAttribute('role', 'status');
    function set(state, o) {
      o = o || {};
      pill.setAttribute('data-state', state);
      pill.hidden = state === 'idle' || !state;
      pill.innerHTML = '';
      if (state === 'saving') {
        pill.appendChild(mk('span', 'spin', ''));
        pill.appendChild(DOC.createTextNode('Saving'));
      } else if (state === 'saved') {
        var at = o.at instanceof Date ? o.at : new Date();
        pill.insertAdjacentHTML('beforeend', icon('check', 14));
        pill.appendChild(DOC.createTextNode('Saved ' + fmt.time(pad2(at.getHours()) + ':' + pad2(at.getMinutes()))));
      } else if (state === 'error') {
        pill.insertAdjacentHTML('beforeend', icon('circle-alert', 14));
        pill.appendChild(DOC.createTextNode('Not saved. '));
        var rb = mk('button', 'save-retry'); rb.type = 'button'; rb.textContent = 'Retry';
        rb.addEventListener('click', function () { if (typeof o.onRetry === 'function') o.onRetry(); else if (typeof pill._onRetry === 'function') pill._onRetry(); });
        if (typeof o.onRetry === 'function') pill._onRetry = o.onRetry;
        pill.appendChild(rb);
      }
    }
    set('idle');
    return { set: set, el: pill };
  }

  /* ------------------------------------------------------------------ skeleton */
  function skeleton(container, rows, kind) {
    if (!DOC || !container) return { clear: function () {} };
    rows = rows == null ? 5 : rows;
    kind = kind || 'row';
    var html = '<span class="sr-only">Loading</span>';
    for (var i = 0; i < rows; i++) {
      if (kind === 'card') html += '<div class="skel-card"><span class="skel skel-line"></span><span class="skel skel-line short"></span><span class="skel skel-block"></span></div>';
      else if (kind === 'text') html += '<span class="skel skel-line' + (i % 3 === 2 ? ' short' : '') + '"></span>';
      else html += '<div class="skel-row"><span class="skel skel-dot"></span><span class="skel-lines"><span class="skel skel-line"></span><span class="skel skel-line short"></span></span></div>';
    }
    var wrap = mk('div', 'skel-wrap skel-' + kind + 's', html);
    wrap.setAttribute('data-skeleton', '');
    wrap.setAttribute('role', 'status');
    container.innerHTML = '';
    container.appendChild(wrap);
    container.setAttribute('aria-busy', 'true');
    return { el: wrap, clear: function () { if (wrap.parentNode === container) container.removeChild(wrap); container.removeAttribute('aria-busy'); } };
  }

  /* ------------------------------------------------------------------ command palette */
  var palProviders = [];
  var palEl = null, palInput = null, palList = null, palLive = null;
  var palItems = [], palSel = -1, palToken = 0;
  var GROUP_ORDER = ['Recent', 'Events', 'Clients', 'Inquiries', 'Invoices', 'Actions'];
  var RECENT_KEY = 'crmui.palette.recent';
  function recents() { try { var r = JSON.parse(root.localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(r) ? r.slice(0, 5) : []; } catch (e) { return []; } }
  function pushRecent(label) {
    if (!label) return;
    try { var r = recents().filter(function (x) { return x !== label; }); r.unshift(label); root.localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 5))); } catch (e) { /* ignore */ }
  }
  function palBuild() {
    if (palEl) return;
    palEl = mk('dialog', 'dlg dlg-palette');
    palEl.id = 'crmPalette';
    palEl.setAttribute('aria-label', 'Search');
    palEl.innerHTML =
      '<div class="pal-head">' + icon('search', 20) +
      '<input class="pal-input" type="text" role="combobox" aria-expanded="true" aria-controls="crmPalList" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Search events, clients, invoices" aria-label="Search">' +
      '<button type="button" class="btn btn-ghost btn-icon" data-crm-close aria-label="Close">' + icon('x', 20) + '</button></div>' +
      '<div class="pal-list" id="crmPalList" role="listbox" aria-label="Results"></div>' +
      '<div class="pal-foot"><span><kbd class="kbd">Up</kbd> <kbd class="kbd">Down</kbd> to move</span><span><kbd class="kbd">Enter</kbd> to open</span><span><kbd class="kbd">Esc</kbd> to close</span></div>' +
      '<div class="sr-only" id="crmPalLive" aria-live="polite"></div>';
    DOC.body.appendChild(palEl);
    palInput = palEl.querySelector('.pal-input');
    palList = palEl.querySelector('.pal-list');
    palLive = palEl.querySelector('#crmPalLive');
    palInput.addEventListener('input', function () { palRun(palInput.value); });
    palInput.addEventListener('keydown', palKey);
    palList.addEventListener('click', function (e) {
      var it = e.target.closest ? e.target.closest('.pal-item') : null;
      if (it) palChoose(parseInt(it.getAttribute('data-i'), 10));
    });
    palList.addEventListener('mousemove', function (e) {
      var it = e.target.closest ? e.target.closest('.pal-item') : null;
      if (it) { var i = parseInt(it.getAttribute('data-i'), 10); if (i !== palSel) palSelect(i, true); }
    });
  }
  function palGroupRank(g) { var i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; }
  function palRun(q) {
    var token = ++palToken;
    var results = [], pending = [];
    palProviders.forEach(function (p) {
      var r;
      try { r = p(q); } catch (e) { warn('CRMUI.palette provider threw', e); r = []; }
      if (isThenable(r)) pending.push(r.then(function (x) { return x || []; }, function () { return []; }));
      else if (Array.isArray(r)) results = results.concat(r);
    });
    if (pending.length) {
      palRender(results, q, true);
      Promise.all(pending).then(function (all) {
        if (token !== palToken) return;
        all.forEach(function (a) { results = results.concat(a); });
        palRender(results, q, false);
      });
    } else palRender(results, q, false);
  }
  function palRender(results, q, loading) {
    var groups = {}, order = [];
    results.forEach(function (r) {
      if (!r || !r.label) return;
      var g = r.group || 'Results';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      if (groups[g].length < 5) groups[g].push(r);
    });
    var trimmed = String(q || '').trim();
    if (!trimmed) {
      var rc = recents();
      if (rc.length) {
        groups.Recent = rc.map(function (label) { return { group: 'Recent', label: label, meta: '', recent: true }; });
        order.push('Recent');
      }
    }
    order.sort(function (a, b) { return palGroupRank(a) - palGroupRank(b); });
    palItems = []; var html = '';
    order.forEach(function (g) {
      html += '<div class="pal-group" role="presentation">' + esc(g) + '</div>';
      groups[g].forEach(function (r) {
        if (palItems.length >= 25) return;
        var i = palItems.length; palItems.push(r);
        html += '<div class="pal-item" role="option" id="crmPalO' + i + '" data-i="' + i + '" aria-selected="false">' +
          '<span class="pal-label">' + esc(r.label) + '</span>' + (r.meta ? '<span class="pal-meta">' + esc(r.meta) + '</span>' : '') + '</div>';
      });
    });
    if (!palItems.length) {
      html = loading ? '<div class="pal-empty" role="presentation">Searching</div>'
        : trimmed ? '<div class="pal-empty" role="presentation">No results for "' + esc(trimmed) + '".</div>'
        : '<div class="pal-empty" role="presentation">Type to search events, clients, invoices and actions.</div>';
    }
    palList.innerHTML = html;
    palSel = -1;
    if (palItems.length) palSelect(0, true);
    else palInput.removeAttribute('aria-activedescendant');
    palLive.textContent = loading ? 'Searching' : palItems.length ? palItems.length + (palItems.length === 1 ? ' result' : ' results') : 'No results';
  }
  function palSelect(i, noScroll) {
    var prev = palList.querySelector('.pal-item[aria-selected="true"]');
    if (prev) prev.setAttribute('aria-selected', 'false');
    palSel = i;
    var el = palList.querySelector('#crmPalO' + i);
    if (el) {
      el.setAttribute('aria-selected', 'true');
      palInput.setAttribute('aria-activedescendant', el.id);
      if (!noScroll && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }
  function palKey(e) {
    var n = palItems.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) palSelect((palSel + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) palSelect((palSel <= 0 ? n : palSel) - 1); }
    else if (e.key === 'Home') { if (n && !palInput.value) { e.preventDefault(); palSelect(0); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (palSel >= 0) palChoose(palSel); }
  }
  function palChoose(i) {
    var it = palItems[i]; if (!it) return;
    if (it.recent) { palInput.value = it.label; palRun(it.label); palInput.focus(); return; }
    pushRecent(String(palInput.value || '').trim() ? it.label : '');
    close(palEl, { force: true });
    if (typeof it.run === 'function') { try { it.run(); } catch (e) { warn('CRMUI.palette item run threw', e); } }
  }
  var palette = {
    open: function () {
      if (!DOC) return;
      palBuild();
      palInput.value = '';
      open(palEl);
      palRun('');
      palInput.focus();
    },
    close: function () { if (palEl) close(palEl, { force: true }); },
    register: function (provider) {
      if (typeof provider !== 'function') return function () {};
      palProviders.push(provider);
      return function () { var i = palProviders.indexOf(provider); if (i >= 0) palProviders.splice(i, 1); };
    }
  };
  function isEditable(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }
  function onGlobalKey(e) {
    if (!palProviders.length) return;
    var k = e.key;
    if (DOC.querySelector('.modal-backdrop.active')) return; // a legacy modal is open: do not stack the palette over it
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) { e.preventDefault(); palette.open(); }
    else if (k === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target) && !DOC.querySelector('dialog[open]')) { e.preventDefault(); palette.open(); }
  }

  /* ------------------------------------------------------------------ bottom bar */
  function bbItems() { return DOC ? Array.prototype.slice.call(DOC.querySelectorAll('nav.bottom-bar [data-section],nav.bottom-bar [data-tab]')) : []; }
  function bbKey(el) { return el.getAttribute('data-section') || el.getAttribute('data-tab'); }
  var bottomBar = {
    setActive: function (id) {
      var items = bbItems();
      var hit = items.filter(function (e) { return bbKey(e) === id; })[0];
      if (!hit) hit = items.filter(function (e) { return bbKey(e) === 'more'; })[0];
      items.forEach(function (e) {
        var on = e === hit;
        e.classList.toggle('active', on);
        if (on) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current');
      });
    },
    badge: function (id, n) {
      var el = bbItems().filter(function (e) { return bbKey(e) === id; })[0];
      if (!el) return;
      var b = el.querySelector('.bb-badge');
      n = parseInt(n, 10) || 0;
      if (n <= 0) { if (b) b.parentNode.removeChild(b); return; }
      if (!b) { b = mk('span', 'bb-badge'); el.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    }
  };

  /* ------------------------------------------------------------------ list helper */
  /* renderList(items, {table: fn(items) -> '<table class="tbl">...</table>', card: fn(item, i) -> '<... class="row">'})
   * returns one html string holding both; crm-ui.css shows the table at >= 768 and the cards below. */
  function renderList(items, o) {
    o = o || {};
    items = items || [];
    var t = typeof o.table === 'function' ? o.table(items) : '';
    var c = '';
    if (typeof o.card === 'function') for (var i = 0; i < items.length; i++) c += o.card(items[i], i);
    return '<div class="tbl-wrap">' + t + '</div><div class="row-list">' + c + '</div>';
  }

  /* ------------------------------------------------------------------ delegated behaviors */
  function onClickDelegate(e) {
    var t = e.target.closest ? e.target.closest('[data-crm-close]') : null;
    if (!t) return;
    var host = t.closest('dialog,.modal-backdrop');
    if (!host) return;
    var entry = entryOf(host);
    if (entry) { e.preventDefault(); requestClose(entry, 'x'); }
    else if (host.tagName === 'DIALOG') { e.preventDefault(); try { host.close(); } catch (err) { host.removeAttribute('open'); } }
  }
  function onTabsKey(e) {
    var k = e.key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
    var cur = e.target.closest ? e.target.closest('.tab-btn,.seg-btn,[role=tab]') : null;
    if (!cur) return;
    var list = cur.closest('.tabs,.seg,[role=tablist]');
    if (!list) return;
    var tabs = Array.prototype.slice.call(list.querySelectorAll('.tab-btn,.seg-btn,[role=tab]')).filter(function (b) { return !b.disabled && visible(b); });
    var i = tabs.indexOf(cur); if (i < 0) return;
    var j = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[j].focus();
    tabs[j].click();
    if (tabs[j].scrollIntoView) tabs[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* data-norm="phone|money|date|time|email" inputs: set mobile keyboard attributes, and on blur run the normalizer,
   * show the parsed value under the field (.field-echo) or the problem (.field-msg), and store the stored form in
   * input.dataset.value. The visible text is left alone unless data-norm-rewrite is present. */
  var NORM_ATTRS = {
    phone: { type: 'tel', inputmode: 'tel', autocomplete: 'tel', enterkeyhint: 'next' },
    money: { inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done' },
    email: { type: 'email', inputmode: 'email', autocomplete: 'email', enterkeyhint: 'next', autocapitalize: 'off' },
    date: { inputmode: 'text', autocomplete: 'off', enterkeyhint: 'next' },
    time: { inputmode: 'text', autocomplete: 'off', enterkeyhint: 'next' }
  };
  function applyNormAttrs(inp) {
    var kind = inp.getAttribute('data-norm');
    var a = NORM_ATTRS[kind]; if (!a) return;
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && !inp.hasAttribute(k)) inp.setAttribute(k, a[k]);
  }
  /* echo and message live in two small divs placed right after the input (or after .input-wrap); order: input, echo, message */
  function msgSlots(inp) {
    if (inp._crmSlots && inp._crmSlots.echo.parentNode) return inp._crmSlots;
    var host = inp.closest('.input-wrap') || inp;
    var echo = mk('div', 'field-echo'); echo.id = uid('crm-fe'); echo.hidden = true;
    var msg = mk('div', 'field-msg'); msg.id = uid('crm-fm'); msg.hidden = true;
    host.parentNode.insertBefore(echo, host.nextSibling);
    host.parentNode.insertBefore(msg, echo.nextSibling);
    inp._crmSlots = { echo: echo, msg: msg };
    return inp._crmSlots;
  }
  function onNormFocusIn(e) { var t = e.target; if (t && t.getAttribute && t.getAttribute('data-norm')) applyNormAttrs(t); }
  function onNormFocusOut(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var kind = t.getAttribute('data-norm');
    if (!kind || !norm[kind]) return;
    var r = norm[kind](t.value, kind === 'date' ? { warnPast: t.hasAttribute('data-warn-past') } : kind === 'time' ? { assume: t.getAttribute('data-assume') || 'pm' } : undefined);
    var slots = msgSlots(t), echo = slots.echo, err = slots.msg;
    t.classList.remove('is-error');
    t.removeAttribute('aria-invalid');
    err.textContent = ''; err.hidden = true;
    echo.textContent = ''; echo.hidden = true;
    if (r.ok && r.value == null) { delete t.dataset.value; t.removeAttribute('aria-describedby'); return; }
    if (!r.ok) {
      t.classList.add('is-error'); t.setAttribute('aria-invalid', 'true');
      err.textContent = r.message; err.hidden = false;
      t.setAttribute('aria-describedby', err.id);
      delete t.dataset.value;
      return;
    }
    t.dataset.value = String(r.value);
    var line = !r.message ? r.echo : /^Read as /.test(r.message) ? r.message : r.echo + '. ' + r.message;
    echo.textContent = line; echo.hidden = false;
    t.setAttribute('aria-describedby', echo.id);
    if (t.hasAttribute('data-norm-rewrite')) t.value = kind === 'email' ? r.value : r.echo;
  }

  function init() {
    DOC.addEventListener('keydown', onGlobalKey);
    DOC.addEventListener('keydown', onTabsKey);
    DOC.addEventListener('click', onClickDelegate);
    DOC.addEventListener('focusin', onNormFocusIn);
    DOC.addEventListener('focusout', onNormFocusOut);
    Array.prototype.forEach.call(DOC.querySelectorAll('input[data-norm]'), applyNormAttrs);
  }
  if (DOC) {
    if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', init); else init();
  }

  /* ------------------------------------------------------------------ public API */
  var api = {
    version: VERSION,
    icon: icon,
    toast: toast,
    undoToast: undoToast,
    open: open,
    close: close,
    closeAll: closeAll,
    confirm: confirm,
    menu: menu,
    sheet: sheet,
    savePill: savePill,
    skeleton: skeleton,
    palette: palette,
    bottomBar: bottomBar,
    fmt: fmt,
    norm: norm,
    renderList: renderList,
    esc: esc
  };
  if (typeof window !== 'undefined') window.CRMUI = api; else root.CRMUI = api;
})(typeof window !== 'undefined' ? window : this);
