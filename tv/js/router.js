/* Screen stack: keeps the last 2 screens mounted (hidden) so Back restores instantly. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var screens = {}, stack = [], appEl = null, spinT = null;
  function show(entry, restored) {
    var s = entry.sec;
    s.classList.remove('screen--off'); s.style.visibility = '';
    s.classList.remove('screen--in'); void s.offsetWidth; s.classList.add('screen--in');
    var stale = !!entry.stale; entry.stale = false;
    if (entry.scr.onShow) entry.scr.onShow(restored, stale);
  }
  function hide(entry) {
    if (entry.scr.onHide) entry.scr.onHide();
    entry.sec.classList.add('screen--off');
  }
  function unmount(entry) {
    if (!entry.sec) return;
    if (entry.scr.onHide && !entry.sec.classList.contains('screen--off')) entry.scr.onHide();
    entry.state = entry.scr.saveState ? entry.scr.saveState() : null;
    if (entry.scr.unmount) entry.scr.unmount();
    BF.util.empty(entry.sec); entry.sec.parentNode.removeChild(entry.sec); entry.sec = null;
  }
  function mount(entry, restoredState) {
    var sec = document.createElement('section');
    sec.className = 'screen'; sec.setAttribute('data-screen', entry.name);
    appEl.appendChild(sec);
    entry.sec = sec;
    entry.scr = screens[entry.name]();   // factory: fresh instance per mount
    entry.scr.mount(sec, entry.params || {}, restoredState || null);
  }
  var R = {
    stack: stack,
    register: function (name, factory) { screens[name] = factory; },
    init: function (el) { appEl = el; },
    top: function () { return stack[stack.length - 1]; },
    cur: function () { var t = stack[stack.length - 1]; return t ? t.scr : null; },
    go: function (name, params, opts) {
      opts = opts || {};
      var t0 = Date.now();
      if (opts.reset) { while (stack.length) unmount(stack.pop()); }
      else if (stack.length) {
        var top = stack[stack.length - 1];
        if (opts.replace) unmount(stack.pop()); else hide(top);
      }
      var entry = { name: name, params: params };
      stack.push(entry);
      mount(entry);
      // keep at most 2 screens mounted
      for (var i = 0; i < stack.length - 2; i++) if (stack[i].sec) unmount(stack[i]);
      show(entry, false);
      BF.log('router', 'go ' + name + ' ' + (Date.now() - t0) + 'ms');
    },
    back: function () {
      var top = stack[stack.length - 1];
      if (top && top.scr.onKey && top.scr.onKey('back')) return;
      R.pop();
    },
    pop: function () {
      if (stack.length <= 1) { BF.dialog.exit(); return; }
      unmount(stack.pop());
      var e = stack[stack.length - 1];
      var restored = !!e.sec;
      if (!e.sec) mount(e, e.state);
      show(e, restored);
    },
    key: function (k, ev) {
      var top = stack[stack.length - 1];
      if (!top) return;
      if (top.scr.onKey && top.scr.onKey(k, ev)) return;
      if (k === 'back') R.pop();
    },
    spinner: function (on) {
      clearTimeout(spinT);
      var sp = document.getElementById('rspin');
      if (!on) { if (sp) sp.className = 'rspin'; return; }
      spinT = setTimeout(function () { if (sp) sp.className = 'rspin on'; }, 250);
    }
  };
  BF.router = R;
})(window);
