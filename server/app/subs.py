"""Subtitles ready before you press play:
- embedded text tracks are extracted ahead of time (one ffmpeg pass per file), so switching is instant;
- Romanian and English are downloaded from OpenSubtitles (Stremio's keyless add-on) when the file has none, and saved next to
  the video as <name>.ro.srt / <name>.en.srt (Plex sees them too);
- every downloaded subtitle is synced to the file: aligned on a subtitle track that came with the file (any language, speech
  timing is the same) or, failing that, picked by release name / OpenSubtitles hash.
Background job (newest files first, pauses while someone watches) + `want(f)` when a file is opened in the player."""
import asyncio
import bisect
import hashlib
import json
import logging
import os
import re
import struct
import time

import aiohttp

from . import config, db, library

log = logging.getLogger('subs')
OS_URL = 'https://opensubtitles-v3.strem.io/subtitles/%s/%s%s.json'
WANT = ('eng', 'rum')  # English first: it can become the timing reference for Romanian
SUFFIX = {'rum': 'ro', 'eng': 'en'}
OS_LANG = {'rum': ('rum', 'ron'), 'eng': ('eng',)}
SUB_DIR = os.path.join(config.DATA_DIR, 'subs')
RETRY = 12 * 3600  # Romanian subtitles often appear a day or two after an episode
MAX_TRIES = 10
_busy = {}  # media id -> task
_schema = {'ok': False}


def schema():
    if _schema['ok']:
        return
    db.x('CREATE TABLE IF NOT EXISTS sub_state(media_id INTEGER PRIMARY KEY, mtime REAL, done_at INTEGER, next_at INTEGER, '
         'tries INTEGER DEFAULT 0, info TEXT)')
    if not db.get_setting('subs_manual_v1'):
        db.x('UPDATE progress SET sub_key=NULL')  # earlier builds saved the automatic pick too: forget those once
        db.set_setting('subs_manual_v1', '1')
    _schema['ok'] = True


# ---------------- cue helpers
_TS = re.compile(r'(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})')


def parse(text):
    out = []
    for block in re.split(r'\n[ \t]*\n', (text or '').replace('\r\n', '\n').replace('\r', '\n').lstrip('﻿')):
        lines = block.strip('\n').split('\n')
        for i, line in enumerate(lines):
            m = _TS.search(line)
            if m:
                g = m.groups()
                s = int(g[0] or 0) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3].ljust(3, '0')) / 1000
                e = int(g[4] or 0) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7].ljust(3, '0')) / 1000
                body = '\n'.join(lines[i + 1:]).strip()
                if body:
                    out.append([s, e, body])
                break
    out.sort(key=lambda c: c[0])
    return out


def _fmt(t):
    t = max(0.0, t)
    ms = int(round(t * 1000))
    return '%02d:%02d:%02d,%03d' % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def to_srt(cues):
    return '\n'.join('%d\n%s --> %s\n%s\n' % (i + 1, _fmt(s), _fmt(e), b) for i, (s, e, b) in enumerate(cues))


RATIOS = (1.0, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25)


def _score(rs, cs, r, off, tol=0.4):
    n = 0
    for c in cs:
        x = c * r + off
        i = bisect.bisect_left(rs, x - tol)
        if i < len(rs) and rs[i] <= x + tol:
            n += 1
    return n / max(1, len(cs))


