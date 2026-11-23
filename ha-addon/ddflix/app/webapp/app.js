/* DDflix web (Vercel). Talks to the DDflix server on Home Assistant through its public HTTPS address (config.js). */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
             set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } },
             del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* */ } } };
  var qsApi = (location.search.match(/[?&]api=([^&]+)/) || [])[1];
  if (qsApi) { LS.set('dd_api', decodeURIComponent(qsApi)); history.replaceState(null, '', location.pathname + location.hash); }
  var SAME = /^\/web\//.test(location.pathname);
  // server addresses: DIRECT = the home server's own HTTPS port (router port forward, full speed; learned from /api/where),
  // FUNNEL = Tailscale Funnel (always works, far too slow for video) -> only the fallback
  var FUNNEL = (qsApi ? decodeURIComponent(qsApi) : window.DDFLIX_API || LS.get('dd_api') || '').replace(/\/$/, '');
  var DIRECT = Date.now() - (+(LS.get('dd_direct_bad') || 0)) > 3600000 ? (LS.get('dd_direct') || window.DDFLIX_DIRECT || '') : '';
  var API = SAME ? location.origin : (DIRECT || FUNNEL);
  // at home -> the home server's own copy of this app (a top-level http navigation is allowed from https); away -> the
  // direct address once the server reports one. ?stay=1 skips the check.
  if (!SAME && API && !/[?&]stay=1/.test(location.search) && window.fetch) {
    var wc = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (wc) setTimeout(function () { wc.abort(); }, API === DIRECT ? 8000 : 40000);
    fetch(API + '/api/where', { signal: wc ? wc.signal : undefined }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.home && /^http:\/\//.test(d.lan || '')) { location.replace(d.lan + location.hash); return; }
      if (d && /^https:\/\//.test(d.direct || '') && d.direct !== API && Date.now() - (+(LS.get('dd_direct_bad') || 0)) > 3600000) { LS.set('dd_direct', d.direct); LS.del('dd_direct_bad'); location.reload(); }
    }).catch(function () {
      if (API === DIRECT && DIRECT) { LS.set('dd_direct_bad', String(Date.now())); location.reload(); }  // direct port not reachable from here
    });
  }
  var TOKEN = LS.get('dd_token') || '';
  var PROF = null;  // {id, name, kind, avatar, header}
  try { PROF = JSON.parse(LS.get('dd_prof') || 'null'); } catch (e) { PROF = null; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(t) { var e = document.getElementById('toast'); e.textContent = t; e.className = 'on'; clearTimeout(toast.t); toast.t = setTimeout(function () { e.className = ''; }, 2600); }
  function q(path, opt) {
    opt = opt || {};
    var h = { 'Authorization': 'Bearer ' + TOKEN };
    if (PROF && PROF.header) h['X-Profile'] = PROF.header;
    if (opt.body) h['Content-Type'] = 'application/json';
    return fetch(API + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .catch(function () { throw new Error('Serverul DDflix nu răspunde acum (Home Assistant pornit? internet?). Încearcă din nou în câteva secunde.'); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && path !== '/api/web/login') { logout(); throw new Error('Sesiune expirată'); }
          if (r.status === 403 && /profile locked/.test(d.error || '')) { setProf(null); route(); throw new Error('Alege profilul din nou'); }
          if (!r.ok) { var er = new Error(d.error || ('Eroare ' + r.status)); er.status = r.status; er.data = d; throw er; }
          return d;
        });
      });
  }
  function img(kind, imdb, w) { return API + '/img/' + kind + '/' + encodeURIComponent(imdb) + '?t=' + encodeURIComponent(TOKEN) + (w ? '&w=' + w : ''); }
  function authUrl(p) { return API + p + (p.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(TOKEN); }
  function fmtT(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function gb(b) { return b ? (b / 1073741824).toFixed(1) + ' GB' : ''; }
  function logout() { TOKEN = ''; LS.del('dd_token'); setProf(null); route(); }
  function setProf(p) { PROF = p; if (p) LS.set('dd_prof', JSON.stringify(p)); else LS.del('dd_prof'); }

  // ---------- profiles ("Cine se uită?")
  var COLORS = { red: '#e50914', blue: '#2a7fff', green: '#2ecc71', yellow: '#f5c518', purple: '#9b59b6', orange: '#ff8a00', pink: '#ff4fa3', teal: '#17c3b2' };
  function avatar(p, big) {
    var c = COLORS[p.avatar] || COLORS[Object.keys(COLORS)[p.id % 8]];
    return '<span class="av' + (big ? ' big' : '') + '" style="background:' + c + '">' + esc((p.name || '?').charAt(0).toUpperCase()) + (p.kind === 'kids' ? '<i>copii</i>' : '') + '</span>';
  }
  function profilesView(manage) {
    document.getElementById('top').hidden = true;
    app.innerHTML = '<div class="who"><h1>' + (manage ? 'Gestionează profilurile' : 'Cine se uită?') + '</h1><div class="avs"></div><div class="wact"></div></div>';
    var box = app.querySelector('.avs'), act = app.querySelector('.wact');
    q('/api/profiles').then(function (d) {
      var canManage = !PROF || PROF.kind !== 'kids';
      d.items.forEach(function (p) {
        var b = document.createElement('button'); b.className = 'avb';
        b.innerHTML = avatar(p, true) + '<span class="n">' + esc(p.name) + (p.hasPin ? ' 🔒' : '') + '</span>' + (manage ? '<span class="x">✕ Șterge</span>' : '');
        b.onclick = function () {
          if (manage) {
            if (!confirm('Ștergi profilul „' + p.name + '”? Se pierd lista și progresul lui.')) return;
            return q('/api/profiles/' + p.id, { method: 'DELETE' }).then(function () { if (PROF && PROF.id === p.id) setProf(null); profilesView(true); }, function (e) { toast(e.message); });
          }
          var pin = p.hasPin ? prompt('PIN pentru ' + p.name) : '';
          if (p.hasPin && !pin) return;
          var go = function (confirmLeave) {
            q('/api/profiles/' + p.id + '/select', { body: { pin: pin || undefined, confirm: confirmLeave || undefined } }).then(function (r) {
              setProf({ id: p.id, name: p.name, kind: p.kind, avatar: p.avatar, header: r.ticket ? p.id + '.' + r.ticket : String(p.id) });
              location.hash = '#/'; route();
            }, function (e) {
              if (e.status === 409 && e.data && e.data.needConfirm) { if (confirm('Ieși din profilul de copii și intri pe „' + p.name + '”?')) go(true); return; }
              toast(e.message === 'wrong PIN' ? 'PIN greșit' : e.message);
            });
          };
          go(false);
        };
        box.appendChild(b);
      });
      if (canManage && !manage) {
        var add = document.createElement('button'); add.className = 'avb';
        add.innerHTML = '<span class="av big plus">+</span><span class="n">Adaugă profil</span>';
        add.onclick = function () { addProfile(box, add); };
        box.appendChild(add);
      }
      if (canManage) {
        var m = document.createElement('button'); m.className = 'btn sec'; m.textContent = manage ? 'Gata' : 'Gestionează profilurile';
        m.onclick = function () { profilesView(!manage); }; act.appendChild(m);
      }
    }, fail);
  }
  function addProfile(box, add) {
    var f = document.createElement('form'); f.className = 'addp';
    f.innerHTML = '<input name="n" maxlength="30" placeholder="Nume" required autocomplete="off">' +
      '<label><input type="checkbox" name="k"> Profil de copil (doar conținut pentru copii)</label>' +
      '<div><button class="btn red">Salvează</button><button type="button" class="btn sec">Renunță</button></div>';
    add.replaceWith(f); f.n.focus();
    f.querySelector('button[type=button]').onclick = function () { profilesView(false); };
    f.onsubmit = function (e) {
      e.preventDefault();
      var colors = Object.keys(COLORS), c = colors[Math.floor(Math.random() * colors.length)];
      q('/api/profiles', { body: { name: f.n.value.trim(), kind: f.k.checked ? 'kids' : 'adult', maxRating: f.k.checked ? 12 : null, avatar: c } })
        .then(function () { profilesView(false); }, function (e) { toast(e.message); });
    };
  }

  // ---------- views
  function score(r) { return r ? '<span class="imdb">IMDb ' + esc(Number(r).toFixed(1)) + '</span>' : ''; }
  function card(c) {
    var a = document.createElement('a'); a.className = 'card'; a.href = '#/t/' + encodeURIComponent(c.imdb);
    var pct = c.play && c.play.pct ? c.play.pct : c.progress && c.progress.pct;
    a.innerHTML = (c.rank ? '<span class="rkn">' + c.rank + '</span><div class="rkb">' : '') + '<div class="pw">' + (c.poster ? '<img loading="lazy" alt="" src="' + img('poster', c.imdb, 300) + '">' : '<div class="ph">' + esc(c.name) + '</div>') +
      (c.backdrop && !c.rank ? '<img class="bd" alt="" data-src="' + img('backdrop', c.imdb, 780) + '"><div class="bdn">' + esc(c.name) + '</div>' : '') +
      (c.inLibrary ? '<span class="nas">NAS</span>' : '') + score(c.rating) +
      (pct ? '<div class="bar"><i style="width:' + Math.round(pct * 100) + '%"></i></div>' : '') + '</div>' +
      '<div class="t">' + esc(c.name) + (c.year ? ' · ' + c.year : '') + '</div>' + (c.rank ? '</div>' : '');
    if (c.rank) a.className += ' rkc';
    var bd = a.querySelector('.bd');
    if (bd) a.addEventListener('mouseenter', function () { if (!bd.src) { bd.onload = function () { bd.className += ' ok'; }; bd.src = bd.getAttribute('data-src'); } });
    return a;
  }
  // server row link "#/browse?type=series&genre=Crime" -> our page "#/series/Crime"
  function pageLink(link) {
    if (!link) return '';
    var m = /[?&]type=(series|movie)/.exec(link), g = /[?&]genre=([^&]+)/.exec(link), so = /[?&]sort=([^&]+)/.exec(link);
    if (!m) return '';
    return '#/' + (m[1] === 'series' ? 'series' : 'movies') + '/' + (g ? g[1] : 'all') + (so && !g ? '?sort=' + so[1] : '');
  }
  function row(title, items, link) {
    if (!items || !items.length) return null;
    var s = document.createElement('section'); s.className = 'row';
    var href = pageLink(link);
    s.innerHTML = '<h2>' + (href ? '<a href="' + esc(href) + '">' + esc(title) + ' <span class="more">Vezi tot ›</span></a>' : esc(title)) + '</h2>';
    var sw = document.createElement('div'); sw.className = 'sw'; s.appendChild(sw);
    var st = document.createElement('div'); st.className = 'strip'; items.forEach(function (c) { st.appendChild(card(c)); }); sw.appendChild(st);
    [['l', '‹', -1], ['r', '›', 1]].forEach(function (x) {
      var b = document.createElement('button'); b.className = 'arr ' + x[0]; b.textContent = x[1]; b.setAttribute('aria-label', x[2] < 0 ? 'Înapoi' : 'Înainte');
      b.onclick = function () { st.scrollBy({ left: x[2] * st.clientWidth * 0.85, behavior: 'smooth' }); };
      sw.appendChild(b);
    });
    var upd = function () { sw.classList.toggle('at-start', st.scrollLeft < 8); sw.classList.toggle('at-end', st.scrollLeft + st.clientWidth > st.scrollWidth - 8); };
    st.addEventListener('scroll', upd, { passive: true }); setTimeout(upd, 0);
    return s;
  }

  function loginView(err) {
    app.innerHTML = '<form class="login"><img src="icon.png" alt="" width="56" height="56" style="border-radius:14px"><span class="wm">DDFLIX</span><input type="password" name="pw" placeholder="Parola" autocomplete="current-password" required>' +
      (SAME ? '<input type="hidden" name="api" value="">' : '<details><summary class="mut">Server</summary><input name="api" placeholder="https://…" value="' + esc(API) + '"></details>') +
      '<button class="btn red" style="width:100%;justify-content:center">Intră</button><p class="err">' + esc(err || '') + '</p></form>';
    var f = app.querySelector('form');
    f.onsubmit = function (e) {
      e.preventDefault();
      var api = f.api.value.trim().replace(/\/$/, '');
      if (api && api !== window.DDFLIX_API) LS.set('dd_api', api); API = api || API;
      q('/api/web/login', { body: { password: f.pw.value, name: (navigator.platform || 'Web').slice(0, 30) } })
        .then(function (d) { TOKEN = d.token; LS.set('dd_token', TOKEN); setProf(null); location.hash = '#/'; route(); }, function (e) { loginView(e.message); });
    };
  }

  var GENRES = {
    series: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Reality-TV', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'],
    movie: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western']
  };
  var GRO = { Action: 'Acțiune', Adventure: 'Aventură', Animation: 'Animație', Biography: 'Biografii', Comedy: 'Comedii', Crime: 'Polițiste', Documentary: 'Documentare', Drama: 'Dramă', Family: 'Copii și familie', Fantasy: 'Fantastic', History: 'Istorie', Horror: 'Horror', Mystery: 'Mister', 'Reality-TV': 'Reality', Romance: 'Dragoste', 'Sci-Fi': 'SF', Sport: 'Sport', Thriller: 'Thriller', War: 'Război', Western: 'Western' };  // = TV app
  function metaLine(h) {
    var p = [h.type === 'series' ? 'Serial' : 'Film'];
    if (h.genres && h.genres[0]) p.push(GRO[h.genres[0]] || h.genres[0]);
    if (h.year) p.push(h.year + (h.yearEnd && h.yearEnd !== h.year ? '–' + h.yearEnd : ''));
    if (h.seasons) p.push(typeof h.seasons === 'number' ? (h.seasons === 1 ? '1 sezon' : h.seasons + ' sezoane') : (h.seasons.filter(function (s) { return s.season > 0; }).length + ' sezoane'));
    if (h.runtime && h.type !== 'series') p.push(Math.floor(h.runtime / 60) ? Math.floor(h.runtime / 60) + ' h ' + (h.runtime % 60) + ' min' : h.runtime + ' min');
    return p.join('  •  ');
  }
  function heroBox(h, isTitle) {
    var d = document.createElement('section'); d.className = 'hero' + (isTitle ? ' title' : '');
    d.innerHTML = (h.backdrop !== false ? '<img class="hbg" alt="" src="' + img('backdrop', h.imdb, 1280) + '">' : '') + '<div class="scrim"></div>' +
      '<div class="hc"><div class="hlogo">' + (h.logo ? '<img alt="' + esc(h.name) + '" src="' + img('logo', h.imdb, 500) + '">' : '<h1 class="hn">' + esc(h.name) + '</h1>') + '</div>' +
      '<div class="hmeta">' + esc(metaLine(h)) + '</div><p class="hsyn">' + esc(h.description || '') + '</p></div><div class="hbtns"></div><div class="hchips"></div>';
    var lg = d.querySelector('.hlogo img'); if (lg) lg.onerror = function () { lg.parentNode.innerHTML = '<h1 class="hn">' + esc(h.name) + '</h1>'; };
    var bg = d.querySelector('.hbg'); if (bg) bg.onerror = function () { bg.remove(); };
    var ch = d.querySelector('.hchips');
    (h.labels || []).forEach(function (l) { ch.insertAdjacentHTML('beforeend', '<span class="pill">' + esc(l === '4K' ? 'Disponibil în 4K' : l) + '</span>'); });
    if (h.rating) ch.insertAdjacentHTML('beforeend', '<span class="pill imdb">IMDb ' + Number(h.rating).toFixed(1) + '</span>');
    return d;
  }
  function heroTrailer(hb, imdb, withButton) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var tries = 0;
    (function poll() {
      if (!document.body.contains(hb) && tries) return;
      q('/api/title/' + encodeURIComponent(imdb) + '/trailer/prefetch', { body: {} }).then(function (r) {
        if (!document.body.contains(hb)) return;
        if (!r.ready) { if (r.state !== 'none' && ++tries < 40) setTimeout(poll, 2500); return; }
        var v = document.createElement('video'); v.className = 'htr'; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
        v.src = authUrl('/api/title/' + encodeURIComponent(imdb) + '/trailer.mp4' + (PROF && PROF.header ? '?p=' + encodeURIComponent(PROF.header) : ''));
        v.oncanplay = function () { hb.classList.add('playing'); };
        v.onended = function () { hb.classList.remove('playing'); };
        hb.insertBefore(v, hb.querySelector('.scrim'));
        v.play().catch(function () { /* autoplay blocked */ });
        var mb = document.createElement('button'); mb.className = 'mute'; mb.setAttribute('aria-label', 'Sunet'); mb.textContent = '🔇';
        mb.onclick = function () { v.muted = !v.muted; mb.textContent = v.muted ? '🔇' : '🔊'; if (v.ended || v.paused) { v.currentTime = 0; v.play(); } };
        hb.appendChild(mb);
        if (withButton) { var tb = document.createElement('button'); tb.className = 'btn sec'; tb.textContent = '▶  Trailer'; tb.onclick = function () { v.currentTime = 0; v.muted = false; mb.textContent = '🔊'; v.play(); hb.scrollIntoView({ behavior: 'smooth' }); }; hb.querySelector('.hbtns').appendChild(tb); }
      }, function () { /* no trailer */ });
    })();
  }
  // Netflix-like page header: "Seriale  [Genuri v]"
  function typeHead(type, genre) {
    var sec = type === 'series' ? 'series' : 'movies', h = document.createElement('div'); h.className = 'ghead';
    h.innerHTML = '<h1>' + (type === 'series' ? 'Seriale' : 'Filme') + (genre && genre !== 'all' ? ' <span class="mut">› ' + esc(GRO[genre] || genre) + '</span>' : '') + '</h1>';
    var sel = document.createElement('select'); sel.className = 'gsel'; sel.setAttribute('aria-label', 'Genuri');
    sel.innerHTML = '<option value="">Genuri</option><option value="all"' + (genre === 'all' ? ' selected' : '') + '>Toate</option>' + GENRES[type].map(function (g) { return '<option value="' + esc(g) + '"' + (g === genre ? ' selected' : '') + '>' + esc(GRO[g] || g) + '</option>'; }).join('');
    sel.onchange = function () { location.hash = '#/' + sec + (sel.value ? '/' + encodeURIComponent(sel.value) : ''); };
    h.appendChild(sel);
    return h;
  }
  function home(type) {
    app.innerHTML = '<p class="pad mut">Se încarcă…</p>';
    Promise.all([q('/api/home' + (type ? '?type=' + type : '')), q('/api/continue').catch(function () { return { items: [] }; }), q('/api/mylist').catch(function () { return { items: [] }; }),
      type ? Promise.resolve({ items: [] }) : q('/api/library/recent').catch(function () { return { items: [] }; })]).then(function (r) {
      app.innerHTML = '';
      if (type) app.appendChild(typeHead(type));
      var hs = r[0].hero || [], h = hs[Math.floor(Math.random() * Math.min(4, hs.length))];
      if (h) {
        var hb = heroBox(h), bt = hb.querySelector('.hbtns');
        if (h.inLibrary) { var pl = document.createElement('a'); pl.className = 'btn'; pl.href = '#/t/' + encodeURIComponent(h.imdb); pl.textContent = '▶  Redare'; bt.appendChild(pl); }
        var mi = document.createElement('a'); mi.className = 'btn sec'; mi.href = '#/t/' + encodeURIComponent(h.imdb); mi.textContent = 'Mai multe informații'; bt.appendChild(mi);
        app.appendChild(hb);
        heroTrailer(hb, h.imdb, false);
      }
      // genre rows become tiles under the hero (like the TV)
      var tiles = document.createElement('div'); tiles.className = 'tiles';
      var addTile = function (label, href) { var t = document.createElement('a'); t.className = 'tile'; t.href = href; t.textContent = label; tiles.appendChild(t); };
      addTile('Noi și esențiale', '#/library' + (type ? '?type=' + type : ''));  // same first tile as the TV
      var rest = [];
      (r[0].rows || []).forEach(function (x) {
        if ((x.key || '').indexOf('g:') === 0) addTile(x.title.replace(/^(Seriale|Filme): /, ''), pageLink(x.link));
        rest.push(x);  // genres are tiles AND rows on the web
      });
      if (tiles.children.length) app.appendChild(tiles);
      var keep = function (items) { return type ? (items || []).filter(function (c) { return c.type === type; }) : items; };
      [row('Continuă vizionarea', keep(r[1].items)), row('Lista mea', keep(r[2].items)), row('Adăugate recent în bibliotecă', r[3].items)].concat(rest.map(function (x) { return row(x.title, x.items, x.link); }))
        .forEach(function (s) { if (s) app.appendChild(s); });
      if (!app.children.length) app.innerHTML = '<p class="pad mut">Nimic de arătat încă.</p>';
    }, fail);
  }
  function library(type) {
    app.innerHTML = '<div class="ghead"><h1>Noi și esențiale</h1></div><p class="pad mut" style="padding-top:4px">Tot ce e pe NAS, cele mai noi primele.</p><div class="grid"></div>';
    var grid = app.querySelector('.grid');
    q('/api/browse?sort=added' + (type ? '&type=' + type : '')).then(function (d) { (d.items || []).forEach(function (c) { grid.appendChild(card(c)); }); }, fail);
  }
  function mylist() {
    app.innerHTML = '<div class="ghead"><h1>Lista mea</h1></div><div class="grid"></div>';
    var grid = app.querySelector('.grid');
    q('/api/mylist').then(function (d) {
      (d.items || []).forEach(function (c) { grid.appendChild(card(c)); });
      if (!grid.children.length) app.insertAdjacentHTML('beforeend', '<p class="pad mut">Lista e goală. Apasă „+ Lista mea” pe un serial sau film.</p>');
    }, fail);
  }
  // grid of everything in a genre (not only the NAS), sorted popular / IMDb score / newest, paged
  function genreView(type, genre, sort) {
    app.innerHTML = '';
    app.appendChild(typeHead(type, genre));
    var bar = document.createElement('div'); bar.className = 'tabs';
    [['popular', 'Populare'], ['score', 'Nota IMDb'], ['newest', 'Cele mai noi']].forEach(function (o) {
      var b = document.createElement('button'); b.textContent = o[1]; b.className = (sort || 'popular') === o[0] ? 'on' : '';
      b.onclick = function () { location.hash = '#/' + (type === 'series' ? 'series' : 'movies') + '/' + encodeURIComponent(genre) + '?sort=' + o[0]; };
      bar.appendChild(b);
    });
    app.appendChild(bar);
    var grid = document.createElement('div'); grid.className = 'grid'; app.appendChild(grid);
    var more = document.createElement('div'); more.className = 'pad'; app.appendChild(more);
    var page = 0;
    function load() {
      page++; more.innerHTML = '<span class="mut">Se încarcă…</span>';
      q('/api/browse?type=' + type + (genre && genre !== 'all' ? '&genre=' + encodeURIComponent(genre) : '') + '&sort=' + (sort || 'popular') + '&page=' + page).then(function (d) {
        (d.items || []).forEach(function (c) { grid.appendChild(card(c)); });
        more.innerHTML = '';
        if (d.more) { var b = document.createElement('button'); b.className = 'btn sec'; b.textContent = 'Mai multe'; b.onclick = load; more.appendChild(b); }
        else if (!grid.children.length) more.innerHTML = '<span class="mut">Nimic aici.</span>';
      }, function (e) { more.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
    }
    load();
  }

  function search(qs) {
    app.innerHTML = '<div class="pad"><input class="q" type="search" placeholder="Caută seriale, filme…" value="' + esc(qs || '') + '"></div><div class="grid"></div><p class="pad mut st"></p>';
    var inp = app.querySelector('input'), grid = app.querySelector('.grid'), st = app.querySelector('.st'), t1, t2, gen = 0;
    function show(d) { grid.innerHTML = ''; (d.titles || []).forEach(function (c) { grid.appendChild(card(c)); }); }
    function run() {
      var v = inp.value.trim(), g = ++gen; clearTimeout(t2);
      history.replaceState(null, '', '#/search/' + encodeURIComponent(v));
      if (!v) { grid.innerHTML = ''; st.textContent = ''; return; }
      q('/api/search?q=' + encodeURIComponent(v)).then(function (d) { if (g === gen) show(d); });
      t2 = setTimeout(function () {
        st.textContent = 'Caut și pe internet…';
        q('/api/search/live?q=' + encodeURIComponent(v)).then(function (d) { if (g === gen) { show(d); st.textContent = d.titles.length ? '' : 'Nimic găsit.'; } }, function (e) { st.textContent = e.message; });
      }, 700);
    }
    inp.oninput = function () { clearTimeout(t1); t1 = setTimeout(run, 250); };
    inp.focus(); if (qs) run();
  }

  function title(imdb) {
    app.innerHTML = '<p class="pad mut">Se încarcă…</p>';
    Promise.all([q('/api/title/' + encodeURIComponent(imdb)), q('/api/playable/' + encodeURIComponent(imdb)).catch(function () { return { files: [] }; })]).then(function (r) {
      var t = r[0], p = r[1], files = p.files || [], byEp = {};
      files.forEach(function (f) { byEp[f.season + ':' + f.episode] = f; });
      app.innerHTML = '';
      var hero = heroBox(t, true);
      if (t.imdbUrl) hero.querySelector('.hchips').insertAdjacentHTML('beforeend', '<a class="pill" target="_blank" rel="noopener" href="' + esc(t.imdbUrl) + '">pe IMDb ↗</a>');
      app.appendChild(hero);
      heroTrailer(hero, imdb, true);
      var acts = hero.querySelector('.hbtns');
      if (p.next) { var b = document.createElement('button'); b.className = 'btn'; b.textContent = '▶ ' + (p.next.action || 'Redă'); b.onclick = function () { play(p.next.id, t.name); }; acts.appendChild(b); }
      var ml = document.createElement('button'); ml.className = 'btn sec'; ml.textContent = '+ Lista mea'; ml.onclick = function () { q('/api/mylist/' + encodeURIComponent(imdb), { method: 'POST', body: {} }).then(function () { toast('Adăugat în Lista mea'); }); }; acts.appendChild(ml);
      DL.items = DL.items.filter(function (x) { return x.imdb !== imdb; }).concat(t.downloads || []);
      if (t.type === 'movie' && !files.length) acts.appendChild(dlFor(imdb + '||') ? dlEl(imdb + '||') : dlBtn('⬇  Descarcă', { imdb: imdb }));
      else if (t.type === 'series' && (t.downloads || []).some(function (x) { return x.state !== 'done'; })) acts.appendChild(dlEl(imdb + '||'));

      if (t.type === 'series' && t.seasons && t.seasons.length) {
        var tabs = document.createElement('div'); tabs.className = 'tabs'; app.appendChild(tabs);
        var box = document.createElement('div'); app.appendChild(box);
        var seasons = t.seasons.filter(function (s) { return s.season > 0; });
        var cur = (p.next && p.next.season) || (seasons.filter(function (s) { return s.available; })[0] || seasons[seasons.length - 1] || {}).season;
        var draw = function () {
          tabs.innerHTML = ''; box.innerHTML = '';
          seasons.forEach(function (s) { var b = document.createElement('button'); b.textContent = 'Sezonul ' + s.season + (s.available ? ' · ' + s.available + '/' + s.episodes.length : ''); b.className = s.season === cur ? 'on' : ''; b.onclick = function () { cur = s.season; draw(); }; tabs.appendChild(b); });
          var se = seasons.filter(function (s) { return s.season === cur; })[0]; if (!se) return;
          var aired = se.aired != null ? se.aired : se.episodes.length;
          if (se.available < aired) {  // some aired episodes are missing: whole season, or the rest of an airing one
            var pk = document.createElement('div'); pk.className = 'pad'; var sk = imdb + '|' + se.season + '|';
            var label = se.available ? '⬇  Descarcă restul sezonului ' + se.season : '⬇  Descarcă tot sezonul ' + se.season;
            pk.appendChild(DL.items.some(function (x) { return x.imdb === imdb && x.season === se.season && x.episode == null && !(x.episodes && x.episodes.length); }) ? dlEl(sk) :
              dlBtn(label, { imdb: imdb, season: se.season }, !se.packs.length && !se.episodes.some(function (x) { return x.versions && x.versions.length; }), false, sk));
            if (t.following) pk.insertAdjacentHTML('beforeend', '<div class="mut" style="margin-top:6px">🔔 Urmărești serialul: episoadele noi se descarcă singure.</div>');
            box.appendChild(pk);
          } else if (t.following) box.insertAdjacentHTML('beforeend', '<div class="pad mut">🔔 Urmărești serialul: episoadele noi se descarcă singure când apar.</div>');
          se.episodes.forEach(function (e) {
            var f = byEp[se.season + ':' + e.episode], d = document.createElement('div'); d.className = 'ep';
            d.innerHTML = (e.thumb ? '<img loading="lazy" alt="" src="' + img('episode', imdb, 320).replace('/img/episode/' + encodeURIComponent(imdb), '/img/episode/' + encodeURIComponent(imdb) + '/' + se.season + '/' + e.episode) + '">' : '<div class="ph"></div>') +
              '<div class="b"><h4>' + e.episode + '. ' + esc(e.name) + ' ' + score(e.rating) + '</h4><p>' + esc(e.overview) + '</p><div class="a"></div></div>';
            var a = d.querySelector('.a');
            if (f) { var b = document.createElement('button'); b.className = 'btn sm'; b.textContent = '▶ ' + (f.position > 30 && !f.watched ? 'Reia' : 'Redă'); b.onclick = function () { play(f.id, t.name); }; a.appendChild(b); }
            else if (e.download || dlFor(imdb + '|' + se.season + '|' + e.episode)) a.appendChild(dlEl(imdb + '|' + se.season + '|' + e.episode));
            else if (e.versions && e.versions.length) a.appendChild(dlBtn('⬇ Descarcă', { imdb: imdb, release_id: e.versions[0] }, false, true, imdb + '|' + se.season + '|' + e.episode));
            else if (se.packs && se.packs.length) a.appendChild(dlBtn('⬇ Descarcă', { imdb: imdb, season: se.season, episode: e.episode }, false, true, imdb + '|' + se.season + '|' + e.episode));
            else a.innerHTML = '<span class="mut">' + (e.released && e.released > new Date().toISOString().slice(0, 10) ? 'Apare pe ' + esc(e.released) : 'Indisponibil') + '</span>';
            box.appendChild(d);
          });
        };
        draw();
      }
      if ((t.versions || []).length) {
        var rs = document.createElement('section'); rs.className = 'row'; rs.innerHTML = '<h2>Versiuni pe FileList</h2>';
        t.versions.slice(0, 15).forEach(function (v) {
          var d = document.createElement('div'); d.className = 'rel';
          d.innerHTML = '<div><div class="n">' + esc(v.name) + '</div><div class="m">' + [gb(v.size), v.seeders + ' seed', v.freeleech ? 'freeleech' : ''].filter(Boolean).join(' · ') + '</div></div>';
          d.appendChild(v.download ? Object.assign(document.createElement('span'), { className: 'mut', textContent: Math.round(v.download.progress * 100) + '%' }) : dlBtn('⬇', { imdb: imdb, release_id: v.id }, false, true));
          rs.appendChild(d);
        });
        app.appendChild(rs);
      }
      if ((t.similar || []).length) app.appendChild(row('Asemănătoare', t.similar));
      dlPoll();
    }, fail);
  }
  var DL = { items: [], t: null, seen: null };
  function dlInfo(x) {
    if (x.state === 'done') return '✓ Descărcat — gata de vizionat';
    if (x.state === 'queued') return 'În coadă…';
    if (x.state === 'paused') return 'Pe pauză · ' + Math.round(x.progress * 100) + '%';
    if (x.state === 'error') return 'Eroare la descărcare';
    var eta = x.eta > 0 && x.eta < 8640000 ? ' · ' + (x.eta >= 3600 ? Math.floor(x.eta / 3600) + ' h ' : '') + Math.ceil((x.eta % 3600) / 60) + ' min rămase' : '';
    return '⬇ ' + Math.round(x.progress * 100) + '%' + (x.speed ? ' · ' + (x.speed / 1048576).toFixed(1) + ' MB/s' : '') + eta;
  }
  function dlFor(k) {
    var p = k.split('|');
    return DL.items.filter(function (i) {
      if (i.imdb !== p[0]) return false;
      if (p[1] === '') return true;
      if (String(i.season) !== p[1]) return false;
      if (p[2] === '') return true;
      if (i.episodes && i.episodes.length) return i.episodes.indexOf(+p[2]) >= 0;
      return i.episode == null || String(i.episode) === p[2];
    }).sort(function (a, b) { return (a.state === 'done') - (b.state === 'done'); })[0];
  }
  function dlEl(k) { var e = document.createElement('div'); e.className = 'dlp'; e.setAttribute('data-dlk', k); e.hidden = true; paintOne(e); return e; }
  function paintOne(el) {
    var x = dlFor(el.getAttribute('data-dlk'));
    if (!x) { if (!el.getAttribute('data-started')) el.hidden = true; return; }
    el.hidden = false; el.className = 'dlp' + (x.state === 'done' ? ' done' : '');
    el.innerHTML = '<span>' + esc(dlInfo(x)) + '</span>' + (x.state === 'done' ? '' : '<i><b style="width:' + Math.max(2, Math.round(x.progress * 100)) + '%"></b></i>');
  }
  function dlPoll(now) {
    clearTimeout(DL.t);
    if (!TOKEN || !PROF || PROF.kind === 'kids') return;
    q('/api/downloads').then(function (d) {
      var items = d.items || [], active = items.filter(function (x) { return x.state !== 'done' && x.state !== 'error'; });
      if (DL.seen) items.forEach(function (x) { if (x.state === 'done' && DL.seen[x.id] && DL.seen[x.id] !== 'done') toast('✓ Gata de vizionat: ' + x.name); });
      DL.seen = {}; items.forEach(function (x) { DL.seen[x.id] = x.state; });
      DL.items = items;
      var b = document.querySelector('#dl-tab .bdg'); if (b) { b.hidden = !active.length; b.textContent = active.length; }
      [].forEach.call(document.querySelectorAll('[data-dlk]'), paintOne);
      DL.t = setTimeout(dlPoll, active.length ? 3000 : 30000);
    }, function () { DL.t = setTimeout(dlPoll, 30000); });
  }
  function dlBtn(label, body, disabled, small, key) {
    var b = document.createElement('button'); b.className = 'btn red' + (small ? ' sm' : ''); b.textContent = label; b.disabled = !!disabled;
    if (disabled) b.title = 'Nu există pachet de sezon; descarcă episoadele';
    b.onclick = function () {
      b.disabled = true; b.textContent = '…';
      q('/api/tv/download', { body: body }).then(function (d) {
        toast(d.message || (d.watching ? 'Am pornit ' + (d.episodes && d.episodes.length ? (d.episodes.length === 1 ? 'episodul ' : 'episoadele ') + d.episodes.join(', ') : 'descărcarea') + '. Episoadele noi se descarcă singure când apar.' : 'Descărcarea a pornit. Progresul îl vezi aici și în Descărcări.'));
        var k = key || (body.imdb + '|' + (body.season != null ? body.season : '') + '|');
        var el = dlEl(k); el.hidden = false; el.setAttribute('data-started', '1'); el.innerHTML = '<span>⬇ Pornește… ' + esc(d.release && d.release.name || '') + '</span><i><b style="width:2%"></b></i>';
        b.replaceWith(el); dlPoll();
      }, function (e) { b.disabled = false; b.textContent = label; toast(e.message); });
    };
    return b;
  }

  function downloads() {
    app.innerHTML = '<div class="ghead"><h1>Descărcări</h1></div><p class="pad mut" style="padding-top:6px">Se descarcă pe NAS, în folderul Plex. Se actualizează singur.</p><div class="list"></div>';
    var list = app.querySelector('.list');
    var tick = function () {
      if (!location.hash.startsWith('#/downloads')) return;
      q('/api/downloads').then(function (d) {
        list.innerHTML = d.items.length ? '' : '<p class="pad mut">Nimic în descărcare. Caută un serial sau un film și apasă „Descarcă”.</p>';
        d.items.forEach(function (x) {
          var e = document.createElement('div'); e.className = 'dl';
          var se = x.season != null ? 'Sezonul ' + x.season + (x.episode != null ? ', episodul ' + x.episode : x.episodes && x.episodes.length ? (x.episodes.length === 1 ? ', episodul ' : ', episoadele ') + x.episodes.join(', ') : ' (tot sezonul)') : '';
          e.innerHTML = (x.imdb ? '<img alt="" src="' + img('poster', x.imdb, 200) + '">' : '') + '<div class="i"><div class="n">' + esc(se || x.name) + '</div><div class="r">' + esc(x.name) + ' · ' + gb(x.size) + '</div>' +
            '<div class="s">' + esc(dlInfo(x)) + '</div>' + (x.state === 'done' ? '' : '<div class="prog"><i style="width:' + Math.max(2, Math.round(x.progress * 100)) + '%"></i></div>') + '</div>';
          if (x.imdb) e.onclick = function () { location.hash = '#/t/' + encodeURIComponent(x.imdb); };
          var ac = document.createElement('div'); ac.className = 'da';
          var mk = function (label, fn) { var b = document.createElement('button'); b.className = 'btn sec sm'; b.textContent = label; b.onclick = function (ev) { ev.stopPropagation(); fn(); }; ac.appendChild(b); };
          if (x.state === 'paused') mk('▶ Reia', function () { q('/api/downloads/' + x.id + '/resume', { body: {} }).then(function () { toast('Reluat'); }, function (e) { toast(e.message); }); });
          else if (x.state !== 'done') mk('⏸ Pauză', function () { q('/api/downloads/' + x.id + '/pause', { body: {} }).then(function () { toast('Pus pe pauză'); }, function (e) { toast(e.message); }); });
          mk(x.state === 'done' ? 'Scoate din listă' : '✕ Anulează', function () {
            var files = x.state !== 'done' && confirm('Anulezi descărcarea „' + (x.name || '') + '”? Fișierul parțial se șterge de pe NAS.');
            if (x.state !== 'done' && !files) return;
            q('/api/downloads/' + x.id + (files ? '?files=1' : ''), { method: 'DELETE' }).then(function () { toast(files ? 'Anulat' : 'Scos din listă (fișierul rămâne pe NAS)'); }, function (e) { toast(e.message); });
          });
          e.appendChild(ac);
          list.appendChild(e);
        });
        setTimeout(tick, 3000);
      }, fail);
    };
    tick();
  }

  // ---------- Settings: pair a TV, devices, profiles (PIN, kids age), my audio/subtitle languages, quality, storage
  var LANGS = [['rum', 'Română'], ['eng', 'Engleză'], ['fre', 'Franceză'], ['ger', 'Germană'], ['spa', 'Spaniolă'], ['ita', 'Italiană'], ['hun', 'Maghiară']];
  function settingsView(code) {
    LS.del('dd_paircode');
    if (PROF && PROF.kind === 'kids') { app.innerHTML = '<p class="pad err">Setările nu sunt disponibile pe profilul de copii.</p>'; return; }
    app.innerHTML = '<div class="ghead"><h1>Setări</h1></div>' +
      '<section class="set" id="s-pair"><h2>Asociază un televizor</h2><p class="mut">Pe televizor deschide DDflix: apare un cod de 6 litere. Scrie-l aici (sau scanează QR-ul de pe TV cu telefonul).</p>' +
      '<form class="frm"><input name="code" maxlength="7" placeholder="Cod (ex. KQ7MWD)" autocomplete="off" style="text-transform:uppercase"><input name="name" maxlength="40" placeholder="Nume (ex. Sufragerie)"><select name="pid"></select><button class="btn red">Asociază</button></form></section>' +
      '<section class="set"><h2>Dispozitive</h2><div id="s-dev" class="lst"></div></section>' +
      '<section class="set"><h2>Profiluri</h2><div id="s-prof" class="lst"></div><button class="btn sec" id="s-add">+ Adaugă profil</button></section>' +
      '<section class="set"><h2>Limbi pentru ' + esc(PROF ? PROF.name : '') + '</h2><p class="mut">Ordinea în care se aleg automat sunetul și subtitrarea.</p><div id="s-lang"></div></section>' +
      '<section class="set"><h2>Redare</h2><div id="s-play"></div></section>' +
      '<section class="set"><h2>Acces din afara casei</h2><div id="s-rem"></div></section>' +
      '<section class="set"><h2>Server</h2><div id="s-srv" class="mut"></div></section>';
    var f = app.querySelector('#s-pair form');
    if (code) { f.code.value = code.toUpperCase(); setTimeout(function () { app.querySelector('#s-pair').scrollIntoView({ block: 'start' }); f.name.focus(); }, 50); }
    f.onsubmit = function (e) {
      e.preventDefault();
      q('/api/device/pair/approve', { body: { code: f.code.value.trim(), name: f.name.value.trim() || 'Televizor', profileId: f.pid.value ? +f.pid.value : null } })
        .then(function () { toast('Televizor asociat. Pe TV apare ecranul de profiluri.'); f.reset(); loadDev(); history.replaceState(null, '', '#/settings'); }, function (e) { toast(e.message === 'unknown or expired code' ? 'Cod greșit sau expirat: verifică pe TV' : e.message); });
    };
    function ago(t) { if (!t) return 'niciodată'; var s = Date.now() / 1000 - t; return s < 120 ? 'acum' : s < 3600 ? 'acum ' + Math.round(s / 60) + ' min' : s < 86400 ? 'acum ' + Math.round(s / 3600) + ' h' : new Date(t * 1000).toLocaleDateString('ro-RO'); }
    function loadDev() {
      var box = app.querySelector('#s-dev');
      q('/api/devices').then(function (d) {
        box.innerHTML = '';
        d.items.forEach(function (x) {
          var r = document.createElement('div'); r.className = 'li';
          r.innerHTML = '<div><b>' + esc(x.name) + '</b> <span class="mut">· ' + (x.kind === 'tv' ? 'televizor' : 'browser') + '</span><div class="mut sm">văzut ' + esc(ago(x.lastSeen)) + (x.lastIp ? ' · ' + esc(x.lastIp) : '') + '</div></div>';
          var b = document.createElement('button'); b.className = 'btn sec sm'; b.textContent = 'Revocă';
          b.onclick = function () { if (confirm('Revoci „' + x.name + '”? Va trebui asociat din nou.')) q('/api/devices/' + x.id, { method: 'DELETE' }).then(loadDev, function (e) { toast(e.message); }); };
          r.appendChild(b); box.appendChild(r);
        });
      }, function (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    }
    function loadProf() {
      var box = app.querySelector('#s-prof');
      q('/api/profiles').then(function (d) {
        f.pid.innerHTML = '<option value="">Profil implicit pe TV: niciunul (alegi pe TV)</option>' + d.items.map(function (p) { return '<option value="' + p.id + '">Profil implicit: ' + esc(p.name) + '</option>'; }).join('');
        box.innerHTML = '';
        d.items.forEach(function (p) {
          var r = document.createElement('div'); r.className = 'li prof';
          r.innerHTML = avatar(p) + '<input class="pn" maxlength="30" value="' + esc(p.name) + '" aria-label="Nume">' +
            '<select class="pk"><option value="adult">Adult</option><option value="kids">Copil</option></select>' +
            '<select class="pa"><option value="7">până la 7 ani</option><option value="12">până la 12 ani</option><option value="15">până la 15 ani</option></select>' +
            '<button class="btn sec sm pin">' + (p.hasPin ? '🔒 Schimbă PIN' : 'Pune PIN') + '</button>' + (p.hasPin ? '<button class="btn sec sm nopin">Scoate PIN</button>' : '') +
            '<button class="btn sec sm del">Șterge</button>';
          var pk = r.querySelector('.pk'), pa = r.querySelector('.pa'), pn = r.querySelector('.pn');
          pk.value = p.kind; pa.value = String(p.maxRating || 12); pa.hidden = p.kind !== 'kids';
          var save = function (body) { q('/api/profiles/' + p.id, { method: 'PATCH', body: body }).then(function () { toast('Salvat'); if (PROF && PROF.id === p.id && body.name) { PROF.name = body.name; setProf(PROF); } loadProf(); }, function (e) { toast(e.message); }); };
          pn.onchange = function () { if (pn.value.trim()) save({ name: pn.value.trim() }); };
          pk.onchange = function () { save({ kind: pk.value, maxRating: pk.value === 'kids' ? +pa.value : null }); };
          pa.onchange = function () { save({ maxRating: +pa.value }); };
          r.querySelector('.pin').onclick = function () {
            var pin = prompt('PIN nou de 4 cifre pentru ' + p.name + ' (nu 1234, nu 0000):'); if (!pin) return;
            q('/api/profiles/' + p.id + '/pin', { body: { pin: pin } }).then(function () { toast('PIN salvat'); loadProf(); }, function (e) { toast(e.message); });
          };
          var np = r.querySelector('.nopin'); if (np) np.onclick = function () { q('/api/profiles/' + p.id + '/pin', { body: { pin: '' } }).then(function () { toast('PIN scos'); loadProf(); }, function (e) { toast(e.message); }); };
          r.querySelector('.del').onclick = function () {
            if (!confirm('Ștergi profilul „' + p.name + '”? Se pierd lista și progresul lui.')) return;
            q('/api/profiles/' + p.id, { method: 'DELETE' }).then(function () { if (PROF && PROF.id === p.id) { setProf(null); route(); } else loadProf(); }, function (e) { toast(e.message); });
          };
          box.appendChild(r);
          if (PROF && p.id === PROF.id) loadLang(p);
        });
      }, function (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    }
    app.querySelector('#s-add').onclick = function () {
      var n = prompt('Numele profilului nou:'); if (!n || !n.trim()) return;
      var kidsP = confirm('E profil de copil? (OK = da, Cancel = adult)');
      q('/api/profiles', { body: { name: n.trim(), kind: kidsP ? 'kids' : 'adult', maxRating: kidsP ? 12 : null, avatar: Object.keys(COLORS)[Math.floor(Math.random() * 8)] } }).then(loadProf, function (e) { toast(e.message); });
    };
    function loadLang(p) {
      var box = app.querySelector('#s-lang'), pr = p.prefs || {};
      var opts = function (sel) { return '<option value="">—</option>' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === sel ? ' selected' : '') + '>' + l[1] + '</option>'; }).join(''); };
      var a = pr.audio || ['rum', 'eng'], s = pr.subs || ['rum', 'eng'], st = pr.subStyle || {};
      box.innerHTML = '<div class="frm"><label>Sunet: 1<select class="a0">' + opts(a[0]) + '</select> 2<select class="a1">' + opts(a[1]) + '</select></label>' +
        '<label>Subtitrare: 1<select class="s0">' + opts(s[0]) + '</select> 2<select class="s1">' + opts(s[1]) + '</select></label>' +
        '<label>Mărime<select class="ss"><option value="s">mică</option><option value="m">medie</option><option value="l">mare</option><option value="xl">foarte mare</option></select></label>' +
        '<label>Culoare<select class="sc"><option value="white">albă</option><option value="yellow">galbenă</option><option value="cyan">cyan</option></select></label>' +
        '<label>Fundal<select class="sb"><option value="shadow">umbră</option><option value="box">casetă</option><option value="outline">contur</option></select></label></div>';
      box.querySelector('.ss').value = st.size || 'm'; box.querySelector('.sc').value = st.color || 'white'; box.querySelector('.sb').value = st.bg || 'shadow';
      box.onchange = function () {
        var v = function (c) { return box.querySelector(c).value; };
        q('/api/profiles/' + p.id + '/prefs', { method: 'PUT', body: { audio: [v('.a0'), v('.a1')].filter(Boolean), subs: [v('.s0'), v('.s1')].filter(Boolean), subStyle: { size: v('.ss'), color: v('.sc'), bg: v('.sb') } } })
          .then(function () { toast('Salvat'); }, function (e) { toast(e.message); });
      };
    }
    function loadSrv() {
      Promise.all([q('/api/settings'), q('/api/storage').catch(function () { return {}; }), q('/api/health').catch(function () { return {}; })]).then(function (r) {
        var s = r[0], st = r[1], h = r[2];
        var pl = app.querySelector('#s-play');
        pl.innerHTML = '<div class="frm"><label>Calitate la redare<select class="q"><option value="auto">Automat</option><option value="original">Originală (fără conversie)</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></label>' +
          '<label>Calitate la descărcare<select class="dq"><option value="1080">1080p (fișiere mai mici)</option><option value="4k">4K / HDR când există (cea mai bună)</option></select></label></div>';
        var qs = pl.querySelector('.q'); qs.value = s.quality || 'auto';
        var dq = pl.querySelector('.dq'); dq.value = s.dlQuality || '1080';
        dq.onchange = function () { q('/api/settings', { method: 'PUT', body: { dlQuality: dq.value } }).then(function () { toast('Salvat'); }, function (e) { toast(e.message); }); };
        qs.onchange = function () { q('/api/settings', { method: 'PUT', body: { quality: qs.value } }).then(function () { toast('Salvat'); }, function (e) { toast(e.message); }); };
        var disk = st.media ? gb(st.media.used) + ' folosiți din ' + gb(st.media.total) + ' (' + gb(st.media.free) + ' liberi)' : '—';
        app.querySelector('#s-srv').innerHTML = 'NAS (media): ' + esc(disk) + '<br>Fișiere în bibliotecă: ' + esc(h.files != null ? h.files : '—') +
          '<br>FileList: ' + (s.filelist ? '✓ configurat' : '✗ lipsește') + ' · qBittorrent: ' + (s.qbittorrent ? '✓' : '✗') + ' · RSS: ' + (s.rss ? '✓' : '✗') +
          '<br>Trailere în cache: ' + esc(gb(st.trailers || 0) || '0 GB');
      }, function (e) { app.querySelector('#s-srv').textContent = e.message; });
    }
    function loadRem() {
      var box = app.querySelector('#s-rem'); if (!box) return;
      q('/api/remote').then(function (r) {
        var h = '';
        if (r.state === 'running' && r.url) {
          h = '<p>✓ Merge de oriunde, cu parola ta: <a href="' + esc(r.url) + '/web/" target="_blank" rel="noopener"><b>' + esc(r.url) + '/web/</b></a></p>' +
            '<p class="mut">Și https://ddflix.vercel.app folosește această adresă.</p>';
        } else if (r.state === 'needs-login') {
          h = '<p><b>Pasul 1 din 2:</b> conectează serverul la Tailscale (o singură dată, cu Google / Microsoft / GitHub).</p>' +
            (r.loginUrl ? '<a class="btn red" target="_blank" rel="noopener" href="' + esc(r.loginUrl) + '">Conectează Tailscale</a>' : '<p class="mut">Se pregătește linkul…</p>');
        } else if (r.state === 'needs-funnel') {
          h = '<p><b>Pasul 2 din 2:</b> pornește adresa publică (Funnel) în contul Tailscale.</p><a class="btn red" target="_blank" rel="noopener" href="' + esc(r.enableUrl) + '">Activează Funnel</a>';
        } else if (r.state === 'error') {
          h = '<p class="err">Eroare: ' + esc(r.detail || '') + '</p>';
        } else h = '<p class="mut">Pornește…</p>';
        box.innerHTML = h;
        if (r.state !== 'running' && location.hash.indexOf('#/settings') === 0) setTimeout(loadRem, 5000);
      }, function (e) { box.innerHTML = '<p class="mut">' + esc(e.message) + '</p>'; });
    }
    loadDev(); loadProf(); loadSrv(); loadRem();
  }

  // ---------- player
  var P = { el: document.getElementById('player'), v: document.getElementById('vid'), hls: null, st: null };
  function play(mid, name, start, audio) {
    q('/api/media/' + mid).then(function (m) {
      var st = P.st = { m: m, mid: mid, name: name, offset: 0, sid: null, audio: audio != null ? audio : (m.defaultAudio || 0), sub: m.defaultSub };
      document.getElementById('ptitle').textContent = name + (m.season != null ? ' · S' + m.season + ' E' + m.episode : '');
      var pa = document.getElementById('paudio');
      pa.innerHTML = (m.audio || []).map(function (a) { return '<option value="' + a.n + '"' + (a.n === st.audio ? ' selected' : '') + '>' + esc(a.label) + '</option>'; }).join('');
      subMenu();
      pa.onchange = function () { start_(curPos(), +pa.value); };
      document.getElementById('psub').onchange = function () { st.sub = this.value || null; st.manual = true; loadSub(true); saveSub(); };
      if (m.subsPending) watchSubs(st);
      document.getElementById('pdur').textContent = fmtT(m.duration);
      P.el.hidden = false;
      start_(start != null ? start : (m.position > 30 && !m.watched ? m.position - 3 : 0), st.audio);
    }, function (e) { toast(e.message); });
  }
  function curPos() { return P.st ? P.st.offset + (P.v.currentTime || 0) : 0; }
  function start_(at, audio) {
    var st = P.st; st.audio = audio;
    q('/api/play', { body: { mediaId: st.mid, start: at, audio: audio, web: true, replace: st.sid || undefined } }).then(function (d) {
      st.sid = d.sid; st.offset = d.offset || 0;
      if (P.hls) { P.hls.destroy(); P.hls = null; }
      var url = d.mode === 'direct' ? authUrl(d.url) : API + d.url;
      var v = P.v;
      var ua = navigator.userAgent, appleNative = /iPhone|iPad|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua));
      if (d.mode === 'direct' || (appleNative && v.canPlayType('application/vnd.apple.mpegurl')) || !(window.Hls && Hls.isSupported())) {
        v.src = url;
      } else {
        P.hls = new Hls({ maxBufferLength: 30 }); P.hls.loadSource(url); P.hls.attachMedia(v);
        P.hls.on(Hls.Events.ERROR, function (_, e) { if (e.fatal) toast(d.hevc ? 'Browserul nu suportă HEVC: încearcă Safari / iPhone / Edge' : 'Eroare la redare'); });
      }
      if (d.mode === 'direct' && at) v.currentTime = at;
      v.play().catch(function () { /* autoplay blocked: user taps play */ });
      loadSub();
    }, function (e) { toast(e.message); });
  }
  // ---- subtitles: the menu, loading with clear feedback (every switch says what happened), new ones arriving while you watch
  var SUBGEN = 0;
  function subLabel(k) { var s = ((P.st && P.st.m.subs) || []).filter(function (x) { return x.key === k; })[0]; return s ? s.label : 'subtitrare'; }
  function subMenu() {
    var st = P.st, ps = document.getElementById('psub');
    ps.innerHTML = '<option value="">Fără subtitrare</option>' + (st.m.subs || []).map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === st.sub ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
    ps.value = st.sub || '';
  }
  function saveSub() { var st = P.st; if (st) q('/api/progress', { body: { mediaId: st.mid, position: curPos(), duration: st.m.duration, sub: st.sub || '', subManual: true, audio: st.audio } }).catch(function () {}); }
  function watchSubs(st) {
    // the server is still preparing / downloading subtitles (Romanian, English): refresh the list, switch to the preferred one
    var n = 0;
    (function tick() {
      if (P.st !== st || P.el.hidden || ++n > 40) return;
      setTimeout(function () {
        if (P.st !== st || P.el.hidden) return;
        q('/api/media/' + st.mid).then(function (m) {
          var had = {}; (st.m.subs || []).forEach(function (s) { had[s.key] = 1; });
          var fresh = (m.subs || []).filter(function (s) { return !had[s.key]; });
          st.m.subs = m.subs || [];
          if (fresh.length) {
            if (!st.manual && m.prefSub && m.prefSub !== st.sub) { st.sub = m.prefSub; subMenu(); loadSub(true); }
            else { subMenu(); toast('Subtitrare nouă disponibilă: ' + fresh.map(function (s) { return s.label; }).join(', ')); }
          }
          if (m.subsPending) tick();
        }, function () { tick(); });
      }, 6000);
    })();
  }
  function loadSub(announce) {
    var v = P.v, st = P.st, gen = ++SUBGEN, key = st.sub, tries = 0;
    clearTimeout(st.subT);
    [].slice.call(v.querySelectorAll('track')).forEach(function (t) { t.parentNode.removeChild(t); });
    for (var i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'disabled';
    if (!key) { if (announce) toast('Subtitrare oprită'); return; }
    (function go() {
      fetch(authUrl('/api/media/' + st.mid + '/sub/' + key + '.vtt')).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (txt) {
        if (gen !== SUBGEN || P.st !== st) return;
        if (/^WEBVTT\s*$/.test(txt.trim())) {
          if (announce && !tries) toast('Se pregătește subtitrarea ' + subLabel(key) + '…');
          if (++tries < 60) st.subT = setTimeout(go, 3000); else toast('Subtitrarea ' + subLabel(key) + ' nu s-a putut pregăti');
          return;
        }
        showSub(st, txt);
        if (announce || tries) toast('Subtitrare: ' + subLabel(key));
      }).catch(function () { if (gen === SUBGEN && P.st === st) toast('Subtitrarea ' + subLabel(key) + ' nu s-a putut încărca'); });
    })();
  }
  function showSub(st, txt) {
    var v = P.v;
    var off = st.offset;
    txt = txt.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, function (_, h, m, s, ms) { var t = Math.max(0, +h * 3600 + +m * 60 + +s + ms / 1000 - off); var H = Math.floor(t / 3600), M = Math.floor(t / 60) % 60, S = t % 60; return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M + ':' + (S < 10 ? '0' : '') + S.toFixed(3); });
    var tr = document.createElement('track'); tr.kind = 'subtitles'; tr.default = true; tr.src = URL.createObjectURL(new Blob([txt], { type: 'text/vtt' }));
    v.appendChild(tr); tr.track.mode = 'showing'; setTimeout(function () { if (tr.parentNode) tr.track.mode = 'showing'; }, 50);
  }
  var scrub = document.getElementById('pscrub'), dragging = false, SMAX = 1000;
  function seekTo(t) { var st = P.st; if (!st) return; if (st.sid) start_(t, st.audio); else P.v.currentTime = t; }
  // trickplay: thumbnail above the scrubber (sheet = cols x rows frames, one every `interval` s)
  var thumb = document.getElementById('pthumb');
  function showThumb(t, frac) {
    var st = P.st, tp = st && st.m.trickplay;
    thumb.querySelector('span').textContent = fmtT(t);
    var ti = thumb.querySelector('.pti');
    if (tp) {
      var per = tp.cols * tp.rows, i = Math.floor(t / tp.interval), n = Math.min(tp.sheets, Math.floor(i / per) + 1), k = i % per;
      ti.style.display = 'block'; ti.style.width = tp.w + 'px'; ti.style.height = tp.h + 'px';
      ti.style.backgroundImage = 'url("' + authUrl(tp.url + n + '.jpg' + (PROF && PROF.header ? '?p=' + encodeURIComponent(PROF.header) : '')) + '")';
      ti.style.backgroundPosition = (-(k % tp.cols) * tp.w) + 'px ' + (-Math.floor(k / tp.cols) * tp.h) + 'px';
    } else ti.style.display = 'none';
    thumb.hidden = false;
    var w = scrub.getBoundingClientRect().width, tw = thumb.offsetWidth || 160;
    thumb.style.left = Math.max(0, Math.min(w - tw, frac * w - tw / 2)) + 'px';
  }
  scrub.addEventListener('mousemove', function (e) {
    if (!P.st) return; var r = scrub.getBoundingClientRect(), fr = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    showThumb(fr * P.st.m.duration, fr);
  });
  scrub.addEventListener('mouseleave', function () { if (!dragging) thumb.hidden = true; });
  P.v.addEventListener('timeupdate', function () {
    if (!P.st) return; var pos = curPos(), dur = P.st.m.duration || 1;
    document.getElementById('pcur').textContent = fmtT(pos);
    if (!dragging) scrub.value = Math.round(pos / dur * SMAX);
    markersUi(pos, dur);
  });
  scrub.addEventListener('input', function () {
    dragging = true; var fr = scrub.value / SMAX, t = fr * P.st.m.duration;
    document.getElementById('pcur').textContent = fmtT(t); showThumb(t, fr);
  });
  scrub.addEventListener('change', function () { dragging = false; thumb.hidden = true; seekTo(scrub.value / SMAX * P.st.m.duration); });

  // skip intro / skip credits / next episode (same rules as the TV app: chapters or audio fingerprints from the server)
  var skipB = document.getElementById('pskip'), nextC = document.getElementById('pnext');
  function sane(mk, dur) {
    mk = mk || {}; var o = { intro: null, credits: null }, i = mk.intro, c = mk.credits;
    if (i && i.end != null && i.end - i.start >= 10 && i.end - i.start <= 300 && i.start < 900 && (i.conf == null || i.conf >= 0.5)) o.intro = i;
    if (c && c.start != null && (!dur || c.start > 0.5 * dur) && (c.conf == null || c.conf >= 0.5)) o.credits = c;
    return o;
  }
  function markersUi(t, dur) {
    var st = P.st, mk = sane(st.m.markers, dur), next = st.m.nextMedia;
    var inIntro = mk.intro && t >= mk.intro.start && t < mk.intro.end - 2;
    var inCred = mk.credits && t >= mk.credits.start && (mk.credits.end == null || t < mk.credits.end);
    var left = dur - t;
    if (inIntro) { skipB.hidden = false; skipB.textContent = 'Sari peste intro'; skipB.onclick = function () { seekTo(mk.intro.end); skipB.hidden = true; }; }
    else if (inCred && !next && mk.credits.end != null && dur - mk.credits.end > 20) { skipB.hidden = false; skipB.textContent = 'Sari peste generic'; skipB.onclick = function () { seekTo(mk.credits.end); }; }
    else skipB.hidden = true;
    var showNext = next && !st.nextDismissed && (inCred || left <= 20 || (!mk.credits && left <= 120 && left > 20 && 'pill'));
    if (showNext) {
      if (nextC.hidden) {
        nextC.hidden = false;
        nextC.querySelector('.pn-t').textContent = (next.name || 'Episodul următor');
        st.nextAt = Date.now() + 7000;
        nextC.classList.toggle('pill', showNext === 'pill');
      }
      var f = nextC.querySelector('.pn-f');
      if (showNext !== 'pill') {
        var p = Math.min(1, 1 - (st.nextAt - Date.now()) / 7000); f.style.width = Math.round(p * 100) + '%';
        if (p >= 1 && !P.v.paused) playNext();
      } else f.style.width = '0';
    } else nextC.hidden = true;
  }
  function playNext() {
    var st = P.st; if (!st || !st.m.nextMedia) return;
    var nx = st.m.nextMedia, name = st.name;
    q('/api/progress', { body: { mediaId: st.mid, position: st.m.duration, duration: st.m.duration, watched: true, credits: true } }).catch(function () {});
    if (st.sid) q('/api/play/' + st.sid, { method: 'DELETE' }).catch(function () {});
    if (P.hls) { P.hls.destroy(); P.hls = null; }
    nextC.hidden = true; skipB.hidden = true;
    play(nx.id, name, 0);
  }
  document.getElementById('pnext-go').onclick = playNext;
  document.getElementById('pnext-x').onclick = function () { if (P.st) P.st.nextDismissed = true; nextC.hidden = true; };
  setInterval(function () {
    if (P.st && !P.el.hidden && !P.v.paused) q('/api/progress', { body: { mediaId: P.st.mid, position: curPos(), duration: P.st.m.duration, sub: P.st.sub || null, subManual: !!P.st.manual, audio: P.st.audio } }).catch(function () {});
  }, 10000);
  document.getElementById('pclose').onclick = function () {
    var st = P.st; if (!st) return;
    q('/api/progress', { body: { mediaId: st.mid, position: curPos(), duration: st.m.duration, sub: st.sub || null, subManual: !!st.manual } }).catch(function () {});
    if (st.sid) q('/api/play/' + st.sid, { method: 'DELETE' }).catch(function () {});
    if (P.hls) { P.hls.destroy(); P.hls = null; }
    P.v.pause(); P.v.removeAttribute('src'); P.v.load(); P.el.hidden = true; P.st = null; skipB.hidden = true; nextC.hidden = true; thumb.hidden = true; route();
  };

  function fail(e) { app.innerHTML = '<p class="pad err">' + esc(e.message) + '</p>'; }
  function route() {
    var h = location.hash.replace(/^#\/?/, ''), parts = h.split('/');
    [].forEach.call(document.querySelectorAll('nav a'), function (a) { var k = a.getAttribute('href').replace('#/', ''); a.className = (k === parts[0].split('?')[0] || (!k && !parts[0])) ? 'on' : ''; });
    document.getElementById('top').hidden = !TOKEN;
    var pc = /[?&]code=([A-Za-z0-9-]+)/.exec(h); if (pc) LS.set('dd_paircode', pc[1]);  // before the login: it must survive it
    if (!TOKEN || !API) return loginView(!API ? 'Lipsește adresa serverului' : '');
    if (!PROF || parts[0] === 'profiles') return profilesView(false);
    if (LS.get('dd_paircode') && parts[0].split('?')[0] !== 'settings') { var c0 = LS.get('dd_paircode'); location.hash = '#/settings?code=' + c0; return; }
    var me = document.getElementById('me'); me.innerHTML = avatar(PROF); me.title = PROF.name + ' · schimbă profilul';
    document.getElementById('dl-tab').hidden = PROF.kind === 'kids';
    document.getElementById('set-tab').hidden = PROF.kind === 'kids';
    document.body.classList.toggle('kids', PROF.kind === 'kids');
    if (!DL.t) dlPoll();
    window.scrollTo(0, 0);
    if (parts[0] === 'search') return search(decodeURIComponent(parts[1] || ''));
    if (parts[0] === 't') return title(decodeURIComponent(parts[1]));
    if (parts[0] === 'downloads') return downloads();
    if (parts[0] === 'mylist') return mylist();
    if (parts[0].split('?')[0] === 'library') return library((/type=(series|movie)/.exec(h) || [])[1] || '');
    if (parts[0].split('?')[0] === 'settings' || parts[0].split('?')[0] === 'pair') return settingsView((/[?&]code=([A-Za-z0-9-]+)/.exec(h) || [])[1] || '');
    if (parts[0] === 'series' || parts[0] === 'movies') {
      var ty = parts[0] === 'series' ? 'series' : 'movie', rest = (parts[1] || '').split('?'), so = /sort=(\w+)/.exec(h);
      if (rest[0]) return genreView(ty, decodeURIComponent(rest[0]), so && so[1]);
      return home(ty);
    }
    home();
  }
  window.addEventListener('hashchange', route);
  route();
})();
