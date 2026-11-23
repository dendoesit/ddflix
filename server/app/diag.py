"""Admin diagnostics (web login only): server health, remote access, downloads, playback, background jobs and the
recent problems (warnings/errors from the log + player errors reported by the TVs). Feeds the phone page #/diag."""
import collections
import json
import logging
import os
import shutil
import ssl
import time

from . import config, db

STARTED = time.time()
JOBS = {}                                   # name -> {last, ms, ok, err, errAt, runs, fails}
PROBLEMS = collections.deque(maxlen=300)    # (ts, logger, level, message)


class _Keep(logging.Handler):
    def emit(self, rec):
        try:
            PROBLEMS.append((rec.created, rec.name, rec.levelname, config.mask(rec.getMessage())[:400]))
        except Exception:
            pass


def install():
    h = _Keep(level=logging.WARNING)
    logging.getLogger().addHandler(h)


def job_done(name, t0, err=None):
    j = JOBS.setdefault(name, {'runs': 0, 'fails': 0})
    j['runs'] += 1
    j['last'] = int(time.time())
    j['ms'] = int((time.time() - t0) * 1000)
    j['ok'] = err is None
    if err is not None:
        j['fails'] += 1
        j['err'] = config.mask(err)[:300]
        j['errAt'] = int(time.time())


def _read(p, default=''):
    try:
        with open(p) as f:
            return f.read()
    except OSError:
        return default


def host():
    mem = {}
    for line in _read('/proc/meminfo').splitlines():
        k, _, v = line.partition(':')
        if k in ('MemTotal', 'MemAvailable'):
            mem[k] = int(v.split()[0]) * 1024
    temps = []
    for z in range(6):
        t = _read('/sys/class/thermal/thermal_zone%d/temp' % z).strip()
        if t.isdigit():
            temps.append(round(int(t) / 1000, 1))
    disks = {}
    for k, p in (('media', config.MEDIA_DIR), ('data', config.DATA_DIR)):
        try:
            u = shutil.disk_usage(p)
            disks[k] = {'total': u.total, 'free': u.free}
        except OSError:
            disks[k] = None
    try:
        load = os.getloadavg()
    except (OSError, AttributeError):
        load = None
    return {'version': os.environ.get('DDFLIX_VERSION', ''), 'uptime': int(time.time() - STARTED), 'load': load,
            'cpus': os.cpu_count(), 'memTotal': mem.get('MemTotal'), 'memAvail': mem.get('MemAvailable'),
            'tempC': max(temps) if temps else None, 'disks': disks}


def remote():
    from . import direct
    ts = {}
    try:
        ts = json.loads(_read(os.path.join(config.DATA_DIR, 'tailscale', 'status.json'), '{}'))
    except ValueError:
        pass
    ts.pop('loginUrl', None)
    ts.pop('enableUrl', None)
    cert = None
    try:
        d = ssl._ssl._test_decode_cert(config.SSL_CERT)
        cert = {'host': direct.S['host'], 'notAfter': d.get('notAfter')}
    except Exception:
        pass
    return {'funnel': ts, 'direct': direct.url(), 'cert': cert}


async def downloads():
    from . import live, rss
    out = {'transfer': None, 'torrents': [], 'error': None}
    try:
        async def go(q):
            tr = await q.call('GET', 'transfer/info')
            ts = await q.call('GET', 'torrents/info', params={'sort': 'added_on', 'reverse': 'true', 'limit': '25'})
            return tr, ts
        tr, ts = await live._q(go)
        out['transfer'] = {k: tr.get(k) for k in ('dl_info_speed', 'up_info_speed', 'dl_rate_limit', 'up_rate_limit',
                                                  'connection_status', 'dht_nodes')}
        for t in ts or []:
            out['torrents'].append({k: t.get(k) for k in ('name', 'progress', 'dlspeed', 'upspeed', 'eta', 'state', 'size',
                                                          'num_seeds', 'num_leechs', 'added_on', 'ratio')})
    except Exception as e:
        out['error'] = config.mask(e)[:200]
    out['live'] = [dict(r) for r in db.q('SELECT m.id, m.season, m.episode, m.height, t.name FROM media_file m '
                                          'LEFT JOIN title t ON t.imdb=m.imdb WHERE m.live IS NOT NULL')]
    out['rss'] = dict(rss.STATUS)
    return out


def playback():
    from . import play
    now = time.time()
    names = {}

    def name(mid):
        if mid not in names:
            r = db.q1('SELECT t.name, m.season, m.episode, m.height FROM media_file m LEFT JOIN title t ON t.imdb=m.imdb WHERE m.id=?', (mid,))
            names[mid] = dict(r) if r else {}
        return names[mid]
    sess = []
    for s in play.SESS.values():
        if now - s['last'] < 180:
            sess.append({'kind': 'tv', 'mode': s['plan'].get('mode'), 'idle': int(now - s['last']), **name(s['mid'])})
    for w in play.WEB.values():
        if now - w.last < 180:
            sess.append({'kind': 'web', 'mode': 'remux', 'idle': int(now - w.last), **name(w.f['id'])})
    ev = [dict(r) for r in db.q("SELECT e.at, e.kind, e.mode, e.detail, e.media_id, t.name, m.season, m.episode FROM play_event e "
                                "LEFT JOIN media_file m ON m.id=e.media_id LEFT JOIN title t ON t.imdb=m.imdb "
                                "WHERE e.at>? AND e.kind IN ('tv_error','tv_unstick','tv_autoorig','tv_stall') ORDER BY e.at DESC LIMIT 60",
                                (db.now() - 7 * 86400,))]
    ev = [e for e in ev if e['kind'] != 'tv_stall' or (json.loads(e['detail'] or '{}').get('ms') or 0) >= 5000]
    starts = db.q1("SELECT COUNT(*) n FROM play_event WHERE kind='tv_start' AND at>?", (db.now() - 86400,))['n']
    return {'active': play.busy(), 'sessions': sess, 'events': ev[:40], 'starts24h': starts}


def library_info():
    from . import library
    r = db.q1('SELECT COUNT(*) files, COUNT(DISTINCT imdb) titles, SUM(size) bytes FROM media_file WHERE missing=0')
    pend = db.q1("SELECT COUNT(*) n FROM sub_state WHERE next_at>?", (time.time(),)) if db.q1(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sub_state'") else None
    return {'status': dict(library.STATUS), 'files': r['files'], 'titles': r['titles'], 'bytes': r['bytes'],
            'subsPending': pend['n'] if pend else None}


async def snapshot():
    probs = [{'at': int(t), 'src': n, 'level': lv, 'msg': m} for t, n, lv, m in reversed(PROBLEMS)][:80]
    return {'at': int(time.time()), 'host': host(), 'remote': remote(), 'downloads': await downloads(),
            'playback': playback(), 'library': library_info(), 'jobs': JOBS, 'problems': probs}
