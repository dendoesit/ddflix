/* Dashboard v3 (Aurora): one page, everything grouped; live HD camera via AVPlay (RTSP on LAN, HLS fallback, JPEG last).
   Any key -> profile picker. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  var HTML = '<div class="bgw"><div class="bg"></div><div class="blob" style="width:700px;height:700px;left:-160px;top:380px"></div><div class="blob" style="width:600px;height:600px;right:-120px;top:-160px"></div></div><div class="v3">' +
    '<div class="bar3"><div style="display:flex;align-items:baseline"><div class="time" data-k="time">--:--</div><div class="greet" data-k="greet"></div></div><div class="alerts" data-k="alerts"></div><div class="brand">DDFLIX<small data-k="date"></small></div></div>' +
    '<div class="cols">' +
      '<div class="col" style="width:500px;margin-right:26px">' +
        '<div class="card"><div class="lbl">Acasă · ' + BF.util.esc(BF_CONFIG.home.name) + '</div><div data-k="wx"></div></div>' +
        '<div class="card" data-k="air"></div>' +
        '<div class="card" style="flex:1;margin:0" data-k="tonight"></div>' +
      '</div>' +
      '<div class="col" style="flex:1;margin-right:26px">' +
        '<div class="card" style="padding:0;overflow:hidden" data-k="cam"></div>' +
        '<div class="card news" style="flex:1;margin:0"><div class="two"><div><div class="lbl">România</div><ul data-k="nro"></ul></div><div><div class="lbl">Lume</div><ul data-k="nw"></ul></div></div></div>' +
      '</div>' +
      '<div class="col" style="width:500px">' +
        '<div class="card" data-k="traffic"></div>' +
        '<div class="card" style="flex:1"><div class="lbl">Piețe & crypto</div><div data-k="cr"></div><div data-k="st"></div></div>' +
        '<div class="card" data-k="money"></div>' +
        '<div class="card" style="margin:0" data-k="sport"></div>' +
      '</div>' +
    '</div><div class="hint3">Apasă orice buton pentru profiluri</div></div>';
  var DEMO = '<span class="demo">DEMO</span>';
  BF.router.register('dash', function () {
    var cpT = 0; var root_, tT, rT, sT, alive = false, S = {}, camKey = null, avOn = false;
    function set(k, h) { var l = root_.querySelectorAll('[data-k="' + k + '"]'); for (var i = 0; i < l.length; i++) l[i].innerHTML = h; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function tick() { var c = BFD.clock(); set('time', c.hm); set('date', c.date); set('greet', BFD.greeting(c.h) + ', <b>' + esc(BF_CONFIG.ownerName) + '</b>'); }
    function cls(v) { return v >= 0 ? 'up' : 'dn'; }
    function pct(v) { return (v >= 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(2) + '%'; }
    function aic(t) { var m = /ninso|zăpad|zapad|viscol/i.test(t) ? ['snow', '❄️'] : /ceaț|ceat/i.test(t) ? ['fog', '🌫️'] : /ger|îngheț|inghet|polei/i.test(t) ? ['ice', '🧊'] : /vânt|vant|vijel/i.test(t) ? ['wind', '💨'] : /ploai|aver|furtun|orag/i.test(t) ? ['rain', '🌧️'] : /canicul|căldur/i.test(t) ? ['hot', '🔥'] : ['warn', '⚠️']; return '<i class="aic ' + m[0] + '">' + m[1] + '</i>'; }
    function kv(a, b) { return '<div class="kv"><span>' + a + '</span><span>' + b + '</span></div>'; }
    function news(a) { a = (a || []).slice(0, 8);
      if (!window._nsT) window._nsT = setInterval(function () { [].forEach.call(document.querySelectorAll('.dsh .nsl'), function (u) { var li = u.querySelectorAll('.ns'), dots = u.querySelectorAll('.nd i'), n = li.length; if (!n) return; var k = ((+u.getAttribute('data-i') || 0) + 1) % n; u.setAttribute('data-i', k); for (var i = 0; i < n; i++) { li[i].className = 'ns' + (i === k ? ' on' : i === (k + n - 1) % n ? ' out' : ''); if (dots[i]) dots[i].className = i === k ? 'on' : ''; } }); }, 10000);
      return '<div class="nsl" data-i="0">' + a.map(function (n, i) { var d = n.d || n.desc || ''; return '<div class="ns' + (i ? '' : ' on') + '"><div class="nt">' + esc(n.t || n.title) + '</div>' + (d ? '<div class="nx">' + esc(d) + '</div>' : '') + '<small>' + esc(n.s || n.source) + (n.ago ? ' · acum ' + esc(n.ago) : '') + '</small></div>'; }).join('') + '<div class="nd">' + a.map(function (_, i) { return '<i' + (i ? '' : ' class="on"') + '></i>'; }).join('') + '</div></div>'; }
    var LOGO = { 'BTC': ['#f7931a', '₿'], 'ETH': ['#627eea', 'Ξ'], 'SOL': ['#9945ff', 'S'], 'S&P 500': ['#1f4e9c', '🇺🇸'], 'NASDAQ': ['#0996c7', '🇺🇸'], 'BET': ['#002b7f', '🇷🇴'], 'NVDA': ['#76b900', 'N'], 'AAPL': ['#a2aaad', 'A'], 'EUR/RON': ['#003399', '€'], 'MSFT': ['#00a4ef', 'M'], 'TSLA': ['#cc0000', 'T'] };
    function logo(sym, img) {
      var L = LOGO[sym] || ['#556', String(sym).charAt(0)];
      return '<span class="lg" style="background:' + L[0] + '">' + (img ? '<img src="' + esc(img) + '">' : L[1]) + '</span>';
    }
    function mk(sym, p, ch, spark, img) { return '<div class="mk"><div class="s">' + logo(sym, img) + esc(sym) + '</div>' + (spark ? BFD.sparkSVG(spark, 90, 30, ch >= 0 ? '#4cf2a0' : '#ff6b81') : '<span style="width:90px"></span>') + '<div class="p">' + p + '</div><div class="ch ' + cls(ch) + '">' + pct(ch) + '</div></div>'; }

    // ---- live camera
    function camStop() {
      if (avOn) { try { root.webapis.avplay.stop(); root.webapis.avplay.close(); } catch (e) { /* */ } avOn = false; }
      clearInterval(sT); clearInterval(cpT); avHome();
    }
    // Tizen 9 (65") only shows the AVPlay plane where the HTML above it is really empty: an <object> nested in the
    // dashboard's rounded/clipped cards, over the opaque .bg layers, stays black. So do exactly what the movie player
    // does: #av never leaves #player (a root-level layer, no reparenting, only ONE avplayer object), it is sized to the
    // camera box, #player sits under #app, and the dashboard cuts a real hole (clip-path on .bgw, transparent card).
    function camRect() {
      var el = root_ && root_.querySelector('.camv'), x = 0, y = 0, n = el, p;
      if (!el) return null;
      // layout box, not getBoundingClientRect (the screen-in animation transforms it while we measure)
      while (n && n !== document.body) { x += n.offsetLeft; y += n.offsetTop; p = n.offsetParent; if (p && p !== document.body) { x += p.clientLeft; y += p.clientTop; } n = p; }
      return [x, y, el.offsetWidth, el.offsetHeight];
    }
    function avBorrow() {
      var o = document.getElementById('av'), r = camRect(), w = root_.querySelector('.bgw');
      if (!o || !r) return null;
      o.style.cssText = 'display:block;left:' + r[0] + 'px;top:' + r[1] + 'px;width:' + r[2] + 'px;height:' + r[3] + 'px';
      var x2 = r[0] + r[2], y2 = r[1] + r[3], P = function (a, b) { return a + 'px ' + b + 'px'; };
      var cp = 'polygon(evenodd,0 0,1920px 0,1920px 1080px,0 1080px,0 0,' + [P(r[0], r[1]), P(x2, r[1]), P(x2, y2), P(r[0], y2), P(r[0], r[1])].join(',') + ')';
      if (w) { w.style.webkitClipPath = cp; w.style.clipPath = cp; }
      root_.classList.add('cam-live'); document.body.classList.add('cam-on');
      return r;
    }
    function avHome() {
      var o = document.getElementById('av'), w = root_ && root_.querySelector('.bgw');
      document.body.classList.remove('cam-on'); if (root_) root_.classList.remove('cam-live');
      if (w) { w.style.webkitClipPath = ''; w.style.clipPath = ''; }
      if (o) o.style.cssText = '';
    }
    function camShow(c) {
      var key = c ? (c.rtsp || '') + (c.hls || '') + (c.snap || '') : '';
      if (key === camKey) return; camKey = key; camStop();
      var label = '<div class="lv"><b>●</b> LIVE · ' + esc((c && c.name) || 'Camera') + '</div>';
      if (!c) { set('cam', '<div class="camv" style="background:linear-gradient(160deg,#2b3340,#11161d)"><div class="lv">Camera · în curând</div></div>'); return; }
      var av = root.webapis && root.webapis.avplay;
      var urls = [];
      if (c.rtsp) urls.push(['rtsp', c.rtsp]);
      if (c.hls) urls.push(['hls', A.base + c.hls + '?t=' + encodeURIComponent(A.token)]);
      if (localStorage.getItem('bf_cam') === 'snap' || localStorage.getItem('bf_cam') === 'hd') urls = c.hls1080 && localStorage.getItem('bf_cam') === 'hd' ? [['hls', A.base + c.hls1080 + '?t=' + encodeURIComponent(A.token)]] : []; // per-TV: video plane shows black on some sets (65")
      if (av && urls.length) {
        // While the stream starts: the latest snapshot sits on top (labelled), fading out once real video frames advance.
        set('cam', '<div class="camv">' + label + (c.snap ? '<img class="cpo" src="' + A.base + c.snap + '?t=' + encodeURIComponent(A.token) + '&_=' + Date.now() + '"><div class="cpl">Se conectează la camera…</div>' : '') + '<div class="camr"></div></div>');
        if (c.warm) { try { fetch(A.base + c.warm + '?t=' + encodeURIComponent(A.token), { cache: 'no-store' }).catch(function () {}); } catch (e) { /* */ } }
        var posterOff = function () { clearInterval(cpT); var v = root_ && root_.querySelector('.camv'); if (v) v.classList.add('cam-on'); };
        clearInterval(cpT); cpT = setInterval(function () { try { if (av.getState() === 'PLAYING' && av.getCurrentTime() > 300) posterOff(); } catch (e) { /* */ } }, 250);
        var tryAt = function (i) {
          if (!alive) return;
          if (i >= urls.length) { camStop(); if (c.snap) snap(c, label); return; }
          var kind = urls[i][0];
          try {
            try { av.stop(); } catch (e) { /* */ } try { av.close(); } catch (e) { /* */ }
            var r = avBorrow(); // object visible + sized BEFORE open, as in engine-avplay
            if (!r) { camStop(); if (c.snap) snap(c, label); return; }
            av.open(urls[i][1]);
            av.setDisplayRect(r[0], r[1], r[2], r[3]);
            av.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            if (kind === 'hls') { try { av.setStreamingProperty('PREBUFFER_MODE', '2000'); } catch (e) { /* */ } }
            av.setListener({ onerror: function (e) { BF.log('dash', 'cam err ' + kind + ' ' + e); tryAt(i + 1); } });
            avOn = true;
            av.prepareAsync(function () { if (!alive) { camStop(); return; } av.play(); BF.log('dash', 'cam live ' + kind); },
              function (e) { BF.log('dash', 'cam prep ' + kind + ' ' + e); tryAt(i + 1); });
          } catch (e) { BF.log('dash', 'cam open ' + kind + ' ' + e.message); tryAt(i + 1); }
        };
        tryAt(0);
        return;
      }
      if (c.snap) snap(c, label);
    }
    function snap(c, label) {
      // double-buffered <img>: the new frame is decoded off-screen, then swapped on top (no black flash with no-store URLs)
      var u = function () { return A.base + c.snap + '?t=' + encodeURIComponent(A.token) + '&_=' + Date.now(); };
      set('cam', '<div class="camv">' + label + '<img class="cs" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover"><img class="cs" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:0"></div>');
      var ims = root_.querySelectorAll('.camv img.cs'), front = 0, busy = false;
      function next() {
        if (busy || !alive) return; busy = true;
        var back = ims[1 - front], x = u();
        back.onload = function () { back.style.opacity = 1; back.style.zIndex = 1; ims[front].style.zIndex = 0; ims[front].style.opacity = 0; front = 1 - front; busy = false; };
        back.onerror = function () { busy = false; };
        back.src = x;
      }
      ims[0].onload = function () { ims[0].style.zIndex = 1; }; ims[0].src = u();
      clearInterval(sT); sT = setInterval(next, 1000);
    }
    function fill() {
      BFD.load().then(function (D) {
        if (!alive) return;
        var w = D.home; S.wx = w; if (window.BFS) BFS.apply(root_.querySelector('.v3') || root_, { snowingNow: /❄|🌨/.test(w.icon || '') });
        set('wx', '<div class="wx"><div class="ic">' + w.icon + '</div><div><div class="t">' + w.temp + '°</div><div class="d">' + w.desc + '</div><div class="m">Resimțit ' + w.feels + '° · ' + w.hum + '% · ' + w.wind + ' km/h</div></div></div>' +
          '<div class="hours">' + w.hours.slice(0, 8).map(function (h) { return '<div>' + h.h + '<b>' + h.ic + '</b>' + h.t + '°</div>'; }).join('') + '</div>' +
          '<div class="days">' + w.days.map(function (d) { return '<div>' + d.d + '<span>' + d.ic + '</span>' + d.hi + '°<i>' + d.lo + '°</i></div>'; }).join('') + '</div>');
        var m = BFX.moon(new Date()), nd = BFX.nameDay(), hs = BFX.nextHolidays(1);
        var rain = Math.max.apply(null, w.hours.slice(0, 6).map(function (h) { return h.p || 0; }));
        set('tonight', '<div class="lbl">Azi & seara asta</div>' +
          (nd ? kv('🕯️ ' + esc(nd.today ? nd.saint : 'În ' + nd.days + ' zile: ' + nd.saint), '') + '<div class="sm" style="margin:-4px 0 4px">La mulți ani: ' + esc(nd.names) + '</div>' : '') +
          kv(m.icon + ' ' + m.name, m.illum + '%') + kv('🌅 Apus · răsărit', w.sunset + ' · ' + w.sunrise) + kv('☔ Ploaie în 6 h', rain + '%') +
          hs.map(function (h) { return kv(h.icon + ' ' + h.name, h.days === 0 ? 'azi' : h.days === 1 ? 'mâine' : 'în ' + h.days + ' zile'); }).join(''));
        S.crypto = D.crypto; markets(); alerts();
        BFX.air(BF_CONFIG.home.lat, BF_CONFIG.home.lon).then(function (a) {
          var L = BFX.aqiLabel(a.aqi), P = BFX.pollenLabel(a.pollen);
          set('air', '<div class="lbl">Aer & polen</div><div class="two"><div><div style="display:flex;align-items:center"><div class="bigv">' + Math.round(a.aqi) + '</div><span class="pill ' + L[1] + '" style="margin-left:14px">' + L[0] + '</span></div></div><div>' +
            kv('UV', Math.round(a.uv) + ' · ' + BFX.uvLabel(a.uv)) + kv('Polen', '<span class="pill ' + P[1] + '" style="margin:0">' + P[0] + '</span>') + kv('PM2.5', Math.round(a.pm25)) + '</div></div>');
        }, function () { set('air', '<div class="lbl">Aer & polen</div>' + DEMO + '<div class="two"><div><div style="display:flex;align-items:center"><div class="bigv">38</div><span class="pill g" style="margin-left:14px">Aer bun</span></div></div><div>' + kv('UV', '1 · scăzut') + kv('Polen', '<span class="pill g" style="margin:0">Scăzut</span>') + kv('PM2.5', '9') + '</div></div>'); });
      }, function (e) { BF.log('dash', 'load fail ' + (e && e.message)); });
      (A.profileId() ? A.cont() : Promise.reject()).then(function (d) {
        var it = (d.items || []).filter(function (x) { return x.play; }).slice(0, 4);
        if (!it.length) throw 0;
        set('cont', '<div class="strip">' + it.map(function (x) {
          var p = x.play;
          return '<div class="pst"><div class="im" style="background-image:url(\'' + A.img('background', x.imdb, 400) + '\')"><i style="width:' + Math.round((p.pct || 0) * 100) + '%"></i></div><div class="n">' + (p.season ? 'S' + p.season + 'E' + p.episode + ' · ' : '') + esc(x.name) + '</div></div>';
        }).join('') + '</div>');
      }).catch(function () { set('cont', DEMO + '<div class="strip">' + ['Sneaky Pete · S2E3', 'Minions', 'Ali G', 'Bluey'].map(function (n, i) { return '<div class="pst"><div class="im" style="background:linear-gradient(160deg,' + ['#c0392b,#2c3e50', '#f1c40f,#16a085', '#8e44ad,#2980b9', '#e67e22,#34495e'][i] + ')"><i style="width:' + [40, 70, 20, 55][i] + '%"></i></div><div class="n">' + n + '</div></div>'; }).join('') + '</div>'); });
      BFX.bnr().then(function (b) { S.bnr = b; money(); }, function () { money(); });
      BFX.fuel().then(function (f) { S.fuel = f; money(); }, function () { /* keep server/demo */ });
      A.get('/api/dashboard', { retries: 0, noProfile: true }).then(function (d) { d.live = true; return d; }, function () { return { live: false }; })
        .then(function (d) { if (!alive) return; S.srv = d; serverFill(d); money(); alerts(); markets(); });
    }
    function markets() {
      var st = (S.srv && S.srv.stocks) || BFD.demo.stocks;
      set('cr', (S.crypto || []).map(function (c) { return mk(c.sym, '$' + BFD.fmt(c.p), c.ch, c.spark, c.img); }).join(''));
      st = st.filter(function (s) { return !/EUR\/RON|AAPL/.test(s.sym); }).slice(0, 4);
      set('st', '<div class="stg">' + st.map(function (s, i) { return '<div class="stt p' + (i >> 1) + '"><div class="s">' + logo(s.sym) + esc(s.sym) + '</div><div class="p">' + BFD.fmt(s.p) + ' <span class="' + cls(s.ch) + '">' + pct(s.ch) + '</span></div></div>'; }).join('') + '</div>' + (S.srv && S.srv.stocks ? '' : DEMO));
      clearInterval(window._stT); window._stT = setInterval(function () { var g = root_ && root_.querySelector('.stg'); if (g) g.classList.toggle('pg1'); }, 8000);
    }
    function money() {
      var sb = S.srv && S.srv.bnr, b = (sb && +sb.EUR) ? { EUR: +sb.EUR, USD: +sb.USD } : (S.bnr && +S.bnr.EUR ? { EUR: +S.bnr.EUR, USD: +S.bnr.USD } : {}), f = S.fuel || (S.srv && S.srv.fuel);
      set('money', '<div class="lbl">Curs BNR & carburanți</div>' + (f && b.EUR && !f.dummy ? '' : DEMO) + '<div class="two"><div>' +
        kv('<i class="cur">€</i>EUR', b.EUR ? b.EUR.toFixed(4) : '5.0912') + kv('<i class="cur">$</i>USD', b.USD ? b.USD.toFixed(4) : '4.6420') + '</div><div>' +
        kv('⛽ Benzină', f ? f.gas.toFixed(2) : '7,49') + kv('⛽ Motorină', f ? f.diesel.toFixed(2) : '7,62') + (S.fuel ? '<div class="fsrc">min. ' + BF.util.esc(BF_CONFIG.home.name) + ' · ' + esc(S.fuel.gasAt) + '</div>' : '') + '</div></div>');
    }
    function alerts() {
      var a = (S.srv && S.srv.alerts) || [];
      if (S.wx) a = a.concat(BFX.wxAlerts(S.wx).filter(function (x) { return !a.some(function (y) { return y.t === x.t; }); }));
      set('alerts', a.slice(0, 3).map(function (x) { return '<span class="pill ' + (x.lvl || 'y') + '">' + aic(x.t + ' ' + (x.d || '')) + esc(x.t) + (x.d ? ' · ' + esc(x.d) : '') + '</span>'; }).join(''));
    }
    function serverFill(d) {
      set('nro', news((d.news && d.news.ro) || BFD.demo.newsRo)); set('nw', news((d.news && d.news.world) || BFD.demo.newsWorld));
      var TR = BF_CONFIG.routes.map(function (q) { return { k: new RegExp(q.match, 'i'), ic: q.icon, to: q.label, min: q.demoMin, delay: 0 }; });
      var rr = (d.traffic && d.traffic.routes) || [], live = 0;
      var rows = TR.map(function (x) { var r = rr.filter(function (q) { return x.k.test(q.to || ''); })[0]; if (r) live++; r = r || x; var m = r.min, hm = m >= 90 ? Math.floor(m / 60) + 'h ' + ('0' + m % 60).slice(-2) : m + ' min';
        return '<div class="trr"><span class="tri">' + x.ic + '</span><span class="trn">' + esc(x.to) + '</span><span class="trm">' + hm + '</span><span class="pill ' + (r.delay > 10 ? 'r' : r.delay > 3 ? 'y' : 'g') + '">' + (r.delay ? '+' + r.delay : 'fluent') + '</span></div>'; }).join('');
      set('traffic', '<div class="lbl">Trafic · din ' + BF.util.esc(BF_CONFIG.home.name) + '</div>' + (live && !d.traffic.dummy ? '' : DEMO) + rows);
      var sp = d.sport || [{ t: 'FCSB – Dinamo', when: 'Dum 20:30' }, { t: 'Real Madrid – Barcelona', res: '2 – 1' }];
      set('sport', '<div class="lbl">Sport</div>' + (d.sport ? '' : DEMO) + sp.slice(0, 3).map(function (m) { return kv(esc(m.t), m.res ? '<b>' + esc(m.res) + '</b>' : '<span class="pill r" style="margin:0">' + esc(m.when) + '</span>'); }).join(''));
      camShow(d.camera || null);
    }
    return {
      mount: function (s) {
        alive = true;
        root_ = document.createElement('div'); root_.className = 'dsh'; root_.innerHTML = HTML; s.appendChild(root_);
        camShow(null); tick(); tT = setInterval(tick, 10000); fill(); rT = setInterval(fill, 600000);
      },
      onHide: function () { camKey = null; camStop(); },
      onShow: function (restored) { if (restored && S.srv) camShow(S.srv.camera || null); },
      unmount: function () { alive = false; if (window.BFS) BFS.remove(); clearInterval(window._stT); camStop(); clearInterval(tT); clearInterval(rT); },
      onKey: function () { camStop(); BF.router.go('profiles', null, { reset: true }); return true; }
    };
  });
})(this);
