/* Modal dialog: focus trapped, Back = cancel button. BF.dialog.open({title, body, node, buttons:[{label, action, primary}], cancel}) */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {}, U, cur = null;
  function close() {
    var el = document.getElementById('dialog');
    el.className = ''; BF.util.empty(el); cur = null;
  }
  var D = {
    isOpen: function () { return !!cur; },
    open: function (o) {
      U = BF.util; if (cur) close();
      var el = document.getElementById('dialog');
      var card = U.el('div', 'dlg' + (o.wide ? ' dlg--wide' : ''));
      if (o.title) card.appendChild(U.txt('div', 'dlg-t', o.title));
      if (o.body) card.appendChild(U.txt('div', 'dlg-b', o.body));
      if (o.node) card.appendChild(o.node);
      var row = U.el('div', 'dlg-btns'), btns = [];
      (o.buttons || [{ label: BF.t('x.ok') }]).forEach(function (b, i) {
        var be = U.txt('div', 'btn' + (b.primary ? ' btn--pri' : ''), b.label);
        be.setAttribute('data-f', ''); be.setAttribute('data-row', 'dlg');
        be.onok = function () { close(); if (b.action) b.action(); };
        row.appendChild(be); btns.push(be);
      });
      card.appendChild(row);
      el.appendChild(card); el.className = 'on';
      var nav = new BF.nav.Nav(card);
      cur = { nav: nav, btns: btns, cancel: o.cancel != null ? o.cancel : btns.length - 1, onKey: o.onKey, onClose: o.onClose };
      nav.focus(btns[o.focus || 0]);
      return cur;
    },
    close: close,
    key: function (k) {
      if (!cur) return false;
      if (cur.onKey && cur.onKey(k)) return true;
      if (k === 'back') { var c = cur.btns[cur.cancel]; if (c) c.onok(); else close(); return true; }
      if (k === 'enter') { if (cur.nav.cur && cur.nav.cur.onok) cur.nav.cur.onok(); return true; }
      if (k === 'left' || k === 'right' || k === 'up' || k === 'down') { cur.nav.measure(); cur.nav.move(k); return true; }
      return true;   // modal: swallow everything else
    },
    exit: function () {
      D.open({ title: BF.t('x.exitq'), buttons: [{ label: BF.t('x.stay'), primary: true }, { label: BF.t('x.exit'), action: BF.exitApp }], cancel: 0 });
    }
  };
  BF.dialog = D;
})(window);
