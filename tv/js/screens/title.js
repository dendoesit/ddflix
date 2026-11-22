/* Title detail (PLAN §4.6 + §10.5): backdrop, actions, bottom tab bar that moves to the top as a panel. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  var IC = {
    play: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M7 4l13 8-13 8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/></svg>',
    thumb: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.3 6A2 2 0 0 1 17.7 20H7"/></svg>',
    thumb2: '<svg viewBox="0 0 24 24"><path d="M5 11v9H2v-9zM5 11l4-8a2 2 0 0 1 3 2l-1 5h5a2 2 0 0 1 2 2.3l-1.3 6A2 2 0 0 1 15.7 20H5"/><path d="M15 6l2-3a2 2 0 0 1 3 2l-.8 4h1.8a2 2 0 0 1 2 2.3"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>', up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>'
  };
  BF.router.register('title', function () {
    var U = BF.util, sec, params, t = null, p = null, acts, nav, tabsEl, panelEl, contentEl, tabs = [], tabIdx = 0, zone = 'actions', panel = false;
    var selSeason = null, tabCtl = null, pollT = null, rating = 0, mediaInfo = null, alive = true;
    function inList() { return !!BF.state.mylist[t.imdb]; }
    function build() {
      var main = U.qs('.t-main', sec); U.empty(main);
      acts = BF.actions.actionsFor(t, p, { inList: inList(), rating: rating, inCont: params.card && params.card.play, season: selSeason });
      var lg = U.el('div', 't-logo'); main.appendChild(lg);
      if (t.logo) { var li = U.el('img', 'art'); lg.appendChild(li); BF.images.load(li, A.img('logo', t.imdb, 500), 1, function () { lg.textContent = ''; lg.appendChild(U.txt('div', 't-name', BF.nameOf(t))); }); }
      else lg.appendChild(U.txt('div', 't-name', BF.nameOf(t)));
      var meta = U.el('div', 't-meta');
      var parts = [];
      if (t.type === 'series') { parts.push(BF.fmt.years(t.year, t.yearEnd)); var ns = (t.seasons || []).filter(function (x) { return x.season > 0; }).length; if (ns) parts.push(ns === 1 ? BF.t('meta.season1') : BF.t('meta.seasons', { n: ns })); }
      else { parts.push(t.year); if (t.runtime) parts.push(BF.fmt.mins(t.runtime)); }
      if (t.genres && t.genres[0]) parts.push(BF.i18n.genre(t.genres[0]));
      meta.appendChild(U.txt('span', 't-meta-t', parts.join('  •  ')));
      var chipSrc = { has4k: t.has4k, dv: t.dv, hdr: t.hdr, atmos: t.atmos, ro: t.ro, rosub: t.rosub, rating: t.rating, certAge: t.certAge };
      if (p && p.next) { chipSrc.has4k = p.next.res === '4K'; chipSrc.hdr = !!p.next.hdr; chipSrc.dv = p.next.hdr === 'dovi'; }
      BF.card.infoChips(chipSrc).forEach(function (c) { meta.appendChild(U.txt('span', 'ichip', c)); });
      main.appendChild(meta);
      var n = p && p.next, syn = BF.descOf(t);
      if (n && n.season != null) {
        var ep = findEp(n.season, n.episode);
        var line = BF.t('meta.ep', { s: n.season, e: n.episode }) + (ep && ep.name ? '  •  ' + ep.name : '') + (n.duration ? '  •  ' + BF.fmt.mins(n.duration / 60) : '');
        main.appendChild(U.txt('div', 't-ep', line));
        if (ep && ep.overview) syn = ep.overview;
      }
      main.appendChild(U.txt('div', 't-syn', syn));
      if (n && n.position > 30 && !n.watched) {
        var pr = U.el('div', 't-prog'); var bar = U.el('div', 't-pbar'); var f = U.el('i'); f.style.width = Math.round((n.position / (n.duration || 1)) * 100) + '%'; bar.appendChild(f);
        pr.appendChild(bar); pr.appendChild(U.txt('span', 't-left', BF.t('meta.left', { t: BF.fmt.left(n.duration, n.position) }))); main.appendChild(pr);
      }
      if (acts.note) { var no = U.el('div', 't-note', '<span class="gl">' + IC.info + '</span>'); no.appendChild(document.createTextNode(BF.t(acts.note.key, acts.note.vars))); main.appendChild(no); }
      var row = U.el('div', 't-acts');
      if (acts.primary && acts.primary.id === 'dlprog') {
        var dp = U.el('div', 'btn t-dl'); dp.setAttribute('data-f', ''); dp.setAttribute('data-act', 'dlprog');
        var dbar = U.el('i', 't-dl-bar'); dbar.style.transform = 'scaleX(' + Math.max(0.02, acts.primary.progress / 100) + ')'; dp.appendChild(dbar);
        dp.appendChild(U.txt('span', 't-dl-l', BF.t(acts.primary.key, acts.primary.vars))); row.appendChild(dp);
      } else if (acts.primary && acts.primary.id === 'download') {
        var db = U.el('div', 'btn btn--pri t-play', '<span class="gl">' + IC.dl + '</span>'); db.appendChild(document.createTextNode(BF.t(acts.primary.key, acts.primary.vars)));
        db.setAttribute('data-f', ''); db.setAttribute('data-act', 'download'); row.appendChild(db);
      } else if (acts.primary) { var b = U.el('div', 'btn btn--pri t-play', '<span class="gl">' + IC.play + '</span>'); b.appendChild(document.createTextNode(BF.t(acts.primary.key, acts.primary.vars))); b.setAttribute('data-f', ''); b.setAttribute('data-act', 'play'); row.appendChild(b); }
      acts.icons.forEach(function (a) {
        var icon = a.id === 'mylist' ? (a.on ? IC.check : IC.plus) : a.id === 'restart' ? IC.restart : a.id === 'rate' ? (a.value === 2 ? IC.thumb2 : IC.thumb) : IC.x;
        var tip = a.id === 'mylist' ? BF.t('title.mylist') : a.id === 'restart' ? BF.t('title.restart') : a.id === 'rate' ? BF.t('title.rate') : BF.t('title.remove');
        var e = U.el('div', 'ibtn' + (a.id === 'rate' && a.value ? ' on' : ''), icon + '<span class="tip">' + U.esc(tip) + '</span>');
        e.setAttribute('data-f', ''); e.setAttribute('data-act', a.id); row.appendChild(e);
      });
      main.appendChild(row);
      // tab bar
      tabs = acts.tabs; U.empty(tabsEl);
      tabsEl.appendChild(U.el('span', 'tb-ic', IC.down));
      tabs.forEach(function (k) { tabsEl.appendChild(U.txt('span', 'tb', BF.t('title.' + k))); });
      nav = new BF.nav.Nav(row);
      nav.measure();
      var first = row.querySelector('[data-act]'); if (first) nav.focus(first);
      paint();
    }
    function findEp(s, e) {
      var se = (t.seasons || []).filter(function (x) { return x.season === s; })[0];
      return se && (se.episodes || []).filter(function (x) { return x.episode === e; })[0];
    }
    function paint() {
      sec.classList.toggle('panel', panel);
      var tbs = tabsEl.querySelectorAll('.tb');
      for (var i = 0; i < tbs.length; i++) { tbs[i].classList.toggle('foc', zone === 'tabs' && i === tabIdx); tbs[i].classList.toggle('sel', panel && zone !== 'tabs' && i === tabIdx); }
      tabsEl.firstChild.innerHTML = panel ? IC.up : IC.down;
      if (nav) { if (zone === 'actions') nav.refocus(); else nav.blur(); }
    }
    // ---------- hero trailer (S5: server-cached mp4, no YouTube, no ads). Backdrop stays until the video really plays.
    var tv = null, tvT = null, idleT = null;
    function idle() { clearTimeout(idleT); sec.classList.remove('clean'); if (tv && !panel) idleT = setTimeout(function () { if (tv && !panel) sec.classList.add('clean'); }, 3500); }
    function trailerUrl() { return A.authUrl('/api/title/' + t.imdb + '/trailer.mp4'); }
    function startTrailer() {
      stopTrailer(); if (!t || !t.trailer || BF.player.state()) return;
      var imdb = t.imdb;
      var t0 = Date.now();
      var polls = 0;
      function check() {
        if (t.trailerReady === true || t.trailerState === 'ready') return Promise.resolve(true);
        return A.trailerPrefetch(imdb, polls++ > 0).then(function (r) { return !!(r.ready || r.state === 'ready'); }).then(function (ok) {
          if (ok || !alive || !t || t.imdb !== imdb || Date.now() - t0 > 60000) return ok;
          return new Promise(function (res) { tvT = setTimeout(res, 1500); }).then(check);
        });
      }
      check().then(function (ok) {
        BF.log('title', 'trailer ' + (ok ? 'ready' : 'not cached') + ' after ' + (Date.now() - t0) + 'ms (' + polls + ' polls)');
        if (!ok || !alive || !t || t.imdb !== imdb || panel) return;
        tvT = setTimeout(function () {
          var v = document.createElement('video'); v.className = 't-tv'; v.muted = true; v.autoplay = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
          v.addEventListener('playing', function () { if (tv !== v) return; BF.log('title', 'trailer playing ' + (Date.now() - t0) + 'ms after page open'); sec.classList.add('tv-on'); idle(); setTimeout(function () { if (tv === v) { v.muted = false; v.volume = 0.6; } }, 1200); });
          v.addEventListener('ended', function () { if (tv === v) stopTrailer(); });
          v.addEventListener('error', function () { BF.log('title', 'trailer error ' + (v.error && v.error.code)); if (tv === v) stopTrailer(); });
          var bg = U.qs('.t-bg', sec); sec.insertBefore(v, bg.nextSibling); tv = v;
          v.src = trailerUrl(); var pr = v.play(); if (pr && pr.catch) pr.catch(function () { /* autoplay refused: keep backdrop */ });
        }, Math.max(0, 1200 - (Date.now() - t0)));
      });
    }
    function stopTrailer() {
      clearTimeout(tvT); clearTimeout(idleT); sec.classList.remove('clean'); if (!tv) return; var v = tv; tv = null; sec.classList.remove('tv-on');
      try { v.pause(); } catch (e) { /* */ }
      setTimeout(function () { v.removeAttribute('src'); try { v.load(); } catch (e) { /* */ } if (v.parentNode) v.parentNode.removeChild(v); }, 350);
    }
    function act(id) {
      var n = p && p.next;
      if ((id === 'play' || id === 'restart') && n) stopTrailer();
      if (id === 'play' && n) BF.player.open(n.id, { imdb: t.imdb, title: BF.nameOf(t), onClose: reload });
      else if (id === 'restart' && n) BF.player.open(n.id, { imdb: t.imdb, title: BF.nameOf(t), start: 0, onClose: reload });
      else if (id === 'download') {
        var sn = acts && acts.primary && acts.primary.season, r = BF.actions.pickRelease(t, sn); if (!r) { BF.toast(BF.t('title.nodl')); return; }
        A.tvDownload(t.imdb, r.id, sn).then(function () { BF.toast(BF.t('title.dlstarted')); return reload(); }).then(poll, function (e) { BF.toast(BF.dlError(e)); });
      }
      else if (id === 'mylist') BF.toggleMylist(t).then(rebuildKeep, rebuildKeep);
      else if (id === 'rate') { rating = rating === 0 ? 1 : rating === 1 ? 2 : 0; A.rate(t.imdb, rating).then(function () { if (rating) BF.toast(BF.t('title.ratedone')); }, function (e) { BF.toast(e.message); }); rebuildKeep(); }
      else if (id === 'remove') BF.dialog.open({ title: BF.t('title.remove'), body: BF.t('title.removeq'), buttons: [{ label: BF.t('x.yes'), primary: true, action: function () { A.watched(t.imdb, false).then(reload); } }, { label: BF.t('x.cancel') }] });
    }
    function rebuildKeep() {
      var a = nav && nav.cur && nav.cur.getAttribute('data-act'); build();
      var e = a && U.qs('[data-act="' + a + '"]', sec); if (e) nav.focus(e);
    }
    function reload() {
      return Promise.all([A.title(t.imdb), A.playable(t.imdb).catch(function () { return {}; })]).then(function (r) { t = r[0]; p = r[1]; if (alive) rebuildKeep(); });
    }
    function poll() {
      clearTimeout(pollT);
      if (!alive || (p && p.next) || BF.actions.activeDownload(t) == null) return;
      pollT = setTimeout(function () { reload().then(poll, poll); }, 8000);
    }
    // ---------- panel
    function openPanel() {
      stopTrailer(); panel = true; zone = 'content';
      if (tabCtl && tabCtl.destroy) tabCtl.destroy();
      U.empty(contentEl);
      var k = tabs[tabIdx];
      tabCtl = BF.titleTabs[k](contentEl, { t: t, p: p, media: mediaInfo, setMedia: function (m) { mediaInfo = m; }, reload: reload, season: selSeason, setSeason: function (n) { selSeason = n; } });
      paint();
    }
    function closePanel() { panel = false; zone = 'actions'; if (t) build(); if (tabCtl && tabCtl.destroy) tabCtl.destroy(); tabCtl = null; BF.images.release(contentEl); paint(); }
    return {
      mount: function (s, prm) {
        sec = s; params = prm; s.className += ' title';
        var bg = U.el('img', 'art t-bg'); s.appendChild(bg);
        s.appendChild(U.el('div', 't-scrim'));
        s.appendChild(U.el('div', 't-wash'));
        s.appendChild(U.el('div', 't-main'));
        panelEl = U.el('div', 't-panel'); contentEl = U.el('div', 't-content'); panelEl.appendChild(contentEl); s.appendChild(panelEl);
        tabsEl = U.el('div', 't-tabs'); s.appendChild(tabsEl);
        s.appendChild(U.el('div', 't-rule'));
        BF.images.load(bg, A.img('background', prm.imdb, 1280), 1);
        var main = U.qs('.t-main', s);
        if (prm.card) { main.appendChild(U.txt('div', 't-name', prm.card.name)); }
        BF.router.spinner(true);
        var ml = BF.state.mylistLoaded ? Promise.resolve() : BF.loadMylist().catch(function () {});
        Promise.all([A.title(prm.imdb), A.playable(prm.imdb).catch(function () { return {}; }), ml]).then(function (r) {
          BF.router.spinner(false);
          if (!alive) return;
          t = r[0]; p = r[1]; rating = t.myRating || 0;
          build(); poll(); startTrailer();
          if (prm.tab) { var i = tabs.indexOf(prm.tab); if (i >= 0) { tabIdx = i; openPanel(); } }
        }, function (e) { BF.router.spinner(false); BF.toast(BF.t('x.error', { e: e.message })); BF.router.pop(); });
      },
      onShow: function (restored) { if (restored && t) { reload(); poll(); } },
      refresh: function () { if (t) reload().then(poll, function () {}); },
      onHide: function () { clearTimeout(pollT); stopTrailer(); },
      unmount: function () { alive = false; clearTimeout(pollT); stopTrailer(); if (tabCtl && tabCtl.destroy) tabCtl.destroy(); },
      onKey: function (k) {
        if (!t) { if (k === 'back') { BF.router.pop(); } return true; }
        if (sec.classList.contains('clean')) { idle(); return true; }
        if (tv) idle();
        if (zone === 'content') {
          var r = tabCtl && tabCtl.key(k);
          if (r === 'up') { zone = 'tabs'; paint(); return true; }
          if (r) return true;
          if (k === 'back') { closePanel(); return true; }
          return true;
        }
        if (zone === 'tabs') {
          if (k === 'left' && tabIdx > 0) { tabIdx--; if (panel) openPanel(); zone = 'tabs'; paint(); }
          else if (k === 'right' && tabIdx < tabs.length - 1) { tabIdx++; if (panel) openPanel(); zone = 'tabs'; paint(); }
          else if (k === 'down' || k === 'enter') { if (!panel) openPanel(); else { zone = 'content'; paint(); } }
          else if (k === 'up' || k === 'back') { if (panel) closePanel(); else { zone = 'actions'; paint(); } }
          return true;
        }
        // actions
        if (k === 'enter') { var a = nav.cur && nav.cur.getAttribute('data-act'); if (a) act(a); return true; }
        if (k === 'left' || k === 'right') { nav.move(k); return true; }
        if (k === 'down') { zone = 'tabs'; tabIdx = 0; paint(); return true; }
        if (k === 'up') return true;
        if (k === 'yellow') { act('mylist'); return true; }
        if (k === 'play' || k === 'playpause') { act('play'); return true; }
        if (k === 'back') { BF.router.pop(); return true; }
        return false;
      }
    };
  });

  // ---------- tab contents: each returns {key(k) -> true | 'up' | false, destroy()}
  var T = BF.titleTabs = {};
  function U() { return BF.util; }
  T.details = function (el, c) {
    var u = U(), t = c.t, w = u.el('div', 'tab-details');
    var l = u.el('div', 'td-l'); l.appendChild(u.txt('div', 'td-h', BF.nameOf(t))); l.appendChild(u.txt('div', 'td-syn', BF.descOf(t)));
    var sc = u.el('div', 'td-scores');
    if (t.rating) sc.appendChild(u.txt('span', 'ichip', 'IMDb ' + t.rating));
    if (t.tmdb) sc.appendChild(u.txt('span', 'ichip', 'TMDB ' + t.tmdb + '%'));
    if (t.rt) sc.appendChild(u.txt('span', 'ichip', 'RT ' + t.rt + '%'));
    if (t.mc) sc.appendChild(u.txt('span', 'ichip', 'MC ' + t.mc));
    l.appendChild(sc);
    var r = u.el('div', 'td-r');
    function row(k, v) { if (!v) return; var e = u.el('div', 'td-row'); e.appendChild(u.txt('div', 'td-k', BF.t(k))); e.appendChild(u.txt('div', 'td-v', v)); r.appendChild(e); }
    function names(x) { return (x || []).slice(0, 8).map(function (a) { return typeof a === 'string' ? a : a.name; }).join(', '); }
    row('title.cast', names(t.cast)); row('title.director', names(t.director));
    row('title.genres', (t.genresAll || t.genres || []).map(BF.i18n.genre).join(', '));
    row('title.released', t.released ? String(t.released).slice(0, 10) : t.year);
    var n = c.p && c.p.next;
    if (n) row('title.file', [n.res, n.hdr ? String(n.hdr).toUpperCase() : '', n.vcodec, BF.fmt.gb(n.size || 0)].filter(Boolean).join(' · '));
    w.appendChild(l); w.appendChild(r); el.appendChild(w);
    return { key: function (k) { return k === 'up' ? 'up' : k === 'back' ? false : true; } };
  };
  T.trailers = function (el, c) {
    var u = U(), w = u.el('div', 'tab-trailers'), tile = u.el('div', 'ttile foc');
    var img = u.el('img', 'art'); tile.appendChild(img);
    BF.images.load(img, 'https://i.ytimg.com/vi/' + c.t.trailer + '/hqdefault.jpg', 1, function () { BF.images.load(img, BF.api.img('background', c.t.imdb, 640), 1); });
    tile.appendChild(u.el('div', 'ttile-play', '<svg viewBox="0 0 24 24" style="fill:#fff;stroke:none"><path d="M7 4l13 8-13 8z"/></svg>'));
    tile.appendChild(u.txt('div', 'ttile-l', BF.t('title.trailer')));
    tile.appendChild(u.el('div', 'ring'));
    w.appendChild(tile); el.appendChild(w);
    return { key: function (k) { if (k === 'up') return 'up'; if (k === 'enter') { BF.trailer.open(c.t.imdb, BF.nameOf(c.t)); return true; } return k !== 'back'; } };
  };
  T.audiosubs = function (el, c) {
    var u = U(), n = c.p.next, w = u.el('div', 'tab-as'), cols = [[], []], col = 0, idx = [0, 0], lists = [];
    el.appendChild(w);
    var ov = BF.playOverride && BF.playOverride.mediaId === n.id ? BF.playOverride : null;
    function render(m) {
      u.empty(w); cols = [[], []];
      var a = u.el('div', 'as-col as-a'), s = u.el('div', 'as-col as-s');
      a.appendChild(u.txt('div', 'as-h', BF.t('title.audio'))); s.appendChild(u.txt('div', 'as-h', BF.t('title.subs')));
      var la = u.el('div', 'as-list'), ls = u.el('div', 'as-list'); a.appendChild(la); s.appendChild(ls); lists = [la, ls];
      var selA = ov ? ov.audio : m.defaultAudio || 0, selS = ov ? ov.sub : m.defaultSub;
      (m.audio || []).forEach(function (x) { var e = u.txt('div', 'as-it' + (x.n === selA ? ' on' : ''), x.label); e._v = x.n; la.appendChild(e); cols[0].push(e); });
      var none = u.txt('div', 'as-it' + (!selS ? ' on' : ''), BF.t('title.none')); none._v = null; ls.appendChild(none); cols[1].push(none);
      var lastGroup = 'main';
      (m.subs || []).filter(function (x) { return x.text; }).forEach(function (x) {
        if (x.group !== lastGroup) { ls.appendChild(u.el('div', 'as-sep')); lastGroup = x.group; }
        var e = u.txt('div', 'as-it' + (x.key === selS ? ' on' : ''), x.display || x.label); e._v = x.key; ls.appendChild(e); cols[1].push(e);
      });
      paint();
    }
    function paint() {
      for (var c2 = 0; c2 < 2; c2++) {
        cols[c2].forEach(function (e, i) { e.classList.toggle('foc', c2 === col && i === idx[c2]); });
        var off = Math.max(0, idx[c2] - 6) * 64; if (lists[c2]) lists[c2].style.transform = 'translateY(' + (-off) + 'px)';
      }
    }
    if (c.media && c.media.id === n.id) render(c.media);
    else BF.api.media(n.id).then(function (m) { c.setMedia(m); render(m); }, function (e) { w.textContent = e.message; });
    return {
      key: function (k) {
        if (!cols[0].length && !cols[1].length) return k === 'up' ? 'up' : k !== 'back';
        if (k === 'up') { if (idx[col] === 0) return 'up'; idx[col]--; }
        else if (k === 'down') idx[col] = Math.min(cols[col].length - 1, idx[col] + 1);
        else if (k === 'left' && col === 1 && cols[0].length) col = 0;
        else if (k === 'right' && col === 0) col = 1;
        else if (k === 'enter') {
          var e = cols[col][idx[col]]; if (!e) return true;
          cols[col].forEach(function (x) { x.classList.remove('on'); }); e.classList.add('on');
          var a = cols[0].filter(function (x) { return x.classList.contains('on'); })[0], s = cols[1].filter(function (x) { return x.classList.contains('on'); })[0];
          BF.playOverride = { mediaId: n.id, audio: a ? a._v : 0, sub: s ? s._v : null };
          ov = BF.playOverride;
        } else if (k === 'back') return false;
        paint(); return true;
      }
    };
  };
  // similar: one row in the Home focused-row style
  T.similar = function (el, c) {
    var u = U(), items = (c.t.similar || []).slice(0, 18), col = 0, w = u.el('div', 'tab-sim'), band = u.el('div', 'row-band'), meta = u.el('div', 'meta sim-meta');
    meta.appendChild(u.txt('div', 'meta-l1', '')); meta.appendChild(u.txt('div', 'meta-l2', '')); meta.appendChild(u.el('div', 'meta-chips'));
    w.appendChild(band); w.appendChild(meta); el.appendChild(w);
    if (!items.length) { w.textContent = BF.t('title.nosimilar'); return { key: function (k) { return k === 'up' ? 'up' : k !== 'back'; } }; }
    var tmT;
    function render() {
      BF.images.release(band); band.textContent = '';
      var x = 0;
      for (var j = col; j < Math.min(items.length, col + 5); j++) {
        var it = items[j], node;
        if (j === col) {
          node = u.el('div', 'ftile foc');
          var ph = u.el('img', 'art ftile-ph'); node.appendChild(ph); BF.images.load(ph, BF.api.img('poster', it.imdb, 400), 2);
          var bg = u.el('img', 'art ftile-bg'); node.appendChild(bg); BF.images.load(bg, BF.api.img('background', it.imdb, 1280), 1);
          node.appendChild(u.el('div', 'ftile-scrim')); var lg = u.el('div', 'ftile-logo'); lg.appendChild(u.txt('div', 'ftile-name', it.name)); node.appendChild(lg);
          node.appendChild(u.el('div', 'ring'));
        } else node = BF.card.poster(it);
        node.style.transform = 'translateX(' + x + 'px)'; band.appendChild(node);
        x += (j === col ? 800 : 300) + 16;
      }
      var cur = items[col];
      meta.children[0].textContent = cur.name + '   ·   ' + BF.card.metaLine(cur);
      meta.children[1].textContent = ''; meta.children[2].textContent = '';
      BF.card.infoChips(cur).forEach(function (cc) { meta.children[2].appendChild(u.txt('span', 'ichip', cc)); });
      clearTimeout(tmT); tmT = setTimeout(function () { BF.titleCache(cur.imdb).then(function (tt) { if (items[col] === cur) meta.children[1].textContent = BF.descOf(tt); }, function () {}); }, 400);
    }
    render();
    return {
      key: function (k) {
        if (k === 'up') return 'up';
        if (k === 'left' && col > 0) { col--; render(); }
        else if (k === 'right' && col < items.length - 1) { col++; render(); }
        else if (k === 'enter') BF.router.go('title', { imdb: items[col].imdb, card: items[col] });
        else if (k === 'back') return false;
        return true;
      },
      destroy: function () { clearTimeout(tmT); }
    };
  };
  // episodes: season chips + horizontal still strip across seasons (fixed-left focus)
  T.episodes = function (el, c) {
    var u = U(), t = c.t, files = (c.p && c.p.files) || [], flat = [], seasons = [];
    var byKey = {}; files.forEach(function (f) { byKey[f.season + ':' + f.episode] = f; });
    (t.seasons || []).forEach(function (s) {
      if (!s.episodes || !s.episodes.length || s.season === 0) return;
      seasons.push({ n: s.season, start: flat.length, count: s.episodes.length });
      s.episodes.forEach(function (e, i) { flat.push({ s: s.season, e: e, first: i === 0, file: byKey[s.season + ':' + e.episode] }); });
    });
    var n = c.p && c.p.next, idx = 0;
    if (n) flat.forEach(function (x, i) { if (x.s === n.season && x.e.episode === n.episode) idx = i; });
    else if (c.season != null) flat.some(function (x, i) { if (x.s === c.season) { idx = i; return true; } return false; });
    var w = u.el('div', 'tab-eps');
    var hd = u.el('div', 'ep-head'); hd.appendChild(u.txt('div', 'ep-title', BF.nameOf(t)));
    hd.appendChild(u.txt('div', 'ep-sub', (seasons.length === 1 ? BF.t('meta.season1') : BF.t('meta.seasons', { n: seasons.length })) + '  •  ' + BF.t('meta.episodes', { n: flat.length })));
    w.appendChild(hd);
    var chips = u.el('div', 'ep-chips'); w.appendChild(chips);
    seasons.forEach(function (s) { var ch = u.el('span', 'ep-chip'); ch.appendChild(u.txt('span', '', BF.t('title.season', { n: s.n }))); ch.appendChild(u.txt('small', '', BF.t('meta.episodes', { n: s.count })));
      var sp = BF.actions.activeDownload(t, s.n); if (sp != null) { var bar = u.el('span', 'ep-chip-bar'); var fill = u.el('i', ''); fill.style.width = sp + '%'; bar.appendChild(fill); ch.appendChild(bar); ch.appendChild(u.txt('small', 'ep-chip-p', sp + ' %')); }
      chips.appendChild(ch); s.el = ch; });
    // per-season download action next to the pills (targets the selected season)
    var dlc = u.el('span', 'ep-chip ep-chip-dl'); chips.appendChild(dlc);
    var sub = 'chips', mem = {};
    function selS() { return flat[idx] ? flat[idx].s : null; }
    function canDl(sn) { return sn != null && BF.actions.activeDownload(t, sn) == null && !flat.some(function (x) { return x.s === sn && x.file; }) && !!BF.actions.pickRelease(t, sn); }
    function paintChips() {
      var sn = selS(), ok = canDl(sn), ci = chipIdx();
      dlc.textContent = ok ? BF.t('title.dlseason', { s: sn }) : ''; dlc.style.display = ok ? '' : 'none';
      seasons.forEach(function (s, i) { s.el.classList.toggle('foc', sub === 'chips' && ci === i); });
      dlc.classList.toggle('foc', sub === 'chips' && ci === seasons.length);
      if (c.setSeason) c.setSeason(sn);
    }
    var onDl = false;
    function chipIdx() { if (onDl) return seasons.length; for (var i = 0; i < seasons.length; i++) if (seasons[i].n === selS()) return i; return 0; }
    function goSeason(i) { var cur = selS(); if (cur != null) mem[cur] = idx; var s = seasons[i]; idx = mem[s.n] != null ? mem[s.n] : s.start; render(); }
    function dlSeason(sn) {
      var rs = BF.actions.pickRelease(t, sn); if (!rs) { BF.toast(BF.t('dl.e404')); return; }
      BF.dialog.open({ title: BF.t('title.dlseason', { s: sn }), body: BF.t('title.dlseasonq', { s: sn, r: rs.resolution || '' }), buttons: [{ label: BF.t('title.download'), primary: true, action: function () {
        BF.api.tvDownload(t.imdb, rs.id, sn).then(function () { BF.toast(BF.t('title.dlstarted')); c.reload(); }, function (e) { BF.toast(BF.dlError(e)); });
      } }, { label: BF.t('x.cancel') }] });
    }
    var strip = u.el('div', 'ep-strip'); w.appendChild(strip);
    var info = u.el('div', 'ep-info'); info.appendChild(u.txt('div', 'ep-name', '')); info.appendChild(u.txt('div', 'ep-ov', '')); info.appendChild(u.txt('div', 'ep-st', '')); w.appendChild(info);
    el.appendChild(w);
    var nodes = {};
    function node(i) {
      if (nodes[i]) return nodes[i];
      var x = flat[i], d = u.el('div', 'ep' + (x.file ? '' : ' ep--off'));
      var img = u.el('img', 'art'); d.appendChild(img);
      if (x.e.thumb) BF.images.load(img, BF.api.epImg(t.imdb, x.s, x.e.episode, 640), 3);
      d.appendChild(u.txt('div', 'ep-lab', x.first ? 'Sez. ' + x.s + ' ep. ' + x.e.episode : String(x.e.episode)));
      if (x.file && x.file.pct > 0) { var pb = u.el('div', 'pbar'); var f = u.el('i'); f.style.width = Math.round((x.file.watched ? 1 : x.file.pct) * 100) + '%'; pb.appendChild(f); d.appendChild(pb); }
      if (x.file && x.file.watched) d.appendChild(u.el('div', 'ep-done', '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>'));
      if (x.e.rating) d.appendChild(u.txt('div', 'ep-imdb', 'IMDb ' + Number(x.e.rating).toFixed(1)));
      if (!x.file) d.appendChild(u.txt('div', 'ep-glyph', x.e.download ? '⏳ ' + Math.round(x.e.download.progress || 0) + '%' : '–'));
      d.appendChild(u.el('div', 'ring'));
      nodes[i] = d; return d;
    }
    function render() {
      var keep = {}, x = 0;
      for (var i = idx; i < Math.min(flat.length, idx + 5); i++) {
        if (i > idx && flat[i].first) x += 24;
        var d = node(i); keep[i] = 1;
        d.style.transform = 'translateX(' + x + 'px)'; d.classList.toggle('foc', sub === 'eps' && i === idx);
        if (d.parentNode !== strip) strip.appendChild(d);
        x += 416;
      }
      Object.keys(nodes).forEach(function (k) { if (!keep[k]) { BF.images.release(nodes[k]); if (nodes[k].parentNode) strip.removeChild(nodes[k]); delete nodes[k]; } });
      var cur = flat[idx];
      seasons.forEach(function (s) { s.el.classList.toggle('sel', s.n === cur.s); });
      for (var q in nodes) nodes[q].classList.toggle('foc', sub === 'eps' && +q === idx);
      paintChips();
      info.children[0].textContent = cur.e.episode + '. ' + (cur.e.name || '');
      info.children[1].textContent = cur.e.overview || '';
      info.children[2].textContent = cur.file ? (cur.file.timeLeft && cur.file.position > 0 ? BF.t('meta.left', { t: BF.fmt.left(cur.file.duration, cur.file.position) }) : cur.file.duration ? BF.fmt.mins(cur.file.duration / 60) : '') : (cur.e.download ? BF.t('title.downloading', { p: Math.round(cur.e.download.progress || 0) }) : BF.t('title.epnotonserver'));
    }
    if (flat.length) render(); else info.children[0].textContent = BF.t('x.empty');
    return {
      key: function (k) {
        if (!flat.length) return k === 'up' ? 'up' : k !== 'back';
        if (sub === 'chips') {
          var ci = chipIdx();
          if (k === 'up') return 'up';
          if (k === 'down') { sub = 'eps'; onDl = false; render(); return true; }
          if (k === 'left' && ci > 0) { if (onDl) onDl = false; else goSeason(ci - 1); render(); return true; }
          if (k === 'right') { if (ci < seasons.length - 1) goSeason(ci + 1); else if (!onDl && canDl(selS())) onDl = true; render(); return true; }
          if (k === 'enter') { if (onDl) dlSeason(selS()); else { sub = 'eps'; render(); } return true; }
          if (k === 'back') return false;
          return true;
        }
        if (k === 'up') { sub = 'chips'; render(); return true; }
        if (k === 'left' && idx > 0) { idx--; render(); }
        else if (k === 'right' && idx < flat.length - 1) { idx++; render(); }
        else if (k === 'enter') {
          var cur = flat[idx];
          if (cur.file) BF.player.open(cur.file.id, { imdb: t.imdb, title: BF.nameOf(t), start: cur.file.watched ? 0 : null, onClose: c.reload });
          else {
            // episode not on the server: offer its season pack (same seeder rule)
            var rs = BF.actions.pickRelease(t, cur.s);
            if (!rs || cur.e.download) BF.toast(BF.t(cur.e.download ? 'title.downloading' : 'title.epnotonserver', { p: Math.round((cur.e.download || {}).progress || 0) }));
            else BF.dialog.open({ title: BF.t('title.dlseason', { s: cur.s }), body: BF.t('title.dlseasonq', { s: cur.s, r: rs.resolution || '' }), buttons: [{ label: BF.t('title.download'), primary: true, action: function () {
              BF.api.tvDownload(t.imdb, rs.id, cur.s).then(function () { BF.toast(BF.t('title.dlstarted')); c.reload(); }, function (e) { BF.toast(BF.dlError(e)); });
            } }, { label: BF.t('x.cancel') }] });
          }
        } else if (k === 'back') return false;
        return true;
      }
    };
  };
})(window);
