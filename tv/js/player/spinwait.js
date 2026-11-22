/* Player spinner state (round 7). Pure. The spinner shows whenever the video is not advancing:
   wait() arms it (open, seek, stall, buffering); only real progress clears it (pos > base + 0.3 s on 2 time callbacks). */
(function (root) {
  'use strict';
  var DELAY = 400, ADV = 0.3, NEED = 2, MSG1 = 5000, MSG2 = 15000;
  function init() { return { waiting: false, since: 0, base: 0, hits: 0 }; }
  function wait(s, now, pos) {
    if (!s.waiting) { s.waiting = true; s.since = now; }
    s.base = pos; s.hits = 0; return s;
  }
  // time callback; returns true when this call ended the wait
  function progress(s, pos) {
    if (!s.waiting) return false;
    if (pos - s.base > ADV) { s.hits++; s.base = pos; } else if (pos < s.base) s.base = pos;
    if (s.hits >= NEED) { s.waiting = false; s.hits = 0; return true; }
    return false;
  }
  function clear(s) { s.waiting = false; s.hits = 0; return s; }
  function visible(s, now) { return s.waiting && now - s.since >= DELAY; }
  function label(s, now, mode) {
    if (!s.waiting) return null;
    var d = now - s.since;
    if (d >= MSG2 && mode === 'transcode') return 'p.serverprep';
    if (d >= MSG1) return 'p.loading';
    return null;
  }
  var api = { init: init, wait: wait, progress: progress, clear: clear, visible: visible, label: label };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.spinwait = api; }
})(typeof window !== 'undefined' ? window : global);
