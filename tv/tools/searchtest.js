// Types words on the on-screen search keyboard with simulated remote keys and reports what the screen shows
// (local results first, then FileList).   usage: TV=ip:26101 node tools/searchtest.js frozen peanuts   (app open, profile chosen)
const { execFileSync } = require('child_process');
const path = require('path');
const KEYS = ['a', 'ă', 'â', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'î', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 'ș', 't', 'ț', 'u', 'v', 'w', 'x', 'y', 'z'];
const COLS = 6;
function ev(js) { return execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', js], { encoding: 'utf8', env: process.env }).trim(); }
function moves(word) {
  const seq = []; let cur = 0;
  for (const ch of word) {
    const i = KEYS.indexOf(ch); if (i < 0) throw new Error('no key ' + ch);
    const dr = Math.floor(i / COLS) - Math.floor(cur / COLS), dc = (i % COLS) - (cur % COLS);
    for (let k = 0; k < Math.abs(dr); k++) seq.push(dr > 0 ? 40 : 38);
    for (let k = 0; k < Math.abs(dc); k++) seq.push(dc > 0 ? 39 : 37);
    seq.push(13); cur = i;
  }
  return seq;
}
for (const w of process.argv.slice(2)) {
  const seq = moves(w);
  const js = `new Promise(function (res) {
    BF.router.go('search', null, { reset: true });
    var seq = ${JSON.stringify(seq)}, i = 0, out = [];
    function key(c) { ['keydown', 'keyup'].forEach(function (t) { var e = document.createEvent('Event'); e.initEvent(t, true, true); e.keyCode = c; e.which = c; document.dispatchEvent(e); }); }
    function snap(tag) { var h = document.querySelector('.sh'); out.push(tag + ': ' + (h ? h.textContent : '?') + ' | ' + [].map.call(document.querySelectorAll('.sgrid-in .gcell'), function (c) { return (c.querySelector('.ph') || c).textContent || c.getAttribute('aria-label') || '#'; }).length + ' cards'); }
    function step() { if (i < seq.length) { key(seq[i++]); setTimeout(step, 160); return; }
      setTimeout(function () { snap('0.9s'); }, 900);
      setTimeout(function () { snap('6s'); res(out.join('  ||  ')); }, 6000); }
    setTimeout(step, 1200);
  })`;
  console.log(w + ' -> ' + ev(js));
}
