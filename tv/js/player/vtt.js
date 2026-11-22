/* WebVTT/SRT parser + binary-search cue lookup (pure; test/vtt.test.js). */
(function (root) {
  'use strict';
  function ts(s) {
    var p = s.trim().split(':'), h = 0, m, x;
    if (p.length === 3) { h = +p[0]; m = +p[1]; x = p[2]; } else { m = +p[0]; x = p[1]; }
    return h * 3600 + m * 60 + parseFloat(String(x).replace(',', '.'));
  }
  function parse(text) {
    var cues = [], blocks = String(text || '').replace(/\r/g, '').split(/\n\n+/);
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n'), j = -1;
      for (var k = 0; k < lines.length; k++) if (lines[k].indexOf('-->') >= 0) { j = k; break; }
      if (j < 0) continue;
      var ab = lines[j].split('-->');
      var body = lines.slice(j + 1).join('\n').replace(/<(?!\/?[ib]>)[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '');
      if (body.trim()) cues.push({ s: ts(ab[0]), e: ts(ab[1].trim().split(/\s+/)[0]), t: body });
    }
    cues.sort(function (a, b) { return a.s - b.s; });
    return cues;
  }
  // all cues active at t (overlaps allowed); binary search for the last cue starting <= t, then scan back a little
  function cueAt(cues, t) {
    var lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (cues[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    var out = [];
    for (var i = idx; i >= 0 && i > idx - 8; i--) if (cues[i].e > t) out.unshift(cues[i]);
    return out;
  }
  var api = { parse: parse, cueAt: cueAt };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.vtt = api; }
})(typeof window !== 'undefined' ? window : global);
