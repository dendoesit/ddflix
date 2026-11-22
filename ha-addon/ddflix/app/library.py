"""Library: scan MEDIA_DIR, parse file names, ffprobe, match to IMDb via Cinemeta (keyless), cache images, keyframe index."""
import asyncio
import hashlib
import json
import logging
import os
import re
import time
from urllib.parse import quote

import aiohttp

from . import config, db

log = logging.getLogger('library')
VIDEO_EXT = ('.mkv', '.mp4', '.m4v', '.webm', '.avi', '.ts', '.mov')
SUB_EXT = ('.srt', '.vtt', '.ass', '.ssa')
CINEMETA = 'https://v3-cinemeta.strem.io'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) DDflix/1.0'}
_scan_lock = asyncio.Lock()
STATUS = {'lastScan': None, 'files': 0, 'scanning': False, 'unmatched': 0}

SE_RE = re.compile(r'[. _\-\[(]S(\d{1,2})[ ._\-]?E(\d{1,3})', re.I)
X_RE = re.compile(r'[. _\-\[(](\d{1,2})x(\d{2,3})[. _\-\])]', re.I)
SEASON_RE = re.compile(r'[. _\-\[(]S(\d{1,2})(?:[. _\-\])]|$)', re.I)
YEAR_RE = re.compile(r'[. _\-\[(]((?:19|20)\d{2})(?:[. _\-\])]|$)')
JUNK_RE = re.compile(r'[. _\-\[(](2160p|1080p|720p|480p|4k|uhd|web[- .]?dl|webrip|bluray|blu-ray|brrip|hdtv|x264|x265|h\.?264|h\.?265|hevc|'
                     r'remux|hdr|dv|ddp?5|aac|dts|proper|repack|internal|multi|ro|romanian)\b', re.I)


def clean_name(s):
    s = re.sub(r'[._]+', ' ', s)
    s = re.sub(r'\s*[\[(].*?[\])]\s*', ' ', s)
    s = re.sub(r'\s+-\s*$', '', s)
    return re.sub(r'\s+', ' ', s).strip(' -')


def parse(path):
    """-> dict(name, year, type, season, episode) from a file path (file name first, then parent folders)."""
    fn = os.path.basename(path)
    stem = ' ' + os.path.splitext(fn)[0] + ' '
    m = SE_RE.search(stem) or X_RE.search(stem)
    if m:
        name = clean_name(stem[:m.start()])
        if not name:  # "S01E02.mkv" inside "Show Name/Season 1/"
            parts = [p for p in path.replace('\\', '/').split('/')[:-1] if p and not re.match(r'(?i)^(season|sezon(ul)?)\s*\d+$|^S\d+$', p)]
            name = clean_name(parts[-1]) if parts else ''
            name = clean_name(' ' + (SEASON_RE.split(' ' + name + ' ')[0])) or name
        y = YEAR_RE.search(' ' + name + ' ')
        year = int(y.group(1)) if y else None
        if y:
            name = clean_name((' ' + name + ' ')[:y.start()]) or name
        return {'name': name, 'year': year, 'type': 'series', 'season': int(m.group(1)), 'episode': int(m.group(2))}
    y = YEAR_RE.search(stem)
    cut = y.start() if y else None
    j = JUNK_RE.search(stem)
    if j and (cut is None or j.start() < cut):
        cut = j.start()
    name = clean_name(stem[:cut] if cut else stem)
    return {'name': name, 'year': int(y.group(1)) if y else None, 'type': 'movie', 'season': None, 'episode': None}


def norm(s):
    s = (s or '').lower()
    s = re.sub(r'&', ' and ', s)
    s = re.sub(r"['’`]", '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# ---------------- ffprobe
async def run(args, timeout=120):
    p = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(p.communicate(), timeout)
    except asyncio.TimeoutError:
        p.kill()
        raise
    return p.returncode, out, err


async def probe(path):
    rc, out, _ = await run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], 90)
    if rc != 0:
        return None
    return json.loads(out.decode('utf-8', 'replace'))


def probe_summary(pr):
    v = next((s for s in pr.get('streams', []) if s.get('codec_type') == 'video' and not (s.get('disposition') or {}).get('attached_pic')), {})
    hdr = None
    if any('DOVI' in str(sd.get('side_data_type', '')).upper() or 'dolby vision' in str(sd).lower() for sd in v.get('side_data_list', []) or []):
        hdr = 'dovi'
    elif v.get('color_transfer') == 'smpte2084':
        hdr = 'hdr10'
    elif v.get('color_transfer') == 'arib-std-b67':
        hdr = 'hlg'
    dur = float((pr.get('format') or {}).get('duration') or v.get('duration') or 0)
    return {'duration': dur, 'width': v.get('width') or 0, 'height': v.get('height') or 0, 'vcodec': v.get('codec_name') or '', 'hdr': hdr}


