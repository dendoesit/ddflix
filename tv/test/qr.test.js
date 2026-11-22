const a = require('assert'), Q = require('../js/ui/qr.js');
const q = Q.encode('https://tv.example.com/#/settings?code=ABC123');
a.strictEqual(q.version, 4); a.strictEqual(q.size, 33);
a.strictEqual(q.modules[0][0], true); a.strictEqual(q.modules[7][7], false); a.strictEqual(q.modules[q.size - 8][8], true);
a.throws(() => Q.encode('x'.repeat(200)));
console.log('qr ok');
