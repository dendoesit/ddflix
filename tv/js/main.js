/* Boot: splash -> Pair | Profiles. Global key routing: dialog > player > screen. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  BF.state = { profiles: [], profile: null, mylist: {}, mylistLoaded: false };
  BF.exitApp = function () {
    try { root.tizen.application.getCurrentApplication().exit(); } catch (e) { root.close(); }
  };
  BF.go = function (dest) {
    if (dest === 'search') BF.router.go('search', null, { reset: true });
    else if (dest === 'library') BF.router.go('home', { browse: '?inplex=1&sort=added', library: true, title: BF.t('nav.library') }, { reset: true });
    else if (dest === 'mylist') BF.router.go('home', { mode: 'mylist' }, { reset: true });
    else if (dest === 'series') BF.router.go('home', { type: 'series' }, { reset: true });
    else if (dest === 'movies') BF.router.go('home', { type: 'movie' }, { reset: true });
    else BF.router.go('home', null, { reset: true });
  };
  BF.applyProfile = function (p) {
    BF.state.profile = p;
    document.body.classList.toggle('kids', !!p && p.kind === 'kids');
  };
  BF.loadMylist = function () {
    return A.mylist().then(function (d) {
      var m = {}; (d.imdbs || (d.items || []).map(function (x) { return x.imdb; })).forEach(function (i) { m[i] = 1; });
      BF.state.mylist = m; BF.state.mylistLoaded = true; return d;
    });
  };
  BF.dlError = function (e) { var k = 'dl.e' + (e && e.status); var m = BF.t(k); return m && m !== k ? m : BF.t('x.error', { e: e && e.message }); };
  // select a profile: PIN profiles go through the PIN screen
  BF.selectProfile = function (p, pin) {
    if (p.hasPin && pin == null) { BF.router.go('pin', { profile: p }); return Promise.resolve(); }
    return A.selectProfile(p.id, pin || '').then(function (d) {
      A.setProfile(d.ticket ? p.id + '.' + d.ticket : String(p.id));
      BF.applyProfile(d.profile || p);
      BF.state.mylistLoaded = false;
      BF.router.go('home', null, { reset: true });
    }, function (e) {
      if (e.status === 403 && e.data && e.data.needPinSetup) {
        BF.dialog.open({ title: BF.t('prof.needpin.t'), body: BF.t('prof.needpin'), buttons: [{ label: BF.t('x.ok'), primary: true }] });
        return;
      }
      throw e;
    });
  };
  function onKey(k, ev) {
    if (BF.splashOn) { BF.splashFx.end(true); BF.splashOn = false; return; }
    if (BF.dialog.key(k)) return;
    if (BF.player && BF.player.isOpen() && BF.player.key(k, ev)) return;
    BF.router.key(k, ev);
  }
  function hideSplash() { /* the splash ends itself (fixed ~3 s, skippable); the app renders behind it */ }
  function unreachable() {
    BF.router.go('error', { onRetry: boot }, { reset: true });
  }
  BF.router.register('error', function () {
    var nav;
    return {
      mount: function (sec, params) {
        var U = BF.util, st = U.el('div', 'state');
        st.appendChild(U.txt('div', 'state-t', BF.t('x.unreach')));
        st.appendChild(U.txt('div', 'state-d', BF.t('x.unreach.d') + ' (' + A.bases().join(' · ') + ')'));
        var b1 = U.txt('div', 'btn btn--pri', BF.t('x.retry')); b1.setAttribute('data-f', ''); b1.onok = function () { params.onRetry(); };
        var b2 = U.txt('div', 'btn', BF.t('x.help')); b2.setAttribute('data-f', ''); b2.onok = function () { BF.router.go('help'); };
        st.appendChild(b1); st.appendChild(b2); sec.appendChild(st);
        nav = new BF.nav.Nav(sec); nav.focus(b1);
      },
      onShow: function () { if (nav) nav.measure(); },
      onKey: function (k) {
        if (k === 'enter') { if (nav.cur && nav.cur.onok) nav.cur.onok(); return true; }
        if (k === 'left' || k === 'right') { nav.move(k); return true; }
        if (k === 'back') { BF.dialog.exit(); return true; }
        return false;
      }
    };
  });
  function boot() {
    var t0 = Date.now();
    BF.log('boot', 'start ' + (root.BF_BUILD ? root.BF_BUILD.version + ' ' + root.BF_BUILD.time : ''));
    var minSplash = Promise.resolve(); // splash runs in parallel; it bursts once the app is ready
    var work = A.pick().then(function () {
      if (!A.token) return 'pair';
      return A.ping().then(function () {
        return A.profiles().then(function (d) { BF.state.profiles = d.items || []; BF.state.profilesAt = Date.now(); return 'profiles'; });
      }, function (e) { if (e.status === 401) { A.signOut(); return 'pair'; } throw e; });
    });
    Promise.all([work, minSplash]).then(function (r) {
      BF.log('boot', 'ready ' + r[0] + ' ' + (Date.now() - t0) + 'ms base=' + (A.isLan() ? 'lan' : 'remote'));
      BF.router.go(r[0] === 'profiles' && localStorage.getItem('bf_dash') !== '0' ? 'dash' : r[0], null, { reset: true });
      setTimeout(function () { BF.appRendered = true; }, 300); // first screen painted (profile avatars decode) before the crossfade
      if (BF.splashOn) hideSplash();
    }, function (e) {
      BF.log('boot', 'fail ' + e.message);
      unreachable(); BF.appRendered = true;
      if (BF.splashOn) hideSplash();
    });
  }
  BF.boot = boot;
  root.addEventListener('load', function () {
    BF.splashOn = true; BF.splashFx.end().then(function () { BF.splashOn = false; });
    var sp = document.createElement('div'); sp.id = 'rspin'; sp.className = 'rspin'; sp.innerHTML = '<div class="spin"></div>'; document.body.appendChild(sp);
    BF.router.init(document.getElementById('app'));
    BF.keys.init(onKey);
    A.onUnauthorized = function () {
      if (!A.token) return;
      BF.log('auth', '401 -> pair');
      if (BF.player && BF.player.isOpen()) BF.player.close(true);
      A.signOut(); BF.dialog.close(); BF.toast(BF.t('x.revoked'));
      BF.router.go('pair', null, { reset: true });
    };
    var lockedAt = 0;
    A.onProfileLocked = function () {
      if (Date.now() - lockedAt < 3000) return; lockedAt = Date.now();
      A.clearProfile(); if (BF.player && BF.player.isOpen()) BF.player.close(true); BF.dialog.close(); BF.toast(BF.t('prof.locked'));
      BF.router.go('profiles', null, { reset: true });
    };
    BF.life.init();
    boot();
  });
})(window);
