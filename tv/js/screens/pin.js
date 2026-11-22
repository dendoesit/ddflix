/* PIN (PLAN §4.4): native number IME first via a real <input type=number>, D-pad pad fallback, number keys. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  var fails = [];
  BF.router.register('pin', function () {
    var U = BF.util, sec, p, val = '', boxes = [], input, status, pad, nav, imeOpen = false, lockT, lockedUntil = 0, busy = false, focusT;
    function paint() {
      for (var i = 0; i < 4; i++) { boxes[i].classList.toggle('fill', i < val.length); boxes[i].classList.toggle('act', i === val.length); }
    }
    function locked() { return Date.now() < lockedUntil; }
    function lockTick() {
      clearTimeout(lockT);
      var s = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (s <= 0) { status.textContent = ''; status.className = 'pin-st'; return; }
      status.textContent = BF.t('pin.locked', { s: s }); status.className = 'pin-st err';
      lockT = setTimeout(lockTick, 1000);
    }
    function typed(d) { if (locked() || busy || val.length >= 4) return; val += d; paint(); if (val.length === 4) submit(); }
    function erase() { val = val.slice(0, -1); paint(); if (input) input.value = val; }
    function submit() {
      if (val.length !== 4 || busy) return;
      busy = true; if (input) input.blur();
      BF.selectProfile(p, val).then(function () { busy = false; }, function (e) {
        busy = false;
        var now = Date.now(); fails = fails.filter(function (t) { return now - t < 60000; }); fails.push(now);
        var row = U.qs('.pin-boxes', sec); row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
        val = ''; if (input) input.value = ''; paint();
        if (fails.length >= 5 || /too many|locked/i.test(e.message)) { lockedUntil = fails[0] + 60000; lockTick(); }
        else { status.textContent = e.status === 403 ? BF.t('pin.wrong') : BF.t('x.error', { e: e.message }); status.className = 'pin-st err'; }
      });
    }
    function openIme() {
      if (true) return;
      try { input.focus(); } catch (e) { /* */ }
      imeOpen = document.activeElement === input;
      sec.classList.toggle('ime', imeOpen);
      BF.log('pin', 'ime focus ' + imeOpen);
    }
    function closeIme() { if (input) input.blur(); imeOpen = false; sec.classList.remove('ime'); nav.measure(); if (!nav.alive()) nav.first(); }
    return {
      mount: function (s, params) {
        sec = s; p = params.profile; s.className += ' pin';
        var head = U.el('div', 'pin-head');
        var av = U.el('img', 'art pin-av'); head.appendChild(av); BF.images.load(av, A.avatar(p), 1);
        head.appendChild(U.txt('div', 'pin-name', p.name)); s.appendChild(head);
        s.appendChild(U.txt('div', 'pin-h', BF.t('pin.enter')));
        var row = U.el('div', 'pin-boxes');
        for (var i = 0; i < 4; i++) { var b = U.el('div', 'pin-box'); b.appendChild(U.el('i')); row.appendChild(b); boxes.push(b); }
        s.appendChild(row);
        input = document.createElement('input');
        input.type = 'number'; input.id = 'pin-input'; input.setAttribute('inputmode', 'numeric'); input.setAttribute('autocomplete', 'off'); input.className = 'pin-input';
        input.addEventListener('input', function () {
          var v = String(input.value || '').replace(/\D/g, '').slice(0, 4);
          if (input.value !== v) input.value = v;
          val = v; paint(); if (val.length === 4) submit();
        });
        input.addEventListener('keydown', function (ev) {
          if (ev.keyCode === 65376) { ev.preventDefault(); if (val.length === 4) submit(); else closeIme(); }
          if (ev.keyCode === 65385) { ev.preventDefault(); closeIme(); }
        });
        input.addEventListener('blur', function () { imeOpen = false; sec.classList.remove('ime'); });
        s.appendChild(input);
        status = U.txt('div', 'pin-st', ''); s.appendChild(status);
        pad = U.el('div', 'pin-pad');
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].forEach(function (k, j) {
          var key = U.el('div', 'pk', k === 'del' ? '<svg viewBox="0 0 24 24"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M12 9l6 6M18 9l-6 6"/></svg>' : k === 'ok' ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>' : k);
          key.setAttribute('data-f', ''); key.setAttribute('data-k', k);
          pad.appendChild(key);
        });
        s.appendChild(pad);
        s.appendChild(U.txt('div', 'pin-hint', BF.t('pin.hint')));
        nav = new BF.nav.Nav(pad); nav.focus(pad.children[0]);
        if (locked()) lockTick();
        paint();
        // user decision: never open the Samsung keyboard; on-screen pad + number keys only
        if (input) { input.setAttribute('readonly', 'readonly'); input.tabIndex = -1; input.blur(); }
      },
      onShow: function () { nav.measure(); },
      unmount: function () { clearTimeout(lockT); clearTimeout(focusT); if (input) input.blur(); },
      onKey: function (k) {
        if (k === 'back' || k === 'imecancel') { if (imeOpen) { closeIme(); return true; } BF.router.pop(); return true; }
        var m = /^d(\d)$/.exec(k);
        if (m) { if (imeOpen) return true; typed(m[1]); return true; }
        if (imeOpen) { if (k === 'down' || k === 'imedone') closeIme(); return true; }
        if (k === 'up' && nav.cur && nav.cur === pad.children[0] || k === 'up' && nav.cur && nav.cur === pad.children[1] || k === 'up' && nav.cur && nav.cur === pad.children[2]) { openIme(); return true; }
        if (k === 'enter') {
          var kk = nav.cur && nav.cur.getAttribute('data-k');
          if (kk === 'del') erase(); else if (kk === 'ok') submit(); else if (kk) typed(kk);
          return true;
        }
        if (k === 'left' || k === 'right' || k === 'up' || k === 'down') { nav.move(k); return true; }
        return true;
      }
    };
  });
})(window);
