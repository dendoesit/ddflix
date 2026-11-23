"""Skip intro / credits markers and trickplay sprite sheets (background jobs, niced).

Markers (v2): 1) chapters named Intro/Opening/Credits/Ending; 2) audio fingerprints (chromaprint) compared between episodes
of the same season: the intro is the longest stretch of identical audio near the start, the credits the identical stretch
near the end. Exposed in /api/media/{id} as markers {intro, credits, v}. Trickplay: one 320-px frame every 10 s, 10x10 tiles
per JPEG sheet, served at /api/media/{id}/trick/{n}.jpg."""
import asyncio
import json
import logging
import os
import re
import struct
import time

from aiohttp import web

from . import config, db
from .util import jerr

log = logging.getLogger('markers')
FP_ITEM = 4096 / 3 / 11025          # seconds per chromaprint item (algorithm 1, 11025 Hz, 1/3 overlap)
HEAD_S, TAIL_S = 900, 420           # fingerprint the first 15 min and the last 7 min
TRICK_DIR = os.path.join(config.DATA_DIR, 'trick')
TI, TCOLS, TROWS, TW = 10, 10, 10, 320
V = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS marker(media_id INTEGER PRIMARY KEY, intro_start REAL, intro_end REAL, intro_src TEXT, intro_conf REAL,
  credits_start REAL, credits_end REAL, credits_src TEXT, credits_conf REAL, v INTEGER, done_at INTEGER);
CREATE TABLE IF NOT EXISTS fp(media_id INTEGER, part TEXT, data BLOB, PRIMARY KEY(media_id, part));
CREATE TABLE IF NOT EXISTS trick(media_id INTEGER PRIMARY KEY, interval INTEGER, cols INTEGER, rows INTEGER, w INTEGER, h INTEGER,
  sheets INTEGER, done_at INTEGER, failed INTEGER DEFAULT 0);
