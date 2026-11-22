/* Help (PLAN §4.10): left list, right pane with description / result. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  BF.router.register('help', function () {
    var U = BF.util, sec, list, pane, idx = 0, its = [];
    var ITEMS = ['check', 'addr', 'lang', 'quality', 'reload', 'diag', 'signout', 'exit'];
    function setPane(title, lines, btns) {
      U.empty(pane);
      pane.appendChild(U.txt('div', 'hp-t', title));
      (lines || []).forEach(function (l) { pane.appendChild(U.txt('div', 'hp-l', l)); });
    }
    function describe() { var k = ITEMS[idx]; setPane(BF.t('help.' + k), [BF.t('help.d.' + k)].concat(extra(k))); }
    function extra(k) {
      if (k === 'addr') return ['LAN: ' + A.bases()[0], 'Remote: ' + A.bases()[1], 'Activ: ' + A.base];
      if (k === 'lang') return [BF.i18n.lang() === 'ro' ? 'Română ✓   ·   English' : 'Română   ·   English ✓'];
      if (k === 'quality') return [BF.t('q.' + (localStorage.getItem('bf_quality') || 'auto'))];
      return [];
    }
    function paint() { its.forEach(function (e, i) { e.classList.toggle('foc', i === idx); }); describe(); }
    function speed() {
      // any playable file of the current profile; 8 MB range read
      return A.cont().then(function (d) {
        var it = (d.items || []).filter(function (x) { return x.play; })[0];
        if (!it) return null;
        var t0 = Date.now();
        return fetch(A.base + '/api/media/' + it.play.id + '/file', { headers: (function () { var h = A.headers(); h.Range = 'bytes=0-8388607'; return h; })() })
          .then(function (r) { return r.arrayBuffer(); }).then(function (b) { return (b.byteLength * 8 / 1e6 / ((Date.now() - t0) / 1000)).toFixed(1); });
      });
    }
    function run() {
      var k = ITEMS[idx];
      if (k === 'check') {
        setPane(BF.t('help.check'), [BF.t('help.checking')]);
        A.pick().catch(function () {}).then(function () { return A.check(); }).then(function (r) {
          var lines = [A.base, r.ok ? BF.t('help.ok', { ms: r.ms }) : BF.t('help.err', { e: r.error })];
          if (r.device) lines.push(typeof r.device === 'string' ? r.device : (r.device.name || ''));
          setPane(BF.t('help.check'), lines.concat([BF.t('help.checking')]));
          speed().then(function (m) { lines.push(m ? BF.t('help.speed', { m: m }) : '—'); setPane(BF.t('help.check'), lines); }, function (e) { lines.push(BF.t('help.err', { e: e.message })); setPane(BF.t('help.check'), lines); });
        });
      } else if (k === 'addr') {
        var inp = document.createElement('input'); inp.type = 'url'; inp.className = 'dlg-in'; inp.value = localStorage.getItem('bf_lan') || A.defaults.lan;
        var node = U.el('div'); node.appendChild(inp);
        BF.dialog.open({ title: BF.t('help.addr'), node: node, buttons: [
          { label: BF.t('help.save'), primary: true, action: function () {
            var v = inp.value.trim();
            if (!/^https?:\/\/[^ ]+$/.test(v)) { BF.toast(BF.t('help.badurl')); return; }
            localStorage.setItem('bf_lan', v.replace(/\/$/, '')); localStorage.removeItem('bf_base');
            A.pick().then(function () { BF.toast(A.base); describe(); }, function () { BF.toast(BF.t('x.unreach')); describe(); });
          } },
          { label: BF.t('help.reset'), action: function () { localStorage.removeItem('bf_lan'); localStorage.removeItem('bf_base'); A.pick().then(describe, describe); } },
          { label: BF.t('x.cancel') }],
          onKey: function (kk) { if (kk === 'up') { inp.focus(); return true; } if (kk === 'imedone' || kk === 'down') { inp.blur(); return kk === 'imedone'; } return false; } });
        setTimeout(function () { inp.focus(); }, 200);
      } else if (k === 'lang') { BF.i18n.setLang(BF.i18n.lang() === 'ro' ? 'en' : 'ro'); BF.router.go('help', null, { replace: true }); }
      else if (k === 'quality') { var qs = ['auto', 'original', '1080', '720'], c = localStorage.getItem('bf_quality') || 'auto'; localStorage.setItem('bf_quality', qs[(qs.indexOf(c) + 1) % 4]); describe(); }
      else if (k === 'reload') location.reload();
      else if (k === 'diag') {
        var lines = ['DDFLIX ' + (root.BF_BUILD ? root.BF_BUILD.version + ' · ' + root.BF_BUILD.time : '')];
        try { lines.push('Tizen ' + root.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')); } catch (e) { /* */ }
        try { lines.push(root.webapis.productinfo.getRealModel() + ' · fw ' + root.webapis.productinfo.getFirmware()); } catch (e) { /* */ }
        lines.push(navigator.userAgent.slice(0, 90));
        setPane(BF.t('help.diag'), lines.concat(BF.log.dump(12)));
        BF.dialog.open({ title: BF.t('help.diag'), body: BF.t('help.lab') + '?', buttons: [{ label: BF.t('help.lab'), primary: true, action: function () { BF.router.go('lab'); } }, { label: BF.t('x.cancel') }] });
      } else if (k === 'signout') {
        BF.dialog.open({ title: BF.t('help.signout'), body: BF.t('help.signoutq'), buttons: [{ label: BF.t('help.signout'), action: function () { A.signOut(); BF.router.go('pair', null, { reset: true }); } }, { label: BF.t('x.cancel'), primary: true }], focus: 1 });
      } else if (k === 'exit') BF.dialog.exit();
    }
    return {
      mount: function (s) {
        sec = s; s.className += ' help';
        s.appendChild(U.txt('div', 'help-h', BF.t('help.title')));
        list = U.el('div', 'help-list'); s.appendChild(list);
        ITEMS.forEach(function (k) { var e = U.txt('div', 'hl', BF.t('help.' + k)); list.appendChild(e); its.push(e); });
        pane = U.el('div', 'help-pane'); s.appendChild(pane);
        paint();
      },
      onKey: function (k) {
        if (k === 'up' && idx > 0) { idx--; paint(); return true; }
        if (k === 'down' && idx < ITEMS.length - 1) { idx++; paint(); return true; }
        if (k === 'enter') { run(); return true; }
        if (k === 'back') { if (BF.router.stack.length > 1) BF.router.pop(); else BF.go('home'); return true; }
        return true;
      }
    };
  });
})(window);
