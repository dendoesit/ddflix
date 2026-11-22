const a = require('assert'), V = require('../js/player/vtt.js');
const c = V.parse('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello <b>there</b>\n\n00:00:02.500 --> 00:00:04,000 align:start\n<c.x>Two</c>\n\n00:01:00.000 --> 00:01:02.000\nLater');
a.strictEqual(c.length, 3);
a.deepStrictEqual(V.cueAt(c, 2).map(x => x.t), ['Hello <b>there</b>']);
a.deepStrictEqual(V.cueAt(c, 2.7).map(x => x.t), ['Hello <b>there</b>', 'Two']);
a.deepStrictEqual(V.cueAt(c, 30), []); a.deepStrictEqual(V.cueAt(c, 61).map(x => x.t), ['Later']);
a.deepStrictEqual(V.cueAt([], 1), []);
console.log('vtt ok');
