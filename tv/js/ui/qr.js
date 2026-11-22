/* Minimal QR encoder (byte mode, ECC M, versions 1-6) + canvas renderer. Written for BUBUFLIX, no network.
   Algorithm after the ISO/IEC 18004 spec (structure follows Project Nayuki's reference description). Pure; tested. */
(function (root) {
  'use strict';
  // [total codewords, ec per block, blocks] for ECC level M
  var VER = [null, [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2], [172, 16, 4]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];
  function gmul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 255; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gmul(root, 2);
    }
    return r;
  }
  function rsRem(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gmul(c, f); });
    });
    return r;
  }
  function utf8(s) { var out = [], e = unescape(encodeURIComponent(s)); for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i)); return out; }
  function encode(text) {
    var bytes = utf8(text), v;
    for (v = 1; v <= 6; v++) { var cap = VER[v][0] - VER[v][1] * VER[v][2]; if (4 + 8 + bytes.length * 8 <= cap * 8) break; }
    if (v > 6) throw new Error('QR text too long');
    var total = VER[v][0], ecLen = VER[v][1], nb = VER[v][2], dataCap = total - ecLen * nb;
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, 8); bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, dataCap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (var pad = 0xEC; data.length < dataCap; pad ^= 0xEC ^ 0x11) data.push(pad);
    var per = dataCap / nb, blocks = [], ecs = [], div = rsDivisor(ecLen);
    for (i = 0; i < nb; i++) { var blk = data.slice(i * per, (i + 1) * per); blocks.push(blk); ecs.push(rsRem(blk, div)); }
    var cw = [];
    for (i = 0; i < per; i++) for (j = 0; j < nb; j++) cw.push(blocks[j][i]);
    for (i = 0; i < ecLen; i++) for (j = 0; j < nb; j++) cw.push(ecs[j][i]);
    var size = v * 4 + 17, mod = [], fn = [];
    for (i = 0; i < size; i++) { mod.push([]); fn.push([]); for (j = 0; j < size; j++) { mod[i].push(false); fn[i].push(false); } }
    function set(x, y, d) { mod[y][x] = d; fn[y][x] = true; }
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var al = ALIGN[v];
    for (i = 0; i < al.length; i++) for (j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    function format(mask) {
      var d = (0 << 3) | mask, rem = d;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((d << 10) | rem) ^ 0x5412;
      function g(k) { return ((fb >>> k) & 1) !== 0; }
      for (k = 0; k <= 5; k++) set(8, k, g(k));
      set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
      for (k = 9; k < 15; k++) set(14 - k, 8, g(k));
      for (k = 0; k < 8; k++) set(size - 1 - k, 8, g(k));
      for (k = 8; k < 15; k++) set(8, size - 15 + k, g(k));
      set(8, size - 8, true);
    }
    format(0);
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < cw.length * 8) { mod[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    var MASKS = [
      function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; }, function (x) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; }, function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return x * y % 2 + x * y % 3 === 0; }, function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }];
    function applyMask(m) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; }
    function penalty() {
      var p = 0, dark = 0, x, y, run;
      for (y = 0; y < size; y++) { run = 1; for (x = 1; x < size; x++) { if (mod[y][x] === mod[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (x = 0; x < size; x++) { run = 1; for (y = 1; y < size; y++) { if (mod[y][x] === mod[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { var c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (mod[y][x]) dark++;
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) { applyMask(m); format(m); var pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } applyMask(m); }
    applyMask(best); format(best);
    return { size: size, version: v, mask: best, modules: mod };
  }
  function draw(canvas, text, px) {
    var q = encode(text), quiet = 4, n = q.size + quiet * 2, s = Math.floor(px / n);
    canvas.width = canvas.height = n * s;
    var c = canvas.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, n * s, n * s); c.fillStyle = '#000';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) c.fillRect((x + quiet) * s, (y + quiet) * s, s, s);
    return q;
  }
  var api = { encode: encode, draw: draw };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.qr = api; }
})(typeof window !== 'undefined' ? window : global);
