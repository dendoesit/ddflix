const a = require('assert'), W = require('../js/player/spinwait.js');
let s = W.init();
a.strictEqual(W.visible(s, 0), false);
W.wait(s, 1000, 0);
a.strictEqual(W.visible(s, 1200), false, '400 ms grace');
a.strictEqual(W.visible(s, 1400), true);
a.strictEqual(W.progress(s, 0), false, 'first frame at same pos does not hide');
a.strictEqual(W.progress(s, 0.2), false, 'under 0.3 s');
a.strictEqual(W.progress(s, 0.6), false, 'one advance is not enough');
a.strictEqual(W.visible(s, 2000), true);
a.strictEqual(W.progress(s, 1.0), true, 'second advance hides');
a.strictEqual(W.visible(s, 2000), false);
// re-arm keeps original since when already waiting (stall during load)
s = W.init(); W.wait(s, 0, 10); W.wait(s, 3000, 10);
a.strictEqual(s.since, 0);
a.strictEqual(W.label(s, 4000, 'direct'), null);
a.strictEqual(W.label(s, 5000, 'direct'), 'p.loading');
a.strictEqual(W.label(s, 16000, 'direct'), 'p.loading', 'server msg only on transcode');
a.strictEqual(W.label(s, 16000, 'transcode'), 'p.serverprep');
// re-wait resets progress count (seek mid-recovery)
s = W.init(); W.wait(s, 0, 0); W.progress(s, 0.5); W.wait(s, 100, 100);
a.strictEqual(W.progress(s, 100.5), false);
a.strictEqual(W.progress(s, 101), true);
// backwards jump rebases
s = W.init(); W.wait(s, 0, 50); W.progress(s, 20);
a.strictEqual(s.base, 20);
// clear (pause/error/close)
s = W.init(); W.wait(s, 0, 0); W.clear(s);
a.strictEqual(W.visible(s, 9999), false); a.strictEqual(W.label(s, 99999, 'transcode'), null);
