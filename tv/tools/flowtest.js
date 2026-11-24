// Real-TV flow test with simulated remote keys: profile -> search a series -> open it -> play -> seek forward / back
// (checks position, seek thumbnails, spinner, errors) -> close.   usage: TV=ip:26101 node tools/flowtest.js [query]
// The app must be open (node tools/cdp.js launch) and visible.
const { execFileSync } = require('child_process');
const path = require('path');
const Q = process.argv[2] || 'dexter';
const KEYS = ['a', 'ă', 'â', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'î', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 'ș', 't', 'ț', 'u', 'v', 'w', 'x', 'y', 'z'];
function ev(js) { return execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), 'eval', js], { encoding: 'utf8', env: process.env, timeout: 180000 }).trim(); }
const PRE = `function key(c){['keydown','keyup'].forEach(function(t){var e=document.createEvent('Event');e.initEvent(t,true,true);e.keyCode=c;e.which=c;document.dispatchEvent(e);});}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function st(){var P=BF.player,s=P&&P.state&&P.state(),th=document.querySelector('.p-thumb'),sp=document.querySelector('.p-spin'),er=document.querySelector('.p-err');
 return {open:!!(P&&P.isOpen()),pos:s?Math.round(s.pos):null,mode:s&&s.sm?s.sm.mode:null,phase:s&&s.sm?s.sm.phase:null,paused:s?!!s.paused:null,
 thumb:th?(getComputedStyle(th).display!=='none'&&th.style.backgroundImage?'shown':'hidden'):'none',spin:sp?sp.classList.contains('on'):null,
 err:er&&er.classList.contains('on')?er.innerText.slice(0,80):null,trick:!!(s&&s.m&&s.m.trickplay),pend:document.querySelector('.p-btime')?document.querySelector('.p-btime').textContent:null};}`;
function step(name, body) {
  const t0 = Date.now();
  let out;
  try { out = ev(`(async function(){${PRE}\n${body}\n})()`); } catch (e) { out = 'ERROR ' + String(e.message).slice(0, 300); }
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}: ${out}`);
  return out;
}
let moves = [], cur = 0;
for (const ch of Q) {
  const i = KEYS.indexOf(ch), dr = Math.floor(i / 6) - Math.floor(cur / 6), dc = i % 6 - cur % 6;
  for (let k = 0; k < Math.abs(dr); k++) moves.push(dr > 0 ? 40 : 38);
  for (let k = 0; k < Math.abs(dc); k++) moves.push(dc > 0 ? 39 : 37);
  moves.push(13); cur = i;
}
const toGrid = [], col = cur % 6; for (let k = col; k < 6; k++) toGrid.push(39);

step('profile Dan', `var ps=BF.state.profiles||[],p=ps.filter(function(x){return x.name==='Dan'})[0];if(document.querySelector('.screen.profs')){await BF.selectProfile(p);await sleep(4000);}return (document.querySelector('.screen')||{}).className;`);
step('type "' + Q + '"', `BF.router.go('search',null,{reset:true});await sleep(1500);var m=${JSON.stringify(moves)};for(var i=0;i<m.length;i++){key(m[i]);await sleep(160);}await sleep(5000);
 return document.querySelector('.sh').textContent+' | '+[].map.call(document.querySelectorAll('.sgrid-in .gcell'),function(c){return c.textContent.replace(/\\s+/g,' ').trim().slice(0,22)}).slice(0,6).join(' / ')+' | broken imgs: '+document.querySelectorAll('.sgrid-in img.is-err').length;`);
step('go to results, open the first', `var g=${JSON.stringify(toGrid)};for(var i=0;i<g.length;i++){key(g[i]);await sleep(200);}await sleep(400);var f=document.querySelector('.sgrid-in .gcell.foc');var nm=f?f.textContent.replace(/\\s+/g,' ').trim().slice(0,30):'(no focus)';key(13);await sleep(5000);
 var s=document.querySelector('.screen');return 'focused '+nm+' -> '+(s&&s.className)+' | '+document.body.innerText.replace(/\\s+/g,' ').slice(0,160)+' | broken imgs: '+document.querySelectorAll('.screen img.is-err').length;`);
step('press Play (OK)', `var b=document.querySelector('.screen .btn.foc,.screen .foc');var lbl=b?b.textContent.trim().slice(0,30):'?';key(13);await sleep(15000);var s0=BF.player.state();if(s0&&s0.m)window.__orig={id:s0.m.id,pos:s0.m.position||0};return 'button "'+lbl+'" -> '+JSON.stringify(st());`);
step('playing 10s later', `var a=st();await sleep(10000);var b=st();return JSON.stringify({before:a.pos,after:b.pos,advancing:b.pos>a.pos,mode:b.mode,err:b.err,trick:b.trick});`);
step('seek +30s (3x right)', `key(39);await sleep(250);key(39);await sleep(250);key(39);await sleep(150);var mid=st();await sleep(4000);var a=st();await sleep(6000);var b=st();
 return JSON.stringify({whileSeeking:{thumb:mid.thumb,label:mid.pend},after:{pos:a.pos,spin:a.spin},sixSecLater:{pos:b.pos,advancing:b.pos>a.pos,spin:b.spin,err:b.err}});`);
step('seek -60s (6x left)', `for(var i=0;i<6;i++){key(37);await sleep(200);}var mid=st();await sleep(4000);var a=st();await sleep(6000);var b=st();
 return JSON.stringify({whileSeeking:{thumb:mid.thumb,label:mid.pend},after:{pos:a.pos,spin:a.spin},sixSecLater:{pos:b.pos,advancing:b.pos>a.pos,spin:b.spin,err:b.err}});`);
step('long jump forward (hold right ~4s)', `var t0=Date.now();while(Date.now()-t0<4000){key(39);await sleep(120);}var mid=st();await sleep(4500);var a=st();await sleep(8000);var b=st();
 return JSON.stringify({whileSeeking:{thumb:mid.thumb,label:mid.pend},after:{pos:a.pos,spin:a.spin},eightSecLater:{pos:b.pos,advancing:b.pos>a.pos,spin:b.spin,err:b.err}});`);
step('back to the start (hold left)', `var t0=Date.now();while(Date.now()-t0<5000){key(37);await sleep(120);}await sleep(4500);var a=st();await sleep(8000);var b=st();
 return JSON.stringify({pos:a.pos,later:b.pos,advancing:b.pos>a.pos,spin:b.spin,err:b.err});`);
step('close player (Back)', `key(10009);await sleep(1500);key(10009);await sleep(2500);var o=window.__orig,r='';if(o){await BF.api.post('/api/progress',{mediaId:o.id,position:o.pos});r=' (watch position restored to '+Math.round(o.pos)+'s)';}return JSON.stringify({open:BF.player.isOpen(),screen:(document.querySelector('.screen')||{}).className})+r;`);
step('player log', `return BF.log.dump(25).filter(function(x){return /player|avplay|html5|search|title/.test(x)}).slice(-18).join(' || ').slice(0,2500);`);
