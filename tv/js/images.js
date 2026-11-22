/* Queued image loader (max 4 in flight), decode before fade-in, explicit release. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var q = [], busy = 0, MAX = 4, pumpT = 0;
  function pump() {
    while (busy < MAX && q.length) {
      q.sort(function (a, b) { return a.p - b.p; });
      var job = q.shift();
      if (!job.el.isConnected || job.el.getAttribute('data-want') !== job.url) continue;
      busy++; run(job);
    }
  }
  var SHIM = /(^| )(poster|hero|ftile|ep-img|sim)( |$)/;
  function shim(img, on) { var p = img.parentNode; if (p && SHIM.test(p.className)) p.classList.toggle('ld', on); }
  function run(job) {
    var img = job.el, done = false;
    function fin(ok) {
      if (done) return; done = true; busy--;
      if (img.getAttribute('data-want') === job.url) shim(img, false);
      if (ok && img.getAttribute('data-want') === job.url) img.classList.add('is-in');
      if (!ok) { img.classList.add('is-err'); if (job.onerr) job.onerr(); }
      pump();
    }
    img.onload = function () {
      if (img.decode) img.decode().then(function () { fin(true); }, function () { fin(true); }); else fin(true);
    };
    img.onerror = function () { fin(false); };
    img.src = job.url;
    setTimeout(function () { fin(img.complete && img.naturalWidth > 0); }, 15000);
  }
  BF.images = {
    load: function (img, url, priority, onerr) {
      if (!url) return;
      if (img.getAttribute('data-want') === url && img.getAttribute('src') === url) return;
      img.classList.remove('is-in'); img.classList.remove('is-err');
      img.setAttribute('data-want', url); shim(img, true);
      q.push({ el: img, url: url, p: priority || 5, onerr: onerr });
      if (!pumpT) pumpT = setTimeout(function () { pumpT = 0; pump(); }, 0);
    },
    release: function (el) {
      if (!el || !el.querySelectorAll) return;
      var imgs = el.tagName === 'IMG' ? [el] : el.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) { imgs[i].removeAttribute('data-want'); imgs[i].removeAttribute('src'); }
    }
  };
})(window);
