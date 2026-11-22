/* Who's watching, Netflix-TV style: vertical avatar list on the left (focused = big + white ring + name, pencil beside),
   full-screen slideshow of kid-safe featured titles behind (backdrop + logo + genre tags, slow crossfade + Ken Burns). */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  var PEN = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  BF.router.register('profiles', function () {
    var U = BF.util, sec, items = [], idx = 0, list, nameEl, subEl, lockEl, penEl, profs = [], slides = [], slidePid = null, byPid = {}, pidT, general = null, sIdx = -1, slideEls = [], sFront = 0, slideT, alive = true, refT;
    var BIG = 212, SM = 136, GAP = 28, CX = 370, TOP = 230;
    function layout() {
      var y = TOP, centres = [];
      for (var i = 0; i < items.length; i++) { var h = i === idx ? BIG : SM; centres.push(y + h / 2); y += h + GAP; }
      var shift = 0;
      if (items.length > 5) shift = Math.min(0, 560 - centres[idx]);
      for (i = 0; i < items.length; i++) {
        var s = i === idx ? 1 : SM / BIG;
        items[i].style.transform = 'translate(' + (CX - BIG / 2) + 'px,' + (centres[i] + shift - BIG / 2) + 'px) scale(' + s + ')';
        items[i].classList.toggle('foc', i === idx);
      }
      var p = profs[idx], cy = centres[idx] + shift;
      nameEl.textContent = p.name;
      var sub = '';
      if (p.kind === 'kids' && !/kids|copii/i.test(p.name)) sub = BF.t('prof.kids');
      if (p.hasPin) sub = BF.t('prof.pin');
      subEl.textContent = sub;
      var blk = nameEl.parentNode; blk.style.transform = 'translateY(' + (cy - 40 - (sub ? 18 : 0)) + 'px)';
      lockEl.style.opacity = 0;
      clearTimeout(pidT); pidT = setTimeout(function () { useProfile(profs[idx]); }, 250);
      penEl.style.transform = 'translate(' + (CX - BIG / 2 - 66) + 'px,' + (cy - 20) + 'px)';
    }
    // ---- background slideshow (transform/opacity only; next slide fully decoded before its crossfade)
    function slideEl() {
      var e = U.el('div', 'pslide'), bg = U.el('img', 'pslide-bg'), info = U.el('div', 'pslide-info');
      var lg = U.el('img', 'pslide-logo'), nm = U.txt('div', 'pslide-name', ''), tg = U.txt('div', 'pslide-tags', ''), ln = U.txt('div', 'pslide-line', '');
      info.appendChild(lg); info.appendChild(nm); info.appendChild(tg); info.appendChild(ln); e.appendChild(bg); e.appendChild(info);
      e._bg = bg; e._lg = lg; e._nm = nm; e._tg = tg; e._ln = ln; return e;
    }
    function decode(img, url) {
      return new Promise(function (res) {
        if (!url) { res(false); return; }
        img.onload = function () { if (img.decode) img.decode().then(function () { res(true); }, function () { res(true); }); else res(true); };
        img.onerror = function () { res(false); }; img.src = url;
      });
    }
    function showSlide(n) {
      var h = slides[n]; if (!h || !alive) return;
      var back = slideEls[1 - sFront], front = slideEls[sFront];
      Promise.all([decode(back._bg, A.img('background', h.imdb, 1280)), h.logo ? decode(back._lg, A.img('logo', h.imdb, 500)) : Promise.resolve(false)]).then(function (ok) {
        if (!alive) return;
        if (!ok[0]) { slideT = setTimeout(function () { next(); }, 500); return; }
        back._lg.style.display = ok[1] ? '' : 'none'; back._nm.textContent = ok[1] ? '' : (h.nameRo || h.name);
        back._tg.textContent = (h.genres || []).slice(0, 3).map(function (g) { return BF.i18n.genre(g); }).join('  •  ');
        back._ln.textContent = h.new ? BF.t('prof.slnew') : (h.year ? String(h.year) : '');
        back.classList.remove('kb'); void back.offsetWidth; back.classList.add('kb');
        back.classList.add('on'); front.classList.remove('on');
        sFront = 1 - sFront; sIdx = n;
        slideT = setTimeout(next, 7000);
      });
    }
    function next() { if (slides.length) showSlide((sIdx + 1) % slides.length); }
    // Per-profile showcase (server S8: GET /api/profiles/{id}/showcase, no ticket, no history leak). Until it exists, every
    // profile falls back to the general kid-safe featured list. Horror/Thriller are never shown.
    // Audience rule: never Horror/Thriller; adult profiles also never Animation/Family/Kids; kids profiles only kid-safe lists.
    var BAD = /horror|thriller/i, KIDG = /animation|family|kids|children/i;
    function isKids(p) { return p && (p.kind === 'kids' || p.kids); }
    function clean(list, adult) {
      var seen = {}, out = [];
      (list || []).forEach(function (x) {
        var g = x && x.genres || [];
        if (!x || x.backdrop === false || !x.imdb || seen[x.imdb] || out.length >= 8) return;
        if (g.some(function (v) { return BAD.test(v); })) return;
        if (adult && (g.some(function (v) { return KIDG.test(v); }) || (x.certAge != null && x.certAge < 12))) return;
        seen[x.imdb] = 1; out.push(x);
      });
      return out;
    }
    // adult fallback before S8: the profile's own featured picks cached by home.js the last time it was opened (no history)
    function cached(p) { try { return JSON.parse(localStorage.getItem('bf_show_' + p.id) || '[]'); } catch (e) { return []; } }
    function generalList() {
      if (!general) general = A.featured().then(function (d) { return clean((d.hero || []).concat(((d.rows || [])[0] || {}).items || []), false); }, function () { return []; });
      return general;
    }
    var DASH_IMG = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%20200%20200%27%3E%3Cdefs%3E%3ClinearGradient%20id%3D%27g%27%20x1%3D%270%27%20y1%3D%270%27%20x2%3D%271%27%20y2%3D%271%27%3E%3Cstop%20offset%3D%270%27%20stop-color%3D%27%235b3cff%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%2300b3c7%27/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%27200%27%20height%3D%27200%27%20fill%3D%27url%28%23g%29%27/%3E%3Ccircle%20cx%3D%2770%27%20cy%3D%2770%27%20r%3D%2722%27%20fill%3D%27%23ffd36b%27/%3E%3Crect%20x%3D%2738%27%20y%3D%27112%27%20width%3D%2756%27%20height%3D%2750%27%20rx%3D%2710%27%20fill%3D%27%23fff%27%20opacity%3D%27.9%27/%3E%3Crect%20x%3D%27106%27%20y%3D%2750%27%20width%3D%2756%27%20height%3D%2744%27%20rx%3D%2710%27%20fill%3D%27%23fff%27%20opacity%3D%27.9%27/%3E%3Crect%20x%3D%27106%27%20y%3D%27104%27%20width%3D%2756%27%20height%3D%2758%27%20rx%3D%2710%27%20fill%3D%27%23fff%27%20opacity%3D%27.55%27/%3E%3C/svg%3E';
    var DASH = { id: '__dash', name: 'Dashboard', dash: true };
    function withDash(l) { l = (l || []).filter(function (x) { return !x.dash; }); return localStorage.getItem('bf_dash') === '0' ? l : l.concat([DASH]); }
    function listFor(p) {
      if (p.dash) return Promise.resolve([]);
      var adult = !isKids(p);
      var fallback = function () { if (!adult) return generalList(); return clean(cached(p), true); };
      if (!byPid[p.id]) byPid[p.id] = A.get('/api/profiles/' + p.id + '/showcase', { retries: 0, noProfile: true })
        .then(function (d) { var l = clean(d.items || d.titles || [], adult); return l.length ? l : fallback(); }, fallback)
        .then(function (l) { if (l[0]) { var im = new Image(); im.src = A.img('background', l[0].imdb, 1280); } return l; });
      return byPid[p.id];
    }
    function useProfile(p) {
      if (!p || slidePid === p.id) return;
      listFor(p).then(function (l) {
        if (!alive || profs[idx] !== p) return;
        if (!l.length) { slidePid = p.id; slides = []; clearTimeout(slideT); slideEls[0].classList.remove('on'); slideEls[1].classList.remove('on'); return; } // gradient only
        var same = slides.length && l[0].imdb === slides[0].imdb;
        slidePid = p.id; slides = l;
        if (same && sIdx >= 0) return; // identical list (fallback): keep the running slideshow
        clearTimeout(slideT); sIdx = -1; showSlide(0);
      });
    }
    function loadSlides() { profs.forEach(listFor); }
    // keyed patch: an unchanged list writes nothing; renames/avatar/PIN changes update nodes in place; added/removed profiles
    // rebuild the list without the entrance animation; focus stays on the same profile id
    function sig(l) { return JSON.stringify((l || []).map(function (x) { return [x.id, x.name, x.kind, x.hasPin, x.avatarUrl]; })); }
    function refresh() {
      return A.profiles().then(function (d) {
        var nl = d.items || []; BF.state.profiles = nl; BF.state.profilesAt = Date.now();
        if (profs.length && sig(withDash(nl)) === sig(profs)) { useProfile(profs[idx]); return; }
        var curId = profs[idx] && profs[idx].id;
        nl.forEach(function (n) { profs.forEach(function (o) { if (o.id === n.id && sig([o]) !== sig([n])) delete byPid[n.id]; }); });
        var sameIds = profs.length === nl.length && profs.every(function (o, i) { return o.id === nl[i].id; });
        var first = !profs.length;
        nl = withDash(nl); profs = nl;
        if (sameIds) {
          profs.forEach(function (pp, i) { if (pp.dash) return; var img = items[i] && items[i].querySelector('img'); if (img) BF.images.load(img, A.avatar(pp), 1); var ph = items[i] && items[i].querySelector('.pav-ph'); if (ph) ph.textContent = (pp.name || '?').charAt(0); });
          layout();
        } else {
          render(!first);
          if (curId != null) for (var i = 0; i < profs.length; i++) if (profs[i].id === curId) { idx = i; layout(); }
        }
        loadSlides(); useProfile(profs[idx]);
      }, function () {});
    }
    function render(still) {
      list.textContent = ''; items = [];
      profs.forEach(function (p, i) {
        var it = U.el('div', 'pav' + (still ? ' pav--still' : ''));
        it.style.transitionDelay = '0ms';
        var img = U.el('img', 'art'); it.appendChild(U.txt('div', 'pav-ph', (p.name || '?').charAt(0)));
        it.appendChild(img); if (p.dash) { it.className += ' pav--dash'; img.src = DASH_IMG; img.classList.add('is-in'); } else BF.images.load(img, A.avatar(p), 1);
        it.appendChild(U.el('div', 'ring'));
        it.style.animationDelay = (i * 60) + 'ms'; it.style.setProperty('--d', (i * 60) + 'ms');
        list.appendChild(it); items.push(it);
      });
      var cur = A.profileId(); idx = 0;
      for (var i = 0; i < profs.length; i++) if (profs[i].id === cur) idx = i;
      layout();
    }
    return {
      mount: function (s) {
        sec = s; s.className += ' profs';
        s.appendChild(U.el('div', 'prof-grad c0'));
        slideEls = [slideEl(), slideEl()]; s.appendChild(slideEls[0]); s.appendChild(slideEls[1]);
        s.appendChild(U.el('div', 'prof-scrim'));
        s.appendChild(U.el('div', 'prof-wm', BF.logo.lockup(48)));
        s.appendChild(U.txt('div', 'prof-h', BF.t('prof.choose')));
        list = U.el('div', 'prof-list'); s.appendChild(list);
        lockEl = U.el('div', 'prof-lock', LOCK); s.appendChild(lockEl);
        penEl = U.el('div', 'prof-pen', PEN); s.appendChild(penEl);
        var blk = U.el('div', 'prof-nameblk'); nameEl = U.txt('div', 'prof-name', ''); subEl = U.txt('div', 'prof-sub', '');
        blk.appendChild(nameEl); blk.appendChild(subEl); s.appendChild(blk);
        s.appendChild(U.txt('div', 'prof-hint', BF.t('prof.hint')));
        profs = withDash(BF.state.profiles || []);
        loadSlides();
        if (profs.length) render();
        if (!(BF.state.profilesAt && Date.now() - BF.state.profilesAt < 5000 && profs.length)) refresh('mount'); else useProfile(profs[idx]);
        refT = setInterval(function () { if (!document.hidden) refresh('timer'); }, 60000);
      },
      onShow: function (restored) { if (restored && items.length) layout(); if (restored) refresh('show'); },
      refresh: refresh,
      unmount: function () { alive = false; clearTimeout(slideT); clearInterval(refT); },
      onKey: function (k) {
        if (!profs.length) return k !== 'back' ? true : (BF.dialog.exit(), true);
        if (k === 'up' && idx > 0) { idx--; layout(); return true; }
        if (k === 'down' && idx < profs.length - 1) { idx++; layout(); return true; }
        if (k === 'enter') {
          var p = profs[idx];
          if (p.dash) { BF.router.go('dash', null, { reset: true }); return true; }
          BF.selectProfile(p).catch(function (e) { BF.toast(BF.t('x.error', { e: e.message })); });
          return true;
        }
        if (k === 'back') { BF.dialog.exit(); return true; }
        return true;
      }
    };
  });
})(window);
