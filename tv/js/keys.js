/* Remote keys: registration, keyCode -> name, repeat throttle, long-press OK, dispatch to router. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var MAP = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 10009: 'back', 8: 'back', 27: 'back', 461: 'back',
    10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 10233: 'next', 10232: 'prev',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info', 65376: 'imedone', 65385: 'imecancel' };
  var REG = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  var last = {}, repeats = 0, okDown = 0, okTimer = null, okLong = false, handler = null;
  function name(code) {
    if (code >= 48 && code <= 57) return 'd' + (code - 48);
    if (code >= 96 && code <= 105) return 'd' + (code - 96);
    return MAP[code] || null;
  }
  var K = {
    init: function (h) {
      handler = h;
      try { root.tizen.tvinputdevice.registerKeyBatch(REG); } catch (e) {
        for (var i = 0; i < REG.length; i++) { try { root.tizen.tvinputdevice.registerKey(REG[i]); } catch (e2) { /* */ } }
      }
      try { BF.log('keys', 'supported', root.tizen.tvinputdevice.getSupportedKeys().map(function (k) { return k.name + '=' + k.code; }).join(',')); } catch (e) { /* */ }
      document.addEventListener('keydown', K.down, true);
      document.addEventListener('keyup', K.up, true);
    },
    held: function () { return repeats; },
    lastAt: Date.now(),
    idleMs: function () { return Date.now() - K.lastAt; },
    down: function (ev) {
      var n = name(ev.keyCode);
      if (!n) return;
      K.lastAt = Date.now();
      var a = document.activeElement;
      var inInput = a && a.tagName === 'INPUT';
      // let typing reach a focused input; arrows/back/enter still go to the screen
      if (inInput && /^d\d$/.test(n)) return;
      if (n !== 'imedone' && n !== 'imecancel') ev.preventDefault();
      var now = Date.now();
      if (n === 'enter') {
        if (okDown) return;  // auto-repeat ignored
        okDown = now; okLong = false;
        okTimer = setTimeout(function () { okLong = true; handler('longenter', ev); }, 600);
        return;
      }
      if (last.n === n && now - last.t < 110) return;
      repeats = last.n === n && now - last.t < 400 ? repeats + 1 : 0;
      last = { n: n, t: now };
      handler(n, ev);
    },
    up: function (ev) {
      var n = name(ev.keyCode);
      if (n === 'enter' && okDown) {
        clearTimeout(okTimer); okDown = 0;
        if (!okLong) handler('enter', ev);
      }
      if (n === last.n) repeats = 0;
    }
  };
  BF.keys = K;
})(window);
