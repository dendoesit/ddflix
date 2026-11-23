// Frame times while moving focus through the Home rows (right x6, left x3, down x3, up x2).
// usage: TV=ip:26101 node tools/focusperf.js   (Home must be open)
const { execFileSync } = require('child_process');
const path = require('path');
const SEQ = [40, 40, 39, 39, 39, 39, 39, 39, 37, 37, 37, 40, 40, 40, 38, 38];
const expr = `new Promise(function (res) {
  var gaps = [], last = performance.now(), stop = false, i = 0, seq = ${JSON.stringify(SEQ)}, shifts = 0;
  function frame(t) { gaps.push(t - last); last = t; if (!stop) requestAnimationFrame(frame); }
  function press() {
    var c = seq[i];
    ['keydown','keyup'].forEach(function (tp) { var e = document.createEvent('Event'); e.initEvent(tp, true, true); e.keyCode = c; e.which = c; document.dispatchEvent(e); });
    if (++i < seq.length) setTimeout(press, 450); else setTimeout(function () {
      stop = true; var g = gaps.slice(1), jank = 0; g.forEach(function (x) { if (x > 34) jank += x - 16.7; });
      var f = document.querySelector('.row--f .poster.foc');
      res({ frames: g.length, over34: g.filter(function (x) { return x > 34; }).length, over67: g.filter(function (x) { return x > 67; }).length,
            max: Math.round(Math.max.apply(null, g)), jankMs: Math.round(jank), focTransform: f && f.style.transform,
            bandT: f && f.parentNode.style.transform, ftiles: document.querySelectorAll('.ftile').length });
    }, 1200);
  }
  setTimeout(function () { requestAnimationFrame(frame); setTimeout(press, 200); }, 800);
})`;
console.log(execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', expr], { encoding: 'utf8', env: process.env }).trim());
