"""End-to-end checks against a RUNNING DDflix server (the real one at home by default). Stdlib only.

    python tests/live_check.py                      # LAN server http://192.168.1.156:8090
    DDFLIX_URL=http://host:8090 python tests/live_check.py
    python tests/live_check.py --quick              # skip the slow playback / public-route checks

It reads the library and the catalogue, starts short playback sessions (direct / HLS remux / web remux) and stops them,
searches online, checks every picture it meets, the kids rules (through a temporary paired test device that is deleted at
the end) and that the published web site matches web/. Nothing is downloaded (download checks use dryRun).
Run it from the home network: LAN requests count as the admin web app. Exit code 1 when something fails."""
import concurrent.futures as cf
import hashlib
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get('DDFLIX_URL', 'http://192.168.1.156:8090').rstrip('/')
WEB_PUBLIC = os.environ.get('DDFLIX_WEB', 'https://ddflix.vercel.app').rstrip('/')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUICK = '--quick' in sys.argv
ADULT = {'X-Profile': '1'}
KIDS_BAD = {'Horror', 'Crime', 'Thriller', 'War'}
TV_CAPS = {'hevc': True, 'hdr': True, 'ac3': True, 'eac3': True, 'mkv': True}

RESULTS = []   # (ok, area, name, detail)
try:  # an old Python/OpenSSL on Windows rejects current Let's Encrypt chains; certifi's bundle is up to date
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = ssl.create_default_context()


def rec(ok, area, name, detail=''):
    RESULTS.append((bool(ok), area, name, detail))
    print('%s  %-10s %s%s' % ('PASS' if ok else 'FAIL', area, name, ('  -- ' + str(detail)[:300]) if detail and not ok else ''), flush=True)
    return ok


def req(path, method='GET', body=None, headers=None, timeout=30, raw=False, base=None):
    url = path if path.startswith('http') else (base or BASE) + path
    h = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=CTX) as resp:
            b = resp.read()
            st, hd = resp.status, dict(resp.headers)
    except urllib.error.HTTPError as e:
        b, st, hd = e.read(), e.code, dict(e.headers or {})
    except Exception as e:
        return {'status': 0, 'error': str(e)[:200], 'ms': int((time.time() - t0) * 1000), 'body': b'', 'json': None, 'headers': {}}
    out = {'status': st, 'ms': int((time.time() - t0) * 1000), 'body': b, 'headers': hd, 'json': None}
    if not raw:
        try:
            out['json'] = json.loads(b)
        except ValueError:
            pass
    return out


def img_ok(url, headers=None):
    r = req(url, headers=headers or ADULT, timeout=30, raw=True)
    ct = (r['headers'].get('Content-Type') or '')
    return r['status'] == 200 and ct.startswith('image/') and len(r['body']) > 500, '%s %s %dB' % (r['status'], ct, len(r['body']))


def check_images(area, label, urls, headers=None):
    """All pictures in parallel; one result line with the broken ones listed."""
    urls = list(dict.fromkeys(urls))
    bad = []
    with cf.ThreadPoolExecutor(8) as ex:
        for u, (ok, d) in zip(urls, ex.map(lambda u: img_ok(u, headers), urls)):
            if not ok:
                bad.append('%s (%s)' % (u.replace(BASE, ''), d))
    rec(not bad, area, '%s: %d pictures' % (label, len(urls)), '; '.join(bad[:6]) + (' …+%d' % (len(bad) - 6) if len(bad) > 6 else ''))
    return bad


