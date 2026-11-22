/* BF.t(key, vars), language switch, server-string maps. Pure (unit-tested). */
(function (root) {
  'use strict';
  var S = typeof BF_STRINGS !== 'undefined' ? BF_STRINGS : require('./strings.js');
  var lang = 'ro';
  try { lang = (root.localStorage && root.localStorage.getItem('bf_lang')) || 'ro'; } catch (e) { /* */ }
  function t(key, vars) {
    var s = (S[lang] && S[lang][key]) || S.ro[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return s;
  }
  function has(key) { return S.ro[key] != null; }
  var api = {
    t: t,
    lang: function () { return lang; },
    setLang: function (l) { lang = S[l] ? l : 'ro'; try { root.localStorage.setItem('bf_lang', lang); } catch (e) { /* */ } },
    badge: function (b) { return b ? (has('badge.' + b) ? t('badge.' + b) : b) : ''; },
    genre: function (g) { return has('g.' + g) ? t('g.' + g) : g; },
    rowTitle: function (row) {
      var k = row.key || '';
      if (k.indexOf('chart:') === 0) return row.title;
      if (k.indexOf('g:') === 0) return api.genre(k.slice(2));
      return has('row.' + k) ? t('row.' + k) : row.title;
    }
  };
  if (typeof module !== 'undefined') module.exports = api; else { root.BF = root.BF || {}; root.BF.i18n = api; root.BF.t = t; }
})(typeof window !== 'undefined' ? window : global);
