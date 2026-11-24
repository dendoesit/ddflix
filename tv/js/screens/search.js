/* Search (PLAN §10.6): bare-letter keyboard with ă â î ș ț, genre shortcuts, 4-column results grid. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  var KEYS = ['a', 'ă', 'â', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'î', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 'ș', 't', 'ț', 'u', 'v', 'w', 'x', 'y', 'z', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  var GENRES = ['Comedy', 'Action', 'Family', 'Horror', 'Documentary', 'Drama', 'Animation', 'Crime', 'Thriller', 'Sci-Fi', 'Romance'];
  BF.router.register('search', function () {
    var U = BF.util, sec, rail, q = '', qEl, kb, sugg, grid, gridIn, head, kNodes = [], kIdx = 2, zone = 'kb', sIdx = 0, gIdx = 0, items = [], reqN = 0, deb, liveT, warmT, recs = [], suggs = [], gridTitle = '';
    var COLS = 6;
    function setQ(v) {
      q = v; qEl.textContent = q; qEl.appendChild(U.el('span', 'caret'));
      clearTimeout(deb);
      if (q.trim().length >= 2) deb = setTimeout(run, 300); else if (!q.trim()) showRecs();
      renderSugg();
    }
    function run() {
      var my = ++reqN, qq = q.trim(), t0 = Date.now();
      // without X-Profile the server answers with the restricted (kids) catalogue, i.e. silently empty for TV-MA titles
      if (!A.profile) { BF.log('search', 'no profile ticket -> profiles'); BF.router.go('profiles', null, { reset: true }); return; }
      skeleton();
      A.search(qq).then(function (d) {
        if (my !== reqN) return;
        var list = d.titles || d.items || [];
        BF.log('search', '"' + qq + '" ' + list.length + ' in ' + (Date.now() - t0) + 'ms p=' + A.profileId() + (String(A.profile).indexOf('.') > 0 ? '+ticket' : '-ticket'));
        // what is on the NAS shows at once; FileList is ALWAYS searched too (shortly after typing stops) and its titles are
        // appended (the server returns the local ones first, so the focused card stays the same)
        if (list.length) show(list, BF.t('search.results', { q: qq }) + '  ·  ' + BF.t('search.live'));
        else head.textContent = BF.t('search.live');
        clearTimeout(liveT);
        liveT = setTimeout(function () {
          if (my !== reqN) return;
          A.searchLive(qq).then(function (d2) {
            if (my !== reqN) return;
            var l2 = d2.titles || d2.items || [];
            if (l2.length) show(l2, BF.t('search.results', { q: qq }));
            else if (list.length) head.textContent = gridTitle = BF.t('search.results', { q: qq });
            else empty(qq);
          }, function () { if (my !== reqN) return; if (list.length) head.textContent = gridTitle = BF.t('search.results', { q: qq }); else empty(qq); });
        }, list.length ? 700 : 0);
      }, function (e) { if (my === reqN) { head.textContent = BF.t('x.error', { e: e.message }); items = []; U.empty(gridIn); } });
    }
    function empty(qq) { items = []; U.empty(gridIn); head.textContent = BF.t('search.none', { q: qq }); gridIn.appendChild(U.txt('div', 'g-empty', BF.t('search.hint'))); renderSugg(); }
    function skeleton() { U.empty(gridIn); items = []; for (var i = 0; i < 8; i++) { var s = U.el('div', 'gcell skel'); s.style.transform = pos(i); gridIn.appendChild(s); } }
    function pos(i) { return 'translate(' + ((i % 4) * 284) + 'px,' + (Math.floor(i / 4) * 392) + 'px)'; }
    function show(list, title) {
      items = list.slice(0, 40); gIdx = Math.min(gIdx, Math.max(0, items.length - 1));
      head.textContent = title; gridTitle = title; U.empty(gridIn);
      items.forEach(function (it, i) { var c = BF.card.poster(it); c.className += ' gcell'; c.style.transform = pos(i); gridIn.appendChild(c); });
      renderSugg(); paint();
    }
    function showRecs() {
      reqN++;
      if (recs.length) { show(recs, BF.t('search.recs')); return; }
      skeleton(); head.textContent = BF.t('search.recs');
      var my = reqN;
      Promise.all([A.recent().catch(function () { return { items: [] }; }), A.home().catch(function () { return { rows: [] }; })]).then(function (r) {
        var seen = {}; recs = [];
        (r[0].items || []).concat(((r[1].rows || [])[0] || {}).items || []).forEach(function (x) { if (!seen[x.imdb]) { seen[x.imdb] = 1; recs.push(x); } });
        if (my === reqN) show(recs, BF.t('search.recs'));
      });
    }
    function renderSugg() {
      U.empty(sugg); suggs = [];
      if (!q.trim()) GENRES.forEach(function (g) { suggs.push({ label: BF.i18n.genre(g), genre: g }); });
      else items.slice(0, 6).forEach(function (it) { suggs.push({ label: it.name, item: it }); });
      suggs.forEach(function (s) { sugg.appendChild(U.txt('div', 'sg', s.label)); });
      sIdx = Math.min(sIdx, Math.max(0, suggs.length - 1));
      paint();
    }
    function paint() {
      kNodes.forEach(function (n, i) { n.classList.toggle('foc', zone === 'kb' && i === kIdx); });
      var sg = sugg.children; for (var i = 0; i < sg.length; i++) sg[i].classList.toggle('foc', zone === 'sugg' && i === sIdx);
      sugg.style.transform = 'translateY(' + (zone === 'sugg' ? -Math.max(0, sIdx - 1) * 60 - 420 : 0) + 'px)';
      kb.style.transform = 'translateY(' + (zone === 'sugg' ? -420 : 0) + 'px)';
      var cells = gridIn.children;
      for (i = 0; i < cells.length; i++) cells[i].classList.toggle('foc', zone === 'grid' && i === gIdx);
      clearTimeout(warmT); if (zone === 'grid' && items[gIdx]) { var wi = items[gIdx]; warmT = setTimeout(function () { A.trailerPrefetch(wi.imdb); }, 600); }
      var rowOff = zone === 'grid' ? Math.max(0, Math.floor(gIdx / 4) - 1) * 392 : 0;
      gridIn.style.transform = 'translateY(' + (-rowOff) + 'px)';
    }
    function press() {
      var n = kNodes[kIdx], k = n.getAttribute('data-k');
      if (k === 'sp') setQ(q + ' '); else if (k === 'del') setQ(q.slice(0, -1)); else setQ(q + k);
    }
    // keyboard geometry: row 0 = [space, del], rows 1.. = 6 columns
    function kbMove(k) {
      if (kIdx < 2) {
        if (k === 'left') { if (kIdx === 1) kIdx = 0; else return 'rail'; }
        else if (k === 'right') { if (kIdx === 0) kIdx = 1; else return 'grid'; }
        else if (k === 'down') kIdx = kIdx === 0 ? 2 : 2 + 4;
        return true;
      }
      var i = kIdx - 2, r = Math.floor(i / COLS), c = i % COLS, rows = Math.ceil(KEYS.length / COLS);
      if (k === 'left') { if (c === 0) return 'rail'; kIdx--; }
      else if (k === 'right') { if (c === COLS - 1 || i === KEYS.length - 1) return 'grid'; kIdx++; }
      else if (k === 'up') { if (r === 0) kIdx = c < 3 ? 0 : 1; else kIdx -= COLS; }
      else if (k === 'down') { if (r === rows - 1 || i + COLS >= KEYS.length) return 'sugg'; kIdx += COLS; }
      return true;
    }
    return {
      mount: function (s) {
        sec = s; s.className += ' search';
        rail = new BF.Rail(s, 'search', BF.state.profile);
        qEl = U.el('div', 'sq'); s.appendChild(qEl);
        var col = U.el('div', 'skb-col'); s.appendChild(col);
        kb = U.el('div', 'skb'); col.appendChild(kb);
        var sp = U.el('div', 'sk sk-sp', '<svg viewBox="0 0 24 24"><path d="M4 10v4h16v-4"/></svg>'); sp.setAttribute('data-k', 'sp'); kb.appendChild(sp); kNodes.push(sp);
        var dl = U.el('div', 'sk sk-del', '<svg viewBox="0 0 24 24"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M12 9l6 6M18 9l-6 6"/></svg>'); dl.setAttribute('data-k', 'del'); kb.appendChild(dl); kNodes.push(dl);
        KEYS.forEach(function (k, i) { var e = U.txt('div', 'sk', k); e.setAttribute('data-k', k); e.style.transform = 'translate(' + ((i % COLS) * 62) + 'px,' + (90 + Math.floor(i / COLS) * 64) + 'px)'; kb.appendChild(e); kNodes.push(e); });
        sugg = U.el('div', 'ssug'); col.appendChild(sugg);
        head = U.txt('div', 'sh', ''); s.appendChild(head);
        grid = U.el('div', 'sgrid'); gridIn = U.el('div', 'sgrid-in'); grid.appendChild(gridIn); s.appendChild(grid);
        setQ('');
      },
      onShow: function () { paint(); },
      onKey: function (k, ev) {
        if (rail.key(k)) return true;
        var m = /^d(\d)$/.exec(k);
        if (m) { setQ(q + m[1]); return true; }
        if (zone === 'kb') {
          if (k === 'enter') { press(); return true; }
          if (k === 'back') { if (q) { setQ(''); return true; } BF.go('home'); return true; }
          if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
            var r = kbMove(k);
            if (r === 'rail') { rail.show(function () { paint(); }); }
            else if (r === 'grid' && items.length) { zone = 'grid'; gIdx = 0; }
            else if (r === 'sugg' && suggs.length) { zone = 'sugg'; sIdx = 0; }
            paint(); return true;
          }
          return true;
        }
        if (zone === 'sugg') {
          if (k === 'up') { if (sIdx > 0) sIdx--; else zone = 'kb'; }
          else if (k === 'down') sIdx = Math.min(suggs.length - 1, sIdx + 1);
          else if (k === 'right' && items.length) { zone = 'grid'; gIdx = 0; }
          else if (k === 'enter') {
            var sg = suggs[sIdx];
            if (sg.item) BF.router.go('title', { imdb: sg.item.imdb, card: sg.item });
            else { reqN++; var my = reqN; skeleton(); A.browse('?genre=' + encodeURIComponent(sg.genre) + '&sort=week').then(function (d) { if (my === reqN) show(d.items || [], sg.label); }); }
          } else if (k === 'back' || k === 'left') zone = 'kb';
          paint(); return true;
        }
        // grid
        if (k === 'left') { if (gIdx % 4 === 0) zone = 'kb'; else gIdx--; }
        else if (k === 'right') { if (gIdx % 4 < 3 && gIdx < items.length - 1) gIdx++; }
        else if (k === 'up') { if (gIdx >= 4) gIdx -= 4; }
        else if (k === 'down') { if (gIdx + 4 < items.length) gIdx += 4; }
        else if (k === 'enter' || k === 'longenter') { var it = items[gIdx]; if (it) BF.router.go('title', { imdb: it.imdb, card: it }); }
        else if (k === 'back') zone = 'kb';
        else if (k === 'yellow') BF.toggleMylist(items[gIdx]);
        paint(); return true;
      }
    };
  });
})(window);
