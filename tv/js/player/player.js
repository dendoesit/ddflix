/* Player orchestration + controls (PLAN §4.7/§4.8). Engines: BF.EngineAV, BF.EngineH5. State: BF.avstate. */
(function (root) {
  'use strict';
  var BF = root.BF, A = BF.api, S = BF.avstate;
  var IC = {
    play: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M7 4l13 8-13 8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    back10: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" style="fill:currentColor;stroke:none;font-weight:700">10</text></svg>',
    fwd10: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" style="fill:currentColor;stroke:none;font-weight:700">10</text></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7z" style="fill:currentColor"/><path d="M19 5v14"/></svg>',
    subs: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h4M13 13h4M7 16h10"/></svg>',
    hd: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v6M7 12h3M10 9v6M14 9v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z"/></svg>'
  };
  var remembered = {};       // mediaId -> ladder step that worked (session only)
  var directOk = {};         // base -> true/false from the header-less probe
  var P = { st: null };
  var U = function () { return BF.util; };
  var box, ui, subEl, av, h5, eng = null;
  // idle = accumulated playback time without a key press (a frozen standby gap adds at most 15 s)
  var watchMs = 0, lastProg = 0, autoAdvanced = 0, STILL_MS = 120 * 60000;

  function q(sel) { return ui.querySelector(sel); }
  function screensaver(on) { try { root.webapis.appcommon.setScreenSaver(on ? root.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON : root.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF); } catch (e) { /* */ } }

  function buildUi() {
    var u = U(); ui.innerHTML = '';
    ui.appendChild(u.el('div', 'p-top'));
    var top = q('.p-top');
    top.appendChild(u.txt('div', 'p-title', '')); top.appendChild(u.txt('div', 'p-sub', ''));
    top.appendChild(u.txt('div', 'p-clock', '')); top.appendChild(u.txt('div', 'p-mode', ''));
    var bot = u.el('div', 'p-bot'); ui.appendChild(bot);
    var tl = u.el('div', 'p-tl'); tl.appendChild(u.el('div', 'p-buf')); tl.appendChild(u.el('div', 'p-fill')); tl.appendChild(u.el('div', 'p-knob'));
    var bub = u.el('div', 'p-bubble'); bub.appendChild(u.el('div', 'p-thumb')); bub.appendChild(u.txt('div', 'p-btime', ''));
    tl.appendChild(bub); bot.appendChild(tl);
    bot.appendChild(u.txt('div', 'p-cur', '')); bot.appendChild(u.txt('div', 'p-rem', ''));
    var btns = u.el('div', 'p-btns'); bot.appendChild(btns);
    function b(id, icon, label, cls) { var e = u.el('div', 'ibtn p-b ' + (cls || ''), icon + '<span class="tip">' + u.esc(label) + '</span>'); e.setAttribute('data-id', id); btns.appendChild(e); return e; }
    b('restart', IC.restart, BF.t('p.restart'), 'p-l');
    b('back10', IC.back10, BF.t('p.back10'), 'p-c1'); b('pp', IC.pause, '', 'p-c2 p-pp'); b('fwd10', IC.fwd10, BF.t('p.fwd10'), 'p-c3');
    b('next', IC.next, BF.t('p.next'), 'p-r1'); b('subs', IC.subs, BF.t('p.audiosubs'), 'p-r2'); b('quality', IC.hd, BF.t('p.quality'), 'p-r3');
    var bd = document.createElement('img'); bd.className = 'p-bd'; ui.insertBefore(bd, ui.firstChild);
    ui.appendChild(u.el('div', 'p-spin', '<div class="spin"></div><div class="p-pct"></div><div class="p-msg"></div>'));
    var sk = u.txt('div', 'btn p-skip', BF.t('p.skipintro')); ui.appendChild(sk);
    var un = u.el('div', 'p-upnext');
    un.appendChild(u.el('img', 'art p-un-img')); var ut = u.el('div', 'p-un-t'); ut.appendChild(u.txt('div', 'p-un-h', BF.t('p.upnexth'))); ut.appendChild(u.txt('div', 'p-un-se', ''));
    un.appendChild(ut);
    var ub = u.el('div', 'p-un-btns'); var pb = u.el('div', 'btn btn--pri p-un-go'); pb.appendChild(u.txt('span', 'p-un-lab', BF.t('p.upnext'))); ub.appendChild(pb);
    var bar = u.el('div', 'p-un-bar'); bar.appendChild(u.el('i', 'p-un-fill')); un.appendChild(bar); ub.appendChild(u.txt('div', 'btn', BF.t('p.credits'))); un.appendChild(ub);
    ui.appendChild(un);
    ui.appendChild(u.el('div', 'p-stats'));
    ui.appendChild(u.el('div', 'p-err'));
    ui.appendChild(u.el('div', 'p-sheet'));
  }
  // ---------------- controls state
  var C = { shown: false, hideT: null, zone: 'buttons', btn: 'pp', pend: null, pendT: null, holdStart: 0, sheet: null, upnext: null, skipShown: false, stats: false, errBtns: null, errIdx: 0 };
  function btnEls() { return Array.prototype.slice.call(ui.querySelectorAll('.p-b')).filter(function (e) { return e.style.display !== 'none'; }); }
  function show(keep) {
    C.shown = true; box.classList.add('ui');
    clearTimeout(C.hideT);
    if (!keep && P.st && !P.st.paused && !C.sheet) C.hideT = setTimeout(hide, 4000);
    paint();
  }
  function hide() { if (P.st && P.st.paused) return; C.shown = false; box.classList.remove('ui'); C.zone = 'buttons'; C.btn = 'pp'; paint(); }
  function paint() {
    var st = P.st; if (!st) return;
    var dur = st.duration || 0, pos = C.pend != null ? C.pend : st.pos;
    var pct = dur ? Math.min(1, pos / dur) : 0;
    q('.p-fill').style.transform = 'scaleX(' + pct + ')';
    q('.p-knob').style.transform = 'translateX(' + Math.round(pct * 1728) + 'px)' + (C.pend != null ? ' scale(1.36)' : '');
    q('.p-cur').textContent = BF.fmt.clock(pos);
    q('.p-rem').textContent = '-' + BF.fmt.clock(Math.max(0, dur - pos));
    var bub = q('.p-bubble');
    if (C.pend != null) { bub.style.opacity = 1; bub.style.transform = 'translateX(' + Math.round(Math.max(160, Math.min(1568, pct * 1728))) + 'px)'; q('.p-btime').textContent = BF.fmt.clock(C.pend); trick(C.pend); }
    else bub.style.opacity = 0;
    btnEls().forEach(function (e) { e.classList.toggle('foc', C.shown && C.zone === 'buttons' && e.getAttribute('data-id') === C.btn); });
    q('.p-tl').classList.toggle('foc', C.shown && C.zone === 'timeline');
    q('.p-pp').innerHTML = (st.paused ? IC.play : IC.pause) + '<span class="tip">' + U().esc(st.paused ? 'Play' : 'Pauză') + '</span>';
    q('[data-id="next"]').style.display = st.m && st.m.nextMedia ? '' : 'none';
    var d = new Date(); q('.p-clock').textContent = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    subEl.classList.toggle('lift', C.shown);
  }
  function trick(t) {
    var st = P.st, tp = st.m && st.m.trickplay, th = q('.p-thumb');
    if (!tp || st.trickBad) { th.style.display = 'none'; return; }
    var per = tp.cols * tp.rows, i = Math.floor(t / tp.interval), n = Math.floor(i / per) + 1, k = i % per;
    if (n > tp.sheets) n = tp.sheets;
    var url = A.mediaUrl(tp.url + n + '.jpg');
    th.style.display = 'block'; th.style.width = tp.w + 'px'; th.style.height = tp.h + 'px';
    th.style.backgroundImage = 'url("' + url + '")';
    th.style.backgroundPosition = (-(k % tp.cols) * tp.w) + 'px ' + (-Math.floor(k / tp.cols) * tp.h) + 'px';
    if (!st.trickLoaded) st.trickLoaded = {};
    [n, n + 1].forEach(function (s) {
      if (s > tp.sheets || st.trickLoaded[s]) return; st.trickLoaded[s] = 1;
      var im = new Image(); im.onerror = function () { st.trickBad = true; BF.log('player', 'trickplay sheet ' + s + ' failed (needs server S1 on non-kids profiles)'); th.style.display = 'none'; };
      im.src = A.mediaUrl(tp.url + s + '.jpg');
    });
  }
  // pending seek with acceleration
  function seekBy(dir, base) {
    var st = P.st, now = Date.now();
    if (C.pend == null) { C.pend = st.pos; C.holdStart = now; }
    if (now - C.lastSeekKey > 450) C.holdStart = now;
    C.lastSeekKey = now;
    var held = now - C.holdStart, step = base || (held > 6000 ? 180 : held > 3000 ? 60 : held > 1000 ? 30 : 10);
    C.pend = Math.max(0, Math.min((st.duration || 1e9) - 2, C.pend + dir * step));
    show(true); paint();
    clearTimeout(C.pendT); C.pendT = setTimeout(commitSeek, 500);
  }
  C.lastSeekKey = 0;
  function commitSeek() {
    clearTimeout(C.pendT); if (C.pend == null) return;
    var to = C.pend; C.pend = null; seekTo(to); show();
  }
  function cancelSeek() { clearTimeout(C.pendT); C.pend = null; paint(); }
  function seekTo(t) {
    var st = P.st; if (!st || !eng) return;
    st.pos = t; st.advAt = 0; st.stallAt = 0; st.seekAt = Date.now(); spin(true, t);
    eng.seek(t - (st.offset || 0), function () { st.advAt = Date.now(); saveProgress(); });
  }
  // spinner (round 7): armed by open/seek/stall/buffering, cleared only by real position progress (BF.spinwait) or pause/error/close
  var SW = BF.spinwait;
  function spin(on, pos) {
    var st = P.st; if (!st) return;
    if (on) SW.wait(st.sw, Date.now(), pos != null ? pos : st.pos); else SW.clear(st.sw);
    spinRender();
  }
  function spinRender() {
    var st = P.st, e = q('.p-spin'), m = q('.p-msg'); if (!e) return;
    var now = Date.now(), v = !!(st && SW.visible(st.sw, now));
    e.classList.toggle('on', v);
    var k = v ? SW.label(st.sw, now, st.sm.mode) : null, txt = k ? BF.t(k) : '';
    if (m.textContent !== txt) m.textContent = txt;
  }
  // ---------------- state machine wiring
  function dispatch(ev) {
    var st = P.st; if (!st) return;
    var r = S.reduce(st.sm, ev); st.sm = r.state;
    r.effects.forEach(run);
  }
  function emit(s) { if (P.st && P.st.onEvent) P.st.onEvent(s); }
  function run(fx) {
    var st = P.st;
    if (fx.type === 'engineStop') { if (eng) eng.stop(); eng = null; }
    else if (fx.type === 'stopSession') A.playStop(fx.sid).catch(function () {});
    else if (fx.type === 'request') request(fx);
    else if (fx.type === 'open') openEngine(fx);
    else if (fx.type === 'started') {
      st.started = true; remembered[st.m.id] = fx.step; q('.p-bd').classList.remove('on');
      var ttff = Date.now() - st.t0;
      BF.log('player', 'tv_start step ' + fx.step + ' ' + st.engineName + ' ' + st.sm.mode + ' ' + ttff + 'ms');
      emit('START step ' + fx.step + ' ' + st.engineName + ' ' + st.sm.mode + ' ttff ' + ttff + 'ms');
      A.playEvent({ mediaId: st.m.id, kind: 'tv_start', mode: st.sm.mode, detail: { step: fx.step, engine: st.engineName, mode: st.sm.mode, ttff_ms: ttff } });
      st.paused = false; screensaver(false); show();
    } else if (fx.type === 'logError') {
      BF.log('player', 'tv_error step ' + fx.step + ' code ' + fx.code);
      emit('ERROR step ' + fx.step + ' ' + fx.code);
      A.playEvent({ mediaId: st.m.id, kind: 'tv_error', mode: st.sm.mode, detail: { step: fx.step, engine: st.engineName, code: String(fx.code).slice(0, 80), state: eng ? eng.state() : '', msSinceStart: Date.now() - st.t0 } });
    } else if (fx.type === 'errorScreen') errorScreen(fx.busy);
  }
  function request(fx) {
    var st = P.st, a = fx.attempt;
    st.t0 = Date.now(); spin(true, fx.at);
    // direct play keeps the file's default track and switches audio in AVPlay (a non-default audio makes the server remux)
    var fileDef = 0; (st.m.audio || []).forEach(function (t) { if (t.default) fileDef = t.n; });
    st.directAudio = !a.forceHls && a.engine === 'avplay' ? st.audio : null;
    var body = { mediaId: st.m.id, start: fx.at, caps: a.caps, audio: st.directAudio != null ? fileDef : st.audio, quality: a.quality, replace: fx.replace || undefined, direct: !A.isLan(), tv: true };
    if (a.forceHls) body.forceHls = true;
    st.attempt = a;
    A.play(body).then(function (d) {
      var url = !A.isLan() && d.directUrl ? d.directUrl : (d.mode === 'direct' ? A.mediaUrl(d.url) : A.base + d.url);
      st.offset = d.offset || 0; st.plan = d.plan || {};
      dispatch({ type: 'playResp', gen: fx.gen, sid: d.sid, mode: d.mode, url: url });
    }, function (e) { dispatch({ type: 'playErr', gen: fx.gen, status: e.status, code: e.message }); });
  }
  function openEngine(fx) {
    var st = P.st, a = fx.attempt, gen = fx.gen;
    var useH5 = a.engine === 'html5' || !BF.EngineAV.available();
    eng = useH5 ? (h5 || (h5 = new BF.EngineH5())) : (av || (av = new BF.EngineAV()));
    st.engineName = useH5 ? 'html5' : 'avplay';
    st.mode = fx.mode;
    var pill = fx.mode === 'direct' ? BF.t('p.direct') : fx.mode === 'transcode' ? BF.t('p.transcode', { q: (st.plan.height || a.quality || '') + (st.plan.height ? 'p' : '') }) : BF.t('p.remux');
    q('.p-mode').textContent = pill + ' · ' + st.engineName;
    document.body.classList.toggle('av-on', !useH5);
    var rel = Math.max(0, fx.at - (st.offset || 0));
    eng.open(fx.url, rel, { uhd: st.m.res === '4K', hls: fx.mode !== 'direct', audio: fx.mode === 'direct' ? st.directAudio : null }, {
      prepared: function () { dispatch({ type: 'prepared', gen: gen }); },
      error: function (code) { dispatch({ type: 'error', gen: gen, code: code, at: st.pos }); },
      time: function (t) { if (st.sm.gen !== gen) return; var np = (st.offset || 0) + t; if (np !== st.pos) stallAdvance(st); if (SW.progress(st.sw, np)) spinRender(); st.pos = np; tick(); },
      buffer: function (on) { if (st.sm.gen === gen && on) spin(true); },
      ended: function () { if (st.sm.gen === gen) ended(); },
      info: function (s) { st.info = s; BF.log('player', 'stream ' + s); emit('INFO ' + s); }
    });
  }
  // ---------------- stall watchdog (PLAN-ROUND6 2.4): no advancing time callback for STALL_MS while playing -> spinner
  var STALL_MS = 1200, stallT = null;
  function stallAdvance(st) {
    st.advAt = Date.now();
    if (st.stallAt) {
      var ms = Date.now() - st.stallAt; st.stallAt = 0; st.stallCounted = false;
      BF.log('player', 'stall ' + ms + 'ms at ' + Math.floor(st.pos));
      A.playEvent({ mediaId: st.m.id, kind: 'tv_stall', mode: st.sm.mode, detail: { ms: ms, pos: Math.floor(st.pos), mode: st.sm.mode, res: st.m.resolution || null } });
      if (ms >= 2000) {
        st.stalls = (st.stalls || []).filter(function (x) { return Date.now() - x < 180000; }); st.stalls.push(Date.now());
        if (st.stalls.length >= 3 && st.sm.mode === 'direct' && /2160|4k/i.test(String(st.m.resolution || '')) && !st.stallHinted) { st.stallHinted = true; BF.toast(BF.t('p.stallhint')); }
      }
    }
  }
  function stallWatch() {
    clearInterval(stallT);
    stallT = setInterval(function () {
      var st = P.st; if (!st) { clearInterval(stallT); return; }
      spinRender(); autoOrig(st); unstick(st);
      if (st.sm.phase !== 'playing' || st.paused || C.pend != null || st.stallAt || !st.advAt) return;
      var dur = st.m.duration || st.duration; if (dur && dur - st.pos < 2) return;
      if (Date.now() - st.advAt > STALL_MS) { st.stallAt = st.advAt; spin(true); }
    }, 200);
  }
  // stuck for good (server restarted, connection dropped, a seek that never lands): reopen the stream at the same spot.
  // At most once per 20 s; the normal stall spinner keeps showing meanwhile.
  var STUCK_MS = 10000;
  function unstick(st) {
    if (!st.started || st.paused || C.pend != null || st.sm.phase === 'error') return;
    var since = st.stallAt || (!st.advAt && st.seekAt) || 0, now = Date.now();
    if (!since || now - since < STUCK_MS || (st.unstuckAt && now - st.unstuckAt < 20000)) return;
    st.unstuckAt = now; st.stallAt = 0; st.seekAt = 0; st.advAt = 0;
    BF.log('player', 'stuck ' + (now - since) + 'ms at ' + Math.floor(st.pos) + ': reopening');
    A.playEvent({ mediaId: st.m.id, kind: 'tv_unstick', mode: st.sm.mode, detail: { ms: now - since, pos: Math.floor(st.pos) } });
    P.restart(st.pos);
  }
  // quality fallback (round 7): transcode stalls > 8 s twice in 2 min, or transcode startup > 15 s -> original/direct at the same position, once per session
  function autoOrig(st) {
    if (st.autoFell || st.quality === 'original' || st.paused || st.sm.mode !== 'transcode' || C.pend != null) return;
    var now = Date.now(), why = null;
    if (!st.started && st.t0 && now - st.t0 > 15000 && st.sm.phase !== 'error') why = 'startup ' + (now - st.t0) + 'ms';
    else if (st.started && st.stallAt && !st.stallCounted && now - st.stallAt > 8000) {
      st.stallCounted = true;
      st.tStalls = (st.tStalls || []).filter(function (x) { return now - x < 120000; }); st.tStalls.push(now);
      if (st.tStalls.length >= 2) why = 'stalls ' + st.tStalls.length;
    }
    if (!why) return;
    st.autoFell = true;
    BF.log('player', 'auto original: ' + why + ' at ' + Math.floor(st.pos));
    A.playEvent({ mediaId: st.m.id, kind: 'tv_autoorig', mode: st.sm.mode, detail: { why: why, pos: Math.floor(st.pos), quality: st.quality } });
    BF.toast(BF.t('p.toorig'));
    st.stallAt = 0; st.stallCounted = false;
    P.restart(st.pos, { quality: 'original' });
  }
  // ---------------- periodic work
  var lastTick = 0;
  function tick() {
    var st = P.st, now = Date.now();
    if (now - lastTick < 250) return; lastTick = now;
    if (!st.duration && eng) st.duration = st.m.duration || eng.duration();
    subs();
    if (C.shown) paint();
    markers();
    // transcode/HLS: AVPlay may never report stream completion -> treat reaching the file's end as ended (once)
    var md = st.m.duration; if (md && st.pos >= md - 0.5 && !st.endFired && st.sm.phase === 'playing') { st.endFired = true; BF.log('player', 'end reached by position'); ended(); }
  }
  // markers UI (PLAN-ROUND6 2.3): state from BF.markers; pill = skip intro / skip credits; card = next episode with 7 s fill
  function markers() {
    var st = P.st, t = st.pos, dur = st.m.duration || st.duration, M = BF.markers;
    if (C.pend != null || !st.advAt) return;          // scrubbing or seek in flight: no flashes
    var mk = M.sane(st.m.markers, dur), s = M.state(st.m.markers, t, dur, !!st.m.nextMedia, { dismissed: C.upnextDismissed });
    if (mk.credits && t >= mk.credits.start && !st.creditsSent) { st.creditsSent = true; saveProgress(true); }
    // seeking back well before the credits zone re-arms the card
    var zoneStart = mk.credits ? mk.credits.start : (dur ? dur - M.PILL : 1e9);
    if (C.upnextDismissed && t < zoneStart - 5) C.upnextDismissed = false;
    var pill = s.kind === 'intro' || s.kind === 'credits' ? s.kind : s.kind === 'nextpill' ? 'next' : null, sk = q('.p-skip');
    if (pill !== C.skipShown) {
      C.skipShown = pill; C.skipTo = s.to; C.skipArm = pill && pill !== 'next' ? Date.now() + 8000 : 0; // next pill: no focus steal, Up only
      if (pill) sk.textContent = BF.t(pill === 'intro' ? 'p.skipintro' : pill === 'next' ? 'p.nextpill' : 'p.skipcredits');
      sk.classList.toggle('on', !!pill);
      if (!pill && C.zone === 'skip') C.zone = 'timeline';
    }
    if (pill) { C.skipTo = s.to; paintSkip(); }
    if (s.kind === 'next' && !C.upnext) upnext(s.auto);
    else if (s.kind === 'next' && s.auto && !C.upnext.auto) { C.upnext.auto = true; unStop(); }   // blackdetect card: countdown from the last 20 s
    else if (s.kind !== 'next' && C.upnext) closeUn(false);
    if (C.upnext) { var freeze = st.paused || !!st.stallAt || !!C.sheet; if (freeze && C.upnext.run) unStop(); else if (!freeze && !C.upnext.run) unStart(); }
  }
  function skipArmed() { return !!C.skipShown && ((!C.shown && Date.now() < C.skipArm) || (C.shown && C.zone === 'skip')); }
  function paintSkip() { var sk = q('.p-skip'), f = skipArmed(); sk.classList.toggle('foc', f); sk.classList.toggle('dim', !f); }
  function doSkip() {
    var st = P.st, kind = C.skipShown; if (!kind) return;
    C.skipShown = null; q('.p-skip').classList.remove('on'); if (C.zone === 'skip') C.zone = 'timeline';
    if (kind === 'next') { playNext(false); return; }
    if (kind === 'intro' || C.skipTo != null) seekTo(C.skipTo);
    else saveProgress(true).then(function () { P.close(); });
  }
  function upnext(auto) {
    var st = P.st, nm = st.m.nextMedia, un = q('.p-upnext');
    C.upnext = { idx: 0, auto: auto !== false, run: false, t: null };
    q('.p-un-se').textContent = nm.season != null ? BF.t('meta.ep', { s: nm.season, e: nm.episode }) + (nm.name ? ' · ' + nm.name : '') : (nm.title || '');
    if (st.m.imdb && nm.season != null) BF.images.load(q('.p-un-img'), A.epImg(st.m.imdb, nm.season, nm.episode, 640), 1);
    un.classList.add('on'); paintUn(); unStart();
  }
  function unFill() { return q('.p-un-fill'); }
  // countdown: JS-driven (rAF width steps) so it animates on Chromium 76 regardless of insertion timing; label counts down
  function unStart() {
    var u = C.upnext; if (!u || u.run) return; u.run = true;
    var f = unFill(), lab = q('.p-un-lab'), N = BF.markers.COUNTDOWN;
    f.style.width = '0%'; lab.textContent = BF.t('p.upnext');
    if (!u.auto) return;
    var t0 = 0, lastS = -1;
    function step(now) {
      if (C.upnext !== u || !u.run) return;
      if (!t0) { t0 = now; BF.log('player', 'upnext countdown start'); }
      var el = (now - t0) / 1000, p = Math.min(1, el / N), left = Math.max(0, Math.ceil(N - el));
      f.style.width = (p * 100).toFixed(1) + '%';
      if (left !== lastS) { lastS = left; lab.textContent = BF.t('p.upnextin', { s: left }); }
      if (p >= 1) { BF.log('player', 'upnext countdown done ' + Math.round(now - t0) + 'ms'); playNext(true); return; }
      u.raf = requestAnimationFrame(step);
    }
    u.raf = requestAnimationFrame(step);
  }
  function unStop() { var u = C.upnext; if (!u) return; u.run = false; if (u.raf) cancelAnimationFrame(u.raf); unFill().style.width = '0%'; q('.p-un-lab').textContent = BF.t('p.upnext'); }
  function paintUn() { if (!C.upnext) return; var b = q('.p-un-btns').children; b[0].classList.toggle('foc', C.upnext.idx === 0); b[1].classList.toggle('foc', C.upnext.idx === 1); }
  function closeUn(dismiss) { if (!C.upnext) return; clearTimeout(C.upnext.t); if (C.upnext.raf) cancelAnimationFrame(C.upnext.raf); C.upnext = null; q('.p-upnext').classList.remove('on'); if (dismiss) C.upnextDismissed = true; }
  function playNext(auto) {
    var st = P.st, nm = st.m.nextMedia; if (!nm) return;
    closeUn(false);
    autoAdvanced = auto ? autoAdvanced + 1 : 0;
    var opts = { imdb: st.imdb, title: st.title, start: 0, onClose: st.onClose, onEvent: st.onEvent, quality: st.quality };
    BF.log('player', 'next episode ' + nm.id + ' (' + (auto ? 'auto' : 'manual') + ', quality ' + st.quality + ', mode ' + st.sm.mode + ')');
    saveProgress().then(function () { stopSession(); P.open(nm.id, opts, true); });
    if (auto && (autoAdvanced >= 3)) setTimeout(stillWatching, 3000);
  }
  function stillWatching() {
    if (!P.st) return;
    P.pause();
    var t = setTimeout(function () { BF.dialog.close(); P.close(); }, 300000);
    BF.dialog.open({ title: BF.t('p.still'), buttons: [{ label: BF.t('p.continue'), primary: true, action: function () { clearTimeout(t); autoAdvanced = 0; watchMs = 0; P.resume(); } }, { label: BF.t('p.exit'), action: function () { clearTimeout(t); P.close(); } }] });
  }
  function ended() {
    var st = P.st; if (!st) return; if (st.endDone) return; st.endDone = true;
    if (st.m.nextMedia) { playNext(true); return; }
    st.pos = st.duration || st.pos; saveProgress(true).then(function () { P.close(); });
  }
  // ---------------- subtitles
  // every switch says what happened: on (with the language), off, still being prepared, failed
  function subLabel(k) { var s = ((P.st && P.st.m && P.st.m.subs) || []).filter(function (x) { return x.key === k; })[0]; return s ? (s.display || s.label) : ''; }
  function loadSub(key, announce, tries) {
    var st = P.st; st.sub = key; st.cues = []; subEl.textContent = ''; lastCue = ''; clearTimeout(st.subT);
    tries = tries || 0;
    if (!key) { if (announce) BF.toast(BF.t('p.suboff')); return; }
    var want = key, mid = st.m.id;
    A.text('/api/media/' + mid + '/sub/' + key + '.vtt').then(function (r) {
      if (!P.st || P.st !== st || P.st.sub !== want || P.st.m.id !== mid) return;
      var cues = r.status === 200 ? BF.vtt.parse(r.text) : [];
      if (r.status === 200 && (r.headers.get('X-Subs-Pending') || !cues.length)) {
        if (announce && !tries) BF.toast(BF.t('p.subwait', { l: subLabel(key) }));
        if (tries < 60) st.subT = setTimeout(function () { if (P.st === st && st.sub === want) loadSub(want, announce, tries + 1); }, 3000);
        else BF.toast(BF.t('p.suberr', { l: subLabel(key) }));
        return;
      }
      if (r.status !== 200) { BF.toast(BF.t('p.suberr', { l: subLabel(key) })); return; }
      st.cues = cues; BF.log('player', 'subs ' + key + ' cues ' + cues.length);
      if (announce || tries) BF.toast(BF.t('p.subon', { l: subLabel(key) }));
    }, function (e) { BF.log('player', 'subs err ' + e.message); if (P.st === st && st.sub === want) BF.toast(BF.t('p.suberr', { l: subLabel(key) })); });
  }
  // the server is still preparing / downloading subtitles (Romanian, English): refresh the list, switch to the preferred one
  function watchSubs(st, n) {
    n = n || 0;
    if (P.st !== st || n > 40) return;
    st.subW = setTimeout(function () {
      if (P.st !== st) return;
      A.media(st.m.id).then(function (m) {
        if (P.st !== st) return;
        var had = {}; (st.m.subs || []).forEach(function (s) { had[s.key] = 1; });
        var fresh = (m.subs || []).filter(function (s) { return !had[s.key]; });
        st.m.subs = m.subs || [];
        if (fresh.length) {
          if (!st.subManual && m.prefSub && m.prefSub !== st.sub) { loadSub(m.prefSub, true); saveProgress(); }
          else BF.toast(BF.t('p.subnew', { l: fresh.map(function (s) { return s.display || s.label; }).join(', ') }));
          if (BF.sheets.refresh) BF.sheets.refresh();
        }
        if (m.subsPending) watchSubs(st, n + 1);
      }, function () { watchSubs(st, n + 1); });
    }, 6000);
  }
  var lastCue = '';
  function subs() {
    var st = P.st; if (!st.cues || !st.cues.length) { if (lastCue) { subEl.textContent = ''; lastCue = ''; } return; }
    var c = BF.vtt.cueAt(st.cues, st.pos), txt = c.map(function (x) { return x.t; }).join('\n');
    if (txt === lastCue) return; lastCue = txt;
    subEl.innerHTML = txt ? '<span>' + U().esc(txt).replace(/&lt;(\/?[ib])&gt;/g, '<$1>').replace(/\n/g, '<br>') + '</span>' : '';
  }
  function subStyle(s) { s = s || {}; subEl.className = 'sz-' + (s.size || 'm') + ' c-' + (s.color || 'white') + ' bg-' + (s.bg || 'shadow'); }
  // ---------------- progress / ping / lifecycle
  function saveProgress(credits) {
    var st = P.st; if (!st || !st.started || !st.m) return Promise.resolve();
    var b = { mediaId: st.m.id, position: Math.floor(st.pos), duration: st.duration || st.m.duration, audio: st.audio, sub: st.sub || null, subManual: !!st.subManual };
    if (credits) b.credits = true;
    return A.progress(b).catch(function () {});
  }
  function stopSession() { var st = P.st; if (st && st.sm.sid) { A.playStop(st.sm.sid).catch(function () {}); st.sm.sid = null; } }
  var pingT = null, progT = null;
  function timers() {
    clearInterval(pingT); clearInterval(progT);
    pingT = setInterval(function () {
      var st = P.st; if (!st || !st.sm.sid) return;
      A.playPing(st.sm.sid, st.pos).catch(function (e) {
        if (e.status === 410 && P.st === st && st.sm.phase === 'playing') { BF.log('player', 'session gone (410) -> silent restart at ' + Math.floor(st.pos)); st.sm.sid = null; dispatch({ type: 'start', at: st.pos, attempt: st.attempt }); }
      });
    }, 8000);
    progT = setInterval(function () {
      var now = Date.now(), d = lastProg ? Math.min(now - lastProg, 15000) : 0; lastProg = now;
      var st = P.st; if (!st || st.paused) return; saveProgress();
      if (st.sm.phase === 'playing') watchMs += d;
      if (watchMs > STILL_MS) { watchMs = 0; stillWatching(); }
    }, 10000);
  }
  // ---------------- error screen
  function errorScreen(busy) {
    var st = P.st, u = U(), e = q('.p-err'); u.empty(e); spin(false);
    document.body.classList.remove('av-on');
    e.appendChild(u.txt('div', 'state-t', busy ? BF.t('p.busy') : BF.t('p.err')));
    e.appendChild(u.txt('div', 'p-err-d', (st.sm.mode || '-') + ' · ' + (st.engineName || '-') + ' · step ' + (st.attempt ? st.attempt.step : '-')));
    var bs = [[BF.t('p.retry'), function () { e.classList.remove('on'); st.sm = S.init(); remembered[st.m.id] = null; begin(st.pos, S.firstStep({ quality: st.quality, directBlocked: directOk[A.base] === false })); }]];
    if (!busy && st.quality !== '720') bs.push([BF.t('p.lower'), function () { e.classList.remove('on'); st.sm = S.init(); begin(st.pos, S.step(6, '720')); }]);
    bs.push([BF.t('p.back'), function () { P.close(); }]);
    C.errBtns = []; C.errIdx = 0;
    var row = u.el('div', 'p-err-b'); e.appendChild(row);
    bs.forEach(function (b, i) { var x = u.txt('div', 'btn' + (i === 0 ? ' btn--pri' : ''), b[0]); x.onok = b[1]; row.appendChild(x); C.errBtns.push(x); });
    e.classList.add('on'); paintErr();
  }
  function paintErr() { C.errBtns.forEach(function (b, i) { b.classList.toggle('foc', i === C.errIdx); }); }
  function stats() {
    var st = P.st, e = q('.p-stats'); C.stats = !C.stats; e.classList.toggle('on', C.stats);
    if (!C.stats) return;
    e.textContent = ['mode ' + st.mode + ' · engine ' + st.engineName + ' · step ' + (st.attempt && st.attempt.step), 'reasons: ' + ((st.plan && st.plan.reasons) || []).join('; '),
      'media ' + st.m.id + ' · ' + st.m.res + ' ' + (st.m.hdr || 'SDR') + ' ' + st.m.vcodec, 'pos ' + Math.floor(st.pos) + ' / ' + Math.floor(st.duration || 0), (st.info || '').slice(0, 200)].join('\n');
  }
  function begin(at, attempt) {
    var st = P.st;
    st.attempt = attempt;
    dispatch({ type: 'start', at: at, attempt: attempt });
  }
  // ---------------- public
  P.isOpen = function () { return !!P.st; };
  P._stallWatch = stallWatch;
  P.resetCaches = function () { remembered = {}; directOk = {}; };
  P.onResume = function () { watchMs = 0; lastProg = 0; autoAdvanced = 0; if (BF.dialog.isOpen && BF.dialog.isOpen()) BF.dialog.close(); };
  P._debugStill = function (ms) { STILL_MS = ms; };
  function backdrop(imdb) {
    var e = q('.p-bd'); e.classList.remove('on'); if (!imdb) return;
    e.onload = function () { if (P.st && !P.st.started) e.classList.add('on'); };
    e.src = A.img('background', imdb, 1280);
  }
  P.open = function (mediaId, o, chained) {
    o = o || {};
    box = box || document.getElementById('player'); ui = ui || document.getElementById('pui'); subEl = subEl || document.getElementById('psub');
    if (P.st && !chained) P.close(true);
    if (!chained || !ui.firstChild) buildUi();
    box.className = 'on'; document.body.classList.add('p-open');
    C.upnextDismissed = false; closeUn(false); C.skipShown = null; C.skipArm = 0; if (ui.firstChild) q('.p-skip').classList.remove('on'); C.pend = null; C.sheet = null; C.zone = 'buttons'; C.btn = 'pp';
    q('.p-err').classList.remove('on');
    if (!localStorage.getItem('bf_q7')) { localStorage.removeItem('bf_quality'); localStorage.setItem('bf_q7', '1'); }
    var st = P.st = { sm: S.init(), pos: 0, duration: 0, paused: false, onClose: o.onClose, onEvent: o.onEvent, imdb: o.imdb, title: o.title, quality: o.quality || localStorage.getItem('bf_quality') || 'auto', sw: SW.init() };
    q('.p-title').textContent = o.title || ''; q('.p-sub').textContent = ''; q('.p-mode').textContent = BF.t('p.loading');
    backdrop(o.imdb); spin(true); stallWatch(); show(true);
    A.media(mediaId).then(function (m) {
      if (P.st !== st) return;
      st.m = m; st.duration = m.duration || 0; if (!st.imdb && m.imdb) backdrop(m.imdb); st.imdb = st.imdb || m.imdb;
      var ov = BF.playOverride && BF.playOverride.mediaId === m.id ? BF.playOverride : null;
      st.audio = ov ? ov.audio : (m.defaultAudio || 0);
      q('.p-title').textContent = o.title || m.title || '';
      q('.p-sub').textContent = m.season != null ? BF.t('meta.ep', { s: m.season, e: m.episode }) + (m.episodeName ? ' · ' + m.episodeName : '') : '';
      subStyle(m.subStyle); loadSub(ov ? ov.sub : m.defaultSub); if (m.subsPending) watchSubs(st);
      var at = o.start != null ? o.start : (m.position > 30 && !m.watched ? Math.max(0, m.position - 3) : 0);
      // still downloading: never start past what is on disk (the player would wait forever for those bytes)
      if (m.downloading && m.availableSec != null && at > m.availableSec - 20) {
        at = Math.max(0, Math.floor(m.availableSec - 60));
        BF.toast(BF.t('p.dlonly', { t: BF.fmt.clock(at) }));
      }
      st.pos = at;
      timers(); stallWatch();
      // RC4 probe: header-less direct GET (AVPlay cannot send X-Profile). 404 -> start the ladder at HLS.
      var need = !o.force && !remembered[m.id] && directOk[A.base] == null;
      var probe = need ? fetch(A.authUrl('/api/media/' + m.id + '/file'), { headers: { Range: 'bytes=0-1' } }).then(function (r) { directOk[A.base] = r.status === 206 || r.status === 200; BF.log('player', 'direct probe ' + r.status); }, function () {}) : Promise.resolve();
      probe.then(function () {
        if (P.st !== st) return;
        begin(at, S.firstStep({ force: o.force, remembered: remembered[m.id], quality: st.quality, directBlocked: directOk[A.base] === false }));
      });
    }, function (e) { BF.toast(BF.t('x.error', { e: e.message })); P.close(); });
  };
  P.pause = function () { var st = P.st; if (!st || !eng) return; eng.pause(); st.paused = true; spin(false); saveProgress(); show(true); st.pauseAt = Date.now(); setTimeout(function () { if (P.st === st && st.paused && Date.now() - st.pauseAt >= 30000) screensaver(true); }, 30500); };
  P.resume = function () { var st = P.st; if (!st || !eng) return; eng.play(); st.paused = false; st.advAt = Date.now(); spin(true); screensaver(false); show(); };
  P.restart = function (at, patch) {
    var st = P.st; if (!st) return;
    if (patch) for (var k in patch) st[k] = patch[k];
    var a = st.attempt;
    if (patch && patch.quality) a = S.firstStep({ quality: patch.quality, directBlocked: directOk[A.base] === false });
    begin(at, a);
  };
  P.state = function () { return P.st; };
  P.loadSub = function (k) { if (P.st) P.st.subManual = true; loadSub(k, true); saveProgress(); };
  P.close = function (silent) {
    var st = P.st; if (!st) return;
    saveProgress();
    dispatch({ type: 'close' });
    clearInterval(pingT); clearInterval(progT); clearTimeout(C.hideT); clearTimeout(C.pendT); clearTimeout(st.subT); clearTimeout(st.subW); closeUn(false);
    if (C.sheet) BF.sheets.close();
    P.st = null; eng = null; clearInterval(stallT); q('.p-spin').classList.remove('on');
    box.className = 'off'; document.body.classList.remove('av-on'); document.body.classList.remove('p-open');
    subEl.textContent = ''; lastCue = ''; screensaver(true);
    if (!silent && st.onClose) setTimeout(st.onClose, 300);
  };
  P.visibility = function (hidden) {
    var st = P.st; if (!st) return;
    if (hidden) {
      BF.log('player', 'hidden: save + stop session at ' + Math.floor(st.pos));
      st.resumeAt = st.pos; saveProgress();
      if (eng) eng.stop(); eng = null; stopSession(); st.sm = S.init();
    } else if (st.resumeAt != null) {
      BF.log('player', 'visible: reopen at ' + Math.floor(st.resumeAt));
      var at = st.resumeAt; st.resumeAt = null; begin(at, st.attempt);
    }
  };
  P.sheetClosed = function () { C.sheet = null; show(); };
  P.key = function (k) {
    var st = P.st; if (!st) return false;
    watchMs = 0; autoAdvanced = 0;
    if (q('.p-err').classList.contains('on')) {
      if (k === 'left') C.errIdx = Math.max(0, C.errIdx - 1); else if (k === 'right') C.errIdx = Math.min(C.errBtns.length - 1, C.errIdx + 1);
      else if (k === 'enter') C.errBtns[C.errIdx].onok(); else if (k === 'back') P.close();
      paintErr(); return true;
    }
    if (C.sheet) { if (BF.sheets.key(k)) return true; }
    if (C.upnext) {
      if (k === 'left' || k === 'right') { C.upnext.idx = 1 - C.upnext.idx; paintUn(); return true; }
      if (k === 'enter') { if (C.upnext.idx === 0) playNext(false); else closeUn(true); return true; }
      if (k === 'back') { closeUn(true); return true; }
    }
    if (k === 'enter' && skipArmed()) { doSkip(); return true; }
    if (C.zone === 'skip' && C.shown) {
      if (k === 'down') { C.zone = 'timeline'; show(); paintSkip(); return true; }
      if (k === 'up' || k === 'left' || k === 'right') return true;
    }
    switch (k) {
      case 'back':
        if (C.pend != null) { cancelSeek(); return true; }
        if (C.stats) { stats(); return true; }
        if (C.shown && !st.paused) { hide(); return true; }
        P.close(); return true;
      case 'stop': P.close(); return true;
      case 'playpause': if (st.paused) P.resume(); else P.pause(); return true;
      case 'play': P.resume(); return true;
      case 'pause': P.pause(); return true;
      case 'ff': seekBy(1, 30); return true;
      case 'rw': seekBy(-1, 30); return true;
      case 'next': if (st.m.nextMedia) playNext(false); return true;
      case 'prev': seekTo(0); return true;
      case 'red': BF.sheets.open('as'); C.sheet = 'as'; show(true); return true;
      case 'green': BF.sheets.open('quality'); C.sheet = 'quality'; show(true); return true;
      case 'yellow': st.subManual = true; loadSub(st.sub ? null : (st.m.prefSub || st.m.defaultSub || ((st.m.subs || []).filter(function (x) { return x.text; })[0] || {}).key), true); saveProgress(); return true;
      case 'blue': stats(); return true;
      case 'info': show(); return true;
    }
    var dm = /^d(\d)$/.exec(k);
    if (dm && C.shown && +dm[1] > 0 && st.duration) { seekTo(st.duration * +dm[1] / 10); return true; }
    if (!C.shown) {
      if (k === 'left') { seekBy(-1); return true; }
      if (k === 'right') { seekBy(1); return true; }
      if (k === 'enter') { if (st.paused) P.resume(); else P.pause(); return true; }
      show(); return true;
    }
    if (C.zone === 'timeline') {
      if (k === 'left') { seekBy(-1); return true; }
      if (k === 'right') { seekBy(1); return true; }
      if (k === 'enter') { if (C.pend != null) commitSeek(); else if (st.paused) P.resume(); else P.pause(); return true; }
      if (k === 'down') { commitSeek(); C.zone = 'buttons'; show(); return true; }
      if (k === 'up') { if (C.skipShown) { C.zone = 'skip'; paintSkip(); } show(); return true; }
    } else {
      var els = btnEls(), ids = els.map(function (e) { return e.getAttribute('data-id'); }), i = ids.indexOf(C.btn);
      if (k === 'left' && i > 0) { C.btn = ids[i - 1]; show(); return true; }
      if (k === 'right' && i < ids.length - 1) { C.btn = ids[i + 1]; show(); return true; }
      if (k === 'up') { C.zone = 'timeline'; show(); return true; }
      if (k === 'enter') {
        var id = C.btn;
        if (id === 'pp') { if (st.paused) P.resume(); else P.pause(); }
        else if (id === 'back10') seekTo(Math.max(0, st.pos - 10));
        else if (id === 'fwd10') seekTo(st.pos + 10);
        else if (id === 'restart') seekTo(0);
        else if (id === 'next') playNext(false);
        else if (id === 'subs') { BF.sheets.open('as'); C.sheet = 'as'; show(true); }
        else if (id === 'quality') { BF.sheets.open('quality'); C.sheet = 'quality'; show(true); }
        show(st.paused); return true;
      }
      show(); return true;
    }
    return true;
  };
  BF.player = P;
})(window);
