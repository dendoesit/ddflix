/* AVPlay engine (PLAN §4.8 call order). cb: {prepared, error(code), time(sec), buffer(on,pct), ended, info(obj)} */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  function AV() { return root.webapis && root.webapis.avplay; }
  function E() { this.cb = null; this.watch = null; this.seekLater = 0; this.t0 = 0; this.active = false; }
  E.available = function () { return !!AV(); };
  E.prototype.call = function (name, fn) {
    var av = AV();
    try { var r = fn(av); return r; } catch (e) {
      var st = ''; try { st = av.getState(); } catch (x) { /* */ }
      BF.log('avplay', name + ' threw', { state: st, name: e.name, msg: e.message });
      throw e;
    }
  };
  E.prototype.open = function (url, at, o, cb) {
    var self = this, av = AV(); this.cb = cb; this.t0 = Date.now(); this.seekLater = 0; this.active = true;
    var box = document.getElementById('av'); box.style.display = 'block';
    try { if (av.getState() !== 'NONE') { av.stop(); av.close(); } } catch (e) { /* */ }
    try {
      this.call('open', function (a) { a.open(url); });
      this.call('setListener', function (a) {
        a.setListener({
          onbufferingstart: function () { if (self.cb === cb) cb.buffer(true, 0); },
          onbufferingprogress: function (p) { if (self.cb === cb) cb.buffer(true, p); },
          onbufferingcomplete: function () { if (self.cb === cb) cb.buffer(false, 100); },
          oncurrentplaytime: function (ms) { if (self.cb === cb) cb.time(ms / 1000); },
          onstreamcompleted: function () { if (self.cb === cb) cb.ended(); },
          onerror: function (e) { BF.log('avplay', 'onerror ' + e); if (self.cb === cb) cb.error(String(e)); },
          onevent: function (t, d) { BF.log('avplay', 'event ' + t + ' ' + d); }
        });
      });
      this.call('setDisplayRect', function (a) { a.setDisplayRect(0, 0, 1920, 1080); });
      this.call('setDisplayMethod', function (a) { a.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); });
      if (o.uhd) { try { av.setStreamingProperty('SET_MODE_4K', 'TRUE'); BF.log('avplay', 'SET_MODE_4K'); } catch (e) { BF.log('avplay', '4K prop ' + e.message); } }
      // buffering (PLAN-ROUND6 2.4): seconds buffered before start / after a rebuffer; override via localStorage bf_buf="play,resume"
      var bp = o.uhd ? (BF.api.isLan() ? [6, 10] : [8, 15]) : [3, 6];
      try { var ov = (localStorage.getItem('bf_buf') || '').split(',').map(Number); if (ov[0] > 0 && ov[1] > 0) bp = ov; } catch (e) { /* */ }
      try { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', bp[0]); BF.log('avplay', 'buffer play ' + bp[0] + 's'); } catch (e) { BF.log('avplay', 'buffer play err ' + e.message); }
      try { av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', bp[1]); BF.log('avplay', 'buffer resume ' + bp[1] + 's'); } catch (e) { BF.log('avplay', 'buffer resume err ' + e.message); }
      if (o.hls) { try { av.setStreamingProperty('PREBUFFER_MODE', String(bp[0] * 1000)); } catch (e) { BF.log('avplay', 'prebuffer err ' + e.message); } }
      if (at > 1) { try { av.seekTo(Math.floor(at * 1000)); BF.log('avplay', 'seekTo in IDLE ' + Math.floor(at)); } catch (e) { self.seekLater = at; BF.log('avplay', 'IDLE seek failed, later'); } }
      clearTimeout(this.watch);
      this.watch = setTimeout(function () { if (self.cb === cb) { BF.log('avplay', 'prepare watchdog'); cb.error('PREPARE_TIMEOUT'); } }, o.hls ? 25000 : 20000);
      av.prepareAsync(function () {
        clearTimeout(self.watch);
        if (self.cb !== cb) return;
        BF.log('avplay', 'prepared in ' + (Date.now() - self.t0) + 'ms');
        try { var info = av.getCurrentStreamInfo(); cb.info && cb.info(info.map(function (x) { return x.type + ':' + x.extra_info; }).join(' ').slice(0, 400)); } catch (e) { /* */ }
        var selAudio = function () {
          if (o.audio != null) { try { var n = -1; av.getTotalTrackInfo().forEach(function (t) { if (t.type === 'AUDIO') { n++; if (n === o.audio) av.setSelectTrack('AUDIO', t.index); } }); BF.log('avplay', 'audio track ' + o.audio); } catch (e) { BF.log('avplay', 'audio select ' + e.message); } }
        };
        var go = function () { try { av.play(); selAudio(); cb.prepared(); } catch (e) { cb.error('PLAY ' + e.message); } };
        if (self.seekLater > 1) av.seekTo(Math.floor(self.seekLater * 1000), go, go); else go();
      }, function (e) { clearTimeout(self.watch); BF.log('avplay', 'prepare error ' + e); if (self.cb === cb) cb.error('PREPARE ' + e); });
    } catch (e) { clearTimeout(this.watch); var c = cb; setTimeout(function () { c.error('OPEN ' + (e.name || e.message)); }, 0); }
  };
  E.prototype.state = function () { try { return AV().getState(); } catch (e) { return 'NONE'; } };
  E.prototype.play = function () { var s = this.state(); if (s === 'PAUSED' || s === 'READY') try { AV().play(); } catch (e) { BF.log('avplay', 'play ' + e.message); } };
  E.prototype.pause = function () { if (this.state() === 'PLAYING') try { AV().pause(); } catch (e) { BF.log('avplay', 'pause ' + e.message); } };
  E.prototype.seek = function (sec, done) {
    var s = this.state();
    if (s !== 'PLAYING' && s !== 'PAUSED' && s !== 'READY') { if (done) done(); return; }
    try { AV().seekTo(Math.max(0, Math.floor(sec * 1000)), function () { if (done) done(); }, function (e) { BF.log('avplay', 'seek err ' + e); if (done) done(); }); } catch (e) { BF.log('avplay', 'seek ' + e.message); if (done) done(); }
  };
  E.prototype.duration = function () { try { return AV().getDuration() / 1000; } catch (e) { return 0; } };
  E.prototype.stop = function () {
    clearTimeout(this.watch); this.cb = null; this.active = false;
    try { var av = AV(); if (av.getState() !== 'NONE') { av.stop(); av.close(); } } catch (e) { /* */ }
    var box = document.getElementById('av'); if (box) box.style.display = 'none';
  };
  BF.EngineAV = E;
})(window);
