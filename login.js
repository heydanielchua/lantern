/* Lantern — the online copy of HomeQuest (GitHub Pages).
   The listings and the shortlist are stored scrambled (AES-GCM, key made from your password with
   PBKDF2). This page unscrambles them in the browser after you log in, then starts the normal app.
   The shortlist is saved back to GitHub with your GitHub key (a fine-grained token that can only
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
  var API = function () { return (window.HQ_GITHUB_API || 'https://api.github.com') + '/repos/' + CFG.repo + '/contents/shortlist.bin'; };
  function gh(method, body) {
    return fetch(API() + (method === 'GET' ? '?t=' + Date.now() : ''), {
      method: method, cache: 'no-store',
      headers: Object.assign({ 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  }
  var shortSha = null;
  function readShortlist() {
    if (!TOKEN) {     // read-only: the published copy (can be a few minutes behind)
      return fetch('shortlist.bin?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.arrayBuffer().then(open) : []; }).catch(function () { return []; });
    }
    return gh('GET').then(function (r) {
      if (r.status === 404) { shortSha = null; return []; }
      if (!r.ok) throw new Error('GitHub said ' + r.status);
      return r.json().then(function (j) { shortSha = j.sha; return open(unb64(j.content.replace(/\s/g, '')).buffer); });
    });
  }
  function saveShortlist(items, retry) {
    if (!TOKEN) { notice('Shortlist not saved — log in with your GitHub key to save it.'); return Promise.resolve(items); }
    return seal(items).then(function (bytes) {
      var body = { message: 'Shortlist updated', content: b64(bytes) };
      if (shortSha) body.sha = shortSha;
      return gh('PUT', body);
    }).then(function (r) {
      if (r.ok) return r.json().then(function (j) { shortSha = j.content.sha; notice(''); return items; });
      if ((r.status === 409 || r.status === 422) && !retry) {      // changed elsewhere (e.g. on the Mac): get the latest, save again
        return gh('GET').then(function (g) { return g.ok ? g.json() : {}; }).then(function (j) { shortSha = j.sha || null; return saveShortlist(items, true); });
      }
      if (r.status === 401 || r.status === 403) notice('GitHub refused the key — check it can write to ' + CFG.repo + '.');
      else notice('Couldn\'t save the shortlist to GitHub (' + r.status + '). Try again in a moment.');
      return items;
    }).catch(function () { notice('No internet — the shortlist wasn\'t saved.'); return items; });
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
    if (path === '/api/shortlist') {
      if (opts && opts.method === 'POST') return saveShortlist(JSON.parse(opts.body));
      return readShortlist().catch(function () { notice('Couldn\'t read the shortlist from GitHub.'); return []; });
    }
    return Promise.reject(new Error('not available online'));
  };

  function start() {
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
