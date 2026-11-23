// Measures the web (browser) playback path from the TV: /api/play web remux start time, segment sizes/durations/fetch
// times, and raw file read speed.  usage: TV=ip:26101 node tools/webplayperf.js <mediaId> [startSec]
const { execFileSync } = require('child_process');
const path = require('path');
const mid = +process.argv[2], start = +(process.argv[3] || 600);
const expr = `(async function () { var process_remote = ${JSON.stringify(process.env.REMOTE_URL || "")};
  var A = Object.create(BF.api); if (process_remote) A.base = process_remote; var H = A.headers(true), out = { mid: ${mid}, remote: !!process_remote }, t0 = performance.now();
  function ms() { return Math.round(performance.now() - t0); }
  var r = await (await fetch(A.base + '/api/play', { method: 'POST', headers: H, body: JSON.stringify({ mediaId: ${mid}, web: true, start: ${start}, audio: 0 }) })).json();
  out.mode = r.mode; out.hevc = r.hevc; out.playMs = ms();
  if (!r.url) { out.err = r; return out; }
  var u = function (p) { return A.base + p; }, base = r.url.replace(/index\\.m3u8$/, '');
  t0 = performance.now();
  var pl = await (await fetch(u(r.url), { headers: H })).text(); out.playlistMs = ms();
  t0 = performance.now(); var init = await (await fetch(u(base + 'init.mp4'), { headers: H })).arrayBuffer(); out.initMs = ms(); out.initKB = init.byteLength >> 10;
  out.segs = [];
  for (var i = 0; i < 4; i++) {
    var name = 's' + ('0000' + i).slice(-5) + '.m4s', t1 = performance.now();
    var res = await fetch(u(base + name), { headers: H });
    if (!res.ok) { out.segs.push({ i: i, status: res.status, ms: Math.round(performance.now() - t1) }); continue; }
    var b = await res.arrayBuffer(), dt = performance.now() - t1;
    out.segs.push({ i: i, MB: +(b.byteLength / 1048576).toFixed(1), ms: Math.round(dt), mbit: +(b.byteLength * 8 / 1e6 / 6).toFixed(1) });
  }
  pl = await (await fetch(u(r.url), { headers: H })).text();
  out.extinf = (pl.match(/#EXTINF:[0-9.]+/g) || []).slice(0, 6).map(function (x) { return +x.slice(8); });
  t0 = performance.now();
  var fr = await fetch(A.authUrl('/api/media/${mid}/file'), { headers: { Range: 'bytes=500000000-560000000' } });
  var fb = await fr.arrayBuffer(); out.fileReadMBs = +((fb.byteLength / 1048576) / (ms() / 1000)).toFixed(1);
  return out;
})().catch(function (e) { return { err: String(e) }; })`;
console.log(execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', expr], { encoding: 'utf8', env: process.env }).trim());
