/* Server access: base pick (LAN then remote), device token, profile, retries, typed endpoints. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var LS = root.localStorage || { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  var CFG = root.BF_CONFIG || {}, DEF_LAN = CFG.lanApi || '', DEF_REMOTE = CFG.remoteApi || '';
  function enc(s) { return encodeURIComponent(s); }
  var API = {
    base: LS.getItem('bf_base') || LS.getItem('bf_lan') || DEF_LAN,
    token: LS.getItem('bf_token') || '',
    profile: LS.getItem('bf_profile') || '',
    onUnauthorized: null, onProfileLocked: null,
    bases: function () { return [LS.getItem('bf_lan') || DEF_LAN, LS.getItem('bf_remote') || DEF_REMOTE]; },
    defaults: { lan: DEF_LAN, remote: DEF_REMOTE },
    isLan: function () { return this.base === this.bases()[0]; },
    pick: function () {
      var self = this, list = this.bases(), i = 0;
      function next() {
        if (i >= list.length) { var e = new Error('unreachable'); e.unreachable = true; return Promise.reject(e); }
        var b = list[i++], ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var tm = setTimeout(function () { if (ctl) ctl.abort(); }, 3000);
        return fetch(b + '/api/device/ping', { signal: ctl ? ctl.signal : undefined }).then(function () {
          clearTimeout(tm); self.base = b; LS.setItem('bf_base', b); return b;
        }, function () { clearTimeout(tm); return next(); });
      }
      return next();
    },
    setToken: function (t) { this.token = t; LS.setItem('bf_token', t); },
    setProfile: function (p) { this.profile = String(p); LS.setItem('bf_profile', this.profile); },
    clearProfile: function () { this.profile = ''; LS.removeItem('bf_profile'); },
    signOut: function () { LS.removeItem('bf_token'); LS.removeItem('bf_profile'); this.token = ''; this.profile = ''; },
    profileId: function () { return parseInt(String(this.profile).split('.')[0], 10) || null; },
    profileParam: function () { return this.profile ? 'p=' + enc(this.profile) : ''; },
    // header-less URLs (AVPlay, <img>, trickplay): token (and profile, honoured after server change S1) in the query
    authUrl: function (path) {
      var q = 't=' + enc(this.token) + (this.profile ? '&' + this.profileParam() : '');
      return this.base + path + (path.indexOf('?') >= 0 ? '&' : '?') + q;
    },
    mediaUrl: function (path) { return path.indexOf('/s/') === 0 ? this.base + path : this.authUrl(path); },
    img: function (kind, imdb, w) { return this.base + '/img/' + kind + '/' + imdb + '?t=' + enc(this.token) + (w ? '&w=' + w : ''); },
    epImg: function (imdb, s, e, w) { return this.base + '/img/episode/' + imdb + '/' + s + '/' + e + '?t=' + enc(this.token) + (w ? '&w=' + w : ''); },
    avatar: function (p) { return p && p.avatarUrl ? this.base + p.avatarUrl + '?t=' + enc(this.token) : ''; },
    headers: function (json, noProfile) {
      var h = { 'Authorization': 'Bearer ' + this.token };
      if (this.profile && !noProfile) h['X-Profile'] = this.profile;
      if (json) h['Content-Type'] = 'application/json';
      return h;
    },
    raw: function (method, path, body, opts) {
      var self = this; opts = opts || {};
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tm = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || 12000);
      return fetch(self.base + path, { method: method, headers: self.headers(!!body, opts.noProfile), body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(tm); return r; }, function (e) { clearTimeout(tm); throw e; });
    },
    req: function (method, path, body, opts) {
      var self = this; opts = opts || {};
      var tries = opts.retries != null ? opts.retries : (method === 'GET' ? 2 : 0);
      function once() {
        return self.raw(method, path, body, opts).then(function (r) {
          return r.text().then(function (t) {
            var d = null; try { d = JSON.parse(t); } catch (e) { /* */ }
            if (!r.ok) {
              var err = new Error((d && d.error) || ('HTTP ' + r.status)); err.status = r.status; err.data = d;
              if (r.status === 401 && self.token && self.onUnauthorized && path.indexOf('/api/device/pair') !== 0) self.onUnauthorized();
              if (r.status === 403 && d && /profile locked/.test(d.error || '') && self.onProfileLocked) self.onProfileLocked();
              throw err;
            }
            return d;
          });
        });
      }
      function attempt(n) {
        return once().catch(function (e) {
          if (n > 0 && !e.status) return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return attempt(n - 1); });
          throw e;
        });
      }
      return attempt(tries);
    },
    text: function (path) {
      return this.raw('GET', path, null, { timeout: 20000 }).then(function (r) {
        return r.text().then(function (t) { return { status: r.status, headers: r.headers, text: t }; });
      });
    },
    get: function (p, o) { return this.req('GET', p, null, o); },
    post: function (p, b, o) { return this.req('POST', p, b || {}, o); },
    del: function (p, b) { return this.req('DELETE', p, b); },
    // typed helpers
    pairStart: function (name) { return this.post('/api/device/pair/start', { name: name, kind: 'tv' }); },
    pairPoll: function (dc) { return this.post('/api/device/pair/poll', { deviceCode: dc }, { timeout: 8000 }); },
    ping: function () { return this.get('/api/device/ping', { retries: 0, timeout: 6000 }); },
    profiles: function () { return this.get('/api/profiles', { noProfile: true }); },
    selectProfile: function (id, pin) { return this.post('/api/profiles/' + id + '/select', { pin: pin || '' }); },
    home: function (q) { return this.get('/api/home' + (q || '')); },
    // profile picker background: no profile chosen yet -> request without X-Profile = server's kids-safe catalogue
    featured: function () { return this.get('/api/home', { noProfile: true }); },
    // trailer warm-up (S5 prefetch; S10 adds {state, etaS}); deduped per title for 2 min
    _tpf: {},
    trailerPrefetch: function (imdb, force) {
      var now = Date.now(), last = this._tpf[imdb];
      if (!force && last && now - last.at < 120000) return last.p;
      var p = this.post('/api/title/' + imdb + '/trailer/prefetch', {}, { retries: 0 }).then(function (r) { return r || {}; }, function () { return {}; });
      this._tpf[imdb] = { at: now, p: p }; return p;
    },
    cont: function () { return this.get('/api/continue'); },
    recent: function () { return this.get('/api/library/recent'); },
    mylist: function () { return this.get('/api/mylist'); },
    mylistAdd: function (imdb) { return this.post('/api/mylist/' + imdb, {}); },
    mylistDel: function (imdb) { return this.del('/api/mylist/' + imdb); },
    title: function (imdb) { return this.get('/api/title/' + imdb + '?norefresh=1'); },
    tvDownload: function (imdb, rid, season) { var b = { imdb: imdb, release_id: rid }; if (season != null) b.season = season; return this.post('/api/tv/download', b); },
    playable: function (imdb) { return this.get('/api/playable/' + imdb); },
    search: function (q) { return this.get('/api/search?q=' + enc(q), { retries: 0 }); },
    searchLive: function (q) { return this.get('/api/search/live?q=' + enc(q), { retries: 0, timeout: 20000 }); },
    browse: function (q) { return this.get('/api/browse' + q); },
    media: function (id) { return this.get('/api/media/' + id); },
    play: function (b) { return this.post('/api/play', b, { timeout: 30000 }); },
    playPing: function (sid, pos) { return this.post('/api/play/' + sid + '/ping', { position: pos }, { timeout: 6000 }); },
    playStop: function (sid) { return this.req('DELETE', '/api/play/' + sid, null, { retries: 0, timeout: 5000 }); },
    progress: function (b) { return this.post('/api/progress', b); },
    playEvent: function (b) { return this.post('/api/play/event', b).catch(function () {}); },
    rate: function (imdb, v) { return this.post('/api/rating/' + imdb, { value: v }); },
    watched: function (imdb, w) { return this.post('/api/watched', { imdb: imdb, watched: w }); },
    check: function () {
      var self = this, t0 = Date.now();
      return this.ping().then(function (d) { return { ok: true, ms: Date.now() - t0, base: self.base, device: d && d.device }; },
        function (e) { return { ok: false, ms: Date.now() - t0, base: self.base, error: e.message, status: e.status }; });
    }
  };
  BF.api = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : global);
