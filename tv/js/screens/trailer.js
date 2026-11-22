/* Trailer, full screen (S5): server-cached mp4 at /api/title/{imdb}/trailer.mp4 in a <video>. No YouTube embed (no ads, kids use the app). */
(function (root) {
  'use strict';
  var BF = root.BF;
  function url(imdb) { return BF.api.authUrl('/api/title/' + imdb + '/trailer.mp4'); }
  BF.trailer = {
    url: url,
    open: function (imdb, name) {
      fetch(url(imdb), { method: 'HEAD' }).then(function (r) { return r.status === 200; }, function () { return false; }).then(function (ok) {
        if (ok) BF.router.go('trailer', { imdb: imdb, name: name }); else BF.toast(BF.t('x.trailerwait'));
      });
    }
  };
  BF.router.register('trailer', function () {
    var U = BF.util, sec, v;
    function stop() { if (!v) return; try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* */ } v = null; }
    return {
      mount: function (s, prm) {
        sec = s; s.className += ' trailer';
        v = document.createElement('video'); v.className = 'tr-v'; v.autoplay = true; v.setAttribute('playsinline', '');
        v.addEventListener('ended', function () { BF.router.pop(); });
        v.addEventListener('error', function () { BF.toast(BF.t('x.trailerwait')); BF.router.pop(); });
        s.appendChild(v); s.appendChild(U.txt('div', 'tr-name', BF.t('x.trailer', { n: prm.name || '' })));
        v.src = url(prm.imdb); var p = v.play(); if (p && p.catch) p.catch(function () { /* */ });
      },
      onHide: stop, unmount: stop,
      onKey: function (k) {
        if (k === 'back') { BF.router.pop(); return true; }
        if (k === 'enter' || k === 'playpause' || k === 'play' || k === 'pause') { if (v) { if (v.paused) v.play(); else v.pause(); } return true; }
        if (k === 'left' || k === 'right') { if (v) v.currentTime = Math.max(0, v.currentTime + (k === 'left' ? -10 : 10)); return true; }
        return true;
      }
    };
  });
})(window);
