/* App lifecycle (PLAN-ROUND6 2.1): Tizen keeps the app frozen in memory across TV off/on. Detect the gap (visibility events +
   a 5 s wall-clock heartbeat), then reset idle state, refetch profiles, invalidate caches and refresh the visible screen. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var MIN = 60000, LONG_GAP_MS = 4 * 3600000;
  function classify(gap) {
    if (!(gap >= MIN)) return 'none';
    if (gap < 5 * MIN) return 'short';
    if (gap <= LONG_GAP_MS) return 'medium';
    return 'long';
  }
  var L = {
    LONG_GAP_MS: LONG_GAP_MS, classify: classify,
    hiddenAt: 0, beat: Date.now(), lastResume: 0, busy: false,
    init: function () {
      var self = this;
      var onVis = function () {
        var hidden = document.hidden || document.webkitHidden;
        if (hidden) { self.hiddenAt = Date.now(); if (BF.player) BF.player.visibility(true); return; }
        var gap = self.hiddenAt ? Date.now() - self.hiddenAt : 0; self.hiddenAt = 0; self.beat = Date.now();
        self.visible(gap);
      };
      document.addEventListener('visibilitychange', onVis);
      document.addEventListener('webkitvisibilitychange', onVis);
      setInterval(function () {
        var now = Date.now(), gap = now - self.beat; self.beat = now;
        if (gap > MIN && !(document.hidden || document.webkitHidden)) { BF.log('life', 'heartbeat gap ' + Math.round(gap / 1000) + 's'); self.resume(gap, 'beat'); }
      }, 5000);
    },
    // visible again after a hidden period: the player decides between reopening (short) and closing (medium/long)
    visible: function (gap) {
      var cls = classify(gap), P = BF.player;
      BF.log('life', 'visible after ' + Math.round(gap / 1000) + 's (' + cls + ')');
      if (P && P.isOpen()) { if (cls === 'none' || cls === 'short') P.visibility(false); else P.close(); }
      if (cls !== 'none') this.resume(gap, 'vis');
    },
    resume: function (gap, why) {
      var now = Date.now(), cls = classify(gap);
      if (cls === 'none' || now - this.lastResume < 2000 || this.busy) return;
      this.lastResume = now; this.busy = true;
      var self = this, A = BF.api;
      BF.log('life', 'resume ' + cls + ' gap=' + Math.round(gap / 1000) + 's via ' + why);
      if (BF.player && BF.player.onResume) BF.player.onResume();
      if (BF.player && BF.player.isOpen() && (cls === 'long' || (why !== 'vis' && cls === 'medium'))) BF.player.close(cls === 'long');
      // TV was off ≥5 min (Autorun resumes the frozen app): show the dashboard right away, not the last profile screen
      if (cls !== 'short' && BF_DASH_ON()) { var t0 = BF.router.top(); if (!(t0 && t0.name === 'dash')) BF.router.go('dash', null, { reset: true }); }
      var tries = 0;
      var net = function () { return A.pick().catch(function (e) { if (++tries >= 4) throw e; return new Promise(function (r) { setTimeout(r, 1500); }).then(net); }); };
      net().then(function () { return A.ping(); }).then(function () { return A.profiles(); }).then(function (d) {
        self.busy = false;
        var list = d.items || [];
        BF.state.profiles = list; BF.state.profilesAt = Date.now();
        self.invalidate();
        var pid = A.profileId(), fresh = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === pid) fresh = list[i];
        var top = BF.router.top();
        if (pid && !fresh) {
          A.clearProfile(); BF.toast(BF.t('prof.gone'));
          if (BF.player && BF.player.isOpen()) BF.player.close(true);
          BF.router.go('profiles', null, { reset: true }); return;
        }
        var toDash = BF_DASH_ON() && cls === 'medium';
        if (cls === 'long' || !pid || toDash) { if (!(top && (top.name === 'profiles' || top.name === 'dash'))) BF.router.go(BF_DASH_ON() ? 'dash' : 'profiles', null, { reset: true }); else if (top.scr.refresh) top.scr.refresh('resume'); return; }
        if (fresh && BF.applyProfile) BF.applyProfile(fresh);
        // ticket probe: a 403 "profile locked" goes through onProfileLocked (PIN changed)
        A.cont().then(function () { self.refreshTop('resume'); }, function () {});
      }, function (e) {
        self.busy = false;
        BF.log('life', 'resume offline: ' + (e && e.message));
        if (e && e.status === 401) return;
        BF.toast(BF.t('x.unreach'));
        self.lastResume = 0; self.beat = Date.now() - MIN - 1000; // retry on the next heartbeat
      });
    },
    invalidate: function () {
      BF.state.mylistLoaded = false; BF.state.progress = {};
      if (BF.titleCache && BF.titleCache.clear) BF.titleCache.clear();
      if (BF.player && BF.player.resetCaches) BF.player.resetCaches();
      BF.router.stack.forEach(function (e) { e.stale = true; });
    },
    refreshTop: function (why) {
      var top = BF.router.top(); if (!top) return;
      top.stale = false;
      if (top.scr && top.scr.refresh) top.scr.refresh(why);
    },
    _simulate: function (gapMs) { this.lastResume = 0; this.resume(gapMs, 'sim'); return classify(gapMs); }
  };
  BF.life = L;
  if (typeof module !== 'undefined') module.exports = L;
})(typeof window !== 'undefined' ? window : global);
