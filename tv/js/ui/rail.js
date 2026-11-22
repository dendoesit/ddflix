/* Left rail navigation (PLAN §10.1): collapsed pill + expanded panel + profile submenu. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var IC = {
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    series: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    movies: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
    library: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="M17.5 5.2l3.6 14.3"/></svg>',
    mylist: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>'
  };
  BF.icons = IC;
  var ROWS = ['search', 'home', 'series', 'movies', 'library', 'mylist'];
  function Rail(sec, current, profile) {
    var U = BF.util;
    this.current = current; this.open = false; this.sub = false; this.idx = ROWS.indexOf(current) + 1; this.subIdx = 0; this.profile = profile || {};
    var r = this.el = U.el('div', 'rail');
    var av = U.el('img', 'rail-av'); r.appendChild(av);
    if (profile) BF.images.load(av, BF.api.avatar(profile), 1);
    var pill = U.el('div', 'rail-pill');
    ['search', 'home', 'mylist'].forEach(function (k) { var i = U.el('div', 'rail-ic' + (k === current || (k === 'home' && (current === 'series' || current === 'movies')) ? ' on' : ''), IC[k]); pill.appendChild(i); });
    r.appendChild(pill);
    r.appendChild(U.el('div', 'rail-b', BF.logo.mark(44)));
    // expanded panel
    var p = this.panel = U.el('div', 'rpanel');
    var prow = this.prow = U.el('div', 'rp-prof');
    var pav = U.el('img', 'rp-av'); prow.appendChild(pav);
    if (profile) BF.images.load(pav, BF.api.avatar(profile), 1);
    var pt = U.el('div', 'rp-pt'); pt.appendChild(U.txt('div', 'rp-name', profile ? profile.name : '')); pt.appendChild(U.txt('div', 'rp-sw', BF.t('nav.switch')));
    prow.appendChild(pt); prow.appendChild(U.el('div', 'rp-chev', IC.chev));
    p.appendChild(prow);
    this.items = [prow];
    var self = this;
    ROWS.forEach(function (k) {
      var it = U.el('div', 'rp-row' + (k === current ? ' cur' : ''));
      it.appendChild(U.el('span', 'rp-ic', IC[k])); it.appendChild(U.txt('span', 'rp-l', BF.t('nav.' + k)));
      p.appendChild(it); self.items.push(it);
    });
    // submenu
    var sm = this.subEl = U.el('div', 'rsub');
    this.subItems = [];
    var subs = [['switch', BF.t('nav.switch')]];
    var kids = (BF.state.profiles || []).filter(function (x) { return x.kind === 'kids' && !x.hasPin; })[0];
    if (kids && this.profile.kind !== 'kids') subs.push(['kids', BF.t('nav.kids')]);
    subs.push(['help', BF.t('nav.help')]); subs.push(['exit', BF.t('nav.exit')]);
    subs.forEach(function (s) { var e = U.txt('div', 'rs-row', s[1]); e.setAttribute('data-k', s[0]); sm.appendChild(e); self.subItems.push(e); });
    this.kids = kids;
    sm.appendChild(U.txt('div', 'rs-hint', BF.t('nav.webedit')));
    r.appendChild(p); r.appendChild(sm);
    sec.appendChild(r);
  }
  Rail.prototype.paint = function () {
    this.el.classList.toggle('open', this.open);
    this.el.classList.toggle('sub', this.sub);
    for (var i = 0; i < this.items.length; i++) this.items[i].classList.toggle('foc', this.open && !this.sub && i === this.idx);
    for (i = 0; i < this.subItems.length; i++) this.subItems[i].classList.toggle('foc', this.sub && i === this.subIdx);
    this.prow.classList.toggle('subon', this.sub);
  };
  Rail.prototype.show = function (onClose) { this.open = true; this.sub = false; this.idx = ROWS.indexOf(this.current) + 1; if (this.idx < 1) this.idx = 2; this.onClose = onClose; this.paint(); };
  Rail.prototype.hide = function () { this.open = false; this.sub = false; this.paint(); if (this.onClose) this.onClose(); };
  Rail.prototype.key = function (k) {
    if (!this.open) return false;
    if (this.sub) {
      if (k === 'up') this.subIdx = Math.max(0, this.subIdx - 1);
      else if (k === 'down') this.subIdx = Math.min(this.subItems.length - 1, this.subIdx + 1);
      else if (k === 'left' || k === 'back') this.sub = false;
      else if (k === 'enter') { this.doSub(this.subItems[this.subIdx].getAttribute('data-k')); return true; }
      this.paint(); return true;
    }
    if (k === 'up') this.idx = Math.max(0, this.idx - 1);
    else if (k === 'down') this.idx = Math.min(this.items.length - 1, this.idx + 1);
    else if (k === 'right' && this.idx === 0) { this.sub = true; this.subIdx = 0; }
    else if (k === 'right' || k === 'back') { this.hide(); return true; }
    else if (k === 'enter') {
      if (this.idx === 0) { this.sub = true; this.subIdx = 0; }
      else { var dest = ROWS[this.idx - 1]; this.hide(); BF.go(dest); return true; }
    }
    this.paint(); return true;
  };
  Rail.prototype.doSub = function (k) {
    this.hide();
    if (k === 'switch') BF.router.go('profiles', null, { reset: true });
    else if (k === 'kids') BF.selectProfile(this.kids);
    else if (k === 'help') BF.router.go('help');
    else if (k === 'exit') BF.dialog.exit();
  };
  BF.Rail = Rail;
})(window);
