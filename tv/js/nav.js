/* Geometry focus for free-form screens. nextFocus() is pure (test/nav.test.js). Focus = .foc class. */
(function (root) {
  'use strict';
  function nextFocus(rects, curId, dir) {
    var cur = null, i;
    for (i = 0; i < rects.length; i++) if (rects[i].id === curId) cur = rects[i];
    if (!cur) return rects.length ? rects[0].id : null;
    var cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2, best = null, bestScore = Infinity;
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.id === curId) continue;
      var rx = r.x + r.w / 2, ry = r.y + r.h / 2, dx = rx - cx, dy = ry - cy, main, cross;
      if (dir === 'left' || dir === 'right') {
        if (dir === 'left' ? dx >= -1 : dx <= 1) continue;
        if (cur.row != null && r.row !== cur.row) continue;
        main = Math.abs(dx); cross = Math.abs(dy);
      } else {
        if (dir === 'up' ? dy >= -1 : dy <= 1) continue;
        main = Math.abs(dy); cross = Math.abs(dx);
      }
      var score = main + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = r.id; }
    }
    return best;
  }
  var uid = 0;
  // Nav over a scope element: measure() caches rects; move() uses the cache.
  function Nav(scope) { this.scope = scope; this.cur = null; this.rects = []; this.map = {}; this.onFocus = null; }
  Nav.prototype.measure = function () {
    var els = this.scope.querySelectorAll('[data-f]'), out = [], map = {};
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.hasAttribute('data-off')) continue;
      var b = e.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      if (!e.id) e.id = 'f' + (++uid);
      var r = { id: e.id, x: b.left, y: b.top, w: b.width, h: b.height, row: e.getAttribute('data-row'), el: e };
      out.push(r); map[e.id] = r;
    }
    this.rects = out; this.map = map;
  };
  Nav.prototype.focus = function (el) {
    if (!el) return;
    if (this.cur && this.cur !== el) this.cur.classList.remove('foc');
    this.cur = el; el.classList.add('foc');
    if (this.onFocus) this.onFocus(el);
  };
  Nav.prototype.blur = function () { if (this.cur) this.cur.classList.remove('foc'); };
  Nav.prototype.refocus = function () { if (this.cur) this.cur.classList.add('foc'); };
  Nav.prototype.move = function (dir) {
    if (!this.rects.length) this.measure();
    if (this.cur && !this.map[this.cur.id]) { this.measure(); }
    var nid = nextFocus(this.rects, this.cur ? this.cur.id : null, dir);
    if (!nid || !this.map[nid]) return false;
    this.focus(this.map[nid].el);
    return true;
  };
  Nav.prototype.first = function (sel) {
    var e = sel ? this.scope.querySelector(sel) : this.scope.querySelector('[data-f]');
    if (e) this.focus(e);
    return e;
  };
  Nav.prototype.alive = function () { return this.cur && this.scope.contains(this.cur); };
  var api = { nextFocus: nextFocus, Nav: Nav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { root.BF = root.BF || {}; root.BF.nav = api; }
})(typeof window !== 'undefined' ? window : global);
