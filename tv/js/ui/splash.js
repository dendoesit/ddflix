/* Splash, ~3 s cinematic, compositor-only (CSS transform/opacity keyframes keep running smoothly while the main
   thread is busy booting; a canvas loop got ~12 frames in 3 s on the 2021 TV).
   0-0.8 s streaks converge + letters slice in; 0.8-1.3 surge (glow, sweep, pulse); 1.3 flash + shockwave +
   ~150 streak particles to the screen edges + shake; 2.3-3.0 embers drift while the UI fades in. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var el, t0 = 0, doneRes, done, ended = false;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function div(cls, css) { var d = document.createElement('div'); d.className = cls; if (css) d.style.cssText = css; return d; }
  function build() {
    var L = BF.logo, H = 150, w = 900, ox = 510;
    var stage = div('sf-stage'), wrap = div('sf-wrap');
    // converging light streaks
    for (var i = 0; i < 28; i++) {
      var a = (i / 28) * 360 + rnd(-6, 6), len = rnd(260, 520), del = rnd(0, 380);
      var s = div('sf-streak', 'width:' + len + 'px;margin-left:' + (-len) + 'px;transform:rotate(' + a + 'deg);animation-delay:' + del + 'ms');
      s.style.setProperty('--r', a + 'deg'); stage.appendChild(s);
    }
    var full = div('sf-full', 'top:-120px;height:420px'); full.innerHTML = L.emblem(300) + '<div style="margin-top:6px">' + L.wordmark(60) + '</div>'; wrap.appendChild(full);
    full.style.animation = 'sfle 700ms cubic-bezier(.16,1,.3,1) 150ms both'; full.style.setProperty('--fx', '0px'); full.style.setProperty('--fy', '120px');
    var clip = div('sf-clip', 'left:' + Math.round(ox - 40) + 'px;width:' + Math.round(w + 80) + 'px'); clip.appendChild(div('sf-sweep')); wrap.appendChild(clip);
    stage.appendChild(wrap);
    stage.appendChild(div('sf-flash'));
    stage.appendChild(div('sf-ring')); stage.appendChild(div('sf-ring sf-ring2'));
    // burst particles (elongated glowing streaks pointing outward) + slow embers
    var cols = ['#ffffff', '#fff1d6', '#ffb36b', '#ff4a4a', '#ff1f6a', '#ff2bd6'];
    for (var k = 0; k < 60; k++) {
      var ang = rnd(0, 6.283), dist = rnd(700, 1300), ln = rnd(20, 90), th = rnd(3, 8), c = cols[(Math.random() * cols.length) | 0];
      var px = div('sf-p', 'width:' + ln + 'px;height:' + th + 'px;margin:' + (-th / 2) + 'px 0 0 ' + (-ln / 2) + 'px;background:linear-gradient(90deg,rgba(255,255,255,0),' + c + ');animation-duration:' + Math.round(rnd(650, 1100)) + 'ms;animation-delay:' + Math.round(1300 + rnd(0, 90)) + 'ms');
      px.style.setProperty('--a', (ang * 57.3) + 'deg'); px.style.setProperty('--d', dist + 'px');
      px.style.setProperty('--sx', (rnd(-40, 40)) + 'px');
      stage.appendChild(px);
    }
    for (var e = 0; e < 24; e++) {
      var sz = rnd(6, 16), c2 = cols[2 + ((Math.random() * 4) | 0)];
      var em = div('sf-em', 'width:' + sz + 'px;height:' + sz + 'px;margin:' + (-sz / 2) + 'px 0 0 ' + (-sz / 2) + 'px;background:radial-gradient(circle,#fff 0,' + c2 + ' 35%,rgba(0,0,0,0) 70%);animation-duration:' + Math.round(rnd(1300, 1700)) + 'ms;animation-delay:' + Math.round(1340 + rnd(0, 250)) + 'ms');
      em.style.setProperty('--x', rnd(-700, 700) + 'px'); em.style.setProperty('--y', rnd(-420, 420) + 'px'); em.style.setProperty('--y2', rnd(-60, 140) + 'px');
      stage.appendChild(em);
    }
    el.appendChild(stage);
  }
  function finish() { crossfade(1000); }
  // Primary: pre-rendered video (media/splash.mp4, 3.9 s, original sting) in an HTML5 <video> so the ending can be a real
  // ~700 ms crossfade into the profile screen underneath. Fallback: the CSS sequence above.
  var vid = null, xfading = false;
  // Ending (user decision): no overlap. The video holds its last frame and fades to full dark over 1 s (ease-in-out);
  // only then is the first screen revealed, replaying its normal entrance animation.
  // Entrance (user decision): the first screen zooms in (scale .92 -> 1, opacity 0 -> 1, 750 ms ease-out) with the profile
  // avatars staggered 60 ms (scale .85 -> 1). #app is pre-rasterised at opacity .001 under the opaque splash, so revealing it
  // costs no first-paint; the animation starts only once two consecutive frames arrive on time (main thread settled), and
  // all heavy work (splash display:none, video pipeline teardown) waits until the zoom has finished.
  function zoomEntrance(app, cb) {
    var last = 0, good = 0, t0z = performance.now();
    function tick(now) {
      if (last && now - last < 25) good++; else good = 0; last = now;
      if (good < 2 && now - t0z < 700) { requestAnimationFrame(tick); return; }
      app.classList.add('app-zoom'); // #app is already a composited layer at the 'from' values, so this costs no re-raster
      if (BF.splashTrace) BF.splashTrace.push(['entrance', Math.round(now)]);
      setTimeout(function () {
        // removing .app-zoom would re-enable the elements' own entrance keyframes (.pav pavIn, .screen--in scrIn) and replay
        // them = the visible 'second render'. Pin them to their end state first, then drop the classes with no visual change.
        var els = app.querySelectorAll('.pav, .pav > *, .screen--in');
        for (var i = 0; i < els.length; i++) els[i].style.animation = 'none';
        document.body.classList.remove('splashing'); app.classList.remove('app-zoom');
        if (BF.splashTrace) BF.splashTrace.push(['zoom-cleanup', Math.round(performance.now())]);
        cb();
      }, 1300);
    }
    requestAnimationFrame(tick);
  }
  function reveal() {
    var app = document.getElementById('app');
    if (doneRes) doneRes();
    var clean = function () { el.style.display = 'none'; if (vid) { try { vid.removeAttribute('src'); vid.load(); } catch (e) { /* */ } } el.innerHTML = ''; };
    if (app) zoomEntrance(app, clean); else { document.body.classList.remove('splashing'); clean(); }
  }
  // JS-driven fade (deterministic on Chromium 76): the TV renders <video> on a hardware plane that ignores DOM opacity and
  // goes black on 'ended', so at fade start the video is swapped for a DOM still of the same frame (media/splash-end.jpg,
  // t=5.2 s, inside the static hold) and that still is faded with rAF opacity steps, ease-in-out.
  var still = null;
  function crossfade(ms) {
    if (ended) return; ended = true; xfading = true;
    el.style.transition = 'none';
    if (vid) { if (still && still.complete) { still.style.visibility = 'visible'; } try { vid.pause(); } catch (e) { /* */ } vid.style.visibility = 'hidden'; }
    var f0 = 0;
    function step(now) {
      if (!f0) f0 = now; var p = Math.min(1, (now - f0) / ms), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      el.style.opacity = String(1 - e);
      if (BF.splashTrace) BF.splashTrace.push([Math.round(now), +(1 - e).toFixed(3)]);
      if (p < 1) requestAnimationFrame(step); else wait();
    }
    function wait() { if (BF.appRendered || Date.now() - t0 > 20000) reveal(); else setTimeout(wait, 50); }
    requestAnimationFrame(step);
  }
  function fallback(why) {
    if (ended || el.className) return; if (BF.log) BF.log('splash', 'video fallback: ' + why);
    if (vid && vid.parentNode) vid.parentNode.removeChild(vid); vid = null;
    try { build(); } catch (e) { crossfade(200); return; }
    el.className = 'go'; t0 = Date.now(); setTimeout(finish, 2300);
  }
  function startVideo() {
    // DDFLIX: the pre-rendered video still shows the old name -> always use the CSS sequence (DDFLIX wordmark)
    if (!BF.splashVideo) { fallback('ddflix css splash'); return; }
    vid = document.createElement('video'); vid.className = 'sf-vid'; vid.setAttribute('playsinline', ''); vid.preload = 'auto'; vid.volume = 0.5; // safety net on top of the -21.5 LUFS master
    vid.src = 'media/splash.mp4';
    still = document.createElement('img'); still.className = 'sf-vid'; still.src = 'media/splash-end.jpg'; still.style.visibility = 'hidden'; if (still.decode) still.decode().catch(function () {});
    el.appendChild(still); el.appendChild(vid);
    var started = false, guard = null;
    vid.addEventListener('playing', function () { started = true; clearTimeout(guard); t0 = Date.now(); if (BF.log) BF.log('splash', 'video playing'); });
    // start the 1 s fade 1.1 s before the end while the video is still playing (inside the static hold); 'ended' is only a backstop
    var poll = function () { if (ended) return; if (vid.duration && vid.currentTime >= vid.duration - 1.1) crossfade(1000); else requestAnimationFrame(poll); };
    requestAnimationFrame(poll);
    vid.addEventListener('ended', function () { crossfade(1000); });
    vid.addEventListener('error', function () { fallback('error ' + (vid.error && vid.error.code)); });
    var go = function () {
      if (document.visibilityState === 'hidden' || started) return;
      var p = vid.play(); if (p && p.catch) p.catch(function (e) { vid.muted = true; var p2 = vid.play(); if (p2 && p2.catch) p2.catch(function () { fallback('play refused ' + e.name); }); });
      clearTimeout(guard); guard = setTimeout(function () { if (!started) fallback('no start in 4 s'); }, 4000);
    };
    document.addEventListener('visibilitychange', go); root.addEventListener('load', go); go();
  }
  BF.splashFx = {
    start: function () {
      el = document.getElementById('splash'); if (!el) { document.body.classList.remove('splashing'); return; }
      BF.splashTrace = []; done = new Promise(function (r) { doneRes = r; });
      try { startVideo(); } catch (e) { fallback('ex ' + e.message); }
      setTimeout(function () { if (!ended) crossfade(400); }, 15000);
    },
    end: function (now) { if (now) crossfade(250); return done; },
    elapsed: function () { return Date.now() - t0; }
  };
  BF.splashFx.start();
})(window);
