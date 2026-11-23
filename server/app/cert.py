"""Age ratings without an API key: movies -> Wikidata (FSK, else MPA), series -> TVmaze ('Children' genre).
title.cert_age = minimum age (None = unknown). Kids profiles use it; unknown titles fall back to the IMDb 'Family' genre."""
import asyncio
import logging
import re
import time

import aiohttp

from . import db, library

log = logging.getLogger('cert')
WD = 'https://query.wikidata.org/sparql'
UA = {'User-Agent': 'DDflix/1.0 (https://github.com/dendoesit/ddflix; personal home media server)', 'Accept': 'application/sparql-results+json'}
MPA = {'G': 0, 'PG': 6, 'PG-13': 13, 'R': 17, 'NC-17': 18}
_schema = {'ok': False}
_lock = asyncio.Lock()


def schema():
    if _schema['ok']:
        return
    with db._lock:
        c = db.conn()
        cols = {r[1] for r in c.execute('PRAGMA table_info(title)')}
        for col, typ in (('cert_age', 'INTEGER'), ('cert_src', 'TEXT'), ('cert_at', 'INTEGER')):
            if col not in cols:
                c.execute('ALTER TABLE title ADD COLUMN %s %s' % (col, typ))
    _schema['ok'] = True


def fsk_age(label):
    m = re.search(r'FSK\s*(\d+)', label or '')
    return int(m.group(1)) if m else None


async def movies(session, ids):
    vals = ' '.join('"%s"' % i for i in ids)
    q = ('SELECT ?imdb ?mpaLabel ?fskLabel WHERE { VALUES ?imdb {%s} ?i wdt:P345 ?imdb. OPTIONAL{?i wdt:P1657 ?mpa.} '
         'OPTIONAL{?i wdt:P1981 ?fsk.} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }' % vals)
    for attempt in range(3):
        async with session.get(WD, params={'query': q}, headers=UA, timeout=aiohttp.ClientTimeout(total=60)) as r:
            if r.status == 429:  # Wikidata robot policy: back off and retry
                await asyncio.sleep(min(120, int(r.headers.get('Retry-After') or 30)))
                continue
            if r.status >= 400:
                raise RuntimeError('wikidata HTTP %d' % r.status)
            d = await r.json(content_type=None)
            break
    else:
        raise RuntimeError('wikidata busy')
    got = {}
    for b in d['results']['bindings']:
        imdb = b['imdb']['value']
        ages = got.setdefault(imdb, {'fsk': [], 'mpa': []})
        a = fsk_age((b.get('fskLabel') or {}).get('value'))
        if a is not None:
            ages['fsk'].append(a)
        m = MPA.get((b.get('mpaLabel') or {}).get('value', '').strip())
        if m is not None:
            ages['mpa'].append(m)
    now = db.now()
    for i in ids:
        g = got.get(i) or {}
        age = max(g['fsk']) if g.get('fsk') else max(g['mpa']) if g.get('mpa') else None
        src = 'fsk' if g.get('fsk') else 'mpa' if g.get('mpa') else 'wikidata'
        db.x('UPDATE title SET cert_age=?, cert_src=?, cert_at=? WHERE imdb=?', (age, src, now, i))


async def series(session, imdb):
    age, src = None, 'tvmaze'
    try:
        async with session.get('https://api.tvmaze.com/lookup/shows', params={'imdb': imdb}, headers=library.UA,
                               timeout=aiohttp.ClientTimeout(total=20), allow_redirects=True) as r:
            if r.status == 429:
                await asyncio.sleep(10)
                return False
            if r.status == 200:
                d = await r.json(content_type=None)
                if 'Children' in (d.get('genres') or []):
                    age = 6
    except Exception as e:
        log.info('tvmaze %s: %s', imdb, e)
        return False
    db.x('UPDATE title SET cert_age=?, cert_src=?, cert_at=? WHERE imdb=?', (age, src, db.now(), imdb))
    return True


async def enrich(ids):
    """Fill cert_age for these titles (skips ones checked in the last 30 days)."""
    schema()
    if not ids:
        return
    async with _lock:
        rows = db.q('SELECT imdb, type FROM title WHERE imdb IN (%s) AND (cert_at IS NULL OR cert_at < ?)' % ','.join('?' * len(ids)),
                    list(ids) + [db.now() - 30 * 86400])
        mv = [r['imdb'] for r in rows if r['type'] == 'movie' and r['imdb'].startswith('tt')]
        sr = [r['imdb'] for r in rows if r['type'] == 'series' and r['imdb'].startswith('tt')]
        from . import tmdb
        async with aiohttp.ClientSession() as s:
            if tmdb.configured():
                left_m, left_s = [], []
                for i in mv + sr:
                    typ = 'movie' if i in mv else 'series'
                    try:
                        found, age = await tmdb.cert_for(s, i, typ)
                    except Exception as e:
                        log.info('tmdb %s: %s', i, str(e)[:100])
                        found, age = False, None
                    if age is not None:
                        db.x('UPDATE title SET cert_age=?, cert_src=?, cert_at=? WHERE imdb=?', (age, 'tmdb', db.now(), i))
                    else:
                        (left_m if typ == 'movie' else left_s).append(i)
                    await asyncio.sleep(0.05)
                mv, sr = left_m, left_s
            for k in range(0, len(mv), 50):
                try:
                    await movies(s, mv[k:k + 50])
                except Exception as e:
                    log.info('wikidata: %s', str(e)[:120])
                await asyncio.sleep(6)
            for i in sr:
                await series(s, i)
                await asyncio.sleep(0.6)  # TVmaze: 20 calls / 10 s
        if mv or sr:
            log.info('age ratings: %d movies, %d series', len(mv), len(sr))
