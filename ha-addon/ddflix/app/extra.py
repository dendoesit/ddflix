"""Trailers (yt-dlp, cached MP4), settings, storage, follows, stream-info and download control (pause / resume / delete)."""
import asyncio
import logging
import os
import shutil
import time

import aiohttp
from aiohttp import web

from . import catalog, config, db, filelist, library, rss
from .util import body, jerr, jok

log = logging.getLogger('extra')
TRAILER_DIR = os.path.join(config.DATA_DIR, 'trailers')
TRAILER_CAP = int(os.environ.get('TRAILER_CACHE_MB', '3000')) * 1024 * 1024
_jobs = {}        # imdb -> {'state': 'downloading'|'queued'|'failed', 'at': t}
_queue = asyncio.Queue()
_worker = {'task': None}
_front = {}


def _path(imdb):
    return os.path.join(TRAILER_DIR, imdb + '.mp4')


async def trailer_id(imdb):
    """YouTube id of the title's trailer (Cinemeta); stored on the title row."""
    t = db.q1('SELECT trailer_yt, type FROM title WHERE imdb=?', (imdb,))
    if not t:
        return None
    if t['trailer_yt'] is not None:
        return t['trailer_yt'] or None
    yt = ''
    try:
        async with aiohttp.ClientSession() as s:
            for typ in (t['type'] or 'movie', 'series' if t['type'] == 'movie' else 'movie'):
                m = (await library.http_json(s, '%s/meta/%s/%s.json' % (library.CINEMETA, typ, imdb))).get('meta') or {}
                for tr in (m.get('trailers') or []) + (m.get('trailerStreams') or []):
                    yt = tr.get('source') or tr.get('ytId') or ''
                    if yt:
                        break
                if yt or m:
                    break
    except Exception as e:
        log.info('trailer id %s: %s', imdb, e)
        return None
    db.x('UPDATE title SET trailer_yt=? WHERE imdb=?', (yt, imdb))
    return yt or None


def _prune():
    try:
        fs = [(os.path.getatime(os.path.join(TRAILER_DIR, f)), os.path.join(TRAILER_DIR, f)) for f in os.listdir(TRAILER_DIR) if f.endswith('.mp4')]
    except OSError:
        return
    total = sum(os.path.getsize(f) for _, f in fs)
    for _, f in sorted(fs):
        if total <= TRAILER_CAP:
            break
        total -= os.path.getsize(f)
        os.remove(f)


async def _fetch(imdb):
    yt = await trailer_id(imdb)
    if not yt:
        _jobs[imdb] = {'state': 'none', 'at': time.time()}
        return
    _jobs[imdb] = {'state': 'downloading', 'at': time.time()}
    os.makedirs(TRAILER_DIR, exist_ok=True)
    tmp = os.path.join(TRAILER_DIR, imdb + '.tmp')
    for f in os.listdir(TRAILER_DIR):
        if f.startswith(imdb + '.tmp'):
            os.remove(os.path.join(TRAILER_DIR, f))
    # up to 1080p H.264 + AAC merged into MP4: plays on Tizen AVPlay and in every browser
    fmt = 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080][vcodec^=avc1][ext=mp4]/b[ext=mp4]/b'
    proc = await asyncio.create_subprocess_exec(
        'yt-dlp', '--no-playlist', '--no-progress', '-q', '-f', fmt, '--merge-output-format', 'mp4',
        '-o', tmp + '.%(ext)s', 'https://www.youtube.com/watch?v=' + yt,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), 300)
    except asyncio.TimeoutError:
        proc.kill()
        err = b'timeout'
    out = [f for f in os.listdir(TRAILER_DIR) if f.startswith(imdb + '.tmp.') and f.endswith('.mp4')]
    if proc.returncode == 0 and out:
        os.replace(os.path.join(TRAILER_DIR, out[0]), _path(imdb))
        _jobs.pop(imdb, None)
        _prune()
    else:
        log.info('trailer %s failed: %s', imdb, (err or b'').decode('utf-8', 'replace')[-300:])
        _jobs[imdb] = {'state': 'failed', 'at': time.time()}


