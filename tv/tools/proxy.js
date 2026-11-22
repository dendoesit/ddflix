#!/usr/bin/env node
// node tools/proxy.js 8099 http://192.168.1.10:8090 : streaming reverse proxy that logs one redacted line per request.
const http = require('http'), [port, target] = [+(process.argv[2] || 8099), new URL(process.argv[3] || 'http://192.168.1.10:8090')];
const red = s => s.replace(/([?&](t|p|sig)=)[^&]+/g, '$1***');
http.createServer((req, res) => {
  const t0 = Date.now(), h = Object.assign({}, req.headers, { host: target.host });
  const up = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: h }, r => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
    r.on('end', () => console.log([new Date().toISOString().slice(11, 23), req.method, red(req.url), 'range=' + (req.headers.range || '-'), 'ua=' + String(req.headers['user-agent'] || '').slice(0, 40),
      'xprof=' + (req.headers['x-profile'] ? 'yes' : 'no'), 'auth=' + (req.headers.authorization ? 'yes' : 'no'), r.statusCode, r.headers['content-type'] || '-', r.headers['content-length'] || '-', (Date.now() - t0) + 'ms'].join(' ')));
  });
  up.on('error', e => { console.log('ERR', red(req.url), e.message); res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(port, () => console.log('proxy :' + port + ' -> ' + target.href));
