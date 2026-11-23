#!/usr/bin/env node
// CDP client for the TV (Node 22+). launch | console [--secs N] | eval '<js>' | shot out.png | key <name> | perf <secs>
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const SER = process.env.TV || '192.168.1.20:26101', APP = 'DDflix0001.DDFLIX';
const SDB = process.env.SDB || (process.platform === 'win32' ? 'C:/tizen-studio/tools/sdb.exe' : process.env.HOME + '/tizen-studio/tools/sdb');
const PF = path.join(__dirname, '..', '.cdp-port');
const red = s => String(s).replace(/([?&](t|p|sig)=)[^&"'\s]+/g, '$1***').replace(/(Bearer )[A-Za-z0-9._-]+/g, '$1***');
const KEYS = { left: 37, up: 38, right: 39, down: 40, enter: 13, ok: 13, back: 10009, play: 415, pause: 19, playpause: 10252, stop: 413, ff: 417, rw: 412, next: 10233, prev: 10232, red: 403, green: 404, yellow: 405, blue: 406, info: 457 };
for (let i = 0; i < 10; i++) KEYS[String(i)] = 48 + i;
async function launch() {
  try { execSync(`${SDB} -s ${SER} shell 0 was_kill ${APP}`); } catch (e) {}
  await new Promise(r => setTimeout(r, 1500));
  const out = await new Promise(res => {
    const p = require('child_process').spawn(SDB, ['-s', SER, 'shell', '0', 'debug', APP]);
    let buf = ''; const t = setTimeout(() => { p.kill(); res(buf); }, 30000);
    p.stdout.on('data', d => { buf += d; if (/port:\s*\d+/.test(buf)) { clearTimeout(t); setTimeout(() => { p.kill(); res(buf); }, 300); } });
  });
  const m = out.match(/port:\s*(\d+)/); if (!m) { console.error('no port:', out); process.exit(1); }
  execSync(`${SDB} -s ${SER} forward tcp:${m[1]} tcp:${m[1]}`);
  fs.mkdirSync(path.dirname(PF), { recursive: true }); fs.writeFileSync(PF, m[1]); console.log('port', m[1]);
}
async function conn() {
  const port = fs.readFileSync(PF, 'utf8').trim();
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl); let id = 0; const pend = {}; const ev = [];
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else ev.forEach(f => f(d)); };
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  return { ws, send, on: f => ev.push(f) };
}
async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  if (cmd === 'launch') return launch();
  const c = await conn();
  if (cmd === 'eval') {
    if (/bf_token/.test(a1)) { console.error('refused'); process.exit(1); }
    const r = await c.send('Runtime.evaluate', { expression: a1, returnByValue: true, awaitPromise: true });
    console.log(red(JSON.stringify(r.result.result ? (r.result.result.value !== undefined ? r.result.result.value : r.result.result.description) : r.result.exceptionDetails, null, 1)));
  } else if (cmd === 'shot') {
    // Page.captureScreenshot never returns on this TV firmware (compositor off-screen). Instead: serialize the live DOM
    // (inline transforms, classes, canvases as data URLs) and render it at 1920x1080 with local headless Chrome.
    const expr = `(function(){var d=document.documentElement.cloneNode(true);var cs=document.querySelectorAll('canvas'),cc=d.querySelectorAll('canvas');
      for(var i=0;i<cs.length;i++){try{var im=document.createElement('img');im.src=cs[i].toDataURL();im.style.cssText=cs[i].style.cssText;im.className=cs[i].className;im.width=cs[i].width;im.height=cs[i].height;cc[i].parentNode.replaceChild(im,cc[i]);}catch(e){}}
      var sc=d.querySelectorAll('script');for(i=0;i<sc.length;i++)sc[i].parentNode.removeChild(sc[i]);
      var ins=document.querySelectorAll('input'),ic=d.querySelectorAll('input');for(i=0;i<ins.length;i++)ic[i].setAttribute('value',ins[i].value);
      return '<!doctype html>'+d.outerHTML;})()`;
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    let html = r.result.result.value;
    const root = path.join(__dirname, '..');
    html = html.replace('<head>', '<head><base href="file://' + root + '/"><style>*{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}</style>');
    const tmp = path.join(require('os').tmpdir(), 'bf-shot.html'); fs.writeFileSync(tmp, html);
    const out = path.resolve(a1 || 'shot.png');
    execSync(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=1920,1080 --virtual-time-budget=6000 --screenshot="${out}" "file://${tmp}"`, { stdio: 'pipe', timeout: 60000 });
    fs.unlinkSync(tmp);
    console.log('saved', out, '(DOM snapshot rendered locally)');
  } else if (cmd === 'key') {
    const names = a1.split(','); const n = +(a2 || 1);
    for (let k = 0; k < n; k++) for (const nm of names) {
      const code = KEYS[nm.toLowerCase()]; if (!code) throw new Error('key ' + nm);
      await c.send('Runtime.evaluate', { expression: `(function(){['keydown','keyup'].forEach(function(t){var e=document.createEvent('Event');e.initEvent(t,true,true);e.keyCode=${code};e.which=${code};document.dispatchEvent(e);});})()` });
      await new Promise(r => setTimeout(r, 180));
    }
    console.log('keys sent');
  } else if (cmd === 'console') {
    const secs = +(a2 || 60); await c.send('Runtime.enable'); await c.send('Log.enable');
    c.on(d => { const t = new Date().toISOString().slice(11, 23);
      if (d.method === 'Runtime.consoleAPICalled') console.log(t, d.params.type, red(d.params.args.map(x => x.value !== undefined ? (typeof x.value === 'object' ? JSON.stringify(x.value) : x.value) : x.description).join(' ')));
      if (d.method === 'Runtime.exceptionThrown') console.log(t, 'EXC', red(JSON.stringify(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text)));
      if (d.method === 'Log.entryAdded') console.log(t, 'log', red(d.params.entry.text)); });
    await new Promise(r => setTimeout(r, secs * 1000));
  } else if (cmd === 'perf') {
    const secs = +(a1 || 5);
    const r = await c.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `new Promise(function(res){var f=[],l=performance.now(),end=l+${secs * 1000};function s(t){f.push(t-l);l=t;if(t<end)requestAnimationFrame(s);else{f.sort(function(a,b){return a-b});res({n:f.length,p50:f[f.length>>1].toFixed(1),p95:f[Math.floor(f.length*.95)].toFixed(1),max:f[f.length-1].toFixed(1)})}}requestAnimationFrame(s)})` });
    console.log(JSON.stringify(r.result.result.value));
  }
  c.ws.close(); process.exit(0);
}
main().catch(e => { console.error(red(e.message)); process.exit(1); });
