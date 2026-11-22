const a = require('assert'), F = require('../js/fmt.js');
a.strictEqual(F.clock(3725), '1:02:05'); a.strictEqual(F.clock(65), '1:05');
a.strictEqual(F.mins(101), '1 h 41 min'); a.strictEqual(F.mins(45), '45 min'); a.strictEqual(F.mins(120), '2 h');
a.strictEqual(F.left(5707, 152), '1 h 33 min'); a.strictEqual(F.left(400, 390), '1 min');
a.strictEqual(F.years(2023, 2025), '2023–2025'); a.strictEqual(F.years(2023, 2023), '2023');
console.log('fmt ok');
