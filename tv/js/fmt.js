/* Pure formatting helpers (unit-tested). */
(function (root) {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var F = {
    clock: function (s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(x); },
    // minutes -> "1 h 41 min" / "45 min"
    mins: function (m) { m = Math.round(m || 0); if (m <= 0) return ''; var h = Math.floor(m / 60), r = m % 60; return h ? h + ' h' + (r ? ' ' + r + ' min' : '') : r + ' min'; },
    left: function (dur, pos) { var m = Math.max(1, Math.round(((dur || 0) - (pos || 0)) / 60)); return F.mins(m); },
    se: function (s, e) { return 'S' + s + ' E' + e; },
    gb: function (b) { return (b / 1073741824).toFixed(1) + ' GB'; },
    years: function (a, b) { return b && b !== a ? a + '–' + b : String(a || ''); }
  };
  if (typeof module !== 'undefined') module.exports = F; else (root.BF = root.BF || {}).fmt = F;
})(typeof window !== 'undefined' ? window : global);
