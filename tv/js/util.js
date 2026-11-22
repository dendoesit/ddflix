(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var U = {
    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
    qs: function (sel, r) { return (r || document).querySelector(sel); },
    qsa: function (sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); },
    el: function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; },
    txt: function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    debounce: function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; },
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    raf: function (fn) { return (root.requestAnimationFrame || setTimeout)(fn); },
    empty: function (e) { if (BF.images) BF.images.release(e); e.textContent = ''; }
  };
  BF.util = U;
})(window);
