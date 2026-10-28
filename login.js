/* Lantern — the online copy of HomeQuest (GitHub Pages).
   The listings and the shortlist are stored scrambled (AES-GCM, key made from your password with
   PBKDF2). This page unscrambles them in the browser after you log in, then starts the normal app.
   The shortlist and my notes are saved back to GitHub with your GitHub key (a fine-grained token that can only
   write to this one repository). Nothing here is sent anywhere else. */
(function () {
  'use strict';
  var CFG = null, KEY = null, TOKEN = '';
  var $ = function (id) { return document.getElementById(id); };
  var te = new TextEncoder(), td = new TextDecoder();
  var LS = {
    get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function b64(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), out = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }

  function deriveKey(password) {
    return crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(CFG.salt), iterations: CFG.iterations, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    });
  }
  function gunzip(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  function gzip(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  }
  // file layout: 12-byte IV, then the AES-GCM ciphertext of the gzipped JSON
  function open(buf) {
    var all = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, KEY, all.slice(12))
      .then(gunzip).then(function (b) { return JSON.parse(td.decode(b)); });
  }
  function seal(obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return gzip(te.encode(JSON.stringify(obj))).then(function (z) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, KEY, z);
    }).then(function (c) { var out = new Uint8Array(12 + c.byteLength); out.set(iv); out.set(new Uint8Array(c), 12); return out; });
  }

  // ---- the shortlist file on GitHub ------------------------------------------------------------
  var API = function (file) { return (window.HQ_GITHUB_API || 'https://api.github.com') + '/repos/' + CFG.repo + '/contents/' + (file || 'shortlist.bin'); };
  function gh(method, body, file) {
    return fetch(API(file) + (method === 'GET' ? '?t=' + Date.now() : ''), {
      method: method, cache: 'no-store',
      headers: Object.assign({ 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  }
  var shortSha = null, shortBase = null;     // shortBase = the list as last read/saved (for merging)
  function mergeLists(mine, theirs, base) {   // same 3-way merge as the Mac (lantern.merge)
    var bk = {}, mk = {}, out = [], have = {};
    base.forEach(function (i) { bk[i.key] = 1; }); mine.forEach(function (i) { mk[i.key] = 1; });
    theirs.forEach(function (i) { if (!(bk[i.key] && !mk[i.key])) { out.push(i); have[i.key] = 1; } });
    mine.forEach(function (i) { if (!bk[i.key] && !have[i.key]) out.push(i); });
    return out;
  }
  function readShortlist() {
    if (!TOKEN) {     // read-only: the published copy (can be a few minutes behind)
      return fetch('shortlist.bin?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.arrayBuffer().then(open) : []; }).catch(function () { return []; });
    }
    return gh('GET').then(function (r) {
      if (r.status === 404) { shortSha = null; return []; }
      if (!r.ok) throw new Error('GitHub said ' + r.status);
      return r.json().then(function (j) { shortSha = j.sha; return open(unb64(j.content.replace(/\s/g, '')).buffer); })
        .then(function (list) { shortBase = list; return list; });
    });
  }
  function saveShortlist(items, retry) {
    if (!TOKEN) { notice('Shortlist not saved — log in with your GitHub key to save it.'); return Promise.resolve(items); }
    return seal(items).then(function (bytes) {
      var body = { message: 'Shortlist updated', content: b64(bytes) };
      if (shortSha) body.sha = shortSha;
      return gh('PUT', body);
    }).then(function (r) {
      if (r.ok) return r.json().then(function (j) { shortSha = j.content.sha; shortBase = items; if (!retry) notice(''); return items; });
      if ((r.status === 409 || r.status === 422) && !retry) {      // changed elsewhere (e.g. on the Mac): merge with the latest, save again
        var base = shortBase || [];
        return readShortlist().then(function (theirs) {
          var merged = mergeLists(items, theirs, base);
          if (merged.length !== items.length) notice('Merged with changes made on another laptop — refresh to see them.');
          return saveShortlist(merged, true);
        });
      }
      if (r.status === 401 || r.status === 403) notice('GitHub refused the key — check it can write to ' + CFG.repo + '.');
      else notice('Couldn\'t save the shortlist to GitHub (' + r.status + '). Try again in a moment.');
      return items;
    }).catch(function () { notice('No internet — the shortlist wasn\'t saved.'); return items; });
  }

  // ---- my notes on GitHub (notes.bin, 28 Oct) — like the shortlist; merged per condo, the newest change wins ----
  var noteSha = null, noteBase = null;
  function filled(n) { return n && (n.status || n.rating || n.date || n.agent || n.text); }
  function mergeNotes(mine, theirs, base) {   // same 3-way merge as the Mac (lantern.merge_notes)
    var out = {}, keys = {};
    base = base || {};
    Object.keys(mine).concat(Object.keys(theirs)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var a = mine[k], b = theirs[k], o = base[k];
      if (a && b) out[k] = (a.updated || '') >= (b.updated || '') ? a : b;
      else if (a) { if (!(o && o.updated === a.updated)) out[k] = a; }
      else if (b) { if (!(o && o.updated === b.updated)) out[k] = b; }
    });
    return out;
  }
  function readNotes() {
    if (!TOKEN) {
      return fetch('notes.bin?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.arrayBuffer().then(open) : {}; }).catch(function () { return {}; });
    }
    return gh('GET', null, 'notes.bin').then(function (r) {
      if (r.status === 404) { noteSha = null; return {}; }
      if (!r.ok) throw new Error('GitHub said ' + r.status);
      return r.json().then(function (j) { noteSha = j.sha; return open(unb64(j.content.replace(/\s/g, '')).buffer); })
        .then(function (notes) { noteBase = notes; return notes; });
    });
  }
  function saveNotes(notes, retry) {
    var clean = {};
    Object.keys(notes).forEach(function (k) { if (filled(notes[k])) clean[k] = notes[k]; });
    if (!TOKEN) { notice('Notes not saved — log in with your GitHub key to save them.'); return Promise.resolve({ error: 'no key' }); }
    return seal(clean).then(function (bytes) {
      var body = { message: 'Notes updated', content: b64(bytes) };
      if (noteSha) body.sha = noteSha;
      return gh('PUT', body, 'notes.bin');
    }).then(function (r) {
      if (r.ok) return r.json().then(function (j) { noteSha = j.content.sha; noteBase = clean; if (!retry) notice(''); return clean; });
      if ((r.status === 409 || r.status === 422) && !retry) {      // changed elsewhere: merge with the latest, save again
        var base = noteBase;
        return readNotes().then(function (theirs) { return saveNotes(mergeNotes(clean, theirs, base), true); });
      }
      notice(r.status === 401 || r.status === 403 ? 'GitHub refused the key — check it can write to ' + CFG.repo + '.' : 'Couldn\'t save the notes to GitHub (' + r.status + ').');
      return { error: 'GitHub said ' + r.status };
    }).catch(function () { notice('No internet — the notes weren\'t saved.'); return { error: 'offline' }; });
  }

  function notice(text) {
    var n = $('lanternNote');
    if (!n) { n = document.createElement('div'); n.id = 'lanternNote'; n.className = 'lantern-note'; document.body.appendChild(n); }
    n.textContent = text; n.hidden = !text;
  }

  // ---- what the app asks for (it would ask the Mac mini's server for these) ---------------------
  var DATA = null;
  window.HQ_API = function (path, opts) {
    if (path === '/api/data') return Promise.resolve(DATA.data);
    if (path === '/api/areas') return Promise.resolve(DATA.areas);
    if (path.indexOf('/api/google/place?condo=') === 0) return googlePlace(decodeURIComponent(path.split('=')[1]));
    if (path === '/api/notes') {
      if (opts && opts.method === 'POST') return saveNotes(JSON.parse(opts.body));
      return readNotes().catch(function () { notice('Couldn\'t read the notes from GitHub.'); return {}; });
    }
    if (path === '/api/shortlist') {
      if (opts && opts.method === 'POST') return saveShortlist(JSON.parse(opts.body));
      return readShortlist().catch(function () { notice('Couldn\'t read the shortlist from GitHub.'); return []; });
    }
    return Promise.reject(new Error('not available online'));
  };

  // ---- Google photos, rating, reviews, Street View (only if a Lantern Google key was published) ---
  // Fetched live from Google in this browser each time a condo opens, never stored (Google's rules).
  // The key only works on this website (Google Cloud: website restriction + API restriction + quota).
  var GLIMIT = 300;
  function gCount(n) {          // same safety limit as the Mac mini: 300 look-ups a day (per laptop)
    var today = new Date().toISOString().slice(0, 10), u = {};
    try { u = JSON.parse(LS.get('lanternGoogle') || '{}'); } catch (e) { u = {}; }
    if (u.date !== today) u = { date: today, count: 0 };
    if (u.count + n > GLIMIT) return false;
    u.count += n; LS.set('lanternGoogle', JSON.stringify(u)); return true;
  }
  function gFetch(url, opts, fields) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Goog-Api-Key': DATA.googleKey, 'X-Goog-FieldMask': fields }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error('Google said ' + r.status + (j.error ? ': ' + j.error.message : '')); return j; });
    });
  }
  function condoSpot(key) {
    var pts = DATA.data.listings.filter(function (l) { return l.condo === key && l.lat != null; });
    if (!pts.length) return null;
    return { name: pts[0].name, lat: pts.reduce(function (s, l) { return s + l.lat; }, 0) / pts.length,
      lng: pts.reduce(function (s, l) { return s + l.lng; }, 0) / pts.length };
  }
  function metres(a, b, c, d) { var dy = (c - a) * 111320, dx = (d - b) * 111320 * Math.cos(a * Math.PI / 180); return Math.sqrt(dx * dx + dy * dy); }
  function placeId(key, spot) {
    var known = (DATA.placeIds || {})[key];
    if (known !== undefined) return Promise.resolve(known);
    var cache = {}; try { cache = JSON.parse(LS.get('lanternPlaceIds') || '{}'); } catch (e) { cache = {}; }
    if (cache[key] !== undefined) return Promise.resolve(cache[key]);
    if (!gCount(1)) return Promise.reject(new Error('Daily limit of ' + GLIMIT + ' Google look-ups reached — try again tomorrow'));
    return gFetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textQuery: spot.name + ' Singapore', maxResultCount: 5,
        locationBias: { circle: { center: { latitude: spot.lat, longitude: spot.lng }, radius: 500 } } }) }, 'places.id,places.location')
      .then(function (j) {
        var best = null;
        (j.places || []).some(function (p) { var l = p.location || {}; if (l.latitude != null && metres(spot.lat, spot.lng, l.latitude, l.longitude) <= 500) { best = p.id; return true; } return false; });
        cache[key] = best; LS.set('lanternPlaceIds', JSON.stringify(cache)); return best;
      });
  }
  var PHOTO = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
  function googlePlace(key) {
    var spot = condoSpot(key);
    if (!spot) return Promise.resolve({ error: 'unknown condo' });
    return placeId(key, spot).then(function (pid) {
      if (!pid) return { found: false };
      if (!gCount(8)) throw new Error('Daily limit of ' + GLIMIT + ' Google look-ups reached — try again tomorrow');   // details + up to 6 photos + Street View
      return gFetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(pid), {},
        'id,displayName,rating,userRatingCount,googleMapsUri,photos,reviews').then(function (d) {
        var photos = (d.photos || []).filter(function (p) { return PHOTO.test(p.name || ''); }).slice(0, 6).map(function (p) {
          return { src: 'https://places.googleapis.com/v1/' + p.name + '/media?maxWidthPx=1200&maxHeightPx=900&key=' + encodeURIComponent(DATA.googleKey),
            authors: (p.authorAttributions || []).map(function (a) { return { name: a.displayName || '', uri: a.uri || '' }; }) };
        });
        var reviews = (d.reviews || []).slice(0, 5).map(function (r) {
          var a = r.authorAttribution || {};
          return { rating: r.rating, when: r.relativePublishTimeDescription || '', text: ((r.text || r.originalText || {}).text) || '',
            author: a.displayName || '', authorUri: a.uri || '', uri: r.googleMapsUri || '' };
        });
        return { found: true, name: (d.displayName || {}).text || '', rating: d.rating, count: d.userRatingCount,
          uri: d.googleMapsUri || '', photos: photos, reviews: reviews };
      });
    }).catch(function (e) { return { error: e.message || 'Google look-up failed' }; });
  }
  window.HQ_STREETVIEW = function (c) {      // return_error_code: no picture here -> the image fails and is left out
    return 'https://maps.googleapis.com/maps/api/streetview?size=640x400&radius=120&source=outdoor&fov=80&return_error_code=true&location=' +
      c.lat.toFixed(6) + ',' + c.lng.toFixed(6) + '&key=' + encodeURIComponent(DATA.googleKey);
  };

  function start() {
    if (!DATA.googleKey) { window.HQ_STREETVIEW = null; DATA.data.meta.google = false; }
    $('login').hidden = true;
    var s = document.createElement('script'); s.src = 'app.js'; document.body.appendChild(s);
    var lock = document.createElement('button');
    lock.type = 'button'; lock.className = 'btn'; lock.textContent = 'Lock';
    lock.title = 'Log out on this laptop'; lock.onclick = function () { LS.del('lanternKey'); LS.del('lanternToken'); location.reload(); };
    var nav = document.querySelector('.topnav'); if (nav) nav.appendChild(lock);
  }

  function unlock(key) {
    KEY = key;
    return fetch('data.bin?v=' + encodeURIComponent(CFG.published), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); })
      .then(open).then(function (d) { DATA = d; });
  }

  function fail(text) { $('loginErr').textContent = text; $('loginGo').disabled = false; $('loginGo').textContent = 'Open'; }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('loginPw').value, tok = $('loginToken').value.trim(), remember = $('loginRemember').checked;
    if (!pw) return fail('Type your password.');
    $('loginGo').disabled = true; $('loginGo').textContent = 'Opening…'; $('loginErr').textContent = '';
    deriveKey(pw).then(function (key) {
      return unlock(key).then(function () { return key; });
    }).then(function (key) {
      TOKEN = tok || LS.get('lanternToken');
      if (remember) {
        crypto.subtle.exportKey('raw', key).then(function (raw) { LS.set('lanternKey', b64(raw)); });
        if (tok) LS.set('lanternToken', tok);
      }
      start();
    }).catch(function () { fail('That password didn\'t open it. Check it and try again.'); });
  });

  fetch('lantern.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (cfg) {
    CFG = cfg;
    $('loginWhen').textContent = 'Listings from ' + cfg.published;
    var saved = LS.get('lanternKey');
    if (LS.get('lanternToken')) $('loginToken').placeholder = 'Saved on this laptop';
    if (!saved) { $('loginPw').focus(); return; }
    crypto.subtle.importKey('raw', unb64(saved), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']).then(function (key) {
      return unlock(key);
    }).then(function () { TOKEN = LS.get('lanternToken'); start(); })
      .catch(function () { LS.del('lanternKey'); $('loginPw').focus(); });     // password changed since: log in again
  }).catch(function () { fail('Couldn\'t load the site settings. Check the internet connection.'); });
})();
