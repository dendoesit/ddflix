// node test/run.js : runs every test/*.test.js
const fs = require('fs'), path = require('path');
let fail = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  try { require(path.join(__dirname, f)); } catch (e) { fail++; console.log('FAIL ' + f + ': ' + e.message); }
}
console.log(fail ? fail + ' test file(s) failed' : 'all tests passed');
process.exit(fail ? 1 : 0);
