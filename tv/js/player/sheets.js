/* Player sheets: Audio & subtitles, Quality (right panel). */
(function (root) {
  'use strict';
  var BF = root.BF;
  var cur = null;
  function el() { return document.querySelector('#pui .p-sheet'); }
  function render() {
    var U = BF.util, e = el(), st = BF.player.state(); U.empty(e);
    cur.items = [];
    if (cur.kind === 'as') {
      e.appendChild(U.txt('div', 'sh-h', BF.t('title.audio')));
      (st.m.audio || []).forEach(function (a) { add(e, a.label, a.n === st.audio, { audio: a.n }); });
      e.appendChild(U.txt('div', 'sh-h', BF.t('title.subs')));
      add(e, BF.t('title.none'), !st.sub, { sub: null });
      var subs = (st.m.subs || []).filter(function (x) { return x.text; });
      var main = subs.filter(function (x) { return x.group !== 'more'; }), more = subs.filter(function (x) { return x.group === 'more'; });
      main.forEach(function (x) { add(e, x.display || x.label, x.key === st.sub, { sub: x.key }); });
      if (more.length && (cur.expanded || main.length + more.length <= 6)) more.forEach(function (x) { add(e, x.display || x.label, x.key === st.sub, { sub: x.key }); });
      else if (more.length) add(e, BF.t('p.more'), false, { expand: true });
    } else {
      e.appendChild(U.txt('div', 'sh-h', BF.t('p.quality')));
      var r = String(st.m.res || ''), n = /4k|2160/i.test(r) ? 2160 : parseInt(r, 10) || 0;
      var oh = n >= 1600 ? 2160 : n >= 780 ? 1080 : n >= 500 ? 720 : n, ol = oh === 2160 ? '4K' : oh ? oh + 'p' : '';
      ['auto', 'original', '1080', '720'].forEach(function (q) {
        if ((q === '1080' || q === '720') && oh && +q >= oh) return;
        add(e, BF.t('q.' + q) + (q === 'original' && ol ? ' · ' + ol : ''), st.quality === q, { quality: q });
      });
      var r = st.mode === 'direct' ? BF.t('p.directok') : BF.t('p.decision', { r: ((st.plan && st.plan.reasons) || [])[0] || st.mode });
      e.appendChild(U.txt('div', 'sh-note', r));
    }
    cur.idx = Math.min(cur.idx, cur.items.length - 1);
    paint();
  }
  function add(e, label, on, act) {
    var it = BF.util.txt('div', 'sh-it' + (on ? ' on' : ''), label); it._act = act; e.appendChild(it); cur.items.push(it);
    if (on && cur.idx == null) cur.idx = cur.items.length - 1;
  }
  function paint() {
    cur.items.forEach(function (it, i) { it.classList.toggle('foc', i === cur.idx); });
  }
  BF.sheets = {
    refresh: function () { if (cur && cur.kind === 'as' && el()) render(); },
    open: function (kind) { cur = { kind: kind, idx: null }; el().classList.add('on'); document.getElementById('player').classList.add('sheet'); render(); if (cur.idx == null) { cur.idx = 0; paint(); } },
    close: function () { cur = null; document.getElementById('player').classList.remove('sheet'); var e = el(); if (e) { e.classList.remove('on'); e.style.transform = ''; } },
    key: function (k) {
      if (!cur) return false;
      var P = BF.player, st = P.state();
      if (k === 'up') { cur.idx = Math.max(0, cur.idx - 1); paint(); }
      else if (k === 'down') { cur.idx = Math.min(cur.items.length - 1, cur.idx + 1); paint(); }
      else if (k === 'back' || k === 'left' || (k === 'red' && cur.kind === 'as') || (k === 'green' && cur.kind === 'quality')) { BF.sheets.close(); P.sheetClosed(); }
      else if (k === 'enter') {
        var a = cur.items[cur.idx]._act;
        if (a.expand) { cur.expanded = true; render(); return true; }
        if ('audio' in a) { if (a.audio !== st.audio) { BF.sheets.close(); P.sheetClosed(); P.restart(st.pos, { audio: a.audio }); return true; } }
        else if ('sub' in a) { P.loadSub(a.sub); render(); }
        else if (a.quality) { BF.sheets.close(); P.sheetClosed(); P.restart(st.pos, { quality: a.quality }); return true; }
      }
      return true;
    }
  };
})(window);
