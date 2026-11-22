/* Desktop preview shim (never packaged: build.sh copies no dev/; index.html loads it only when window.tizen is missing).
   Keys: arrows/Enter as on the remote, Backspace/Esc = Back, r/g/y/b = colour keys, p = play/pause, [ ] = rewind/ff. */
(function () {
  'use strict';
  window.tizen = {
    tvinputdevice: { registerKeyBatch: function () {}, registerKey: function () {}, getSupportedKeys: function () { return []; } },
    application: { getCurrentApplication: function () { return { exit: function () { document.body.innerHTML = '<p style="font:40px sans-serif;color:#fff;padding:100px">exit()</p>'; } }; } },
    systeminfo: { getCapability: function () { return 'desktop'; } }
  };
  // no webapis.avplay -> the player uses the <video> engine (HLS plays in Safari; in Chrome only direct MP4 or with a native HLS build)
  var MAP = { r: 403, g: 404, y: 405, b: 406, p: 10252, '[': 412, ']': 417, i: 457 };
  document.addEventListener('keydown', function (e) {
    var a = document.activeElement; if (a && a.tagName === 'INPUT') return;
    var c = MAP[e.key];
    if (!c) return;
    e.stopImmediatePropagation(); e.preventDefault();
    ['keydown', 'keyup'].forEach(function (t) { var ev = document.createEvent('Event'); ev.initEvent(t, true, true); ev.keyCode = c; ev.which = c; document.dispatchEvent(ev); });
  }, true);
  // fit 1920x1080 into smaller windows
  function fit() { var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080); document.documentElement.style.zoom = s < 1 ? s : 1; }
  window.addEventListener('resize', fit); window.addEventListener('load', fit);
})();
