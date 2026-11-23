/* Home (PLAN §4.5 + §10.1/10.3/10.4): rail, hero card, category tiles, rows with a fixed-left 16:9 focus tile. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api, RW = BF.rowwin, G = RW.G;
  var PLAY = '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M7 4l13 8-13 8z"/></svg>';
  var synCache = {}, synOrder = [];
  function synopsis(imdb) {
    if (synCache[imdb]) return Promise.resolve(synCache[imdb]);
    return A.title(imdb).then(function (t) {
      synCache[imdb] = t; synOrder.push(imdb);
      if (synOrder.length > 40) delete synCache[synOrder.shift()];
      return t;
    });
  }
  BF.titleCache = synopsis;
  synopsis.clear = function () { synCache = {}; synOrder = []; };
  function descOf(t) { return (BF.i18n.lang() === 'ro' && t.descriptionRo) || t.description || t.descriptionEn || ''; }
  BF.descOf = descOf;
  function nameOf(t) { return (BF.i18n.lang() === 'ro' && t.nameRo) || t.name; }
  BF.nameOf = nameOf;

  BF.router.register('home', function () {
    var U = BF.util, sec, params, rail, scroll, heroEl, tilesEl, rowsEl, metaEl, stateEl;
    var rows = [], tiles = [], hero = [], heroIdx = 0, heroBtn = 0, heroT = null, tileIdx = 0;
    var m = { zone: 'hero', row: 0, col: [] }, rowEls = {}, metaT = null, tileT = null, ready = false, inRail = false, t0 = Date.now();
    var heroBtns = [];

    function addRow(key, title, items) { if (items && items.length) rows.push({ key: key, title: title, items: items.slice(0, 30) }); }
    function chunk(key, title, items, cap) {
      for (var i = 0; i < items.length && rows.length < (cap || 10); i += 6) rows.push({ key: key + i, title: i === 0 ? title : '', items: items.slice(i, i + 6), grid: true });
    }
    function load() {
      var p = params;
      if (p.mode === 'mylist') {
        return BF.loadMylist().then(function (d) { chunk('mylist', BF.t('row.mylist'), d.items || []); });
      }
      if (p.browse && p.library) { // whole on-server library, newest first, paged (48 per page, up to 5 pages)
        var all = [];
        var page = function (n) { return A.browse(p.browse + '&page=' + n).then(function (d) { all = all.concat(d.items || []); return d.more && n < 5 ? page(n + 1) : null; }); };
        return page(1).then(function () { chunk('lib', '', all, 40); });
      }
      if (p.browse) {
        return A.browse(p.browse).then(function (d) { chunk('browse', p.title, d.items || []); });
      }
      var q = p.type ? '?type=' + p.type : '';
      return Promise.all([
        p.type ? Promise.resolve({ items: [] }) : A.cont().catch(function () { return { items: [] }; }),
        p.type ? Promise.resolve({ items: [] }) : BF.loadMylist().catch(function () { return { items: [] }; }),
        p.type ? Promise.resolve({ items: [] }) : A.recent().catch(function () { return { items: [] }; }),
        A.home(q)
      ]).then(function (r) {
        hero = (r[3].hero || []).slice(0, 6);
        if (!p.type) try { localStorage.setItem('bf_show_' + A.profileId(), JSON.stringify((r[3].hero || []).concat(((r[3].rows || [])[0] || {}).items || []).slice(0, 20).map(function (x) { return { imdb: x.imdb, name: x.name, nameRo: x.nameRo, genres: x.genres, year: x.year, logo: x.logo, backdrop: x.backdrop, new: x.new, certAge: x.certAge }; }))); } catch (e) { /* */ }
        BF.state.progress = {}; (r[0].items || []).forEach(function (x) { if (x.play && x.play.pct > 0 && x.play.pct < 0.97) BF.state.progress[x.imdb] = x.play.pct; });
        addRow('cont', BF.t('row.cont'), r[0].items);
        var sp = RW.splitRo(r[3].rows, !!(BF.state.profile && BF.state.profile.kind === 'kids'));
        if (sp.ro) addRow(sp.ro.key, BF.i18n.rowTitle(sp.ro), sp.ro.items);
        addRow('mylist', BF.t('row.mylist'), r[1].items);
        addRow('recent', BF.t('row.recent'), r[2].items);
        tiles = [{ label: BF.t('home.essentials'), q: '?sort=added' + (p.type ? '&type=' + p.type : '') }];
        sp.rest.forEach(function (row) {
          var k = row.key || '';
          if (k.indexOf('g:') === 0) tiles.push({ label: BF.i18n.genre(k.slice(2)), q: '?genre=' + encodeURIComponent(k.slice(2)) + '&sort=week' + (p.type ? '&type=' + p.type : '') });
          if (rows.length < 45) addRow(k, BF.i18n.rowTitle(row), row.items);  // genres: tile on top AND a full row
        });
        if (tiles.length < 3) ['Animation', 'Family', 'Comedy', 'Adventure', 'Action', 'Drama', 'Documentary', 'Fantasy'].forEach(function (g) {
          tiles.push({ label: BF.i18n.genre(g), q: '?genre=' + encodeURIComponent(g) + '&sort=week' + (p.type ? '&type=' + p.type : '') });
        });
        if (hero[0] && BF.state.profile) { try { localStorage.setItem('bf_promo_' + BF.state.profile.id, hero[0].imdb); } catch (e) { /* */ } }
      });
    }

    // ---------- hero
    function buildHero() {
      heroEl = U.el('div', 'hero'); scroll.appendChild(heroEl);
      heroEl.appendChild(U.el('img', 'art hero-bg'));
      heroEl.appendChild(U.el('div', 'hero-scrim'));
      var c = U.el('div', 'hero-c');
      c.appendChild(U.el('div', 'hero-logo'));
      c.appendChild(U.txt('div', 'hero-meta', ''));
      c.appendChild(U.txt('div', 'hero-syn', ''));
      heroEl.appendChild(c);
      var b = U.el('div', 'hero-btns');
      var b1 = U.el('div', 'btn btn--pri'); var b2 = U.txt('div', 'btn', BF.t('home.more'));
      b.appendChild(b1); b.appendChild(b2); heroEl.appendChild(b); heroBtns = [b1, b2];
      heroEl.appendChild(U.el('div', 'hero-chips'));
    }
    function paintHero() {
      var h = hero[heroIdx]; if (!h) { heroEl.style.display = 'none'; return; }
      var bg = U.qs('.hero-bg', heroEl);
      BF.images.load(bg, A.img('background', h.imdb, 1280), 1);
      var lg = U.qs('.hero-logo', heroEl); U.empty(lg);
      if (h.logo) {
        var li = U.el('img', 'art'); lg.appendChild(li);
        BF.images.load(li, A.img('logo', h.imdb, 500), 1, function () { lg.textContent = ''; lg.appendChild(U.txt('div', 'hero-name', nameOf(h))); });
      } else lg.appendChild(U.txt('div', 'hero-name', nameOf(h)));
      U.qs('.hero-meta', heroEl).textContent = BF.card.metaLine(h, { runtime: h.runtime, seasons: h.seasons });
      U.qs('.hero-syn', heroEl).textContent = descOf(h);
      heroBtns[0].innerHTML = '<span class="gl">' + PLAY + '</span>' + U.esc(BF.t('home.play'));
      heroBtns[0].style.display = h.inPlex ? '' : 'none';
      var ch = U.qs('.hero-chips', heroEl); ch.textContent = '';
      BF.card.chips(h, 3).forEach(function (c) { ch.appendChild(U.txt('span', 'pill' + (c[1] ? ' pill--acc' : ''), c[0])); });
      if (!h.inPlex && heroBtn === 0) heroBtn = 1;
      if (m.zone === 'hero') warmTrailer(h);
    }
    function rotate() {
      clearTimeout(heroT);
      heroT = setTimeout(function () {
        if (m.zone === 'hero' && !inRail && hero.length > 1 && !(BF.player && BF.player.isOpen())) {
          heroEl.classList.add('fade');
          setTimeout(function () { heroIdx = (heroIdx + 1) % hero.length; paintHero(); paintFocus(); heroEl.classList.remove('fade'); }, 400);
        }
        rotate();
      }, 9000);
    }
    // ---------- tiles
    function buildTiles() {
      tilesEl = U.el('div', 'tiles'); scroll.appendChild(tilesEl);
      var strip = U.el('div', 'tiles-strip'); tilesEl.appendChild(strip);
      tiles.forEach(function (t) { strip.appendChild(U.txt('div', 'tile', t.label)); });
    }
    // ---------- rows
    function rowEl(i) {
      if (rowEls[i]) return rowEls[i];
      var r = U.el('div', 'row' + (rows[i].key === 'cont' ? ' row--cont' : ''));
      r.appendChild(U.txt('div', 'row-t', rows[i].title));
      r.appendChild(U.el('div', 'row-band'));
      r._nodes = {};
      rowsEl.appendChild(r); rowEls[i] = r;
      return r;
    }
    function posterNode(r, item) {
      var k = 'p' + item.imdb;
      if (!r._nodes[k]) r._nodes[k] = BF.card.poster(item);
      return r._nodes[k];
    }
    // every poster has its own fixed slot (index * step): focus only scales it up over its neighbours, nothing reflows;
    // moving left/right slides the whole band (one composited transform)
    function place(nd, on) {
      if (nd._on === on && nd._px === nd._x) return;
      nd._on = on; nd._px = nd._x;
      nd.classList.toggle('foc', on);
      nd.style.transform = 'translateX(' + nd._x + 'px)' + (on ? ' scale(' + G.focScale + ')' : '');
    }
    function renderRow(i, dir) {
      var row = rows[i], r = rowEl(i), band = r.children[1], focused = m.zone === 'rows' && m.row === i;
      var col = m.col[i] || 0, keep = {};
      RW.windowCols(col, row.items.length).forEach(function (j) {
        var it = row.items[j], nd = posterNode(r, it);
        keep['p' + it.imdb] = 1;
        nd._x = j * G.step;
        nd.classList.toggle('gone', j < col);
        place(nd, focused && !inRail && j === col);
        if (nd.parentNode !== band) band.appendChild(nd);
      });
      // recycle: drop nodes outside the window (release their images)
      Object.keys(r._nodes).forEach(function (k) { if (!keep[k]) { BF.images.release(r._nodes[k]); if (r._nodes[k].parentNode) r._nodes[k].parentNode.removeChild(r._nodes[k]); delete r._nodes[k]; } });
      band.classList.toggle('anim', !!dir);
      band.style.transform = 'translateX(' + (-col * G.step) + 'px)';
      r.classList.toggle('row--f', focused);
      r.classList.toggle('row--more', col > 0);
      if (focused) warmTrailer(row.items[col]);
    }
    var warmT = null;
    function warmTrailer(it) { clearTimeout(warmT); if (!it || it.trailer === null || it.trailer === false) return; warmT = setTimeout(function () { A.trailerPrefetch(it.imdb); }, 600); }
    function unmountRow(i) {
      var r = rowEls[i]; if (!r) return;
      BF.images.release(r); r.parentNode.removeChild(r); delete rowEls[i];
    }
    function paintMeta() {
      clearTimeout(metaT);
      if (m.zone !== 'rows') { metaEl.style.opacity = 0; return; }
      var row = rows[m.row], it = row.items[m.col[m.row] || 0], L = RW.layout(m, rows.length);
      metaEl.style.transform = 'translateY(' + (L.ys[m.row] + G.title + G.band + 30) + 'px)';  // below the scaled-up poster + ring
      metaEl.style.opacity = 1;
      var l1 = metaEl.children[0], l2 = metaEl.children[1], ch = metaEl.children[2];
      ch.textContent = ''; l2.textContent = ''; l2.classList.remove('is-in');
      if (row.key === 'cont' && it.play) {
        var pl = it.play;
        l1.textContent = pl.season ? BF.t('meta.ep', { s: pl.season, e: pl.episode }) : it.name;
        l2.textContent = pl.position > 30 ? BF.t('meta.resumeL') : (pl.season ? BF.t('meta.nextep') : BF.t('meta.play'));
        l2.className = 'meta-l2 strong is-in';
        if (pl.season) metaT = setTimeout(function () {
          synopsis(it.imdb).then(function (t) {
            var s = (t.seasons || []).filter(function (x) { return x.season === pl.season; })[0];
            var e = s && (s.episodes || []).filter(function (x) { return x.episode === pl.episode; })[0];
            if (e && e.name && rows[m.row] === row && row.items[m.col[m.row] || 0] === it) l1.textContent = BF.t('meta.ep', { s: pl.season, e: pl.episode }) + '  •  ' + e.name;
          }, function () {});
        }, 400);
        return;
      }
      l2.className = 'meta-l2';
      l1.textContent = it.name + '   ·   ' + BF.card.metaLine(it);
      BF.card.infoChips(it).forEach(function (c) { ch.appendChild(U.txt('span', 'ichip', c)); });
      if (it.downloading) ch.appendChild(U.txt('span', 'ichip', BF.t('meta.dl', { p: Math.round(it.progress || 0) })));
      metaT = setTimeout(function () {
        synopsis(it.imdb).then(function (t) {
          if (rows[m.row] !== row || row.items[m.col[m.row] || 0] !== it) return;
          var extra = BF.card.metaLine(it, { runtime: t.runtime, seasons: t.seasons ? t.seasons.length : 0 });
          l1.textContent = it.name + '   ·   ' + extra;
          l2.textContent = descOf(t); l2.classList.add('is-in');
        }, function () {});
      }, 400);
    }
    // ---------- layout / focus
    var mounted = {}, layRaf = 0;
    var metaDT = null;
    function layout(dir, vert) {
      var L = RW.layout(m, rows.length), vis = RW.visibleRows(m, rows.length), want = {};
      vis.forEach(function (i) { want[i] = 1; });
      var keepA = m.zone === 'rows' ? m.row - 3 : -1, keepB = m.zone === 'rows' ? m.row + 3 : 2;
      Object.keys(mounted).forEach(function (i) {
        if (want[i]) return;
        if (+i >= keepA && +i <= keepB) { rowEl(+i).style.transform = 'translateY(' + L.ys[+i] + 'px)'; if (+i === m.prevRow) renderRow(+i, null); return; }
        unmountRow(+i); delete mounted[i];
      });
      vis.forEach(function (i) {
        var r = rowEl(i); r.style.transform = 'translateY(' + L.ys[i] + 'px)';
        if (!mounted[i] || i === m.row || i === m.prevRow) renderRow(i, i === m.row ? dir : null);
        mounted[i] = 1;
      });
      m.prevRow = m.zone === 'rows' ? m.row : -1;
      scroll.style.transform = 'translateY(' + (-L.Y) + 'px)';
      sec.classList.toggle('scrolled', L.Y > 0);
      paintFocus();
      // vertical moves: the info under the row appears once the scroll settles (text layout mid-animation stutters on the TV)
      clearTimeout(metaDT);
      if (vert) { clearTimeout(metaT); metaEl.style.opacity = 0; metaDT = setTimeout(paintMeta, 270); } else paintMeta();
    }
    function paintFocus() {
      heroBtns.forEach(function (b, i) { b.classList.toggle('foc', !inRail && m.zone === 'hero' && heroBtn === i); });
      var ts = tilesEl ? tilesEl.firstChild.children : [];
      for (var i = 0; i < ts.length; i++) ts[i].classList.toggle('foc', !inRail && m.zone === 'tiles' && tileIdx === i);
      if (tilesEl) {
        var off = Math.max(0, tileIdx - 5) * 252;
        tilesEl.firstChild.style.transform = 'translateX(' + (-off) + 'px)';
      }
      Object.keys(rowEls).forEach(function (k) {
        var r = rowEls[k], row = rows[k]; if (!row) return;
        var it = row.items[m.col[k] || 0], on = !inRail && m.zone === 'rows' && +k === m.row;
        Object.keys(r._nodes).forEach(function (key) { var nd = r._nodes[key]; place(nd, on && it && key === 'p' + it.imdb); });
      });
    }
    function cur() { var row = rows[m.row]; return row ? row.items[m.col[m.row] || 0] : null; }
    function openTitle(it) { if (it) BF.router.go('title', { imdb: it.imdb, card: it }); }
    function activate(long) {
      if (m.zone === 'hero') {
        var h = hero[heroIdx]; if (!h) return;
        if (heroBtn === 0 && h.inPlex) {
          A.playable(h.imdb).then(function (p) { if (p.next) BF.player.open(p.next.id, { imdb: h.imdb, title: h.name }); else openTitle(h); }, function () { openTitle(h); });
        } else openTitle(h);
      } else if (m.zone === 'tiles') {
        var t = tiles[tileIdx]; BF.router.go('home', { browse: t.q, title: t.label });
      } else if (m.zone === 'rows') {
        var it = cur(); if (!it) return;
        if (!long && rows[m.row].key === 'cont' && it.play) BF.player.open(it.play.id, { imdb: it.imdb, title: it.name, onClose: refreshCont });
        else openTitle(it);
      }
    }
    // silent soft refresh (resume / periodic): refetch the model; swap only if its signature changed; keep focus by row key
    function sigOf() { return JSON.stringify([hero.map(function (h) { return h.imdb; }), rows.map(function (r) { return [r.key, r.items.map(function (x) { return x.imdb + (x.play ? ':' + Math.round((x.play.pct || 0) * 100) : '') + (x.downloading ? 'd' : ''); })]; })]); }
    var refreshing = false;
    function softRefresh(why) {
      if (!ready || refreshing) return; refreshing = true;
      var old = { rows: rows, tiles: tiles, hero: hero, sig: sigOf() }, focusKey = rows[m.row] && rows[m.row].key;
      rows = []; tiles = []; hero = [];
      load().then(function () {
        refreshing = false;
        if (!rows.length || sigOf() === old.sig) { rows = old.rows; tiles = old.tiles; hero = old.hero; return; }
        BF.log('home', 'soft refresh (' + why + ') changed');
        Object.keys(rowEls).forEach(function (k) { unmountRow(+k); }); mounted = {};
        var nr = 0; rows.forEach(function (r, i) { if (r.key === focusKey) nr = i; });
        var oldCol = m.col.slice(), oldRows = old.rows; m.col = [];
        rows.forEach(function (r, i) { var j = -1; oldRows.forEach(function (o, k) { if (o.key === r.key) j = k; }); m.col[i] = j >= 0 ? Math.min(oldCol[j] || 0, r.items.length - 1) : 0; });
        m.row = Math.min(nr, rows.length - 1);
        if (heroEl) { heroIdx = Math.min(heroIdx, Math.max(0, hero.length - 1)); paintHero(); }
        if (tilesEl) { var strip = tilesEl.firstChild; U.empty(strip); tiles.forEach(function (t) { strip.appendChild(U.txt('div', 'tile', t.label)); }); tileIdx = Math.min(tileIdx, Math.max(0, tiles.length - 1)); }
        layout();
      }, function () { refreshing = false; rows = old.rows; tiles = old.tiles; hero = old.hero; });
    }
    var perT = null;
    function refreshCont() {
      if (params.mode || params.browse || params.type) return;
      A.cont().then(function (d) {
        var i = -1; rows.forEach(function (r, k) { if (r.key === 'cont') i = k; });
        if (i < 0 || !d.items || !d.items.length) return;
        rows[i].items = d.items.slice(0, 30);
        if (rowEls[i]) { var r = rowEls[i]; Object.keys(r._nodes).forEach(function (k) { BF.images.release(r._nodes[k]); if (r._nodes[k].parentNode) r._nodes[k].parentNode.removeChild(r._nodes[k]); }); r._nodes = {}; }
        m.col[i] = Math.min(m.col[i] || 0, rows[i].items.length - 1);
        layout();
      }, function () {});
    }
    function railOpen() { inRail = true; paintFocus(); rail.show(function () { inRail = false; paintFocus(); }); }
    function showState(title, desc) {
      stateEl = U.el('div', 'state'); stateEl.appendChild(U.txt('div', 'state-t', title)); stateEl.appendChild(U.txt('div', 'state-d', desc || ''));
      sec.appendChild(stateEl);
    }
    function skeleton() {
      var sk = U.el('div', 'home-skel');
      var hb = U.el('div', 'skel sk-hero'); sk.appendChild(hb);
      for (var i = 0; i < 7; i++) { var t = U.el('div', 'skel sk-tile'); t.style.left = (128 + i * 252) + 'px'; sk.appendChild(t); }
      return sk;
    }
    return {
      mount: function (s, p, saved) {
        sec = s; params = p || {}; s.className += ' home';
        var current = params.library ? 'library' : params.mode === 'mylist' ? 'mylist' : params.type === 'series' ? 'series' : params.type === 'movie' ? 'movies' : 'home';
        scroll = U.el('div', 'home-scroll'); s.appendChild(scroll);
        var sk = skeleton(); s.appendChild(sk);
        rail = new BF.Rail(s, current, BF.state.profile);
        rowsEl = U.el('div', 'rows'); scroll.appendChild(rowsEl);
        metaEl = U.el('div', 'meta'); metaEl.appendChild(U.txt('div', 'meta-l1', '')); metaEl.appendChild(U.txt('div', 'meta-l2', '')); metaEl.appendChild(U.el('div', 'meta-chips'));
        rowsEl.appendChild(metaEl);
        var flat = params.mode || params.browse;
        if (flat) { s.classList.add('flat'); scroll.insertBefore(U.txt('div', 'flat-t', params.mode === 'mylist' ? BF.t('row.mylist') : params.title), rowsEl); }
        load().then(function () {
          sk.parentNode.removeChild(sk);
          if (!flat) { buildHero(); buildTiles(); paintHero(); rotate(); }
          if (flat) { G.firstTop0 = G.firstTop; }
          if (!rows.length && flat) { showState(BF.t('x.empty'), ''); return; }
          m.zone = flat ? 'rows' : (hero.length ? 'hero' : 'rows');
          if (saved) { m = saved; }
          if (flat) { RW.G.firstTop = 200; } else RW.G.firstTop = 990;
          ready = true; layout();
          BF.log('home', 'home_ready_ms ' + (Date.now() - t0) + ' rows=' + rows.length);
        }, function (e) {
          if (sk.parentNode) sk.parentNode.removeChild(sk);
          showState(BF.t('x.unreach'), e.message);
        });
      },
      onShow: function (restored, stale) {
        RW.G.firstTop = (params.mode || params.browse) ? 200 : 990;
        if (restored && ready) { layout(); }
        if (stale) softRefresh('stale');
        rotate();
        clearInterval(perT);
        perT = setInterval(function () {
          if (document.hidden || inRail || BF.keys.idleMs() < 20000 || (BF.player && BF.player.isOpen()) || (BF.dialog.isOpen && BF.dialog.isOpen())) return;
          softRefresh('timer');
        }, 300000);
      },
      onHide: function () { clearTimeout(heroT); clearInterval(perT); },
      unmount: function () { clearTimeout(heroT); clearTimeout(metaT); clearTimeout(metaDT); clearTimeout(tileT); clearInterval(perT); },
      saveState: function () { return { zone: m.zone, row: m.row, col: m.col.slice() }; },
      refresh: function (why) { if (why) softRefresh(why); else refreshCont(); },
      onKey: function (k) {
        if (rail.key(k)) return true;
        if (!ready) { if (k === 'back') { if (BF.router.stack.length > 1) BF.router.pop(); else BF.dialog.exit(); } return true; }
        var flat = params.mode || params.browse;
        if (k === 'up' || k === 'down') {
          var nm = RW.vmove(m, k, rows.length, !!tiles.length && !flat);
          if (flat && nm.zone !== 'rows') return true;
          if (!hero.length && nm.zone === 'hero') nm.zone = tiles.length ? 'tiles' : 'rows';
          nm.col = m.col; nm.prevRow = m.prevRow; m = nm;
          if (!layRaf) layRaf = requestAnimationFrame(function () { layRaf = 0; layout(null, true); });
          return true;
        }
        if (k === 'left' || k === 'right') {
          if (m.zone === 'hero') {
            var min = hero[heroIdx] && hero[heroIdx].inPlex ? 0 : 1;
            if (k === 'left') { if (heroBtn > min) heroBtn--; else railOpen(); } else if (heroBtn < 1) heroBtn++;
            paintFocus(); return true;
          }
          if (m.zone === 'tiles') {
            if (k === 'left') { if (tileIdx > 0) tileIdx--; else railOpen(); } else if (tileIdx < tiles.length - 1) tileIdx++;
            paintFocus(); return true;
          }
          var c = m.col[m.row] || 0;
          if (k === 'left' && c === 0) { railOpen(); return true; }
          var step = BF.keys.held() > 6 ? 2 : 1;
          var nc = RW.hmove(c, k, rows[m.row].items.length, step);
          if (nc !== c) { m.col[m.row] = nc; renderRow(m.row, k); paintFocus(); paintMeta(); }
          return true;
        }
        if (k === 'enter') { activate(false); return true; }
        if (k === 'longenter' || k === 'info') { if (m.zone === 'rows') openTitle(cur()); else activate(true); return true; }
        if (k === 'yellow' && m.zone === 'rows') { BF.toggleMylist(cur()); return true; }
        if (k === 'red') { BF.router.go('help'); return true; }
        if (k === 'green') { BF.go('search'); return true; }
        if (k === 'blue') { railOpen(); rail.idx = 0; rail.sub = true; rail.paint(); return true; }
        if ((k === 'play' || k === 'playpause') && m.zone === 'rows') {
          var it = cur(); if (it && it.play) BF.player.open(it.play.id, { imdb: it.imdb, title: it.name, onClose: refreshCont }); else openTitle(it);
          return true;
        }
        if (k === 'back') {
          if (m.zone === 'rows' && !flat && (hero.length || tiles.length)) { m.zone = hero.length ? 'hero' : 'tiles'; layout(); return true; }
          if (BF.router.stack.length > 1) BF.router.pop(); else BF.dialog.exit();
          return true;
        }
        return false;
      }
    };
  });
  BF.toggleMylist = function (it) {
    if (!it) return Promise.resolve();
    var on = !!BF.state.mylist[it.imdb];
    if (on) delete BF.state.mylist[it.imdb]; else BF.state.mylist[it.imdb] = 1;
    BF.toast(on ? BF.t('title.removed') : BF.t('title.added'));
    return (on ? A.mylistDel(it.imdb) : A.mylistAdd(it.imdb)).catch(function (e) {
      if (on) BF.state.mylist[it.imdb] = 1; else delete BF.state.mylist[it.imdb];
      BF.toast(BF.t('x.error', { e: e.message }));
      throw e;
    });
  };
})(window);
