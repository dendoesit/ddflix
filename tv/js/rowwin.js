/* Home layout + virtualization math (pure, test/rowwin.test.js). Geometry from PLAN §10.3/§10.4. */
(function (root) {
  'use strict';
  var G = { firstTop: 990, title: 56, band: 450, meta: 186, margin: 40, focusTop: 120, poster: 300, step: 316, tile: 800 };
  G.rowH = G.title + G.band + G.margin;        // 546
  G.rowHF = G.rowH + G.meta;                   // 732
  function rowTop(i, focusedRow) {
    var y = G.firstTop;
    for (var k = 0; k < i; k++) y += (k === focusedRow ? G.rowHF : G.rowH);
    return y;
  }
  // model: {zone:'hero'|'tiles'|'rows'|'rail', row, col:[...]}; returns {Y, ys[]}
  function layout(model, n) {
    var fr = model.zone === 'rows' ? model.row : -1, ys = [];
    for (var i = 0; i < n; i++) ys.push(rowTop(i, fr));
    var Y = model.zone === 'rows' ? ys[model.row] - G.focusTop : 0;
    return { Y: Y, ys: ys };
  }
  function visibleRows(model, n) {
    var a, b;
    if (model.zone === 'rows') { a = model.row - 1; b = model.row + 1; } else { a = 0; b = 1; }
    var out = [];
    for (var i = Math.max(0, a); i <= Math.min(n - 1, b); i++) out.push(i);
    return out;
  }
  function windowCols(col, n, focused) {
    var end = Math.min(n, col + (focused ? 5 : 7));
    var out = [];
    for (var i = Math.max(0, col); i < end; i++) out.push(i);
    return out;
  }
  // vertical move between zones/rows; returns a new model (does not mutate)
  function vmove(model, dir, nRows, hasTiles) {
    var m = { zone: model.zone, row: model.row, col: model.col };
    if (dir === 'down') {
      if (m.zone === 'hero') m.zone = hasTiles ? 'tiles' : (nRows ? 'rows' : 'hero');
      else if (m.zone === 'tiles') { if (nRows) { m.zone = 'rows'; m.row = 0; } }
      else if (m.zone === 'rows' && m.row < nRows - 1) m.row++;
    } else if (dir === 'up') {
      if (m.zone === 'rows') { if (m.row > 0) m.row--; else m.zone = hasTiles ? 'tiles' : 'hero'; }
      else if (m.zone === 'tiles') m.zone = 'hero';
    }
    if (m.zone === 'rows' && m.row == null) m.row = 0;
    return m;
  }
  function hmove(col, dir, n, step) {
    step = step || 1;
    return Math.max(0, Math.min(n - 1, col + (dir === 'right' ? step : -step)));
  }
  // kids profiles: the Romanian-dub rail is lifted out of the server rows so it can sit right after Continue watching
  function splitRo(serverRows, isKids) {
    var ro = null, rest = [];
    (serverRows || []).forEach(function (r) { if (isKids && !ro && (r.key === 'k:ro' || r.key === 'ro')) ro = r; else rest.push(r); });
    return { ro: ro, rest: rest };
  }
  var api = { splitRo: splitRo, G: G, rowTop: rowTop, layout: layout, visibleRows: visibleRows, windowCols: windowCols, vmove: vmove, hmove: hmove };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.rowwin = api; }
})(typeof window !== 'undefined' ? window : global);
