// Renders tools/splashvid/render.html frame by frame in headless Chrome over CDP and writes JPEGs.
// usage: node capture.js <outdir> [from] [to] [step]
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), http = require('http');
const out = process.argv[2], from = +(process.argv[3] || 0), to = process.argv[4] != null ? +process.argv[4] : null, step = +(process.argv[5] || 1);
fs.mkdirSync(out, { recursive: true });
const port = 9333, prof = fs.mkdtempSync('/private/tmp/claude-501/bfrender-');
const ch = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--allow-file-access-from-files', '--window-size=1920,1080', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list; for (let i = 0; i < 50; i++) { try { list = await get(`http://127.0.0.1:${port}/json`); break; } catch (e) { await sleep(200); } }
  const pg = list.find(t => t.type === 'page'); const ws = new WebSocket(pg.webSocketDebuggerUrl); let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  await new Promise(r => ws.onopen = r);
  const call = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => (await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
  await call('Page.navigate', { url: 'file://' + path.resolve(__dirname, process.env.PAGE || 'render.html') });
  for (let i = 0; i < 100 && !(await ev('!!window.READY')); i++) await sleep(100);
  const n = await ev('FRAMES'), end = to != null ? to : n - 1;
  for (let f = from; f <= end; f += step) {
    const url = await ev(`frame(${f})`);
    fs.writeFileSync(path.join(out, 'f' + String(f).padStart(4, '0') + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('frames', n, 'written', Math.floor((end - from) / step) + 1);
  ws.close(); ch.kill();
})().catch(e => { console.error(e); ch.kill(); process.exit(1); });
