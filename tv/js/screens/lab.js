/* Lab (Help -> Diagnostic): playback probes on the current profile's library (PLAN Step 1). */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api;
  BF.router.register('lab', function () {
    var U = BF.util, sec, list, out, items = [], idx = 0, mode = 0;
    var MODES = ['auto', 'direct', 'hls', 'html5', 'transcode', 'probe'];
    function log(s) { BF.log('lab', s); var l = U.txt('div', 'lab-l', BF.log.redact(s)); out.insertBefore(l, out.firstChild); while (out.children.length > 22) out.removeChild(out.lastChild); }
    function paint() { U.qsa('.lab-it', list).forEach(function (e, i) { e.classList.toggle('foc', i === idx); }); U.qs('.lab-mode', sec).textContent = '◀ ▶ mode: ' + MODES[mode] + '   ·   OK = run'; }
    function probe(it) {
      var u = A.authUrl('/api/media/' + it.id + '/file');
      var plain = A.base + '/api/media/' + it.id + '/file?t=' + encodeURIComponent(A.token);
      Promise.all([
        fetch(plain, { headers: { Range: 'bytes=0-1' } }).then(function (r) { return r.status; }),
        fetch(plain, { headers: { Range: 'bytes=0-1', 'X-Profile': A.profile } }).then(function (r) { return r.status; }),
        fetch(u, { headers: { Range: 'bytes=0-1' } }).then(function (r) { return r.status; })
      ]).then(function (r) { log('P1 media ' + it.id + ': no header ' + r[0] + ' · header ' + r[1] + ' · p= ' + r[2]); });
      A.play({ mediaId: it.id, start: 0, caps: { hevc: true, hdr: true, ac3: true, eac3: true, mkv: true }, forceHls: true }).then(function (d) {
        log('P6 play ' + d.mode + ' sid=' + (d.sid ? 'yes' : 'no'));
        var b = A.base + d.url, base = b.slice(0, b.lastIndexOf('/') + 1);
        return fetch(b).then(function (r) { return r.text().then(function (t) { log('P6 master ' + r.status + ' ' + t.replace(/\n/g, ' | ').slice(0, 200)); var m = /^(?!#)(\S+)$/m.exec(t); return m ? m[1] : null; }); })
          .then(function (ix) { return ix ? fetch(base + ix).then(function (r) { return r.text().then(function (t) { log('P6 index ' + r.status + ' ' + t.split('\n').slice(0, 9).join(' | ')); var mm = /URI="([^"]+)"/.exec(t); var sg = /^(?!#)(\S+)$/m.exec(t); var ib = ix.slice(0, ix.lastIndexOf('/') + 1); return [mm && (base + ib + mm[1]), sg && (base + ib + sg[1])]; }); }) : []; })
          .then(function (u2) { return Promise.all(u2.map(function (x) { return x ? fetch(x).then(function (r) { return r.arrayBuffer().then(function (bb) { return r.status + '/' + bb.byteLength; }); }) : 'n/a'; })); })
          .then(function (r) { log('P6 init ' + r[0] + ' seg0 ' + r[1]); return A.playStop(d.sid); });
      }).catch(function (e) { log('P6 err ' + e.message); });
    }
    return {
      mount: function (s) {
        sec = s; s.className += ' lab';
        s.appendChild(U.txt('div', 'help-h', 'Lab'));
        s.appendChild(U.txt('div', 'lab-mode', ''));
        list = U.el('div', 'lab-list'); s.appendChild(list);
        out = U.el('div', 'lab-out'); s.appendChild(out);
        Promise.all([A.cont().catch(function () { return { items: [] }; }), A.recent().catch(function () { return { items: [] }; })]).then(function (r) {
          r[0].items.forEach(function (x) { if (x.play) items.push({ id: x.play.id, name: x.name + ' · ' + x.play.res + ' ' + (x.play.hdr || '') + ' ' + x.play.vcodec }); });
          [69, 88, 18, 99, 10].forEach(function (id) { if (!items.some(function (x) { return x.id === id; })) items.push({ id: id, name: 'media ' + id }); });
          items.forEach(function (it) { list.appendChild(U.txt('div', 'lab-it', it.id + ' · ' + it.name)); });
          paint();
        });
        paint();
      },
      onKey: function (k) {
        if (k === 'up' && idx > 0) idx--;
        else if (k === 'down' && idx < items.length - 1) idx++;
        else if (k === 'left') mode = (mode + MODES.length - 1) % MODES.length;
        else if (k === 'right') mode = (mode + 1) % MODES.length;
        else if (k === 'enter') {
          var it = items[idx]; if (!it) return true;
          if (MODES[mode] === 'probe') probe(it);
          else BF.player.open(it.id, { title: it.name, force: MODES[mode] === 'auto' ? null : MODES[mode], start: 0, onEvent: log });
        } else if (k === 'back') { BF.router.pop(); return true; }
        paint(); return true;
      }
    };
  });
})(window);