def ext_subs(path):
    d, fn = os.path.split(path)
    stem = os.path.splitext(fn)[0]
    out = []
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for n in names:
        if n.lower().endswith(SUB_EXT) and n.startswith(stem):
            out.append(os.path.join(d, n))
    # Subs/ folder next to a single file (common in releases)
    sd = os.path.join(d, 'Subs')
    if os.path.isdir(sd):
        for root, _, files in os.walk(sd):
            for n in sorted(files):
                if n.lower().endswith(SUB_EXT) and (stem in root or len([x for x in names if x.lower().endswith(VIDEO_EXT)]) == 1):
                    out.append(os.path.join(root, n))
    return out


# ---------------- Cinemeta (keyless IMDb metadata)
async def http_json(session, url):
    async with session.get(url, headers=UA, timeout=aiohttp.ClientTimeout(total=20)) as r:
        r.raise_for_status()
        return await r.json(content_type=None)


async def match(session, name, year, typ):
    key = 'match:%s:%s:%s' % (typ, norm(name), year or '')
    hit = db.get_setting(key)
    if hit:
        return hit
    imdb = None
    if name:
        try:
            for t in ([typ, 'movie' if typ == 'series' else 'series'] if not year else [typ]):
                d = await http_json(session, '%s/catalog/%s/top/search=%s.json' % (CINEMETA, t, quote(name)))
                metas = d.get('metas') or []
                best, score = None, -1
                for i, m in enumerate(metas[:10]):
                    s = 0
                    if norm(m.get('name')) == norm(name):
                        s += 10
                    ry = re.match(r'(\d{4})', str(m.get('releaseInfo') or m.get('year') or ''))
                    if year and ry and abs(int(ry.group(1)) - year) <= 1:
                        s += 5
                    s -= i * 0.5
                    if s > score:
                        best, score = m, s
                if best and score >= 0 and str(best.get('id', '')).startswith('tt'):
                    imdb = best['id']
                    break
        except Exception as e:
            log.warning('cinemeta search %s: %s', name, e)
            return None  # try again next scan
    if not imdb:
        imdb = 'loc:' + hashlib.sha1(('%s|%s|%s' % (typ, norm(name), year or '')).encode()).hexdigest()[:10]
    db.set_setting(key, imdb)
    return imdb


async def ensure_title(session, imdb, pname, pyear, ptype):
    row = db.q1('SELECT imdb, meta_at FROM title WHERE imdb=?', (imdb,))
    if row and row['meta_at'] and time.time() - row['meta_at'] < 3 * 86400:
        return
    t = db.now()
    if imdb.startswith('loc:'):
        if not row:
            db.x('INSERT INTO title(imdb, type, name, year, first_seen, meta_at) VALUES(?,?,?,?,?,?)', (imdb, ptype, pname, pyear, t, t))
        return
    m = None
    for typ in (ptype, 'movie' if ptype == 'series' else 'series'):
        try:
            m = (await http_json(session, '%s/meta/%s/%s.json' % (CINEMETA, typ, imdb))).get('meta')
            if m:
                ptype = typ
                break
        except Exception as e:
            log.warning('cinemeta meta %s: %s', imdb, e)
    if not m:
        if not row:
            db.x('INSERT INTO title(imdb, type, name, year, first_seen) VALUES(?,?,?,?,?)', (imdb, ptype, pname, pyear, t))
        return
    years = re.findall(r'\d{4}', str(m.get('releaseInfo') or m.get('year') or ''))
    trailer = None
    for tr in m.get('trailers') or []:
        if tr.get('source'):
            trailer = tr['source']
            break
    vids = []
    for v in m.get('videos') or []:
        if v.get('season') is None or v.get('episode') is None:
            continue
        vids.append({'s': int(v['season']), 'e': int(v.get('episode') or v.get('number') or 0), 'name': v.get('name') or v.get('title') or '',
                     'overview': v.get('overview') or v.get('description') or '', 'released': (v.get('released') or '')[:10],
                     'thumb': v.get('thumbnail') or ''})
    rt = re.match(r'(\d+)', str(m.get('runtime') or ''))
    vals = (ptype, m.get('name') or pname, int(years[0]) if years else pyear, int(years[1]) if len(years) > 1 else None,
            m.get('description') or '', json.dumps(m.get('genres') or m.get('genre') or []), json.dumps((m.get('cast') or [])[:15]),
            json.dumps(m.get('director') or []), float(m['imdbRating']) if str(m.get('imdbRating') or '').replace('.', '', 1).isdigit() else None,
            int(rt.group(1)) if rt else None, (m.get('released') or '')[:10], m.get('poster') or '', m.get('background') or '',
            m.get('logo') or '', json.dumps(vids), t)
    if row:
        db.x('UPDATE title SET trailer_yt=? WHERE imdb=?', (trailer or '', imdb))
        db.x('UPDATE title SET type=?, name=?, year=?, year_end=?, description=?, genres=?, cast_=?, director=?, imdb_rating=?, '
             'runtime_min=?, released=?, poster_url=?, background_url=?, logo_url=?, videos=?, meta_at=? WHERE imdb=?', vals + (imdb,))
    else:
        db.x('INSERT INTO title(type, name, year, year_end, description, genres, cast_, director, imdb_rating, runtime_min, released, '
             'poster_url, background_url, logo_url, videos, meta_at, imdb, first_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
             vals + (imdb, t))
        db.x('UPDATE title SET trailer_yt=? WHERE imdb=?', (trailer or '', imdb))


