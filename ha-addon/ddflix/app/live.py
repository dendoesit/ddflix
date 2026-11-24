"""Watch while it downloads (like Stremio): a torrent that DDflix downloads is fetched in order (first + last pieces first),
and as soon as the start of an episode is on disk it shows up in the library as playable. Its bytes are served straight from
the growing file; a request for a part that is not downloaded yet waits for it. When the torrent completes, qBittorrent
renames the file (drops '.!qB') and the library scan turns the row into a normal one (same id: watch progress is kept)."""
import asyncio
import json
import logging
import os
import time

import aiohttp
from aiohttp import web

from . import config, db, library, rss

log = logging.getLogger('live')
CHUNK = 2 * 1024 * 1024
HEAD_BYTES = 24 * 1024 * 1024   # the start that must be there before an episode is offered
TAIL_BYTES = 4 * 1024 * 1024    # MKV cues / MP4 moov at the end (first+last piece priority fetches it early)
WAIT_MAX = 120                  # a request waits this long for missing pieces, then ends (the player retries)
_cache = {}                     # hash -> (time, info)
_schema = {'ok': False}
_tuned = set()


def schema():
    if _schema['ok']:
        return
    with db._lock:
        c = db.conn()
        cols = {r[1] for r in c.execute('PRAGMA table_info(media_file)')}
        if 'live' not in cols:
            c.execute('ALTER TABLE media_file ADD COLUMN live TEXT')
    _schema['ok'] = True


async def _q(fn):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
        return await fn(rss.Qbt(s))


async def info(h, fresh=1.0):
    """Torrent state, piece size, files (with their byte offset in the torrent) and piece states; cached ~1 s."""
    hit = _cache.get(h)
    if hit and time.time() - hit[0] < fresh:
        return hit[1]

    async def go(q):
        ts = await q.call('GET', 'torrents/info', params={'hashes': h})
        if not ts:
            return None
        props = await q.call('GET', 'torrents/properties', params={'hash': h})
        files = await q.files(h)
        states = await q.call('GET', 'torrents/pieceStates', params={'hash': h})
        return {'t': ts[0], 'piece': props.get('piece_size') or 0, 'files': files, 'states': states or []}
    try:
        i = await _q(go)
    except Exception as e:
        log.info('qbt %s: %s', h[:8], config.mask(e)[:120])
        i = hit[1] if hit else None
    if i and i['piece']:
        off = 0
        for f in i['files']:
            pr = f.get('piece_range') or [0, 0]
            f['offset'] = off if off // i['piece'] == pr[0] else pr[0] * i['piece']  # pad files: start on a piece boundary
            off = f['offset'] + f['size']
    _cache[h] = (time.time(), i)
    return i


def have(i, f, a, b):
    """True when bytes [a, b) of file f are downloaded."""
    if not i or not i['piece'] or b <= a:
        return bool(i) and b <= a
    if (i['t'].get('progress') or 0) >= 1:
        return True
    p0, p1 = (f['offset'] + a) // i['piece'], (f['offset'] + b - 1) // i['piece']
    st = i['states']
    return p1 < len(st) and all(st[p] == 2 for p in range(p0, p1 + 1))


def disk_path(path):
    return path if os.path.exists(path) else path + '.!qB'


def videos(i):
    return [f for f in i['files'] if f.get('priority', 1) > 0 and f['name'].lower().endswith(library.VIDEO_EXT)
            and 'sample' not in f['name'].lower()]


def file_of(i, path):
    sp = i['t'].get('save_path') or ''
    return next((f for f in videos(i) if os.path.normpath(os.path.join(sp, f['name'])) == os.path.normpath(path)), None)


async def tune(h, t):
    """Download in order, first and last pieces first (once per torrent)."""
    if h in _tuned:
        return
    try:
        async def go(q):
            if not t.get('seq_dl'):
                await q.call('POST', 'torrents/toggleSequentialDownload', data={'hashes': h})
            if not t.get('f_l_piece_prio'):
                await q.call('POST', 'torrents/toggleFirstLastPiecePrio', data={'hashes': h})
        await _q(go)
        _tuned.add(h)
        _cache.pop(h, None)
    except Exception as e:
        log.info('tune %s: %s', h[:8], config.mask(e)[:120])


