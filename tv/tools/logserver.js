#!/usr/bin/env node
// node tools/logserver.js 8787 : prints log lines POSTed by js/log.js (debug builds only).
const http = require('http'), port = +(process.argv[2] || 8787);
http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    try { JSON.parse(b).forEach(l => console.log(l)); } catch (e) { if (b) console.log(b); }
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end();
  });
}).listen(port, () => console.log('log sink on :' + port));
