// Real-TV test for a title that is STILL DOWNLOADING: play it, hold right far past the downloaded part, check that
// seeking stops at the downloaded limit (with the message), playback goes on without a stall loop, then close and
// clear the watch position.   usage: TV=ip:26101 node tools/dlseektest.js <mediaId>   (app open: node tools/cdp.js launch)
const { execFileSync } = require('child_process');
const path = require('path');
const mid = +process.argv[2];
if (!mid) { console.error('usage: node tools/dlseektest.js <mediaId of a downloading title>'); process.exit(2); }
const js = `(async function(){function key(c){['keydown','keyup'].forEach(function(t){var e=document.createEvent('Event');e.initEvent(t,true,true);e.keyCode=c;e.which=c;document.dispatchEvent(e);});}
function sl(ms){return new Promise(function(r){setTimeout(r,ms)})}
var p=(BF.state.profiles||[]).filter(function(x){return x.kind==='adult'})[0];if(document.querySelector('.screen.profs')){await BF.selectProfile(p);await sl(3000);}
BF.player.open(${mid},{});var t0=Date.now();while(Date.now()-t0<40000){var s=BF.player.state();if(s&&s.sm&&s.sm.phase==='playing'&&s.pos>0.5)break;await sl(500);}
await sl(4000);var s=BF.player.state(),R={downloading:!!(s.m&&s.m.downloading),startedAt:Math.round(s.pos),downloaded:Math.round(s.avail)};
t0=Date.now();var lbl='';while(Date.now()-t0<8000){key(39);await sl(120);lbl=document.querySelector('.p-btime').textContent||lbl;}
R.seekTarget=lbl;R.toast=(document.getElementById('toast')||{}).textContent;await sl(6000);var a=BF.player.state().pos;await sl(10000);var b=BF.player.state();
R.posAfterSeek=Math.round(a);R.pos10sLater=Math.round(b.pos);R.advancing=b.pos>a;R.withinDownloaded=b.pos<=(b.avail||1e9);
R.error=document.querySelector('.p-err').classList.contains('on');R.reopenLoops=BF.log.dump(80).filter(function(x){return /stuck .*reopening|seek err/.test(x)}).length;
var pos0=s.m.position||0;key(10009);await sl(1500);await BF.api.post('/api/progress',{mediaId:${mid},position:pos0});
R.ok=R.downloading&&R.advancing&&R.withinDownloaded&&!R.error&&R.reopenLoops===0;return JSON.stringify(R);})()`;
const out = execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', js], { encoding: 'utf8', env: process.env, timeout: 180000 }).trim();
console.log(out);
process.exit(/\\"ok\\":true|"ok":true/.test(out) ? 0 : 1);
