"""Web admin API (LAN browser only; devices get 403 from the guard) + health + dashboard."""
import asyncio
import ipaddress
import os
import time

import aiohttp

from . import config, db, library, rss
from .util import body, jerr, jok


def web_only(fn):
    async def w(request):
        if not request['web']:
            return jerr(403, 'web only')
        return await fn(request)
    return w


async def health(request):
    return jok({'ok': True, 'files': library.STATUS['files'], 'time': db.now()})


_home = {'at': 0, 'ips': set()}


async def home_ips():
    """This house's public IPv4 / IPv6 (as the internet sees the server), refreshed every 10 min."""
    if _home['ips'] and time.time() - _home['at'] < 600:
        return _home['ips']
    ips = set()
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=6)) as s:
        for u in ('https://api.ipify.org', 'https://api6.ipify.org'):
            try:
                async with s.get(u) as r:
                    ips.add((await r.text()).strip())
            except Exception:
                pass
    _home.update(at=time.time(), ips=ips)
    return ips


def same_place(a, b):
    try:
        x, y = ipaddress.ip_address(a), ipaddress.ip_address(b)
    except ValueError:
        return False
    if x.version != y.version:
        return False
    if x.version == 4:
        return x == y
    return ipaddress.ip_network('%s/64' % x, strict=False) == ipaddress.ip_network('%s/64' % y, strict=False)


async def where(request):
    """Is this browser at home? The public site then switches to the home server's own copy (much faster)."""
    from . import auth
    home = not auth.is_public(request)
    if not home:
        ip = auth.peer_ip(request)
        home = any(same_place(ip, h) for h in await home_ips())
    return jok({'home': home, 'lan': config.WEB_URL + '/web/'})


async def dashboard(request):
    # the TV fetches weather/BNR/fuel/crypto itself; server-side cards (news, traffic, camera) can be added later
    return jok({'fetchedAt': db.now()})


@web_only
async def status(request):
    return jok({'library': library.STATUS, 'rss': rss.STATUS,
                'config': {'rssConfigured': bool(config.RSS_URL), 'rssMode': config.RSS_MODE, 'rssInterval': config.RSS_INTERVAL_MIN,
                           'rssInclude': config.RSS_INCLUDE, 'rssExclude': config.RSS_EXCLUDE, 'qbtUrl': config.QBT_URL,
                           'qbtAuth': bool(config.QBT_USER), 'mediaDir': config.MEDIA_DIR, 'webUrl': config.WEB_URL},
                'titles': db.q1('SELECT COUNT(DISTINCT imdb) n FROM media_file WHERE missing=0')['n']})


@web_only
async def follows_get(request):
    return jok({'items': [dict(r) for r in db.q('SELECT id, pattern, created_at FROM follow ORDER BY pattern')]})


@web_only
async def follows_add(request):
    p = str((await body(request)).get('pattern') or '').strip()[:120]
    if not p:
        return jerr(400, 'scrie numele serialului')
    db.x('INSERT OR IGNORE INTO follow(pattern, created_at) VALUES(?,?)', (p, db.now()))
    return jok({'ok': True})


@web_only
async def follows_del(request):
    db.x('DELETE FROM follow WHERE id=?', (int(request.match_info['id']),))
    return jok({'ok': True})


@web_only
async def follow_title(request):
    t = db.q1('SELECT name FROM title WHERE imdb=?', (request.match_info['imdb'],))
    if not t:
        return jerr(404, 'title not found')
    if request.method == 'DELETE':
        db.x('DELETE FROM follow WHERE pattern=?', (t['name'],))
    else:
        db.x('INSERT OR IGNORE INTO follow(pattern, created_at) VALUES(?,?)', (t['name'], db.now()))
    return jok({'ok': True, 'following': request.method != 'DELETE'})


@web_only
async def rss_items(request):
    return jok({'items': [dict(r) for r in db.q('SELECT title, size, status, reason, seen_at FROM rss_item ORDER BY seen_at DESC, rowid DESC LIMIT 150')]})


@web_only
async def rss_run(request):
    await rss.run_once()
    return jok({'ok': True, 'rss': rss.STATUS})


@web_only
async def scan(request):
    asyncio.ensure_future(library.scan(force_meta=(await body(request)).get('full') is True))
    return jok({'ok': True})


@web_only
async def torrents(request):
    try:
        return jok({'items': await rss.qbt_list()})
    except Exception as e:
        return jerr(502, config.mask(e)[:200])


@web_only
async def titles(request):
    rows = db.q('SELECT t.imdb, t.name, t.type, t.year, COUNT(m.id) n, MAX(m.added_at) added FROM media_file m JOIN title t ON t.imdb=m.imdb '
                'WHERE m.missing=0 GROUP BY t.imdb ORDER BY added DESC')
    return jok({'items': [dict(r) for r in rows]})


@web_only
async def unmatched(request):
    rows = db.q("SELECT id, path, pname, pyear, ptype, season, episode FROM media_file WHERE missing=0 AND imdb LIKE 'loc:%' ORDER BY path")
    return jok({'items': [dict(r, path=os.path.relpath(r['path'], config.MEDIA_DIR)) for r in rows]})


@web_only
async def match(request):
    b = await body(request)
    imdb = str(b.get('imdb') or '').strip()
    if not imdb.startswith('tt') or not imdb[2:].isdigit():
        return jerr(400, 'IMDb id de forma tt1234567')
    f = db.q1('SELECT * FROM media_file WHERE id=?', (int(b.get('fileId') or 0),))
    if not f:
        return jerr(404, 'file not found')
    # same parsed name -> same title (all episodes of a show at once)
    same = db.q('SELECT id, path FROM media_file WHERE pname=? AND IFNULL(pyear,0)=IFNULL(?,0) AND imdb=?', (f['pname'], f['pyear'], f['imdb']))
    for r in same:
        db.set_setting('manual:' + r['path'], imdb)
        db.x('UPDATE media_file SET imdb=? WHERE id=?', (imdb, r['id']))
    db.set_setting('match:%s:%s:%s' % (f['ptype'], library.norm(f['pname']), f['pyear'] or ''), imdb)
    async with aiohttp.ClientSession() as s:
        await library.ensure_title(s, imdb, f['pname'], f['pyear'], f['ptype'])
    return jok({'ok': True, 'n': len(same)})


def routes(app):
    r = app.router
    r.add_get('/api/health', health)
    r.add_get('/api/where', where)
    r.add_get('/api/dashboard', dashboard)
    r.add_get('/api/admin/status', status)
    r.add_get('/api/admin/follows', follows_get)
    r.add_post('/api/admin/follows', follows_add)
    r.add_delete('/api/admin/follows/{id:\\d+}', follows_del)
    r.add_post('/api/follow/{imdb}', follow_title)
    r.add_delete('/api/follow/{imdb}', follow_title)
    r.add_get('/api/admin/rss', rss_items)
    r.add_post('/api/admin/rss/run', rss_run)
    r.add_post('/api/admin/scan', scan)
    r.add_get('/api/admin/torrents', torrents)
    r.add_get('/api/admin/titles', titles)
    r.add_get('/api/admin/unmatched', unmatched)
    r.add_post('/api/admin/match', match)
