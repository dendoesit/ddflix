// A/B what makes the home scroll janky: injects one CSS override at a time, scrolls down+up, reports long frames.
// usage: TV=ip:26101 node tools/scrollab.js
const { execFileSync } = require('child_process');
const path = require('path');
const CASES = {
  base: '',
  noTransition: '.home-scroll,.home-scroll *{transition:none!important}',
  noImages: '.home-scroll img{visibility:hidden!important}',
  noTileBg: '.ftile-bg,.ftile-scrim{display:none!important}',
  noBadges: '.poster-imdb,.poster-rank,.pill,.ichip,.poster-nas{display:none!important}',
  noMeta: '.meta{display:none!important}',
  noRadius: '.home-scroll *{border-radius:0!important;box-shadow:none!important}',
  noHero: '.hero,.tiles{display:none!important}',
  layers: '.row{will-change:transform}.meta{will-change:transform,opacity}',
  layersHero: '.row{will-change:transform}.meta{will-change:transform,opacity}.hero,.tiles{will-change:transform}',
  combo: '.row{will-change:transform}.meta{display:none!important}.home-scroll{transition-duration:200ms!important}',
  layersNoMeta: '.row{will-change:transform}.meta{display:none!important}',
  layersFast: '.row{will-change:transform}.meta{will-change:transform,opacity}.home-scroll{transition-duration:180ms!important}',
};
function run(css) {
  const expr = `new Promise(function (res) {
    var st = document.getElementById('abcss'); if (!st) { st = document.createElement('style'); st.id = 'abcss'; document.head.appendChild(st); }
    st.textContent = ${JSON.stringify(css)};
    var gaps = [], last = performance.now(), stop = false, i = 0, seq = [40,40,40,40,40,40,38,38,38,38,38,38];
    function frame(t) { gaps.push(t - last); last = t; if (!stop) requestAnimationFrame(frame); }
    function press() {
      var c = seq[i];
      ['keydown','keyup'].forEach(function (tp) { var e = document.createEvent('Event'); e.initEvent(tp, true, true); e.keyCode = c; e.which = c; document.dispatchEvent(e); });
      if (++i < seq.length) setTimeout(press, 450); else setTimeout(function () {
        stop = true; var g = gaps.slice(1), tot = 0, jank = 0; g.forEach(function (x) { tot += x; if (x > 34) jank += x - 16.7; });
        res({ over34: g.filter(function (x) { return x > 34; }).length, over67: g.filter(function (x) { return x > 67; }).length, max: Math.round(Math.max.apply(null, g)), jankMs: Math.round(jank) });
      }, 1200);
    }
    setTimeout(function () { requestAnimationFrame(frame); setTimeout(press, 200); }, 1500);
  })`;
  return execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', expr], { encoding: 'utf8', env: process.env }).replace(/\s+/g, '');
}
const only = process.argv.slice(2);
for (const [k, css] of Object.entries(CASES)) if (!only.length || only.includes(k)) console.log(k.padEnd(14), run(css));
run('');
