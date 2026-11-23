"""Playback: playable lists, media info, play decision (direct / HLS remux / HLS transcode), files, subtitles, progress."""
import asyncio
import json
import logging
import math
import os
import re
import secrets
import time

from aiohttp import web

from . import catalog, config, db, library, markers
from .util import body, jerr, jok

log = logging.getLogger('play')
LANG = {'rum': 'Română', 'ron': 'Română', 'ro': 'Română', 'eng': 'English', 'en': 'English', 'fre': 'Français', 'fra': 'Français',
        'ger': 'Deutsch', 'deu': 'Deutsch', 'spa': 'Español', 'ita': 'Italiano', 'hun': 'Magyar', 'und': 'Necunoscut', '': 'Necunoscut'}
TEXT_SUBS = {'subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'}
TV_AUDIO = {'aac', 'ac3', 'eac3', 'mp3', 'mp2', 'opus', 'vorbis', 'flac'}
CT = {'.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
      '.ts': 'video/mp2t', '.mov': 'video/quicktime'}
SESS = {}
ACTIVE = {'at': 0}  # last time a video byte / segment was served (background jobs pause while someone watches)


def busy():
    return time.time() - ACTIVE['at'] < 180
TRANSCODES = asyncio.Semaphore(config.MAX_TRANSCODES)
SEG_T = 4.0  # transcode segment length


def lang3(l):
    l = (l or '').lower()
    return {'ro': 'rum', 'ron': 'rum', 'en': 'eng', 'fr': 'fre', 'de': 'ger', 'es': 'spa', 'it': 'ita', 'hu': 'hun'}.get(l, l)


def streams(f, kind):
    return [s for s in (db.jl(f['probe'], {}) or {}).get('streams', []) if s.get('codec_type') == kind]


def media_file(mid):
    return db.q1('SELECT * FROM media_file WHERE id=? AND missing=0', (mid,))


def prog_of(pid, mid):
    return db.q1('SELECT * FROM progress WHERE profile_id=? AND media_id=?', (pid, mid)) if pid else None


def fmt_min(s):
    return '%d min' % max(1, round(s / 60))