"""
_schema = {'ok': False}


def schema():
    if not _schema['ok']:
        with db._lock:
            db.conn().executescript(SCHEMA)
        _schema['ok'] = True


async def run(args, timeout, binary=False):
    p = await asyncio.create_subprocess_exec('nice', '-n', '15', *args, stdin=asyncio.subprocess.DEVNULL,
                                             stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(p.communicate(), timeout)
    except asyncio.TimeoutError:
        p.kill()
        await p.wait()
        raise RuntimeError('timeout')
    if p.returncode != 0:
        raise RuntimeError(err.decode('utf-8', 'replace')[-300:])
    return out if binary else out.decode('utf-8', 'replace')


# ---------------- markers
INTRO_RE = re.compile(r'\b(intro|opening|op|generic de (inceput|început)|title sequence)\b', re.I)
CRED_RE = re.compile(r'\b(credits|end ?credits|ending|ed|outro|generic( de final)?)\b', re.I)


async def chapters(path):
    try:
        d = json.loads(await run(['ffprobe', '-v', 'error', '-show_chapters', '-of', 'json', path], 60))
    except Exception:
        return None, None
    intro = credits = None
    for c in d.get('chapters') or []:
        title = (c.get('tags') or {}).get('title') or ''
        st, en = float(c.get('start_time') or 0), float(c.get('end_time') or 0)
        if not intro and INTRO_RE.search(title) and en > st:
            intro = {'start': round(st, 2), 'end': round(en, 2), 'src': 'chapters', 'conf': 0.9}
        elif CRED_RE.search(title) and st > 0:
            credits = {'start': round(st, 2), 'end': round(en, 2) if en else None, 'src': 'chapters', 'conf': 0.9}
    return intro, credits


async def fingerprint(f, part):
    row = db.q1('SELECT data FROM fp WHERE media_id=? AND part=?', (f['id'], part))
    if row:
        return list(struct.unpack('<%dI' % (len(row['data']) // 4), row['data']))
    dur = f['duration'] or 0
    if part == 'head':
        pos = ['-t', str(HEAD_S)]
    else:
        if dur < TAIL_S + 60:
            return []
        pos = ['-ss', str(max(0, dur - TAIL_S))]
    raw = await run(['ffmpeg', '-nostdin', '-v', 'error'] + pos + ['-i', f['path'], '-map', '0:a:0', '-vn', '-sn', '-ac', '1',
                    '-f', 'chromaprint', '-fp_format', 'raw', '-'], 600, binary=True)
    db.x('INSERT OR REPLACE INTO fp(media_id, part, data) VALUES(?,?,?)', (f['id'], part, raw))
    return list(struct.unpack('<%dI' % (len(raw) // 4), raw))


def common(a, b, min_s, max_s):
    """Longest stretch of near-identical audio between two fingerprints -> (a_start, a_end, b_start, b_end) in items, or None."""
    if not a or not b:
        return None
    idx = {}
    for j, v in enumerate(b):
        idx.setdefault(v, []).append(j)
    shifts = {}
    for i, v in enumerate(a):
        for j in idx.get(v, ()):
            shifts[i - j] = shifts.get(i - j, 0) + 1
    best = None
    gap = int(2.5 / FP_ITEM)
    for sh, n in sorted(shifts.items(), key=lambda x: -x[1])[:6]:
        if n < 8:
            break
        run_s = run_e = None
        cur_s = last = None
        for i in range(max(0, sh), min(len(a), len(b) + sh)):
            if bin(a[i] ^ b[i - sh]).count('1') <= 6:
                if cur_s is None or i - last > gap:
                    cur_s = i
                last = i
                if run_s is None or last - cur_s > run_e - run_s:
                    run_s, run_e = cur_s, last
        if run_s is None:
            continue
        ln = (run_e - run_s) * FP_ITEM
        if min_s <= ln <= max_s and (best is None or ln > (best[1] - best[0]) * FP_ITEM):
            best = (run_s, run_e, run_s - sh, run_e - sh)
    return best


async def episode_markers(f):
    intro, credits = await chapters(f['path'])
    if f['season'] is None or (intro and credits):
        return intro, credits
    sib = db.q('SELECT id, path, duration, season, episode FROM media_file WHERE imdb=? AND season=? AND missing=0 AND id<>? '
               'ORDER BY ABS(COALESCE(episode,0)-?) LIMIT 2', (f['imdb'], f['season'], f['id'], f['episode'] or 0))
    if not sib:
        return intro, credits
    dur = f['duration'] or 0
    best_i = best_c = None
    for s in sib:
        if not intro:
            m = common(await fingerprint(f, 'head'), await fingerprint(s, 'head'), 15, 180)
            if m and (best_i is None or m[1] - m[0] > best_i[1] - best_i[0]):
                best_i = m
        if not credits and dur:
            m = common(await fingerprint(f, 'tail'), await fingerprint(s, 'tail'), 15, TAIL_S)
            if m and (best_c is None or m[1] - m[0] > best_c[1] - best_c[0]):
                best_c = m
    if best_i:
        st, en = best_i[0] * FP_ITEM, best_i[1] * FP_ITEM
        intro = {'start': round(0 if st < 3 else st, 2), 'end': round(en, 2), 'src': 'chromaprint', 'conf': 0.75}
    if best_c:
        base = max(0, dur - TAIL_S)
        st, en = base + best_c[0] * FP_ITEM, base + best_c[1] * FP_ITEM
        credits = {'start': round(st, 2), 'end': None if dur - en < 20 else round(en, 2), 'src': 'chromaprint', 'conf': 0.7}
    return intro, credits


def save_markers(mid, intro, credits):
    i, c = intro or {}, credits or {}
    db.x('INSERT OR REPLACE INTO marker(media_id, intro_start, intro_end, intro_src, intro_conf, credits_start, credits_end, credits_src, '
         'credits_conf, v, done_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
         (mid, i.get('start'), i.get('end'), i.get('src'), i.get('conf'), c.get('start'), c.get('end'), c.get('src'), c.get('conf'), V, db.now()))


def markers_out(mid):
    schema()
    r = db.q1('SELECT * FROM marker WHERE media_id=?', (mid,))
    if not r:
        return None
    intro = {'start': r['intro_start'], 'end': r['intro_end'], 'src': r['intro_src'], 'conf': r['intro_conf']} if r['intro_end'] else None
    credits = {'start': r['credits_start'], 'end': r['credits_end'], 'src': r['credits_src'], 'conf': r['credits_conf']} \
        if r['credits_start'] is not None else None
    return {'intro': intro, 'credits': credits, 'v': V}


# ---------------- trickplay
def trick_size(f):
    w, h = f['width'] or 1920, f['height'] or 1080
    th = max(2, int(round(TW * h / w / 2)) * 2)
    return TW, th


async def make_trick(f):
    dur = f['duration'] or 0
    if dur < 60:
        return
    w, h = trick_size(f)
    out = os.path.join(TRICK_DIR, str(f['id']))
    tmp = out + '.tmp'
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    vf = 'fps=1/%d,scale=%d:%d' % (TI, w, h)
    if f['hdr'] in ('hdr10', 'hlg'):
        vf += ',zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv'
    vf += ',format=yuvj420p,tile=%dx%d' % (TCOLS, TROWS)
    await run(['ffmpeg', '-nostdin', '-v', 'error', '-skip_frame', 'nokey', '-i', f['path'], '-map', '0:v:0', '-an', '-sn', '-vf', vf,
               '-vsync', 'vfr', '-q:v', '6', os.path.join(tmp, '%d.jpg')], max(900, dur))
    sheets = len([x for x in os.listdir(tmp) if x.endswith('.jpg')])
    if not sheets:
        raise RuntimeError('no sheets')
    shutil.rmtree(out, ignore_errors=True)
    os.replace(tmp, out)
    db.x('INSERT OR REPLACE INTO trick(media_id, interval, cols, rows, w, h, sheets, done_at, failed) VALUES(?,?,?,?,?,?,?,?,0)',
         (f['id'], TI, TCOLS, TROWS, w, h, sheets, db.now()))


def trick_out(mid):
    schema()
    r = db.q1('SELECT * FROM trick WHERE media_id=? AND failed=0', (mid,))
    if not r or not os.path.isdir(os.path.join(TRICK_DIR, str(mid))):
        return None
    return {'interval': r['interval'], 'cols': r['cols'], 'rows': r['rows'], 'w': r['w'], 'h': r['h'], 'sheets': r['sheets'],
            'url': '/api/media/%d/trick/' % mid}


async def trick_file(request):
    from . import play
    mid = int(request.match_info['mid'])
    f = play.media_file(mid)
    if not f or not play.allowed_imdb(request, f['imdb']):
        return jerr(404, 'media not found')
    fn = os.path.join(TRICK_DIR, str(mid), '%d.jpg' % int(request.match_info['n']))
    if not os.path.exists(fn):
        return jerr(404, 'no sheet')
    return web.FileResponse(fn, headers={'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400'})


# ---------------- job: newest files first, one at a time
_busy = {'on': False}


async def job():
    schema()
    if _busy['on']:
        return
    _busy['on'] = True
    try:
        from . import play
        t0 = time.time()
        while time.time() - t0 < 1500 and not play.busy():
            f = db.q1('SELECT * FROM media_file m WHERE missing=0 AND live IS NULL AND season IS NOT NULL AND duration > 300 AND NOT EXISTS '
                      '(SELECT 1 FROM marker k WHERE k.media_id=m.id AND k.v=?) ORDER BY added_at DESC LIMIT 1', (V,))
            if f:
                try:
                    intro, credits = await episode_markers(f)
                except Exception as e:
                    log.info('markers %s: %s', f['id'], str(e)[:200])
                    intro = credits = None
                save_markers(f['id'], intro, credits)
                log.info('markers %s S%sE%s: intro=%s credits=%s', f['id'], f['season'], f['episode'],
                         intro and (intro['start'], intro['end']), credits and credits['start'])
                continue
            f = db.q1('SELECT * FROM media_file m WHERE missing=0 AND live IS NULL AND duration > 60 AND NOT EXISTS '
                      '(SELECT 1 FROM trick t WHERE t.media_id=m.id) ORDER BY added_at DESC LIMIT 1')
            if not f:
                # movies: chapter markers only (cheap)
                f = db.q1('SELECT * FROM media_file m WHERE missing=0 AND live IS NULL AND season IS NULL AND NOT EXISTS '
                          '(SELECT 1 FROM marker k WHERE k.media_id=m.id AND k.v=?) LIMIT 1', (V,))
                if not f:
                    break
                save_markers(f['id'], *(await chapters(f['path'])))
                continue
            try:
                await make_trick(f)
                log.info('trickplay %s done', f['id'])
            except Exception as e:
                log.info('trickplay %s failed: %s', f['id'], str(e)[:200])
                db.x('INSERT OR REPLACE INTO trick(media_id, failed, done_at) VALUES(?,1,?)', (f['id'], db.now()))
    finally:
        _busy['on'] = False


def routes(app):
    app.router.add_get('/api/media/{mid:\\d+}/trick/{n:\\d+}.jpg', trick_file)
