/* Baseline Studio contract system.
 * Plain JS, no modules, no build step. Attaches to window.BSContracts.
 * Loaded by portal-provider.html before the main inline script.
 *
 * What lives here:
 *   - terms (deposit, balance, cancellation, overtime) read from settings.contractTerms with defaults
 *   - one merge engine used by every document merge path in the CRM
 *   - service modules (included only when the service is booked)
 *   - the base templates (generic + one per event type) and the code that adds them safely
 *   - helpers: event type normalizing, template picking, legacy template rename
 * Not legal advice. See _DEV/crm-v2/contracts-README.md.
 */
(function (root) {
  'use strict';

  // Template text version. 2 = the shorter, plainer agreements with the "Agreement at a glance" box.
  // When the stock wording changes again: raise this, and add the fingerprints of the version being replaced to STOCK_HISTORY.
  var VERSION = 2;

  // ---------------------------------------------------------------------------
  // Terms. One object, stored at settings.contractTerms. Defaults are the owner's decisions.
  // ---------------------------------------------------------------------------
  var DEFAULT_TERMS = {
    depositPercent: 50,       // non-refundable, due at signing
    balanceDueDays: 14,       // balance due this many days before the event
    cancelFarDays: 90,        // this many days or more before the event: deposit only
    cancelNearDays: 30,       // fewer than this many days before: full balance
    cancelMidPercent: 50,     // between the two: this percent of the remaining balance
    overtimeDjRate: 300,      // per hour, DJ with sound
    overtimeCrewRate: 125,    // per hour, each additional crew member on site
    overtimeBlockMinutes: 30, // overtime is billed in blocks of this many minutes
    detailsDueDays: 14        // client sends timeline, music, approvals this many days before
  };

  var TERM_FIELDS = [
    { key: 'depositPercent',       label: 'Deposit (percent of total)',                 unit: '%',    min: 1,  max: 100,  step: 1 },
    { key: 'balanceDueDays',       label: 'Balance due (days before the event)',        unit: 'days', min: 0,  max: 365,  step: 1 },
    { key: 'cancelFarDays',        label: 'Cancel this early: deposit only (days out)', unit: 'days', min: 2,  max: 730,  step: 1 },
    { key: 'cancelNearDays',       label: 'Cancel later than this: full balance (days out)', unit: 'days', min: 1, max: 729, step: 1 },
    { key: 'cancelMidPercent',     label: 'In between: percent of the remaining balance', unit: '%',  min: 0,  max: 100,  step: 1 },
    { key: 'overtimeDjRate',       label: 'Overtime: DJ with sound',                    unit: '$/hr', min: 0,  max: 5000, step: 1 },
    { key: 'overtimeCrewRate',     label: 'Overtime: each additional crew member',      unit: '$/hr', min: 0,  max: 5000, step: 1 },
    { key: 'overtimeBlockMinutes', label: 'Overtime is billed in blocks of',            unit: 'min',  min: 5,  max: 120,  step: 5 },
    { key: 'detailsDueDays',       label: 'Client sends details (days before event)',  unit: 'days', min: 0,  max: 120,  step: 1 }
  ];

  function toNum(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }

  // Merge saved terms over defaults. Bad values fall back to the default for that field.
  function getTerms(settings) {
    var src = (settings && typeof settings === 'object' && settings.contractTerms && typeof settings.contractTerms === 'object') ? settings.contractTerms : {};
    var out = {};
    TERM_FIELDS.forEach(function (f) {
      var n = toNum(src[f.key]);
      out[f.key] = (isFinite(n) && n >= f.min && n <= f.max) ? n : DEFAULT_TERMS[f.key];
    });
    if (out.cancelNearDays >= out.cancelFarDays) {
      out.cancelNearDays = DEFAULT_TERMS.cancelNearDays;
      out.cancelFarDays = DEFAULT_TERMS.cancelFarDays;
    }
    return out;
  }

  // Validate raw form input. Returns { ok, terms, errors[] }.
  function validateTerms(raw) {
    var errors = [], terms = {};
    TERM_FIELDS.forEach(function (f) {
      var n = toNum(raw && raw[f.key]);
      if (!isFinite(n)) { errors.push(f.label + ' needs a number.'); return; }
      if (n < f.min || n > f.max) { errors.push(f.label + ' must be between ' + f.min + ' and ' + f.max + '.'); return; }
      terms[f.key] = n;
    });
    if (!errors.length && terms.cancelNearDays >= terms.cancelFarDays) {
      errors.push('The late-cancellation days must be fewer than the early-cancellation days.');
    }
    return { ok: errors.length === 0, terms: terms, errors: errors };
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      .replace(/\{\{/g, '&#123;&#123;');   // a typed value can never be expanded by a later merge
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    n = round2(n);
    var neg = n < 0; if (neg) n = -n;
    var whole = n % 1 === 0;
    var s = (whole ? String(n) : n.toFixed(2));
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '$' + parts.join('.');
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function parseYMD(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return isNaN(ms) ? null : ms;
  }
  function fmtDate(ms, withDay) {
    var d = new Date(ms);
    return (withDay ? DAYS[d.getUTCDay()] + ', ' : '') + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  function fmtTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    if (!m) return '';
    var h = +m[1], min = m[2];
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + min + ' ' + ap;
  }
  // Today as UTC midnight of the America/New_York calendar date.
  function todayMs(now) {
    var d = now ? new Date(now) : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
      return Date.UTC(+o.year, +o.month - 1, +o.day);
    } catch (e) {
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  var DAY_MS = 86400000;

  function fmtMinutes(m) {
    if (m % 60 === 0) { var h = m / 60; return h + (h === 1 ? ' hour' : ' hours'); }
    return m + ' minutes';
  }

  // ---------------------------------------------------------------------------
  // Event types
  // ---------------------------------------------------------------------------
  var KIND_LABEL = {
    wedding: 'Wedding',
    quince: 'Quincea\u00f1era',
    mitzvah: 'Bar/Bat Mitzvah',
    sweet16: 'Sweet 16',
    corporate: 'Corporate Event',
    birthday: 'Birthday / Private Party'
  };

  function plainType(t) {
    var s = String(t === null || t === undefined ? '' : t).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Contract kind for an event type string. '' means unknown (use the generic agreement).
  function normalizeType(t) {
    var s = plainType(t);
    if (!s) return '';
    if (/quince|15 anos|fifteen/.test(s)) return 'quince';
    if (/sweet ?(16|sixteen)|^sweet$/.test(s)) return 'sweet16';
    if (/mitzvah|mitzva|bar mitz|bat mitz|bnai|b nai/.test(s)) return 'mitzvah';
    if (/wedding|marriage/.test(s)) return 'wedding';
    if (/corporate|company|business|conference|gala|fundrais|award|product launch|trade show|seminar|team build|office|networking/.test(s)) return 'corporate';
    if (/birthday|bday|private|anniversary|graduation|baby shower|bridal shower|retirement|housewarming|party/.test(s)) return 'birthday';
    return '';
  }

  // The type value the CRM stores on an event (keeps gala and concert, which have no contract of their own).
  function eventTypeFromText(t) {
    var s = plainType(t);
    if (!s) return '';
    if (/\bgala\b|fundrais/.test(s)) return 'gala';
    if (/concert|festival/.test(s)) return 'concert';
    var k = normalizeType(t);
    return k;
  }

  // Event kind with a hint from the event name when the type is missing or a catch-all.
  function resolveKind(ev) {
    var e = ev || {};
    var k = normalizeType(e.type);
    var n = plainType(e.name);
    if (k === 'quince' && /sweet ?(16|sixteen)/.test(n)) return 'sweet16';
    if (!k) {
      if (/mitzvah|bar mitz|bat mitz/.test(n)) return 'mitzvah';
      if (/quince/.test(n)) return 'quince';
      if (/sweet ?(16|sixteen)/.test(n)) return 'sweet16';
      if (/wedding/.test(n)) return 'wedding';
      if (/corporate/.test(n)) return 'corporate';
      if (/birthday|bday/.test(n)) return 'birthday';
    }
    return k;
  }

  // ---------------------------------------------------------------------------
  // Service classification. Reads text such as "Special Effects CO2 Jets" and returns module keys.
  // ---------------------------------------------------------------------------
  function lower(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/co\u2082/g, 'co2').replace(/[\u2013\u2014]/g, '-');
  }

  function classify(text) {
    var t = lower(text), keys = [], fine = [];
    function add(k) { if (keys.indexOf(k) < 0) keys.push(k); }
    function addFine(k) { if (fine.indexOf(k) < 0) fine.push(k); }
    var isClouds = /dancing on (a )?clouds?|low[- ]lying fog|\bclouds?\b/.test(t);
    var isGobo = /gobo|logo projection/.test(t);

    if (/\bdj\b|disc jockey/.test(t)) { add('dj'); }
    if (/\bmc\b|master of ceremon|emcee/.test(t)) { add('mc'); }
    if (/live sound|sound system|speech|podium|distributed audio|public address|\bpa\b|stage sound|\baudio\b/.test(t)) { add('audio'); }
    if (isGobo) { add('gobo'); }
    if (!isGobo && !isClouds && /uplight|up-light|bistro|string light|moving head|dance ?floor|stage light|lighting|color wash/.test(t)) {
      add('lighting');
      if (/uplight|up-light|color wash/.test(t)) addFine('uplight');
      if (/bistro|string light/.test(t)) addFine('bistro');
      if (/moving head|dance ?floor/.test(t)) addFine('floor');
      if (/stage light/.test(t)) addFine('stage');
    }
    if (!isGobo && /led (video )?wall|video wall|led screen|\btv\b|television|display screen|projection|projector|backdrop|\bimag\b|visual & display/.test(t)) {
      add('display');
      if (/led (video )?wall|video wall|led screen/.test(t)) addFine('wall');
      if (/\btv\b|television|display screen/.test(t)) addFine('tv');
      if (/projection|projector|backdrop/.test(t)) addFine('proj');
    }
    if (/co2|cryo/.test(t)) {
      add('co2');
      if (/jet/.test(t)) addFine('co2jet');
      if (/cannon|cryo/.test(t)) addFine('co2cannon');
    }
    if (/cold ?spark|spark fountain|spark tower/.test(t)) { add('coldspark'); }
    if (isClouds) { add('clouds'); }
    if (!isClouds && /\bfog\b|\bhaze\b|confetti|streamer|pyro/.test(t)) { add('fx'); }
    if (/live musician|\bband\b|musician|saxophon|violin|guitar|percussion|quartet|mariachi|singer|vocalist/.test(t)) { add('musicians'); }
    if (!keys.length) add('other');
    return { keys: keys, fine: fine };
  }

  function svcName(s) {
    var base = s.service || s.category || 'Service';
    return base;
  }
  function svcDetail(s) {
    var d = [];
    if (s.sub) d.push(s.sub);
    if (s.note) d.push(s.note);
    return d.join('; ');
  }

  // ---------------------------------------------------------------------------
  // Price source: invoice or quote lines that match the booked services. Never invents a price.
  // ---------------------------------------------------------------------------
  function isDepositLike(desc) { return /^\s*(deposit|retainer|balance|payment|installment)\b/i.test(String(desc || '')); }

  function lineAmount(l) {
    var n = toNum(l && (l.price !== undefined && l.price !== null && l.price !== '' ? l.price : l.amount));
    return isFinite(n) ? n : null;
  }

  function candidateFrom(kind, rec, idx) {
    var raw = Array.isArray(rec && rec.lines) ? rec.lines : [];
    var lines = raw.filter(function (l) { return l && String(l.desc || '').trim(); }).map(function (l) {
      var c = classify(l.desc);
      return { desc: String(l.desc).trim(), price: lineAmount(l), keys: c.keys, fine: c.fine };
    });
    if (!lines.length) return null;
    if (lines.every(function (l) { return isDepositLike(l.desc); })) return null;
    var total = toNum(rec.total);
    var sum = lines.reduce(function (a, l) { return a + (l.price || 0); }, 0);
    if (!isFinite(total)) total = sum;
    if (!(total > 0)) return null;
    var subtotal = toNum(rec.subtotal);
    if (!isFinite(subtotal)) subtotal = sum;
    return { kind: kind, ref: rec.invoiceNum || rec.id || '', lines: lines, total: round2(total), subtotal: round2(subtotal), idx: idx, created: toNum(rec.createdAt) || 0 };
  }

  function matchScore(svc, line) {
    var a = lower(svc.name).replace(/[^a-z0-9]+/g, ' ').trim();
    var b = lower(line.desc).replace(/[^a-z0-9]+/g, ' ').trim();
    var a2 = lower(svc.name + ' ' + svc.sub).replace(/[^a-z0-9]+/g, ' ').trim();
    if (a && (a === b || a2 === b)) return 4;
    var i, shared = 0;
    for (i = 0; i < svc.fine.length; i++) if (line.fine.indexOf(svc.fine[i]) >= 0) shared++;
    if (shared) return 3;
    var coarse = 0;
    for (i = 0; i < svc.keys.length; i++) if (svc.keys[i] !== 'other' && line.keys.indexOf(svc.keys[i]) >= 0) coarse++;
    // a line that has fine keys the service does not share is a different thing (uplighting vs dance floor)
    if (coarse && svc.fine.length && line.fine.length) return 0;
    return coarse ? 2 : 0;
  }

  // assign[i] = line index for service i, or -1.
  function matchLines(services, lines) {
    var used = {}, assign = [], matched = 0;
    services.forEach(function (s, i) {
      var best = -1, bestScore = 0;
      lines.forEach(function (l, j) {
        if (used[j]) return;
        var sc = matchScore(s, l);
        if (sc > bestScore) { bestScore = sc; best = j; }
      });
      assign[i] = best;
      if (best >= 0) { used[best] = true; matched++; }
    });
    return { assign: assign, matched: matched };
  }

  function pickPriceSource(ev, invoices, services) {
    var cands = [];
    (invoices || []).forEach(function (inv, i) {
      if (!inv || inv.eventId !== ev.id) return;
      if (/void|cancel/i.test(String(inv.status || ''))) return;
      var c = candidateFrom('invoice', inv, i); if (c) cands.push(c);
    });
    (Array.isArray(ev.quotes) ? ev.quotes : []).forEach(function (q, i) {
      var c = candidateFrom('quote', q, i); if (c) cands.push(c);
    });
    var best = null, bestScore = -1;
    cands.forEach(function (c) {
      var m = matchLines(services, c.lines).matched;
      var score = m * 10 + c.lines.length + (c.kind === 'invoice' ? 0.5 : 0);
      if (score >= bestScore) { bestScore = score; best = c; }   // later candidates win ties
    });
    return best;
  }

  // ---------------------------------------------------------------------------
  // Context for one event
  // ---------------------------------------------------------------------------
  function buildContext(ev, env) {
    env = env || {};
    var e = ev || {};
    var terms = getTerms(env.settings);
    var ctx = { ev: ev || null, hasEvent: !!ev, terms: terms, today: todayMs(env.now) };

    // Per-event options (ev.clientCompany, signerName, signerTitle, powerSource). Unset means the standard wording.
    ctx.contactName = e.clientName || '';
    ctx.company = String(e.clientCompany || '').trim();
    ctx.clientName = ctx.company || e.clientName || '';
    ctx.signerName = String(e.signerName || '').trim();
    ctx.signerTitle = String(e.signerTitle || '').trim();
    ctx.powerSource = (e.powerSource === 'generator' || e.powerSource === 'client_generator') ? e.powerSource : 'venue';
    ctx.clientEmail = e.clientEmail || e.portalEmail || '';
    ctx.clientPhone = e.clientPhone || '';
    ctx.eventName = e.name || '';
    ctx.venue = e.venueName || e.venue || '';
    ctx.venueAddress = e.venueAddress || '';
    ctx.dateMs = parseYMD(e.date);
    ctx.kind = resolveKind(e);
    ctx.typeRaw = e.type || '';

    var t1 = fmtTime(e.startTime), t2 = fmtTime(e.endTime);
    ctx.timeText = t1 && t2 ? t1 + ' to ' + t2 : (t1 || t2 || '');
    var sm = /^(\d{1,2}):(\d{2})/.exec(e.startTime || ''), em = /^(\d{1,2}):(\d{2})/.exec(e.endTime || '');
    ctx.hours = null;
    if (sm && em) {
      var mins = (+em[1] * 60 + +em[2]) - (+sm[1] * 60 + +sm[2]);
      if (mins <= 0) mins += 1440;
      ctx.hours = mins / 60;
    }

    // Booked services
    var services = (Array.isArray(e.services) ? e.services : []).filter(Boolean).map(function (s) {
      var c = classify([s.category, s.service, s.subOption, s.customNote].filter(Boolean).join(' '));
      return { category: s.category || '', service: s.service || '', sub: s.subOption || '', note: s.customNote || '', keys: c.keys, fine: c.fine, name: '' };
    });
    services.forEach(function (s) { s.name = svcName(s); });

    var price = pickPriceSource(e, env.invoices, services);
    ctx.price = price;
    ctx.fromLines = false;
    if (!services.length && price) {
      ctx.fromLines = true;
      price.lines.forEach(function (l) {
        if (isDepositLike(l.desc)) return;
        services.push({ category: '', service: l.desc, sub: '', note: '', keys: l.keys, fine: l.fine, name: l.desc, fromLine: true });
      });
    }
    ctx.services = services;

    var has = {};
    services.forEach(function (s) { s.keys.forEach(function (k) { has[k] = true; }); });
    ctx.has = has;

    // Money
    ctx.total = price ? price.total : null;
    ctx.deposit = ctx.total !== null ? round2(ctx.total * terms.depositPercent / 100) : null;
    ctx.balance = ctx.total !== null ? round2(ctx.total - ctx.deposit) : null;

    ctx.overtime = overtimeFor(ctx);
    return ctx;
  }

  // ---------------------------------------------------------------------------
  // Overtime
  // ---------------------------------------------------------------------------
  function overtimeFor(ctx) {
    var t = ctx.terms, h = ctx.has, lines = [];
    if (h.dj) lines.push({ label: 'DJ with sound', rate: t.overtimeDjRate });
    if (h.lighting || h.gobo) lines.push({ label: 'lighting technician', rate: t.overtimeCrewRate });
    if (h.display) lines.push({ label: 'AV/LED technician', rate: t.overtimeCrewRate });
    if (h.mc) lines.push({ label: 'MC', rate: t.overtimeCrewRate });
    var total = lines.reduce(function (a, l) { return a + l.rate; }, 0);
    return { total: total, lines: lines, musicians: !!h.musicians, block: t.overtimeBlockMinutes, perBlock: round2(total * t.overtimeBlockMinutes / 60) };
  }

  function overtimeRateHtml(ctx) {
    var ot = ctx.overtime, t = ctx.terms, out;
    if (!ot.lines.length) {
      out = 'the standard rates: <strong>' + money(t.overtimeDjRate) + ' per hour</strong> for a DJ with sound, plus <strong>' + money(t.overtimeCrewRate) + ' per hour</strong> for each additional crew member on site (lighting technician, AV/LED technician or MC)';
    } else {
      var parts = ot.lines.map(function (l) { return esc(l.label) + ' ' + money(l.rate); });
      out = '<strong>' + money(ot.total) + ' per hour</strong> (' + parts.join(' + ') + '), which is ' + money(ot.perBlock) + ' for each ' + ot.block + '-minute block';
    }
    if (ot.musicians) out += '. Live musicians charge their own overtime rate, which we pass through to Client';
    return out;
  }

  // ---------------------------------------------------------------------------
  // Payment and cancellation text
  // ---------------------------------------------------------------------------
  function paymentTermsFor(dateStr, terms, amounts, now) {
    terms = terms || DEFAULT_TERMS;
    amounts = amounts || {};
    var pct = terms.depositPercent + '%';
    var depPart = amounts.deposit !== null && amounts.deposit !== undefined ? pct + ' (' + money(amounts.deposit) + ')' : pct;
    var balPart = amounts.balance !== null && amounts.balance !== undefined ? ' (' + money(amounts.balance) + ')' : '';
    var ev = parseYMD(dateStr);
    var days = terms.balanceDueDays;
    if (ev === null) {
      return {
        paymentTerms: 'A non-refundable deposit of ' + depPart + ' is due at signing to reserve the date. The remaining balance' + balPart + ' is due ' + days + ' days before the event.',
        depositDueDate: 'Upon signing',
        balanceDueDate: days + ' days before the event'
      };
    }
    var daysUntil = Math.floor((ev - todayMs(now)) / DAY_MS);
    if (daysUntil <= days) {
      return {
        paymentTerms: 'Because the event is ' + days + ' days away or less, the full amount is due at signing. The ' + pct + ' deposit is non-refundable.',
        depositDueDate: 'Upon signing',
        balanceDueDate: 'Upon signing'
      };
    }
    var due = fmtDate(ev - days * DAY_MS, false);
    return {
      paymentTerms: 'A non-refundable deposit of ' + depPart + ' is due at signing to reserve the date. The remaining balance' + balPart + ' is due no later than ' + due + ', which is ' + days + ' days before the event.',
      depositDueDate: 'Upon signing',
      balanceDueDate: due
    };
  }

  function cancellationHtml(ctx) {
    var t = ctx.terms, tot = ctx.total, dep = ctx.deposit;
    var near = t.cancelNearDays, far = t.cancelFarDays;
    var cols = tot !== null;
    var amt = cols ? [money(dep), money(round2(dep + (tot - dep) * t.cancelMidPercent / 100)), money(tot)] : [];
    var rows = [
      [far + ' days or more before the event', 'The deposit only (' + t.depositPercent + '% of the total)'],
      [near + ' to ' + (far - 1) + ' days before the event', 'The deposit plus ' + t.cancelMidPercent + '% of the remaining balance'],
      ['Fewer than ' + near + ' days before the event', 'The full contract balance']
    ];
    var h = '<p>Client must cancel in writing (email is fine). Days count from the day we receive the notice to the day of the event. The deposit is never refundable, because it reserves the date and the crew and equipment we set aside.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:0 0 14px;"><thead><tr><th style="' + TH + '">When Client cancels</th><th style="' + TH + '">Client owes</th>' +
      (cols ? '<th style="' + TH + 'text-align:right;">For this event</th>' : '') + '</tr></thead><tbody>';
    rows.forEach(function (r, i) {
      h += '<tr><td style="' + TD + '">' + r[0] + '</td><td style="' + TD + '">' + r[1] + '</td>' + (cols ? '<td style="' + TD + 'text-align:right;">' + amt[i] + '</td>' : '') + '</tr>';
    });
    return h + '</tbody></table><p>Payments already made count toward what Client owes. We refund any overpayment.</p>';
  }

  // One-line versions for the "Agreement at a glance" box. The full terms stay in the sections below.
  function cancellationSummary(ctx) {
    var t = ctx.terms;
    return 'The deposit is non-refundable. ' + t.cancelFarDays + ' or more days out: deposit only. ' +
      t.cancelNearDays + ' to ' + (t.cancelFarDays - 1) + ' days: deposit plus ' + t.cancelMidPercent + '% of the balance. ' +
      'Under ' + t.cancelNearDays + ' days: full balance.';
  }

  function overtimeSummary(ctx) {
    var ot = ctx.overtime, t = ctx.terms, out;
    if (!ot.lines.length) {
      out = money(t.overtimeDjRate) + ' per hour for a DJ with sound, plus ' + money(t.overtimeCrewRate) + ' per hour for each additional crew member, billed in ' + ot.block + '-minute blocks';
    } else {
      out = money(ot.total) + ' per hour, billed in ' + ot.block + '-minute blocks (' + money(ot.perBlock) + ' per block)';
    }
    if (ot.musicians) out += '. Live musicians charge their own overtime rate, which we pass through to Client';
    return out + '. Client approves it on site first.';
  }

  // ---------------------------------------------------------------------------
  // Booked items table
  // ---------------------------------------------------------------------------
  var TD = 'padding:8px 10px;border-bottom:1px solid #999;vertical-align:top;';
  var TH = 'padding:8px 10px;border-bottom:2px solid #333;text-align:left;';

  function bookedItemsHtml(ctx) {
    if (!ctx.hasEvent) return '<p>[The booked items and prices appear here once the contract is created from an event.]</p>';
    var svcs = ctx.services, price = ctx.price;
    if (!svcs.length && !price) {
      return '<p>Services to be confirmed. The booked items will be listed here.</p>';
    }
    var rows = [], usedLine = {};
    if (price) {
      var m = matchLines(svcs.filter(function (s) { return !s.fromLine; }), price.lines);
      var si = 0;
      svcs.forEach(function (s) {
        if (s.fromLine) {
          // services built from lines: price comes from the line they came from
          var li = -1;
          for (var j = 0; j < price.lines.length; j++) { if (!usedLine[j] && price.lines[j].desc === s.service) { li = j; break; } }
          if (li >= 0) usedLine[li] = true;
          rows.push({ service: s.name, detail: svcDetail(s), price: li >= 0 ? price.lines[li].price : null });
          return;
        }
        var idx = m.assign[si++];
        if (idx >= 0) usedLine[idx] = true;
        rows.push({ service: s.name, detail: svcDetail(s), price: idx >= 0 ? price.lines[idx].price : null });
      });
      price.lines.forEach(function (l, j) {
        if (!usedLine[j]) rows.push({ service: l.desc, detail: '', price: l.price });
      });
    } else {
      svcs.forEach(function (s) { rows.push({ service: s.name, detail: svcDetail(s), price: null }); });
    }
    var showPrice = !!price;
    var h = '<table style="width:100%;border-collapse:collapse;margin:0 0 14px;"><thead><tr><th style="' + TH + '">Service</th><th style="' + TH + '">Detail</th>' +
      (showPrice ? '<th style="' + TH + 'text-align:right;">Price</th>' : '') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td style="' + TD + '">' + esc(r.service) + '</td><td style="' + TD + '">' + esc(r.detail) + '</td>' +
        (showPrice ? '<td style="' + TD + 'text-align:right;">' + (r.price !== null ? esc(money(r.price)) : 'Not itemized') + '</td>' : '') + '</tr>';
    });
    if (showPrice) {
      var tax = round2(price.total - price.subtotal);
      var span = 'colspan="2" style="' + TD + 'text-align:right;font-weight:bold;"';
      if (tax > 0.005) {
        h += '<tr><td ' + span + '>Subtotal</td><td style="' + TD + 'text-align:right;">' + esc(money(price.subtotal)) + '</td></tr>';
        h += '<tr><td ' + span + '>Tax</td><td style="' + TD + 'text-align:right;">' + esc(money(tax)) + '</td></tr>';
      }
      h += '<tr><td ' + span + '>Total</td><td style="' + TD + 'text-align:right;font-weight:bold;">' + esc(money(price.total)) + '</td></tr>';
    }
    h += '</tbody></table>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Service modules. Included only when a matching service is booked.
  // Setup time, space and power for every booked service live once, in the table under "What we need from you".
  // The effects (CO2, cold spark, clouds, other effects) share one "Effects and equipment safety" block.
  // ---------------------------------------------------------------------------
  var MODULE_ORDER = ['dj_mc', 'audio', 'lighting', 'gobo', 'display', 'co2', 'coldspark', 'clouds', 'fx', 'musicians', 'other'];
  var EFFECT_KEYS = ['co2', 'coldspark', 'clouds', 'fx'];

  // Setup minutes per module. Edit here to change what the contracts say.
  var MODULE_SETUP = { dj_mc: 90, audio: 60, lighting: 120, gobo: 60, display: 120, co2: 60, coldspark: 90, clouds: 60, fx: 60, musicians: 60, other: 60 };

  function moduleKeysFor(ctx) {
    var h = ctx.has, out = [];
    if (h.dj || h.mc) out.push('dj_mc');
    if (h.audio) out.push('audio');
    if (h.lighting) out.push('lighting');
    if (h.gobo) out.push('gobo');
    if (h.display) out.push('display');
    if (h.co2) out.push('co2');
    if (h.coldspark) out.push('coldspark');
    if (h.clouds) out.push('clouds');
    if (h.fx) out.push('fx');
    if (h.musicians) out.push('musicians');
    var hasOther = ctx.services.some(function (s) { return s.keys.length === 1 && s.keys[0] === 'other'; });
    if (hasOther) out.push('other');
    return MODULE_ORDER.filter(function (k) { return out.indexOf(k) >= 0; });
  }

  function itemsText(ctx, keys) {
    var names = [];
    ctx.services.forEach(function (s) {
      var hit = keys.some(function (k) { return s.keys.indexOf(k) >= 0; });
      if (hit) names.push(esc(s.name + (s.sub ? ' (' + s.sub + ')' : '')));
    });
    return names.length ? names.join('; ') : 'the services listed in the booked items table';
  }

  // One list item: bold label, then the text.
  function L(label, text) { return '<li><strong>' + label + '.</strong> ' + text + '</li>'; }

  var STOP_LINE = 'We may stop, pause or reduce any effect at any time if we believe it is unsafe, if venue staff, a fire marshal or another authority tells us to, or if weather or crowd conditions call for it. If we stop an effect because of a problem with our own equipment, we credit that effect\'s line item. In every other case the price of the line item is not refunded.';

  // Power wording. 'venue' is the standard text. The two generator modes replace every outlet line.
  // Generator wording needs the owner and an attorney to check it (contracts-README.md).
  function gen(ctx) { return ctx.powerSource !== 'venue'; }
  function powerText(ctx) {
    if (ctx.powerSource === 'client_generator') {
      return 'Client provides a generator that can run our equipment and has it in place at load-in. Client confirms with the venue that a generator is allowed and puts it within 100 feet of our setup, in a safe, ventilated, level spot, with a clear path for cables.';
    }
    return 'We bring and run a generator for our equipment. Client confirms with the venue that a generator is allowed and gives us a safe, ventilated, level spot for it within 100 feet of our setup, with a clear path for cables.';
  }

  function co2Fine(ctx) {
    var f = [];
    ctx.services.forEach(function (s) { s.fine.forEach(function (k) { if (f.indexOf(k) < 0) f.push(k); }); });
    return { jets: f.indexOf('co2jet') >= 0, cannon: f.indexOf('co2cannon') >= 0 };
  }

  function moduleTitle(ctx, k) {
    var h = ctx.has;
    if (k === 'dj_mc') return h.dj && h.mc ? 'DJ and MC services' : (h.mc && !h.dj ? 'MC services' : 'DJ services');
    if (k === 'co2') {
      var c = co2Fine(ctx);
      return c.jets && c.cannon ? 'CO2 jets and CO2 cannon' : (c.cannon ? 'CO2 cannon' : (c.jets ? 'CO2 jets' : 'CO2 effects'));
    }
    return { audio: 'Audio and public address', lighting: 'Lighting', gobo: 'Gobo and logo projection', display: 'LED video wall, TV displays and projection',
      coldspark: 'Cold spark', clouds: 'Dancing on clouds (low fog)', fx: 'Other effects (fog, haze, confetti)', musicians: 'Live musicians', other: 'Other booked services' }[k];
  }

  // Setup time and what we need, one row per booked service. Shown once, under "What we need from you".
  var NEEDS = {
    dj_mc: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.dj_mc) + ' before the start time',
        'A spot of about 8 by 6 feet near the dance floor' + (g ? ' and a clear path for equipment.' : ', a grounded power outlet within 25 feet, and a clear path for equipment.') +
        ' Confirm sound limits, curfews and any outside-DJ rules with the venue before the event.'];
    },
    audio: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.audio) + ' before the start time',
        'Floor space or stands for speakers where we agree' + (g ? '.' : ', and a grounded power outlet nearby.') +
        ' Confirm sound limits and curfew with the venue in advance, and tell us before the event if it has its own sound system or house technician.'];
    },
    lighting: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.lighting) + ' before guests arrive',
        (g ? 'Uplights along the walls need a clear path for our cabling; dance floor and stage fixtures need floor space near the dance floor or stage.' : 'Uplights along the walls need an outlet within reach or a clear path for our cabling; dance floor and stage fixtures need floor space and power near the dance floor or stage.') +
        ' Send color choices at least ' + ctx.terms.detailsDueDays + ' days before the event. Confirm the venue\'s rules on placing, taping, hanging or rigging lights in advance; anything hung or rigged from a ceiling or truss needs the venue\'s written approval.'];
    },
    gobo: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.gobo) + ' before guests arrive',
        'A clear path to a flat, light-colored surface' + (g ? '.' : ' and a grounded power outlet nearby.') +
        ' Image quality depends on the surface and the room\'s brightness. Confirm with the venue in advance that projection on its walls, ceilings or floors is allowed.'];
    },
    display: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.display) + ' of clear venue access before guests arrive',
        'A flat, level floor' + (g ? '.' : ' and dedicated 20-amp circuits (confirm power with the venue before the event).') +
        ' Anything flown or rigged needs the venue\'s written approval and its approved rigging plan. Ground-stacked walls need a clear area around them.'];
    },
    co2: function () {
      return ['About ' + fmtMinutes(MODULE_SETUP.co2) + ' before guests arrive',
        'Device positions agreed before the event, good ventilation indoors, and written venue approval (see Effects and equipment safety).'];
    },
    coldspark: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.coldspark) + ' before guests arrive',
        'The clearances in Effects and equipment safety, ' + (g ? '' : 'a grounded power outlet near each machine, ') + 'and written venue approval.'];
    },
    clouds: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.clouds) + ' before guests arrive',
        'A smooth, level dance floor, space for the machine at the edge of the floor, ' + (g ? '' : 'a grounded power outlet nearby, ') + 'good ventilation, and written venue approval.'];
    },
    fx: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.fx) + ' before guests arrive',
        (g ? 'Good ventilation indoors and written venue approval.' : 'A grounded power outlet nearby, good ventilation indoors, and written venue approval.')];
    },
    musicians: function (ctx, g) {
      return ['About ' + fmtMinutes(MODULE_SETUP.musicians) + ' before their first set, for setup and a sound check',
        'A performance area of about 10 by 8 feet, ' + (g ? '' : 'grounded power, ') + 'cover from sun and rain if the event is outdoors, and a private place for cases and changing. Confirm the venue allows amplified live music and tell us about any sound limits or curfew.'];
    },
    other: function () {
      return ['To be confirmed', 'We confirm setup, space and power needs for these items with Client before the event.'];
    }
  };

  function needsTableHtml(ctx, keys) {
    if (!keys.length) return '';
    var g = gen(ctx);
    var h = '<h3>What each booked service needs</h3><table style="width:100%;border-collapse:collapse;margin:0 0 14px;"><thead><tr><th style="' + TH + 'width:22%;">Service</th><th style="' + TH + 'width:24%;">Setup time</th><th style="' + TH + '">What we need</th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var r = NEEDS[k](ctx, g);
      h += '<tr><td style="' + TD + '">' + moduleTitle(ctx, k) + '</td><td style="' + TD + '">' + r[0] + '</td><td style="' + TD + '">' + r[1] + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  // What each service includes and how we run it. The booked items table already names the items.
  // Setup, space, power and venue checks are in the needs table.
  var MODULES = {
    dj_mc: function (ctx) {
      var h = ctx.has;
      return '<h3>' + moduleTitle(ctx, 'dj_mc') + '</h3><ul>' +
        L('Included', (h.dj ? 'Our DJ plays music for the contracted hours on a professional sound system sized for the room, with microphones for announcements and toasts. The sound system is not a separate charge.' : '') +
          (h.mc ? (h.dj ? ' ' : '') + 'Our MC announces the program and keeps it moving on your timeline.' : '')) +
        L('Operation and safety', 'Our DJ and crew run all equipment. The DJ plays the style agreed with Client, takes short breaks with music still playing, and may decline a request that does not fit the program or the venue rules. We keep volume within the venue\'s limits, lower it if venue staff or an authority asks, and keep cables out of walkways.') +
        '</ul>';
    },
    audio: function (ctx) {
      return '<h3>' + moduleTitle(ctx, 'audio') + '</h3><ul>' +
        L('Included', 'Speakers, a mixer, microphones, stands and cabling for the contracted use, and a sound check before guests arrive.') +
        L('Operation and safety', 'Our audio technician runs the system. Speakers, presenters and other vendors who bring their own equipment coordinate with us first, and we are not responsible for equipment we did not supply. We keep volume within the venue\'s limits, secure stands and speakers, keep cables out of walkways, and turn the system down or off if venue staff or an authority asks.') +
        '</ul>';
    },
    lighting: function (ctx) {
      return '<h3>' + moduleTitle(ctx, 'lighting') + '</h3><ul>' +
        L('Included', 'Fixtures, stands, cabling and control.') +
        L('Operation and safety', 'Our lighting technician runs the lights, and guests and other vendors do not adjust fixtures. Flashing light can affect sensitive guests, so we use strobe effects only if Client approves them. We can turn any lighting effect off at any time and keep fixtures and cables out of walkways.') +
        '</ul>';
    },
    gobo: function (ctx) {
      return '<h3>' + moduleTitle(ctx, 'gobo') + '</h3><ul>' +
        L('Included', 'A projector or light that shows a monogram, logo or pattern on a wall, floor or other surface.') +
        L('Artwork', 'Send artwork (a vector file or a high-resolution image) at least ' + ctx.terms.detailsDueDays + ' days before the event. We show you a proof and use the version you approve.') +
        L('Operation and safety', 'Our lighting technician runs the projection and places the unit where guests cannot bump it or look into the beam. We may move, dim or turn off the projection if it creates a hazard or if venue staff ask.') +
        '</ul>';
    },
    display: function (ctx) {
      return '<h3>' + moduleTitle(ctx, 'display') + '</h3><ul>' +
        L('Included', 'Standard motion background content. A video wall includes panels, processor, stands or ground support, cabling and playback. A live camera feed (IMAG), a camera operator, recording and livestreaming are included only if they are listed in the booked items table.') +
        L('Content', 'Custom graphics, logos, slides or video must reach us at least 72 hours before the event. We cannot promise later changes.') +
        L('Operation and safety', 'Our AV technician installs and runs the display, and no one else changes the panel layout or the settings. No one may lean on, climb or move the wall, screens or stands. We may shut down or move a display if the footing is unsafe, if wind or weather puts an outdoor display at risk, or if venue staff ask.') +
        '</ul>';
    },
    musicians: function (ctx) {
      return '<h3>' + moduleTitle(ctx, 'musicians') + '</h3><ul>' +
        L('Included', 'Sets of the lengths listed in the booked items table.') +
        L('Operation and safety', 'Musicians play the style and set list agreed with Client and take short breaks between sets. If a DJ is booked, recorded music covers those breaks. We may pause a set if rain, wind or lightning puts the performers or their equipment at risk.') +
        L('Replacement', 'If a musician cannot perform because of illness or an emergency, we tell Client right away and offer a replacement of similar quality. If we cannot, we refund the price of that line item.') +
        L('Overtime', 'Live musicians charge their own overtime rate. We pass that rate through to Client at cost, in addition to the overtime rates in this agreement.') +
        L('Equipment', 'Instruments and gear belong to the musicians. Client is responsible for damage caused by guests or by Client\'s other vendors.') +
        '</ul>';
    },
    other: function (ctx) {
      var others = ctx.services.filter(function (s) { return s.keys.length === 1 && s.keys[0] === 'other'; }).map(function (s) { return esc(s.name + (s.sub ? ' (' + s.sub + ')' : '')); });
      return '<h3>' + moduleTitle(ctx, 'other') + '</h3>' +
        '<p>' + others.join('; ') + ' ' + (others.length > 1 ? 'are' : 'is') + ' provided on the terms in this agreement.</p>';
    }
  };

  // One block for every booked effect. Shared rules are written once; each effect adds only its own facts.
  function effectsHtml(ctx, keys) {
    var eff = EFFECT_KEYS.filter(function (k) { return keys.indexOf(k) >= 0; });
    if (!eff.length) return '';
    var t = ctx.terms, has = function (k) { return eff.indexOf(k) >= 0; };
    var c = co2Fine(ctx);

    var subj = [];
    if (has('co2')) subj.push('CO2 use');
    if (has('coldspark')) subj.push('cold spark');
    if (has('clouds') && !has('fx')) subj.push('fog');
    if (has('fx')) subj.push('fog, haze, confetti and similar effects');
    var subjText = subj.length > 1 ? subj.slice(0, -1).join(', ') + ' and ' + subj[subj.length - 1] : subj[0];
    subjText = subjText.charAt(0).toUpperCase() + subjText.slice(1);
    var verb = (subj.length === 1 && !has('fx')) ? 'needs' : 'need';

    var shared = '';
    shared += L('Venue approval', subjText + ' ' + verb + ' the venue\'s written approval before the event. Some venues and local fire departments also require a permit, advance notice or a fire marshal inspection. Client either obtains the approval or authorizes us in writing to obtain it for Client, at Client\'s cost. Send us a copy at least ' + t.detailsDueDays + ' days before the event. If the approval is not in place, we may leave the effect out, and the price of that line item is not refunded.');
    shared += L('Operator control', 'Only our trained crew operate effects equipment, not guests or venue staff.');
    if (has('co2') || has('coldspark')) shared += L('Safety zones', 'Client and the venue keep guests, including children, out of the safety zones and clearances below.');
    shared += L('Stopping an effect', STOP_LINE);
    if (has('co2') || has('clouds') || has('fx')) shared += L('Ventilation', 'Indoors, the room needs good ventilation.' + (has('co2') ? ' We may limit or decline CO2 use in a sealed or poorly ventilated space.' : ''));
    if (has('clouds') || has('fx')) shared += L('Smoke detectors', 'Fog and haze can set off smoke detectors, so Client coordinates with venue management to cover or disable detectors before the event. Client is responsible for any false alarm fees if a detector is not handled as agreed.');

    var each = '';
    if (has('co2')) {
      each += L(moduleTitle(ctx, 'co2'), 'We supply the equipment and the CO2 for the contracted moments only, and cannot promise extra activations beyond the booked scope. We place the devices at positions we agree on before the event.' +
        (c.jets ? ' Keep a guest-free zone of at least 8 feet around each jet while it runs.' : '') +
        (c.cannon ? ' We never aim a cannon at a person\'s face, and we keep at least 4 feet between a cannon blast and any guest.' : ''));
    }
    if (has('coldspark')) {
      each += L('Cold spark', 'Each machine needs 6 feet of clear space on all sides and 12 feet of clear height above it, away from drapes, fabric, decorations and ceilings. A fire extinguisher must be within 15 feet of each machine while it runs. We fire the machines at the moments in your timeline.');
    }
    if (has('clouds')) {
      each += L('Dancing on clouds (low fog)', 'A low-lying fog machine makes a ground-level cloud layer, usually for a first dance or another set moment. Each activation lasts about 3 to 5 minutes. Longer or continuous use is not included unless it is listed in the booked items table. Low fog hides the floor surface, so Client and the venue keep the dance floor dry and free of trip hazards.');
    }
    if (has('fx')) {
      each += L('Other effects (fog, haze, confetti)', 'For the contracted moments only. Many venues ban confetti or charge a cleanup fee. Client pays any cleanup fee the venue charges.');
    }
    return '<h3>Effects and equipment safety</h3>' +
      '<p><strong>Rules for every effect</strong></p><ol>' + shared + '</ol>' +
      '<p><strong>Rules for each effect booked</strong></p><ul>' + each + '</ul>';
  }

  function serviceSectionsHtml(ctx) {
    if (!ctx.hasEvent) return '<p>[Service sections appear here for the services booked on the event.]</p>';
    var keys = moduleKeysFor(ctx);
    var h = '<div class="bs-contract-modules">';
    if (!keys.length) {
      h += '<p>The other terms in this agreement apply to the services booked.</p>';
    } else {
      var doneFx = false;
      keys.forEach(function (k) {
        if (EFFECT_KEYS.indexOf(k) >= 0) {
          if (!doneFx) { h += effectsHtml(ctx, keys); doneFx = true; }
          return;
        }
        h += MODULES[k](ctx);
      });
    }
    return h + '</div>';
  }

  // ---------------------------------------------------------------------------
  // What we need from you: general points, then setup and needs for each booked service
  // ---------------------------------------------------------------------------
  function responsibilitiesHtml(ctx) {
    var t = ctx.terms, keys = moduleKeysFor(ctx);
    var setup = 90;
    keys.forEach(function (k) { if (MODULE_SETUP[k] > setup) setup = MODULE_SETUP[k]; });
    var power = 'Working, grounded power near each setup location.';
    if (gen(ctx)) power = powerText(ctx);
    var li = [];
    li.push('<strong>Venue access and load-in.</strong> Confirm the load-in time and route with the venue. At least ' + t.detailsDueDays + ' days before the event, tell us in writing where we load in and who meets us. We need clear access for at least ' + fmtMinutes(setup) + ' before guests arrive. If the venue shortens that window, we may reduce what we set up.');
    li.push('<strong>Power and space.</strong> ' + power + ' A flat, dry area, covered if outdoors, large enough for the equipment booked.');
    li.push('<strong>Crew meals and breaks.</strong> If our crew is on site more than five hours, provide a meal (or a 30-minute break to eat) and water for each member.');
    li.push('<strong>Vendor coordination.</strong> Share our contact details and the timeline with your other vendors. No other vendor may use, unplug or move our equipment without our approval.');
    li.push('<strong>Event details.</strong> Send the final timeline, announcements, name pronunciations, and must-play and do-not-play songs at least ' + t.detailsDueDays + ' days before the event. We try to handle later changes but cannot guarantee them.');
    li.push('<strong>One point of contact.</strong> Name one person we can reach on the day of the event who can approve overtime.');
    return '<ol>' + li.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' + needsTableHtml(ctx, keys);
  }

  // ---------------------------------------------------------------------------
  // Field values for the merge engine
  // ---------------------------------------------------------------------------
  function fieldValues(ctx) {
    var t = ctx.terms, v = {};
    function text(k, s) { v[k] = { text: s }; }
    function html(k, s) { v[k] = { html: s }; }

    var pay = paymentTermsFor(ctx.ev && ctx.ev.date, t, { deposit: ctx.deposit, balance: ctx.balance }, ctx.now);
    var svcText = ctx.services.length
      ? ctx.services.map(function (s) { return s.name + (s.sub ? ' (' + s.sub + ')' : ''); }).join(', ')
      : 'Services to be confirmed';

    text('client_name', ctx.clientName || '[Client Name]');
    if (ctx.company) html('client_email', (ctx.contactName ? 'Contact: ' + esc(ctx.contactName) + '<br>' : '') + esc(ctx.clientEmail || '[Client Email]'));
    else text('client_email', ctx.clientEmail || '[Client Email]');
    text('client_phone', ctx.clientPhone || '[Client Phone]');
    text('event_name', ctx.eventName || '[Event Name]');
    text('event_date', ctx.dateMs !== null ? fmtDate(ctx.dateMs, true) : '[Event Date]');
    text('event_time', ctx.timeText || '[Event Time]');
    text('event_type', KIND_LABEL[ctx.kind] || (ctx.typeRaw && !/^(event|inquiry|other)$/i.test(ctx.typeRaw) ? ctx.typeRaw : '[Event Type]'));
    text('venue_name', ctx.venue || '[Venue Name]');
    text('venue_address', ctx.venueAddress || '[Venue Address]');
    text('services_list', svcText);
    text('total_price', ctx.total !== null ? money(ctx.total) : '[Total TBD]');
    text('deposit_amount', ctx.deposit !== null ? money(ctx.deposit) : '[Deposit TBD]');
    text('balance_amount', ctx.balance !== null ? money(ctx.balance) : '[Balance TBD]');
    text('deposit_percent', t.depositPercent + '%');
    text('current_date', fmtDate(ctx.today, false));
    text('payment_terms', pay.paymentTerms);
    text('deposit_due_date', pay.depositDueDate);
    text('balance_due_date', pay.balanceDueDate);
    text('balance_due_days', String(t.balanceDueDays));
    text('details_due_days', String(t.detailsDueDays));
    text('overtime_block_minutes', String(t.overtimeBlockMinutes));
    text('overtime_dj_rate', money(t.overtimeDjRate));
    text('overtime_crew_rate', money(t.overtimeCrewRate));
    text('portalurl', 'https://www.baselinestudiofl.com/portal-client.html');

    if (ctx.hasEvent) {
      html('booked_items_table', bookedItemsHtml(ctx));
      html('service_sections', serviceSectionsHtml(ctx));
    } else {
      html('booked_items_table', '<p>[The booked items and prices appear here once the contract is created from an event.]</p>');
      html('service_sections', '<p>[Service sections appear here for the services booked on the event.]</p>');
    }
    html('overtime_rate', overtimeRateHtml(ctx));
    text('cancellation_summary', cancellationSummary(ctx));
    text('overtime_summary', overtimeSummary(ctx));
    html('cancellation_terms', cancellationHtml(ctx));
    html('client_responsibilities', responsibilitiesHtml(ctx));
    return v;
  }

  var TOKEN_NAMES = ['client_name', 'client_email', 'client_phone', 'event_name', 'event_date', 'event_time', 'event_type', 'venue_name', 'venue_address',
    'services_list', 'total_price', 'deposit_amount', 'balance_amount', 'deposit_percent', 'current_date', 'payment_terms', 'deposit_due_date',
    'balance_due_date', 'balance_due_days', 'details_due_days', 'overtime_block_minutes', 'overtime_dj_rate', 'overtime_crew_rate', 'portalUrl',
    'booked_items_table', 'service_sections', 'overtime_rate', 'cancellation_terms', 'client_responsibilities',
    'cancellation_summary', 'overtime_summary'];

  function plainToHtml(s) {
    // template text is trusted, so its own {{tokens}} must survive; only markup characters are escaped
    var parts = esc(s).replace(/&#123;&#123;/g, '{{').split(/\n{2,}/);
    return parts.map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  // Signature block for the Client side. Company set: "Signed for <company> by". Name and title filled when known, blank lines when not.
  var SIG_CLIENT_OLD = '<p><strong>Client</strong><br>{{client_name}}</p>';
  function applyEventOptions(src, ctx) {
    if (ctx.company || ctx.signerName || ctx.signerTitle) {
      var blank = '____________________';
      var head = ctx.company ? '<strong>Signed for ' + esc(ctx.company) + ' by</strong>' : '<strong>Client</strong><br>{{client_name}}';
      var neu = '<p>' + head + '<br>Name: ' + (ctx.signerName ? esc(ctx.signerName) : blank) +
        '<br>Title: ' + (ctx.signerTitle ? esc(ctx.signerTitle) : blank) + '</p>';
      src = src.split(SIG_CLIENT_OLD).join(neu);
    }
    if (gen(ctx)) src = src.split('that power and space are available').join('that space is available');
    return src;
  }

  // The per-event options as the edit sheet shows them.
  function contractOptions(ev) {
    var e = ev || {};
    return {
      company: String(e.clientCompany || '').trim(),
      signerName: String(e.signerName || '').trim(),
      signerTitle: String(e.signerTitle || '').trim(),
      powerSource: (e.powerSource === 'generator' || e.powerSource === 'client_generator') ? e.powerSource : 'venue'
    };
  }

  // The one merge. ev may be null (template preview). opts.wrap(valueHtml, key, isHtml) can decorate each filled value.
  function merge(html, ev, env, opts) {
    opts = opts || {};
    var ctx = buildContext(ev, env);
    ctx.now = env && env.now;
    var vals = fieldValues(ctx);
    var src = String(html === null || html === undefined ? '' : html);
    if (!/<[a-zA-Z][^>]*>/.test(src)) src = plainToHtml(src);
    src = applyEventOptions(src, ctx);
    // legacy templates wrote "${{total_price}}"; the value already carries its own $
    src = src.replace(/\$(\{\{\s*(?:total_price|deposit_amount|balance_amount)\s*\}\})/gi, '$1');
    return src.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, function (m, name) {
      var key = name.toLowerCase();
      var val = vals[key];
      if (!val) return m;
      var isHtml = val.html !== undefined;
      var out = isHtml ? val.html : esc(val.text);
      return opts.wrap ? opts.wrap(out, key, isHtml) : out;
    });
  }

  // Summary of what the engine worked out for an event (used by tests and by the Documents tab hint).
  function analyze(ev, env) {
    var ctx = buildContext(ev, env);
    return {
      kind: ctx.kind,
      modules: moduleKeysFor(ctx),
      overtime: ctx.overtime,
      total: ctx.total,
      deposit: ctx.deposit,
      balance: ctx.balance,
      priceSource: ctx.price ? ctx.price.kind : null,
      services: ctx.services.map(function (s) { return s.name; })
    };
  }

  function hasModules(html) { return /bs-contract-modules/.test(String(html || '')); }

  // ---------------------------------------------------------------------------
  // Base templates
  // ---------------------------------------------------------------------------
  var TITLES = {
    generic: 'Generic Event Services Agreement',
    wedding: 'Wedding Event Services Agreement',
    quince: 'Quincea\u00f1era Event Services Agreement',
    mitzvah: 'Bar/Bat Mitzvah Event Services Agreement',
    sweet16: 'Sweet 16 Event Services Agreement',
    corporate: 'Corporate Event Services Agreement',
    birthday: 'Birthday and Private Party Event Services Agreement'
  };
  var KINDS = ['generic', 'wedding', 'quince', 'mitzvah', 'sweet16', 'corporate', 'birthday'];

  var SIG_BLOCK = '<table style="width:100%;border-collapse:collapse;"><tr>' +
    '<td style="width:50%;padding:0 20px 0 0;vertical-align:top;"><p><strong>Client</strong><br>{{client_name}}</p><div style="border-bottom:1px solid #333;height:46px;margin-bottom:6px;"></div><p>Signature</p><p>Date: ____________________</p></td>' +
    '<td style="width:50%;padding:0 0 0 20px;vertical-align:top;"><p><strong>Baseline Studio</strong><br>Authorized signer</p><div style="border-bottom:1px solid #333;height:46px;margin-bottom:6px;"></div><p>Signature</p><p>Date: ____________________</p></td>' +
    '</tr></table>';

  var LATE_START = 'If the program starts late, the contracted end time stays the same. Time added to make up for a late start is overtime and needs approval under the Overtime section.';

  var TYPE_SECTIONS = {
    wedding: {
      title: 'Ceremony, cocktail hour and reception',
      html: '<ol>' +
        '<li><strong>Ceremony.</strong> If our booked items include ceremony sound, we set up speakers and a microphone for the officiant and play the processional, recessional and music cues at the times in your timeline. Tell us the ceremony location, the start time and who gives us our cues. If the ceremony is in a different space than the reception, tell us at least {{details_due_days}} days before the event. A second location may need extra crew time or equipment, and any added cost is agreed in writing before the event.</li>' +
        '<li><strong>Cocktail hour.</strong> Background music starts when guests move to the cocktail area, unless your timeline says otherwise.</li>' +
        '<li><strong>Reception.</strong> We run the reception in the order of your final timeline (for example grand entrance, first dance, parent dances, toasts, dinner, cake and open dancing).</li>' +
        '<li><strong>Late start.</strong> ' + LATE_START + '</li>' +
        '</ol>'
    },
    quince: {
      title: 'Court of honor, choreography and timing',
      html: '<ol>' +
        '<li><strong>Court and choreography.</strong> The grand entrance, waltz and surprise dance run to music files. Send the final audio files, edited to the length your group rehearsed, at least {{details_due_days}} days before the event. We play the files you send and do not edit choreography music unless that is listed in the booked items table.</li>' +
        '<li><strong>Rehearsal and sound check.</strong> If the court needs to rehearse with our sound system, tell us. A rehearsal at the venue before the event day needs its own access time and is agreed in writing.</li>' +
        '<li><strong>Program and timing.</strong> We run the set moments (court presentation, waltz, parent dances, toast and surprise dance) in the order of the program you give us. ' + LATE_START + '</li>' +
        '</ol>'
    },
    mitzvah: {
      title: 'Shabbat, holidays and the hora',
      html: '<ol>' +
        '<li><strong>Shabbat and holidays.</strong> If the event is on a Friday evening, a Saturday or a Jewish holiday, or the start time depends on the end of Shabbat (Motzei Shabbos), tell us at least {{details_due_days}} days before the event. We follow your family\'s and the venue\'s rules about when we may load in, set up and turn equipment on. If setup has to happen before Shabbat begins or after it ends, our access window changes. Client confirms the access window with us in writing, and the program start moves with it.</li>' +
        '<li><strong>Hora, candle lighting and family moments.</strong> We play music and make announcements for the hora, candle lighting, blessings and other moments in the order of the program you give us. Send the program, with the names to announce and their pronunciations, at least {{details_due_days}} days before the event.</li>' +
        '<li><strong>Venue and food rules.</strong> If the venue or caterer follows kosher rules that limit outside food or equipment, tell us in advance so we can plan crew meals and equipment.</li>' +
        '<li><strong>Guests.</strong> Many guests are young. We play clean versions of songs unless Client tells us otherwise in writing.</li>' +
        '</ol>'
    },
    sweet16: {
      title: 'Program, guests and age',
      html: '<ol>' +
        '<li><strong>Program.</strong> Send the program (for example entrance, parent dances, candle ceremony, toast, games and open dancing) at least {{details_due_days}} days before the event. We run it in that order. ' + LATE_START + '</li>' +
        '<li><strong>Guests and age.</strong> Most guests are under 18. Client supervises guests and follows the venue\'s age rules. We play clean versions of songs unless Client tells us otherwise in writing. We do not serve or handle alcohol.</li>' +
        '<li><strong>The person signing.</strong> The person who signs for Client must be 18 or older and is responsible for payment under this agreement. An adult from the family must be our contact for the whole event.</li>' +
        '</ol>'
    },
    corporate: {
      title: 'Billing, purchase orders and run of show',
      html: '<ol>' +
        '<li><strong>Billing.</strong> This agreement is with the company or organization named as Client, and the person who signs says they have authority to sign for it. We send invoices to the contact above, or to an accounts payable address Client gives us in writing.</li>' +
        '<li><strong>Purchase orders.</strong> If Client\'s company requires a purchase order, send us the PO number before the deposit is due. A purchase order process does not change the payment dates unless we agree in writing. We provide an invoice and a W-9 on request.</li>' +
        '<li><strong>Run of show and AV.</strong> Send the run of show (agenda, speakers, presentations, cues and microphone needs) at least {{details_due_days}} days before the event, and presentations, videos and logos at least 72 hours before. Plan time for an AV check before doors open, and tell us who our contact is for speakers.</li>' +
        '<li><strong>Venue and company paperwork.</strong> If the venue or Client\'s company requires a certificate of insurance or other paperwork, tell us what it must say and when it is due, at least {{details_due_days}} days before the event.</li>' +
        '</ol>'
    },
    birthday: {
      title: 'Location and noise',
      html: '<ol>' +
        '<li><strong>Private locations.</strong> If the event is at a home, backyard, rooftop or other space that is not a regular event venue, Client confirms that we may load in, that power and space are available, and that any landlord, building or HOA rules (elevator reservations, quiet hours, parking) are met.</li>' +
        '<li><strong>Noise.</strong> Client is responsible for local noise rules and for neighbors. We lower the volume to the level the host, the venue or an authority asks for, and we stop if an officer tells us to.</li>' +
        '</ol>'
    }
  };

  function buildSections(kind) {
    var secs = [];
    secs.push({ title: 'Parties and event', html:
      '<p>This agreement is made on <strong>{{current_date}}</strong> between <strong>Baseline Studio</strong>, Miami, Florida (&quot;Baseline Studio,&quot; &quot;we&quot; or &quot;us&quot;) and <strong>{{client_name}}</strong> (&quot;Client&quot; or &quot;you&quot;).</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:0 0 14px;">' +
      '<tr><th style="' + TD + 'width:30%;text-align:left;">Client</th><td style="' + TD + '">{{client_name}}<br>{{client_email}}<br>{{client_phone}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Event</th><td style="' + TD + '">{{event_name}} ({{event_type}})</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Date and time</th><td style="' + TD + '">{{event_date}}<br>{{event_time}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Venue</th><td style="' + TD + '">{{venue_name}}<br>{{venue_address}}</td></tr>' +
      '</table>' });
    secs.push({ glance: true, html:
      '<h2>Agreement at a glance</h2><p><em>Plain-language summary. The full terms below are the agreement.</em></p>' +
      '<table style="width:100%;border-collapse:collapse;border:2px solid #333;margin:0 0 14px;">' +
      '<tr><th style="' + TD + 'width:30%;text-align:left;">Event</th><td style="' + TD + '">{{event_name}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Date and time</th><td style="' + TD + '">{{event_date}}, {{event_time}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Venue</th><td style="' + TD + '">{{venue_name}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Services included</th><td style="' + TD + '">{{services_list}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Total</th><td style="' + TD + '">{{total_price}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Deposit</th><td style="' + TD + '">{{deposit_amount}} ({{deposit_percent}}, non-refundable). Due: {{deposit_due_date}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Balance</th><td style="' + TD + '">{{balance_amount}}. Due: {{balance_due_date}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Cancellation</th><td style="' + TD + '">{{cancellation_summary}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Overtime</th><td style="' + TD + '">{{overtime_summary}}</td></tr>' +
      '<tr><th style="' + TD + 'text-align:left;">Client contact</th><td style="' + TD + '">{{client_email}}<br>{{client_phone}}</td></tr>' +
      '</table>' });
    secs.push({ title: 'What we provide', html:
      '<p>Baseline Studio will provide the services below at the event above.</p>{{booked_items_table}}' });
    secs.push({ title: 'Payment', html:
      '<p>{{payment_terms}}</p>' +
      '<p>Payment methods are listed on your invoice. We may pause work while a payment is late, and need not provide services if the balance is unpaid when the event starts.</p>' });
    secs.push({ title: 'Cancellation and rescheduling', html:
      '{{cancellation_terms}}' +
      '<ol>' +
      '<li><strong>Rescheduling.</strong> Client may ask in writing to move the event. If we are available on the new date, we move the booking and carry the deposit over. If not, and Client does not choose another date, the cancellation terms apply, counted from the original event date.</li>' +
      '<li><strong>If we cancel.</strong> If we cancel for any reason other than those in the Force majeure section, we refund every payment Client made, including the deposit, and help Client find a replacement.</li>' +
      '</ol>' });
    secs.push({ title: 'What we need from you', html:
      '{{client_responsibilities}}' +
      '<p><strong>Venue rules, permits and fees.</strong> Client follows the venue\'s rules (load-in times and routes, sound limits and curfews, approved vendor lists, insurance requirements, and rules about effects, projection, confetti and open flame) and gets any permit, fire marshal approval or noise permit that the venue, city or county requires. If the venue charges us a fee because of Client\'s event, we tell Client before the event when we know about it and pass the fee through at cost.</p>' });
    secs.push({ title: 'Overtime', html:
      '<p>Overtime is time past the contracted end time. For this event overtime is billed at {{overtime_rate}}.</p>' +
      '<ol>' +
      '<li>We bill overtime in {{overtime_block_minutes}}-minute blocks. Any part of a block counts as a full block.</li>' +
      '<li>Client, or the contact Client names, must approve overtime on site before it starts. Without approval we stop at the contracted end time.</li>' +
      '<li>Overtime goes on the final invoice with any overtime fees the venue charges us, which we pass through at cost.</li>' +
      '</ol>' });
    secs.push({ title: 'Service details', html: '{{service_sections}}' });
    if (TYPE_SECTIONS[kind]) secs.push({ title: TYPE_SECTIONS[kind].title, html: TYPE_SECTIONS[kind].html });
    secs.push({ title: 'Equipment, safety and conduct', html:
      '<ol>' +
      '<li><strong>Equipment.</strong> All equipment we bring stays our property. Client and the venue provide a secure place for it during the event and teardown. Client pays to repair or replace equipment that is damaged, lost or stolen because of guests, Client\'s other vendors or Client, other than normal wear. Keep food and drinks away from it.</li>' +
      '<li><strong>Crowd.</strong> Client and the venue manage the crowd and keep guests away from stages, cables, effects and equipment. Client supervises children. No climbing on or hanging from equipment; our crew may ask guests to step back.</li>' +
      '<li><strong>Weather.</strong> We may pause or stop work if lightning, high wind or heavy rain puts people or equipment at risk.</li>' +
      '<li><strong>Conduct.</strong> If anyone threatens or harasses our crew, or conditions become unsafe, we may pause work until it is resolved and leave if it continues, with no refund.</li>' +
      '</ol>' });
    secs.push({ title: 'Force majeure', html:
      '<p>Neither side is responsible for a delay or failure caused by something beyond its reasonable control, such as a hurricane or other severe weather, fire, flood, a government order, a venue closure, a power outage or a public emergency. If the event cannot take place for that reason, we move it to a new date within 12 months and apply Client\'s payments to it. If neither side can make a new date work, we refund Client\'s payments except the non-refundable deposit and any costs we cannot recover.</p>' });
    secs.push({ title: 'Limitation of liability', html:
      '<p>Our total liability for any claim connected with this agreement is limited to what Client has paid us under it. We are not liable for indirect, incidental or consequential damages, or for the acts of guests, the venue or other vendors, or for delays they cause.</p>' });
    secs.push({ title: 'Photos and video', html:
      '<p>We may photograph and film our setup and the event for our portfolio, website and social media. Client may opt out by checking the box below or by telling us in writing before the event.</p>' +
      '<p>[ ] Client opts out of photo and video use by Baseline Studio.</p>' });
    secs.push({ title: 'Governing law and general terms', html:
      '<ol>' +
      '<li>Florida law governs this agreement. Any dispute will be brought in the state or federal courts located in Miami-Dade County, Florida.</li>' +
      '<li>This is the whole agreement for this event. It replaces earlier quotes, emails and conversations.</li>' +
      '<li>Changes must be in writing and agreed by both sides. An email that both sides confirm counts as writing.</li>' +
      '<li>If a part of this agreement cannot be enforced, the rest stays in effect.</li>' +
      '<li>An electronic signature has the same effect as a handwritten one.</li>' +
      '</ol>' });
    secs.push({ title: 'Signatures', html:
      '<p>By signing, each side agrees to this agreement.</p>' + SIG_BLOCK });
    return secs;
  }

  function buildTemplateHtml(kind) {
    var secs = buildSections(kind);
    var h = '<h1>' + TITLES[kind] + '</h1>';
    var n = 0;
    secs.forEach(function (s) {
      if (s.glance) { h += s.html; return; }
      n++;
      h += '<h2>' + n + '. ' + s.title + '</h2>' + s.html;
    });
    return h;
  }

  function templateDefs() {
    return KINDS.map(function (k) {
      var html = buildTemplateHtml(k);
      return {
        id: 'tpl-contract-' + k, name: TITLES[k], category: 'client',
        contentHTML: html, content: html,
        contractKind: k, builtin: true, builtinVersion: VERSION
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Legacy built-ins (verbatim text of the two old agreements, short and HTML versions)
  // ---------------------------------------------------------------------------
  var LEGACY = [
    {
      "name": "DJ Services Agreement",
      "text": "DJ SERVICES AGREEMENT - Between Baseline Studio and {{client_name}} for {{event_date}} at {{venue_name}}. Services: {{services_list}}. Investment: ${{total_price}}. Terms: Deposit due on signing, balance 10 days prior. Cancellation: 90+ days full refund, 30-90 days 50% forfeited, <30 days all fees forfeited. Overtime: $200/hr. Baseline Studio | (786) 302-6056"
    },
    {
      "name": "Full Production Agreement",
      "text": "FULL EVENT PRODUCTION AGREEMENT - Client: {{client_name}}, Event: {{event_type}} on {{event_date}} at {{venue_name}}. Services: {{services_list}}. Total: ${{total_price}}, Deposit: ${{deposit_amount}}. Cancellation: 90+ full refund, 30-90 50% retained, <30 all forfeited. Baseline Studio | (786) 302-6056"
    },
    {
      "name": "DJ Services Agreement",
      "text": "<h1>DJ Services Agreement</h1><p>This Agreement is made as of <strong>{{current_date}}</strong>, between <strong>Baseline Studio</strong> (\"Company\") and <strong>{{client_name}}</strong> (\"Client\").</p><h2>1. Event Details</h2><p><strong>Event Date:</strong> {{event_date}}<br><strong>Event Type:</strong> {{event_type}}<br><strong>Venue:</strong> {{venue_name}}<br><strong>Services:</strong> {{services_list}}</p><h2>2. Compensation</h2><p>Total contract price: <strong>{{total_price}}</strong>. A non-refundable deposit of <strong>{{deposit_amount}}</strong> is due upon signing to hold the date. Remaining balance is due 14 days before the event.<br>{{payment_terms}}</p><h2>3. Services</h2><p>Baseline Studio will provide professional DJ and entertainment services as listed above. Setup begins at least 90 minutes before the event start time unless otherwise agreed in writing.</p><h2>4. Cancellation</h2><p>Cancellations made more than 90 days before the event: deposit is forfeited, no further payment owed. Within 90 days: 50% of remaining balance due. Within 30 days: full remaining balance due.</p><h2>5. Liability</h2><p>Baseline Studio is not liable for circumstances beyond our control. In such cases we will work with the client to reschedule or provide a credit.</p><h2>6. Agreement</h2><p>Both parties have read and agree to these terms.</p><br><table style=\"width:100%;border-collapse:collapse;\"><tr><td style=\"width:50%;padding-right:20px;vertical-align:top;\"><p><strong>Client Signature</strong></p><div style=\"border-bottom:2px solid #333;height:50px;margin-bottom:8px;\"></div><p style=\"font-size:12px;\">Printed Name: ______________________________</p><p style=\"font-size:12px;\">Date: ______________</p></td><td style=\"width:50%;padding-left:20px;vertical-align:top;\"><p><strong>Baseline Studio</strong></p><div style=\"border-bottom:2px solid #333;height:50px;margin-bottom:8px;\"></div><p style=\"font-size:12px;\">Authorized Signature</p><p style=\"font-size:12px;\">Date: ______________</p></td></tr></table>"
    }
  ];
  var LEGACY_NAMES = ['DJ Services Agreement', 'Full Production Agreement'];

  function visibleText(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isUntouchedLegacy(t) {
    if (!t || LEGACY_NAMES.indexOf(t.name) < 0) return false;
    var originals = LEGACY.filter(function (o) { return o.name === t.name; }).map(function (o) { return visibleText(o.text); });
    var fields = [t.contentHTML, t.content].filter(function (x) { return x !== undefined && x !== null && String(x).trim() !== ''; });
    if (!fields.length) return false;
    return fields.every(function (f) { return originals.indexOf(visibleText(f)) >= 0; });
  }

  // Fingerprints (visible text, see fingerprint()) of the stock wording shipped in earlier versions.
  // A stored template whose text matches one of these has never been edited by the owner, so it can be refreshed.
  // Anything else is the owner's own version and is never touched.
  var STOCK_HISTORY = {
    'tpl-contract-generic':   { 1: '5864:ebdaf79b' },
    'tpl-contract-wedding':   { 1: '6946:a064f6b0' },
    'tpl-contract-quince':    { 1: '6797:a5a10442' },
    'tpl-contract-mitzvah':   { 1: '6991:46834547' },
    'tpl-contract-sweet16':   { 1: '6691:a73e09c0' },
    'tpl-contract-corporate': { 1: '7058:16065717' },
    'tpl-contract-birthday':  { 1: '6531:86ddf7fa' }
  };

  function fingerprint(s) {
    var t = visibleText(s), h = 2166136261;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return t.length + ':' + h.toString(16);
  }

  // 'current' = text of this version, 'old' = untouched stock text of an earlier version, 'edited' = anything else.
  function stockStatus(t, def) {
    var fields = [t.contentHTML, t.content].filter(function (x) { return x !== undefined && x !== null && String(x).trim() !== ''; });
    if (!fields.length) return 'edited';
    var hist = STOCK_HISTORY[def.id] || {}, old = Object.keys(hist).map(function (k) { return hist[k]; });
    var cur = fingerprint(def.contentHTML);
    if (fields.every(function (f) { return fingerprint(f) === cur; })) return 'current';
    if (fields.every(function (f) { return old.indexOf(fingerprint(f)) >= 0; })) return 'old';
    return 'edited';
  }

  // Add the contract templates once, refresh untouched stock templates to the current wording, rename untouched legacy agreements,
  // report edited ones. Pure: returns a new templates array and a new settings object. Nothing is deleted.
  function ensureTemplates(existing, settings) {
    var list = Array.isArray(existing) ? existing.map(function (t) { return t; }) : [];
    var s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    var seed = {}; var k;
    if (s.contractSeed && typeof s.contractSeed === 'object') for (k in s.contractSeed) seed[k] = s.contractSeed[k];
    var added = [], renamed = [], keptEdited = [], changed = false;

    list = list.map(function (t) {
      if (!t || LEGACY_NAMES.indexOf(t.name) < 0) return t;
      if (isUntouchedLegacy(t)) {
        renamed.push({ id: t.id, from: t.name });
        changed = true;
        var copy = {}; for (var p in t) copy[p] = t[p];
        copy.name = '(Legacy) ' + t.name;
        return copy;
      }
      keptEdited.push({ id: t.id, name: t.name });
      return t;
    });

    var fresh = [], refreshed = [], staleEdited = [];
    templateDefs().forEach(function (def) {
      var idx = -1;
      list.forEach(function (t, i) { if (idx < 0 && t && t.id === def.id) idx = i; });
      if (idx >= 0) {
        var st = stockStatus(list[idx], def);
        if (st === 'old') {
          // untouched stock text of an earlier version: swap in the new wording, keep the owner's id, name and other fields
          var copy = {}; for (var q in list[idx]) copy[q] = list[idx][q];
          copy.contentHTML = def.contentHTML; copy.content = def.content; copy.builtinVersion = VERSION; copy.contractKind = def.contractKind;
          list[idx] = copy; refreshed.push(def.id); seed[def.id] = VERSION; changed = true;
        } else if (st === 'edited') {
          // the owner changed this one: leave it alone, report it once
          if ((seed[def.id] || 0) < VERSION) { staleEdited.push({ id: def.id, name: list[idx].name }); seed[def.id] = VERSION; changed = true; }
        } else if (seed[def.id] !== VERSION) { seed[def.id] = VERSION; changed = true; }
        return;
      }
      if (seed[def.id]) return;                 // seeded before and then deleted by the owner: leave it gone
      fresh.push(def); seed[def.id] = VERSION; added.push(def.id); changed = true;
    });
    list = fresh.concat(list);
    keptEdited = keptEdited.concat(staleEdited);

    var ns = {}; for (k in s) ns[k] = s[k];
    ns.contractSeed = seed;
    if (refreshed.length || staleEdited.length) ns.contractRefresh = { version: VERSION, refreshed: refreshed, keptEdited: staleEdited.map(function (x) { return x.id; }) };
    return { templates: list, settings: ns, added: added, renamed: renamed, refreshed: refreshed, keptEdited: keptEdited, changed: changed };
  }

  // ---------------------------------------------------------------------------
  // Auto-select
  // ---------------------------------------------------------------------------
  function pickTemplate(ev, templates) {
    var list = Array.isArray(templates) ? templates : [];
    var kind = resolveKind(ev);
    function byId(id) { for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
    var tpl = kind ? byId('tpl-contract-' + kind) : null;
    var fallback = false;
    if (!tpl) { tpl = byId('tpl-contract-generic'); fallback = true; }
    return { template: tpl, kind: kind || 'generic', fallback: fallback, typeUnknown: !kind };
  }

  function mergeForEvent(html, ev, env, opts) { return merge(html, ev, env, opts); }

  root.BSContracts = {
    version: VERSION,
    DEFAULT_TERMS: DEFAULT_TERMS,
    TERM_FIELDS: TERM_FIELDS,
    TOKENS: TOKEN_NAMES,
    KINDS: KINDS,
    TITLES: TITLES,
    getTerms: getTerms,
    validateTerms: validateTerms,
    normalizeType: normalizeType,
    eventTypeFromText: eventTypeFromText,
    resolveKind: resolveKind,
    classify: classify,
    merge: merge,
    mergeForEvent: mergeForEvent,
    analyze: analyze,
    hasModules: hasModules,
    paymentTermsFor: paymentTermsFor,
    templateDefs: templateDefs,
    ensureTemplates: ensureTemplates,
    isUntouchedLegacy: isUntouchedLegacy,
    pickTemplate: pickTemplate,
    contractOptions: contractOptions,
    money: money,
    esc: esc
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
