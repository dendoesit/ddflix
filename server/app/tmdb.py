"""TMDB (free API key, optional): age certifications for every title and what kids watch right now.
Key: env TMDB_API_KEY (HA add-on option tmdb_key). Never logged (config.mask)."""
import asyncio
import json
import logging
import os
import time

import aiohttp

from . import config, db, library

log = logging.getLogger('tmdb')
KEY = os.environ.get('TMDB_API_KEY', '').strip()
if KEY and KEY not in config.SECRETS:
    config.SECRETS.append(KEY)
API = 'https://api.themoviedb.org/3'
# minimum age per country certification (Romania first, then Germany, then the US)
RO = {'AG': 0, 'AP-12': 12, 'N-15': 15, 'IM-18': 18, 'IM-18-XXX': 18, 'IC': 18}
US_MOVIE = {'G': 0, 'PG': 6, 'PG-13': 13, 'R': 17, 'NC-17': 18}
US_TV = {'TV-Y': 0, 'TV-Y7': 7, 'TV-Y7-FV': 7, 'TV-G': 0, 'TV-PG': 10, 'TV-14': 14, 'TV-MA': 17}


def configured():
    return bool(KEY)


async def get(s, path, **params):
    params['api_key'] = KEY
    async with s.get(API + path, params=params, headers=library.UA, timeout=aiohttp.ClientTimeout(total=20)) as r:
        if r.status == 429:
            await asyncio.sleep(2)
            return await get(s, path, **{k: v for k, v in params.items() if k != 'api_key'})
        if r.status == 404:
            return None
        if r.status >= 400:
            raise RuntimeError('tmdb HTTP %d' % r.status)
        return await r.json(content_type=None)


def age_from(entries, tv):
    by = {}
    for e in entries or []:
        c = e.get('iso_3166_1')
        certs = [x.get('certification') for x in (e.get('release_dates') or [])] if not tv else [e.get('rating')]
        certs = [c_.strip() for c_ in certs if c_ and c_.strip()]
        if certs:
            by[c] = certs
    for country in ('RO', 'DE', 'US', 'GB', 'FR'):
        for cert in by.get(country, []):
            if country == 'RO' and cert in RO:
                return RO[cert]
            if country == 'DE' and cert.isdigit():
                return int(cert)
            if country == 'US':
                m = (US_TV if tv else US_MOVIE).get(cert)
                if m is not None:
                    return m
            if country == 'GB':
                m = {'U': 0, 'PG': 8, '12': 12, '12A': 12, '15': 15, '18': 18}.get(cert)
                if m is not None:
                    return m
            if country == 'FR':
                m = {'U': 0, 'TP': 0, '10': 10, '12': 12, '16': 16, '18': 18}.get(cert)
                if m is not None:
                    return m
    return None


async def cert_for(s, imdb, typ):
    """-> (found, age) for one IMDb id."""
    f = await get(s, '/find/' + imdb, external_source='imdb_id')
    if not f:
        return False, None
    tv = typ == 'series'
    hits = f.get('tv_results' if tv else 'movie_results') or f.get('movie_results' if tv else 'tv_results') or []
    if not hits:
        return False, None
    tid = hits[0]['id']
    if tv:
        d = await get(s, '/tv/%d/content_ratings' % tid)
        return True, age_from((d or {}).get('results'), True)
    d = await get(s, '/movie/%d/release_dates' % tid)
    return True, age_from((d or {}).get('results'), False)


async def imdb_of(s, kind, tid):
    d = await get(s, '/%s/%d/external_ids' % (kind, tid))
    return (d or {}).get('imdb_id') or None


async def kids_lists():
    """Popular kids titles right now (TMDB discover), as IMDb ids, cached 12 h: series = TMDB 'Kids' genre, movies = rated
    G/PG animation or family released since 2008."""
    hit = db.get_setting('tmdb:kids')
    if hit:
        v = json.loads(hit)
        if time.time() - v.get('at', 0) < 12 * 3600:
            return v
    if not configured():
        return {'series': [], 'movie': [], 'at': 0}
    out = {'series': [], 'movie': [], 'at': time.time()}
    async with aiohttp.ClientSession() as s:
        for page in (1, 2, 3, 4):
            d = await get(s, '/discover/tv', with_genres='10762', sort_by='popularity.desc', page=page, language='ro-RO')
            for r in (d or {}).get('results') or []:
                i = await imdb_of(s, 'tv', r['id'])
                if i and i not in out['series']:
                    out['series'].append(i)
                    await library.ensure_title(s, i, r.get('name') or '', None, 'series')
                    db.x('UPDATE title SET cert_age=COALESCE(cert_age, 6), cert_src=COALESCE(cert_src, \'tmdb-kids\') WHERE imdb=?', (i,))
            for genre in ('16', '10751'):
                d = await get(s, '/discover/movie', with_genres=genre, sort_by='popularity.desc', page=page, certification_country='US',
                              **{'certification.lte': 'PG', 'primary_release_date.gte': '2008-01-01', 'vote_count.gte': '30'})
                for r in (d or {}).get('results') or []:
                    i = await imdb_of(s, 'movie', r['id'])
                    if i and i not in out['movie']:
                        out['movie'].append(i)
                        await library.ensure_title(s, i, r.get('title') or '', None, 'movie')
    db.set_setting('tmdb:kids', json.dumps(out))
    log.info('kids lists: %d series, %d movies', len(out['series']), len(out['movie']))
    return out