# ---------------------------------------------------------------- basics
def basics():
    r = req('/api/health')
    rec(r['status'] == 200 and (r['json'] or {}).get('ok'), 'server', 'health', r)
    r = req('/api/where')
    rec(r['status'] == 200 and 'home' in (r['json'] or {}), 'server', 'where', r.get('json'))
    r = req('/api/profiles', headers=ADULT)
    profs = (r['json'] or {}).get('items') or []
    rec(any(p['kind'] == 'adult' for p in profs), 'server', 'profiles (%d)' % len(profs), r.get('json'))
    d = req('/api/admin/diag', headers=ADULT, timeout=60)
    dj = d['json'] or {}
    rec(d['status'] == 200 and 'host' in dj, 'server', 'diagnostics endpoint', d.get('error') or d['status'])
    jobs = dj.get('jobs') or {}
    failing = {k: v.get('err') for k, v in jobs.items() if not v.get('ok')}
    rec(not failing, 'server', 'background jobs (%d ran)' % len(jobs), failing)
    recent = [p for p in dj.get('problems') or [] if p['level'] == 'ERROR' and time.time() - p['at'] < 3600]
    rec(not recent, 'server', 'no server errors in the last hour', [p['msg'][:120] for p in recent[:5]])
    disk = ((dj.get('host') or {}).get('disks') or {}).get('media')
    rec(disk and disk['free'] > 30 * 1024 ** 3, 'server', 'NAS reachable with >30 GB free', disk)
    tr = (dj.get('downloads') or {})
    rec(not tr.get('error') and (tr.get('transfer') or {}).get('connection_status') in ('connected', 'firewalled'),
        'downloads', 'qBittorrent connected', tr.get('error') or tr.get('transfer'))
    stuck = [t['name'][:50] for t in tr.get('torrents') or [] if t['state'] in ('error', 'missingFiles')]
    rec(not stuck, 'downloads', 'no torrents in error', stuck)
    rs = tr.get('rss') or {}
    rec(not rs.get('lastError'), 'downloads', 'FileList RSS without error', rs.get('lastError'))
    fun = ((dj.get('remote') or {}).get('funnel') or {})
    rec(fun.get('state') == 'running', 'remote', 'Tailscale Funnel running', fun.get('state'))
    return profs, dj


# ---------------------------------------------------------------- home + titles
def home_and_titles():
    r = req('/api/home', headers=ADULT, timeout=60)
    hj = r['json'] or {}
    rows = hj.get('rows') or []
    rec(r['status'] == 200 and len(rows) >= 5, 'home', 'home rows (%d)' % len(rows), r.get('error') or r['status'])
    empty = [x.get('title') for x in rows if not x.get('items')]
    rec(not empty, 'home', 'no empty rows', empty)
    hero = hj.get('hero') or []
    rec(len(hero) >= 1, 'home', 'hero items (%d)' % len(hero))
    urls = []
    for h in hero:
        urls += [BASE + '/img/backdrop/' + h['imdb'] + '?w=1280', BASE + '/img/background/' + h['imdb'] + '?w=1280']
        if h.get('logo'):
            urls.append(BASE + '/img/logo/' + h['imdb'] + '?w=500')
    for row in rows:
        for it in (row.get('items') or [])[:4]:
            if it.get('poster') is not False:
                urls.append(BASE + '/img/poster/' + it['imdb'] + '?w=400')
    check_images('home', 'hero backdrops/logos + first posters of every row', urls)
    # title pages: some from the rows (mostly not downloaded) + the library
    lib = (req('/api/admin/titles', headers=ADULT).get('json') or {}).get('items') or []
    sample = [row['items'][0]['imdb'] for row in rows[:8] if row.get('items')] + [t['imdb'] for t in lib[:6]]
    sample = list(dict.fromkeys(sample))
    urls, bad = [], []
    for imdb in sample:
        t = req('/api/title/' + imdb, headers=ADULT, timeout=60)
        tj = t['json'] or {}
        if t['status'] != 200 or not tj.get('name'):
            bad.append('%s %s' % (imdb, t['status']))
            continue
        if tj.get('backdrop') is not False:
            urls.append(BASE + '/img/background/' + imdb + '?w=1280')   # what the TV asks for
        if tj.get('type') == 'series' and tj.get('inLibrary'):
            for s in (tj.get('seasons') or [])[:1]:
                for e in (s.get('episodes') or [])[:3]:
                    urls.append(BASE + '/img/episode/%s/%s/%s?w=400' % (imdb, s.get('season'), e.get('episode')))
        for sim in (tj.get('similar') or [])[:4]:
            urls.append(BASE + '/img/poster/' + sim['imdb'] + '?w=400')
        rr = req('/api/title/%s/releases' % imdb, headers=ADULT, timeout=60)
        if rr['status'] != 200:
            bad.append('%s releases %s' % (imdb, rr['status']))
    rec(not bad, 'titles', 'title pages + releases (%d titles)' % len(sample), bad)
    check_images('titles', 'title backgrounds, episode stills, similar posters', urls)
    return rows, lib


