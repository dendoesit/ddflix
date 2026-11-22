const a = require('assert'), S = require('../js/strings.js'), I = require('../js/i18n.js');
const ro = Object.keys(S.ro).sort(), en = Object.keys(S.en).sort();
a.deepStrictEqual(ro, en, 'ro/en key sets differ: ' + ro.filter(k => !S.en[k]).concat(en.filter(k => !S.ro[k])));
for (const k of ro) { const v = s => (s.match(/\{\w+\}/g) || []).sort().join(); a.strictEqual(v(S.ro[k]), v(S.en[k]), 'vars differ in ' + k); }
a.strictEqual(I.t('meta.left', { t: '6 min' }), 'Au rămas 6 min');
a.strictEqual(I.badge('Can download'), 'Nu e încă pe server'); a.strictEqual(I.badge('Weird'), 'Weird');
a.strictEqual(I.rowTitle({ key: 'g:Crime', title: 'Crime' }), 'Polițiste');
a.strictEqual(I.rowTitle({ key: 'chart:x', title: 'Top 10' }), 'Top 10');
a.strictEqual(I.rowTitle({ key: 'zzz', title: 'Server' }), 'Server');
I.setLang('en'); a.strictEqual(I.t('meta.left', { t: '6 min' }), '6 min left'); I.setLang('ro');
console.log('i18n ok');
