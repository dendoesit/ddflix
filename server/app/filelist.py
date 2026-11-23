"""FileList API: find releases for any title (by IMDb id), download on demand into qBittorrent (NAS), live search of new titles.
API: https://filelist.io/api.php?username=..&passkey=..&action=search-torrents&type=imdb|name&query=..  (150 calls/hour)"""
import asyncio
import json
import logging
import re
import time

import aiohttp

from . import config, db, library, rss
from .util import body, jerr, jok

log = logging.getLogger('filelist')
API = 'https://filelist.io/api.php'
_cache = {}  # imdb -> fetched_at


def configured():
    return bool(config.FL_USER and config.FL_PASSKEY)


def parse_release(name):
    n = name.replace(' ', '.')
    res = '2160p' if re.search(r'2160p|\b4k\b|uhd', n, re.I) else '1080p' if '1080' in n else '720p' if '720' in n else ''
    hdr = 'dovi' if re.search(r'\.(DV|DoVi)\.|dolby.?vision', n, re.I) else 'hdr' if re.search(r'HDR', n) else ''
    codec = 'hevc' if re.search(r'x265|h\.?265|hevc', n, re.I) else 'h264' if re.search(r'x264|h\.?264|avc', n, re.I) else ''
    audio = next((a for a in ('Atmos', 'TrueHD', 'DTS-HD', 'DTS', 'DDP5.1', 'DD+', 'DD5.1', 'AAC') if a.lower() in n.lower()), '')
    source = next((s for s in ('REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'HDTV') if s.lower() in n.lower()), '')
    m = library.SE_RE.search('.' + n + '.')
    season = episode = None
    pack = 0
    if m:
        season, episode = int(m.group(1)), int(m.group(2))
    else:
        ms = library.SEASON_RE.search('.' + n + '.')
        if ms:
            season, pack = int(ms.group(1)), 1
        elif re.search(r'complete|integrala', n, re.I):
            pack = 1
    labels = [x for x in (res.replace('2160p', '4K'), 'Dolby Vision' if hdr == 'dovi' else 'HDR' if hdr else '', audio, source) if x]
    return {'res': res, 'hdr': hdr, 'codec': codec, 'audio': audio, 'source': source, 'season': season, 'episode': episode, 'pack': pack,
            'labels': labels}


async def api(params):
    q = {'username': config.FL_USER, 'passkey': config.FL_PASSKEY}
    q.update(params)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
        async with s.get(API, params=q, headers=rss.UA) as r:
            d = await r.json(content_type=None)
    if isinstance(d, dict) and d.get('error'):
        raise RuntimeError('FileList: ' + str(d['error']))
    return d if isinstance(d, list) else []


async def refresh(imdb, force=False):
    """Fetch releases for an IMDb id (cached 30 min)."""
    if not configured() or not imdb.startswith('tt'):
        return
    if not force and time.time() - _cache.get(imdb, 0) < 1800:
        return
    _cache[imdb] = time.time()
    try:
        items = await api({'action': 'search-torrents', 'type': 'imdb', 'query': imdb})
    except Exception as e:
        log.warning('search %s: %s', imdb, config.mask(e))
        return
    db.x('DELETE FROM release WHERE imdb=?', (imdb,))
    for it in items:
        p = parse_release(it.get('name') or '')
        db.x('INSERT OR REPLACE INTO release(id, imdb, name, size, seeders, leechers, category, freeleech, season, episode, pack, res, hdr, codec, '
             'audio, source, uploaded, fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
             (int(it['id']), imdb, it.get('name'), int(it.get('size') or 0), int(it.get('seeders') or 0), int(it.get('leechers') or 0),
              it.get('category'), int(it.get('freeleech') or 0), p['season'], p['episode'], p['pack'], p['res'], p['hdr'], p['codec'],
              p['audio'], p['source'], it.get('upload_date'), db.now()))


def release_out(r, dl=None):
    p = parse_release(r['name'])
    return {'id': r['id'], 'name': r['name'], 'labels': p['labels'], 'resolution': r['res'], 'hdr': r['hdr'] or None, 'audio': r['audio'],
            'source': r['source'], 'codec': r['codec'], 'size': r['size'], 'seeders': r['seeders'], 'season': r['season'],
            'episode': r['episode'], 'pack': bool(r['pack']), 'freeleech': bool(r['freeleech']), 'category': r['category'],
            'download': dl}


def releases(imdb):
    return db.q('SELECT * FROM release WHERE imdb=? ORDER BY seeders DESC', (imdb,))


def pick(imdb, season=None, episode=None, prefer_4k=False):
    rs = [r for r in releases(imdb) if r['seeders'] > 0]
    if season is not None:
        if episode is not None:
            rs = [r for r in rs if r['season'] == season and r['episode'] == episode]
        else:
            rs = [r for r in rs if r['season'] == season and r['pack']]
    order = ['2160p', '1080p'] if prefer_4k else ['1080p', '2160p']
    for res in order:
        c = [r for r in rs if r['res'] == res and r['seeders'] >= 5]
        if c:
            return max(c, key=lambda r: r['seeders'])
    return max(rs, key=lambda r: r['seeders']) if rs else None


# ---------------- downloads (qBittorrent)
_torrents = {'at': 0, 'items': []}


async def torrents():
    if time.time() - _torrents['at'] > 5:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
                _torrents['items'] = await rss.Qbt(s).list()
        except Exception as e:
            log.info('qbt list: %s', config.mask(e))
            _torrents['items'] = []
        _torrents['at'] = time.time()
    return _torrents['items']


def dl_out(t, row):
    state = t.get('state', '')
    st = 'done' if t.get('progress', 0) >= 1 else 'error' if 'error' in state or state == 'missingFiles' else \
        'paused' if 'paused' in state or 'stopped' in state else 'downloading' if 'DL' in state or state in ('downloading', 'metaDL') else 'queued'
    sel = ep_selection(t.get('hash')) if row else None
    return {'id': t.get('hash'), 'state': st, 'progress': round(t.get('progress', 0), 3), 'name': t.get('name'), 'size': t.get('size'),
            'eta': t.get('eta'), 'speed': t.get('dlspeed'), 'imdb': row['imdb'] if row else None, 'season': row['season'] if row else None,
            'episode': row['episode'] if row else None, 'episodes': sel or None, 'releaseId': row['release_id'] if row else None}


async def downloads_for(imdb=None):
    rows = {r['hash']: r for r in db.q('SELECT * FROM download')}
    out = []
    for t in await torrents():
        row = rows.get(t.get('hash'))
        if imdb and (not row or row['imdb'] != imdb):
            continue
        out.append(dl_out(t, row))
    return out


def ep_selection(h):
    v = db.get_setting('dlsel:' + h)
    return json.loads(v) if v else None


def episode_files(files, season, episode):
    """Indexes of the video files of SxxEyy in a torrent's file list (qBittorrent 'files' entries or plain names)."""
    out = []
    for i, f in enumerate(files):
        name = f['name'] if isinstance(f, dict) else f
        base = name.replace('\\', '/').rsplit('/', 1)[-1]
        if not base.lower().endswith(library.VIDEO_EXT) or 'sample' in base.lower():
            continue
        m = library.SE_RE.search('.' + base + '.') or library.X_RE.search('.' + base + '.')
        if m and int(m.group(1)) == season and int(m.group(2)) == episode:
            out.append(i)
    return out


async def select_episode(q, h, season, episode, fresh):
    """Only download SxxEyy from a season pack (fresh = just added paused: everything else gets priority 0)."""
    files = []
    for _ in range(30):
        try:
            files = await q.files(h)
        except Exception:
            files = []
        if files:
            break
        await asyncio.sleep(0.5)
    want = episode_files(files, season, episode)
    if not want:
        raise RuntimeError('Episodul S%02dE%02d nu e în pachetul de sezon' % (season, episode))
    if fresh:
        await q.prio(h, [i for i in range(len(files)) if i not in want], 0)
    await q.prio(h, want, 1)
    await q.resume(h)
    sel = ep_selection(h) or []
    if episode not in sel:
        sel.append(episode)
    db.set_setting('dlsel:' + h, json.dumps(sorted(sel)))


async def start_download(rel, device_id=None, episode=None):
    title = rel['name']
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
        async with s.get('https://filelist.io/download.php', params={'id': rel['id'], 'passkey': config.FL_PASSKEY}, headers=rss.UA) as r:
            r.raise_for_status()
            data = await r.read()
        if not data.startswith(b'd'):
            raise RuntimeError('FileList nu a întors un .torrent')
        h = torrent_hash(data)
        q = rss.Qbt(s)
        await q.prepare()
        one = episode is not None and rel['episode'] is None
    if season is not None and episode is None and rel['episode'] is not None:
        # "download season N" while the season is still airing: FileList has no pack yet, only episodes -> get them all
        return await season_from_episodes(request, imdb, int(season), k4, dev, b.get('dryRun')) and rel['season'] is not None
        existing = {t.get('hash') for t in await q.list()}
        if h in existing:
            if one:
                await select_episode(q, h, rel['season'], int(episode), fresh=False)
            else:
                await q.prio(h, list(range(len(await q.files(h)))), 1)
                db.set_setting('dlsel:' + h, '')
                await q.resume(h)
        else:
            await q.add(data, title, rss.save_dir(title), paused=one)
            if one:
                await select_episode(q, h, rel['season'], int(episode), fresh=True)
    if not db.q1('SELECT 1 FROM download WHERE hash=?', (h,)):
        db.x('INSERT INTO download(hash, release_id, imdb, season, episode, name, device_id, added_at) VALUES(?,?,?,?,?,?,?,?)',
             (h, rel['id'], rel['imdb'], rel['season'], rel['episode'], title, device_id, db.now()))
    _torrents['at'] = 0
    return h


def torrent_hash(data):
    """sha1 of the bencoded info dict = qBittorrent hash (v1)."""
    import hashlib
    i = data.find(b'4:infod')
    if i < 0:
        return ''
    start = i + 6
    # walk the bencode to find the end of the info dict
    def walk(p):
        c = data[p:p + 1]
        if c == b'i':
            return data.index(b'e', p) + 1
        if c in (b'l', b'd'):
            p += 1
            while data[p:p + 1] != b'e':
                p = walk(p)
            return p + 1
        n = data.index(b':', p)
        return n + 1 + int(data[p:n])
    end = walk(start)
    return hashlib.sha1(data[start:end]).hexdigest()


# ---------------- endpoints
async def tv_download(request):
    if not configured():
        return jerr(503, 'FileList nu e configurat (FILELIST_USER în .env)')
    p = request['profile']
    if p and p['kind'] == 'kids':
        return jerr(403, 'not available on a kids profile')
    b = await body(request)
    imdb = str(b.get('imdb') or '')
    dev = request['device']
    if dev and rss_limited(dev['id']):
        return jerr(429, 'Prea multe descărcări în ultima oră')
    await refresh(imdb)
    t = db.q1('SELECT type FROM title WHERE imdb=?', (imdb,))
    season = b.get('season')
    if season is not None and t and t['type'] == 'movie':
        return jerr(400, 'season only for series')
    from . import extra
    k4 = extra.settings().get('dlQuality') == '4k'
    episode = b.get('episode')
    episode = int(episode) if episode is not None and str(episode).isdigit() else None
    if b.get('release_id'):
        rel = db.q1('SELECT * FROM release WHERE id=? AND imdb=?', (int(b['release_id']), imdb))
    elif season is not None and episode is not None:
        rel = pick(imdb, int(season), episode, k4) or pick(imdb, int(season), None, k4)  # FileList usually only keeps the season pack
    else:
        rel = pick(imdb, int(season) if season is not None else None, None, k4)
    if not rel:
        return jerr(404, 'Nu am găsit nimic cu seederi pe FileList')
    one = episode is not None and rel['episode'] is None
    for d in await downloads_for(imdb):
        if d['releaseId'] == rel['id'] and d['state'] != 'error':
            if one and d.get('episodes') is not None and episode not in d['episodes']:
                break  # same pack, another episode: add it to the selection below
            return jok({'ok': True, 'download': d, 'release': release_out(rel, d)})
    if b.get('dryRun'):
        return jok({'ok': True, 'dryRun': True, 'download': None, 'release': release_out(rel)})
    try:
        h = await start_download(rel, dev['id'] if dev else None, episode if one else None)
    except Exception as e:
        return jerr(502, config.mask(e)[:200])
    d = {'id': h, 'state': 'queued', 'progress': 0, 'name': rel['name'], 'imdb': imdb, 'season': rel['season'], 'releaseId': rel['id']}
    return jok({'ok': True, 'download': d, 'release': release_out(rel, d)})


async def season_from_episodes(request, imdb, season, k4, dev, dry):
    eps = sorted({r['episode'] for r in releases(imdb) if r['season'] == season and r['episode'] is not None and r['seeders'] > 0})
    have = {(f['season'], f['episode']) for f in db.q('SELECT season, episode FROM media_file WHERE imdb=? AND missing=0', (imdb,))}
    active = {(d['season'], d.get('episode')) for d in await downloads_for(imdb) if d['state'] != 'error'}
    todo = [e for e in eps if (season, e) not in have and (season, e) not in active]
    picks = [r for r in (pick(imdb, season, e, k4) for e in todo) if r]
    if not picks:
        if eps:
            d = next((d for d in await downloads_for(imdb) if d['season'] == season), None)
            return jok({'ok': True, 'download': d, 'release': release_out(pick(imdb, season, eps[0], k4)), 'episodes': []})
        return jerr(404, 'Nu am găsit nimic cu seederi pe FileList')
    if dry:
        return jok({'ok': True, 'dryRun': True, 'download': None, 'release': release_out(picks[0]), 'episodes': [r['episode'] for r in picks]})
    first = None
    for r in picks:
        try:
            h = await start_download(r, dev['id'] if dev else None)
        except Exception as e:
            log.warning('season %s S%d E%s: %s', imdb, season, r['episode'], config.mask(e)[:150])
            continue
        if first is None:
            first = {'id': h, 'state': 'queued', 'progress': 0, 'name': r['name'], 'imdb': imdb, 'season': season, 'episode': r['episode'],
                     'releaseId': r['id']}
    if first is None:
        return jerr(502, 'qBittorrent nu a acceptat descărcările')
    return jok({'ok': True, 'download': first, 'release': release_out(picks[0]), 'episodes': [r['episode'] for r in picks]})


_dl_rate = {}


def rss_limited(dev_id):
    t = time.time()
    l = [x for x in _dl_rate.get(dev_id, []) if t - x < 3600]
    if len(l) >= 5:
        _dl_rate[dev_id] = l
        return True
    l.append(t)
    _dl_rate[dev_id] = l
    return False


async def downloads(request):
    return jok({'items': await downloads_for(), 'configured': configured()})


async def title_releases(request):
    imdb = request.match_info['imdb']
    await refresh(imdb, force=request.query.get('refresh') == '1')
    dls = {d['releaseId']: d for d in await downloads_for(imdb)}
    return jok({'items': [release_out(r, dls.get(r['id'])) for r in releases(imdb)], 'configured': configured()})


async def live_titles(session, q):
    """Cinemeta search -> titles (created in the DB on the fly) that are not in the library yet."""
    out = []
    for typ in ('series', 'movie'):
        try:
            d = await library.http_json(session, '%s/catalog/%s/top/search=%s.json' % (library.CINEMETA, typ, aiohttp.helpers.quote(q, safe='')))
        except Exception:
            continue
        for m in (d.get('metas') or [])[:10]:
            if str(m.get('id', '')).startswith('tt'):
                out.append((m['id'], typ, m.get('name'), m.get('releaseInfo')))
    for imdb, typ, name, yr in out[:16]:
        ym = re.match(r'(\d{4})', str(yr or ''))
        await library.ensure_title(session, imdb, name, int(ym.group(1)) if ym else None, typ)
    return [x[0] for x in out[:16]]


def routes(app):
    r = app.router
    r.add_post('/api/tv/download', tv_download)
    r.add_get('/api/downloads', downloads)
    r.add_get('/api/title/{imdb}/releases', title_releases)