# ---------------------------------------------------------------- search
def search(kids_id):
    for q, want_series in (('frozen', True), ('peanuts', True), ('elsa', False), ('dexter', True), ('bluey', True)):
        loc = req('/api/search?q=' + urllib.parse.quote(q), headers=ADULT)
        live = req('/api/search/live?q=' + urllib.parse.quote(q), headers=ADULT, timeout=90)
        lj = live['json'] or {}
        ts = lj.get('titles') or []
        rec(loc['status'] == 200 and live['status'] == 200 and ts, 'search', '"%s": %d results in %.1fs' % (q, len(ts), live['ms'] / 1000),
            live.get('error') or live['status'])
        loc_ids = [t['imdb'] for t in (loc['json'] or {}).get('titles') or []]
        rec([t['imdb'] for t in ts[:len(loc_ids)]] == loc_ids, 'search', '"%s": the %d library results come first' % (q, len(loc_ids)),
            [t['name'] for t in ts[:len(loc_ids) + 2]])
        if want_series:
            rec(any(t['type'] == 'series' for t in ts), 'search', '"%s": series included' % q, [t['name'] for t in ts[:6]])
        check_images('search', '"%s" posters' % q, [BASE + '/img/poster/' + t['imdb'] + '?w=400' for t in ts if t.get('poster') is not False])
    if kids_id:
        kh = {'X-Profile': str(kids_id)}
        for q in ('frozen', 'peanuts'):
            live = req('/api/search/live?q=' + q, headers=kh, timeout=90)
            ts = (live['json'] or {}).get('titles') or []
            bad = [t['name'] for t in ts if set(t.get('genres') or []) & KIDS_BAD]
            rec(live['status'] == 200 and ts and not bad, 'kids', 'search "%s" online on the kids profile (%d)' % (q, len(ts)), bad or live['status'])


# ---------------------------------------------------------------- playback
def pick_media(lib):
    """A movie, an episode, a 4K/HEVC file and a still-downloading file (when there is one)."""
    out = {}
    for t in lib:
        p = req('/api/playable/' + t['imdb'], headers=ADULT)
        for f in (p['json'] or {}).get('files') or []:
            m = req('/api/media/%d' % f['id'], headers=ADULT)
            mj = m['json'] or {}
            if not mj:
                continue
            kind = 'downloading' if mj.get('downloading') else ('episode' if mj.get('season') is not None else 'movie')
            out.setdefault(kind, mj)
            if mj.get('vcodec') == 'hevc' or (mj.get('resolution') or '').startswith('21'):
                out.setdefault('hevc/4K', mj)
        if len(out) >= 4:
            break
    return out


def read_m3u8(url, headers, wait=40):
    t0 = time.time()
    while time.time() - t0 < wait:
        r = req(url, headers=headers, timeout=wait, raw=True)
        if r['status'] == 200 and b'#EXTINF' in r['body']:
            return r['body'].decode(errors='ignore')
        time.sleep(1)
    return None


