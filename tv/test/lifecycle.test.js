const a = require('assert');
global.window = global; global.BF = { log() {} };
const L = require('../js/lifecycle.js');
a.strictEqual(L.classify(59000), 'none');
a.strictEqual(L.classify(61000), 'short');
a.strictEqual(L.classify(5 * 60000), 'medium');
a.strictEqual(L.classify(4 * 3600000), 'medium');
a.strictEqual(L.classify(4 * 3600000 + 1000), 'long');
a.strictEqual(L.classify(undefined), 'none');
// dedupe: a second resume within 2 s is ignored
let n = 0; L.busy = false; L.lastResume = Date.now(); const r = L.resume; L.resume(120000, 't'); a.strictEqual(L.busy, false, 'deduped');
console.log('lifecycle ok');
