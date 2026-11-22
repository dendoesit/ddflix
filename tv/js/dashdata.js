/* BUBUFLIX dashboard data layer. ES2018 only (Tizen 6 / Chromium 76). */
var BFD = (function () {
  var HOME = BF_CONFIG.home;
  var WMO = {
    0: ['Senin', '☀️'], 1: ['Predominant senin', '🌤️'], 2: ['Parțial noros', '⛅'], 3: ['Înnorat', '☁️'],
    45: ['Ceață', '☁️'], 48: ['Ceață', '☁️'], 51: ['Burniță', '🌦️'], 53: ['Burniță', '🌦️'], 55: ['Burniță', '🌦️'],
    61: ['Ploaie slabă', '🌧️'], 63: ['Ploaie', '🌧️'], 65: ['Ploaie puternică', '🌧️'],
    71: ['Ninsoare slabă', '❄️'], 73: ['Ninsoare', '❄️'], 77: ['Fulgi', '❄️'], 85: ['Averse de ninsoare', '❄️'], 86: ['Averse de ninsoare', '❄️'], 75: ['Ninsoare abundentă', '❄️'],
    80: ['Averse', '🌦️'], 81: ['Averse', '🌧️'], 82: ['Averse puternice', '⛈️'], 95: ['Furtună', '⛈️'], 96: ['Furtună', '⛈️'], 99: ['Furtună', '⛈️']
  };
  var DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
  var MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

  // Demo content until the server exposes /api/dashboard (news RSS + stocks need a server-side proxy: no CORS).
  var DEMO = {
    newsRo: [
      { t: 'Guvernul anunță noi măsuri pentru reducerea deficitului bugetar în 2027', s: 'Digi24', ago: '25 min' },
      { t: 'Autostrada A0 Nord: încă un lot deschis circulației lângă București', s: 'HotNews', ago: '1 h' },
      { t: 'ANM: cod galben de ceață în București până la ora 10', s: 'Mediafax', ago: '2 h' },
      { t: 'BNR menține dobânda de politică monetară la 6,50%', s: 'Ziarul Financiar', ago: '3 h' }
    ],
    newsWorld: [
      { t: 'EU leaders reach agreement on new energy security package', s: 'Reuters', ago: '40 min' },
      { t: 'Fed signals pause as inflation cools for third straight month', s: 'Bloomberg', ago: '1 h' },
      { t: 'Record-breaking launch puts 60 satellites in orbit in one mission', s: 'BBC', ago: '2 h' },
      { t: 'Climate summit closes with pledge on methane cuts', s: 'AP', ago: '4 h' }
    ],
    stocks: [
      { sym: 'S&P 500', p: 6812.4, ch: 0.62 }, { sym: 'NASDAQ', p: 23950.1, ch: 0.94 },
      { sym: 'BET', p: 19420.7, ch: -0.21 }, { sym: 'NVDA', p: 212.35, ch: 1.88 },
      { sym: 'AAPL', p: 268.1, ch: -0.44 }, { sym: 'EUR/RON', p: 5.0912, ch: 0.03 }
    ]
  };

  var NIGHT = { '☀️': '🌙', '🌤️': '🌙', '⛅': '☁️' };
  function nite(ic, day) { return day ? ic : (NIGHT[ic] || ic); }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function weatherFor(loc) {
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' +
      '&timezone=auto&forecast_days=6';
    return getJSON(u).then(function (d) {
      var c = d.current, now = new Date(), hours = [];
      for (var i = 0; i < d.hourly.time.length && hours.length < 12; i++) {
        var ht = new Date(d.hourly.time[i]);
        if (ht >= now - 3600e3) hours.push({ h: ht.getHours(), t: Math.round(d.hourly.temperature_2m[i]), ic: nite((WMO[d.hourly.weather_code[i]] || ['', '·'])[1], d.hourly.is_day[i]), fog: d.hourly.weather_code[i] === 45 || d.hourly.weather_code[i] === 48, p: d.hourly.precipitation_probability[i] });
      }
      return {
        loc: loc, temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature),
        hum: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m),
        desc: (WMO[c.weather_code] || ['—'])[0], icon: nite((WMO[c.weather_code] || ['', '🌡️'])[1], c.is_day),
        sunrise: d.daily.sunrise[0].slice(11), sunset: d.daily.sunset[0].slice(11), hours: hours,
        days: d.daily.time.map(function (t, k) {
          return { d: k === 0 ? 'Azi' : DAYS[new Date(t).getDay()], ic: (WMO[d.daily.weather_code[k]] || ['', '·'])[1], hi: Math.round(d.daily.temperature_2m_max[k]), lo: Math.round(d.daily.temperature_2m_min[k]), p: d.daily.precipitation_probability_max[k] };
        })
      };
    });
  }
  function currentLocation() {
    return getJSON('https://ipwho.is/').then(function (j) {
      if (!j.success) throw 0;
      return { name: j.city, region: j.region + ', ' + j.country, lat: j.latitude, lon: j.longitude };
    }).catch(function () { return HOME; });
  }
  function crypto() {
    var ids = ['bitcoin', 'ethereum', 'solana'];
    return getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids.join(',') + '&sparkline=true&price_change_percentage=24h')
      .then(function (a) { return a.map(function (c) { return { img: c.image, sym: c.symbol.toUpperCase(), name: c.name, p: c.current_price, ch: c.price_change_percentage_24h, spark: c.sparkline_in_7d.price.filter(function (_, i) { return i % 4 === 0; }) }; }); })
      .catch(function () {
        return [{ sym: 'BTC', name: 'Bitcoin', p: 97250, ch: 1.4 }, { sym: 'ETH', name: 'Ethereum', p: 3620, ch: -0.8 }, { sym: 'SOL', name: 'Solana', p: 214, ch: 2.9 }]
          .map(function (c) { c.spark = fakeSpark(c.ch); return c; });
      });
  }
  function fakeSpark(trend) {
    var a = [], v = 100;
    for (var i = 0; i < 42; i++) { v += (Math.sin(i * 1.7) + Math.cos(i * 0.6)) * 0.9 + trend * 0.08; a.push(v); }
    return a;
  }
  function sparkSVG(pts, w, h, color, fill) {
    var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), r = (mx - mn) || 1;
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * w / (pts.length - 1)).toFixed(1) + ' ' + (h - 3 - (v - mn) / r * (h - 6)).toFixed(1); }).join(' ');
    var area = fill ? '<path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + 'Z" fill="' + fill + '"/>' : '';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + area + '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function clock() {
    var n = new Date();
    return { hm: ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2), date: ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'][n.getDay()] + ', ' + n.getDate() + ' ' + MONTHS[n.getMonth()], h: n.getHours() };
  }
  function greeting(h) { return h < 5 ? 'Noapte bună' : h < 12 ? 'Bună dimineața' : h < 18 ? 'Bună ziua' : 'Bună seara'; }
  function fmt(p) { return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 10 ? p.toFixed(2) : p.toFixed(4); }

  function load() {
    return currentLocation().then(function (here) {
      var same = Math.abs(here.lat - HOME.lat) < 0.4 && Math.abs(here.lon - HOME.lon) < 0.4;
      return Promise.all([weatherFor(HOME), same ? null : weatherFor(here).catch(function () { return null; }), crypto()])
        .then(function (r) { return { home: r[0], here: r[1], atHome: same, crypto: r[2], stocks: DEMO.stocks, newsRo: DEMO.newsRo, newsWorld: DEMO.newsWorld }; });
    });
  }
  return { demo: DEMO, load: load, clock: clock, greeting: greeting, sparkSVG: sparkSVG, fakeSpark: fakeSpark, fmt: fmt };
})();