def align(ref, cand):
    """-> (score 0..1, ratio, offset) of the map t -> t*ratio + offset that lands most candidate cue starts on reference cue
    starts (frame-rate changes + a constant shift: different logos / recaps / release sources)."""
    rs = sorted(c[0] for c in ref)
    cs = [c[0] for c in cand]
    if len(rs) < 20 or len(cs) < 20:
        return 0.0, 1.0, 0.0
    sample = cs[::max(1, len(cs) // 250)]
    best = (0.0, 1.0, 0.0)
    for r in RATIOS:
        hist = {}
        for c in sample:
            x = c * r
            lo, hi = bisect.bisect_left(rs, x - 300), bisect.bisect_right(rs, x + 300)
            for y in rs[lo:hi]:
                k = round((y - x) * 5)
                hist[k] = hist.get(k, 0) + 1
        if not hist:
            continue
        k = max(hist, key=lambda k: hist[k] + hist.get(k - 1, 0) + hist.get(k + 1, 0))
        off = max(((k / 5 + d / 20) for d in range(-6, 7)), key=lambda o: (round(_score(rs, sample, r, o, 0.15), 3), -abs(o - k / 5)))
        sc = _score(rs, cs, r, off)
        if sc > best[0]:
            best = (sc, r, off)
    return best


def shift(cues, r, off):
    return [[s * r + off, e * r + off, b] for s, e, b in cues if e * r + off > 0]


# ---------------- what the file already has
def cache_path(f, key):
    return os.path.join(SUB_DIR, '%d_%s.vtt' % (f['id'], key))


def _fresh(p, f):
    return os.path.exists(p) and os.path.getmtime(p) >= (f['mtime'] or 0)


async def extract_embedded(f):
    """All embedded text tracks in one read of the file (the player gets them instantly afterwards)."""
    from . import play
    os.makedirs(SUB_DIR, exist_ok=True)
    keys = [s['key'] for s in play.sub_list(f) if s['src'] == 'embedded']
    todo = [k for k in keys if not _fresh(cache_path(f, k), f) and cache_path(f, k) not in play.SUB_PENDING]
    if not todo:
        return
    args = ['nice', '-n', '10', 'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', f['path']]
    outs = []
    for k in todo:
        out = cache_path(f, k)
        play.SUB_PENDING.add(out)
        outs.append(out)
        args += ['-map', '0:%s' % k[1:], '-f', 'webvtt', out + '.tmp']
    t0 = time.time()
    try:
        rc, _, err = await library.run(args, timeout=1800)
        for o in outs:
            if rc == 0 and os.path.exists(o + '.tmp'):
                os.replace(o + '.tmp', o)
        log.info('embedded subs %d: %d tracks in %.0fs%s', f['id'], len(outs), time.time() - t0,
                 '' if rc == 0 else ' rc=%s %s' % (rc, err.decode(errors='ignore')[-150:]))
    finally:
        for o in outs:
            play.SUB_PENDING.discard(o)


def _read(p):
    from . import play
    return play.read_text(p)


def reference(f):
    """Cues of a subtitle that came with the file (best timing reference; English preferred), or None."""
    from . import play
    best = None
    tracks = [(s['lang'], cache_path(f, s['key']), True) for s in play.sub_list(f) if s['src'] == 'embedded' and not s['forced']]
    tracks += [(play.ext_lang(p), p, False) for p in (db.jl(f['ext_subs'], []) or []) if not ours(p) and 'forced' not in p.lower()]
    for lang, p, emb in tracks:
        if emb and not _fresh(p, f):
            continue
        if not emb and not (p.lower().endswith(('.srt', '.vtt')) and os.path.exists(p)):
            continue
        cues = parse(_read(p))
        if len(cues) > 50 and (best is None or (lang == 'eng' and best[0] != 'eng')):
            best = (lang, cues)
    return best[1] if best else None


# ---------------- OpenSubtitles
def os_hash(path):
    size = os.path.getsize(path)
    h = size
    with open(path, 'rb') as fh:
        for pos in (0, max(0, size - 65536)):
            fh.seek(pos)
            buf = fh.read(65536)
            buf += b'\0' * (-len(buf) % 8)
            for (x,) in struct.iter_unpack('<Q', buf):
                h = (h + x) & 0xFFFFFFFFFFFFFFFF
    return '%016x' % h, size


_TOK = re.compile(r'[a-z0-9]+')
SOURCES = {'amzn', 'atvp', 'atv', 'dsnp', 'nf', 'hmax', 'max', 'pmtp', 'hulu', 'pcok', 'web', 'webrip', 'webdl', 'bluray', 'hdtv', 'remux'}


def _rank(item, fname, fps):
    a = set(_TOK.findall(fname.lower().replace('web-dl', 'webdl')))
    b = set(_TOK.findall(((item.get('movieReleaseName') or '') + ' ' + (item.get('subtitleFileName') or '')).lower().replace('web-dl', 'webdl')))
    grp = (item.get('releaseGroup') or '').lower()
    sc = 10 if item.get('m') == 'h' else 0
    sc += 5 if grp and grp in a else 0
    sc += 2 * len(a & b & SOURCES)
    sc += 1 if {'2160p', '1080p', '720p'} & a & b else 0
    if fps and item.get('fpsMilli'):
        sc += 1 if abs(item['fpsMilli'] / 1000 - fps) < 0.05 else -1
    sc -= 0.5 if re.search(r'(^|[^a-z])(hi|sdh)([^a-z]|$)', (item.get('subtitleFileName') or '').lower()) else 0
    return sc


async def candidates(s, f):
    typ, vid = ('series', '%s:%d:%d' % (f['imdb'], f['season'], f['episode'])) if f['season'] is not None else ('movie', f['imdb'])
    try:
        hsh, size = await asyncio.get_running_loop().run_in_executor(None, os_hash, f['path'])
        extra = '/videoHash=%s&videoSize=%d' % (hsh, size)
    except OSError:
        extra = ''
    async with s.get(OS_URL % (typ, vid, extra), timeout=aiohttp.ClientTimeout(total=30)) as r:
        r.raise_for_status()
        return (await r.json(content_type=None)).get('subtitles') or []


async def download(s, url):
    async with s.get(url, timeout=aiohttp.ClientTimeout(total=40)) as r:
        r.raise_for_status()
        raw = await r.read()
    for enc in ('utf-8', 'cp1250', 'iso-8859-2', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


def _fps(f):
    try:
        v = next(x for x in (json.loads(f['probe'] or '{}').get('streams') or []) if x.get('codec_type') == 'video')
        a, b = (v.get('r_frame_rate') or '0/1').split('/')
        return float(a) / float(b or 1)
    except (StopIteration, ValueError, ZeroDivisionError, TypeError):
        return None


def sidecar(f, lang):
    stem = os.path.splitext(f['path'])[0]
    return '%s.%s.srt' % (stem, SUFFIX[lang])


async def fetch_lang(s, f, lang, items, ref):
    """Best subtitle of `lang` for this file -> (cues, info) or (None, reason)."""
    fname = os.path.basename(f['path'])
    fps = _fps(f)
    pool = sorted([i for i in items if i.get('lang') in OS_LANG[lang] and i.get('url')], key=lambda i: -_rank(i, fname, fps))
    if not pool:
        return None, 'none on OpenSubtitles'
    best = None
    for it in pool[:5 if ref else 1]:
        try:
            cues = parse(await download(s, it['url']))
        except Exception as e:
            log.info('sub download %s: %s', it.get('id'), str(e)[:100])
            continue
        if len(cues) < 50:
            continue
        if ref:
            sc, r, off = await asyncio.get_running_loop().run_in_executor(None, align, ref, cues)
            if best is None or sc > best[0]:
                best = (sc, shift(cues, r, off), {'id': it.get('id'), 'rel': it.get('movieReleaseName'), 'score': round(sc, 2),
                                                   'ratio': round(r, 4), 'offset': round(off, 2)})
            if sc > 0.6:
                break
        else:
            dur = f['duration'] or 0
            if dur and cues[-1][0] > dur + 120:
                continue  # clearly another cut
            best = (1.0, cues, {'id': it.get('id'), 'rel': it.get('movieReleaseName'), 'score': None})
            break
        await asyncio.sleep(1)
    if not best:
        return None, 'no usable file'
    if ref and best[0] < 0.25:
        return None, 'out of sync (%.2f)' % best[0]
    return best[1], best[2]


def have_langs(f):
    from . import play
    return {s['lang'] for s in play.sub_list(f) if not s['forced']}


async def process(f, front=False):
    """Extract embedded tracks, then download the missing Romanian / English ones. Returns True when nothing is left to do."""
    schema()
    if not f['imdb'] or not os.path.exists(f['path']):
        return True
    await extract_embedded(f)
    missing = [l for l in WANT if l not in have_langs(f)]
    info = {}
    if missing and f['imdb'].startswith('tt') and (f['season'] is None or f['episode'] is not None):
        try:
            async with aiohttp.ClientSession(headers={'User-Agent': 'DDflix/1.0'}) as s:
                items = await candidates(s, f)
                for lang in missing:
                    ref = reference(f)
                    cues, why = await fetch_lang(s, f, lang, items, ref)
                    if cues is None:
                        info[lang] = why
                        continue
                    p = sidecar(f, lang)
                    try:
                        with open(p + '.tmp', 'w', encoding='utf-8') as fh:
                            fh.write(to_srt(cues))
                        os.replace(p + '.tmp', p)
                    except OSError as e:
                        info[lang] = 'write failed: %s' % str(e)[:80]
                        continue
                    db.x('UPDATE media_file SET ext_subs=? WHERE id=?', (json.dumps(library.ext_subs(f['path'])), f['id']))
                    f = db.q1('SELECT * FROM media_file WHERE id=?', (f['id'],))
                    info[lang] = why
                    log.info('subs %d %s: %s', f['id'], lang, why)
        except Exception as e:
            info['error'] = str(e)[:150]
            log.warning('subs %d: %s', f['id'], info['error'])
    left = [l for l in WANT if l not in have_langs(f)]
    row = db.q1('SELECT tries FROM sub_state WHERE media_id=?', (f['id'],))
    tries = (row['tries'] if row else 0) + (1 if left else 0)
    db.x('INSERT INTO sub_state(media_id, mtime, done_at, next_at, tries, info) VALUES(?,?,?,?,?,?) ON CONFLICT(media_id) DO UPDATE SET '
         'mtime=excluded.mtime, done_at=excluded.done_at, next_at=excluded.next_at, tries=excluded.tries, info=excluded.info',
         (f['id'], f['mtime'], db.now(), (db.now() + RETRY) if left and tries < MAX_TRIES else None, tries, json.dumps(info)))
    return not left


def _run(f, front):
    mid = f['id']
    t = _busy.get(mid)
    if t and not t.done():
        return t

    async def go():
        try:
            await process(f, front)
        except Exception as e:
            log.warning('subs %d: %s', mid, str(e)[:150])
        finally:
            _busy.pop(mid, None)
    t = _busy[mid] = asyncio.ensure_future(go())
    return t


def pending(mid):
    t = _busy.get(mid)
    return bool(t and not t.done())


def want(f):
    """Called when a file is opened in the player: do it now (not behind the queue). True while work is running."""
    schema()
    st = db.q1('SELECT * FROM sub_state WHERE media_id=?', (f['id'],))
    if st and st['mtime'] == f['mtime'] and (st['next_at'] is None or st['next_at'] > db.now()):
        return pending(f['id'])
    _run(f, True)
    return True


async def job():
    """Newest files first; a few per run; waits while someone is watching (reading a whole file over SMB costs bandwidth)."""
    from . import play
    schema()
    t0 = time.time()
    rows = db.q('SELECT m.* FROM media_file m LEFT JOIN sub_state s ON s.media_id=m.id WHERE m.missing=0 AND m.imdb IS NOT NULL AND '
                '(s.media_id IS NULL OR s.mtime IS NOT m.mtime OR (s.next_at IS NOT NULL AND s.next_at <= ?)) '
                'ORDER BY (s.media_id IS NULL) DESC, m.added_at DESC LIMIT 40', (db.now(),))
    for f in rows:
        if play.busy() or time.time() - t0 > 1200:
            break
        await _run(f, False)
        await asyncio.sleep(2)


def ours(path):
    """A sidecar written by DDflix: <video name>.ro.srt / .en.srt next to the video."""
    m = re.search(r'\.(ro|en)\.srt$', path)
    return bool(m) and any(os.path.exists(path[:m.start()] + ext) for ext in library.VIDEO_EXT)


def key_of(path):
    return 'e' + hashlib.md5(os.path.basename(path).encode('utf-8', 'replace')).hexdigest()[:8]