async def _run_worker():
    from . import play
    while True:
        imdb = await _queue.get()
        while play.busy() and _jobs.get(imdb, {}).get('state') == 'queued' and not _front.get(imdb):
            await asyncio.sleep(30)  # background trailers wait while someone watches; ones a user asked for go now
        _front.pop(imdb, None)
        try:
            await _fetch(imdb)
        except Exception as e:
            log.warning('trailer %s: %s', imdb, e)
            _jobs[imdb] = {'state': 'failed', 'at': time.time()}


def want(imdb, front=False):
    """Queue a trailer download (user requests jump ahead of background warming)."""
    if not imdb.startswith('tt') or os.path.exists(_path(imdb)):
        return
    j = _jobs.get(imdb)
    if j and (j['state'] in ('downloading', 'queued') or time.time() - j['at'] < 6 * 3600):
        return
    _jobs[imdb] = {'state': 'queued', 'at': time.time()}
    if _worker['task'] is None or _worker['task'].done():
        _worker['task'] = asyncio.ensure_future(_run_worker())
    if front:
        _front[imdb] = True
        items = []
        while not _queue.empty():
            items.append(_queue.get_nowait())
        _queue.put_nowait(imdb)
        for i in items:
            _queue.put_nowait(i)
    else:
        _queue.put_nowait(imdb)


def state(imdb):
    if os.path.exists(_path(imdb)):
        return 'ready'
    j = _jobs.get(imdb)
    return j['state'] if j and j['state'] in ('downloading', 'queued') else 'none'


async def trailer_prefetch(request):
    imdb = request.match_info['imdb']
    t = db.q1('SELECT * FROM title WHERE imdb=?', (imdb,))
    if not t or not catalog.allowed(request['profile'], t):
        return jerr(404, 'title not found')
    want(imdb, front=True)
    st = state(imdb)
    return jok({'ready': st == 'ready', 'state': st, 'etaS': 5 if st == 'downloading' else 12 if st == 'queued' else 0})


async def trailer_file(request):
    imdb = request.match_info['imdb']
    t = db.q1('SELECT * FROM title WHERE imdb=?', (imdb,))
    if not t or not catalog.allowed(request['profile'], t) or not os.path.exists(_path(imdb)):
        return jerr(404, 'no trailer')
    os.utime(_path(imdb))
    return web.FileResponse(_path(imdb), headers={'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600'})


async def trailer_warm():
    """Background job: trailers for the home hero / Top 10 so they start instantly."""
    ids = []
    for key in ('top:nfx:series', 'top:nfx:movie'):
        v = db.get_setting(key)
        if v:
            import json
            ids += json.loads(v).get('ids', [])[:5]
    for r in db.q("SELECT DISTINCT imdb FROM media_file WHERE missing=0 AND imdb LIKE 'tt%' ORDER BY added_at DESC LIMIT 10"):
        ids.append(r['imdb'])
    for i in ids:
        want(i)


# ---------------- settings / storage / follows / stream-info
DEFAULTS = {'quality': 'auto', 'lang': 'ro', 'downloads': True, 'dlQuality': '4k'}  # both TVs are 4K


def settings():
    import json
    s = dict(DEFAULTS)
    try:
        s.update(json.loads(db.get_setting('web_settings') or '{}'))
    except ValueError:
        pass
    if not db.get_setting('dl4k_v1'):  # downloads switched to 4K once (Dan, 2026-11-23); the setting can still be changed later
        s['dlQuality'] = '4k'
        db.set_setting('web_settings', json.dumps(s))
        db.set_setting('dl4k_v1', '1')
    return s


def kids(request):
    p = request['profile']
    return bool(p and p['kind'] == 'kids')


async def settings_get(request):
    if not request['web'] or kids(request):
        return jerr(403, 'not available on a kids profile' if kids(request) else 'web only')
    s = settings()
    s.update({'filelist': filelist.configured(), 'qbittorrent': bool(config.QBT_URL), 'mediaDir': config.MEDIA_DIR,
              'rss': bool(config.RSS_URL)})
    return jok(s)


