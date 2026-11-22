/* actionsFor(title, playable, state) -> {primary, icons[], note, tabs[]} (pure, test/actions.test.js). Download: one button, auto-picked release (owner decision 2026-11). */
(function (root) {
  'use strict';
  // progress arrives as 0-1 (S7 rows) or 0-100 (older rows / pct); season: only rows for that season (series)
  function pct(v) { v = +v || 0; return Math.round(v <= 1 ? v * 100 : v); }
  function activeRow(t, season) {
    return (t.downloads || []).filter(function (x) { return x && !/done|complete|fail|error|cancel|removed/i.test(String(x.state || x.status || '')) && (season == null || x.season === season); })[0] || null;
  }
  function activeDownload(t, season) {
    var d = activeRow(t, season);
    if (d) return pct(d.progress != null ? d.progress : d.pct);
    if (season != null) return null;
    if (t.downloading) return Math.round(t.progress || 0);
    return null;
  }
  // owner rule: 1080p with enough seeders, else 4K with enough seeders, else anything alive (most seeders)
  var MIN_SEED = 5;
  // season: undefined -> movie releases (no season); a number -> that season's packs (series, server S7)
  function pickRelease(t, season) {
    var vs = (t.versions || []).filter(function (v) { return v && !v.extra && (season == null ? v.season == null : v.season === season) && v.source !== 'cam' && (v.seeders || 0) > 0; });
    function best(list) { return list.sort(function (a, b) { return (b.rank || 0) - (a.rank || 0) || (b.seeders || 0) - (a.seeders || 0); })[0] || null; }
    return best(vs.filter(function (v) { return v.resolution === '1080p' && v.seeders >= MIN_SEED; })) ||
      best(vs.filter(function (v) { return v.resolution === '2160p' && v.seeders >= MIN_SEED; })) ||
      vs.sort(function (a, b) { return (b.seeders || 0) - (a.seeders || 0); })[0] || null;
  }
  // first season (> 0) that is not in the library yet and has a pack with seeders
  function seasonToDownload(t, pref) {
    if (pref != null && !(t.seasons || []).some(function (s) { return s.season === pref && (s.inPlex || s.available); }) && activeDownload(t, pref) == null && pickRelease(t, pref)) return pref;
    var ss = (t.seasons || []).filter(function (s) { return s.season > 0 && !s.inPlex && !s.available; }).sort(function (a, b) { return a.season - b.season; });
    for (var i = 0; i < ss.length; i++) if (pickRelease(t, ss[i].season)) return ss[i].season;
    return null;
  }
  function actionsFor(t, p, st) {
    st = st || {};
    var next = p && p.next, out = { primary: null, icons: [], note: null, tabs: [] };
    var series = t.type === 'series';
    if (next) {
      var resume = next.position > 30 && !next.watched;
      if (series && next.season != null) out.primary = { id: 'play', key: resume ? 'title.resumeSE' : 'title.playSE', vars: { s: next.season, e: next.episode } };
      else out.primary = { id: 'play', key: resume ? 'title.resume' : 'title.play' };
      out.icons.push({ id: 'mylist', on: !!st.inList });
      if (resume) out.icons.push({ id: 'restart' });
      out.icons.push({ id: 'rate', value: st.rating || 0 });
      if (resume || st.inCont) out.icons.push({ id: 'remove' });
    } else {
      out.icons.push({ id: 'mylist', on: !!st.inList });
      var dl = activeDownload(t);
      var dr = activeRow(t);
      // series: a selected season that can be downloaded wins over another season's progress
      if (series && st.season != null && seasonToDownload(t, st.season) === st.season && activeDownload(t, st.season) == null) { out.primary = { id: 'download', key: 'title.dlseason', vars: { s: st.season }, season: st.season }; out.note = { key: 'title.notonserver' }; }
      else if (dl != null) out.primary = series && dr && dr.season != null ? { id: 'dlprog', key: 'title.dlseasonprog', vars: { s: dr.season, p: dl }, progress: dl, season: dr.season } : { id: 'dlprog', key: 'title.downloading', vars: { p: dl }, progress: dl };
      else if (!series && pickRelease(t)) { out.primary = { id: 'download', key: 'title.download' }; out.note = { key: 'title.notonserver' }; }
      else if (series && seasonToDownload(t, st.season) != null) { var sn = seasonToDownload(t, st.season); out.primary = { id: 'download', key: 'title.dlseason', vars: { s: sn }, season: sn }; out.note = { key: 'title.notonserver' }; }
      else out.note = { key: series ? 'title.notonserver' : 'title.nodl' };
    }
    if (series && next) out.tabs.push('episodes');
    else if (series && t.seasons && t.seasons.length) out.tabs.push('episodes');
    out.tabs.push('details');
    out.tabs.push('similar');
    if (next) out.tabs.push('audiosubs');
    if (t.trailer) out.tabs.push('trailers');
    return out;
  }
  var api = { actionsFor: actionsFor, activeDownload: activeDownload, pct: pct, pickRelease: pickRelease, seasonToDownload: seasonToDownload };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.actions = api; }
})(typeof window !== 'undefined' ? window : global);
