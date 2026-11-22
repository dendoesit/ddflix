const a = require('assert'), S = require('../js/player/avstate.js');
const types = r => r.effects.map(e => e.type);
// ladder: start step 1
let s = S.init(), r = S.reduce(s, { type: 'start', at: 0, attempt: S.firstStep({}) });
a.deepStrictEqual(types(r), ['engineStop', 'request']); s = r.state; const g1 = s.gen;
r = S.reduce(s, { type: 'playResp', gen: g1, sid: 'A', mode: 'direct', url: 'u' }); s = r.state; a.deepStrictEqual(types(r), ['open']);
// double error in one generation -> one retry
r = S.reduce(s, { type: 'error', gen: g1, code: 'X' }); s = r.state;
a.ok(types(r).includes('request')); a.strictEqual(s.attempt.step, 2);
r = S.reduce(s, { type: 'error', gen: g1, code: 'Y' }); a.deepStrictEqual(types(r), [], 'stale/second error ignored');
// start during requesting is queued, latest wins
r = S.reduce(s, { type: 'start', at: 100, attempt: s.attempt }); s = r.state; a.deepStrictEqual(types(r), []);
r = S.reduce(s, { type: 'start', at: 200, attempt: s.attempt }); s = r.state; a.strictEqual(s.pendingStart.at, 200);
const g2 = s.gen;
r = S.reduce(s, { type: 'playResp', gen: g2, sid: 'B', mode: 'remux', url: 'u2' }); s = r.state;
r = S.reduce(s, { type: 'prepared', gen: g2 }); s = r.state; a.ok(types(r).includes('started')); a.ok(types(r).includes('request')); a.strictEqual(r.effects.find(e => e.type === 'request').at, 200);
// old gen callbacks ignored
a.deepStrictEqual(types(S.reduce(s, { type: 'prepared', gen: g1 })), []);
// close during requesting -> stopSession only once response arrives late
s = S.init(); r = S.reduce(s, { type: 'start', at: 0, attempt: S.firstStep({}) }); s = r.state; const g = s.gen;
r = S.reduce(s, { type: 'close' }); s = r.state; a.ok(!types(r).includes('stopSession'));
r = S.reduce(s, { type: 'playResp', gen: g, sid: 'Z', mode: 'direct', url: 'u' }); a.deepStrictEqual(r.effects, [{ type: 'stopSession', sid: 'Z' }]);
// close with a session -> stopSession
s = S.init(); s = S.reduce(s, { type: 'start', at: 0, attempt: S.firstStep({}) }).state; s = S.reduce(s, { type: 'playResp', gen: s.gen, sid: 'Q', mode: 'direct', url: 'u' }).state;
a.ok(types(S.reduce(s, { type: 'close' })).includes('stopSession'));
// first answer already remux -> skips to html5 step 3
a.strictEqual(S.nextStep(S.step(1), 'remux').step, 3);
a.strictEqual(S.nextStep(S.step(1), 'direct').step, 2);
a.strictEqual(S.firstStep({ directBlocked: true }).step, 2);
a.strictEqual(S.firstStep({ force: 'transcode' }).quality, '1080');
// 429 does not advance the ladder
s = S.init(); s = S.reduce(s, { type: 'start', at: 0, attempt: S.firstStep({}) }).state;
r = S.reduce(s, { type: 'playErr', gen: s.gen, status: 429 }); a.deepStrictEqual(types(r), ['errorScreen']); a.strictEqual(r.effects[0].busy, true);
// ladder end -> error screen
s = S.init(); s = S.reduce(s, { type: 'start', at: 0, attempt: S.step(6, '720') }).state;
r = S.reduce(s, { type: 'playErr', gen: s.gen, status: 500, code: 'x' }); a.ok(types(r).includes('errorScreen'));
console.log('avstate ok');