/* ---- extra widgets (client-side, no keys) ---- */
var BFX = (function () {
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function air(lat, lon) {
    return getJSON('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon + '&current=european_aqi,pm2_5,uv_index,ragweed_pollen,grass_pollen,birch_pollen&timezone=auto')
      .then(function (d) { var c = d.current; return { aqi: c.european_aqi, pm25: c.pm2_5, uv: c.uv_index, pollen: Math.max(c.ragweed_pollen || 0, c.grass_pollen || 0, c.birch_pollen || 0) }; });
  }
  function aqiLabel(a) { return a == null ? ['—', 'g'] : a <= 40 ? ['Aer bun', 'g'] : a <= 60 ? ['Moderat', 'y'] : a <= 80 ? ['Slab', 'y'] : ['Poluat', 'r']; }
  function uvLabel(u) { return u < 3 ? 'scăzut' : u < 6 ? 'moderat' : u < 8 ? 'ridicat' : 'foarte ridicat'; }
  function pollenLabel(p) { return p < 10 ? ['Scăzut', 'g'] : p < 50 ? ['Mediu', 'y'] : ['Ridicat', 'r']; }
  // Moon: synodic month from the 2000-01-06 18:14 UTC new moon
  function moon(d) {
    var syn = 29.530588853, age = ((d.getTime() / 864e5 - 10962.7597) % syn + syn) % syn;
    var illum = Math.round((1 - Math.cos(2 * Math.PI * age / syn)) / 2 * 100);
    var names = ['Lună nouă', 'Semilună în creștere', 'Primul pătrar', 'Lună în creștere', 'Lună plină', 'Lună în descreștere', 'Ultimul pătrar', 'Semilună în descreștere'];
    var icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    var i = Math.floor((age / syn) * 8 + 0.5) % 8;
    return { name: names[i], icon: icons[i], illum: illum };
  }
  function orthodoxEaster(y) {
    var a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
    var m = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
    return new Date(y, m - 1, day + 13);
  }
  function holidays(y) {
    var E = orthodoxEaster(y), add = function (n) { return new Date(E.getFullYear(), E.getMonth(), E.getDate() + n); };
    return [[new Date(y, 0, 1), 'Anul Nou', '🎉'], [new Date(y, 0, 6), 'Boboteaza', '✝️'], [new Date(y, 0, 7), 'Sf. Ioan', '✝️'], [new Date(y, 0, 24), 'Unirea Principatelor', '🇷🇴'],
      [add(-2), 'Vinerea Mare', '✝️'], [E, 'Paștele', '🐣'], [add(1), 'A doua zi de Paște', '🐣'], [new Date(y, 4, 1), 'Ziua Muncii', '🛠️'], [new Date(y, 5, 1), 'Ziua Copilului', '🎈'],
      [add(49), 'Rusaliile', '✝️'], [new Date(y, 7, 15), 'Sfânta Maria', '✝️'], [new Date(y, 10, 30), 'Sf. Andrei', '✝️'], [new Date(y, 11, 1), 'Ziua Națională', '🇷🇴'],
      [new Date(y, 11, 25), 'Crăciunul', '🎄'], [new Date(y, 11, 26), 'A doua zi de Crăciun', '🎄']];
  }
  function nextHolidays(n) {
    var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var all = holidays(now.getFullYear()).concat(holidays(now.getFullYear() + 1));
    return all.filter(function (h) { return h[0].getTime() >= t0; }).sort(function (a, b) { return a[0] - b[0]; }).slice(0, n)
      .map(function (h) { return { name: h[1], icon: h[2], days: Math.round((h[0].getTime() - t0) / 864e5) }; });
  }
  // Main Romanian Orthodox name days (MM-DD -> saint, names)
  var ND = {
    '01-01': ['Sf. Vasile', 'Vasile, Vasilica'], '01-06': ['Boboteaza', 'Botezatu, Iordan'], '01-07': ['Sf. Ioan Botezătorul', 'Ion, Ioan, Ioana, Ionuț'], '01-17': ['Sf. Antonie', 'Anton, Antonia'],
    '01-30': ['Sf. Trei Ierarhi', 'Vasile, Grigore, Ioan'], '02-02': ['Întâmpinarea Domnului', '—'], '02-10': ['Sf. Haralambie', 'Haralambie'], '03-09': ['Sf. 40 de Mucenici', 'Mucenici'],
    '03-25': ['Buna Vestire', 'Maria, Marian, Bunavestire'], '04-23': ['Sf. Gheorghe', 'Gheorghe, George, Georgiana'], '05-21': ['Sf. Constantin și Elena', 'Constantin, Elena, Costel, Ilinca'],
    '06-24': ['Sânziene', 'Ion, Ioana, Sânziana'], '06-29': ['Sf. Petru și Pavel', 'Petru, Pavel, Petra, Paula'], '07-20': ['Sf. Ilie', 'Ilie, Ilinca'], '07-26': ['Sf. Parascheva (Ana)', 'Ana'],
    '08-06': ['Schimbarea la Față', '—'], '08-15': ['Sfânta Maria', 'Maria, Marian, Mariana'], '09-08': ['Sfânta Maria Mică', 'Maria'], '09-14': ['Ziua Crucii', 'Cruceana'],
    '10-14': ['Sf. Parascheva', 'Paraschiva, Paraschiv'], '10-26': ['Sf. Dumitru', 'Dumitru, Dumitrița, Mitică'], '11-08': ['Sf. Arhangheli Mihail și Gavriil', 'Mihai, Mihaela, Gabriel, Gabriela, Raluca'],
    '11-14': ['Sf. Filip', 'Filip'], '11-21': ['Intrarea în Biserică', 'Maria, Marian'], '11-25': ['Sf. Ecaterina', 'Ecaterina, Cătălina, Cătălin'], '11-30': ['Sf. Andrei', 'Andrei, Andreea, Andra'],
    '12-06': ['Sf. Nicolae', 'Nicolae, Nicoleta, Nicu'], '12-27': ['Sf. Ștefan', 'Ștefan, Ștefania, Fănel']
  };
  function nameDay() {
    var n = new Date(), k = ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2);
    if (ND[k]) return { today: true, saint: ND[k][0], names: ND[k][1] };
    for (var i = 1; i < 40; i++) {
      var d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + i), kk = ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      if (ND[kk]) return { today: false, days: i, saint: ND[kk][0], names: ND[kk][1] };
    }
    return null;
  }
  function bnr() {
    return fetch('https://www.bnr.ro/nbrfxrates.xml').then(function (r) { return r.text(); }).then(function (t) {
      var g = function (c) { var m = new RegExp('currency="' + c + '"[^>]*>([0-9.]+)').exec(t); return m ? parseFloat(m[1]) : null; };
      return { EUR: g('EUR'), USD: g('USD'), GBP: g('GBP'), date: (/date="([0-9-]+)"/.exec(t) || [])[1] };
    });
  }
  // Fuel: official Monitorul Prețurilor (Consiliul Concurenței), stations within 5 km of home. Cached 3 h.
  function fuel() {
    try { var c = JSON.parse(localStorage.getItem('bf_fuel') || 'null'); if (c && Date.now() - c.at < 3 * 3600e3) return Promise.resolve(c); } catch (e) { /* */ }
    var U = 'https://monitorulpreturilor.info/pmonsvc/Gas/GetGasItemsByLatLon?lat=' + HOME.lat + '&lon=' + HOME.lon + '&buffer=5000&CSVNetworkIds=&OrderBy=dist&CSVGasCatalogProductIds=';
    var one = function (id) { return fetch(U + id).then(function (r) { return r.text(); }).then(function (t) {
      var re = /<GasProduct>[\s\S]*?<Network><Id>([^<]*)<\/Id>[\s\S]*?<Price>([0-9.]+)<\/Price>/g, m, a = [];
      while ((m = re.exec(t))) a.push({ n: m[1], p: parseFloat(m[2]) });
      if (!a.length) throw new Error('no fuel');
      a.sort(function (x, y) { return x.p - y.p; }); return a[0];
    }); };
    return Promise.all([one(11), one(21)]).then(function (r) {
      var o = { gas: r[0].p, diesel: r[1].p, gasAt: r[0].n, dieselAt: r[1].n, where: HOME.name, at: Date.now() };
      localStorage.setItem('bf_fuel', JSON.stringify(o)); return o;
    });
  }
  // Interim local alerts from the forecast until the server provides official ones (ANM/meteoalarm)
  function wxAlerts(w) {
    var a = [], d1 = w.days[1] || {};
    if (w.hours.some(function (h) { return h.fog; })) a.push({ lvl: 'y', t: 'Ceață', d: 'în următoarele ore' });
    if (d1.lo != null && d1.lo <= -1) a.push({ lvl: 'y', t: 'Îngheț', d: 'mâine dimineață ' + d1.lo + '°' });
    if (w.wind >= 45) a.push({ lvl: 'r', t: 'Vânt puternic', d: w.wind + ' km/h' });
    var snow = w.days.filter(function (d) { return d.ic === '🌨️' || d.ic === '❄️'; })[0];
    if (snow) a.push({ lvl: 'g', t: 'Ninsoare', d: snow.d === 'Azi' ? 'azi' : snow.d });
    return a;
  }
  return { air: air, aqiLabel: aqiLabel, uvLabel: uvLabel, pollenLabel: pollenLabel, moon: moon, nextHolidays: nextHolidays, nameDay: nameDay, bnr: bnr, fuel: fuel, wxAlerts: wxAlerts };
})();
