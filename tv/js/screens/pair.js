/* Pair: 6-char code + QR to tv.example.com/#/settings?code=… (PLAN §4.2). */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  BF.router.register('pair', function () {
    var sec, U = BF.util, st = {}, pollT, cdT, alive = false, nav, newBtn;
    function model() { try { return root.webapis.productinfo.getRealModel(); } catch (e) { return ''; } }
    function render(d) {
      var codeEl = U.qs('.pair-code', sec); U.empty(codeEl);
      String(d.userCode).split('').forEach(function (c) { if (c !== '-') codeEl.appendChild(U.txt('span', 'pc', c)); });
      // the server knows its own address (WEB_URL in .env); fall back to webHost from config.js
      var url = d.verifyUrlComplete || ((/^https?:/.test(BF_CONFIG.webHost) ? '' : 'http://') + BF_CONFIG.webHost + '/#/pair?code=' + encodeURIComponent(d.userCode));
      try { BF.qr.draw(U.qs('canvas', sec), url, 400); } catch (e) { BF.log('pair', 'qr ' + e.message); }
      st.expires = Date.now() + (d.expiresIn || 600) * 1000;
      tick();
    }
    function tick() {
      clearTimeout(cdT); if (!alive) return;
      var s = Math.max(0, Math.round((st.expires - Date.now()) / 1000));
      U.qs('.pair-exp', sec).textContent = BF.t('pair.expires', { t: BF.fmt.clock(s) });
      cdT = setTimeout(tick, 1000);
    }
    function start(toast) {
      clearTimeout(pollT);
      return A.pairStart('Samsung TV ' + model()).then(function (d) {
        st.d = d; st.backoff = 0; render(d); if (toast) BF.toast(BF.t('pair.newcode'));
        poll();
      }, function (e) {
        if (e.status === 429) {
          var w = (e.data && e.data.retryAfter) || 60;
          U.qs('.pair-exp', sec).textContent = BF.t('pair.wait', { s: w });
          pollT = setTimeout(function () { start(); }, w * 1000);
        } else { pollT = setTimeout(function () { start(); }, 5000); }
      });
    }
    function poll() {
      if (!alive) return;
      pollT = setTimeout(function () {
        A.pairPoll(st.d.deviceCode).then(function (r) {
          if (r && r.token) {
            A.setToken(r.token); A.clearProfile();
            BF.log('pair', 'paired');
            A.profiles().then(function (p) { BF.state.profiles = p.items || []; BF.router.go('profiles', null, { reset: true }); });
            return;
          }
          st.backoff = 0; poll();
        }, function (e) {
          if (e.status === 410) { start(true); return; }
          if (e.status === 429) { st.backoff = 10; }
          else if (!e.status) st.backoff = Math.min(10, (st.backoff || 3) * 1.5);
          poll();
        });
      }, Math.max((st.d.interval || 3), st.backoff || 0) * 1000);
    }
    return {
      mount: function (s) {
        sec = s; alive = true; s.className += ' pair';
        var L = U.el('div', 'pair-l');
        L.appendChild(U.el('div', 'pair-wm', BF.logo.lockup(56)));
        L.appendChild(U.txt('div', 'pair-h', BF.t('pair.title')));
        var ol = U.el('div', 'pair-steps');
        ['pair.s1', 'pair.s2', 'pair.s3'].forEach(function (k, i) { var r = U.el('div', 'ps'); r.appendChild(U.txt('span', 'psn', String(i + 1))); r.appendChild(U.txt('span', 'pst', BF.t(k))); ol.appendChild(r); });
        L.appendChild(ol);
        L.appendChild(U.el('div', 'pair-code'));
        L.appendChild(U.txt('div', 'pair-exp', ''));
        newBtn = U.txt('div', 'btn', BF.t('pair.new')); newBtn.setAttribute('data-f', ''); newBtn.onok = function () { start(true); };
        L.appendChild(newBtn);
        var R = U.el('div', 'pair-r');
        var card = U.el('div', 'qr-card'); card.appendChild(U.el('canvas')); R.appendChild(card);
        R.appendChild(U.txt('div', 'qr-cap', BF.t('pair.scan')));
        s.appendChild(L); s.appendChild(R);
        nav = new BF.nav.Nav(s); nav.focus(newBtn);
        start();
      },
      unmount: function () { alive = false; clearTimeout(pollT); clearTimeout(cdT); },
      onKey: function (k) {
        if (k === 'enter') { newBtn.onok(); return true; }
        if (k === 'back') { BF.dialog.exit(); return true; }
        return k === 'left' || k === 'right' || k === 'up' || k === 'down';
      }
    };
  });
})(window);