async def settings_put(request):
    if not request['web'] or kids(request):
        return jerr(403, 'not available on a kids profile' if kids(request) else 'web only')
    import json
    b = await body(request)
    s = settings()
    if b.get('quality') in ('auto', 'original', '1080', '720', '480'):
        s['quality'] = b['quality']
    if b.get('lang') in ('ro', 'en'):
        s['lang'] = b['lang']
    if b.get('dlQuality') in ('1080', '4k'):
        s['dlQuality'] = b['dlQuality']
    if 'downloads' in b:
        s['downloads'] = bool(b['downloads'])
    db.set_setting('web_settings', json.dumps(s))
    return jok({'ok': True, 'settings': s})


async def storage(request):
    out = {}
    for name, path in (('media', config.MEDIA_DIR), ('data', config.DATA_DIR)):
        try:
            u = shutil.disk_usage(path)
            out[name] = {'total': u.total, 'used': u.used, 'free': u.free}
        except OSError:
            out[name] = None
    try:
        out['trailers'] = sum(os.path.getsize(os.path.join(TRAILER_DIR, f)) for f in os.listdir(TRAILER_DIR))
    except OSError:
        out['trailers'] = 0
    return jok(out)


async def follows(request):
    rows = db.q('SELECT f.id, f.pattern, t.imdb FROM follow f LEFT JOIN title t ON t.name=f.pattern ORDER BY f.id DESC')
    return jok({'items': [{'id': r['id'], 'name': r['pattern'], 'imdb': r['imdb']} for r in rows]})


async def remote(request):
    if not request['web'] or kids(request):
        return jerr(403, 'web only')
    import json
    try:
        with open(os.path.join(config.DATA_DIR, 'tailscale', 'status.json')) as f:
            st = json.load(f)
    except (OSError, ValueError):
        st = {'state': 'off'}
    from . import auth
    if auth.is_public(request):  # links that log a device into the tailnet stay inside the home network
        st = {'state': st.get('state'), 'url': st.get('url')}
    return jok(st)


async def stream_info(request):
    return jok({'streamBase': None})


# ---------------- download control (web only; devices -> 403 in the guard)
async def downloads_add(request):
    if kids(request):
        return jerr(403, 'not available on a kids profile')
    return await filelist.tv_download(request)


async def downloads_action(request):
    if kids(request):
        return jerr(403, 'not available on a kids profile')
    h, act = request.match_info['id'], request.match_info['action']
    path = {'pause': 'torrents/pause', 'resume': 'torrents/resume', 'recheck': 'torrents/recheck'}.get(act)
    if not path:
        return jerr(400, 'unknown action')
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
        q = rss.Qbt(s)
        await q.prepare()
        await q.call('POST', path, data={'hashes': h})
    filelist._torrents['at'] = 0
    return jok({'ok': True})


async def downloads_delete(request):
    if kids(request):
        return jerr(403, 'not available on a kids profile')
    h = request.match_info['id']
    files = request.query.get('files') == '1'
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
        q = rss.Qbt(s)
        await q.prepare()
        await q.call('POST', 'torrents/delete', data={'hashes': h, 'deleteFiles': 'true' if files else 'false'})
    db.x('DELETE FROM download WHERE hash=?', (h,))
    filelist._torrents['at'] = 0
    return jok({'ok': True})


def routes(app):
    r = app.router
    r.add_post('/api/title/{imdb}/trailer/prefetch', trailer_prefetch)
    r.add_get('/api/title/{imdb}/trailer.mp4', trailer_file)  # aiohttp answers HEAD for GET routes
    r.add_get('/api/settings', settings_get)
    r.add_put('/api/settings', settings_put)
    r.add_get('/api/storage', storage)
    r.add_get('/api/follows', follows)
    r.add_get('/api/stream-info', stream_info)
    r.add_get('/api/remote', remote)
    r.add_post('/api/downloads', downloads_add)
    r.add_post('/api/downloads/{id:[0-9a-f]{40}}/{action}', downloads_action)
    r.add_delete('/api/downloads/{id:[0-9a-f]{40}}', downloads_delete)
