/* <video> engine: same interface as AVPlay (HLS natively on Tizen; desktop preview). */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  function E() { this.v = document.getElementById('vid'); this.cb = null; this.watch = null; }
  E.prototype.open = function (url, at, o, cb) {
    var v = this.v, self = this; this.cb = cb; v.style.display = 'block';
    var started = false;
    v.onloadedmetadata = function () { if (self.cb !== cb) return; if (at > 1) try { v.currentTime = at; } catch (e) { /* */ } var p = v.play(); if (p && p.catch) p.catch(function (e) { BF.log('html5', 'play ' + e.message); }); };
    v.onplaying = function () { if (self.cb !== cb) return; cb.buffer(false, 100); if (!started) { started = true; clearTimeout(self.watch); cb.prepared(); } };
    v.onwaiting = function () { if (self.cb === cb) cb.buffer(true, 0); };
    v.ontimeupdate = function () { if (self.cb === cb) cb.time(v.currentTime); };
    v.onended = function () { if (self.cb === cb) cb.ended(); };
    v.onerror = function () { if (self.cb === cb) { clearTimeout(self.watch); cb.error('VIDEO_' + (v.error && v.error.code)); } };
    clearTimeout(this.watch);
    this.watch = setTimeout(function () { if (self.cb === cb && !started) cb.error('VIDEO_TIMEOUT'); }, 25000);
    v.src = url;
  };
  E.prototype.state = function () { return this.v.paused ? 'PAUSED' : 'PLAYING'; };
  E.prototype.play = function () { var p = this.v.play(); if (p && p.catch) p.catch(function () {}); };
  E.prototype.pause = function () { this.v.pause(); };
  E.prototype.seek = function (sec, done) { try { this.v.currentTime = Math.max(0, sec); } catch (e) { /* */ } if (done) setTimeout(done, 0); };
  E.prototype.duration = function () { return this.v.duration || 0; };
  E.prototype.stop = function () {
    clearTimeout(this.watch); this.cb = null;
    var v = this.v; v.onloadedmetadata = v.onplaying = v.onwaiting = v.ontimeupdate = v.onended = v.onerror = null;
    try { v.pause(); } catch (e) { /* */ }
    v.removeAttribute('src'); try { v.load(); } catch (e) { /* */ }
    v.style.display = 'none';
  };
  BF.EngineH5 = E;
})(window);