# ---------------- scan
def walk_media():
    out = []
    for root, dirs, files in os.walk(config.MEDIA_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d.lower() not in ('sample', 'samples', 'extras', 'featurettes')]
        for f in files:
            lf = f.lower()
            if lf.endswith(VIDEO_EXT) and 'sample' not in lf and not lf.startswith('.'):
                out.append(os.path.join(root, f))
    return out


async def scan(force_meta=False):
    if _scan_lock.locked():
        return
    async with _scan_lock:
        STATUS['scanning'] = True
        try:
            await _scan(force_meta)
        finally:
            STATUS['scanning'] = False
            STATUS['lastScan'] = db.now()


async def _scan(force_meta):
    paths = await asyncio.get_event_loop().run_in_executor(None, walk_media)
    seen = set()
    known = {r['path']: r for r in db.q('SELECT id, path, mtime, imdb, missing FROM media_file')}
    async with aiohttp.ClientSession() as session:
        for p in paths:
            try:
                st = os.stat(p)
            except OSError:
                continue
            if time.time() - st.st_mtime < 60:  # still being written
                continue
            seen.add(p)
            k = known.get(p)
            if k and abs((k['mtime'] or 0) - st.st_mtime) < 1 and k['imdb'] and not force_meta:
                if k['missing']:
                    db.x('UPDATE media_file SET missing=0 WHERE id=?', (k['id'],))
                continue
            pr = await probe(p)
            if not pr:
                continue
            s = probe_summary(pr)
            info = parse(os.path.relpath(p, config.MEDIA_DIR))
            manual = db.get_setting('manual:' + p)
            imdb = manual or await match(session, info['name'], info['year'], info['type'])
            if not imdb:
                continue
            if k:
                db.x('UPDATE media_file SET imdb=?, season=?, episode=?, duration=?, width=?, height=?, hdr=?, vcodec=?, size=?, mtime=?, '
                     'missing=0, probe=?, ext_subs=?, kf=NULL, pname=?, pyear=?, ptype=? WHERE id=?',
                     (imdb, info['season'], info['episode'], s['duration'], s['width'], s['height'], s['hdr'], s['vcodec'], st.st_size,
                      st.st_mtime, json.dumps(pr), json.dumps(ext_subs(p)), info['name'], info['year'], info['type'], k['id']))
            else:
                db.x('INSERT INTO media_file(path, imdb, season, episode, duration, width, height, hdr, vcodec, size, mtime, added_at, probe, '
                     'ext_subs, pname, pyear, ptype) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                     (p, imdb, info['season'], info['episode'], s['duration'], s['width'], s['height'], s['hdr'], s['vcodec'], st.st_size,
                      st.st_mtime, db.now(), json.dumps(pr), json.dumps(ext_subs(p)), info['name'], info['year'], info['type']))
            await ensure_title(session, imdb, info['name'], info['year'], info['type'])
        # refresh stale metadata for titles in the library
        for r in db.q('SELECT DISTINCT m.imdb, m.pname, m.pyear, m.ptype FROM media_file m LEFT JOIN title t ON t.imdb=m.imdb '
                      'WHERE m.missing=0 AND (t.imdb IS NULL OR t.meta_at IS NULL OR t.meta_at<?)', (db.now() - 3 * 86400,)):
            await ensure_title(session, r['imdb'], r['pname'], r['pyear'], r['ptype'])
    for path, k in known.items():
        if path not in seen and not k['missing'] and not os.path.exists(path):
            db.x('UPDATE media_file SET missing=1 WHERE id=?', (k['id'],))
    # refresh sidecar subtitle lists (cheap)
    for r in db.q('SELECT id, path FROM media_file WHERE missing=0'):
        db.x('UPDATE media_file SET ext_subs=? WHERE id=?', (json.dumps(ext_subs(r['path'])), r['id']))
    STATUS['files'] = db.q1('SELECT COUNT(*) n FROM media_file WHERE missing=0')['n']
    STATUS['unmatched'] = db.q1("SELECT COUNT(*) n FROM media_file WHERE missing=0 AND imdb LIKE 'loc:%'")['n']


