/* DDFLIX identity, emblem A ("ribbon B"): violet stem + two overlapping glossy lobes (magenta->orange, red->orange),
   wordmark in Oxanium ExtraBold (fonts/Oxanium.ttf, SIL OFL 1.1). Shared by the rail, profiles, pair, splash and icon. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var SHAPES = {
    stem: { rect: [34, 18, 44, 164, 22] },
    top: 'M56 18H112C142 18 160 36 160 60C160 84 142 100 112 100H56Z',
    bot: 'M56 92H122C154 92 172 112 172 138C172 164 154 182 122 182H56Z',
    shade: 'M56 92H112C135 92 150 96 158 104C142 100 128 100 112 100H56Z',
    gloss: 'M40 24C60 18 120 16 150 40C130 30 90 30 40 46Z'
  };
  var uid = 0;
  function emblem(px, o) {
    o = o || {}; var i = 'bfe' + (uid++);
    return '<svg class="bf-emblem" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="' + px + '" height="' + px + '">' +
      '<defs><linearGradient id="' + i + 'a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff2d7a"/><stop offset=".55" stop-color="#ff7a2f"/><stop offset="1" stop-color="#ffb347"/></linearGradient>' +
      '<linearGradient id="' + i + 'b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b3cff"/><stop offset="1" stop-color="#ff2d9a"/></linearGradient>' +
      '<linearGradient id="' + i + 'c" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff1f4b"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>' +
      '<linearGradient id="' + i + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>' +
      '<rect x="34" y="18" width="44" height="164" rx="22" fill="url(#' + i + 'b)"/>' +
      '<path d="' + SHAPES.top + '" fill="url(#' + i + 'a)" opacity=".93"/>' +
      '<path d="' + SHAPES.bot + '" fill="url(#' + i + 'c)" opacity=".9"/>' +
      '<path d="' + SHAPES.shade + '" fill="#000" opacity=".18"/>' +
      (o.flat ? '' : '<path d="' + SHAPES.gloss + '" fill="url(#' + i + 'g)"/>') + '</svg>';
  }
  function wordmark(px) { return '<span class="bf-wm" style="font-size:' + px + 'px">DDFLIX</span>'; }
  // horizontal lockup (profile screen header): emblem + wordmark
  function lockup(px) { return '<span class="bf-lock">' + emblem(Math.round(px * 1.25)) + wordmark(Math.round(px * 0.62)) + '</span>'; }
  BF.logo = { shapes: SHAPES, emblem: emblem, wordmark: wordmark, lockup: lockup, mark: function (h) { return emblem(h); }, svg: function (h) { return lockup(h); } };
})(window);
