"""FileList RSS -> qBittorrent. The feed URL (with passkey) comes only from .env and is never logged.

Rules for an item in the feed:
  RSS_MODE=follow : download only if the title matches a followed show (web admin -> "Seriale urmărite")
  RSS_MODE=all    : download everything in the feed (build the feed on FileList with only the categories you want)
  RSS_INCLUDE / RSS_EXCLUDE regexes and RSS_MAX_GB apply in both modes.
  The same episode (show + SxxEyy) is never downloaded twice. First run only marks what is already in the feed
  (unless RSS_BACKFILL=1). Torrents are never removed: they keep seeding (ratio matters on a private tracker).
"""
import logging
import re
import xml.etree.ElementTree as ET

import aiohttp

from . import config, db, library

log = logging.getLogger('rss')
STATUS = {'lastRun': None, 'lastError': None, 'items': 0, 'added': 0, 'qbt': None}
UA = {'User-Agent': 'Mozilla/5.0 DDflix/1.0'}


def size_of(item_text):
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(GB|MB|TB|GiB|MiB)', item_text or '', re.I)
    if not m:
        return 0
    v = float(m.group(1).replace(',', '.'))
    u = m.group(2).upper()[0]
    return int(v * {'M': 1 << 20, 'G': 1 << 30, 'T': 1 << 40}[u])


def ep_key(title):
    info = library.parse(title.replace(' ', '.') + '.mkv')
    n = library.norm(info['name'])
    if info['season'] is not None:
        return '%s|S%02dE%02d' % (n, info['season'], info['episode'])
    m = library.SEASON_RE.search(' ' + title.replace(' ', '.') + ' ')
    if m:
        return '%s|S%02d' % (library.norm(library.clean_name((' ' + title)[:m.start() + 1])), int(m.group(1)))
    return '%s|%s' % (n, info['year'] or '')


def follows():
    return [r['pattern'] for r in db.q('SELECT pattern FROM follow ORDER BY pattern')]


def matches_follow(title, pats):
    nt = ' ' + library.norm(title) + ' '
    for p in pats:
        if p.startswith('re:'):
            try:
                if re.search(p[3:], title, re.I):
                    return p
            except re.error:
                continue
        elif (' ' + library.norm(p) + ' ') in nt:
            return p
    return None


def decide(title, size, pats):
    if config.RSS_EXCLUDE and re.search(config.RSS_EXCLUDE, title, re.I):
        return False, 'exclus (RSS_EXCLUDE)'
    if config.RSS_INCLUDE and not re.search(config.RSS_INCLUDE, title, re.I):
        return False, 'nu se potrivește cu RSS_INCLUDE'
    if config.RSS_MAX_GB and size and size > config.RSS_MAX_GB * (1 << 30):
        return False, 'prea mare'
    if config.RSS_MODE != 'all':
        f = matches_follow(title, pats)
        if not f:
            return False, 'nu e urmărit'
        return True, 'urmărit: ' + f
    return True, 'tot feed-ul'


def save_dir(title):
    info = library.parse(title.replace(' ', '.') + '.mkv')
    series = info['season'] is not None or library.SEASON_RE.search(' ' + title.replace(' ', '.') + ' ')
    return config.QBT_SAVE_PATH + ('/seriale' if series else '/filme')


class Qbt:
    def __init__(self, session):
        self.s = session
        self.ok = False

    async def login(self):
        if self.ok:
            return
        if config.QBT_USER:
            async with self.s.post(config.QBT_URL + '/api/v2/auth/login', data={'username': config.QBT_USER, 'password': config.QBT_PASS},
                                   headers={'Referer': config.QBT_URL}) as r:
                t = await r.text()
                if r.status not in (200, 204) or 'Fails' in t:
                    raise RuntimeError('qBittorrent: user/parolă greșite (QBT_USER/QBT_PASS)')
        self.ok = True

    async def call(self, method, path, **kw):
        await self.login()
        async with self.s.request(method, config.QBT_URL + '/api/v2/' + path, headers={'Referer': config.QBT_URL}, **kw) as r:
            if r.status == 403:
                raise RuntimeError('qBittorrent refuză accesul: setează QBT_USER/QBT_PASS sau whitelist pentru rețeaua docker')
            r.raise_for_status()
            ct = r.headers.get('Content-Type', '')
            return await (r.json() if 'json' in ct else r.text())

    async def prepare(self):
        await self.call('POST', 'app/setPreferences', data={'json': '{"incomplete_files_ext":true}'})
        try:
            await self.call('POST', 'torrents/createCategory', data={'category': config.QBT_CATEGORY, 'savePath': config.QBT_SAVE_PATH})
        except aiohttp.ClientResponseError:
            pass  # exists

    async def add(self, torrent, name, save, paused=False):
        fd = aiohttp.FormData()
        if paused:
            fd.add_field('paused', 'true')   # qBittorrent 4.x
            fd.add_field('stopped', 'true')  # qBittorrent 5.x
        fd.add_field('torrents', torrent, filename='t.torrent', content_type='application/x-bittorrent')
        fd.add_field('category', config.QBT_CATEGORY)
        fd.add_field('savepath', save)
        fd.add_field('autoTMM', 'false')
        fd.add_field('tags', 'filelist')
        t = await self.call('POST', 'torrents/add', data=fd)
        if isinstance(t, str) and 'Fails' in t:
            raise RuntimeError('qBittorrent a refuzat torrentul')

    async def files(self, h):
        return await self.call('GET', 'torrents/files', params={'hash': h})

    async def prio(self, h, ids, priority):
        if ids:
            await self.call('POST', 'torrents/filePrio', data={'hash': h, 'id': '|'.join(str(i) for i in ids), 'priority': str(priority)})

    async def resume(self, h):
        for path in ('torrents/resume', 'torrents/start'):  # 4.x / 5.x
            try:
                await self.call('POST', path, data={'hashes': h})
                return
            except aiohttp.ClientResponseError:
                continue

    async def list(self):
        return await self.call('GET', 'torrents/info', params={'category': config.QBT_CATEGORY, 'sort': 'added_on', 'reverse': 'true'})


