/* DDflix admin (LAN only). Plain JS, no build step. */
(function () {
  'use strict';
  var main = document.getElementById('main');

  function api(method, path, body) {
    return fetch(path, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var d = document.createElement('section'); d.innerHTML = html; main.appendChild(d); return d; }
  function when(t) { if (!t) return '—'; var d = new Date(t * 1000); return d.toLocaleString('ro-RO'); }
  function gb(b) { return b ? (b / 1073741824).toFixed(2) + ' GB' : ''; }
  function msg(el, text, cls) { var m = el.querySelector('.msg'); if (m) { m.className = 'msg ' + (cls || ''); m.textContent = text; } }

  var pages = {};

  pages.pair = function (q) {
    Promise.all([api('GET', '/api/profiles'), api('GET', '/api/devices')]).then(function (r) {
      var profs = r[0].items, opts = profs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
      var s = h('<h2>Conectează un televizor</h2><p class="mut">Deschide DDflix pe TV și scrie aici codul de 6 litere afișat.</p>' +
        '<input class="code" maxlength="7" placeholder="ABC123" value="' + esc(q.code || '') + '"> ' +
        '<input class="nm" placeholder="Nume (ex. Living OLED 65)"> <select class="pf"><option value="">Profil implicit: —</option>' + opts + '</select> ' +
        '<button class="go">Conectează</button><div class="msg"></div>');
      s.querySelector('.go').onclick = function () {
        api('POST', '/api/device/pair/approve', { code: s.querySelector('.code').value, name: s.querySelector('.nm').value, profileId: s.querySelector('.pf').value || null })
          .then(function () { msg(s, 'Gata! Televizorul se conectează în câteva secunde.', 'ok'); setTimeout(route, 1500); }, function (e) { msg(s, e.message, 'err'); });
      };
      if (q.code) s.querySelector('.nm').focus(); else s.querySelector('.code').focus();
      var rows = r[1].items.map(function (d) {
        return '<tr><td>' + esc(d.name) + '</td><td class="mut">' + esc(d.lastIp || '') + '</td><td class="mut">' + when(d.lastSeen) + '</td><td><button class="sec rv" data-id="' + d.id + '">Revocă</button></td></tr>';
      }).join('');
      var t = h('<h2>Televizoare conectate</h2><table><tr><th>Nume</th><th>IP</th><th>Văzut ultima dată</th><th></th></tr>' + (rows || '<tr><td colspan=4 class="mut">Niciunul încă</td></tr>') + '</table>');
      [].forEach.call(t.querySelectorAll('.rv'), function (b) { b.onclick = function () { if (confirm('Revoci accesul acestui televizor?')) api('DELETE', '/api/devices/' + b.dataset.id).then(route); }; });
    }, fail);
  };

  pages.profiles = function () {
    api('GET', '/api/profiles').then(function (d) {
      var rows = d.items.map(function (p) {
        return '<tr><td><input class="n" data-id="' + p.id + '" value="' + esc(p.name) + '"></td><td><select class="k" data-id="' + p.id + '"><option value="adult"' + (p.kind === 'adult' ? ' selected' : '') + '>Adult</option><option value="kids"' + (p.kind === 'kids' ? ' selected' : '') + '>Copii</option></select></td>' +
          '<td>' + (p.hasPin ? '<span class="ok">PIN setat</span>' : '<span class="mut">fără PIN</span>') + '<br><input class="pin" data-id="' + p.id + '" maxlength="4" inputmode="numeric" placeholder="PIN nou (gol = șterge)" style="width:11em"> <button class="sec sp" data-id="' + p.id + '">Salvează PIN</button></td>' +
          '<td><button class="sv" data-id="' + p.id + '">Salvează</button> <button class="sec del" data-id="' + p.id + '">Șterge</button></td></tr>';
      }).join('');
      var s = h('<h2>Profiluri</h2><table><tr><th>Nume</th><th>Tip</th><th>PIN</th><th></th></tr>' + rows + '</table>' +
        '<p><input class="nn" placeholder="Profil nou"> <select class="nk"><option value="adult">Adult</option><option value="kids">Copii</option></select> <button class="add">Adaugă</button></p>' +
        '<p class="mut">Profilul „Copii” vede doar titluri de animație / familie.</p><div class="msg"></div>');
      function on(cls, fn) { [].forEach.call(s.querySelectorAll(cls), function (b) { b.onclick = function () { fn(b.dataset.id); }; }); }
      on('.sv', function (id) {
        api('PATCH', '/api/profiles/' + id, { name: s.querySelector('.n[data-id="' + id + '"]').value, kind: s.querySelector('.k[data-id="' + id + '"]').value })
          .then(function () { msg(s, 'Salvat', 'ok'); }, function (e) { msg(s, e.message, 'err'); });
      });
      on('.sp', function (id) { api('POST', '/api/profiles/' + id + '/pin', { pin: s.querySelector('.pin[data-id="' + id + '"]').value }).then(route, function (e) { msg(s, e.message, 'err'); }); });
      on('.del', function (id) { if (confirm('Ștergi profilul?')) api('DELETE', '/api/profiles/' + id).then(route, function (e) { msg(s, e.message, 'err'); }); });
      s.querySelector('.add').onclick = function () { api('POST', '/api/profiles', { name: s.querySelector('.nn').value, kind: s.querySelector('.nk').value }).then(route, function (e) { msg(s, e.message, 'err'); }); };
    }, fail);
  };

  pages.follows = function () {
    Promise.all([api('GET', '/api/admin/follows'), api('GET', '/api/admin/status')]).then(function (r) {
      var mode = r[1].config.rssMode;
      var rows = r[0].items.map(function (f) { return '<tr><td>' + esc(f.pattern) + '</td><td class="mut">' + when(f.created_at) + '</td><td><button class="sec del" data-id="' + f.id + '">Scoate</button></td></tr>'; }).join('');
      var s = h('<h2>Seriale urmărite</h2><p class="mut">Când în feed-ul RSS FileList apare un episod cu numele de aici, se descarcă automat. ' +
        (mode === 'all' ? '<b class="warn">Acum RSS_MODE=all: se descarcă tot feed-ul, lista asta nu filtrează.</b>' : 'Mod: doar serialele din listă.') + '</p>' +
        '<input class="p" placeholder="ex. The Last of Us" style="width:22em"> <button class="add">Adaugă</button><div class="msg"></div>' +
        '<p class="mut">Avansat: <code>re:Show\\.Name.*1080p</code> = expresie regulată pe titlul din feed.</p>' +
        '<table><tr><th>Serial</th><th>Adăugat</th><th></th></tr>' + (rows || '<tr><td colspan=3 class="mut">Lista e goală</td></tr>') + '</table>');
      s.querySelector('.add').onclick = function () { api('POST', '/api/admin/follows', { pattern: s.querySelector('.p').value }).then(route, function (e) { msg(s, e.message, 'err'); }); };
      [].forEach.call(s.querySelectorAll('.del'), function (b) { b.onclick = function () { api('DELETE', '/api/admin/follows/' + b.dataset.id).then(route); }; });
    }, fail);
  };

  pages.rss = function () {
    api('GET', '/api/admin/status').then(function (st) {
      var r = st.rss, c = st.config;
      var s = h('<h2>RSS FileList</h2><p>' + (c.rssConfigured ? '<span class="ok">URL configurat în .env</span>' : '<span class="err">FILELIST_RSS_URL lipsește din .env</span>') +
        ' · verificare la ' + c.rssInterval + ' min · ultima: ' + when(r.lastRun) + ' · în feed: ' + r.items + '</p>' +
        (r.lastError ? '<p class="err">' + esc(r.lastError) + '</p>' : '') + '<button class="run">Verifică acum</button><div class="msg"></div><div class="list"></div>');
      s.querySelector('.run').onclick = function () { msg(s, 'Verific…'); api('POST', '/api/admin/rss/run').then(route, function (e) { msg(s, e.message, 'err'); }); };
      api('GET', '/api/admin/rss').then(function (d) {
        s.querySelector('.list').innerHTML = '<table><tr><th>Titlu</th><th>Mărime</th><th>Stare</th></tr>' + d.items.map(function (i) {
          var cls = i.status === 'added' ? 'ok' : i.status === 'error' ? 'err' : 'mut';
          return '<tr><td>' + esc(i.title) + '</td><td class="mut">' + gb(i.size) + '</td><td class="' + cls + '">' + esc(i.status === 'added' ? 'trimis la qBittorrent' : i.reason) + '</td></tr>';
        }).join('') + '</table>';
      });
      var t = h('<h2>Torrente (qBittorrent)</h2><div class="list mut">Se încarcă…</div>');
      api('GET', '/api/admin/torrents').then(function (d) {
        t.querySelector('.list').innerHTML = '<table><tr><th>Nume</th><th>Progres</th><th>Stare</th><th>Ratio</th></tr>' + d.items.map(function (x) {
          return '<tr><td>' + esc(x.name) + '</td><td>' + Math.round(x.progress * 100) + '%</td><td class="mut">' + esc(x.state) + '</td><td>' + x.ratio + '</td></tr>';
        }).join('') + '</table>';
      }, function (e) { t.querySelector('.list').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
    }, fail);
  };

  pages.library = function () {
    Promise.all([api('GET', '/api/admin/status'), api('GET', '/api/admin/titles'), api('GET', '/api/admin/unmatched')]).then(function (r) {
      var L = r[0].library;
      var s = h('<h2>Bibliotecă</h2><p>' + L.files + ' fișiere · ' + r[0].titles + ' titluri · ultima scanare: ' + when(L.lastScan) + (L.scanning ? ' · <span class="warn">scanez…</span>' : '') +
        '</p><button class="scan">Scanează acum</button> <button class="sec full">Rescanează tot (metadate)</button><div class="msg"></div>');
      s.querySelector('.scan').onclick = function () { api('POST', '/api/admin/scan', {}).then(function () { msg(s, 'Scanarea a pornit', 'ok'); }); };
      s.querySelector('.full').onclick = function () { api('POST', '/api/admin/scan', { full: true }).then(function () { msg(s, 'Rescanarea a pornit', 'ok'); }); };
      if (r[2].items.length) {
        var u = h('<h2>Nerecunoscute (' + r[2].items.length + ')</h2><p class="mut">Pune ID-ul IMDb (din linkul imdb.com/title/<b>tt…</b>) ca să apară cu poster și descriere.</p><table>' +
          r[2].items.map(function (f) { return '<tr><td>' + esc(f.path) + '<br><span class="mut">„' + esc(f.pname) + '” ' + esc(f.pyear || '') + '</span></td><td><input class="im" data-id="' + f.id + '" placeholder="tt1234567" style="width:9em"> <button class="sec mt" data-id="' + f.id + '">Potrivește</button></td></tr>'; }).join('') + '</table><div class="msg"></div>');
        [].forEach.call(u.querySelectorAll('.mt'), function (b) { b.onclick = function () { api('POST', '/api/admin/match', { fileId: +b.dataset.id, imdb: u.querySelector('.im[data-id="' + b.dataset.id + '"]').value.trim() }).then(route, function (e) { msg(u, e.message, 'err'); }); }; });
      }
      h('<h2>Titluri</h2><table><tr><th>Titlu</th><th>Tip</th><th>Fișiere</th><th>Adăugat</th></tr>' + r[1].items.map(function (t) {
        return '<tr><td>' + esc(t.name) + ' <span class="mut">' + esc(t.year || '') + '</span></td><td class="mut">' + (t.type === 'series' ? 'serial' : 'film') + '</td><td>' + t.n + '</td><td class="mut">' + when(t.added) + '</td></tr>';
      }).join('') + '</table>');
    }, fail);
  };

  function fail(e) { h('<p class="err">' + esc(e.message) + '</p>'); }
  function route() {
    var hs = location.hash.replace(/^#\/?/, ''), name = hs.split('?')[0] || 'pair', q = {};
    (hs.split('?')[1] || '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) q[a[0]] = decodeURIComponent(a[1] || ''); });
    if (name === 'settings') name = 'pair';
    main.innerHTML = '';
    [].forEach.call(document.querySelectorAll('nav a'), function (a) { a.className = a.getAttribute('href') === '#/' + name ? 'on' : ''; });
    (pages[name] || pages.pair)(q);
  }
  window.addEventListener('hashchange', route);
  route();
})();