def playback(lib):
    media = pick_media(lib)
    rec(media, 'play', 'found files to test: ' + ', '.join(media), 'library empty?')
    for kind, m in media.items():
        mid, name = m['id'], '%s %s' % (kind, m.get('title'))
        # media info + subtitles
        subs = m.get('subs') or []
        bad = []
        for s in subs[:4]:
            r = req('/api/media/%d/sub/%s.vtt' % (mid, urllib.parse.quote(s['key'])), headers=ADULT, timeout=90, raw=True)
            if r['status'] != 200 or not r['body'].lstrip(b'\xef\xbb\xbf').startswith(b'WEBVTT'):
                bad.append('%s %s' % (s['key'], r['status']))
        rec(not bad, 'play', '%s: %d subtitle tracks load' % (name, min(4, len(subs))), bad)
        tp = m.get('trickplay')
        if tp:
            ok, d = img_ok(BASE + tp['url'] + '1.jpg')
            rec(ok, 'play', '%s: seek thumbnails' % name, d)
        elif not m.get('downloading') and kind != 'downloading':
            rec(True, 'play', '%s: seek thumbnails not made yet (job pending)' % name)
        # direct file
        r = req('/api/media/%d/file' % mid, headers=dict(ADULT, Range='bytes=0-1048575'), timeout=60, raw=True)
        rec(r['status'] in (200, 206) and len(r['body']) > 1000, 'play', '%s: direct file read (%d KB in %d ms)' % (name, len(r['body']) // 1024, r['ms']),
            r.get('error') or r['status'])
        if QUICK:
            continue
        start = 60 if (m.get('availableSec') or 999) > 120 else 0
        # TV: HLS remux (forceHls) from the middle of the file
        p = req('/api/play', 'POST', {'mediaId': mid, 'start': start, 'caps': TV_CAPS, 'audio': m.get('defaultAudio') or 0, 'forceHls': True,
                                      'tv': True, 'quality': 'auto'}, ADULT, timeout=60)
        pj = p['json'] or {}
        ok = p['status'] == 200 and pj.get('url')
        detail = p.get('error') or pj
        if ok and pj.get('mode') != 'direct':
            master = req(pj['url'], headers=ADULT, raw=True)
            idx = read_m3u8(pj['url'].replace('master.m3u8', 'index.m3u8'), ADULT)
            seg = None
            if idx:
                first = next((l for l in idx.splitlines() if l and not l.startswith('#')), None)
                n = int(re.search(r'(\d+)', first).group(1)) if first else 0
                # the segment that contains `start`
                durs = [float(x) for x in re.findall(r'#EXTINF:([0-9.]+)', idx)]
                acc, k = 0.0, 0
                while k < len(durs) and acc + durs[k] <= start:
                    acc += durs[k]
                    k += 1
                seg = req(pj['url'].replace('master.m3u8', 'seg%05d.ts' % (n + k)), headers=ADULT, timeout=90, raw=True)
            ok = master['status'] == 200 and idx and seg and seg['status'] == 200 and len(seg['body']) > 10000
            detail = 'master %s, index %s, segment %s' % (master['status'], bool(idx), seg and (seg['status'], len(seg['body']), seg['ms']))
            req('/api/play/%s/stop' % pj['sid'], 'POST', {}, ADULT)
        rec(ok, 'play', '%s: TV start at %ds (%s)' % (name, start, pj.get('mode')), detail)
        # web (browser / phone): ffmpeg fMP4 remux
        p = req('/api/play', 'POST', {'mediaId': mid, 'start': start, 'audio': 0, 'web': True}, ADULT, timeout=60)
        pj = p['json'] or {}
        if p['status'] == 415:
            rec(True, 'play', '%s: web says the codec cannot play in a browser (415)' % name)
            continue
        ok, detail = p['status'] == 200 and pj.get('url'), p.get('error') or pj
        if ok and pj.get('mode') == 'remux':
            t0 = time.time()
            idx = read_m3u8(pj['url'], ADULT, 60)
            init = req(pj['url'].replace('index.m3u8', 'init.mp4'), headers=ADULT, raw=True) if idx else None
            s0 = req(pj['url'].replace('index.m3u8', 's00000.m4s'), headers=ADULT, timeout=60, raw=True) if idx else None
            ok = idx and init and init['status'] == 200 and s0 and s0['status'] == 200 and len(s0['body']) > 10000
            detail = 'playlist %s after %.1fs, init %s, first segment %s' % (bool(idx), time.time() - t0, init and init['status'], s0 and (s0['status'], len(s0['body'])))
        elif ok and pj.get('mode') == 'direct':
            r = req(pj['url'], headers=dict(ADULT, Range='bytes=0-65535'), raw=True)
            ok, detail = r['status'] in (200, 206), r['status']
        rec(ok, 'play', '%s: web start (%s)' % (name, pj.get('mode')), detail)
    return media


# ---------------------------------------------------------------- devices (TV path) + kids rules
def device_checks(profs):
    kids = next((p for p in profs if p['kind'] == 'kids'), None)
    adult = next((p for p in profs if p['kind'] == 'adult'), None)
    s = req('/api/device/pair/start', 'POST', {'name': 'live_check'})
    sj = s['json'] or {}
    a = req('/api/device/pair/approve', 'POST', {'code': sj.get('userCode'), 'name': 'live_check (test, se sterge singur)', 'profileId': adult['id']}, ADULT)
    did = (a['json'] or {}).get('deviceId')
    tok = (req('/api/device/pair/poll', 'POST', {'deviceCode': sj.get('deviceCode')})['json'] or {}).get('token')
    if not rec(tok, 'tv', 'pair a test device', a.get('json')):
        return
    try:
        T = {'Authorization': 'Bearer ' + tok}
        r = req('/api/home', headers=dict(T, **{'X-Profile': str(adult['id'])}), timeout=60)
        rec(r['status'] == 200 and (r['json'] or {}).get('rows'), 'tv', 'home through a TV device token', r['status'])
        r = req('/api/admin/diag', headers=T)
        rec(r['status'] == 403, 'tv', 'TV devices cannot open the admin diagnostics', r['status'])
        if not kids:
            rec(True, 'kids', 'no kids profile: kids checks skipped')
            return
        sel = req('/api/profiles/%d/select' % kids['id'], 'POST', {}, T)
        tk = (sel['json'] or {}).get('ticket')
        rec(sel['status'] == 200, 'kids', 'TV switches to the kids profile', sel.get('json'))
        K = dict(T, **{'X-Profile': '%d.%s' % (kids['id'], tk) if tk else str(kids['id'])})
        r = req('/api/profiles/%d/select' % adult['id'], 'POST', {}, K)
        rec(r['status'] == 200 or (adult.get('hasPin') and r['status'] == 403), 'kids', 'TV goes back from kids to the adult profile (no PIN needed)', r.get('json'))
        h = req('/api/home', headers=K, timeout=60)
        bad = [it['name'] for row in (h['json'] or {}).get('rows') or [] for it in row.get('items') or [] if set(it.get('genres') or []) & KIDS_BAD]
        rec(h['status'] == 200 and not bad, 'kids', 'kids home has no horror/crime/thriller/war', bad[:8])
        r = req('/api/tv/download', 'POST', {'imdb': 'tt2294629', 'dryRun': True}, K, timeout=90)  # Frozen
        rec(r['status'] in (200, 404), 'kids', 'kids may download a kids title (dry run)', r.get('json'))
        r = req('/api/tv/download', 'POST', {'imdb': 'tt0903747', 'dryRun': True}, K, timeout=90)  # Breaking Bad
        rec(r['status'] == 403, 'kids', 'kids may NOT download an adult title (dry run)', r.get('json'))
        r = req('/api/downloads/' + '0' * 40, 'DELETE', None, K)
        rec(r['status'] == 403, 'kids', 'kids cannot delete downloads', r['status'])
        r = req('/api/admin/diag', headers=K)
        rec(r['status'] == 403, 'kids', 'kids cannot open diagnostics', r['status'])
    finally:
        if did:
            d = req('/api/devices/%d' % did, 'DELETE', None, ADULT)
            rec(d['status'] == 200, 'tv', 'test device deleted', d['status'])


# ---------------------------------------------------------------- web app + public route
def web_checks():
    r = req('/web/', raw=True)
    rec(r['status'] == 200 and b'<script' in r['body'], 'web', 'home server serves the web app', r['status'])
    local = open(os.path.join(ROOT, 'web', 'app.js'), 'rb').read()
    served = req('/web/app.js', raw=True)['body']
    rec(hashlib.sha1(local).hexdigest() == hashlib.sha1(served).hexdigest(), 'web', 'home server web app == web/app.js (deployed)')
    pub = req(WEB_PUBLIC + '/app.js', raw=True, timeout=30)
    rec(pub['status'] == 200 and hashlib.sha1(pub['body']).hexdigest() == hashlib.sha1(local).hexdigest(), 'web',
        'public site (Vercel) app.js == web/app.js', 'not deployed yet' if pub['status'] == 200 else pub.get('error') or pub['status'])
    css = req(WEB_PUBLIC + '/app.css', raw=True, timeout=30)['body']
    rec(hashlib.sha1(css).hexdigest() == hashlib.sha1(open(os.path.join(ROOT, 'web', 'app.css'), 'rb').read()).hexdigest(), 'web',
        'public site (Vercel) app.css == web/app.css')
    cfg = req(WEB_PUBLIC + '/config.js', raw=True)
    m = re.search(rb"DDFLIX_API = '([^']+)'", cfg['body'] or b'')
    if not rec(m, 'remote', 'public site knows the server address'):
        return
    api = m.group(1).decode()
    ms = []
    for _ in range(3):
        h = req(api + '/api/health', timeout=60, base='')
        ms.append(h['ms'] if h['status'] == 200 else 99999)
    rec(min(ms) < 2000, 'remote', 'public route (Funnel) answers: %s ms' % ms)
    if not QUICK:
        r = req(api + '/web/app.js', raw=True, timeout=60)
        kbs = len(r['body']) / 1024 / max(0.001, r['ms'] / 1000)
        rec(r['status'] == 200, 'remote', 'public route download %.0f KB/s' % kbs, r['status'])


def main():
    print('DDflix live checks against %s%s\n' % (BASE, ' (quick)' if QUICK else ''))
    profs, _ = basics()
    rows, lib = home_and_titles()
    kids = next((p['id'] for p in profs if p['kind'] == 'kids'), None)
    search(kids)
    playback(lib)
    device_checks(profs)
    web_checks()
    bad = [r for r in RESULTS if not r[0]]
    print('\n%d checks, %d failed' % (len(RESULTS), len(bad)))
    for ok, area, name, detail in bad:
        print('  FAIL %-10s %s -- %s' % (area, name, str(detail)[:400]))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
