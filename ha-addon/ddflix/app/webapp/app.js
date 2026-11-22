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
  var API = SAME ? location.origin : (LS.get('dd_api') || window.DDFLIX_API || '').replace(/\/$/, '');
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
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && path !== '/api/web/login') { logout(); throw new Error('Sesiune expirată'); }
          if (r.status === 403 && /profile locked/.test(d.error || '')) { setProf(null); route(); throw new Error('Alege profilul din nou'); }
          if (!r.ok) throw new Error(d.error || ('Eroare ' + r.status));
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
          q('/api/profiles/' + p.id + '/select', { body: { pin: pin || undefined } }).then(function (r) {
            setProf({ id: p.id, name: p.name, kind: p.kind, avatar: p.avatar, header: r.ticket ? p.id + '.' + r.ticket : String(p.id) });
            location.hash = '#/'; route();
          }, function (e) { toast(e.message === 'wrong PIN' ? 'PIN greșit' : e.message); });
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
      (c.inLibrary ? '<span class="nas">NAS</span>' : '') + score(c.rating) +
      (pct ? '<div class="bar"><i style="width:' + Math.round(pct * 100) + '%"></i></div>' : '') + '</div>' +
      '<div class="t">' + esc(c.name) + (c.year ? ' · ' + c.year : '') + '</div>' + (c.rank ? '</div>' : '');
    if (c.rank) a.className += ' rkc';
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
    app.innerHTML = '<form class="login"><h1>DDFLIX</h1><input type="password" name="pw" placeholder="Parola" autocomplete="current-password" required>' +
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
  var GRO = { Action: 'Acțiune', Adventure: 'Aventură', Animation: 'Animație', Biography: 'Biografic', Comedy: 'Comedie', Crime: 'Crimă', Documentary: 'Documentar', Drama: 'Dramă', Family: 'Familie', Fantasy: 'Fantasy', History: 'Istoric', Horror: 'Horror', Mystery: 'Mister', 'Reality-TV': 'Reality', Romance: 'Romantic', 'Sci-Fi': 'SF', Sport: 'Sport', Thriller: 'Thriller', War: 'Război', Western: 'Western' };
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
    Promise.all([q('/api/home' + (type ? '?type=' + type : '')), q('/api/continue').catch(function () { return { items: [] }; }), q('/api/mylist').catch(function () { return { items: [] }; })]).then(function (r) {
      app.innerHTML = '';
      var hs = r[0].hero || [], h = hs[Math.floor(Math.random() * Math.min(3, hs.length))];
      if (type) app.appendChild(typeHead(type));
      if (h) {
        var d = document.createElement('section'); d.className = 'hero'; d.style.backgroundImage = 'url("' + img('backdrop', h.imdb, 1280) + '")';
        d.innerHTML = '<div class="in"><h1>' + esc(h.name) + '</h1><div class="mut">' + [h.year, (h.genres || []).slice(0, 3).map(function (g) { return GRO[g] || g; }).join(', ')].filter(Boolean).map(esc).join(' · ') + ' ' + score(h.rating) + '</div><p>' + esc(h.description) + '</p><a class="btn" href="#/t/' + encodeURIComponent(h.imdb) + '">ⓘ Detalii</a></div>';
        app.appendChild(d);
      }
      var keep = function (items) { return type ? (items || []).filter(function (c) { return c.type === type; }) : items; };
      [row('Continuă', keep(r[1].items)), row('Lista mea', keep(r[2].items))].concat((r[0].rows || []).map(function (x) { return row(x.title, x.items, x.link); }))
        .forEach(function (s) { if (s) app.appendChild(s); });
      if (!app.children.length) app.innerHTML = '<p class="pad mut">Nimic de arătat încă.</p>';
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
      var hero = document.createElement('section'); hero.className = 'hero'; if (t.backdrop) hero.style.backgroundImage = 'url("' + img('backdrop', imdb, 1280) + '")';
      var tags = (t.labels || []).map(function (l) { return '<span class="tag">' + esc(l) + '</span>'; }).join('');
      hero.innerHTML = '<div class="in"><h1>' + esc(t.name) + '</h1><div class="mut">' + [t.year, (t.genres || []).map(function (g) { return GRO[g] || g; }).join(', ')].filter(Boolean).map(esc).join(' · ') + ' ' + score(t.rating) + ' ' + tags + (t.imdbUrl ? ' <a class="mut" target="_blank" rel="noopener" href="' + esc(t.imdbUrl) + '">IMDb ↗</a>' : '') + '</div>' +
        '<p>' + esc(t.description) + '</p><div class="acts"></div></div>';
      app.appendChild(hero);
      var acts = hero.querySelector('.acts');
      if (p.next) { var b = document.createElement('button'); b.className = 'btn'; b.textContent = '▶ ' + (p.next.action || 'Redă'); b.onclick = function () { play(p.next.id, t.name); }; acts.appendChild(b); }
      var ml = document.createElement('button'); ml.className = 'btn sec'; ml.textContent = '+ Lista mea'; ml.onclick = function () { q('/api/mylist/' + encodeURIComponent(imdb), { method: 'POST', body: {} }).then(function () { toast('Adăugat în Lista mea'); }); }; acts.appendChild(ml);
      if (t.type === 'movie' && !files.length) acts.appendChild(dlBtn('⬇ Descarcă', { imdb: imdb }));
      (t.downloads || []).forEach(function (d) { if (d.state !== 'done') { var s = document.createElement('div'); s.className = 'mut'; s.innerHTML = '⬇ ' + esc(d.name) + ' — ' + Math.round(d.progress * 100) + '%<div class="prog"><i style="width:' + Math.round(d.progress * 100) + '%"></i></div>'; hero.querySelector('.in').appendChild(s); } });

      if (t.type === 'series' && t.seasons && t.seasons.length) {
        var tabs = document.createElement('div'); tabs.className = 'tabs'; app.appendChild(tabs);
        var box = document.createElement('div'); app.appendChild(box);
        var seasons = t.seasons.filter(function (s) { return s.season > 0; });
        var cur = (p.next && p.next.season) || (seasons.filter(function (s) { return s.available; })[0] || seasons[seasons.length - 1] || {}).season;
        var draw = function () {
          tabs.innerHTML = ''; box.innerHTML = '';
          seasons.forEach(function (s) { var b = document.createElement('button'); b.textContent = 'Sezonul ' + s.season + (s.available ? ' · ' + s.available + '/' + s.episodes.length : ''); b.className = s.season === cur ? 'on' : ''; b.onclick = function () { cur = s.season; draw(); }; tabs.appendChild(b); });
          var se = seasons.filter(function (s) { return s.season === cur; })[0]; if (!se) return;
          if (se.available < se.episodes.length) { var pk = document.createElement('div'); pk.className = 'pad'; pk.appendChild(dlBtn('⬇ Descarcă tot sezonul ' + se.season, { imdb: imdb, season: se.season }, !se.packs.length)); box.appendChild(pk); }
          se.episodes.forEach(function (e) {
            var f = byEp[se.season + ':' + e.episode], d = document.createElement('div'); d.className = 'ep';
            d.innerHTML = (e.thumb ? '<img loading="lazy" alt="" src="' + img('episode', imdb, 320).replace('/img/episode/' + encodeURIComponent(imdb), '/img/episode/' + encodeURIComponent(imdb) + '/' + se.season + '/' + e.episode) + '">' : '<div class="ph"></div>') +
              '<div class="b"><h4>' + e.episode + '. ' + esc(e.name) + ' ' + score(e.rating) + '</h4><p>' + esc(e.overview) + '</p><div class="a"></div></div>';
            var a = d.querySelector('.a');
            if (f) { var b = document.createElement('button'); b.className = 'btn sm'; b.textContent = '▶ ' + (f.position > 30 && !f.watched ? 'Reia' : 'Redă'); b.onclick = function () { play(f.id, t.name); }; a.appendChild(b); }
            else if (e.download) a.innerHTML = '<span class="mut">⬇ ' + Math.round(e.download.progress * 100) + '%</span>';
            else if (e.versions && e.versions.length) a.appendChild(dlBtn('⬇ Descarcă', { imdb: imdb, release_id: e.versions[0] }, false, true));
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
    }, fail);
  }
  function dlBtn(label, body, disabled, small) {
    var b = document.createElement('button'); b.className = 'btn red' + (small ? ' sm' : ''); b.textContent = label; b.disabled = !!disabled;
    if (disabled) b.title = 'Nu există pachet de sezon; descarcă episoadele';
    b.onclick = function () {
      b.disabled = true; b.textContent = '…';
      q('/api/tv/download', { body: body }).then(function (d) { b.textContent = '✓ Pornit'; toast('Descarc: ' + d.release.name); }, function (e) { b.disabled = false; b.textContent = label; toast(e.message); });
    };
    return b;
  }

  function downloads() {
    app.innerHTML = '<div class="pad"><h2 style="margin:0">Descărcări</h2></div><div class="list"></div>';
    var list = app.querySelector('.list');
    var tick = function () {
      if (!location.hash.startsWith('#/downloads')) return;
      q('/api/downloads').then(function (d) {
        list.innerHTML = d.items.length ? '' : '<p class="pad mut">Nimic în descărcare.</p>';
        d.items.forEach(function (x) {
          var e = document.createElement('div'); e.className = 'rel';
          e.innerHTML = '<div style="flex:1"><div class="n">' + esc(x.name) + '</div><div class="m">' + esc(x.state) + ' · ' + Math.round(x.progress * 100) + '% · ' + gb(x.size) + (x.speed ? ' · ' + (x.speed / 1048576).toFixed(1) + ' MB/s' : '') + '</div><div class="prog"><i style="width:' + Math.round(x.progress * 100) + '%"></i></div></div>';
          if (x.imdb) e.onclick = function () { location.hash = '#/t/' + encodeURIComponent(x.imdb); };
          list.appendChild(e);
        });
        setTimeout(tick, 4000);
      }, fail);
    };
    tick();
  }

  // ---------- player
  var P = { el: document.getElementById('player'), v: document.getElementById('vid'), hls: null, st: null };
  function play(mid, name, start, audio) {
    q('/api/media/' + mid).then(function (m) {
      var st = P.st = { m: m, mid: mid, name: name, offset: 0, sid: null, audio: audio != null ? audio : (m.defaultAudio || 0), sub: m.defaultSub };
      document.getElementById('ptitle').textContent = name + (m.season != null ? ' · S' + m.season + ' E' + m.episode : '');
      var pa = document.getElementById('paudio'), ps = document.getElementById('psub');
      pa.innerHTML = (m.audio || []).map(function (a) { return '<option value="' + a.n + '"' + (a.n === st.audio ? ' selected' : '') + '>' + esc(a.label) + '</option>'; }).join('');
      ps.innerHTML = '<option value="">Fără subtitrare</option>' + (m.subs || []).map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === st.sub ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
      pa.onchange = function () { start_(curPos(), +pa.value); };
      ps.onchange = function () { st.sub = ps.value || null; loadSub(); };
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
  function loadSub() {
    var v = P.v, st = P.st;
    [].slice.call(v.querySelectorAll('track')).forEach(function (t) { t.parentNode.removeChild(t); });
    if (!st.sub) return;
    fetch(authUrl('/api/media/' + st.mid + '/sub/' + st.sub + '.vtt')).then(function (r) { return r.text(); }).then(function (txt) {
      if (/^WEBVTT\s*$/.test(txt.trim())) { setTimeout(loadSub, 8000); return; }
      var off = st.offset;
      txt = txt.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, function (_, h, m, s, ms) { var t = Math.max(0, +h * 3600 + +m * 60 + +s + ms / 1000 - off); var H = Math.floor(t / 3600), M = Math.floor(t / 60) % 60, S = t % 60; return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M + ':' + (S < 10 ? '0' : '') + S.toFixed(3); });
      var tr = document.createElement('track'); tr.kind = 'subtitles'; tr.default = true; tr.src = URL.createObjectURL(new Blob([txt], { type: 'text/vtt' }));
      v.appendChild(tr); setTimeout(function () { if (v.textTracks[0]) v.textTracks[0].mode = 'showing'; }, 50);
    });
  }
  var scrub = document.getElementById('pscrub'), dragging = false;
  P.v.addEventListener('timeupdate', function () {
    if (!P.st) return; var pos = curPos(), dur = P.st.m.duration || 1;
    document.getElementById('pcur').textContent = fmtT(pos);
    if (!dragging) scrub.value = Math.round(pos / dur * 100);
  });
  scrub.addEventListener('input', function () { dragging = true; document.getElementById('pcur').textContent = fmtT(scrub.value / 100 * P.st.m.duration); });
  scrub.addEventListener('change', function () { dragging = false; var t = scrub.value / 100 * P.st.m.duration; if (P.st.sid) start_(t, P.st.audio); else P.v.currentTime = t; });
  setInterval(function () {
    if (P.st && !P.el.hidden && !P.v.paused) q('/api/progress', { body: { mediaId: P.st.mid, position: curPos(), duration: P.st.m.duration, sub: P.st.sub || null, audio: P.st.audio } }).catch(function () {});
  }, 10000);
  document.getElementById('pclose').onclick = function () {
    var st = P.st; if (!st) return;
    q('/api/progress', { body: { mediaId: st.mid, position: curPos(), duration: st.m.duration, sub: st.sub || null } }).catch(function () {});
    if (st.sid) q('/api/play/' + st.sid, { method: 'DELETE' }).catch(function () {});
    if (P.hls) { P.hls.destroy(); P.hls = null; }
    P.v.pause(); P.v.removeAttribute('src'); P.v.load(); P.el.hidden = true; P.st = null; route();
  };

  function fail(e) { app.innerHTML = '<p class="pad err">' + esc(e.message) + '</p>'; }
  function route() {
    var h = location.hash.replace(/^#\/?/, ''), parts = h.split('/');
    [].forEach.call(document.querySelectorAll('nav a'), function (a) { var k = a.getAttribute('href').replace('#/', ''); a.className = (k === parts[0].split('?')[0] || (!k && !parts[0])) ? 'on' : ''; });
    document.getElementById('top').hidden = !TOKEN;
    if (!TOKEN || !API) return loginView(!API ? 'Lipsește adresa serverului' : '');
    if (!PROF || parts[0] === 'profiles') return profilesView(false);
    var me = document.getElementById('me'); me.innerHTML = avatar(PROF); me.title = PROF.name + ' · schimbă profilul';
    document.getElementById('dl-tab').hidden = PROF.kind === 'kids';
    document.body.classList.toggle('kids', PROF.kind === 'kids');
    window.scrollTo(0, 0);
    if (parts[0] === 'search') return search(decodeURIComponent(parts[1] || ''));
    if (parts[0] === 't') return title(decodeURIComponent(parts[1]));
    if (parts[0] === 'downloads') return downloads();
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
