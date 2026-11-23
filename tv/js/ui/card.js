/* Card builders (textContent only for server data). */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  function U() { return BF.util; }
  var C = {
    badgeClass: function (b) { return b === 'New episodes' || b === 'New season' ? 'pill pill--acc' : 'pill'; },
    poster: function (item, w, h) {
      var u = U(), c = u.el('div', 'poster');
      c.appendChild(u.txt('div', 'ph', item.name));
      var img = u.el('img', 'art'); c.appendChild(img);
      if (item.poster !== false) BF.images.load(img, BF.api.img('poster', item.imdb, 400), 3);
      if (item.badge && !item.play) c.appendChild(u.txt('div', C.badgeClass(item.badge) + ' poster-badge', BF.i18n.badge(item.badge)));
      if (item.downloading) c.appendChild(u.txt('div', 'pill pill--acc poster-badge', BF.t('meta.dl', { p: Math.round(item.progress || 0) })));
      // resume bar on every rail: own play data (Continue row) or the per-title map built from /api/continue
      var pc = item.play && item.play.pct > 0 ? item.play.pct : (BF.state && BF.state.progress && BF.state.progress[item.imdb]);
      if (pc > 0) { var pb = u.el('div', 'pbar'); var f = u.el('i'); f.style.width = Math.max(4, Math.round(pc * 100)) + '%'; pb.appendChild(f); c.appendChild(pb); }
      if (item.rank) c.appendChild(u.txt('div', 'poster-rank', String(item.rank)));
      if (item.rating) c.appendChild(u.txt('div', 'poster-imdb', 'IMDb ' + Number(item.rating).toFixed(1)));
      if (item.inLibrary) c.appendChild(u.txt('div', 'poster-nas', 'NAS'));
      c.appendChild(u.el('div', 'ring'));
      return c;
    },
    chips: function (item, max) {
      var out = [];
      if (item.badge) out.push([BF.i18n.badge(item.badge), item.badge === 'New episodes' || item.badge === 'New season']);
      if (item.has4k) out.push([BF.t('chip.4k')]);
      if (item.ro) out.push([BF.t('chip.ro')]);
      if (item.inPlex) out.push([BF.t('meta.inlib')]);
      return out.slice(0, max || 4);
    },
    infoChips: function (item) {
      var out = [];
      if (item.has4k) out.push('4K');
      if (item.dv) out.push('DV'); else if (item.hdr) out.push('HDR');
      if (item.atmos) out.push('Atmos');
      if (item.ro) out.push('RO'); else if (item.rosub) out.push('SUB RO');
      if (item.rating) out.push('IMDb ' + item.rating);
      if (item.certAge) out.push(item.certAge + '+');
      return out;
    },
    metaLine: function (item, extra) {
      var p = [item.type === 'series' ? BF.t('meta.series') : BF.t('meta.movie')];
      if (item.genres && item.genres[0]) p.push(BF.i18n.genre(item.genres[0]));
      if (item.year) p.push(item.year);
      if (extra && extra.runtime && item.type !== 'series') p.push(BF.fmt.mins(extra.runtime));
      if (extra && extra.seasons) p.push(extra.seasons === 1 ? BF.t('meta.season1') : BF.t('meta.seasons', { n: extra.seasons }));
      if (item.certAge) p.push(item.certAge + '+');
      return p.join('  •  ');
    }
  };
  BF.card = C;
})(window);