def media_out(f, pr):
    pos = pr['position'] if pr else 0.0
    watched = bool(pr and pr['watched'])
    dur = f['duration'] or 0
    w = f['width'] or 0
    lbl = ('S%d E%d · ' % (f['season'], f['episode']) if f['season'] is not None else '') + \
          ('%d din %d min' % (pos // 60, max(1, dur // 60)) if pos > 30 and not watched else fmt_min(dur))
    return {'id': f['id'], 'season': f['season'], 'episode': f['episode'], 'duration': dur, 'res': '4K' if w >= 3000 else '%dp' % (f['height'] or 0),
            'hdr': f['hdr'], 'vcodec': f['vcodec'], 'size': f['size'], 'file': os.path.basename(f['path']), 'position': pos, 'watched': watched,
            'progressLabel': lbl, 'timeLeft': ('%s rămase' % fmt_min(dur - pos)) if pos > 30 and dur else '', 'pct': round(pos / dur, 3) if dur else 0}


def best_files(imdb, pid):
    """One file per episode (highest resolution unless another copy was started)."""
    by = {}
    for f in db.q('SELECT * FROM media_file WHERE imdb=? AND missing=0', (imdb,)):
        k = (f['season'], f['episode']) if f['season'] is not None else ('m', f['id'] if False else 0)
        by.setdefault(k, []).append(f)
    out = []
    for k, fs in by.items():
        started = [f for f in fs if (prog_of(pid, f['id']) or {'position': 0})['position'] > 30]
        out.append((started or sorted(fs, key=lambda f: -(f['width'] or 0)))[0])
    out.sort(key=lambda f: (f['season'] or 0, f['episode'] or 0))
    return out


def next_up(files, pid):
    if not files:
        return None
    prs = {f['id']: prog_of(pid, f['id']) for f in files}
    started = [f for f in files if prs[f['id']] and prs[f['id']]['position'] > 30 and not prs[f['id']]['watched']]
    if started:
        f = max(started, key=lambda f: prs[f['id']]['updated_at'] or 0)
    else:
        last = -1
        for i, f in enumerate(files):
            if prs[f['id']] and prs[f['id']]['watched']:
                last = i
        f = files[last + 1] if last + 1 < len(files) else None
        if f is None:
            return None
    m = media_out(f, prs[f['id']])
    verb = 'Reia' if prs[f['id']] and prs[f['id']]['position'] > 30 else 'Redă'
    m['action'] = verb + (' S%d E%d' % (f['season'], f['episode']) if f['season'] is not None else '')
    return m


def allowed_imdb(request, imdb):
    t = db.q1('SELECT * FROM title WHERE imdb=?', (imdb,))
    return bool(t) and catalog.allowed(request['profile'], t)


async def playable(request):
    imdb = request.match_info['imdb']
    if not allowed_imdb(request, imdb):
        return jerr(404, 'title not found')
    pid = request['profile']['id'] if request['profile'] else None
    fs = best_files(imdb, pid)
    return jok({'files': [media_out(f, prog_of(pid, f['id'])) for f in fs], 'next': next_up(fs, pid)})


def audio_list(f):
    out = []
    for n, s in enumerate(streams(f, 'audio')):
        tags = s.get('tags') or {}
        lang = lang3(tags.get('language'))
        ch = s.get('channels') or 2
        chs = {1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1'}.get(ch, str(ch))
        label = '%s · %s %s' % (tags.get('title') or LANG.get(lang, lang.upper() or 'Audio'), (s.get('codec_name') or '').upper(), chs)
        out.append({'n': n, 'lang': lang or 'und', 'label': label, 'default': bool((s.get('disposition') or {}).get('default')),
                    'codec': s.get('codec_name')})
    if out and not any(a['default'] for a in out):
        out[0]['default'] = True
    return out


def sub_list(f):
    out = []
    for s in streams(f, 'subtitle'):
        tags = s.get('tags') or {}
        disp = s.get('disposition') or {}
        title = (tags.get('title') or '')
        lang = lang3(tags.get('language')) or 'und'
        text = s.get('codec_name') in TEXT_SUBS
        if not text:
            continue  # image subs (PGS/VobSub) cannot be shown by the TV overlay
        out.append({'key': 'i%d' % s['index'], 'lang': lang, 'forced': bool(disp.get('forced')) or 'forced' in title.lower(),
                    'sdh': bool(disp.get('hearing_impaired')) or 'sdh' in title.lower(), 'text': True,
                    'label': LANG.get(lang, lang.upper()) + (' · ' + title if title else ''), 'src': 'embedded', 'group': 'main'})
    from . import subs
    seen = {}
    for p in db.jl(f['ext_subs'], []) or []:
        n = os.path.basename(p).lower()
        lang = ext_lang(p)
        lbl = LANG.get(lang, lang.upper()) + (' · SDH' if 'sdh' in n else '') + (' · forțată' if 'forced' in n else '')
        seen[lbl] = seen.get(lbl, 0) + 1
        out.append({'key': subs.key_of(p), 'lang': lang, 'forced': 'forced' in n, 'sdh': 'sdh' in n, 'text': True,
                    'label': lbl + (' (%d)' % seen[lbl] if seen[lbl] > 1 else ''), 'src': 'external', 'group': 'main'})
    # Netflix order: Romanian, English, then the rest; plain before SDH / forced
    rank = {'rum': 0, 'eng': 1}
    out.sort(key=lambda s: (rank.get(s['lang'], 2), s['forced'], s['sdh']))
    return out


def ext_lang(p):
    n = os.path.basename(p).lower()
    parts = n.rsplit('.', 1)[0].replace('_', '.').replace(' ', '.').replace('-', '.').split('.')
    codes = {'ro': 'rum', 'rum': 'rum', 'ron': 'rum', 'romanian': 'rum', 'en': 'eng', 'eng': 'eng', 'english': 'eng',
             'fr': 'fre', 'fre': 'fre', 'hu': 'hun', 'hun': 'hun'}
    for t in reversed(parts[-3:]):
        if t in codes:
            return codes[t]
    m = re.search(r'[._ -](ro|rum|ron|romanian|en|eng|english|fr|fre|hu|hun)[._ -]', '.' + n.rsplit('.', 1)[0] + '.')
    return codes.get(m.group(1), m.group(1)) if m else ('rum' if 'rom' in n else 'und')


async def media(request):
    f = media_file(int(request.match_info['mid']))
    if not f or not allowed_imdb(request, f['imdb']):
        return jerr(404, 'media not found')
    p = request['profile']
    pid = p['id'] if p else None
    pr = prog_of(pid, f['id'])
    t = db.q1('SELECT * FROM title WHERE imdb=?', (f['imdb'],))
    prefs = catalog_prefs(p)
    au, su = audio_list(f), sub_list(f)
    da = next((a['n'] for a in au if a['default']), 0)
    if pr and pr['audio_n'] is not None and pr['audio_n'] < len(au):
        da = pr['audio_n']
    ds = None
    if pr and pr['sub_key'] is not None and (pr['sub_key'] == '' or any(s['key'] == pr['sub_key'] for s in su)):
        ds = pr['sub_key'] or None
    else:
        ds = pref_sub(prefs, su, au, da)
    from . import subs
    sp = subs.want(f)
    out = media_out(f, pr)
    ep_name = None
    if f['season'] is not None and t:
        for v in db.jl(t['videos'], []) or []:
            if v['s'] == f['season'] and v['e'] == f['episode']:
                ep_name = v['name']
    fs = best_files(f['imdb'], pid)
    nxt = None
    for i, x in enumerate(fs):
        if x['id'] == f['id'] and i + 1 < len(fs) and f['season'] is not None:
            nxt = media_out(fs[i + 1], prog_of(pid, fs[i + 1]['id']))
            nxt['name'] = '%s S%d E%d' % (t['name'] if t else '', fs[i + 1]['season'], fs[i + 1]['episode'])
            subs.want(fs[i + 1])
    rt = db.q1('SELECT value FROM rating WHERE profile_id=? AND imdb=?', (pid, f['imdb'])) if pid else None
    out.update({'imdb': f['imdb'], 'title': t['name'] if t else '', 'episodeName': ep_name, 'audio': au, 'subs': su, 'defaultAudio': da,
                'defaultSub': ds, 'subStyle': prefs.get('subStyle'), 'nextMedia': nxt, 'profile': pid, 'markers': markers.markers_out(f['id']), 'trickplay': markers.trick_out(f['id']),
                'rating': rt['value'] if rt else 0, 'resolution': '%dp' % (f['height'] or 0), 'subsPending': sp,
                'prefSub': pref_sub(prefs, su, au, da)})
    return jok(out)


def pref_sub(prefs, su, au, da):
    """The subtitle the profile's language order picks (none when the audio is already in that language)."""
    for lang in prefs.get('subs') or []:
        c = [s for s in su if s['lang'] == lang3(lang) and not s['forced']]
        if c:
            if not any(a['n'] == da and a['lang'] == lang3(lang) for a in au):
                return c[0]['key']
            return None
    return None


def catalog_prefs(p):
    prefs = db.jl(p['prefs'], {}) if p else {}
    prefs = prefs or {}
    prefs.setdefault('subs', ['rum', 'eng'])
    prefs.setdefault('subStyle', {'size': 'm', 'color': 'white', 'bg': 'shadow'})
    return prefs


# ---------------- play decision
def plan(f, b):
    caps = b.get('caps') or {}
    au = streams(f, 'audio')
    n = int(b.get('audio') or 0)
    if n >= len(au):
        n = 0
    acodec = (au[n].get('codec_name') if au else '') or ''
    default_n = next((i for i, s in enumerate(au) if (s.get('disposition') or {}).get('default')), 0)
    ext = os.path.splitext(f['path'])[1].lower()
    v = (f['vcodec'] or '').lower()
    reasons = []
    quality = str(b.get('quality') or 'auto')
    if b.get('forceHls'):
        reasons.append('forceHls')
    if ext not in ('.mp4', '.m4v', '.mkv', '.webm') or (ext == '.mkv' and not caps.get('mkv')):
        reasons.append('container ' + ext)
    if v == 'hevc' and not caps.get('hevc'):
        reasons.append('hevc not supported')
    if v not in ('h264', 'hevc', 'vp9', 'av1'):
        reasons.append('video ' + v)
    if f['hdr'] and not caps.get('hdr'):
        reasons.append('hdr not supported')
    if acodec not in TV_AUDIO or (acodec in ('ac3',) and not caps.get('ac3')) or (acodec == 'eac3' and not caps.get('eac3')):
        reasons.append('audio ' + acodec)
    if au and n != default_n:
        reasons.append('non-default audio')
    if quality in ('1080', '720', '480') and (f['height'] or 0) > int(quality) + 100:
        reasons.append('quality ' + quality)
    if not reasons:
        return {'mode': 'direct', 'video': 'copy', 'audio': 'copy', 'height': f['height'], 'audio_n': n, 'reasons': []}
    copy_ok = v in ('h264', 'hevc') and (v != 'hevc' or caps.get('hevc')) and not (f['hdr'] and not caps.get('hdr')) \
        and not any(r.startswith('quality') for r in reasons)
    if copy_ok:
        return {'mode': 'remux', 'video': 'copy', 'audio': 'aac', 'height': f['height'], 'audio_n': n, 'reasons': reasons}
    h = int(quality) if quality in ('1080', '720', '480') else 1080
    return {'mode': 'transcode', 'video': 'h264', 'audio': 'aac', 'height': min(h, f['height'] or h), 'audio_n': n,
            'tonemap': bool(f['hdr']), 'vbitrate': {1080: 8000, 720: 4000, 480: 1800}.get(h, 8000), 'reasons': reasons}


WEB = {}


class WebSess:
    """Browser/phone playback: one ffmpeg, video copied (hvc1 tag for HEVC), audio AAC, fMP4 HLS event playlist from `start`.
    Seeking = a new session at the new position (the web player handles it). No video re-encoding (HA Green CPU)."""

    def __init__(self, sid, f, start, audio_n):
        self.sid, self.f, self.start, self.audio_n = sid, f, start, audio_n
        self.dir = os.path.join(config.DATA_DIR, 'web', sid)
        self.proc = None
        self.last = time.time()

    async def run(self):
        os.makedirs(self.dir, exist_ok=True)
        v = self.f['vcodec']
        args = ['nice', '-n', '5', 'ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', '%.3f' % self.start, '-i', self.f['path'],
                '-map', '0:v:0', '-map', '0:a:%d?' % self.audio_n, '-sn', '-dn', '-c:v', 'copy']
        if v == 'hevc':
            args += ['-tag:v', 'hvc1']
        args += ['-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-f', 'hls', '-hls_time', '6', '-hls_list_size', '0',
                 '-hls_playlist_type', 'event', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
                 '-hls_segment_filename', os.path.join(self.dir, 's%05d.m4s'), os.path.join(self.dir, 'index.m3u8')]
        self.proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)

    def kill(self):
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.kill()
            except ProcessLookupError:
                pass
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)


def web_gc():
    for k, w in list(WEB.items()):
        if time.time() - w.last > 120:
            w.kill()
            WEB.pop(k, None)


async def web_file(request):
    ACTIVE['at'] = time.time()
    w = WEB.get(request.match_info['sid'])
    fn = request.match_info['file']
    if not w or '/' in fn or '..' in fn:
        return jerr(404, 'session gone')
    w.last = time.time()
    p = os.path.join(w.dir, fn)
    t0 = time.time()
    while not os.path.exists(p) or (fn == 'index.m3u8' and '#EXTINF' not in open(p, errors='ignore').read()):
        if time.time() - t0 > 25 or (w.proc and w.proc.returncode not in (None, 0)):
            return jerr(504, 'stream starting')
        await asyncio.sleep(0.2)
    ct = 'application/vnd.apple.mpegurl' if fn.endswith('.m3u8') else 'video/mp4' if fn.endswith('.mp4') else 'video/iso.segment'
    with open(p, 'rb') as fh:
        data = fh.read()
    return web.Response(body=data, headers={'Content-Type': ct, 'Cache-Control': 'no-store' if fn.endswith('.m3u8') else 'private, max-age=3600'})


async def play(request):
    b = await body(request)
    f = media_file(int(b.get('mediaId') or 0))
    if not f or not allowed_imdb(request, f['imdb']):
        return jerr(404, 'media not found')
    start = float(b.get('start') or 0)
    if b.get('web'):
        old = b.get('replace')
        if old and old in WEB:
            WEB.pop(old).kill()
        web_gc()
        au = streams(f, 'audio')
        n = int(b.get('audio') or 0)
        ext = os.path.splitext(f['path'])[1].lower()
        acodec = (au[n].get('codec_name') if n < len(au) else '') or ''
        if ext in ('.mp4', '.m4v') and f['vcodec'] == 'h264' and acodec in ('aac', 'mp3') and n == 0:
            return jok({'mode': 'direct', 'url': '/api/media/%d/file' % f['id'], 'offset': 0, 'start': start, 'duration': f['duration']})
        if f['vcodec'] not in ('h264', 'hevc'):
            return jerr(415, 'Formatul video nu se poate reda în browser')
        sid = secrets.token_hex(16)
        w = WEB[sid] = WebSess(sid, f, start, n if n < len(au) else 0)
        await w.run()
        return jok({'mode': 'remux', 'sid': sid, 'url': '/w/%s/index.m3u8' % sid, 'offset': start, 'start': start,
                    'duration': f['duration'], 'hevc': f['vcodec'] == 'hevc'})
    old = b.get('replace')
    if old:
        drop_session(old)
    pl = plan(f, b)
    dur = f['duration'] or 0
    if pl['mode'] == 'direct':
        return jok({'mode': 'direct', 'url': '/api/media/%d/file' % f['id'], 'start': start, 'offset': 0, 'duration': dur, 'plan': pl})
    if pl['mode'] == 'remux':
        segs = db.jl(f['kf'], None)
        if not segs:
            asyncio.ensure_future(library.ensure_kf(f['id']))
            # no keyframe index yet: quick 1080p transcode this time (indexing runs in the background)
            pl = {'mode': 'transcode', 'video': 'h264', 'audio': 'aac', 'height': min(1080, f['height'] or 1080), 'audio_n': pl['audio_n'],
                  'tonemap': bool(f['hdr']), 'vbitrate': 8000, 'reasons': pl['reasons'] + ['no keyframe index yet']}
    if pl['mode'] == 'transcode':
        if TRANSCODES.locked() and len([s for s in SESS.values() if s['plan']['mode'] == 'transcode' and time.time() - s['last'] < 60]) >= config.MAX_TRANSCODES:
            return jerr(429, 'Prea multe conversii simultan, încearcă peste puțin timp', busy=True)
        n = max(1, int(math.ceil(dur / SEG_T)))
        segs = [(i * SEG_T, min(dur, (i + 1) * SEG_T)) for i in range(n)]
    sid = secrets.token_hex(16)
    SESS[sid] = {'mid': f['id'], 'path': f['path'], 'plan': pl, 'segs': segs, 'last': time.time(), 'dur': dur}
    gc_sessions()
    return jok({'mode': pl['mode'], 'sid': sid, 'url': '/s/%s/master.m3u8' % sid, 'offset': 0, 'vod': True, 'start': start,
                'duration': dur, 'plan': pl, 'ttfs': 1.0})


def drop_session(sid):
    s = SESS.pop(sid, None)
    if s and s.get('rx'):
        s['rx'].kill()


def gc_sessions():
    t = time.time()
    for k, s in list(SESS.items()):
        if t - s['last'] > 4 * 3600 or (s.get('rx') and t - s['last'] > 180):
            drop_session(k) if t - s['last'] > 4 * 3600 else s['rx'].kill()


async def gc_job():
    gc_sessions()
    web_gc()


async def play_ping(request):
    s = SESS.get(request.match_info['sid'])
    if not s:
        return jerr(410, 'gone', alive=False)
    s['last'] = time.time()
    return jok({'alive': True, 'until': s['dur']})


async def play_stop(request):
    drop_session(request.match_info['sid'])
    return jok({'ok': True})


async def play_event(request):
    b = await body(request)
    db.x('INSERT INTO play_event(at, media_id, kind, mode, detail) VALUES(?,?,?,?,?)',
         (db.now(), b.get('mediaId'), str(b.get('kind'))[:20], str(b.get('mode'))[:20], json.dumps(b.get('detail'))[:2000]))
    db.x('DELETE FROM play_event WHERE at<?', (db.now() - 30 * 86400,))
    return jok({'ok': True})


# ---------------- HLS
def text_resp(request, txt, ct):
    data = txt.encode()
    rng = request.headers.get('Range')
    hdr = {'Content-Type': ct, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes'}
    m = re.match(r'bytes=(\d*)-(\d*)', rng or '')
    if m and (m.group(1) or m.group(2)):
        a = int(m.group(1) or 0)
        e = min(int(m.group(2)) if m.group(2) else len(data) - 1, len(data) - 1)
        hdr['Content-Range'] = 'bytes %d-%d/%d' % (a, e, len(data))
        return web.Response(status=206, body=data[a:e + 1], headers=hdr)
    return web.Response(body=data, headers=hdr)


async def hls(request):
    ACTIVE['at'] = time.time()
    sid, fn = request.match_info['sid'], request.match_info['file']
    s = SESS.get(sid)
    if not s:
        return jerr(404, 'session gone')
    s['last'] = time.time()
    pl = s['plan']
    if fn == 'master.m3u8':
        h = pl.get('height') or 1080
        w = int(h * 16 / 9)
        bw = (pl.get('vbitrate') or 20000) * 1000 + 192000
        vc = 'hvc1.2.4.L150.B0' if pl['video'] == 'copy' and (media_file(s['mid']) or {'vcodec': ''})['vcodec'] == 'hevc' else 'avc1.640029'
        txt = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d,CODECS="%s,mp4a.40.2"\nindex.m3u8\n' % (bw, w, h, vc)
        return text_resp(request, txt, 'application/vnd.apple.mpegurl')
    if fn == 'index.m3u8':
        segs = s['segs']
        td = int(math.ceil(max([b - a for a, b in segs] or [SEG_T])))
        lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:%d' % td, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD']
        for i, (a, b) in enumerate(segs):
            lines.append('#EXTINF:%.3f,' % (b - a))
            lines.append('seg%05d.ts' % i)
        lines.append('#EXT-X-ENDLIST')
        return text_resp(request, '\n'.join(lines) + '\n', 'application/vnd.apple.mpegurl')
    m = re.match(r'^seg(\d{5})\.ts$', fn)
    if not m or int(m.group(1)) >= len(s['segs']):
        return jerr(404, 'no such segment')
    i = int(m.group(1))
    if pl['video'] == 'copy':
        rx = s.get('rx')
        if not rx:
            rx = s['rx'] = Remux(sid, s)
        p = await rx.get(i)
        if not p:
            return jerr(503, 'segment not ready')
        with open(p, 'rb') as fh:
            data = fh.read()
        return web.Response(body=data, headers={'Content-Type': 'video/mp2t', 'Cache-Control': 'private, max-age=3600'})
    a, b = s['segs'][i]
    args = ['ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', '%.3f' % a, '-i', s['path'], '-t', '%.3f' % (b - a),
            '-map', '0:v:0', '-map', '0:a:%d?' % pl.get('audio_n', 0), '-sn', '-dn']
    if pl['video'] == 'copy':
        v = (media_file(s['mid']) or {'vcodec': 'h264'})['vcodec']
        args += ['-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb' if v == 'hevc' else 'h264_mp4toannexb']
    else:
        h = pl.get('height') or 1080
        vf = 'scale=-2:%d' % h
        if pl.get('tonemap'):
            vf = ('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,'
                  'zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=-2:%d' % h)
        else:
            vf += ',format=yuv420p'
        vb = pl.get('vbitrate') or 8000
        args += ['-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level', '4.1', '-crf', '21',
                 '-maxrate', '%dk' % vb, '-bufsize', '%dk' % (vb * 2), '-g', '250', '-force_key_frames', 'expr:eq(n,0)', '-sc_threshold', '0']
    args += ['-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-ar', '48000', '-output_ts_offset', '%.3f' % a, '-muxdelay', '0', '-muxpreload', '0',
             '-f', 'mpegts', 'pipe:1']
    sem = TRANSCODES if pl['video'] != 'copy' else None
    if sem:
        await sem.acquire()
    try:
        rc, out, err = await library.run(['nice', '-n', '5'] + args, timeout=120)
    finally:
        if sem:
            sem.release()
    if rc != 0 or not out:
        log.warning('segment %s %d failed: %s', sid[:6], i, config.mask(err.decode(errors='ignore'))[-300:])
        return jerr(500, 'segment failed')
    return web.Response(body=out, headers={'Content-Type': 'video/mp2t', 'Cache-Control': 'private, max-age=3600'})


class Remux:
    """One ffmpeg per session: video copy + AAC, cut by the segment muxer exactly at the indexed keyframes.
    Timestamps stay original (-copyts), segments are identified by their start time (segment_list csv),
    the process is paused when it runs too far ahead and restarted on seeks."""
    AHEAD = 8

    def __init__(self, sid, s):
        self.sid, self.s = sid, s
        self.proc = None
        self.dir = None
        self.run = 0
        self.start_i = -1
        self.paused = False
        self.starts = [a for a, _ in s['segs']]

    def _index(self, t):
        # segment whose start is closest to t
        lo, hi = 0, len(self.starts) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.starts[mid] < t:
                lo = mid + 1
            else:
                hi = mid
        best = lo
        if lo > 0 and abs(self.starts[lo - 1] - t) < abs(self.starts[lo] - t):
            best = lo - 1
        return best if abs(self.starts[best] - t) < 0.6 else None

    def done(self):
        """index -> file path for completed segments of the current run."""
        out = {}
        if not self.dir:
            return out
        try:
            with open(os.path.join(self.dir, 'list.csv')) as f:
                for line in f:
                    a = line.strip().split(',')
                    if len(a) >= 2:
                        try:
                            i = self._index(float(a[1]))
                        except ValueError:
                            continue
                        fp = os.path.join(self.dir, a[0])
                        if i is not None and i >= self.start_i and os.path.exists(fp):
                            out[i] = fp
        except OSError:
            pass
        return out

    def kill(self):
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.send_signal(18)  # SIGCONT so it can exit
                self.proc.kill()
            except ProcessLookupError:
                pass
        self.proc = None
        if self.dir:
            import shutil
            shutil.rmtree(self.dir, ignore_errors=True)
            self.dir = None

    async def start(self, i):
        self.kill()
        self.run += 1
        base = os.path.join(config.DATA_DIR, 'stream')
        self.dir = os.path.join(base, '%s_%d' % (self.sid, self.run))
        os.makedirs(self.dir, exist_ok=True)
        self.start_i = i
        pl = self.s['plan']
        f = media_file(self.s['mid'])
        bsf = 'hevc_mp4toannexb' if f and f['vcodec'] == 'hevc' else 'h264_mp4toannexb'
        times = ','.join('%.3f' % t for t in self.starts[i:] if t > 0) or '999999'
        args = ['nice', '-n', '5', 'ffmpeg', '-nostdin', '-loglevel', 'error', '-copyts', '-ss', '%.3f' % self.starts[i], '-i', self.s['path'],
                '-map', '0:v:0', '-map', '0:a:%d?' % pl.get('audio_n', 0), '-sn', '-dn', '-c:v', 'copy', '-bsf:v', bsf,
                '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-ar', '48000', '-muxdelay', '0', '-muxpreload', '0',
                '-f', 'segment', '-segment_format', 'mpegts', '-segment_times', times, '-reset_timestamps', '0',
                '-segment_list', os.path.join(self.dir, 'list.csv'), '-segment_list_type', 'csv',
                os.path.join(self.dir, 's%05d.ts')]
        self.proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        self.paused = False

    def _pace(self, i, done):
        if not self.proc or self.proc.returncode is not None:
            return
        ahead = max(done) - i if done else 0
        try:
            if ahead > self.AHEAD and not self.paused:
                self.proc.send_signal(19)  # SIGSTOP
                self.paused = True
            elif ahead <= self.AHEAD // 2 and self.paused:
                self.proc.send_signal(18)  # SIGCONT
                self.paused = False
        except ProcessLookupError:
            pass
        # free disk: drop segments well behind the player
        for k, p in done.items():
            if k < i - 4:
                try:
                    os.remove(p)
                except OSError:
                    pass

    async def get(self, i):
        done = self.done()
        running = self.proc is not None and self.proc.returncode is None
        if i not in done:
            near = running and self.start_i <= i <= (max(done) if done else self.start_i) + 3
            if not near:
                await self.start(i)
        t0 = time.time()
        while time.time() - t0 < 40:
            done = self.done()
            self._pace(i, done)
            if i in done and os.path.exists(done[i]):
                return done[i]
            if self.proc is None or self.proc.returncode is not None:
                # finished: the last segment is not listed until exit; check once more
                done = self.done()
                if i in done:
                    return done[i]
                if self.proc and self.proc.returncode not in (0, None):
                    err = (await self.proc.stderr.read()).decode(errors='ignore')
                    log.warning('remux %s failed: %s', self.sid[:6], config.mask(err)[-300:])
                return None
            if self.paused:
                try:
                    self.proc.send_signal(18)
                    self.paused = False
                except ProcessLookupError:
                    pass
            await asyncio.sleep(0.15)
        return None


async def media_file_resp(request):
    ACTIVE['at'] = time.time()
    f = media_file(int(request.match_info['mid']))
    if not f or not allowed_imdb(request, f['imdb']):
        return jerr(404, 'media not found')
    ct = CT.get(os.path.splitext(f['path'])[1].lower(), 'application/octet-stream')
    return web.FileResponse(f['path'], headers={'Content-Type': ct, 'Cache-Control': 'private, max-age=3600'})


# ---------------- subtitles
SUB_PENDING = set()


def srt_to_vtt(t):
    t = t.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff')
    t = re.sub(r'(\d\d:\d\d:\d\d),(\d\d\d)', r'\1.\2', t)
    return 'WEBVTT\n\n' + t if not t.startswith('WEBVTT') else t


def read_text(p):
    raw = open(p, 'rb').read()
    for enc in ('utf-8', 'cp1250', 'iso-8859-2', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


async def extract(f, src, out, map_idx=None):
    args = ['nice', '-n', '10', 'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', src]
    if map_idx is not None:
        args += ['-map', '0:%d' % map_idx]
    args += ['-f', 'webvtt', out + '.tmp']
    try:
        rc, _, _ = await library.run(args, timeout=900)
        if rc == 0:
            os.replace(out + '.tmp', out)
    finally:
        SUB_PENDING.discard(out)


async def sub(request):
    f = media_file(int(request.match_info['mid']))
    if not f or not allowed_imdb(request, f['imdb']):
        return jerr(404, 'media not found')
    key = request.match_info['key']
    hdr = {'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, max-age=600'}
    d = os.path.join(config.DATA_DIR, 'subs')
    os.makedirs(d, exist_ok=True)
    if key.startswith(('x', 'e')):
        from . import subs
        ex = db.jl(f['ext_subs'], []) or []
        if key.startswith('x'):
            i = int(key[1:]) if key[1:].isdigit() else -1
            p = ex[i] if 0 <= i < len(ex) else None
        else:
            p = next((x for x in ex if subs.key_of(x) == key), None)
        if not p or not os.path.exists(p):
            return jerr(404, 'no such subtitle')
        if p.lower().endswith(('.srt', '.vtt')):
            return web.Response(text=srt_to_vtt(read_text(p)), headers=hdr)
        out = os.path.join(d, '%d_%s.vtt' % (f['id'], key))
        src = p
        idx = None
    elif key.startswith('i') and key[1:].isdigit():
        out = os.path.join(d, '%d_%s.vtt' % (f['id'], key))
        src, idx = f['path'], int(key[1:])
    else:
        return jerr(404, 'no such subtitle')
    if os.path.exists(out) and os.path.getmtime(out) >= (f['mtime'] or 0):
        with open(out, encoding='utf-8', errors='replace') as fh:
            return web.Response(text=fh.read(), headers=hdr)
    if out not in SUB_PENDING:
        SUB_PENDING.add(out)
        asyncio.ensure_future(extract(f, src, out, idx))
    hdr.update({'Retry-After': '10', 'X-Subs-Pending': '1', 'Cache-Control': 'no-store'})
    return web.Response(text='WEBVTT\n\n', headers=hdr)


# ---------------- watch state
async def progress(request):
    b = await body(request)
    p = request['profile']
    f = media_file(int(b.get('mediaId') or 0))
    if not p or not f:
        return jerr(404, 'media not found')
    pos = float(b.get('position') or 0)
    dur = float(b.get('duration') or f['duration'] or 0)
    watched = bool(b.get('watched') or b.get('credits') or (dur and pos >= 0.9 * dur))
    old = prog_of(p['id'], f['id'])
    if pos < 30 and not b.get('watched'):
        watched = False
    sub_key = old['sub_key'] if old else None
    if 'sub' in b and b.get('subManual'):
        sub_key = b['sub'] or ''
    audio_n = b.get('audio') if b.get('audio') is not None else (old['audio_n'] if old else None)
    db.x('INSERT INTO progress(profile_id, media_id, position, duration, watched, audio_n, sub_key, updated_at) VALUES(?,?,?,?,?,?,?,?) '
         'ON CONFLICT(profile_id, media_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, '
         'audio_n=excluded.audio_n, sub_key=excluded.sub_key, updated_at=excluded.updated_at',
         (p['id'], f['id'], pos, dur, int(watched), audio_n, sub_key, db.now()))
    return jok({'ok': True, 'watched': watched})


async def watched(request):
    b = await body(request)
    p = request['profile']
    w = b.get('watched', True) is not False
    if b.get('mediaId'):
        fs = [media_file(int(b['mediaId']))]
    else:
        sql, args = 'SELECT * FROM media_file WHERE imdb=? AND missing=0', [b.get('imdb')]
        if b.get('season') is not None:
            sql += ' AND season=?'
            args.append(int(b['season']))
        fs = db.q(sql, args)
    n = 0
    for f in fs:
        if not f:
            continue
        db.x('INSERT INTO progress(profile_id, media_id, position, duration, watched, updated_at) VALUES(?,?,?,?,?,?) '
             'ON CONFLICT(profile_id, media_id) DO UPDATE SET watched=excluded.watched, position=excluded.position, updated_at=excluded.updated_at',
             (p['id'], f['id'], 0, f['duration'], int(w), db.now()))
        n += 1
    return jok({'ok': True, 'n': n})


async def cont(request):
    p = request['profile']
    if not p:
        return jok({'items': []})
    rows = db.q('SELECT m.imdb, MAX(pr.updated_at) u FROM progress pr JOIN media_file m ON m.id=pr.media_id '
                'WHERE pr.profile_id=? AND m.missing=0 GROUP BY m.imdb ORDER BY u DESC LIMIT 20', (p['id'],))
    agg = catalog.library_titles()
    items = []
    for r in rows:
        t = db.q1('SELECT * FROM title WHERE imdb=?', (r['imdb'],))
        if not t or not catalog.allowed(p, t):
            continue
        fs = best_files(r['imdb'], p['id'])
        nx = next_up(fs, p['id'])
        if not nx:
            continue
        if t['type'] == 'movie' and nx['position'] <= 30:
            continue
        if nx['position'] <= 30 and nx['season'] is not None:
            nx['progressLabel'] = 'Urmează: S%d E%d' % (nx['season'], nx['episode'])
        c = catalog.card(t, agg.get(r['imdb']))
        c['play'] = nx
        items.append(c)
    return jok({'items': items})


def routes(app):
    r = app.router
    r.add_get('/api/playable/{imdb}', playable)
    r.add_get('/api/media/{mid:\\d+}', media)
    r.add_get('/api/media/{mid:\\d+}/file', media_file_resp)
    r.add_get('/api/media/{mid:\\d+}/sub/{key}.vtt', sub)
    r.add_post('/api/play', play)
    r.add_post('/api/play/event', play_event)
    r.add_post('/api/play/{sid:[0-9a-f]{32}}/ping', play_ping)
    r.add_post('/api/play/{sid:[0-9a-f]{32}}/stop', play_stop)
    r.add_delete('/api/play/{sid:[0-9a-f]{32}}', play_stop)
    r.add_get('/s/{sid:[0-9a-f]{32}}/{file}', hls)
    r.add_get('/w/{sid:[0-9a-f]{32}}/{file}', web_file)
    r.add_post('/api/progress', progress)
    r.add_post('/api/watched', watched)
    r.add_get('/api/continue', cont)
