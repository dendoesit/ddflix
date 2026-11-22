(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {}, t1, t2;
  BF.toast = function (msg) {
    var el = document.getElementById('toast');
    clearTimeout(t1); clearTimeout(t2);
    el.textContent = ''; var s = document.createElement('span'); s.textContent = msg; el.appendChild(s); el.className = '';
    void el.offsetWidth; el.className = 'on';
    t1 = setTimeout(function () { el.className = 'out'; t2 = setTimeout(function () { el.className = ''; }, 220); }, 3500);
  };
})(window);
