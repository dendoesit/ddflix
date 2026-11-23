// Scroll benchmark on the TV home: presses `key` n times (gap ms) and reports frame gaps + time spent in the key handler.
// usage: TV=ip:26101 node tools/scrollperf.js [down|up] [n] [gapMs]
const { execFileSync } = require('child_process');
const path = require('path');
const [key = 'down', n = 8, gap = 450] = process.argv.slice(2);
const code = { down: 40, up: 38, right: 39, left: 37 }[key];
const expr = `new Promise(function (res) {
  var gaps = [], handler = [], last = performance.now(), stop = false, i = 0;
  function frame(t) { gaps.push(t - last); last = t; if (!stop) requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  function press() {
    var t0 = performance.now();
    ['keydown', 'keyup'].forEach(function (tp) { var e = document.createEvent('Event'); e.initEvent(tp, true, true); e.keyCode = ${code}; e.which = ${code}; document.dispatchEvent(e); });
    handler.push(performance.now() - t0);
    if (++i < ${+n}) setTimeout(press, ${+gap}); else setTimeout(function () {
      stop = true; var g = gaps.slice(1).sort(function (a, b) { return a - b; });
      var long = gaps.filter(function (x) { return x > 50; }).length;
      res({ frames: g.length, p50: +g[g.length >> 1].toFixed(1), p95: +g[Math.floor(g.length * .95)].toFixed(1), max: +g[g.length - 1].toFixed(1),
            over50ms: long, handlerMs: handler.map(function (x) { return Math.round(x); }) });
    }, 1200);
  }
  setTimeout(press, 300);
})`;
const out = execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', expr], { encoding: 'utf8', env: process.env });
console.log(out.trim());
