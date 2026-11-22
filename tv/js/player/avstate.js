/* Playback state machine + fallback ladder (pure; test/avstate.test.js). PLAN §4.8.
   reduce(state, event) -> {state, effects[]}. Every async event carries gen; stale gens are dropped. */
(function (root) {
  'use strict';
  var FULL = { hevc: true, hdr: true, ac3: true, eac3: true, mkv: true };
  var NONE = { hevc: false, hdr: false, ac3: false, eac3: false, mkv: false };
  var STEPS = [
    null,
    { step: 1, engine: 'avplay', forceHls: false, caps: FULL, quality: null },
    { step: 2, engine: 'avplay', forceHls: true, caps: FULL, quality: null },
    { step: 3, engine: 'html5', forceHls: true, caps: FULL, quality: null },
    { step: 4, engine: 'avplay', forceHls: true, caps: NONE, quality: '1080' },
    { step: 5, engine: 'html5', forceHls: true, caps: NONE, quality: '1080' },
    { step: 6, engine: 'avplay', forceHls: true, caps: NONE, quality: '720' }
  ];
  function step(n, userQ) {
    var s = STEPS[n]; if (!s) return null;
    return { step: s.step, engine: s.engine, forceHls: s.forceHls, caps: s.caps, quality: s.quality || userQ || 'auto' };
  }
  // first step: forced mode (Lab), or 1; skip direct when the header-less probe failed (RC4 until server S1)
  function firstStep(o) {
    o = o || {};
    if (o.force === 'hls') return step(2, o.quality);
    if (o.force === 'html5') return step(3, o.quality);
    if (o.force === 'transcode') return step(4, '1080');
    if (o.remembered) return step(o.remembered, o.quality);
    if (o.directBlocked) return step(2, o.quality);
    return step(1, o.quality);
  }
  function nextStep(prev, mode) {
    var n = prev.step + 1;
    // server already answered with HLS at step 1: step 2 would repeat the same request on the same engine
    if (prev.step === 1 && mode && mode !== 'direct') n = 3;
    // a user-chosen low quality is never raised by the ladder
    var s = step(n, prev.quality);
    if (s && prev.quality === '720' && s.quality === '1080') s.quality = '720';
    return s;
  }
  function init() { return { phase: 'idle', gen: 0, attempt: null, sid: null, mode: null, pendingStart: null, erroredGen: -1, at: 0 }; }
  function copy(s) { var o = {}; for (var k in s) o[k] = s[k]; return o; }
  function reduce(s, ev) {
    var n = copy(s), fx = [];
    switch (ev.type) {
      case 'start':
        if (s.phase === 'requesting' || s.phase === 'preparing') { n.pendingStart = { at: ev.at, attempt: ev.attempt || s.attempt }; return { state: n, effects: fx }; }
        n.gen = s.gen + 1; n.phase = 'requesting'; n.at = ev.at; n.attempt = ev.attempt; n.pendingStart = null;
        fx.push({ type: 'engineStop' });
        fx.push({ type: 'request', gen: n.gen, at: ev.at, attempt: ev.attempt, replace: s.sid });
        return { state: n, effects: fx };
      case 'playResp':
        if (ev.gen !== s.gen || s.phase !== 'requesting') { if (ev.sid) fx.push({ type: 'stopSession', sid: ev.sid }); return { state: n, effects: fx }; }
        n.sid = ev.sid || null; n.mode = ev.mode; n.phase = 'preparing';
        fx.push({ type: 'open', gen: s.gen, url: ev.url, at: s.at, attempt: s.attempt, mode: ev.mode });
        return { state: n, effects: fx };
      case 'playErr':
        if (ev.gen !== s.gen || s.phase !== 'requesting') return { state: n, effects: fx };
        if (ev.status === 429) { n.phase = 'error'; fx.push({ type: 'errorScreen', busy: true }); return { state: n, effects: fx }; }
        return fail(n, fx, ev);
      case 'prepared':
        if (ev.gen !== s.gen || s.phase !== 'preparing') return { state: n, effects: fx };
        n.phase = 'playing'; fx.push({ type: 'started', step: s.attempt && s.attempt.step });
        if (s.pendingStart) { var p = s.pendingStart; n.pendingStart = null; var r = reduce(n, { type: 'start', at: p.at, attempt: p.attempt }); r.effects = fx.concat(r.effects); return r; }
        return { state: n, effects: fx };
      case 'error':
        if (ev.gen !== s.gen || s.erroredGen === s.gen || s.phase === 'closed' || s.phase === 'idle') return { state: n, effects: fx };
        if (s.pendingStart && (s.phase === 'preparing')) { var ps = s.pendingStart; n.pendingStart = null; n.phase = 'idle'; n.erroredGen = s.gen; return reduce(n, { type: 'start', at: ps.at, attempt: ps.attempt }); }
        return fail(n, fx, ev);
      case 'close':
        n.phase = 'closed'; n.gen = s.gen + 1; n.pendingStart = null;
        fx.push({ type: 'engineStop' });
        if (s.sid) fx.push({ type: 'stopSession', sid: s.sid });
        n.sid = null;
        return { state: n, effects: fx };
    }
    return { state: n, effects: fx };
  }
  function fail(n, fx, ev) {
    n.erroredGen = n.gen;
    fx.push({ type: 'logError', gen: n.gen, code: ev.code || ev.status, step: n.attempt && n.attempt.step });
    var nx = n.attempt ? nextStep(n.attempt, n.mode) : null;
    if (!nx) { n.phase = 'error'; fx.push({ type: 'errorScreen', busy: false }); return { state: n, effects: fx }; }
    n.phase = 'idle';
    var r = reduce(n, { type: 'start', at: ev.at != null ? ev.at : n.at, attempt: nx });
    r.effects = fx.concat(r.effects);
    return r;
  }
  var api = { init: init, reduce: reduce, firstStep: firstStep, nextStep: nextStep, step: step, FULL: FULL, NONE: NONE };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.avstate = api; }
})(typeof window !== 'undefined' ? window : global);
