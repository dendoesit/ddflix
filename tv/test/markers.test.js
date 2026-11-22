const a = require('assert'), M = require('../js/player/markers.js');
const mk = { intro: { start: 60, end: 130 }, credits: { start: 2500 } };
a.strictEqual(M.state(mk, 30, 2700, true).kind, 'none');
a.strictEqual(M.state(mk, 61, 2700, true).kind, 'intro');
a.strictEqual(M.state(mk, 61, 2700, true).to, 130);
a.strictEqual(M.state(mk, 129, 2700, true).kind, 'none', 'last 2 s of intro');
a.strictEqual(M.state(mk, 2501, 2700, true).kind, 'next');
a.strictEqual(M.state(mk, 2501, 2700, true, { dismissed: true }).kind, 'none');
a.strictEqual(M.state(mk, 2501, 2700, false).kind, 'credits');
a.strictEqual(M.state(mk, 2699.5, 2700, true).kind, 'none', 'end of file');
a.strictEqual(M.state({}, 2680, 2700, true).kind, 'next', 'no markers: last 20 s card');
a.strictEqual(M.state({}, 2680, 2700, true).auto, true);
// Sneaky Pete E10: 3133 s, no credits -> nothing early, pill in last 2 min, card only in last 20 s
a.strictEqual(M.state({}, 2900, 3133, true).kind, 'none', 'no early card');
a.strictEqual(M.state({}, 3020, 3133, true).kind, 'nextpill');
a.strictEqual(M.state({}, 3112, 3133, true).kind, 'nextpill', 'just before last 20 s');
a.strictEqual(M.state({}, 3114, 3133, true).kind, 'next');
a.strictEqual(M.state({ credits: { start: 3000, conf: 0.3 } }, 3020, 3133, true).kind, 'nextpill', 'low conf = no marker');
a.strictEqual(M.state({ credits: { start: 3000, src: 'chapters' } }, 3001, 3133, true).auto, true, 'real marker: card+countdown');
a.strictEqual(M.state({ credits: { start: 3000, src: 'blackdetect' } }, 3001, 3133, true).auto, false, 'blackdetect: card only');
a.strictEqual(M.state({ credits: { start: 3000, src: 'blackdetect' } }, 3115, 3133, true).auto, true, 'blackdetect: countdown last 20 s');
a.strictEqual(M.state({}, 3020, 3133, true, { dismissed: true }).kind, 'none');
a.strictEqual(M.state({}, 2680, 2700, false).kind, 'none', 'movie without credits marker');
a.strictEqual(M.state({ credits: { start: 2500, end: 2600 } }, 2550, 2700, false).to, 2600, 'post-credits scene');
a.strictEqual(M.state({ credits: { start: 2500, end: 2690 } }, 2550, 2700, false).to, null);
a.strictEqual(M.state({ credits: { start: 2500, src: 'blackdetect' } }, 2550, 2700, true).kind, 'next', 'blackdetect in last 4 min drives the card');
a.strictEqual(M.sane({ credits: { start: 2000, src: 'blackdetect' } }, 2700).credits, null, 'blackdetect too early ignored');
a.strictEqual(M.sane({ intro: { start: 0, end: 5 } }, 100).intro, null, 'too short');
a.strictEqual(M.sane({ intro: { start: 1000, end: 1060 } }, 3000).intro, null, 'too late');
a.strictEqual(M.sane({ credits: { start: 100 } }, 3000).credits, null, 'credits too early');
a.strictEqual(M.sane({ intro: { start: 10, end: 70, conf: 0.3 } }, 3000).intro, null, 'low conf');
console.log('markers ok');
// no credits marker (Sneaky Pete): 45-min episode -> card in the last 60 s; HLS/transcode positions are on the file timeline
a.strictEqual(M.state({ intro: { start: 565, end: 597 } }, 2650, 2697.6, true).kind, 'nextpill', 'last 60 s: pill only');
a.strictEqual(M.state({ intro: { start: 565, end: 597 } }, 2570, 2697.6, true).kind, 'none', 'before last 2 min');
a.strictEqual(M.state({ intro: { start: 565, end: 597 } }, 2595, 2697.6, true).kind, 'nextpill');
a.strictEqual(Math.round(M.tail(5000)), 150); a.strictEqual(M.tail(1300), 60);
a.strictEqual(M.state({}, 285, 300, true).kind, 'next', 'short episode: last 20 s');
a.strictEqual(M.state({}, 260, 300, true).kind, 'nextpill');
// transcode resumed with an offset: pos = offset + engine time, still compared with the media duration
{ const offset = 1200, engineT = 1480; a.strictEqual(M.state({}, offset + engineT, 2697.6, true).kind, 'next'); }
