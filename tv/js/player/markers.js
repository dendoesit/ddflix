/* Skip-intro / credits / next-episode state (PLAN-ROUND6 2.3). Pure; works with today's chapter markers, v2 fields optional. */
(function (root) {
  'use strict';
  function sane(mk, dur) {
    mk = mk || {}; var o = { intro: null, credits: null };
    var i = mk.intro;
    if (i && i.end != null && i.end - i.start >= 10 && i.end - i.start <= 300 && i.start < 900 && (i.conf == null || i.conf >= 0.5)) o.intro = i;
    var c = mk.credits;
    if (c && c.start != null && (!dur || c.start > 0.5 * dur) && (c.conf == null || c.conf >= 0.5) && !(c.src === 'blackdetect' && dur && dur - c.start > 240)) o.credits = c;
    return o;
  }
  // no credits marker: episodes over 20 min get the card max(60 s, min(150 s, 4 % of the duration)) before the end; short ones 30 s
  function tail(dur) { return dur > 1200 ? Math.max(60, Math.min(150, 0.04 * dur)) : 30; }
  var LAST = 20, PILL = 120;
  // flags: {dismissed}
  function state(mk, t, dur, hasNext, flags) {
    flags = flags || {};
    var m = sane(mk, dur);
    if (dur && dur - t <= 1) return { kind: 'none' };
    if (m.intro && t >= m.intro.start && t < m.intro.end - 2) return { kind: 'intro', to: m.intro.end };
    var inCredits = m.credits && t >= m.credits.start && (m.credits.end == null || t < m.credits.end);
    if (hasNext) {
      // round 7: only a real credits marker opens the card early. blackdetect: card without countdown until the last 20 s.
      // no (sane) credits marker: small corner pill in the last 2 min, card + countdown only in the last 20 s.
      if (flags.dismissed) return { kind: 'none' };
      var left = dur ? dur - t : 1e9, last = left <= LAST;
      if (inCredits) return { kind: 'next', auto: m.credits.src !== 'blackdetect' || last };
      if (last) return { kind: 'next', auto: true };
      if (!m.credits && left <= PILL) return { kind: 'nextpill' };
      return { kind: 'none' };
    }
    if (inCredits) {
      var post = m.credits.end != null && dur && dur - m.credits.end > 20;
      return { kind: 'credits', to: post ? m.credits.end : null };
    }
    return { kind: 'none' };
  }
  var api = { tail: tail, sane: sane, state: state, COUNTDOWN: 7, LAST: LAST, PILL: PILL };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.markers = api; }
})(typeof window !== 'undefined' ? window : global);
