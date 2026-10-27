/* HomeQuest website — map, area/condo cards, shortlist, filters. */
(function () {
  'use strict';

  var SCORE_AXES = ['Parks & nature', 'Car to VivoCity', 'Price', 'Quiet area', 'Holds value'];
  var SCORE_SHORT = ['Parks', 'Car', 'Price', 'Quiet', 'Value'];
  var SCORE_WEIGHTS = [20, 30, 15, 15, 20];     // same order as SCORE_AXES; add up to 100 (agreed 24 Oct)
  var PRICE_STEPS = [800000, 1000000, 1200000, 1400000, 1600000, 1800000, 2000000, 2200000, 2500000];   // budget S$2.5M (25 Oct)

  var S = {
    listings: [], condos: {}, areas: {}, meta: {},
    condoView: (function () { try { return localStorage.getItem('hqCondoView') || 'list'; } catch (e) { return 'list'; } })(),
    shortlist: [], shortAdded: {}, ura: {}, rent: {}, mcst: {}, nearby: {}, google: {}, panel: null, hover: null, peekOff: null,
    shortView: { q: '', area: '', beds: 0, sort: 'added' },
    eview: 'all',      // ethnic groups: 'all' residents or 'private' (condo & landed estimate)
    filters: { min: 0, max: 0, sizeMin: 0, sizeMax: 0, psfMin: 0, psfMax: 0, beds: [], floor: [], types: [], tenure: [], lease: [], age: [], baths: [],
      mrt: [], rent: [], region: [], districts: [], listed: [], other: [] }
  };
  var map, areaLayer, pinLayer, labelLayer, selLayer;
  var markers = {};

  // ---- small helpers ----------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2).replace(/0$/, '') + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + v;
  }
  function full(v) { return v == null ? '—' : '$' + Math.round(v).toLocaleString('en-SG'); }
  function median(xs) {
    xs = xs.filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    if (!xs.length) return null;
    var m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  }
  function mode(xs) {
    var c = {}, best = null;
    xs.forEach(function (x) { if (x != null) { c[x] = (c[x] || 0) + 1; if (best === null || c[x] > c[best]) best = x; } });
    return best;
  }
  function pct(part, whole) { return whole ? Math.round(100 * part / whole) + '%' : '—'; }
  function range(xs, fmt) {
    xs = xs.filter(function (x) { return x != null; });
    if (!xs.length) return '—';
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    return lo === hi ? fmt(lo) : fmt(lo) + '–' + fmt(hi);
  }
  function isFreehold(t) { return /freehold/i.test(t || '') || /^9\d\d-year/.test(t || ''); }
  function bedsText(b) { return b == null ? '—' : (b === 0 ? 'Studio' : b + ' bed'); }
  function soon(text) { return '<span class="soon-text">' + esc(text || 'coming soon') + '</span>'; }
  function api(path, opts) {         // online copy (Lantern): login.js answers instead of the Mac mini's server
    if (window.HQ_API) return window.HQ_API(path, opts);
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  // ---- data -------------------------------------------------------------------
  // Filters (generic set agreed 25 Oct). Chip groups are lists; an empty list = any.
  var CCR = ['D01', 'D02', 'D06', 'D09', 'D10', 'D11'], RCR = ['D03', 'D04', 'D05', 'D07', 'D08', 'D12', 'D13', 'D14', 'D15', 'D20'];
  function regionOf(d) { return CCR.indexOf(d) >= 0 ? 'CCR' : (RCR.indexOf(d) >= 0 ? 'RCR' : 'OCR'); }
  function typeOf(l) { return l.ec || /executive/i.test(l.type || '') ? 'EC' : (/apartment/i.test(l.type || '') ? 'Apartment' : 'Condo'); }
  function tenureOf(t) { return /freehold/i.test(t || '') ? 'free' : (/^9\d\d-year/.test(t || '') ? '999' : (/year|lease/i.test(t || '') ? '99' : '')); }
  function rentLevel(c) {
    if (!c || !c.rent || !c.mcst || !c.mcst.units) return '';
    var cut = monthsAgo(12), p = share(c.rent.rentals.filter(function (x) { return x.month > cut; }).length, c.mcst.units);
    return p >= 20 ? 'high' : (p >= 8 ? 'mid' : 'low');
  }
  function daysAgo(d) { return d ? (Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5 : Infinity; }
  function visible(l) {
    var f = S.filters, c = S.condos[l.condo];
    if (f.min && (l.price == null || l.price < f.min)) return false;
    if (f.max && (l.price == null || l.price > f.max)) return false;
    if (f.sizeMin && (l.size == null || l.size < f.sizeMin)) return false;
    if (f.sizeMax && (l.size == null || l.size > f.sizeMax)) return false;
    if (f.psfMin && (l.psf == null || l.psf < f.psfMin)) return false;
    if (f.psfMax && (l.psf == null || l.psf > f.psfMax)) return false;
    if (f.beds.length && f.beds.indexOf(String(Math.min(l.beds || 0, 5))) < 0) return false;
    if (f.baths.length && f.baths.indexOf(String(Math.min(l.baths || 0, 3))) < 0) return false;
    if (f.floor.length && f.floor.indexOf(l.floor || 'none') < 0) return false;
    if (f.types.length && f.types.indexOf(typeOf(l)) < 0) return false;
    if (f.tenure.length && f.tenure.indexOf(tenureOf(l.tenure)) < 0) return false;
    if (f.lease.length && c) { var left = leaseLeft(c); if (left == null || left < +f.lease[0]) return false; }
    if (f.age.length) {
      var age = l.built ? new Date().getFullYear() - l.built : null;
      if (age == null || !f.age.some(function (a) { return a === 'new' ? age <= 5 : (a === '5' ? age > 5 && age <= 10 : (a === '10' ? age > 10 && age <= 20 : age > 20)); })) return false;
    }
    if (f.mrt.length) {
      var walk = c && c.near && c.near.mrt && c.near.mrt.walkMin != null ? c.near.mrt.walkMin : l.mrtMin;
      if (walk == null || walk > +f.mrt[0]) return false;
    }
    if (f.rent.length && f.rent.indexOf(rentLevel(c)) < 0) return false;
    if (f.region.length && f.region.indexOf(regionOf(l.district)) < 0) return false;
    if (f.districts.length && f.districts.indexOf(l.district) < 0) return false;
    if (f.listed.length && daysAgo(l.firstSeen) > +f.listed[0]) return false;
    if (f.other.indexOf('review') >= 0 && !l.reviewUrl) return false;
    return true;
  }


  function buildCondos() {
    var c = {};
    S.listings.forEach(function (l) {
      var x = c[l.condo] || (c[l.condo] = { key: l.condo, name: l.name, units: [] });
      x.units.push(l);
    });
    Object.keys(c).forEach(function (k) {
      var x = c[k], u = x.units, placed = u.filter(function (l) { return l.lat != null; });
      x.lat = placed.length ? placed.reduce(function (s, l) { return s + l.lat; }, 0) / placed.length : null;
      x.lng = placed.length ? placed.reduce(function (s, l) { return s + l.lng; }, 0) / placed.length : null;
      x.area = mode(u.map(function (l) { return l.area; }));
      x.address = mode(u.map(function (l) { return l.address || null; })) || '';
      x.district = mode(u.map(function (l) { return l.district || null; })) || '';
      x.tenure = mode(u.map(function (l) { return l.tenure || null; })) || '';
      x.built = mode(u.map(function (l) { return l.built; }));
      x.ec = u.some(function (l) { return l.ec; });
      x.mrt = (u.slice().sort(function (a, b) { return (a.mrtMin || 99) - (b.mrtMin || 99); })[0] || {}).mrt || '';
      x.review = u.filter(function (l) { return l.reviewUrl; })[0] || null;
      x.ura = S.ura[k] || null;
      x.rent = S.rent[k] || null;
      x.mcst = S.mcst[k] || null;
      x.near = S.nearby[k] || null;
      x.subzone = mode(u.map(function (l) { return l.subzone || null; }));
      x.units.sort(function (a, b) { return (a.price || 9e9) - (b.price || 9e9); });
    });
    S.condos = c;
    var dens = Object.keys((S.meta.census || {}).subzones || {}).map(function (k) { return S.meta.census.subzones[k].perKm2; })
      .filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    Object.keys(c).forEach(function (k) { c[k].score = condoScore(c[k], dens); });
  }

  // ---- scoring (rules agreed with Daniel, 24 Oct) ---------------------------------
  // Straight lines between the given [value, score] points; outside them the end score holds.
  function slope(v, pts) {
    if (v <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (v <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]); }
    }
    return pts[pts.length - 1][1];
  }
  function leaseLeft(c) {
    var u = c.ura;
    if (isFreehold(c.tenure) || (u && u.leaseYears >= 900)) return Infinity;
    if (u && u.leaseYears && u.leaseStart) return Math.max(u.leaseYears - (new Date().getFullYear() - u.leaseStart), 0);
    // no URA lease: estimate from the year built (the lease usually starts about 4 years before completion)
    if (/99/.test(c.tenure || '') && c.built) return Math.max(99 - (new Date().getFullYear() - (c.built - 4)), 0);
    return null;
  }
  function leaseKnown(c) { return !!(c.ura && c.ura.leaseYears && c.ura.leaseStart); }
  // Typical $psf: asking prices of the units for sale, else URA sales of the last 12 months
  function condoPsf(c) {
    var ask = median(c.units.map(function (l) { return l.psf; }));
    if (ask) return { psf: ask, from: 'asking' };
    var u = c.ura, cut = new Date(); cut.setMonth(cut.getMonth() - 12);
    var since = cut.toISOString().slice(0, 7);
    var sold = u ? median(u.sales.filter(function (x) { return x.month >= since; }).map(function (x) { return x.psf; })) : null;
    return sold ? { psf: sold, from: 'URA sales' } : null;
  }
  // Each part 0–100 (null = no data); total = weighted average of the parts we have
  function condoScore(c, dens) {
    var nb = c.near || {}, parts = [null, null, null, null, null], notes = ['', '', '', '', ''];
    var green = [nb.park, nb.dogRun].filter(Boolean).sort(function (a, b) { return a.m - b.m; })[0];
    if (green) {
      parts[0] = Math.min(100, slope(green.m, [[300, 100], [1000, 50], [2000, 0]]) + (nb.bigPark && nb.bigPark.m <= 1000 ? 10 : 0));
      notes[0] = (green === nb.dogRun ? 'dog run ' : 'park ') + metresText(green.m) + (nb.bigPark && nb.bigPark.m <= 1000 ? ' · big park near' : '');
    }
    if (nb.drive) { parts[1] = slope(nb.drive.min, [[15, 100], [18, 40], [20, 25], [25, 0]]); notes[1] = nb.drive.min + ' min'; }
    var p = condoPsf(c);
    if (p) { parts[2] = slope(p.psf, [[1500, 100], [2000, 50], [2100, 0]]); notes[2] = full(p.psf) + ' psf'; }
    var sz = c.subzone && ((S.meta.census || {}).subzones || {})[c.subzone];
    if (sz && sz.perKm2 != null && dens.length > 1) {
      var below = dens.filter(function (v) { return v > sz.perKm2; }).length;      // busier neighbourhoods than this one
      parts[3] = 100 * below / (dens.length - 1);
      notes[3] = n(sz.perKm2) + ' / km²';
    }
    var left = leaseLeft(c);
    if (left != null) {
      parts[4] = left === Infinity ? 100 : Math.min(95, slope(left, [[50, 0], [95, 85], [99, 91]]));
      notes[4] = left === Infinity ? 'freehold' : (leaseKnown(c) ? '' : '~') + left + ' yrs left' + (leaseKnown(c) ? '' : ' (est. from year built)');
    }
    var w = 0, t = 0;
    parts.forEach(function (v, i) { if (v != null) { w += SCORE_WEIGHTS[i]; t += v * SCORE_WEIGHTS[i]; } });
    var have = parts.filter(function (v) { return v != null; }).length;
    return { parts: parts.map(function (v) { return v == null ? null : Math.round(v); }), notes: notes,
      total: have >= 3 ? Math.round(t / w) : null, have: have };
  }
  function scoreOf(c) { return c.score && c.score.total != null ? c.score.total : -1; }
  function scoreTag(c) { return c.score && c.score.total != null ? '<small class="sc">Score ' + c.score.total + '</small>' : ''; }
  function metresText(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m'; }

  function shown(condo) { return condo.units.filter(visible); }
  function areaListings(id) { return S.listings.filter(function (l) { return l.area === id && visible(l); }); }

  function areaStats(id) {
    var ls = areaListings(id);
    var withMrt = ls.filter(function (l) { return l.mrtMin != null; });
    var condos = {};
    ls.forEach(function (l) { condos[l.condo] = 1; });
    return {
      n: ls.length, condos: Object.keys(condos).length,
      price: median(ls.map(function (l) { return l.price; })),
      psf: median(ls.map(function (l) { return l.psf; })),
      beds: mode(ls.map(function (l) { return l.beds; })),
      freehold: pct(ls.filter(function (l) { return isFreehold(l.tenure); }).length, ls.length),
      mrt: pct(withMrt.filter(function (l) { return l.mrtMin <= 10; }).length, withMrt.length)
    };
  }

  function monthsAgo(n) {
    var d = new Date(); d.setMonth(d.getMonth() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthText(m) {
    if (!m) return '—';
    return new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
  }

  var ETHNIC = [['chinese', 'Chinese', '#414140'], ['malays', 'Malays', '#7d9b84'], ['indians', 'Indians', '#c8a97e'], ['others', 'Others', '#8a9bb5']];
  // ⓘ with fine print shown on hover / keyboard focus (see setupTooltips)
  function tip(text) {
    return ' <span class="tip-i" tabindex="0" role="img" aria-label="' + esc(text) + '" data-tip="' + esc(text) + '">i</span>';
  }

  function share(part, whole) { return whole ? 100 * part / whole : 0; }
  function pctText(v) { return v > 0 && v < 1 ? '<1%' : Math.round(v) + '%'; }
  function n(v) { return Math.round(v).toLocaleString('en-SG'); }
  var MIN_PEOPLE = 200;     // fewer residents than this: too few to describe

  // Ethnic groups: one bar per group, dashed line = Singapore average, tag = difference in % points.
  // A switch flips to the estimated mix of condo & landed residents only (see census.py for the method).
  function ethnicPart(e, sg, place, priv) {
    var mode = S.eview === 'private' && priv ? 'private' : 'all';
    var counts = mode === 'private' ? priv.counts : e, pcts = {};
    ETHNIC.forEach(function (g) { pcts[g[0]] = mode === 'private' ? priv.pct[g[0]] : share(e[g[0]], e.total); });
    var avgOf = function (g) { return sg && sg.total ? share(sg[g[0]], sg.total) : null; };
    var scale = fadeScale(ETHNIC.map(function (g) { return Math.max(pcts[g[0]], avgOf(g) || 0); }));
    var rows = ETHNIC.map(function (g) {
      var p = pcts[g[0]], avg = avgOf(g);
      var d = avg == null ? null : Math.round(p - avg);
      return fadeRow(g[1], p, avg, scale, '<strong>' + (mode === 'private' ? '~' : '') + n(counts[g[0]]) + '</strong>' +
        (d != null ? '<span class="diff ' + (d > 0 ? 'more' : (d < 0 ? 'less' : 'same')) + '" title="vs Singapore average (all residents)">' + (d > 0 ? '+' : (d < 0 ? '−' : '')) + Math.abs(d) + '</span>' : ''));
    }).join('');
    var toggle = priv ? '<div class="seg" role="group" aria-label="Whose ethnic mix">' +
      '<button type="button" data-eview="all" aria-pressed="' + (mode === 'all') + '">All residents</button>' +
      '<button type="button" data-eview="private" aria-pressed="' + (mode === 'private') + '">Condo &amp; landed only (est.)</button></div>' : '';
    var note = mode === 'private' ? privateNote(priv) : '';
    var sgTip = 'Dotted line = Singapore average. The small tag is the difference in percentage points (e.g. +6 = 6 points more than Singapore).';
    var total = mode === 'private' ? priv.privateResidents : e.total;
    return '<div class="part"><div class="head-row"><strong>Ethnic groups' + note + '</strong><span class="hint">' + (mode === 'private' ? '~' : '') + n(total) +
      (mode === 'private' ? ' condo &amp; landed' : ' residents') + '</span></div>' + toggle + rows +
      '<div class="key"><span><b></b>' + esc(place) + (mode === 'private' ? ' (condo &amp; landed)' : '') + '</span><span><u></u>Singapore average' + tip(sgTip) + '</span></div></div>';
  }

  // How far to trust the condo & landed estimate: a small label, the explanation in the tooltip
  function privateNote(p) {
    if (p.basis === 'all private') return ' <span class="est est-ok">Same as everyone' + tip('Almost everyone here lives in a condo or landed home, so this is the same as all residents.') + '</span>';
    if (p.basis === 'raw') return ' <span class="est est-warn">Showing everyone' + tip('There is no mostly-HDB neighbourhood in this area to compare with, so this shows all residents.') + '</span>';
    var spread = p.chineseHi != null ? p.chineseHi - p.chineseLo : 0;
    var zeros = ETHNIC.some(function (g) { return p.pct[g[0]] === 0; });
    var rough = p.privateShare < 30 || spread > 15 || zeros;
    var text = 'Only ' + pctText(p.privateShare) + ' of residents here live in condos / landed homes. Their mix is worked out by taking away the HDB residents, ' +
      'assumed to look like the mostly-HDB neighbourhoods nearby (' + p.benchmarks + ' used).' +
      (p.chineseHi != null && spread >= 1 ? ' Chinese could be anywhere from ' + pctText(p.chineseLo) + ' to ' + pctText(p.chineseHi) + '.' : '') +
      (zeros ? ' A 0% means the subtraction ran out, not that nobody lives there.' : '');
    return ' <span class="est ' + (rough ? 'est-warn' : 'est-ok') + '">' + (rough ? 'Rough estimate' : 'Estimate') + tip(text) + '</span>';
  }

  var LANGS = [['english', 'English'], ['mandarin', 'Mandarin'], ['dialects', 'Chinese dialects'], ['malay', 'Malay'], ['indian', 'Tamil & Indian'], ['others', 'Others']];
  function languagePart(l) {
    if (!l || !l.total) return '<div class="part"><strong>Main language at home</strong><span class="empty">Not published for this area (SingStat groups smaller areas together).</span></div>';
    var top = LANGS.slice().sort(function (a, b) { return l[b[0]] - l[a[0]]; })[0];
    var both = l.english ? Math.round(10 * l.englishMandarin / l.english) : 0;
    return '<div class="part"><div class="head-row"><strong>Main language at home' + tip('The language spoken most often at home, by residents aged 5 and over (Census 2020). Published by planning area only.') + '</strong></div>' +
      (function () {
        var scale = fadeScale(LANGS.map(function (x) { return share(l[x[0]], l.total); }));
        return LANGS.map(function (x) { return fadeRow(x[1], share(l[x[0]], l.total), null, scale, '<strong>' + n(l[x[0]]) + '</strong>'); }).join('');
      })() +
      '<ul class="plain"><li>Most homes speak <strong>' + top[1] + '</strong> (' + pctText(share(l[top[0]], l.total)) + ')' +
      (top[0] === 'english' && both ? ', and about <strong>' + both + ' in 10</strong> of those also speak Mandarin.' : '.') + '</li></ul></div>';
  }

  // Chart colours (ZIXO look, agreed 24 Oct): green / coral red / soft greys, pink fade bars
  var CH = { green: '#46B035', red: '#F05A5A', lgreen: '#A9DB9E', grey: '#dcdbd6', faint: '#eeede9', pink: '#F08C8C' };

  // Fade bar row: label | bar fading in to a thin end line, % on top, dotted Singapore tick | right-hand text
  function fadeRow(label, p, avg, scale, right) {
    var w = Math.min(100, 100 * p / scale);
    return '<div class="fb"><span class="fl">' + label + '</span><div class="ft"><b style="width:' + w.toFixed(1) + '%"></b>' +
      '<em class="' + (w < 14 ? 'out' : '') + '" style="left:' + w.toFixed(1) + '%">' + pctText(p) + '</em>' +
      (avg != null ? '<u style="left:' + Math.min(100, 100 * avg / scale).toFixed(1) + '%"></u>' : '') + '</div><span class="v">' + right + '</span></div>';
  }
  function fadeScale(vals) { return Math.min(100, Math.max.apply(null, vals.concat([1])) * 1.12); }

  // Half-circle gauge in separate arcs; parts = [[label, value, colour]] (no label = no callout)
  function gaugeSvg(parts) {
    var W = 300, R = 128, cx = W / 2, cy = R + 10, H = cy + 8, gap = 3, a0 = 180, out = [];
    var total = parts.reduce(function (t, p) { return t + p[1]; }, 0) || 1;
    function pt(a, r) { var t = a * Math.PI / 180; return [(cx + r * Math.cos(t)).toFixed(1), (cy - r * Math.sin(t)).toFixed(1)]; }
    parts.forEach(function (p, i) {
      var span = 180 * p[1] / total;
      if (span <= 0) return;
      var s0 = a0 - (i ? gap / 2 : 0), s1 = Math.min(s0, a0 - span + (i < parts.length - 1 ? gap / 2 : 0)), A = pt(s0, R), B = pt(s1, R);
      out.push('<path d="M' + A[0] + ' ' + A[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + B[0] + ' ' + B[1] + '" fill="none" stroke="' + p[2] + '" stroke-width="7" stroke-linecap="round"/>');
      if (p[0]) {
        var mid = a0 - span / 2, L1 = pt(mid, R - 8), L2 = pt(mid, R - 30), T = pt(mid, R - 48);
        out.push('<line x1="' + L1[0] + '" y1="' + L1[1] + '" x2="' + L2[0] + '" y2="' + L2[1] + '" stroke="' + p[2] + '"/>' +
          '<text x="' + T[0] + '" y="' + (+T[1] + 4) + '" text-anchor="middle" font-size="19" fill="#2b2b2a">' + Math.round(100 * p[1] / total) + '<tspan font-size="10" fill="#a9a8a2">%</tspan></text>' +
          '<text x="' + T[0] + '" y="' + (+T[1] + 19) + '" text-anchor="middle" font-size="10.5" fill="#77766f">' + p[0] + '</text>');
      }
      a0 -= span;
    });
    return '<svg class="gauge-svg" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + out.join('') + '</svg>';
  }

  // Thin vertical lines (barcode look); stack = [[value, colour]] from the bottom, unit = px per value
  function lineBar(stack, unit, count) {
    var one = stack.map(function (x, i) { return '<span style="height:' + Math.max(1, x[0] * unit).toFixed(1) + 'px;background:' + x[1] + (i ? ';margin-bottom:1.5px' : '') + '"></span>'; }).join('');
    var out = '';
    for (var i = 0; i < (count || 11); i++) out += '<i>' + one + '</i>';
    return '<span class="lb">' + out + '</span>';
  }

  var HOMES = [['hdb', 'HDB', CH.grey, 62], ['condo', 'Condo', CH.red, 100], ['landed', 'Landed', CH.green, 82], ['other', 'Other', CH.faint, 50]];
  function homePart(h, sg) {
    var c = share(h.condo, h.total), cs = sg ? share(sg.condo, sg.total) : null;
    var counts = HOMES.map(function (k) { return Math.round(share(h[k[0]], h.total)); });
    counts[0] += 100 - counts.reduce(function (t, v) { return t + v; }, 0);       // rounding: always 100 squares
    var cells = [];
    HOMES.forEach(function (k, i) { for (var j = 0; j < counts[i]; j++) cells.push('<i style="background:' + k[2] + ';height:' + k[3] + '%"></i>'); });
    return '<div class="part"><div class="head-row"><strong>Type of home' + tip('Where residents live (Census 2020). Each line = 1 in 100 residents.') + '</strong><span class="hint">100 lines = 100 residents</span></div>' +
      '<div class="hund" role="img" aria-label="' + Math.round(c) + ' in 100 live in a condo">' + cells.join('') + '</div>' +
      '<div class="hseg">' + HOMES.map(function (k, i) {
        return counts[i] >= 4 ? '<div style="width:' + counts[i] + '%"><b>' + pctText(share(h[k[0]], h.total)) + '</b>' + k[1] + '</div>' : (counts[i] ? '<div style="width:' + counts[i] + '%"></div>' : '');
      }).join('') + '</div>' +
      '<ul class="plain"><li><strong>' + Math.round(c) + ' in 100</strong> live in a condo' + (cs != null ? ' (Singapore: ' + Math.round(cs) + ' in 100).' : '.') + '</li></ul></div>';
  }

  function oneIn(p) { return p >= 1 ? Math.max(2, Math.round(100 / p)) : null; }
  function agePart(a, sg) {
    var shares = a.bands.map(function (b) { return share(b[1], a.total); });
    var sgShares = sg && sg.total ? sg.bands.map(function (b) { return share(b[1], sg.total); }) : null;
    var hi = Math.max.apply(null, shares.concat(sgShares || [])) || 1;
    function h(v) { return Math.round(6 + 74 * v / hi); }
    var old = shares[shares.length - 1], sgOld = sgShares ? sgShares[sgShares.length - 1] : null;
    return '<div class="part"><div class="head-row"><strong>Age groups' + tip('Share of residents in each age group (Census 2020).' + (sgShares ? ' Dashed line = Singapore.' : '')) + '</strong></div>' +
      '<div class="ages lines">' + a.bands.map(function (b, i) {
        var last = i === a.bands.length - 1;
        return '<div class="age' + (last ? ' on' : '') + '"><span class="av">' + pctText(shares[i]) + '</span><span class="acol" style="height:' + Math.max(h(shares[i]), sgShares ? h(sgShares[i]) : 0) + 'px">' +
          lineBar([[h(shares[i]), last ? CH.pink : CH.grey]], 1) + (sgShares ? '<u style="bottom:' + h(sgShares[i]) + 'px"></u>' : '') + '</span>' + b[0] + '</div>';
      }).join('') + '</div>' +
      '<ul class="plain"><li>' + (oneIn(old) ? '<strong>1 in ' + oneIn(old) + '</strong> residents is 65 or older' : 'Very few residents are 65 or older') +
      (sgOld != null && oneIn(sgOld) ? ' (Singapore: 1 in ' + oneIn(sgOld) + ').' : '.') + '</li></ul></div>';
  }

  var TENURE = [['owner', 'Own', CH.green], ['rented', 'Rent', CH.red], ['other', '', CH.grey]];
  function tenancyPart(t, sg, rent) {
    var out = '<div class="part"><div class="head-row"><strong>Owners vs renters' + tip('Households that own or rent their home (Census 2020). The census counts citizens\' and PRs\' households only, so foreigners on work passes (e.g. EP) who rent are missing here. The private-condo figures below come from URA rental contracts and do include them.') + '</strong></div>';
    if (t && t.total) {
      var r = share(t.rented, t.total), rs = sg && sg.total ? share(sg.rented, sg.total) : null;
      out += gaugeSvg(TENURE.map(function (k) { return [k[1], t[k[0]] || 0, k[2]]; })) +
        '<ul class="plain"><li><strong>' + (oneIn(r) ? '1 in ' + oneIn(r) : 'Very few') + '</strong> households rent' +
        (rs != null && oneIn(rs) ? ' (Singapore: 1 in ' + oneIn(rs) + ').' : '.') + '</li></ul>';
    } else {
      out += '<span class="empty">Census owner / renter figures aren\'t published for this area (SingStat groups smaller areas together).</span>';
    }
    if (rent && rent.n12) {
      var pctUnits = rent.units ? share(rent.n12Known, rent.units) : null;
      out += '<div class="rent-area"><strong>Private condos here' +
        tip('From URA rental contracts, which include foreign tenants (e.g. EP holders). The % uses only the condos whose number of units is known (BCA MCST register). Typical = middle rent.') + '</strong><ul class="plain">' +
        '<li><strong>' + n(rent.n12) + '</strong> rentals signed in the last year (' + rent.projects + ' condos)</li>' +
        (pctUnits != null ? '<li>≈ <strong>' + pctText(pctUnits) + '</strong> of condo units rented out a year</li>' : '') +
        (rent.rent2 ? '<li>Typical 2-bed rent <strong>' + full(rent.rent2) + '</strong></li>' : '') + '</ul></div>';
    }
    return out + '</div>';
  }

  // "Who lives here" for a planning area (with languages) or a subzone (no language figures by subzone)
  function whoBlock(c, place, isArea) {
    var sg = (S.meta.census || {}).sg || {};
    var title = isArea ? 'Who lives here' : 'Who lives in this neighbourhood';
    if (!c || !c.ethnic || c.ethnic.total < MIN_PEOPLE) {
      return '<div class="box"><span class="eyebrow">' + title + '</span><span class="empty">' +
        (c && c.ethnic ? 'Too few residents here to describe (' + n(c.ethnic.total) + ').' : 'No census figures for this ' + (isArea ? 'area' : 'neighbourhood') + '.') + '</span></div>';
    }
    return '<div class="box who-box"><div class="head-row"><span class="eyebrow">' + title +
      tip('Census 2020 (Singapore Department of Statistics): citizens and PRs only, numbers rounded to the nearest 10. Foreigners on work passes are not counted by area.') + '</span>' +
      (isArea ? '' : '<span class="hint"><strong>' + esc(place) + '</strong>' + tip('The condo\'s neighbourhood = its URA subzone (Master Plan 2019), the smallest area the census reports.') + '</span>') + '</div>' +
      ethnicPart(c.ethnic, sg.ethnic, place, c.ethnicPrivate) +
      (c.dwelling ? homePart(c.dwelling, sg.dwelling) : '') +
      (c.age ? agePart(c.age, sg.age) : '') +
      '</div>';
  }

  var BUDGET = 1500000;     // "what $1.5M buys"

  function trendChart(area, nat) {
    var W = 380, H = 180, L = 46, R = 16, T = 34, B = 26;
    var years = area.map(function (y) { return y.year; });
    var natY = (nat || []).filter(function (y) { return years.indexOf(y.year) >= 0; });
    var all = area.map(function (y) { return y.psf; }).concat(natY.map(function (y) { return y.psf; }));
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = Math.max((hi - lo) * 0.15, 50);
    lo = Math.floor((lo - pad) / 100) * 100; hi = Math.ceil((hi + pad) / 100) * 100;
    function x(yr) { return years.length < 2 ? L : L + (W - L - R) * (years.indexOf(yr)) / (years.length - 1); }
    function y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    function path(pts) {      // smooth curve through the points (Catmull-Rom)
      var P = pts.map(function (p) { return [x(p.year), y(p.psf)]; });
      return P.map(function (p, i) {
        if (!i) return 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        var a = P[i - 2] || P[i - 1], b = P[i - 1], d = P[i + 1] || p;
        return 'C' + (b[0] + (p[0] - a[0]) / 6).toFixed(1) + ' ' + (b[1] + (p[1] - a[1]) / 6).toFixed(1) + ' ' +
          (p[0] - (d[0] - b[0]) / 6).toFixed(1) + ' ' + (p[1] - (d[1] - b[1]) / 6).toFixed(1) + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      }).join(' ');
    }
    var out = [];
    [0, 0.5, 1].forEach(function (f) {
      var v = lo + (hi - lo) * f, yy = y(v);
      out.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#efeeea"/>' +
        '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" font-size="10" fill="#7b8794" text-anchor="end">$' + Math.round(v).toLocaleString('en-SG') + '</text>');
    });
    years.forEach(function (yr, i) {
      out.push('<text x="' + x(yr) + '" y="' + (H - 8) + '" font-size="10" fill="#52606d" text-anchor="middle">' + yr + (i === years.length - 1 ? '*' : '') + '</text>');
    });
    if (natY.length > 1) out.push('<path d="' + path(natY) + '" fill="none" stroke="#b9b8b2" stroke-width="1.5" stroke-dasharray="3 4"/>');
    out.push('<path d="' + path(area) + '" fill="none" stroke="#414140" stroke-width="1.8"/>');
    var last = area[area.length - 1], lx = x(last.year), ch = pctChange(area[0].psf, last.psf);
    out.push('<line x1="' + lx + '" x2="' + lx + '" y1="24" y2="' + (H - B) + '" stroke="#414140"/>' +
      '<rect x="' + (lx - 46) + '" y="6" width="46" height="18" rx="9" fill="' + (ch >= 0 ? CH.green : CH.red) + '"/>' +
      '<text x="' + (lx - 23) + '" y="18.5" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff">' + (ch > 0 ? '+' : '') + ch + '%</text>');
    area.forEach(function (p, i) {
      if (i === area.length - 1) out.push('<circle cx="' + x(p.year) + '" cy="' + y(p.psf) + '" r="3.5" fill="#414140" stroke="#fff" stroke-width="2"/>');
      if (i === 0 || i === area.length - 1) {
        var next = area[i === 0 ? 1 : i - 1], below = next && next.psf > p.psf;     // keep the label off the line
        out.push('<text x="' + x(p.year) + '" y="' + (below ? y(p.psf) + 17 : y(p.psf) - 9) + '" font-size="11" font-weight="700" fill="#1f2933" text-anchor="' +
          (i === 0 ? 'start' : 'end') + '" dx="' + (i === 0 ? 0 : -6) + '">' + full(p.psf) + '</text>');
      }
    });
    return '<svg class="trend-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Typical $psf per year: this area' +
      (natY.length > 1 ? ' and all of Singapore' : '') + '">' + out.join('') + '</svg>' +
      '<div class="trend-key"><span><i class="k-area"></i>This area</span>' + (natY.length > 1 ? '<span><i class="k-sg"></i>All of Singapore</span>' : '') +
      tip('* this year so far. Typical = the middle price per sqft of all URA-recorded condo, apartment and EC sales that year. The badge compares the first and last year (Growing = 3% a year or more).') + '</div>';
  }

  function pctChange(a, b) { return Math.round(100 * (b - a) / a); }
  function signed(n) { return (n > 0 ? 'up ' : (n < 0 ? 'down ' : 'flat ')) + (n ? Math.abs(n) + '%' : ''); }

  function trendBlock(a) {
    var u = a.ura, nat = S.meta.uraNational;
    if (!u || !u.years || u.years.length < 2 || !u.badge) {
      return '<div class="box"><span class="eyebrow">Area trend</span><span class="empty">' +
        (u ? 'Not enough URA sales here to show a trend.' : (S.meta.uraStatus && S.meta.uraStatus.ok ? 'No URA sales recorded in this area.' : 'URA sales not loaded.')) + '</span></div>';
    }
    var first = u.years[0], last = u.years[u.years.length - 1], ch = pctChange(first.psf, last.psf);
    var cls = u.badge === 'Growing' ? 'good' : (u.badge === 'Softening' ? 'bad' : 'flat');
    var natLine = '';
    if (nat && nat.years) {
      var nf = nat.years.filter(function (y) { return y.year === first.year; })[0], nl = nat.years.filter(function (y) { return y.year === last.year; })[0];
      if (nf && nl) {
        var nch = pctChange(nf.psf, nl.psf);
        natLine = '<li>All of Singapore: <strong>' + signed(nch) + '</strong> over the same time — this area did ' +
          (ch > nch + 2 ? '<strong>better</strong>' : (ch < nch - 2 ? '<strong>worse</strong>' : '<strong>about the same</strong>')) + '.</li>';
      }
    }
    var sqftThen = Math.round(BUDGET / first.psf / 10) * 10, sqftNow = Math.round(BUDGET / last.psf / 10) * 10;
    return '<div class="box"><div class="head-row"><span class="eyebrow">Area trend</span><span><span class="chip ' + cls + '">' + u.badge + '</span> <span class="hint">' +
      (u.trend > 0 ? '+' : '') + u.trend + '% a year</span></span></div>' +
      trendChart(u.years, nat && nat.years) +
      '<ul class="plain">' +
      '<li>A typical home here sold for <strong>' + full(first.psf) + ' psf</strong> in ' + first.year + ' and <strong>' + full(last.psf) + ' psf</strong> in ' + last.year +
      ' so far — <strong>' + signed(ch) + '</strong>.</li>' + natLine +
      '<li><strong>' + money(BUDGET) + '</strong> buys about <strong>' + sqftNow.toLocaleString('en-SG') + ' sqft</strong> here now, vs ' + sqftThen.toLocaleString('en-SG') + ' sqft in ' + first.year + '.</li>' +
      '</ul></div>';
  }

  function areaTitle(a) { return a ? a.name + (a.label ? ' · ' + a.label : '') : ''; }

  // ---- map ----------------------------------------------------------------------
  var placeLayer;
  function setupMap() {
    var sw = L.latLng(1.144, 103.535), ne = L.latLng(1.494, 104.502);
    map = L.map('map', { minZoom: 11, maxZoom: 19, maxBounds: L.latLngBounds(sw, ne), zoomControl: false })
      .setView([1.33, 103.86], 13);
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/GreyLite/{z}/{x}/{y}.png', {
      detectRetina: true, maxZoom: 19, minZoom: 11,
      attribution: '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo_round@2x.png" alt="">' +
        '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> © contributors | ' +
        '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>'
    }).addTo(map);
    map.on('click', closePanel);
    map.on('movestart', hidePeek);
    map.on('zoomend', zoomClass);
    map.on('moveend', declutter);
    zoomClass();
  }

  function zoomClass() {
    $('map').classList.toggle('zoom-low', map.getZoom() <= 12);
    $('map').classList.toggle('labels-off', map.getZoom() < LABEL_ZOOM);     // name tags only when zoomed in close
  }

  function areaStyle(id) {
    var on = S.panel && S.panel.area === id, hov = S.hover === id;
    var has = areaListings(id).length > 0;
    return {
      color: on || hov ? '#4C7458' : '#8d8c86', weight: on ? 2 : (hov ? 1.5 : 1), opacity: on || hov ? 1 : 0.45,
      fillColor: '#4C7458', fillOpacity: on ? 0.26 : (hov ? 0.12 : (has ? 0.03 : 0.0))     // sage highlight (agreed 24 Oct)
    };
  }

  function drawAreas(geo) {
    labelLayer = L.layerGroup().addTo(map);
    placeLayer = L.layerGroup().addTo(map);
    areaLayer = L.geoJSON(geo, {
      style: function (f) { return areaStyle(f.properties.id); },
      onEachFeature: function (f, layer) {
        var p = f.properties;
        S.areas[p.id] = { id: p.id, name: p.name, label: p.label, census: p.census, ura: p.ura, rent: p.rent, crowd: p.crowd, condoUnits: p.condoUnits, layer: layer };
        layer.on('mouseover', function (e) { S.hover = p.id; restyle(); if (S.peekOff !== p.id) showPeek(p.id, e); });
        layer.on('mousemove', function (e) { if (!$('peek').hidden) movePeek(e); });
        layer.on('mouseout', function () { S.peekOff = null; if (S.hover === p.id) { S.hover = null; restyle(); hidePeek(); } });
        layer.on('click', function (e) { L.DomEvent.stopPropagation(e); S.peekOff = p.id; hidePeek(); openArea(p.id); });
      }
    }).addTo(map);
    Object.keys(S.areas).forEach(function (id) {
      var a = S.areas[id];
      var html = '<div class="area-label">' + esc(a.name) + (a.label ? '<small>' + esc(a.label) + '</small>' : '') + '</div>';
      L.marker(a.layer.getBounds().getCenter(), {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', html: html, iconSize: null })
      }).addTo(labelLayer);
    });
  }

  function restyle() {
    areaLayer.eachLayer(function (layer) { layer.setStyle(areaStyle(layer.feature.properties.id)); });
  }

  // Pin with a name tag: white for every condo when zoomed in close; orange ★ for shortlisted ones (always shown).
  // Hovering a pin shows its name even when zoomed out.
  var LABEL_ZOOM = 15;
  function pinIcon(key) {
    var c = S.condos[key];
    var star = S.shortlist.indexOf(key) >= 0;
    var sel = S.panel && S.panel.condo === key;
    var cls = 'pin' + (star ? ' star' : '') + (sel ? ' selected' : '');
    var size = sel ? 24 : (star ? 22 : 16);
    var label = '<div class="plabel' + (star || sel ? ' always' : '') + (star ? ' starred' : '') + '">' + (star ? '★ ' : '') + esc(c.name) + '</div>';
    return L.divIcon({ className: 'pinwrap', html: label + '<div class="' + cls + '">' + (star ? '★' : '') + '</div>', iconSize: [size, size] });
  }

  function drawPins() {
    if (pinLayer) map.removeLayer(pinLayer);
    if (!selLayer) selLayer = L.layerGroup().addTo(map);
    selLayer.clearLayers();
    markers = {};
    pinLayer = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 45, disableClusteringAtZoom: 17,
      iconCreateFunction: function (cluster) {
        var n = cluster.getChildCount(), size = n < 10 ? 30 : (n < 50 ? 36 : 44);
        var star = cluster.getAllChildMarkers().some(function (m) { return S.shortlist.indexOf(m.options.condoKey) >= 0; });
        return L.divIcon({ className: '', iconSize: [size, size],
          html: '<div class="cluster' + (star ? ' has-star' : '') + '" style="width:' + size + 'px;height:' + size + 'px">' + n + '</div>' });
      }
    });
    Object.keys(S.condos).forEach(function (k) {
      var c = S.condos[k];
      if (c.lat == null || !shown(c).length) return;
      var m = L.marker([c.lat, c.lng], { icon: pinIcon(k), condoKey: k, title: c.name, riseOnHover: true });
      m.on('click', function (e) { L.DomEvent.stopPropagation(e); S.peekOff = S.hover; hidePeek(); openCondo(k); });
      markers[k] = m;
      pinLayer.addLayer(m);
    });
    map.addLayer(pinLayer);
    if (S.panel && S.panel.condo) placePin(S.panel.condo);
    pinLayer.on('animationend', declutter);
    declutter();
  }

  function refreshPin(key) { if (key && markers[key]) { markers[key].setIcon(pinIcon(key)); placePin(key); declutter(); } }

  // The open condo's pin sits on its own layer, so it's never folded into a number bubble (fixed 27 Oct)
  function placePin(key) {
    var m = markers[key];
    if (!m || !selLayer) return;
    var sel = S.panel && S.panel.condo === key;
    if (sel && !selLayer.hasLayer(m)) { pinLayer.removeLayer(m); selLayer.addLayer(m); m.setZIndexOffset(1000); }
    else if (!sel && selLayer.hasLayer(m)) { selLayer.removeLayer(m); m.setZIndexOffset(0); pinLayer.addLayer(m); }
  }

  // Name tags that would cover one already shown are hidden (hovering the pin still shows it).
  // Order: the open condo, then shortlisted ones, then condos with the most listings.
  var declutterQueued = false;
  function declutter() {
    if (declutterQueued) return;
    declutterQueued = true;
    requestAnimationFrame(function () {
      declutterQueued = false;
      var tags = [];
      Object.keys(markers).forEach(function (k) {
        var icon = markers[k]._icon, el = icon && icon.querySelector('.plabel');
        if (!el) return;
        el.classList.remove('clash');
        var r = el.getBoundingClientRect();
        if (!r.width) return;                     // hidden (zoomed out)
        var rank = el.parentNode.querySelector('.pin.selected') ? 0 : (el.classList.contains('starred') ? 1 : 2);
        tags.push({ el: el, r: r, rank: rank, n: S.condos[k].units.length });
      });
      tags.sort(function (a, b) { return a.rank - b.rank || b.n - a.n; });
      var kept = [];
      tags.forEach(function (t) {
        var hit = kept.some(function (o) { return t.r.left < o.right + 2 && t.r.right + 2 > o.left && t.r.top < o.bottom + 1 && t.r.bottom + 1 > o.top; });
        if (hit) t.el.classList.add('clash'); else kept.push(t.r);
      });
    });
  }

  // ---- peek card --------------------------------------------------------------
  function showPeek(id, e) {
    var a = S.areas[id], s = areaStats(id), el = $('peek');
    el.innerHTML =
      '<div class="row"><strong>' + esc(areaTitle(a)) + '</strong>' + (a.crowd ? '<span>#' + a.crowd.rank + ' of ' + a.crowd.of + ' busiest</span>' : '') + '</div>' +
      (a.census && a.census.ethnic ? '<span>' + n(a.census.ethnic.total) + ' residents' + (a.crowd ? ' · ' + n(a.crowd.perKm2) + ' / km²' : '') +
        (a.census.pr ? ' · PRs ~' + Math.round(a.census.pr.pct) + '%' : '') + '</span>' : '') +
      '<span>' + s.n + ' listing' + (s.n === 1 ? '' : 's') + ' · typical ' + money(s.price) + '</span>' +
      '<span>Typical ' + full(s.psf) + ' psf' + (s.beds != null ? ' · mostly ' + bedsText(s.beds) : '') + '</span>' +
      '<span>' + s.freehold + ' freehold · MRT ≤10 min ' + s.mrt + '</span>' +
      '<span class="foot">Click the area for full details</span>';
    el.hidden = false;
    movePeek(e);
  }
  function movePeek(e) {
    var el = $('peek'), box = $('map').getBoundingClientRect(), p = e.containerPoint;
    var x = p.x + 18, y = p.y + 18;
    if (x + 260 > box.width) x = p.x - 268;
    if (y + el.offsetHeight + 8 > box.height) y = p.y - el.offsetHeight - 12;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  function hidePeek() { $('peek').hidden = true; }

  // ---- spider chart (score) ----------------------------------------------------
  function spider(values, scored) {
    var w = 200, h = 170, cx = w / 2, cy = h / 2 + 4, r = 58, n = SCORE_AXES.length, out = [];
    function pt(i, f) {
      var ang = -Math.PI / 2 + 2 * Math.PI * i / n;
      return [cx + Math.cos(ang) * r * f, cy + Math.sin(ang) * r * f];
    }
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      out.push('<polygon points="' + SCORE_AXES.map(function (_, i) { return pt(i, f).join(','); }).join(' ') +
        '" fill="none" stroke="#e3e2dd" stroke-width="1"/>');
    });
    SCORE_SHORT.forEach(function (name, i) {
      var e = pt(i, 1), l = pt(i, 1.18);
      out.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0] + '" y2="' + e[1] + '" stroke="#e3e2dd"/>');
      var anchor = Math.abs(l[0] - cx) < 4 ? 'middle' : (l[0] > cx ? 'start' : 'end');
      out.push('<text x="' + l[0] + '" y="' + (l[1] + 3) + '" font-size="11" fill="#52606d" text-anchor="' + anchor + '">' + esc(name) + '</text>');
    });
    if (scored == null) scored = values.every(function (v) { return v != null; });
    if (scored) {
      out.push('<polygon points="' + values.map(function (v, i) { return pt(i, v / 100).join(','); }).join(' ') +
        '" fill="rgba(70,176,53,0.15)" stroke="' + CH.green + '" stroke-width="1.8"/>');
    } else {
      out.push('<text x="' + cx + '" y="' + (cy + 3) + '" font-size="10" fill="#7b8794" text-anchor="middle">Not scored yet</text>');
    }
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
      '" role="img" aria-label="Score chart: ' + (scored ? 'scored' : 'not scored yet') + '">' + out.join('') + '</svg>';
  }

  function scoreBlock(sc) {
    var scored = sc && sc.total != null;
    var how = 'Weights: Car to VivoCity 30 · Parks & nature 20 · Holds value 20 · Quiet area 15 · Price 15. ' +
      'Parks: nearest park or dog run (≤300 m best, 2 km+ none), +10 for a big park within 1 km. Car: 15 min or less best, 25 min+ none. ' +
      'Price: $1,500 psf or less best, $2,000 OK, $2,100+ none. Quiet: people per km² in the neighbourhood, compared with the others on the map. ' +
      'Holds value: freehold best; 99-year from 85 (95 years left) down to 0 (50 left) — lease from URA, else estimated from the year built. Parts without data are left out.';
    return '<div class="box"><div class="head-row"><span class="eyebrow">Condo score' + tip(how) + '</span>' +
      '<strong class="score-total">' + (scored ? sc.total + '<small>/100</small>' : '—') + '</strong></div>' +
      '<div class="score">' + spider(sc ? sc.parts.map(function (v) { return v == null ? 0 : v; }) : SCORE_AXES.map(function () { return null; }), scored) + '<div class="score-legend">' +
      SCORE_AXES.map(function (a, i) {
        var v = sc ? sc.parts[i] : null;
        return '<div><span>' + esc(a) + (sc && sc.notes[i] ? '<br><small>' + esc(sc.notes[i]) + '</small>' : '') + '</span><span class="sv">' + (v == null ? '—' : v) + '</span></div>';
      }).join('') + '</div></div>' +
      (sc && !scored ? '<div class="hint">Not enough data to score yet</div>' : '') + '</div>';
  }

  // ---- right card -------------------------------------------------------------
  function openArea(id, tab) {
    var prev = S.panel && S.panel.condo;
    S.panel = { type: 'area', area: id, tab: tab || 'summary', q: '', sort: 'count' };
    refreshPin(prev);
    renderPanel();
    restyle();
    drawPlaces();
  }

  function openCondo(key, opts) {
    var c = S.condos[key];
    if (!c) return;
    var prev = S.panel && S.panel.condo;
    S.panel = { type: 'condo', condo: key, area: c.area, tab: 'summary', allSales: false, allRent: false };
    refreshPin(prev);
    refreshPin(key);
    // zoom so the 1 km ring of places fits beside the card
    if (c.lat != null) map.flyToBounds(L.latLng(c.lat, c.lng).toBounds(2300), { paddingTopLeft: [20, 70], paddingBottomRight: [470, 20], maxZoom: 16, duration: 0.6 });
    hidePeek();
    renderPanel();
    restyle();
    renderShortlist();
    drawPlaces();
  }

  function closePanel() {
    var prev = S.panel && S.panel.condo;
    S.panel = null;
    refreshPin(prev);
    renderPanel();
    restyle();
    renderShortlist();
    drawPlaces();
  }

  // ---- places around the selected area / condo (25 Oct) --------------------------
  // MRT exits, supermarkets, hawkers, parks & dog runs, places of worship (+ dormitories) as small icons;
  // for a condo also 500 m / 1 km rings, with the nearest of each kind filled in (same size).
  // Line icons from Lucide (ISC licence, see static/vendor/icons/LICENSE-lucide.txt)
  var ICON = {
      "mrt": "<path d=\"M8 3.1V7a4 4 0 0 0 8 0V3.1\" /> <path d=\"m9 15-1-1\" /> <path d=\"m15 15 1-1\" /> <path d=\"M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z\" /> <path d=\"m8 19-2 3\" /> <path d=\"m16 19 2 3\" />",
      "shop": "<path d=\"m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18\" /> <path d=\"M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25\" /> <circle cx=\"18\" cy=\"20\" r=\"2\" /> <circle cx=\"8\" cy=\"20\" r=\"2\" />",
      "hawker": "<path d=\"M11.248 3c.273.1.808.53.747 1.36-.05.83-.938 1.2-.989 2.02-.06.78.333 1.24.727 1.62\" /> <path d=\"M16.252 3c.268.1.794.53.745 1.36-.06.83-.923 1.2-.993 2.02-.05.78.338 1.24.725 1.62\" /> <path d=\"M19.5 12 22 6\" /> <path d=\"M4 12a1 1 0 00-.99 1.133A9 9 0 0012 21a9 9 0 008.99-7.867A1 1 0 0020 12z\" /> <path d=\"M6.252 3c.268.1.794.53.745 1.36-.06.83-.923 1.2-.993 2.02-.05.78.338 1.24.735 1.62\" /> <path d=\"M7 21h10\" />",
      "park": "<path d=\"M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z\" /> <path d=\"M7 16v6\" /> <path d=\"M13 19v3\" /> <path d=\"M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5\" />",
      "dog": "<circle cx=\"11\" cy=\"4\" r=\"2\" /> <circle cx=\"18\" cy=\"8\" r=\"2\" /> <circle cx=\"20\" cy=\"16\" r=\"2\" /> <path d=\"M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z\" />",
      "worship": "<path d=\"M10 18v-7\" /> <path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\" /> <path d=\"M14 18v-7\" /> <path d=\"M18 18v-7\" /> <path d=\"M3 22h18\" /> <path d=\"M6 18v-7\" />",
      "dorm": "<path d=\"M10 12h4\" /> <path d=\"M10 8h4\" /> <path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" /> <path d=\"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\" /> <path d=\"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16\" />"
  };
  // icon style B (agreed 25 Oct): solid colour circle, white icon + edge, all the same size; MRT = one MRT-sign red, worship = warm brown
  var PLACE_KINDS = [
    ['mrt', 'MRT exits', '#D42E12'], ['shop', 'Supermarkets', '#4C7458'], ['hawker', 'Hawkers', '#8E6CC2'],
    ['park', 'Parks', '#46B035'], ['dog', 'Dog runs', '#46B035'], ['worship', 'Places of worship', '#A47551'], ['dorm', 'Worker dormitories', '#E07A7A']
  ];
  function iconSvg(kind) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[kind] + '</svg>';
  }
  S.placesOn = (function () {               // everything starts off; tap a chip to show it (remembered)
    try { var v = JSON.parse(localStorage.getItem('hqPlacesOn')); if (v) return v; } catch (e) { /* use defaults */ }
    return {};
  })();
  function insideArea(lat, lng, geom) {
    var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return polys.some(function (poly) {
      var ring = poly[0], c = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if ((ring[i][1] > lat) !== (ring[j][1] > lat) && lng < (ring[j][0] - ring[i][0]) * (lat - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
      }
      return c;
    });
  }
  function metresBetween(a, b, c, d) { var k = 111320; return Math.hypot((c - a) * k, (d - b) * k * Math.cos(a * Math.PI / 180)); }
  function drawPlaces() {
    if (!placeLayer) return;
    placeLayer.clearLayers();
    var legend = $('placeLegend');
    if (!S.panel || !S.places) { if (legend) legend.hidden = true; return; }
    var c = S.panel.type === 'condo' ? S.condos[S.panel.condo] : null;
    var a = S.areas[S.panel.area], geom = a && a.layer && a.layer.feature && a.layer.feature.geometry;
    if (c && c.lat == null) c = null;
    if (!c && !geom) { if (legend) legend.hidden = true; return; }
    if (c) {
      [1000, 500].forEach(function (r) {
        L.circle([c.lat, c.lng], { radius: r, color: '#414140', weight: 1, opacity: 0.5, dashArray: '4 5', fill: false, interactive: false }).addTo(placeLayer);
        L.marker([c.lat + r / 111320, c.lng], { icon: L.divIcon({ className: 'ring-label', html: r === 1000 ? '1 km' : '500 m', iconSize: [40, 14], iconAnchor: [20, 7] }), interactive: false }).addTo(placeLayer);
      });
    }
    PLACE_KINDS.forEach(function (k) {
      var pts = (S.places[k[0]] || []).filter(function (p) {
        return c ? metresBetween(c.lat, c.lng, p[0], p[1]) <= 1200 : insideArea(p[0], p[1], geom);
      });
      if (!S.placesOn[k[0]]) return;
      var near = c ? pts.slice().sort(function (x, y) { return metresBetween(c.lat, c.lng, x[0], x[1]) - metresBetween(c.lat, c.lng, y[0], y[1]); })[0] : null;
      pts.forEach(function (p) {
        var big = p === near, planned = k[0] === 'worship' && p[4];
        var label = k[0] === 'mrt' ? p[2] + (p[3] ? ' · exit ' + p[3] : '') : (k[0] === 'park' && p[3] ? p[2] + ' · ' + p[3] + ' ha' : (k[0] === 'worship' ? p[2] + (planned ? ' · planned (Master Plan 2025)' : (p[3] && p[3] !== p[2] ? ' · ' + p[3] : '')) : p[2]));
        if (c) label += ' · ' + metres(Math.round(metresBetween(c.lat, c.lng, p[0], p[1])));
        if (k[0] === 'park' && p[4]) {
          L.polygon(p[4], { color: '#46B035', weight: 1.5, opacity: 0.9, fillColor: '#46B035', fillOpacity: 0.14, interactive: false }).addTo(placeLayer);
        }
        L.marker([p[0], p[1]], {
          icon: L.divIcon({ className: 'poi' + (big ? ' near' : '') + (planned ? ' planned' : ''), html: '<span style="--c:' + k[2] + '">' + iconSvg(k[0]) + '</span>',
            iconSize: [26, 26], iconAnchor: [13, 13] }),
          keyboard: false, zIndexOffset: big ? -100 : -200
        }).bindTooltip(esc(label), { direction: 'top', offset: [0, -12] }).addTo(placeLayer);
      });
    });
    if (legend) {
      legend.hidden = false;
      legend.innerHTML = '<span class="pl-title">Around ' + esc(c ? c.name : a.name) + (c ? ' · rings 500 m / 1 km' : '') + '</span>' +
        PLACE_KINDS.map(function (k) {
          return '<button type="button" data-place="' + k[0] + '" aria-pressed="' + !!S.placesOn[k[0]] + '"><span style="--c:' + k[2] + '">' + iconSvg(k[0]) + '</span>' + k[1] + '</button>';
        }).join('');
    }
  }
  function setupPlaceLegend() {
    var el = document.createElement('div');
    el.id = 'placeLegend'; el.className = 'place-legend'; el.hidden = true;
    $('map').parentNode.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-place]');
      if (!b) return;
      S.placesOn[b.dataset.place] = S.placesOn[b.dataset.place] ? 0 : 1;
      try { localStorage.setItem('hqPlacesOn', JSON.stringify(S.placesOn)); } catch (e2) { /* not remembered */ }
      drawPlaces();
    });
  }

  function renderPanel() {
    var el = $('detail');
    if (!S.panel) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); return; }
    el.innerHTML = S.panel.type === 'area' ? areaHtml(S.panel.area) : condoHtml(S.condos[S.panel.condo]);
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.querySelector('.card-body').scrollTop = 0;
    if (S.panel.type === 'condo') loadGoogle(S.condos[S.panel.condo]);
  }

  function areaCondos(id) {
    return Object.keys(S.condos).map(function (k) { return S.condos[k]; })
      .filter(function (c) { return c.area === id && shown(c).length; });
  }

  function areaHtml(id) {
    var a = S.areas[id], tab = S.panel.tab, n = areaCondos(id).length;
    return '<div class="card-head"><div class="head-col"><div class="head-row" style="align-items:flex-start"><div><div class="title">' + esc(a.name) + '</div>' +
      '<div class="sub">URA planning area' + (a.label ? ' · ' + esc(a.label) : '') + '</div></div>' +
      '<button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></div>' +
      tabButtons([['summary', 'Summary'], ['people', 'People'], ['growth', 'Growth'], ['condos', 'Condos (' + n + ')']], tab) +
      '</div></div>' +
      '<div class="card-body">' + ({ people: areaPeople, growth: areaGrowth, condos: areaCondosTab }[tab] || areaSummary)(id) + '</div>';
  }

  function tabButtons(tabs, on) {
    return '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === on) + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  // Tab 1: score, "in short", key numbers
  // Tab 1: price, future growth, in short, population, citizens vs PRs, then crowding (order agreed 24 Oct)
  function areaSummary(id) {
    var a = S.areas[id], s = areaStats(id), u = a.ura, c = a.census || {};
    var loaded = S.meta.uraStatus && S.meta.uraStatus.ok;
    var badge = u && u.badge ? '<span class="chip ' + (u.badge === 'Growing' ? 'good' : (u.badge === 'Softening' ? 'bad' : 'flat')) + '">' + u.badge + '</span>'
      : soon(u ? 'not enough sales' : (loaded ? 'no sales' : 'not loaded'));
    return priceHero(a, s, badge) + futureBlock(a) + areaShort(a) + populationBlock(a) + prPart(c) + crowdBlock(a.crowd) +
      '<div class="grid2">' +
      '<button type="button" class="stat stat-btn" data-tab="condos">Listings<strong>' + s.n + '</strong>' + s.condos + ' condos · see tab →</button>' +
      '<div class="stat">Freehold / 999-yr<strong>' + s.freehold + '</strong>of listings</div>' +
      '</div>';
  }

  // Residents now, change since 2010, older residents vs Singapore
  function populationBlock(a) {
    var c = a.census || {}, sg = (S.meta.census || {}).sg || {}, e = c.ethnic, ch = c.change;
    if (!e || !e.total) return '';
    var pills = [];
    if (ch && ch.residents) {
      var g = growth(ch.residents);
      pills.push('<span class="pill ' + (Math.abs(g) < 3 ? '' : (g > 0 ? 'up' : 'down')) + '">' + (Math.abs(g) < 3 ? '• about the same' : (g > 0 ? '▲ ' : '▼ ') + Math.abs(g) + '%') + ' since 2010</span>');
    }
    if (c.age && c.age.total) {
      var old = share(c.age.bands[c.age.bands.length - 1][1], c.age.total);
      var sgOld = sg.age && sg.age.total ? share(sg.age.bands[sg.age.bands.length - 1][1], sg.age.total) : null;
      pills.push('<span class="pill">' + (oneIn(old) ? '1 in ' + oneIn(old) : 'few') + ' aged 65+' + (sgOld != null && oneIn(sgOld) ? ' · SG 1 in ' + oneIn(sgOld) : '') + '</span>');
    }
    if (c.dwelling && c.dwelling.total) pills.push('<span class="pill">' + pctText(share(c.dwelling.condo, c.dwelling.total)) + ' in condos</span>');
    return '<div class="box"><div class="head-row"><span class="eyebrow">Population' +
      tip('Residents = citizens and PRs (Census 2020, numbers rounded to the nearest 10). Change since 2010 from Census 2010. Foreigners on work passes are not counted by area.') + '</span>' +
      '<button type="button" class="link-btn" data-tab="people">People tab →</button></div>' +
      '<div class="big-num">' + n(e.total) + '<span> residents</span></div><div class="pills left">' + pills.join('') + '</div></div>';
  }

  // Where it's heading: price trend vs Singapore, condo homes since 2010, what's coming (not built yet)
  function futureBlock(a) {
    var u = a.ura, nat = S.meta.uraNational, ch = (a.census || {}).change, rows = [];
    if (u && u.badge && u.trend != null) {
      rows.push('<div><span>Prices</span><span><strong>' + esc(u.badge) + '</strong> · ' + (u.trend > 0 ? '+' : '') + u.trend + '% a year' +
        (nat && nat.trend != null ? ' <small class="hint">(Singapore ' + nat.trend + '%)</small>' : '') + '</span></div>');
    } else {
      rows.push('<div><span>Prices</span><span>' + soon(u ? 'not enough URA sales' : (S.meta.uraStatus && S.meta.uraStatus.ok ? 'no URA sales here' : 'URA sales not loaded')) + '</span></div>');
    }
    if (ch && ch.condoHomes && ch.condoHomes[0]) {
      var g = growth(ch.condoHomes);
      rows.push('<div><span>Condo homes</span><span><strong>' + (g > 0 ? '▲ ' : (g < 0 ? '▼ ' : '')) + Math.abs(g) + '%</strong> since 2010</span></div>');
    }
    rows.push('<div><span>New condos coming</span><span>' + soon('coming soon') + '</span></div>');
    rows.push('<div><span>Future MRT</span><span>' + soon('coming soon') + '</span></div>');
    return '<div class="box"><div class="head-row"><span class="eyebrow">Future growth' +
      tip('Prices = typical URA $psf, first vs last full year (Growing = 3% a year or more). Condo homes = households living in condos (Census 2010 → 2020). New condos and future MRT lines will come from URA and LTA.') + '</span>' +
      '<button type="button" class="link-btn" data-tab="growth">Growth tab →</button></div><div class="rows">' + rows.join('') + '</div></div>';
  }

  function shortMonth(m) {
    return new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('en-SG', { month: 'short' }) + ' ' + m.slice(2, 4);
  }

  // Top of the area card: typical URA $psf in big type, growth pills, thin bars = typical $psf each month (latest 3 dark)
  function priceHero(a, s, badge) {
    var u = a.ura;
    if (!u || !u.psf12) {
      return '<div class="box hero"><span class="lab">Typical asking price here</span><div class="money">' + (s.psf ? full(s.psf) : '—') + '<span>.psf</span></div>' +
        '<div class="pills"><span class="pill">asking, not sold</span><span class="pill">' + badge + '</span></div></div>';
    }
    var months = (u.months || []).filter(function (x, i, all) { return x[1] != null || i > 0; });
    var vals = months.map(function (x) { return x[1]; }).filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, vals) - 100, hi = Math.max.apply(null, vals);
    var withData = months.map(function (x, i) { return x[1] != null ? i : -1; }).filter(function (i) { return i >= 0; });
    var dark = withData.slice(-3);
    var bars = months.map(function (x, i) {
      var h = x[1] == null ? 4 : Math.round(14 + 86 * (x[1] - lo) / ((hi - lo) || 1));
      return '<i class="' + (dark.indexOf(i) >= 0 ? (u.trend != null && u.trend < 0 ? 'hi down' : 'hi') : '') + '" style="height:' + h + '%" title="' + esc(monthText(x[0]) + (x[1] != null ? ': ' + full(x[1]) + ' psf' : ': no sales')) + '"></i>';
    }).join('');
    var t = u.trend;
    var ticks = months.length > 3 ? [0, Math.round(months.length / 3), Math.round(2 * months.length / 3), months.length - 1].map(function (i) { return '<span>' + shortMonth(months[i][0]) + '</span>'; }).join('') : '';
    return '<div class="box hero"><span class="lab">Typical price here' +
      tip('Middle price per sqft of URA-recorded condo, apartment and EC sales in this area over the last 12 months. Bars = each month (latest 3 in green, or red if prices are falling). Growth = a year, first vs last full year.') + '</span>' +
      '<div class="money">' + full(u.psf12) + '<span>.psf</span></div>' +
      '<div class="pills">' + (t != null ? '<span class="pill ' + (t >= 0 ? 'up' : 'down') + '">' + (t >= 0 ? '↗ ' : '↘ ') + Math.abs(t) + '% a year</span>' : '') +
      '<span class="pill">' + n(u.n12) + ' URA sales · 12 mo</span>' + (u.badge ? '<span class="pill">' + esc(u.badge) + '</span>' : '') + '</div>' +
      (months.length > 3 ? '<div class="hist" role="img" aria-label="Typical price per sqft each month">' + bars + '</div><div class="hist-x">' + ticks + '</div>' : '') + '</div>';
  }

  // "In short": fixed rules on the numbers (agreed with Daniel 23 Oct); a sentence is left out if its data is missing
  function areaShort(a) {
    var c = a.census || {}, sg = (S.meta.census || {}).sg || {}, lines = [];
    var d = c.dwelling, age = c.age, sgAge = sg.age;
    if (d && d.total && age && age.total && sgAge && sgAge.total) {
      var hdb = share(d.hdb, d.total), priv = share(d.condo + d.landed, d.total);
      var kind = hdb >= 70 ? 'mostly HDB' : (priv >= 50 ? 'mostly private' : 'mixed');
      var old = share(age.bands[3][1], age.total), sgOld = share(sgAge.bands[3][1], sgAge.total);
      var ageWord = old > sgOld + 2 ? 'Older' : (old < sgOld - 2 ? 'Younger' : 'Average-age');
      var condo = share(d.condo, d.total), sgCondo = sg.dwelling ? share(sg.dwelling.condo, sg.dwelling.total) : null;
      lines.push('<strong>' + ageWord + ', ' + kind + '</strong> area — ' + (oneIn(old) ? '1 in ' + oneIn(old) : 'very few') + ' residents ' + (oneIn(old) ? 'is' : 'are') + ' 65+, and ' +
        pctText(condo) + ' live in condos' + (sgCondo != null ? ' (Singapore ' + pctText(sgCondo) + ')' : '') + '.');
    }
    var ch = c.change;
    if (ch && ch.residents) {
      var r = growth(ch.residents), other = [['condo homes', ch.condoHomes], ['children under 15', ch.under15]].filter(function (x) { return x[1]; })
        .sort(function (x, y) { return Math.abs(growth(y[1])) - Math.abs(growth(x[1])); })[0];
      var line = '<strong>Changing:</strong> ' + (Math.abs(r) < 3 ? 'about as many residents as in 2010' : Math.abs(r) + '% ' + (r > 0 ? 'more' : 'fewer') + ' residents than 2010');
      if (other) {
        var o = growth(other[1]);
        line += ((o > 0) !== (r > 0) && Math.abs(r) >= 3 ? ', but ' : ', and ') + other[0] + ' ' + (o > 0 ? 'up ' : 'down ') + Math.abs(o) + '%';
      }
      lines.push(line + '.');
    }
    var u = a.ura, nat = S.meta.uraNational;
    if (u && u.badge && u.trend != null) {
      var cmp = nat && nat.trend != null ? (u.trend > nat.trend + 1 ? ' — faster than Singapore (' : (u.trend < nat.trend - 1 ? ' — slower than Singapore (' : ' — about the same as Singapore (')) + nat.trend + '%)' : '';
      lines.push('<strong>Prices ' + u.badge.toLowerCase() + '</strong> ' + (u.trend > 0 ? '+' : '') + u.trend + '% a year' + cmp + '.');
    }
    if (!lines.length) return '';
    return '<div class="box"><span class="eyebrow">In short' + tip('Written automatically from the numbers on the People and Growth tabs, using fixed rules.') + '</span>' +
      '<ul class="plain big">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
  }

  function growth(v) { return v && v[0] ? Math.round(100 * (v[v.length - 1] - v[0]) / v[0]) : 0; }

  // Tab 2: who lives here + the worked-out figures
  function areaPeople(id) {
    var a = S.areas[id], c = a.census || {};
    var sg = (S.meta.census || {}).sg || {};
    if (!c.ethnic || c.ethnic.total < MIN_PEOPLE) return whoBlock(a.census, a.name, true);
    function solo(part) { return part ? '<div class="box who-box solo">' + part + '</div>' : ''; }
    return '<div class="box who-box"><div class="head-row"><span class="eyebrow">Who lives here' +
      tip('Census 2020 (Singapore Department of Statistics): citizens and PRs only, numbers rounded to the nearest 10. Foreigners on work passes are not counted by area.') + '</span></div>' +
      ethnicPart(c.ethnic, sg.ethnic, a.name, c.ethnicPrivate) + '</div>' +
      prPart(c) + solo(c.age && agePart(c.age, sg.age)) + solo(languagePart(c.language)) + solo(c.dwelling && homePart(c.dwelling, sg.dwelling)) +
      solo(tenancyPart(c.tenancy, sg.tenancy, a.rent)) + noLocalPart(a) + incomePart(c.income, a.name);
  }

  function prPart(c) {
    var p = c.pr, sg = ((S.meta.census || {}).sg || {}).pr;
    if (!p || !c.ethnic || c.ethnic.total < MIN_PEOPLE) return '';

    return '<div class="box"><div class="head-row"><span class="eyebrow">Citizens vs PRs <span class="est est-warn">Rough estimate' +
      tip('Not published by area. Worked out as: each ethnic group here × the share of that group who are PRs in all of Singapore (2020: Chinese 11%, Malays 3%, Indians 27%, Others 58%). It can\'t see that PRs prefer some areas or condos, so it stays close to the Singapore figure. Foreigners on work passes are not counted.') + '</span></span></div>' +
      gaugeSvg([['Citizens', 100 - p.pct, CH.green], ['PRs', p.pct, CH.red]]) +
      '<ul class="plain"><li><strong>~' + n(p.citizens) + '</strong> citizens · <strong>~' + n(p.pr) + '</strong> PRs' +
      (sg ? ' (Singapore: ' + Math.round(sg.pct) + '% PRs).' : '.') + '</li></ul></div>';
  }

  var INCOME_COLORS = [CH.grey, CH.lgreen, CH.green];
  function incomePart(inc, place) {
    if (!inc) return '';
    function column(label, x, on) {
      return '<div class="col' + (on ? ' on' : '') + '"><span class="top"><strong>' + Math.round(x[2]) + '%</strong> $10k+</span>' +
        lineBar(x.map(function (v, i) { return [v, INCOME_COLORS[i]]; }), 1.25, 14) + '<small>' + label + '</small></div>';
    }
    var zero = inc.private.indexOf(0) >= 0, off = Math.abs(inc.privateHouseholds - inc.censusPrivateHouseholds) > 0.15 * inc.censusPrivateHouseholds;
    var rough = zero || off;
    return '<div class="box"><div class="head-row"><span class="eyebrow">Household income <span class="est ' + (rough ? 'est-warn">Rough estimate' : 'est-ok">Estimate') +
      tip('Monthly household income from work (Census 2020, citizens\' and PRs\' households). Condo & landed = all households here minus HDB households, assuming each HDB flat type earns like the same flat type across Singapore (the same idea as the ethnic estimate). Check: this gives ' +
        n(inc.privateHouseholds) + ' condo & landed households vs ' + n(inc.censusPrivateHouseholds) + ' in the census.' +
        (zero ? ' A 0% means the subtraction ran out (HDB households here earn differently from the Singapore average), not that nobody is in that group.' : '')) + '</span></span></div>' +
      '<div class="cols lines">' + column('Everyone', inc.all) + column('Condo &amp; landed', inc.private, true) + column('Singapore*', inc.sgPrivate) + '</div>' +
      '<div class="legend">' + inc.labels.map(function (l, i) { return '<span><i style="background:' + INCOME_COLORS[i] + '"></i>' + l + '</span>'; }).join('') + '</div>' +
      '<ul class="plain"><li>About <strong>' + Math.round(inc.private[2] / 10) + ' in 10</strong> condo &amp; landed homes in ' + esc(place) + ' earn $10k+ a month (*Singapore condo &amp; landed: ' +
      Math.round(inc.sgPrivate[2] / 10) + ' in 10).</li></ul></div>';
  }

  // Condo units built by 2020 (URA residential projects × MCST units) minus citizens' / PRs' condo households (Census 2020)
  function noLocalPart(a) {
    var u = a.condoUnits, hh = (a.census || {}).condoHouseholds;
    if (!u || !u.units || hh == null || u.units < 200) return '';
    var gap = Math.max(u.units - hh, 0), p = share(gap, u.units);
    return '<div class="box"><div class="head-row"><span class="eyebrow">Condo units without a local household <span class="est est-warn">Rough estimate' +
      tip('Condo units built by 2020 (' + u.condos + ' URA residential projects matched to the BCA MCST register: ' + n(u.units) + ' units) minus the condo households of citizens and PRs (Census 2020: ' + n(hh) +
        '). The rest are mostly foreigners renting (e.g. EP holders) or empty. Rough: condos without an MCST match are missing, and the census also counts ECs and apartments.') + '</span></span></div>' +
      '<div class="icons" role="img" aria-label="' + Math.round(p / 10) + ' in 10 condo units">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) {
        return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V9l8-6 8 6v12h-6v-6h-4v6z" fill="' + (i < Math.round(p / 10) ? CH.red : CH.green) + '"/></svg>';
      }).join('') + '<span class="hint">each = 1 in 10 of ' + n(u.units) + ' units</span></div>' +
      '<div class="legend"><span><i style="background:' + CH.green + '"></i>Citizen / PR home <strong>' + n(Math.min(hh, u.units)) + '</strong></span>' +
      '<span><i style="background:' + CH.red + '"></i>Foreigners or empty <strong>~' + n(gap) + '</strong> (' + pctText(p) + ')</span></div>' +
      (gap ? '<ul class="plain"><li>About <strong>1 in ' + oneIn(p) + '</strong> condo units here has no citizen or PR household.</li></ul>' :
        '<ul class="plain"><li>Nearly every condo unit here has a citizen or PR household.</li></ul>') + '</div>';
  }

  // Tab 3: prices, how it's changing, how crowded, what's coming
  function areaGrowth(id) {
    var a = S.areas[id];
    return trendBlock(a) + changeBlock((a.census || {}).change) + crowdBlock(a.crowd) +
      '<div class="box"><span class="eyebrow">New projects coming</span>' + soon('coming soon — URA pipeline (new condos, units, year)') + '</div>' +
      '<div class="box"><span class="eyebrow">Future MRT</span>' + soon('coming soon — new stations opening nearby') + '</div>';
  }

  function spark(vals) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pts = vals.map(function (v, i) { return (4 + i * 56 / (vals.length - 1)).toFixed(0) + ',' + (18 - 14 * (v - lo) / ((hi - lo) || 1)).toFixed(0); }).join(' ');
    return '<svg width="64" height="22" viewBox="0 0 64 22" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="#414140" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  }

  function changeBlock(ch) {
    if (!ch) return '';
    function row(label, vals, fmt) {
      if (!vals || !vals[0]) return '';
      var g = growth(vals), cls = Math.abs(g) < 3 ? 'flat' : (g > 0 ? 'up' : 'down');
      fmt = fmt || function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : n(v); };
      return '<div class="nrow"><span>' + label + '</span>' + spark(vals) + '<span class="nv">' + fmt(vals[0]) + ' → <strong>' + fmt(vals[vals.length - 1]) + '</strong></span>' +
        '<span class="arrow ' + cls + '">' + (cls === 'flat' ? '• ' : (g > 0 ? '▲ ' : '▼ ')) + Math.abs(g) + '%</span></div>';
    }
    var notes = [];
    if (ch.residents && Math.abs(growth(ch.residents)) >= 3) notes.push(growth(ch.residents) > 0 ? '<strong>more people</strong>' : 'fewer people');
    if (ch.over65 && ch.under15) notes.push(growth(ch.over65) - growth(ch.under15) > 20 ? '<strong>older</strong>' : (growth(ch.under15) > growth(ch.over65) ? '<strong>younger</strong>' : 'a similar age mix'));
    if (ch.condoHomes && growth(ch.condoHomes) >= 10) notes.push('<strong>more condos</strong>');
    var text = notes.length ? notes.join(', ').replace(/, ([^,]*)$/, ' and $1') : '';
    return '<div class="box"><div class="head-row"><span class="eyebrow">How it\'s changing' +
      tip('Census 2010, General Household Survey 2015 and Census 2020 (citizens and PRs only). Condo homes = households living in condos and apartments. Income is not adjusted for inflation.') +
      '</span><span class="hint">2010 → 2020</span></div>' +
      row('Residents', ch.residents) + row('Aged 65+', ch.over65) + row('Under 15', ch.under15) + row('Condo homes', ch.condoHomes) +
      row('Earning $10k+', ch.earn10k, function (v) { return v + '%'; }) +
      (text ? '<ul class="plain"><li>' + text.charAt(0).toUpperCase() + text.slice(1) + ' than 10 years ago.</li></ul>' : '') + '</div>';
  }

  function crowdBlock(cr) {
    if (!cr) return '';
    return '<div class="box"><div class="head-row"><span class="eyebrow">How crowded' +
      tip('Residents (citizens and PRs, Census 2020) ÷ land area of the planning area (' + cr.km2 + ' km²). Foreign workers are not counted. Each bar is one area, quietest on the left; this area is in red. Rank is among the ' + cr.of + ' areas with homes (1 = busiest).') +
      '</span><span class="hint">#' + cr.rank + ' of ' + cr.of + ' areas</span></div>' +
      '<div class="scale"><div class="crowd-bars" role="img" aria-label="Rank ' + cr.rank + ' of ' + cr.of + ' (1 = busiest)">' + (function () {
        var out = '', me = cr.of - cr.rank + 1;          // quiet on the left, busiest on the right
        for (var i = 1; i <= cr.of; i++) out += '<i style="height:' + (i === me ? 40 : Math.round(12 + 18 * i / cr.of)) + 'px;background:' + (i === me ? CH.red : CH.grey) + '"></i>';
        return out;
      })() + '</div><div class="sends"><span>Quiet</span><span>Busy</span></div></div>' +
      '<div><strong>' + n(cr.perKm2) + '</strong> people per km² · Singapore average ' + n(cr.sg) + '</div></div>';
  }

  function areaCondosTab(id) {
    var p = S.panel;
    return '<div class="list-tools"><label class="sr-only" for="areaQ">Search condos in this area</label>' +
      '<input id="areaQ" type="search" placeholder="Search condos in ' + esc(S.areas[id].name) + '" value="' + esc(p.q) + '" autocomplete="off">' +
      '<label class="sr-only" for="areaSort">Sort</label><select id="areaSort">' +
      [['count', 'Most for sale'], ['score', 'Best score'], ['priceUp', 'Price: low to high'], ['priceDown', 'Price: high to low'], ['name', 'Name A–Z']].map(function (o) {
        return '<option value="' + o[0] + '"' + (p.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="seg view-seg" role="group" aria-label="Show condos as">' +
      '<button type="button" data-view="list" aria-pressed="' + (S.condoView !== 'grid') + '">☰ List</button>' +
      '<button type="button" data-view="grid" aria-pressed="' + (S.condoView === 'grid') + '">▦ Thumbnails</button></div>' +
      '<div id="areaList" class="area-list' + (S.condoView === 'grid' ? ' grid' : '') + '">' + areaCondoList(id) + '</div>';
  }

  // Thumbnail picture: the condo building's photo (Google) first; if there's none (or Google isn't set up), a OneMap map of the spot
  function mapThumb(c) {
    return c.lat == null ? '' : 'https://www.onemap.gov.sg/api/staticmap/getStaticImage?layerchosen=grey&zoom=17&width=400&height=300&latitude=' +
      c.lat.toFixed(5) + '&longitude=' + c.lng.toFixed(5) + '&points=' + encodeURIComponent('[' + c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + ',"242,106,46"]');
  }
  function thumbImg(c) {
    var fallback = mapThumb(c);
    var g = S.meta.google && !S.meta.online;      // online copy: OneMap map thumbnails (saves Google look-ups)
    var src = g ? '/api/google/thumb?condo=' + encodeURIComponent(c.key) : fallback;
    return '<span class="thumb-img">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy"' +
      (g && fallback ? ' onerror="this.onerror=null;this.src=\'' + esc(fallback) + '\';this.parentNode.classList.add(\'map\')"' : '') + '>' : '') +
      '<small>' + (g ? 'Photo: Google' : 'Map: OneMap') + '</small></span>';
  }

  function areaCondoList(id) {
    var p = S.panel, q = (p.q || '').toLowerCase();
    var condos = areaCondos(id).filter(function (c) { return !q || (c.name + ' ' + c.address + ' ' + c.mrt).toLowerCase().indexOf(q) >= 0; });
    condos.sort(function (x, y) {
      if (p.sort === 'priceUp') return fromPrice(x) - fromPrice(y);
      if (p.sort === 'priceDown') return fromPrice(y) - fromPrice(x);
      if (p.sort === 'name') return x.name.localeCompare(y.name);
      if (p.sort === 'score') return scoreOf(y) - scoreOf(x) || x.name.localeCompare(y.name);
      return shown(y).length - shown(x).length || x.name.localeCompare(y.name);
    });
    var list = condos.map(function (c) {
      var u = shown(c), star = S.shortlist.indexOf(c.key) >= 0;
      if (S.condoView === 'grid') {
        return '<button type="button" class="thumb" data-condo="' + esc(c.key) + '">' + thumbImg(c) +
          '<span class="thumb-body"><strong>' + (star ? '<span class="star-mark">★</span> ' : '') + esc(c.name) + '</strong>' +
          '<span class="thumb-price">' + (u.length > 1 ? '<small>from </small>' : '') + money(u[0].price) + '</span>' +
          '<small>' + u.length + ' for sale · ' + range(u.map(function (l) { return l.beds; }), function (b) { return b; }) + ' bed</small>' +
          (c.score && c.score.total != null ? '<small class="sc">Score ' + c.score.total + '</small>' : '') + '</span></button>';
      }
      return '<button type="button" class="list-item" data-condo="' + esc(c.key) + '"><span><strong>' +
        (star ? '<span class="star-mark">★</span> ' : '') + esc(c.name) + '</strong>' + (c.ec ? '<span class="badge">EC</span>' : '') +
        '<small>' + u.length + ' for sale · ' + range(u.map(function (l) { return l.beds; }), function (b) { return b; }) + ' bed · ' +
        range(u.map(function (l) { return l.size; }), function (v) { return v.toLocaleString('en-SG'); }) + ' sqft</small></span>' +
        '<span class="price">' + money(u[0].price) + (u.length > 1 ? '<small>from</small>' : '') + scoreTag(c) + '</span></button>';
    }).join('');
    if (list) return list;
    if (q) return '<div class="empty">No condos here match "' + esc(p.q) + '".</div>';
    return '<div class="empty">No listings here' + (S.listings.some(function (l) { return l.area === id; }) ? ' with these filters.' : ' yet.') + '</div>';
  }

  function condoHtml(c) {
    var a = S.areas[c.area] || {}, units = shown(c);
    if (!units.length) units = c.units;          // filtered out, but still show what we have
    var star = S.shortlist.indexOf(c.key) >= 0, tab = S.panel.tab;
    var groups = sameUnits(units);
    return '<div class="card-head"><div class="head-col">' +
      '<div class="head-row">' + (a.name ? '<button type="button" class="btn" data-action="back">← Back to ' + esc(a.name) + '</button>' : '<span></span>') +
      '<button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></div>' +
      '<div class="head-row" style="align-items:flex-start"><div><div class="title">' + esc(c.name) + (c.ec ? '<span class="badge">EC</span>' : '') + '<span id="gRating" class="g-rating">' + googleRating(c) + '</span></div>' +
      '<div class="sub">' + esc([c.address, a.name, c.district].filter(Boolean).join(' · ')) + '</div></div>' +
      '<button type="button" class="btn short-btn' + (star ? ' on' : '') + '" data-action="star" aria-pressed="' + star + '">' +
      (star ? '★ Shortlisted' : '☆ Shortlist') + '</button></div>' +
      tabButtons([['summary', 'Summary'], ['nearby', 'Nearby'], ['prices', 'Prices'], ['sale', 'For sale (' + groups.length + ')']], tab) +
      '</div></div>' +
      '<div class="card-body">' + (tab === 'sale' ? saleTab(c, groups) : (tab === 'prices' ? uraSalesBlock(c) + rentTab(c, units) :
        (tab === 'nearby' ? nearbyBlock(c) + neighbourhoodBlock(c) : condoSummary(c, units, groups)))) + '</div>' + dock(c, units, star);
  }

  function leaseText(c) {
    var u = c.ura;
    if (u && u.leaseYears && u.leaseStart) {
      var left = u.leaseYears - (new Date().getFullYear() - u.leaseStart);
      return u.leaseYears + '-year lease from ' + u.leaseStart + ' · <strong>' + Math.max(left, 0) + ' years left</strong>';
    }
    return esc(c.tenure || '—');
  }

  // Tab 1: photos, in short, score, key facts, reviews
  function condoSummary(c, units, groups) {
    var u = c.ura, last5 = u ? u.sales.slice(0, 5) : [];
    var review = c.review
      ? '<div>' + esc(c.review.reviewTitle) + '</div><div class="hint">' + esc(c.review.reviewType) + '</div>' +
        '<a href="' + esc(c.review.reviewUrl) + '" target="_blank" rel="noopener">Read review →</a>'
      : '<span class="empty">No Stacked Homes review found for this condo.</span>';
    return condoHero(c, units, groups) + workerAlert(c) + '<div id="gPhotos">' + googlePhotos(c) + '</div>' + condoShort(c, units, groups) +
      scoreBlock(c.score) +
      '<div class="grid2">' +
      '<button type="button" class="stat stat-btn" data-tab="sale">For sale<strong>' + (units.length > 1 ? 'from ' : '') + money(units[0].price) + '</strong>' +
      groups.length + ' unit' + (groups.length === 1 ? '' : 's') + ' · see tab →</button>' +
      '<button type="button" class="stat stat-btn key" data-tab="prices">URA last 5 sales<strong>' + (last5.length ? range(last5.map(function (x) { return x.price; }), money) : soon(u ? 'none' : 'no URA match')) + '</strong>' +
      (last5.length ? 'latest ' + monthText(last5[0].month) + ' · see tab →' : '') + '</button></div>' +
      '<div class="rows">' +
      '<div><span>Tenure</span><span>' + leaseText(c) + '</span></div>' +
      '<div><span>Built · Type</span><span>' + esc(c.built || '—') + ' · ' + esc(units[0].type || '—') + '</span></div>' +
      '<div><span>MCST</span><span>' + (c.mcst ? 'MCST ' + esc(c.mcst.no) + ' · ' + n(c.mcst.units) + ' units' + (c.mcst.agent ? ' · ' + esc(c.mcst.agent) : '') +
        (c.mcst.formed ? '<br><small class="hint">formed ' + esc(c.mcst.formed) + '</small>' : '') : '<span class="soon-text">not found</span>') + '</span></div></div>' +
      '<div class="box"><span class="eyebrow">Stacked Homes review</span>' + review + '</div>' +
      '<div id="gReviews">' + googleReviews(c) + '</div>';
  }

  // Half-circle gauge: drive to VivoCity in the middle; MRT, hawker, supermarket below (green = close, red = far)
  var CLOSE = { mrt: 800, hawker: 600, shop: 600 };          // metres; MRT also counts as close at ≤ 10 min walk
  function condoHero(c, units, groups) {
    var nb = c.near || {}, u = c.ura, now = new Date().getFullYear();
    var lease = u && u.leaseYears && u.leaseStart ? u.leaseYears + '-yr · ' + Math.max(u.leaseYears - (now - u.leaseStart), 0) + ' left'
      : (isFreehold(c.tenure) ? 'Freehold' : (c.tenure || ''));
    var price = units[0].price;
    function state(m, limit, walk) { return m == null ? '' : ((walk != null ? walk <= 10 : m <= limit) ? 'near' : 'far'); }
    var parts = [
      ['MRT ' + (nb.mrt && nb.mrt.exit ? 'exit ' + esc(nb.mrt.exit) : ''), nb.mrt ? (nb.mrt.walkMin ? nb.mrt.walkMin + ' min' : metres(nb.mrt.m)) : '—',
        state(nb.mrt && nb.mrt.m, CLOSE.mrt, nb.mrt && nb.mrt.walkMin)],
      ['Hawker', nb.hawkers && nb.hawkers[0] ? metres(nb.hawkers[0].m) : '—', state(nb.hawkers && nb.hawkers[0] && nb.hawkers[0].m, CLOSE.hawker)],
      ['Supermarket', nb.supermarket ? metres(nb.supermarket.m) : '—', state(nb.supermarket && nb.supermarket.m, CLOSE.shop)]
    ];
    var colour = { near: '#38bc37', far: '#f44336', '': '#d6d5d0' };
    function arc(a0, a1, col) {
      function pt(a) { var r = a * Math.PI / 180; return (120 + 100 * Math.cos(r)).toFixed(1) + ' ' + (120 - 100 * Math.sin(r)).toFixed(1); }
      return '<path d="M' + pt(a0) + ' A100 100 0 0 1 ' + pt(a1) + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round"/>';
    }
    var gauge = '<svg width="240" height="132" viewBox="0 0 240 132" aria-hidden="true">' +
      arc(180, 0, '#ecebe7') + arc(180, 128, colour[parts[0][2]]) + arc(118, 62, colour[parts[1][2]]) + arc(52, 0, colour[parts[2][2]]) + '</svg>';
    var key = tip('Middle = OneMap drive to VivoCity in normal traffic. Below: green = close (MRT ≤ 10 min walk or 800 m, hawker / supermarket ≤ 600 m), red = further.');
    var drive = (nb.drive ? '<b>' + nb.drive.min + ' min</b>drive to VivoCity' : '<b>—</b>' + (S.meta.onemapLogin ? 'drive time not available' : 'drive needs the OneMap login')) + key;
    return '<div class="box hero"><span class="lab">Asking from</span>' +
      '<div class="money">' + (price ? full(price) : '—') + '<span>.00</span></div>' +
      '<div class="pills"><span class="pill">' + groups.length + ' unit' + (groups.length === 1 ? '' : 's') + ' for sale</span>' +
      (lease ? '<span class="pill">' + esc(lease) + (c.built ? ' · ' + esc(c.built) : '') + '</span>' : '') + '</div>' +
      '<div class="gauge">' + gauge + '<div class="g">' + drive + '</div></div>' +
      '<div class="gl">' + parts.map(function (x) { return '<span class="' + x[2] + '"><b>' + x[1] + '</b>' + x[0] + '</span>'; }).join('') + '</div></div>';
  }

  // Floating action bar at the bottom of the condo card (all tabs)
  function dock(c, units, star) {
    var cheapest = units[0], plan = units.filter(function (l) { return l.floorplan; })[0];
    return '<div class="dock"><button type="button" class="' + (star ? 'dark' : '') + '" data-action="star" aria-pressed="' + star + '">' + (star ? '★ Shortlisted' : '☆ Shortlist') + '</button>' +
      '<a href="' + esc(plan ? plan.floorplan : cheapest.url) + '" target="_blank" rel="noopener">Floor plan' + (plan ? '' : ' on ' + esc(cheapest.source)) + '</a>' +
      '<a href="' + esc(cheapest.url) + '" target="_blank" rel="noopener">Open listing ↗</a></div>';
  }

  function metres(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m'; }

  // "In short" for a condo (fixed rules, agreed 23 Oct)
  function condoShort(c, units, groups) {
    var lines = [], u = c.ura, now = new Date().getFullYear();
    var lease = u && u.leaseYears && u.leaseStart ? Math.max(u.leaseYears - (now - u.leaseStart), 0) + ' years of lease left'
      : (isFreehold(c.tenure) ? 'Freehold' : (c.tenure || ''));
    var bits = [];
    if (c.built) bits.push('built ' + c.built + (c.built <= now ? ' (' + (now - c.built) + ' years old)' : ''));
    var size = '';
    if (c.mcst && c.mcst.units) {
      bits.push(n(c.mcst.units) + ' units');
      size = c.mcst.units < 150 ? ' — a small block' : (c.mcst.units > 600 ? ' — a big estate' : ' — mid-sized');
    }
    if (lease || bits.length) lines.push('<strong>' + esc(lease || 'Tenure unknown') + '</strong>' + (bits.length ? ', ' + bits.join(' · ') : '') + size + '.');
    var diffs = groups.map(function (g) { return vsUra(g[0], c); }).filter(Boolean).map(function (v) { return v.pct; });
    if (diffs.length) {
      var d = Math.round(median(diffs));
      lines.push(Math.abs(d) <= 3 ? '<strong>Asking about the same</strong> as recent URA sales.' :
        '<strong>Asking about ' + Math.abs(d) + '% ' + (d > 0 ? 'above' : 'below') + '</strong> recent URA sales.');
    }
    var nb = c.near, life = [];
    if (nb && nb.mrt) life.push(esc(nb.mrt.station) + (nb.mrt.exit ? ' exit ' + esc(nb.mrt.exit) : '') + ' ' + (nb.mrt.walkMin ? nb.mrt.walkMin + ' min walk' : metres(nb.mrt.m)));
    if (nb && nb.hawkers && nb.hawkers[0]) life.push('hawker ' + metres(nb.hawkers[0].m));
    if (nb && nb.supermarket) life.push(esc(nb.supermarket.name.split(' ').slice(0, 2).join(' ')) + ' ' + metres(nb.supermarket.m));
    if (life.length) lines.push('<strong>Daily life:</strong> ' + life.join(' · ') + '.');
    if (nb && nb.drive) lines.push('<strong>' + nb.drive.min + ' min drive</strong> to VivoCity (' + nb.drive.km + ' km, normal traffic).');
    var r = c.rent, cut = monthsAgo(12);
    if (r && r.rentals.length && c.mcst && c.mcst.units) {
      var p = share(r.rentals.filter(function (x) { return x.month > cut; }).length, c.mcst.units);
      lines.push('<strong>' + (p < 8 ? 'Mostly owners' : (p <= 20 ? 'Mixed owners and renters' : 'Rental-heavy')) + '</strong> (~' + pctText(p) + ' of units rented out a year).');
    }
    if (!lines.length) return '';
    return '<div class="box"><span class="eyebrow">In short' + tip('Written automatically from the numbers on the other tabs, using fixed rules.') + '</span>' +
      '<ul class="plain big">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
  }

  // Tab 2: what's near the condo
  function nearbyBlock(c) {
    var nb = c.near;
    if (!nb) return '<div class="box"><span class="eyebrow">Nearby</span><span class="empty">' + (c.lat == null ? 'This condo isn\'t on the map yet, so distances can\'t be worked out.' : 'Nearby places not loaded yet.') + '</span></div>';
    function row(label, main, sub) { return '<div><span>' + label + '</span><span>' + main + (sub ? '<br><small class="hint">' + sub + '</small>' : '') + '</span></div>'; }
    var listed = c.mrt && nb.mrt && c.mrt.toLowerCase().indexOf(nb.mrt.station.replace(/ MRT$| LRT$/, '').toLowerCase()) < 0 ? 'listing says: ' + esc(c.mrt) : '';
    var walk = nb.mrt && nb.mrt.walkMin ? nb.mrt.walkMin + ' min walk' : metres(nb.mrt ? nb.mrt.m : 0);
    var mrt = nb.mrt ? row('MRT', esc(nb.mrt.station) + ' · <strong>' + (nb.mrt.exit ? 'exit ' + esc(nb.mrt.exit) + ', ' : '') + walk + '</strong>' +
      (nb.mrt.walkMin ? ' <span class="hint">(' + metres(nb.mrt.m) + ')</span>' : ''),
      [nb.mrt2 ? esc(nb.mrt2.station) + ' ' + metres(nb.mrt2.m) : '', listed].filter(Boolean).join('<br>')) : row('MRT', soon('none found'));
    var hw = nb.hawkers || [];
    var pk = nb.primary || { in1km: 0, in2km: 0, list: [] };
    var schools = row('Primary schools', '<strong>' + pk.in1km + '</strong> within 1 km · <strong>' + pk.in2km + '</strong> within 2 km' +
      (pk.list.length ? tip(pk.list.map(function (x) { return x[1] + ' ' + metres(x[0]); }).join('; ') + '. MOE measures the 1 km / 2 km from the school\'s boundary, so this is approximate.') : ''));
    var park = nb.park ? esc(nb.park.name) + ' · <strong>' + metres(nb.park.m) + '</strong>' : soon('none within 2 km');
    var big = [nb.bigPark && (!nb.park || nb.bigPark.name !== nb.park.name) ? 'big park: ' + esc(nb.bigPark.name) + ' ' + metres(nb.bigPark.m) : '',
      nb.dogRun ? 'dog run: ' + esc(nb.dogRun.name) + ' ' + metres(nb.dogRun.m) : ''].filter(Boolean).join('<br>');
    return '<div class="box"><span class="eyebrow">Nearby' +
      tip('Distances are straight lines from the condo; MRT walking times follow real paths (OneMap). Sources: LTA MRT exits, NEA hawker centres, NParks parks, MOE schools, NEA supermarket licences (mid-2024). Big park = 5 hectares or more.') + '</span>' +
      '<div class="rows">' + mrt +
      row('Hawker', hw[0] ? esc(hw[0].name) + ' · <strong>' + metres(hw[0].m) + '</strong>' : soon('none found'), hw[1] ? esc(hw[1].name) + ' ' + metres(hw[1].m) : '') +
      schools + row('Park', park, big) +
      row('Supermarket', nb.supermarket ? esc(nb.supermarket.name) + ' · <strong>' + metres(nb.supermarket.m) + '</strong>' : soon('none found'), nb.supermarket ? esc(nb.supermarket.street) : '') +
      workerRows(nb, row) +
      row('Expressway', soon()) +
      row('Drive to VivoCity', nb.drive ? '<strong>' + nb.drive.min + ' min</strong> · ' + nb.drive.km + ' km' +
        tip('OneMap driving route to VivoCity\'s main entrance, in normal traffic — rush hour is usually slower.') :
        soon(S.meta.onemapLogin ? 'not available' : 'needs the OneMap login')) +
      '</div></div>';
  }

  // Worker dormitories / weekend gathering spots: information only, highlighted when close (asked 24 Oct)
  var WORKERS_CLOSE = 1000, WORKERS_VERY = 500;          // metres
  function nearTag(m) {
    return m <= WORKERS_VERY ? '<span class="chip bad">Very close</span>' : (m <= WORKERS_CLOSE ? '<span class="chip warn">Close</span>' : '');
  }
  function workerRows(nb, row) {
    var d = nb.dorm, sp = nb.spot;
    return row('Worker dormitory' + tip('From OneMap building names (and Google Maps on the Mac). Blocks = buildings of the same dormitory. Highlighted within 1 km.'),
        d ? esc(d.name) + ' · <strong>' + metres(d.m) + '</strong> ' + nearTag(d.m) : '<span class="ok-text">none within 2 km</span>',
        d && d.blocks > 1 ? d.blocks + ' blocks' : '') +
      row('Weekend gathering spot' + tip('Hand-made list of well-known weekend gathering places, from news reports — not official data. Highlighted within 1 km.'),
        sp ? esc(sp.name) + ' · <strong>' + metres(sp.m) + '</strong> ' + nearTag(sp.m) : '<span class="ok-text">none within 2 km</span>',
        sp ? esc(sp.note) : '') +
      worshipRows(nb, row);
  }
  // Places of worship, existing and planned (URA Master Plan 2025 + OneMap names) — same treatment as dormitories
  var WORSHIP_CLOSE = 150, WORSHIP_VERY = 100;          // existing ones are everywhere: only flag next-door (agreed 24 Oct)
  function worshipTag(m) {
    return m <= WORSHIP_VERY ? '<span class="chip bad">Very close</span>' : (m <= WORSHIP_CLOSE ? '<span class="chip warn">Close</span>' : '');
  }
  function worshipName(w) { return w.name ? esc(w.name) : esc(w.kind) + ' (name not on record)'; }
  function worshipRows(nb, row) {
    var w = nb.worship, p = nb.worshipPlanned;
    return row('Place of worship' + tip('Nearest church, temple, mosque, gurdwara or other place of worship: plots zoned for worship in the URA Master Plan 2025, named from OneMap. Highlighted within 150 m (red within 100 m) — they are common, so only next-door ones are flagged.'),
        w ? worshipName(w) + ' · <strong>' + metres(w.m) + '</strong> ' + worshipTag(w.m) : '<span class="ok-text">none within 2 km</span>',
        w && w.name ? esc(w.kind) : '') +
      row('Planned place of worship' + tip('A plot zoned for worship in Master Plan 2025 that wasn\'t in Master Plan 2019 — likely to be built in future. Highlighted within 1 km.'),
        p ? 'New plot in Master Plan 2025 · <strong>' + metres(p.m) + '</strong> ' + nearTag(p.m) : '<span class="ok-text">none within 2 km</span>');
  }
  // Red / amber note at the top of the condo summary when a dormitory or gathering spot is within 1 km
  function workerAlert(c) {
    var nb = c.near || {}, items = [];
    if (nb.dorm && nb.dorm.m <= WORKERS_CLOSE) items.push(['Worker dormitory', esc(nb.dorm.name) + ' · <strong>' + metres(nb.dorm.m) + '</strong>' + (nb.dorm.blocks > 1 ? ' (' + nb.dorm.blocks + ' blocks)' : ''), nb.dorm.m]);
    if (nb.worship && nb.worship.m <= WORSHIP_CLOSE) items.push(['Place of worship', worshipName(nb.worship) + ' · <strong>' + metres(nb.worship.m) + '</strong>' + (nb.worship.name ? '<br><small>' + esc(nb.worship.kind) + '</small>' : ''), nb.worship.m <= WORSHIP_VERY ? 0 : WORKERS_VERY + 1]);
    if (nb.worshipPlanned && nb.worshipPlanned.m <= WORKERS_CLOSE) items.push(['Planned place of worship', 'New plot in Master Plan 2025 · <strong>' + metres(nb.worshipPlanned.m) + '</strong>', nb.worshipPlanned.m]);
    if (nb.spot && nb.spot.m <= WORKERS_CLOSE) items.push(['Weekend gathering spot', esc(nb.spot.name) + ' · <strong>' + metres(nb.spot.m) + '</strong><br><small>' + esc(nb.spot.note) + '</small>', nb.spot.m]);
    if (!items.length) return '';
    var very = items.some(function (x) { return x[2] <= WORKERS_VERY; });
    return '<div class="box alert' + (very ? ' very' : '') + '"><span class="eyebrow">⚠ Near this condo' +
      tip('Dormitories, gathering spots and planned places of worship within 1 km (red within 500 m); existing places of worship within 150 m (red within 100 m). Information only — not part of the score. See the Nearby tab.') + '</span>' +
      '<div class="rows">' + items.map(function (x) { return '<div><span>' + x[0] + '</span><span>' + x[1] + '</span></div>'; }).join('') + '</div></div>';
  }

  function rentLabel(p) {
    if (p == null) return '';
    if (p >= 20) return '<span class="chip bad">Rental-heavy</span>';
    if (p >= 8) return '<span class="chip flat">Mixed</span>';
    return '<span class="chip good">Mostly owner-occupied</span>';
  }

  function bandText(r) { return r.sqftLo ? (r.sqftHi && r.sqftHi !== r.sqftLo ? n(r.sqftLo) + '–' + n(r.sqftHi) : (r.sqftHi ? n(r.sqftLo) : '> ' + n(r.sqftLo))) + ' sqft' : '—'; }
  function quartile(xs, q) { xs = xs.slice().sort(function (a, b) { return a - b; }); return xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1) + 0.5))] : null; }

  function rentTab(c, units) {
    var r = c.rent, st = S.meta.rentStatus || {};
    if (!r || !r.rentals.length) {
      return '<div class="box"><span class="eyebrow">Renting in this condo</span><span class="empty">' +
        (st.ok === false ? 'URA rentals not loaded: ' + esc(st.message) : 'No URA rental contracts found for this condo in the past 5 years (or the name didn\'t match).') + '</span></div>';
    }
    var rows = r.rentals, cut12 = monthsAgo(12), cut24 = monthsAgo(24);
    var last12 = rows.filter(function (x) { return x.month > cut12; });
    var unitsTotal = c.mcst ? c.mcst.units : null, pct = unitsTotal ? share(last12.length, unitsTotal) : null;

    // 1. how busy renting is
    var out = '<div class="box"><div class="head-row"><span class="eyebrow">Renting in this condo' +
      tip('Share = rentals signed in the last 12 months ÷ units in the condo. Leases run 1–2 years, so the share of units with tenants right now can be up to about double. Tenants include locals, PRs and foreigners (e.g. EP holders). Source: URA rental contracts, BCA MCST register.') +
      '</span>' + rentLabel(pct) + '</div>' +
      '<div class="grid2">' +
      '<div class="stat">Units in the condo<strong>' + (unitsTotal ? n(unitsTotal) : '—') + '</strong>' + (c.mcst ? 'MCST register' : 'not found') + '</div>' +
      '<div class="stat key">Rentals signed, last 12 months<strong>' + n(last12.length) + '</strong>' + (pct != null ? '≈ ' + pctText(pct) + ' of units' : '') + '</div></div></div>';

    // 2. rent by bedrooms (last 12 months; last 24 if fewer than 3 contracts)
    var beds = {};
    rows.forEach(function (x) { if (x.beds != null && x.month > cut24) (beds[x.beds] = beds[x.beds] || []).push(x); });
    var bedRows = Object.keys(beds).sort().map(function (b) {
      var recent = beds[b].filter(function (x) { return x.month > cut12; }), use = recent.length >= 3 ? recent : beds[b];
      var rents = use.map(function (x) { return x.rent; });
      return { beds: +b, med: median(rents), lo: quartile(rents, 0.25), hi: quartile(rents, 0.75), n: use.length, months: recent.length >= 3 ? 12 : 24,
               band: mode(use.map(bandText)) };
    });
    out += '<div class="box"><div class="head-row"><span class="eyebrow">Rent by bedrooms' + tip('Typical = middle monthly rent of contracts in the last 12 months (last 2 years where there were fewer than 3). Usual range = the middle half of contracts.') + '</span></div>' +
      (bedRows.length ? '<div class="table-wrap"><table class="sales"><thead><tr><th>Beds</th><th>Typical</th><th>Usual range</th><th>Size</th><th>Contracts</th></tr></thead><tbody>' +
        bedRows.map(function (b) {
          return '<tr><td>' + bedsText(b.beds) + '</td><td><strong>' + full(b.med) + '</strong></td><td>' + full(b.lo) + '–' + full(b.hi) + '</td><td>' + esc(b.band) + '</td><td>' + b.n +
            (b.months === 24 ? ' <small class="hint">(2 yrs)</small>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<span class="empty">No recent contracts with bedroom counts.</span>') + '</div>';

    // 3. rentals per year + typical rent of the most common bedroom count
    var common = mode(rows.map(function (x) { return x.beds; }));
    var byYear = {};
    rows.forEach(function (x) { var y = x.month.slice(0, 4); (byYear[y] = byYear[y] || []).push(x); });
    var years = Object.keys(byYear).sort(), hi = Math.max.apply(null, years.map(function (y) { return byYear[y].length; }));
    if (years.length > 1) {
      out += '<div class="box"><div class="head-row"><span class="eyebrow">Rentals per year' + tip('Bar = rental contracts signed that year (latest year in pink). Small label = typical ' + bedsText(common) + ' rent that year.') + '</span></div>' +
        '<div class="bars lines rent">' + years.map(function (y, i) {
          var rr = byYear[y].filter(function (x) { return x.beds === common; }).map(function (x) { return x.rent; });
          return '<div class="bar' + (i === years.length - 1 ? ' on' : '') + '"><span class="bar-val">' + byYear[y].length + '</span><span class="bar-fill" style="height:' + Math.round(10 + 50 * byYear[y].length / hi) + 'px"></span>' +
            '<span class="bar-year">' + y + '</span><small class="hint">' + (rr.length ? '$' + (median(rr) / 1000).toFixed(1) + 'k' : '—') + '</small></div>';
        }).join('') + '</div></div>';
    }

    // 4. rental yield vs asking prices on the For sale tab
    var yields = bedRows.map(function (b) {
      var asks = units.filter(function (l) { return l.beds === b.beds && l.price; }).map(function (l) { return l.price; });
      return asks.length ? { beds: b.beds, rent: b.med, ask: median(asks), pct: 1200 * b.med / median(asks) } : null;
    }).filter(Boolean);
    if (yields.length) {
      out += '<div class="box"><div class="head-row"><span class="eyebrow">Rental yield' + tip('If you bought at today\'s typical asking price for that size and rented it out at the typical rent. Before costs: maintenance fees, property tax, agent fees, empty months.') + '</span></div>' +
        yields.map(function (y) {
          return '<div class="yield-row"><span>' + bedsText(y.beds) + '</span><span>' + full(y.rent) + ' × 12 ÷ ' + money(y.ask) + '</span><strong>' + y.pct.toFixed(1) + '% a year</strong></div>';
        }).join('') + '</div>';
    }

    // 5. recent contracts
    var list = S.panel.allRent ? rows : rows.slice(0, 8);
    out += '<div class="box"><div class="head-row"><span class="eyebrow">Recent rental contracts' + tip('Source: URA private residential rental contracts. Size is a band, as URA publishes it.') + '</span><span class="hint">' + rows.length + ' in 5 years</span></div>' +
      '<div class="table-wrap"><table class="sales"><thead><tr><th>Month</th><th>Beds</th><th>Size</th><th>Rent</th></tr></thead><tbody>' +
      list.map(function (x) { return '<tr><td>' + monthText(x.month) + '</td><td>' + (x.beds != null ? x.beds : '—') + '</td><td>' + esc(bandText(x)) + '</td><td>' + full(x.rent) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      (rows.length > 8 ? '<button type="button" class="link-btn" data-action="allrent">' + (S.panel.allRent ? 'Show recent 8 only' : 'Show all ' + rows.length) + '</button>' : '') +
      '</div>';
    return out;
  }

  function neighbourhoodBlock(c) {
    var sz = c.subzone && ((S.meta.census || {}).subzones || {})[c.subzone];
    return whoBlock(sz, sz ? sz.name : '', false);
  }

  function uraSalesBlock(c) {
    var u = c.ura;
    if (!u) return '<div class="box"><span class="eyebrow">URA actual sales</span><span class="empty">' +
      (S.meta.uraStatus && !S.meta.uraStatus.ok ? 'No URA sales for this condo. Note — ' + esc(S.meta.uraStatus.message) : 'No URA sales found for this condo in the past 5 years (or the name didn\'t match).') + '</span></div>';
    var sales = u.sales, list = S.panel.allSales ? sales : sales.slice(0, 5);
    var cutoff = monthsAgo(12), recent = sales.filter(function (x) { return x.month >= cutoff; });
    var rows = list.map(function (x) {
      return '<tr><td>' + monthText(x.month) + '</td><td>' + x.sqft.toLocaleString('en-SG') + '</td><td>' + esc(x.floor) + '</td><td>' +
        money(x.price) + '</td><td>' + full(x.psf) + '</td><td>' + esc(x.sale) + '</td></tr>';
    }).join('');
    return '<div class="box"><div class="head-row"><span class="eyebrow">URA actual sales' +
      tip('Source: URA, caveated private home sales (condos, apartments, ECs) over the past 5 years. Bulk deals (several units in one sale) are left out.' +
        (u.match !== 'name' ? ' Matched to URA project "' + u.project + '" by location — please check.' : '')) + '</span>' +
      (u.match !== 'name' ? '<span class="est est-warn">Check match</span>' : '<span class="hint">' + sales.length + ' sales</span>') + '</div>' +
      '<div>Last 12 months: <strong>' + recent.length + ' sale' + (recent.length === 1 ? '' : 's') + '</strong>' +
      (recent.length ? ' · typical <strong>' + full(median(recent.map(function (x) { return x.psf; }))) + ' psf</strong>' : '') + '</div>' +
      yearBars(sales) +
      '<div class="table-wrap"><table class="sales"><thead><tr><th>Month</th><th>Sqft</th><th>Floor</th><th>Price</th><th>$psf</th><th>Type</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (sales.length > 5 ? '<button type="button" class="link-btn" data-action="allsales">' + (S.panel.allSales ? 'Show last 5 only' : 'Show all ' + sales.length + ' sales') + '</button>' : '') +
      '</div>';
  }

  function yearBars(sales) {
    var by = {};
    sales.forEach(function (x) { var y = x.month.slice(0, 4); (by[y] = by[y] || []).push(x.psf); });
    var years = Object.keys(by).sort();
    if (years.length < 2) return '';
    var meds = years.map(function (y) { return median(by[y]); }), hi = Math.max.apply(null, meds);
    return '<div class="bars lines" aria-label="Typical $psf by year">' + years.map(function (y, i) {
      return '<div class="bar' + (i === years.length - 1 ? ' on' : '') + '"><span class="bar-val">' + full(meds[i]).replace('$', '$') + '</span><span class="bar-fill" style="height:' +
        Math.round(14 + 46 * meds[i] / hi) + 'px"></span><span class="bar-year">' + y + ' <small>(' + by[y].length + ')</small></span></div>';
    }).join('') + '</div>';
  }

  // Asking $psf vs URA sales of a similar size (±15%) in the same condo over the past 2 years
  function vsUra(l, c) {
    if (!c.ura || !l.psf) return null;
    var cutoff = monthsAgo(24), recent = c.ura.sales.filter(function (x) { return x.month >= cutoff; });
    var similar = l.size ? recent.filter(function (x) { return Math.abs(x.sqft - l.size) <= l.size * 0.15; }) : [];
    var basis = similar.length >= 3 ? similar : recent, kind = similar.length >= 3 ? 'similar-size' : 'all';
    if (basis.length < 3) return null;
    var med = median(basis.map(function (x) { return x.psf; }));
    return { pct: Math.round(100 * (l.psf - med) / med), psf: med, n: basis.length, kind: kind };
  }

  function saleTab(c, groups) {
    return '<div class="head-row"><span class="eyebrow">Units for sale' + tip('Each asking price is compared with URA actual sales in this condo over the past 2 years — similar size (±15%) where there are at least 3 such sales, otherwise all sizes. Red = asking above recent sales, green = below.') + '</span></div>' +
      groups.map(function (g) {
        var l = g[0], v = vsUra(l, c), lvl = (g.filter(function (x) { return x.floor; })[0] || {}).floor;
        var chip = v ? '<span class="chip ' + (v.pct > 5 ? 'up' : (v.pct < -5 ? 'down' : 'flat')) + '">' + (v.pct > 0 ? '+' : '') + v.pct +
          '% vs URA</span>' + tip('URA ' + (v.kind === 'similar-size' ? 'similar-size' : 'all') + ' sales in the last 2 years: typical ' + full(v.psf) + ' psf (' + v.n + ' sales). This unit asks ' + full(l.psf) + ' psf.')
          : '<span class="hint">' + (c.ura ? 'Not enough recent URA sales to compare.' : 'No URA sales to compare with.') + '</span>';
        var floor = l.floorplan ? '<a href="' + esc(l.floorplan) + '" target="_blank" rel="noopener">Floor plan →</a>'
          : '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">Floor plan on ' + esc(l.source) + ' →</a>';
        return '<div class="box unit"><div class="head-row"><strong>' + bedsText(l.beds) + (l.baths ? ' · ' + l.baths + ' bath' : '') + ' · ' +
          (l.size ? l.size.toLocaleString('en-SG') + ' sqft' : '—') + '</strong><span class="price">' + full(l.price) + '</span></div>' +
          '<div class="head-row"><span class="hint">' + full(l.psf) + ' psf' + (lvl ? ' · ' + esc(lvl) + (lvl === 'Penthouse' ? '' : ' floor') : '') + ' · ' + esc(l.source) + (g.length > 1 ? ' · posted ' + g.length + '×' : '') + '</span>' + (g.length > 1 ? tip('Posted ' + g.length + ' times with the same beds, size and price — most likely the same unit listed by different agents.') : '') + '<span>' + '</span></div>' +
          '<div class="vs">' + chip + '</div>' +
          '<div class="links">' + floor + '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">Open listing on ' + esc(l.source) + ' →</a></div></div>';
      }).join('');
  }

  function onPanelClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.action === 'close') closePanel();
    else if (t.dataset.action === 'back') openArea(S.panel.area, 'condos');
    else if (t.dataset.action === 'star') { var y4 = $('detail').querySelector('.card-body').scrollTop; toggleShort(S.panel.condo); $('detail').querySelector('.card-body').scrollTop = y4; }
    else if (t.dataset.condo) openCondo(t.dataset.condo, { fly: true });
    else if (t.dataset.photo) { openPhoto(+t.dataset.photo); }
    else if (t.dataset.action === 'gprev' || t.dataset.action === 'gnext') {
      var strip = t.parentNode.querySelector('.gphotos'), first = strip && strip.querySelector('.gph');
      if (first) strip.scrollBy({ left: (t.dataset.action === 'gnext' ? 1 : -1) * (first.offsetWidth + 8), behavior: 'smooth' });
    }
    else if (t.dataset.eview) { S.eview = t.dataset.eview; var y3 = $('detail').querySelector('.card-body').scrollTop; renderPanel(); $('detail').querySelector('.card-body').scrollTop = y3; }
    else if (t.dataset.view) {
      S.condoView = t.dataset.view;
      try { localStorage.setItem('hqCondoView', S.condoView); } catch (e2) { /* private window: just don't remember */ }
      var y5 = $('detail').querySelector('.card-body').scrollTop; renderPanel(); $('detail').querySelector('.card-body').scrollTop = y5;
    }
    else if (t.dataset.tab) { S.panel.tab = t.dataset.tab; renderPanel(); }
    else if (t.dataset.action === 'allrent') { S.panel.allRent = !S.panel.allRent; var y2 = $('detail').querySelector('.card-body').scrollTop; renderPanel(); $('detail').querySelector('.card-body').scrollTop = y2; }
    else if (t.dataset.action === 'allsales') { S.panel.allSales = !S.panel.allSales; var y = $('detail').querySelector('.card-body').scrollTop; renderPanel(); $('detail').querySelector('.card-body').scrollTop = y; }
  }

  // Listings with the same beds, size and price are usually one unit posted by several agents
  function sameUnits(units) {
    var seen = {}, out = [];
    units.forEach(function (l) {
      var k = [l.beds, l.size, l.price].join('|');
      if (!seen[k]) out.push(seen[k] = []);
      seen[k].push(l);
    });
    return out;
  }

  // ---- Google photos, rating and reviews (fetched when a condo opens; see google_places.py) ----
  function gmapsLink(c) {
    var g = S.google[c.key];
    return (g && g.uri) || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.name + ' Singapore'));
  }
  function streetLink(c) { return 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + c.lat + ',' + c.lng; }

  function loadGoogle(c) {
    if (!c || !S.meta.google || c.lat == null || S.google[c.key]) return;
    S.google[c.key] = { loading: true };
    api('/api/google/place?condo=' + encodeURIComponent(c.key)).then(function (d) {
      S.google[c.key] = d && !d.error ? d : { error: (d && d.error) || 'Google look-up failed' };
    }).catch(function () {
      S.google[c.key] = { error: 'Google look-up failed' };
    }).then(function () {
      if (S.panel && S.panel.condo === c.key) {
        if ($('gPhotos')) $('gPhotos').innerHTML = googlePhotos(c);
        if ($('gRating')) $('gRating').innerHTML = googleRating(c);
        if ($('gReviews')) $('gReviews').innerHTML = googleReviews(c);
      }
    });
  }

  function googleRating(c) {
    var g = S.google[c.key];
    if (!g || !g.rating) return '';
    return '<a href="' + esc(g.uri) + '" target="_blank" rel="noopener" title="Google rating">★ ' + g.rating.toFixed(1) +
      ' <small>(' + n(g.count || 0) + ')</small></a>';
  }

  function googlePhotos(c) {
    var g = S.google[c.key];
    if (!S.meta.google || c.lat == null) {
      return '<div class="photo">Photos: on the original listing' + (S.meta.google || S.meta.online ? '' : tip('Add a Google Maps key (Add API Keys.command) to see photos and Street View here.')) + '</div>';
    }
    var sv = window.HQ_STREETVIEW ? window.HQ_STREETVIEW(c) : '/api/google/streetview?condo=' + encodeURIComponent(c.key);   // online: straight from Google
    var items = [{ src: sv, credit: 'Street View', sv: true }];
    ((g && g.photos) || []).forEach(function (p) {
      items.push({ src: p.src, credit: p.authors.map(function (a) { return a.name; }).join(', '), authors: p.authors });
    });
    S.gallery = items;
    return '<div class="gwrap"><div class="gphotos" aria-label="Photos">' + items.map(function (it, i) {
      return '<button type="button" class="gph' + (it.sv ? ' sv' : '') + '" data-photo="' + i + '" aria-label="Open photo ' + (i + 1) + '">' +
        '<img src="' + esc(it.src) + '" alt="' + (it.sv ? 'Street View of ' + esc(c.name) : 'Photo of ' + esc(c.name)) + '" loading="lazy" onerror="this.parentNode.remove()">' +
        '<span class="gcred">' + (it.sv ? 'Street View' : '© ' + esc(it.credit)) + '</span></button>';
    }).join('') +
      (g && g.loading ? '<div class="gph gload">Loading photos…</div>' : '') + '</div>' +
      (items.length > 1 ? '<button type="button" class="garrow l" data-action="gprev" aria-label="Previous photo" hidden>‹</button>' +
        '<button type="button" class="garrow r" data-action="gnext" aria-label="Next photo">›</button>' +
        '<span class="gcount">1 / ' + items.length + '</span>' : '') + '</div>' +
      (g && g.error ? '<span class="est est-warn">Google photos unavailable' + tip(g.error) + '</span>' : '');
  }

  // Photo strip (option B, 25 Oct): no scroll bar; ‹ › buttons and a "1 / 7" counter follow the scroll position
  function photoStripMoved(strip) {
    var wrap = strip.parentNode, first = strip.querySelector('.gph'), count = wrap.querySelector('.gcount');
    if (!first || !count) return;
    var n = strip.querySelectorAll('.gph:not(.gload)').length, step = first.offsetWidth + 8;
    var i = Math.min(n, Math.round(strip.scrollLeft / step) + 1), end = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4;
    count.textContent = (end ? n : i) + ' / ' + n;
    wrap.querySelector('.garrow.l').hidden = strip.scrollLeft < 4;
    wrap.querySelector('.garrow.r').hidden = end;
  }

  function stars(r) { var k = Math.round(r || 0); return '★★★★★'.slice(0, k) + '☆☆☆☆☆'.slice(0, 5 - k); }

  function googleReviews(c) {
    var g = S.google[c.key];
    var links = '<div class="links"><a href="' + esc(gmapsLink(c)) + '" target="_blank" rel="noopener">Open in Google Maps →</a>' +
      (c.lat != null ? '<a href="' + esc(streetLink(c)) + '" target="_blank" rel="noopener">Street View →</a>' : '') + '</div>';
    var body;
    if (!S.meta.google) body = '';
    else if (!g || g.loading) body = '<span class="empty">Loading Google reviews…</span>';
    else if (g.error) body = '<span class="empty">Google reviews unavailable.' + tip(g.error) + '</span>';
    else if (!g.found) body = '<span class="empty">Google has no listing for this condo nearby.</span>';
    else if (!g.reviews.length) body = '<span class="empty">No Google reviews yet.</span>';
    else body = g.reviews.map(function (r) {
      var text = r.text.length > 260 ? r.text.slice(0, 257).replace(/\s+\S*$/, '') + '…' : r.text;
      return '<div class="greview"><div class="head-row"><span class="gstars" aria-label="' + r.rating + ' out of 5">' + stars(r.rating) + '</span>' +
        '<span class="hint">' + esc(r.when) + '</span></div><div>' + esc(text) + '</div>' +
        '<div class="hint">— ' + (r.authorUri ? '<a href="' + esc(r.authorUri) + '" target="_blank" rel="noopener">' + esc(r.author) + '</a>' : esc(r.author)) +
        (r.uri ? ' · <a href="' + esc(r.uri) + '" target="_blank" rel="noopener">Read on Google</a>' : '') + '</div></div>';
    }).join('');
    return '<div class="box"><div class="head-row"><span class="eyebrow">Google reviews' +
      tip('Reviews and photos come live from Google Maps each time you open a condo and are not saved. Google shows up to 5 reviews.') + '</span>' +
      (g && g.rating ? '<span class="g-rating">★ ' + g.rating.toFixed(1) + ' <small>(' + n(g.count || 0) + ')</small></span>' : '') + '</div>' +
      body + links + (S.meta.google ? '<span class="g-attr">Google Maps</span>' : '') + '</div>';
  }

  // Large photo viewer (click a photo; ← → to browse, Esc to close)
  function openPhoto(i) {
    var items = S.gallery || [];
    if (!items[i]) return;
    var box = $('lightbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lightbox';
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Photo');
      document.body.appendChild(box);
      box.addEventListener('click', function (e) {
        var t = e.target.closest('button');
        if (e.target === box || (t && t.dataset.lb === 'close')) closePhoto();
        else if (t && t.dataset.lb) openPhoto(+t.dataset.lb);
      });
      document.addEventListener('keydown', function (e) {
        if (box.hidden) return;
        if (e.key === 'Escape') closePhoto();
        else if (e.key === 'ArrowRight') openPhoto((S.photoAt + 1) % S.gallery.length);
        else if (e.key === 'ArrowLeft') openPhoto((S.photoAt - 1 + S.gallery.length) % S.gallery.length);
      });
    }
    S.photoAt = i;
    var it = items[i], prev = (i - 1 + items.length) % items.length, next = (i + 1) % items.length;
    var credit = it.sv ? 'Google Street View' : 'Photo: ' + (it.authors || []).map(function (a) {
      return a.uri ? '<a href="' + esc(a.uri) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>' : esc(a.name);
    }).join(', ') + ' · Google Maps';
    box.innerHTML = '<figure><img src="' + esc(it.src) + '" alt=""><figcaption>' + credit + ' · ' + (i + 1) + ' / ' + items.length + '</figcaption></figure>' +
      (items.length > 1 ? '<button type="button" class="lb-nav lb-prev" data-lb="' + prev + '" aria-label="Previous photo">‹</button>' +
        '<button type="button" class="lb-nav lb-next" data-lb="' + next + '" aria-label="Next photo">›</button>' : '') +
      '<button type="button" class="lb-close" data-lb="close" aria-label="Close">×</button>';
    box.hidden = false;
    box.querySelector('.lb-close').focus();
  }
  function closePhoto() { var b = $('lightbox'); if (b) b.hidden = true; }

  // ---- shortlist ------------------------------------------------------------------
  function toggleShort(key) {
    var i = S.shortlist.indexOf(key);
    if (i >= 0) { S.shortlist.splice(i, 1); delete S.shortAdded[key]; }
    else { S.shortlist.push(key); S.shortAdded[key] = new Date().toISOString(); }
    var items = S.shortlist.map(function (k) { return { key: k, added: S.shortAdded[k] || '' }; });
    api('/api/shortlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
      .catch(function () { alert("Couldn't save the shortlist — is the HomeQuest window still open?"); });
    refreshPin(key);
    if (pinLayer) pinLayer.refreshClusters();
    declutter();
    renderShortlist();
    renderPanel();
  }

  function fromPrice(c) { var u = shown(c).length ? shown(c) : c.units; return u[0].price || 9e9; }     // no price: last

  function renderShortlist() {
    var all = S.shortlist.filter(function (k) { return S.condos[k]; }), v = S.shortView;
    $('shortCount').textContent = all.length;
    $('shortTools').hidden = all.length < 2;
    // area choices = areas of the shortlisted condos
    var areas = {};
    all.forEach(function (k) { var a = S.areas[S.condos[k].area]; if (a) areas[a.id] = a.name; });
    $('shortArea').innerHTML = '<option value="">All areas</option>' + Object.keys(areas).sort(function (x, y) { return areas[x].localeCompare(areas[y]); })
      .map(function (id) { return '<option value="' + id + '"' + (id === v.area ? ' selected' : '') + '>' + esc(areas[id]) + '</option>'; }).join('');
    var q = v.q.toLowerCase();
    var items = all.filter(function (k) {
      var c = S.condos[k];
      if (q && (c.name + ' ' + c.address + ' ' + c.mrt).toLowerCase().indexOf(q) < 0) return false;
      if (v.area && c.area !== v.area) return false;
      if (v.beds && !c.units.some(function (l) { return (l.beds >= 4 ? 4 : l.beds) === v.beds; })) return false;
      return true;
    });
    items.sort(function (x, y) {
      var a = S.condos[x], b = S.condos[y];
      if (v.sort === 'priceUp') return fromPrice(a) - fromPrice(b);
      if (v.sort === 'priceDown') return fromPrice(b) - fromPrice(a);
      if (v.sort === 'name') return a.name.localeCompare(b.name);
      if (v.sort === 'score') return scoreOf(b) - scoreOf(a);
      return (S.shortAdded[y] || '').localeCompare(S.shortAdded[x] || '');
    });
    var gone = S.shortlist.filter(function (k) { return !S.condos[k] && S.gone && S.gone[k]; });
    $('shortItems').innerHTML = (items.length ? items.map(function (k) {
      var c = S.condos[k], a = S.areas[c.area] || {}, u = shown(c).length ? shown(c) : c.units;
      var on = S.panel && S.panel.condo === k;
      return '<button type="button" class="list-item' + (on ? ' on' : '') + '" data-condo="' + esc(k) + '"><span class="srow"><span class="ic" aria-hidden="true">★</span>' +
        '<span><strong>' + esc(c.name) + '</strong><small>' + esc([a.name, c.district].filter(Boolean).join(' · ')) + '</small></span>' +
        '<span class="price">' + money(u[0].price) + (u.length > 1 ? '<small>from</small>' : '') + scoreTag(c) + '</span></span></button>';
    }).join('') : (gone.length ? '' : '<div class="empty">' + (all.length ? 'No shortlisted condos match.' : 'No shortlisted condos yet. Open a condo and press ☆ Shortlist.') + '</div>')) +
      gone.map(function (k) {      // every unit was sold / taken down since: kept, greyed, until you remove it
        var g = S.gone[k];
        return '<div class="list-item gone"><span class="srow"><span class="ic" aria-hidden="true">★</span>' +
          '<span><strong>' + esc(g.name) + '</strong><small>No longer listed · last seen ' + esc(shortDate(g.seen)) + '</small></span>' +
          '<button type="button" class="link-btn" data-unstar="' + esc(k) + '">Remove</button></span></div>';
      }).join('');
    $('shortCount').textContent = all.length + gone.length;
  }
  function shortDate(d) {
    var t = d ? new Date(d + 'T00:00:00') : null;
    return t && !isNaN(t) ? t.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : 'earlier';
  }

  function setupShortlistTools() {
    var v = S.shortView;
    $('shortSearch').addEventListener('input', function (e) { v.q = e.target.value.trim(); renderShortlist(); });
    $('shortArea').addEventListener('change', function (e) { v.area = e.target.value; renderShortlist(); });
    $('shortBeds').addEventListener('change', function (e) { v.beds = +e.target.value; renderShortlist(); });
    $('shortSort').addEventListener('change', function (e) { v.sort = e.target.value; renderShortlist(); });
  }

  function setLeft(open) {
    $('shortlist').classList.toggle('open', open);
    document.querySelector('.map-wrap').classList.toggle('left-open', open);
    $('btnShortlist').setAttribute('aria-pressed', String(open));
  }

  // ---- filters ------------------------------------------------------------------
  var SIZE_STEPS = [500, 700, 800, 900, 1000, 1100, 1200, 1400, 1600, 2000];
  var PSF_STEPS = [1200, 1400, 1500, 1600, 1800, 2000, 2100, 2400, 2800];
  function options(steps, fmt) { return '<option value="0">Any</option>' + steps.map(function (v) { return '<option value="' + v + '">' + fmt(v) + '</option>'; }).join(''); }
  function setupFilters() {
    $('priceMin').innerHTML = $('priceMax').innerHTML = options(PRICE_STEPS, money);
    $('sizeMin').innerHTML = $('sizeMax').innerHTML = options(SIZE_STEPS, function (v) { return v.toLocaleString('en-SG') + ' sqft'; });
    $('psfMin').innerHTML = $('psfMax').innerHTML = options(PSF_STEPS, function (v) { return full(v); });
    document.querySelectorAll('[data-pop]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var pop = $(btn.dataset.pop), open = pop.hidden;
        closePops();
        pop.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      });
    });
    document.querySelectorAll('.pop').forEach(function (p) { p.addEventListener('click', function (e) { e.stopPropagation(); }); });
    document.addEventListener('click', closePops);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePops(); $('searchResults').hidden = true; } });
    ['priceMin', 'priceMax', 'sizeMin', 'sizeMax', 'psfMin', 'psfMax'].forEach(function (id) { $(id).addEventListener('change', applyFilters); });
    document.querySelectorAll('.fpanel').forEach(function (panel) {
      panel.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        var group = b.closest('[data-f]');
        if (group && b.dataset.v != null) {                          // chip: toggle (single-choice groups keep one)
          var key = group.dataset.f, list = S.filters[key], i = list.indexOf(b.dataset.v);
          if (i >= 0) list.splice(i, 1); else { if (group.hasAttribute('data-single')) list.length = 0; list.push(b.dataset.v); }
          applyFilters();
        } else if (b.closest('[data-quick]')) {
          $('priceMin').value = b.dataset.min; $('priceMax').value = b.dataset.max; applyFilters();
        } else if (b.dataset.clear) {
          clearFilters(b.dataset.clear); applyFilters();
        } else if (b.classList.contains('fshow')) {
          closePops();
        }
      });
    });
  }
  function fillDistrictChips() {          // after the listings load: one chip per district we have
    var ds = {};
    S.listings.forEach(function (l) { if (/^D\d\d$/.test(l.district)) ds[l.district] = 1; });
    $('districtChips').innerHTML = Object.keys(ds).sort().map(function (d) { return '<button type="button" data-v="' + d + '">' + d.replace(/^D0/, 'D') + '</button>'; }).join('');
  }

  function clearFilters(which) {
    var f = S.filters;
    if (which === 'price' || which === 'all') { $('priceMin').value = $('priceMax').value = '0'; }
    if (which === 'size' || which === 'all') { $('sizeMin').value = $('sizeMax').value = '0'; }
    if (which === 'beds' || which === 'all') f.beds.length = 0;
    if (which === 'all') {
      $('psfMin').value = $('psfMax').value = '0';
      ['floor', 'types', 'tenure', 'lease', 'age', 'baths', 'mrt', 'rent', 'region', 'districts', 'listed', 'other'].forEach(function (k) { f[k].length = 0; });
    }
  }

  function closePops() {
    document.querySelectorAll('.filter .pop').forEach(function (p) { p.hidden = true; });
    document.querySelectorAll('[data-pop]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }

  var CHIP_TEXT = {
    types: { Condo: 'Condo', Apartment: 'Apartment', EC: 'EC' }, tenure: { free: 'Freehold', '999': '999-year', '99': '99-year' },
    age: { 'new': 'New ≤ 5 yrs', '5': '5–10 yrs old', '10': '10–20 yrs old', '20': '20+ yrs old' },
    rent: { low: 'Mostly owners', mid: 'Mixed renting', high: 'Rental-heavy' }, other: { review: 'Stacked review' }
  };
  function range2(a, b, fmt) { return (a ? fmt(a) : 'Any') + ' – ' + (b ? fmt(b) : 'Any'); }
  function activeTags() {                // [text, key] for each filter that is set
    var f = S.filters, out = [];
    if (f.min || f.max) out.push([range2(f.min, f.max, money), 'price']);
    if (f.beds.length) out.push([f.beds.slice().sort().map(function (b) { return b === '5' ? '5+' : b; }).join(', ') + ' bed', 'beds']);
    if (f.sizeMin || f.sizeMax) out.push([range2(f.sizeMin, f.sizeMax, n) + ' sqft', 'size']);
    if (f.floor.length) out.push([f.floor.map(function (v) { return v === 'none' ? 'Not stated' : v; }).join(', ') + ' floor', 'floor']);
    if (f.psfMin || f.psfMax) out.push([range2(f.psfMin, f.psfMax, full) + ' psf', 'psf']);
    ['types', 'tenure', 'age', 'rent', 'other'].forEach(function (k) {
      if (f[k].length) out.push([f[k].map(function (v) { return CHIP_TEXT[k][v]; }).join(', '), k]);
    });
    if (f.lease.length) out.push([f.lease[0] + '+ yrs lease', 'lease']);
    if (f.baths.length) out.push([f.baths.slice().sort().map(function (b) { return b === '3' ? '3+' : b; }).join(', ') + ' bath', 'baths']);
    if (f.mrt.length) out.push(['MRT ≤ ' + f.mrt[0] + ' min', 'mrt']);
    if (f.region.length) out.push([f.region.join(', '), 'region']);
    if (f.districts.length) out.push([f.districts.map(function (d) { return d.replace(/^D0/, 'D'); }).join(', '), 'districts']);
    if (f.listed.length) out.push(['Listed ≤ ' + f.listed[0] + ' days', 'listed']);
    return out;
  }
  var MORE_KEYS = ['floor', 'types', 'tenure', 'lease', 'age', 'baths', 'mrt', 'rent', 'region', 'districts', 'listed', 'other'];
  function applyFilters() {
    var f = S.filters;
    f.min = +$('priceMin').value; f.max = +$('priceMax').value;
    f.sizeMin = +$('sizeMin').value; f.sizeMax = +$('sizeMax').value;
    f.psfMin = +$('psfMin').value; f.psfMax = +$('psfMax').value;
    document.querySelectorAll('.fpanel [data-f]').forEach(function (g) {
      g.querySelectorAll('button[data-v]').forEach(function (b) { b.setAttribute('aria-pressed', String(f[g.dataset.f].indexOf(b.dataset.v) >= 0)); });
    });
    // one Filters button showing how many filters are on (agreed 25 Oct)
    var tags = activeTags(), btn = document.querySelector('[data-pop=popMore]');
    btn.classList.toggle('active', tags.length > 0);
    btn.innerHTML = 'Filters' + (tags.length ? ' <small>(' + tags.length + ')</small>' : '') + ' ▾';
    drawPins();
    restyle();
    updateCount();
    if (S.panel) renderPanel();
    renderShortlist();
    var condos = {};
    S.listings.forEach(function (l) { if (visible(l)) condos[l.condo] = 1; });
    var k = Object.keys(condos).length;
    document.querySelectorAll('.fshow').forEach(function (b) { b.textContent = 'Show ' + k.toLocaleString('en-SG') + ' condo' + (k === 1 ? '' : 's'); });
  }

  function updateCount() {
    var ls = S.listings.filter(visible), condos = {};
    ls.forEach(function (l) { condos[l.condo] = 1; });
    var upd = S.meta.updated ? new Date(S.meta.updated + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '—';
    $('count').textContent = ls.length.toLocaleString('en-SG') + ' listings · ' + Object.keys(condos).length + ' condos · updated ' + upd;
    $('count').title = 'From: ' + (S.meta.files || []).join(', ') + (S.meta.unplaced ? '\n' + S.meta.unplaced + ' listing(s) not on the map (no address match)' : '');
  }

  function updateStatus() {
    var u = S.meta.uraStatus || {}, r = S.meta.rentStatus || {}, el = $('status');
    var when = u.downloaded ? new Date(u.downloaded).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '';
    var ok = u.ok && r.ok !== false;
    el.textContent = (ok ? 'URA ✅' : 'URA ⚠️') + ' · OneMap, LTA, data.gov.sg: soon';
    el.title = u.ok ? 'URA sales downloaded ' + when + ' (' + (u.downloaded || '') + ')' + (u.token ? '\nToken refreshed ' + u.token : '') + '\n' + (u.matched || 0) + ' condos matched'
      : 'URA: ' + (u.message || 'unknown problem') + (when ? '\nShowing sales downloaded ' + when : '');
    if (r.ok === false) el.title += '\nURA rentals: ' + r.message;
    else if (r.downloaded) el.title += '\nRentals downloaded ' + new Date(r.downloaded).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
    el.classList.toggle('warn', !ok);
  }

  // ---- search ---------------------------------------------------------------------
  function setupSearch() {
    var input = $('search'), box = $('searchResults'), hits = [], hl = 0;
    function render() {
      box.innerHTML = hits.map(function (h, i) {
        return '<li><button type="button" class="' + (i === hl ? 'hl' : '') + '" data-i="' + i + '">' + esc(h.title) + '<small>' + esc(h.sub) + '</small></button></li>';
      }).join('') || '<li class="empty" style="padding:8px">No matches</li>';
      box.hidden = false;
    }
    function go(h) {
      if (!h) return;
      box.hidden = true; input.blur();
      if (h.area) { var b = S.areas[h.area].layer.getBounds(); map.flyToBounds(b, { duration: 0.6, paddingBottomRight: [440, 0] }); openArea(h.area); }
      else openCondo(h.condo, { fly: true });
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      hl = 0;
      if (q.length < 2) { box.hidden = true; return; }
      hits = [];
      Object.keys(S.areas).forEach(function (id) {
        var a = S.areas[id];
        if ((a.name + ' ' + (a.label || '')).toLowerCase().indexOf(q) >= 0) hits.push({ area: id, title: a.name, sub: 'Planning area' + (a.label ? ' · ' + a.label : '') });
      });
      Object.keys(S.condos).forEach(function (k) {
        var c = S.condos[k];
        if ((c.name + ' ' + c.address + ' ' + c.mrt).toLowerCase().indexOf(q) >= 0)
          hits.push({ condo: k, title: c.name, sub: [c.address, c.mrt].filter(Boolean).join(' · ') });
      });
      hits = hits.slice(0, 10);
      render();
    });
    input.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, hits.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { go(hits[hl]); }
    });
    box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(hits[+b.dataset.i]); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) box.hidden = true; });
  }

  // One floating tooltip for every ⓘ (works inside the scrolling cards)
  function setupTooltips() {
    var box = document.createElement('div');
    box.className = 'tooltip';
    box.setAttribute('role', 'tooltip');
    box.hidden = true;
    document.body.appendChild(box);
    function show(el) {
      box.textContent = el.getAttribute('data-tip');
      box.hidden = false;
      var r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
      var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      var y = r.bottom + 8;
      if (y + h > window.innerHeight - 8) y = r.top - h - 8;
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    }
    function hide() { box.hidden = true; }
    document.addEventListener('mouseover', function (e) { var t = e.target.closest('[data-tip]'); if (t) show(t); });
    document.addEventListener('mouseout', function (e) { if (e.target.closest('[data-tip]')) hide(); });
    document.addEventListener('focusin', function (e) { var t = e.target.closest('[data-tip]'); if (t) show(t); });
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
  }

  // ---- start ------------------------------------------------------------------------
  function start() {
    setupMap();
    setupFilters();
    setupSearch();
    setupShortlistTools();
    setupTooltips();
    $('btnShortlist').addEventListener('click', function () { setLeft(!$('shortlist').classList.contains('open')); });
    $('hideShortlist').addEventListener('click', function () { setLeft(false); });
    $('detail').addEventListener('click', onPanelClick);
    setupPlaceLegend();
    $('detail').addEventListener('scroll', function (e) { if (e.target.classList && e.target.classList.contains('gphotos')) photoStripMoved(e.target); }, true);
    $('detail').addEventListener('input', function (e) {
      if (e.target.id === 'areaQ' && S.panel) { S.panel.q = e.target.value.trim(); $('areaList').innerHTML = areaCondoList(S.panel.area); }
    });
    $('detail').addEventListener('change', function (e) {
      if (e.target.id === 'areaSort' && S.panel) { S.panel.sort = e.target.value; $('areaList').innerHTML = areaCondoList(S.panel.area); }
    });
    $('shortItems').addEventListener('click', function (e) {
      var u = e.target.closest('button[data-unstar]');
      if (u) return toggleShort(u.dataset.unstar);           // a condo with nothing for sale any more
      var b = e.target.closest('button[data-condo]');
      if (b) openCondo(b.dataset.condo, { fly: true });
    });
    Promise.all([api('/api/data'), api('/api/areas'), api('/api/shortlist')]).then(function (r) {
      // listings the newest full robot run didn't see are sold / taken down: hidden (kept only to label old shortlist items)
      S.listings = r[0].listings.filter(function (l) { return !l.gone; });
      S.gone = {};
      r[0].listings.forEach(function (l) {
        if (!l.gone) return;
        var g = S.gone[l.condo] || (S.gone[l.condo] = { name: l.name, district: l.district, seen: '' });
        if ((l.scrapedOn || '') > g.seen) g.seen = l.scrapedOn || '';
      });
      S.meta = r[0].meta; S.ura = r[0].ura || {}; S.rent = r[0].rent || {}; S.mcst = r[0].mcst || {}; S.nearby = r[0].nearby || {}; S.places = r[0].places || {};
      (r[2] || []).forEach(function (i) { S.shortlist.push(i.key); S.shortAdded[i.key] = i.added; });
      buildCondos();
      drawAreas(r[1]);
      fillDistrictChips();
      applyFilters();
      updateStatus();
    }).catch(function () {
      $('count').textContent = "Couldn't load the listings — is the HomeQuest Terminal window still open?";
    });
  }

  start();
})();