WATCH = {}       # torrent hash -> last time its bytes went to a player
SLOW = 256 * 1024  # other running downloads while someone watches a downloading title
_slow = set()


async def available(f):
    """Seconds playable from the start of a downloading file (contiguous downloaded bytes, proportional to the duration)."""
    i = await info(f['live'], 3.0)
    fi = file_of(i, f['path']) if i else None
    if not fi or not i['piece'] or not fi['size']:
        return None
    if (i['t'].get('progress') or 0) >= 1:
        return f['duration']
    st, p = i['states'], fi['offset'] // i['piece']
    p1 = (fi['offset'] + fi['size'] - 1) // i['piece']
    while p <= p1 and p < len(st) and st[p] == 2:
        p += 1
    got = max(0, min(fi['size'], p * i['piece'] - fi['offset']))
    return round((f['duration'] or 0) * got / fi['size'], 1)


async def prioritize(ts):
    """While a downloading title is being watched, the other running downloads slow down to SLOW so it gets the bandwidth."""
    now = time.time()
    watched = {h for h, t in WATCH.items() if now - t < 60}
    want = {t['hash'] for t in ts if watched and t['hash'] not in watched and (t.get('progress') or 0) < 1} if watched else set()
    add, rem = want - _slow, _slow - want
    try:
        if add:
            await _q(lambda q: q.call('POST', 'torrents/setDownloadLimit', data={'hashes': '|'.join(add), 'limit': str(SLOW)}))
        if rem:
            await _q(lambda q: q.call('POST', 'torrents/setDownloadLimit', data={'hashes': '|'.join(rem), 'limit': '0'}))
        if add or rem:
            log.info('priority to the watched download: %d slowed, %d back to full speed', len(add), len(rem))
        _slow.clear()
        _slow.update(want)
    except Exception as e:
        log.info('prioritize: %s', config.mask(e)[:120])


PLAY_CAP = 10 * 1024 * 1024  # while someone watches, torrents may not take the whole NIC (HA Green writes them to the NAS too)
_cap = {'on': None}