async def run_once():
    if not config.RSS_URL:
        STATUS['lastError'] = 'FILELIST_RSS_URL lipsește din .env'
        return
    first = db.get_setting('rss_initialized') is None
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
            async with s.get(config.RSS_URL, headers=UA) as r:
                r.raise_for_status()
                xml = await r.read()
            root = ET.fromstring(xml)
            items = root.findall('.//item')
            STATUS['items'] = len(items)
            qbt = Qbt(s)
            prepared = False
            pats = follows()
            for it in items:
                title = (it.findtext('title') or '').strip()
                link = (it.findtext('link') or '').strip()
                enc = it.find('enclosure')
                if enc is not None and enc.get('url'):
                    link = enc.get('url')
                guid = (it.findtext('guid') or '').strip() or library.norm(title)
                guid = config.mask(guid)
                if not title or not link or db.q1('SELECT 1 FROM rss_item WHERE guid=?', (guid,)):
                    continue
                size = (int(enc.get('length') or 0) if enc is not None else 0) or size_of(it.findtext('description'))
                key = ep_key(title)
                ok, why = decide(title, size, pats)
                if ok and first and not config.RSS_BACKFILL:
                    ok, why = False, 'existent la prima rulare (RSS_BACKFILL=0)'
                pack = key.rsplit('E', 1)[0] if re.search(r'\|S\d+E\d+$', key) else None
                if ok and pack and db.q1("SELECT 1 FROM rss_item WHERE ep_key=? AND status='added'", (pack,)):
                    ok, why = False, 'sezonul întreg e deja descărcat'
                if ok and db.q1("SELECT 1 FROM rss_item WHERE ep_key=? AND status='added'", (key,)):
                    ok, why = False, 'deja descărcat (' + key.split('|')[-1] + ')'
                status = 'skipped'
                if ok:
                    try:
                        if not prepared:
                            await qbt.prepare()
                            prepared = True
                        async with s.get(link, headers=UA) as tr:
                            tr.raise_for_status()
                            data = await tr.read()
                        if not data.startswith(b'd'):
                            raise RuntimeError('linkul nu a întors un fișier .torrent (feed=dl în URL?)')
                        await qbt.add(data, title, save_dir(title))
                        status = 'added'
                        STATUS['added'] += 1
                        log.info('added: %s', title)
                    except Exception as e:
                        status, why = 'error', config.mask(e)[:200]
                        log.warning('add failed %s: %s', title, why)
                db.x('INSERT OR REPLACE INTO rss_item(guid, title, size, status, reason, ep_key, seen_at) VALUES(?,?,?,?,?,?,?)',
                     (guid, title, size, status, why, key, db.now()))
            db.set_setting('rss_initialized', str(db.now()))
            STATUS['lastError'] = None
    except Exception as e:
        STATUS['lastError'] = config.mask(e)[:300]
        log.warning('rss: %s', STATUS['lastError'])
    finally:
        STATUS['lastRun'] = db.now()
        db.x('DELETE FROM rss_item WHERE seen_at<? AND status!=?', (db.now() - 120 * 86400, 'added'))


async def qbt_list():
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
        q = Qbt(s)
        rows = await q.list()
    return [{'name': t.get('name'), 'state': t.get('state'), 'progress': round(t.get('progress', 0), 3), 'size': t.get('size'),
             'ratio': round(t.get('ratio', 0), 2), 'eta': t.get('eta'), 'dlspeed': t.get('dlspeed')} for t in rows[:100]]