# ---------------- keyframe index (for HLS remux with seeking)
async def keyframes(path):
    """Video keyframe times from packet flags (reads the file, no decoding)."""
    p = await asyncio.create_subprocess_exec('nice', '-n', '15', 'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                             'packet=pts_time,flags', '-of', 'csv=p=0', path,
                                             stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    kf = []
    while True:
        line = await p.stdout.readline()
        if not line:
            break
        a = line.decode(errors='ignore').strip().split(',')
        if len(a) >= 2 and 'K' in a[1] and a[0] not in ('', 'N/A'):
            try:
                kf.append(float(a[0]))
            except ValueError:
                pass
    await p.wait()
    kf.sort()
    return kf


def segments_from_kf(kf, duration, target=5.0):
    if not kf:
        return []
    segs, start = [], kf[0] if kf[0] < 1 else 0.0
    for t in kf[1:]:
        if t - start >= target:
            segs.append((start, t))
            start = t
    if duration - start > 0.1:
        segs.append((start, duration))
    return segs


_kf_running = set()


async def ensure_kf(mid):
    r = db.q1('SELECT path, kf, duration FROM media_file WHERE id=?', (mid,))
    if not r or r['kf'] or mid in _kf_running:
        return
    _kf_running.add(mid)
    try:
        kf = await keyframes(r['path'])
        if kf:
            db.x('UPDATE media_file SET kf=? WHERE id=?', (json.dumps(segments_from_kf(kf, r['duration'] or kf[-1] + 5)), mid))
    except Exception as e:
        log.warning('keyframes %s: %s', mid, e)
    finally:
        _kf_running.discard(mid)


async def kf_job():
    """Index a few files per run (newest first) so remux-with-seek is ready when needed."""
    for r in db.q('SELECT id FROM media_file WHERE missing=0 AND kf IS NULL ORDER BY added_at DESC LIMIT 3'):
        await ensure_kf(r['id'])


# ---------------- images
IMG_FALLBACK = {'poster': 'https://images.metahub.space/poster/medium/%s/img',
                'backdrop': 'https://images.metahub.space/background/medium/%s/img',
                'logo': 'https://images.metahub.space/logo/medium/%s/img'}


async def image_path(kind, imdb, s=None, e=None):
    if imdb.startswith('loc:') or not re.match(r'^tt\d+$', imdb):
        return None
    d = os.path.join(config.DATA_DIR, 'img', kind)
    fn = os.path.join(d, imdb + ('_%s_%s' % (s, e) if kind == 'episode' else '') + '.img')
    if os.path.exists(fn):
        return fn if os.path.getsize(fn) > 0 else None
    t = db.q1('SELECT poster_url, background_url, logo_url, videos FROM title WHERE imdb=?', (imdb,))
    url = None
    if kind == 'episode':
        for v in db.jl(t['videos'] if t else None, []) or []:
            if v['s'] == s and v['e'] == e:
                url = v.get('thumb')
    else:
        url = t and {'poster': t['poster_url'], 'backdrop': t['background_url'], 'logo': t['logo_url']}[kind]
        url = url or IMG_FALLBACK[kind] % imdb
    os.makedirs(d, exist_ok=True)
    data = b''
    if url:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=UA, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status == 200:
                        data = await r.read()
        except Exception as ex:
            log.info('image %s %s: %s', kind, imdb, ex)
            return None  # transient; do not cache the miss
    with open(fn, 'wb') as f:
        f.write(data)
    return fn if data else None