async def throttle():
    from . import play
    on = play.busy()
    if on == _cap['on']:
        return
    try:
        await _q(lambda q: q.call('POST', 'transfer/setDownloadLimit', data={'limit': str(PLAY_CAP if on else 0)}))
        _cap['on'] = on
        log.info('download limit %s', '%d MB/s (playing)' % (PLAY_CAP // 1048576) if on else 'off')
    except Exception as e:
        log.info('limit: %s', config.mask(e)[:120])


async def job():
    """Every few seconds: offer episodes of running downloads as soon as their start is on disk; retire finished/cancelled ones."""
    schema()
    await throttle()
    try:
        ts = await _q(lambda q: q.list())
    except Exception:
        return
    await prioritize(ts)
    rows = {r['hash']: r for r in db.q('SELECT * FROM download')}
    active = {}
    for t in ts:
        h, row = t.get('hash'), rows.get(t.get('hash'))
        if not row or not row['imdb'] or (t.get('progress') or 0) >= 1 or t.get('state') in ('error', 'missingFiles'):
            continue
        active[h] = (t, row)
    for r in db.q('SELECT id, live, path FROM media_file WHERE live IS NOT NULL'):
        if r['live'] in active:
            continue
        if os.path.exists(r['path']):
            db.x('UPDATE media_file SET live=NULL, mtime=0 WHERE id=?', (r['id'],))  # finished: the next scan re-probes it
            asyncio.ensure_future(library.scan())
        elif not os.path.exists(r['path'] + '.!qB'):
            db.x('UPDATE media_file SET live=NULL, missing=1 WHERE id=?', (r['id'],))  # cancelled
    for h, (t, row) in active.items():
        try:
            await offer(h, t, row)
        except Exception as e:
            log.warning('live %s: %s', h[:8], config.mask(e)[:150])


async def offer(h, t, row):
    await tune(h, t)
    i = await info(h, 3)
    if not i or not i['piece']:
        return
    sp = t.get('save_path') or i['t'].get('save_path') or ''
    for f in videos(i):
        final = os.path.normpath(os.path.join(sp, f['name']))
        if db.q1('SELECT 1 FROM media_file WHERE path=?', (final,)):
            continue
        size = f['size']
        if not (have(i, f, 0, min(HEAD_BYTES, size)) and have(i, f, max(0, size - TAIL_BYTES), size)):
            continue
        pr = await library.probe(disk_path(final))
        if not pr:
            continue
        s = library.probe_summary(pr)
        if not s['duration']:
            continue
        inf = library.parse(os.path.relpath(final, config.MEDIA_DIR))
        season = inf['season'] if inf['season'] is not None else row['season']
        episode = inf['episode'] if inf['episode'] is not None else row['episode']
        db.set_setting('manual:' + final, row['imdb'])  # the scan keeps the title it was downloaded for
        db.x('INSERT INTO media_file(path, imdb, season, episode, duration, width, height, hdr, vcodec, size, mtime, added_at, probe, '
             'ext_subs, pname, pyear, ptype, live) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
             (final, row['imdb'], season, episode, s['duration'], s['width'], s['height'], s['hdr'], s['vcodec'], size, 0, db.now(),
              json.dumps(pr), json.dumps(library.ext_subs(final)), inf['name'], inf['year'], inf['type'], h))
        log.info('live %s S%sE%s %dp (%.0f%% downloaded)', row['imdb'], season, episode, s['height'] or 0, 100 * (t.get('progress') or 0))
        from . import catalog
        if hasattr(catalog, '_home_cache'):
            catalog._home_cache.clear()


def progress(h):
    hit = _cache.get(h)
    return (hit[1]['t'].get('progress') or 0) if hit and hit[1] else None


async def serve(request, f):
    """HTTP range response from the growing file; waits (up to WAIT_MAX s) for pieces that are not there yet."""
    from . import play
    h = f['live']
    i = await info(h)
    fi = file_of(i, f['path']) if i else None
    if not fi:
        return web.Response(status=404, text='not downloading')
    size = fi['size']
    try:
        rng = request.http_range
        start = rng.start if rng.start is not None else 0
        stop = rng.stop
    except ValueError:
        start, stop = 0, None
    if start < 0:
        start = max(0, size + start)
    end = min(size, stop if stop is not None else size)
    if start >= size:
        return web.Response(status=416, headers={'Content-Range': 'bytes */%d' % size})
    ct = play.CT.get(os.path.splitext(f['path'])[1].lower(), 'application/octet-stream')
    hdr = {'Content-Type': ct, 'Accept-Ranges': 'bytes', 'Content-Length': str(end - start), 'Cache-Control': 'no-store'}
    partial = 'Range' in request.headers
    if partial:
        hdr['Content-Range'] = 'bytes %d-%d/%d' % (start, end - 1, size)
    resp = web.StreamResponse(status=206 if partial else 200, headers=hdr)
    try:
        await resp.prepare(request)
    except (ConnectionResetError, aiohttp.ClientConnectionResetError):
        return resp  # the player gave up before the headers went out
    if request.method == 'HEAD':
        return resp
    loop = asyncio.get_running_loop()

    fh = {'f': None, 'p': None}

    def read(p, a, n):
        if fh['p'] != p:
            if fh['f']:
                fh['f'].close()
            fh['f'], fh['p'] = open(p, 'rb'), p
        fh['f'].seek(a)
        return fh['f'].read(n)
    try:
        await _pump(request, resp, f, h, fi, start, end, read, loop)
    finally:
        if fh['f']:
            fh['f'].close()
    return resp


async def _pump(request, resp, f, h, fi, start, end, read, loop):
    from . import play
    pos, waited = start, 0.0
    while pos < end:
        n = min(CHUNK, end - pos)
        i = await info(h, 2.0)
        fi = file_of(i, f['path']) if i else fi
        if not have(i, fi, pos, pos + n):
            if waited >= WAIT_MAX:
                break
            await asyncio.sleep(1)
            waited += 1
            continue
        waited = 0
        try:
            data = await loop.run_in_executor(None, read, disk_path(f['path']), pos, n)
        except OSError:
            await asyncio.sleep(1)
            waited += 1
            continue
        if not data:
            break
        play.ACTIVE['at'] = WATCH[h] = time.time()
        try:
            await resp.write(data)
        except (ConnectionResetError, aiohttp.ClientConnectionResetError):
            return  # the player went away / seeked
        pos += len(data)
