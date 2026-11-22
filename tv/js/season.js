/* Seasonal decorations for the dashboard. ES2018 / Chromium 76 safe.
   Themes by date (override: localStorage bf_season = xmas|nye|ro1dec|halloween|easter|none|auto, or ?season=):
   - xmas (1 Dec – 6 Jan): multicolour light ropes on card tops, snow caps, snowbank, swinging baubles, periodic snowfall.
   - ro1dec (30 Nov – 1 Dec): tricolour ribbon.  - halloween (25–31 Oct): pumpkin garland + bats.  - easter (Orthodox, ±3 days): egg garland.
   Any month: real snowfall when the weather says it is snowing now. Snowfall uses magic-snowflakes (MIT, js/vendor). */
var BFS = (function () {
  'use strict';
  var snow = null, snowT = null, burstT = null, host = null;
  function pick(now, override) {
    var o = override || (location.search.match(/season=(\w+)/) || [])[1] || localStorage.getItem('bf_season') || 'auto';
    if (o !== 'auto') return o;
    var m = now.getMonth() + 1, d = now.getDate();
    if ((m === 12 && d >= 31) || (m === 1 && d === 1)) return 'nye';
    if (m === 11 && d >= 30 || (m === 12 && d === 1)) return 'ro1dec';
    if (m === 12 || (m === 11 && d >= 22) || (m === 1 && d <= 6)) return 'xmas';
    if (m === 10 && d >= 25) return 'halloween';
    if (window.BFX && BFX.easter) { var e = BFX.easter(now.getFullYear()); if (Math.abs(now - e) < 4 * 864e5) return 'easter'; }
    return 'none';
  }
  var COLS = ['#ff2a4f', '#ffd23f', '#2ee86a', '#2fa8ff', '#c45bff', '#ff8a1f'];
  function lights(card, n) {
    var w = card.offsetWidth || 400; n = n || Math.max(4, Math.round(w / 95));
    var h = '<svg class="wire" width="' + w + '" height="26" viewBox="0 0 ' + w + ' 26" preserveAspectRatio="none"><path d="';
    for (var i = 0; i <= n; i++) { var x = i * w / n; h += (i ? ' Q' + (x - w / n / 2).toFixed(1) + ' 22 ' : 'M') + x.toFixed(1) + ' 4'; }
    h += '" fill="none" stroke="#1d2a1d" stroke-width="2.5"/></svg>';
    for (var j = 0; j < n; j++) h += '<b style="left:' + ((j + .5) * 100 / n).toFixed(2) + '%;--c:' + COLS[j % COLS.length] + ';animation-delay:' + (-(j % 3) * .7 - Math.random() * .3).toFixed(2) + 's"></b>';
    var el = document.createElement('div'); el.className = 'sz-lights'; el.innerHTML = h; card.appendChild(el);
  }
  function cap(card) {
    var el = document.createElement('div'); el.className = 'sz-cap';
    var w = card.offsetWidth || 400, p = 'M0 18 ', x = 0;
    while (x < w) { var s = 30 + Math.random() * 50, y = 2 + Math.random() * 10; p += 'Q' + (x + s / 2).toFixed(0) + ' ' + (y - 6).toFixed(0) + ' ' + (x + s).toFixed(0) + ' ' + (8 + Math.random() * 6).toFixed(0) + ' '; x += s; }
    p += 'L' + w + ' 26 Q' + (w * .7).toFixed(0) + ' 34 ' + (w * .45).toFixed(0) + ' 24 Q' + (w * .2).toFixed(0) + ' 36 0 26Z';
    el.innerHTML = '<svg width="' + w + '" height="40" viewBox="0 0 ' + w + ' 40"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfe3ff"/></linearGradient></defs><path d="' + p + '" fill="url(#sg)"/>' +
      '<circle cx="' + (w * .23).toFixed(0) + '" cy="30" r="3" fill="#fff"/><circle cx="' + (w * .61).toFixed(0) + '" cy="27" r="2.4" fill="#fff"/><circle cx="' + (w * .82).toFixed(0) + '" cy="31" r="2" fill="#fff"/></svg>';
    card.appendChild(el);
  }
  function baubles(root) {
    var el = document.createElement('div'); el.className = 'sz-baubles';
    [['#ff2a4f', 70, 0], ['#ffd23f', 110, .6], ['#2fa8ff', 52, 1.1], ['#2ee86a', 90, .3]].forEach(function (b, i) {
      el.innerHTML += '<div class="bb" style="left:' + (i * 46) + 'px;animation-delay:-' + b[2] + 's"><i style="height:' + b[1] + 'px"></i><span style="--c:' + b[0] + '"></span></div>';
    });
    root.appendChild(el);
  }
  function bank(root) {
    var el = document.createElement('div'); el.className = 'sz-bank';
    el.innerHTML = '<svg width="1920" height="70" viewBox="0 0 1920 70" preserveAspectRatio="none"><path d="M0 70 L0 40 Q120 10 260 34 T560 30 T880 38 T1200 26 T1520 36 T1920 22 L1920 70Z" fill="#eef5ff" opacity=".95"/><path d="M0 70 L0 52 Q200 36 420 50 T900 48 T1400 52 T1920 44 L1920 70Z" fill="#fff"/></svg>';
    root.appendChild(el);
  }
  function garland(root, glyphs, cls) {
    var el = document.createElement('div'); el.className = 'sz-garland ' + (cls || ''); var h = '';
    for (var i = 0; i < 22; i++) h += '<span style="animation-delay:-' + (i * .37).toFixed(2) + 's">' + glyphs[i % glyphs.length] + '</span>';
    el.innerHTML = h; root.appendChild(el);
  }
  /* Canvas snow: pre-rendered sprites (soft bokeh discs + 6-arm crystals with glow), depth layers, sway, rotation, fade in/out. */
  var SPR = null;
  function sprites() {
    if (SPR) return SPR; SPR = [];
    [10, 16, 24].forEach(function (r) { var c = document.createElement('canvas'); c.width = c.height = r * 2; var x = c.getContext('2d'), g = x.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(255,255,255,.85)'); g.addColorStop(.7, 'rgba(225,238,255,.25)'); g.addColorStop(1, 'rgba(225,238,255,0)'); x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2); SPR.push({ c: c, r: r, rot: false }); });
    [22, 32].forEach(function (r) { var c = document.createElement('canvas'); c.width = c.height = r * 2; var x = c.getContext('2d'); x.translate(r, r);
      x.strokeStyle = '#fff'; x.lineCap = 'round'; x.shadowColor = 'rgba(190,220,255,.95)'; x.shadowBlur = r * .35; x.lineWidth = Math.max(1.6, r / 11);
      for (var k = 0; k < 6; k++) { x.save(); x.rotate(k * Math.PI / 3); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -r * .8);
        [.32, .56].forEach(function (f) { var y = -r * .8 * f, l = r * (.28 - f * .18); x.moveTo(0, y); x.lineTo(-l, y - l); x.moveTo(0, y); x.lineTo(l, y - l); }); x.stroke(); x.restore(); }
      x.beginPath(); x.arc(0, 0, r * .1, 0, 7); x.fillStyle = '#fff'; x.fill(); SPR.push({ c: c, r: r, rot: true }); });
    return SPR;
  }
  /* GPU snow: each flake is a sprite <img> moved only by CSS transform animations (compositor thread → smooth on the TV). */
  var URLS = null;
  function urls() { if (!URLS) URLS = sprites().map(function (o) { return { u: o.c.toDataURL('image/png'), r: o.r, rot: o.rot }; }); return URLS; }
  function snowStart(container, opts) {
    opts = opts || {}; var n = Math.min(opts.count || 26, 34), sp = opts.speed || 1;
    if (snow) { snow.el.style.opacity = 1; clearTimeout(snow.k); return; }
    var U = urls(), el = document.createElement('div'), h = '';
    el.className = 'sz-snow';
    for (var i = 0; i < n; i++) {
      var z = Math.random(), o = U[Math.random() < .22 ? 3 + (Math.random() < .5 ? 0 : 1) : Math.floor(z * 3)], d = Math.round(o.r * 2 * (.45 + z * .75));
      var fall = ((14 - z * 6) / sp).toFixed(1), sway = (3 + Math.random() * 3).toFixed(1), del = (-Math.random() * fall).toFixed(1);
      h += '<div class="fl" style="left:' + (Math.random() * 1900).toFixed(0) + 'px;opacity:' + (.55 + z * .45).toFixed(2) + ';animation-duration:' + fall + 's;animation-delay:' + del + 's">' +
        '<i class="sw" style="animation-duration:' + sway + 's;animation-delay:-' + (Math.random() * 6).toFixed(1) + 's"><img src="' + o.u + '" width="' + d + '" height="' + d + '"' + (o.rot ? ' class="rt" style="animation-duration:' + (8 + Math.random() * 8).toFixed(1) + 's"' : '') + '></i></div>';
    }
    el.innerHTML = h; container.appendChild(el);
    snow = { el: el, k: 0 }; void el.offsetWidth; el.style.opacity = 1;
  }
  function snowKill() { if (!snow) return; clearTimeout(snow.k); if (snow.el.parentNode) snow.el.parentNode.removeChild(snow.el); snow = null; }
  function snowStop() { if (!snow) return; snow.el.style.opacity = 0; snow.k = setTimeout(snowKill, 2600); }
  function apply(root, ctx) {
    remove(); host = root; ctx = ctx || {};
    var th = pick(new Date(), ctx.season); root.setAttribute('data-season', th);
    var layer = document.createElement('div'); layer.className = 'sz-layer'; root.appendChild(layer);
    var cards = root.querySelectorAll('.card:not([data-k=cam])');
    if (th === 'xmas' || th === 'nye') {
      for (var i = 0; i < cards.length; i++) { if (i % 2 === 0) lights(cards[i]); else cap(cards[i]); }
      baubles(root); bank(layer);
      var burst = function () { snowStart(layer, { count: 28 }); clearTimeout(snowT); snowT = setTimeout(function () { if (!ctx.snowingNow) snowStop(); }, 50000); };
      setTimeout(burst, 2500); burstT = setInterval(burst, 7 * 60000);
    } else if (th === 'ro1dec') garland(layer, ['🇷🇴'], 'flag');
    else if (th === 'halloween') garland(layer, ['🎃', '🦇', '🕸️']);
    else if (th === 'easter') garland(layer, ['🥚', '🐣', '🌷', '🐰']);
    if (ctx.snowingNow) snowStart(layer, { count: 35, speed: 1.2 });
    return th;
  }
  function remove() {
    clearInterval(burstT); clearTimeout(snowT); snowKill();
    if (!host) return;
    [].forEach.call(host.querySelectorAll('.sz-layer,.sz-lights,.sz-cap,.sz-baubles'), function (e) { e.parentNode.removeChild(e); });
    host.removeAttribute('data-season'); host = null;
  }
  return { apply: apply, remove: remove, pick: pick };
})();
