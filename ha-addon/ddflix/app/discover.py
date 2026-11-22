"""Netflix-style discovery (keyless): Cinemeta catalogs (popular / new / top rated, per genre) and IMDb ratings
(official IMDb datasets, refreshed daily: series/movie score + per-episode score)."""
import asyncio
import csv
import gzip
import json
import logging
import os
import re
import time
from urllib.parse import quote

import aiohttp

from . import config, db, library

log = logging.getLogger('discover')
CINEMETA = library.CINEMETA
TTL = 6 * 3600
GENRES = {
    'series': ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror',
               'Mystery', 'Reality-TV', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'],
    'movie': ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History',
              'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'],
}
GENRE_RO = {'Action': 'Acțiune', 'Adventure': 'Aventură', 'Animation': 'Animație', 'Biography': 'Biografic', 'Comedy': 'Comedie',
            'Crime': 'Crimă', 'Documentary': 'Documentar', 'Drama': 'Dramă', 'Family': 'Familie', 'Fantasy': 'Fantasy', 'History': 'Istoric',
            'Horror': 'Horror', 'Mystery': 'Mister', 'Reality-TV': 'Reality', 'Romance': 'Romantic', 'Sci-Fi': 'SF', 'Sport': 'Sport',
            'Thriller': 'Thriller', 'War': 'Război', 'Western': 'Western'}
_mem = {}  # key -> (fetched_at, [imdb])
_lock = asyncio.Lock()


def upsert(m, typ):
    """Store a catalog meta as a light title row (full meta incl. episodes is fetched when the title is opened)."""
    imdb = m.get('imdb_id') or m.get('id') or ''
    if not imdb.startswith('tt') or not m.get('name'):
        return None
    yr = re.findall(r'\d{4}', str(m.get('releaseInfo') or m.get('year') or ''))
    try:
        rating = float(m.get('imdbRating')) if m.get('imdbRating') else None
    except ValueError:
        rating = None
    row = db.q1('SELECT imdb, meta_at FROM title WHERE imdb=?', (imdb,))
    if row:
        if rating and not db.q1('SELECT 1 FROM imdb_rating WHERE tconst=?', (imdb,)):
            db.x('UPDATE title SET imdb_rating=? WHERE imdb=?', (rating, imdb))
        return imdb
    db.x('INSERT INTO title(imdb, type, name, year, year_end, description, genres, cast_, director, imdb_rating, runtime_min, released, '
         'poster_url, background_url, logo_url, first_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
         (imdb, typ, m['name'], int(yr[0]) if yr else None, int(yr[1]) if len(yr) > 1 else None, m.get('description') or '',
          json.dumps(m.get('genres') or m.get('genre') or []), json.dumps((m.get('cast') or [])[:15]), json.dumps(m.get('director') or []),
          rating, None, (m.get('released') or '')[:10], m.get('poster') or '', m.get('background') or '', m.get('logo') or '', db.now()))
    return imdb


async def catalog(typ, cat='top', genre=None, skip=0, session=None):
    """-> [imdb] for a Cinemeta catalog page (cached 6 h, also in the DB so a restart / offline still shows rows)."""
    key = 'disc:%s:%s:%s:%d' % (typ, cat, genre or '', skip)
    hit = _mem.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    extra = []
    if genre:
        extra.append('genre=' + quote(genre, safe=''))
    if skip:
        extra.append('skip=%d' % skip)
    url = '%s/catalog/%s/%s%s.json' % (CINEMETA, typ, cat, ('/' + '&'.join(extra)) if extra else '')
    try:
        own = session is None
        s = session or aiohttp.ClientSession()
        try:
            d = await library.http_json(s, url)
        finally:
            if own:
                await s.close()
        ids = [i for i in (upsert(m, typ) for m in d.get('metas') or []) if i]
        if ids:
            _mem[key] = (time.time(), ids)
            db.set_setting(key, json.dumps(ids))
            return ids
    except Exception as e:
        log.warning('catalog %s: %s', key, e)
    old = db.get_setting(key)
    ids = json.loads(old) if old else []
    _mem[key] = (time.time() - TTL + 600, ids)  # retry in 10 min
    return ids


def home_rows(typ=None):
    """(key, title, kind, type, genre): kind = pop | new | best | genre."""
    rows = []
    for t in ('series', 'movie'):
        if typ in (None, t):
            w = 'Seriale' if t == 'series' else 'Filme'
            rows += [('top10_nfx_' + t, 'Top 10 ' + w.lower() + ' Netflix', 'nfx', t, None),
                     ('top10_imdb_' + t, 'Top 10 ' + w.lower() + ' pe IMDb azi', 'imdb10', t, None)]
    tops, rows = rows, []
    for t in ('series', 'movie'):
        if typ in (None, t):
            w = 'Seriale' if t == 'series' else 'Filme'
            rows += [('pop_' + t, w + ' populare acum', 'pop', t, None), ('new_' + t, w + ' noi', 'new', t, None),
                     ('best_' + t, w + ' cu nota cea mai mare', 'best', t, None)]
    if typ is None:
        rows = [rows[0], rows[3], rows[1], rows[4], rows[2], rows[5]]
        tops = [tops[0], tops[2], tops[1], tops[3]]
    rows = tops + rows
    gs = {None: [('series', 'Crime'), ('movie', 'Action'), ('series', 'Sci-Fi'), ('movie', 'Comedy'), ('series', 'Drama'),
                 ('movie', 'Horror'), ('series', 'Animation'), ('series', 'Documentary')],
          'series': [('series', g) for g in ('Crime', 'Drama', 'Sci-Fi', 'Comedy', 'Action', 'Fantasy', 'Mystery', 'Animation',
                                             'Documentary', 'Reality-TV')],
          'movie': [('movie', g) for g in ('Action', 'Comedy', 'Thriller', 'Sci-Fi', 'Horror', 'Drama', 'Animation', 'Romance', 'Crime',
                                           'Documentary')]}[typ]
    for t, g in gs:
        label = GENRE_RO.get(g, g) if typ else ('Seriale' if t == 'series' else 'Filme') + ': ' + GENRE_RO.get(g, g)
        rows.append(('g:' + g, label, 'genre', t, g))  # TV turns 'g:<Genre>' rows into genre tiles
    return rows


def kids_rows(typ=None):
    rows = []
    for t in ('series', 'movie'):
        if typ in (None, t):
            rows += [('kids_fam_' + t, ('Seriale' if t == 'series' else 'Filme') + ' pentru copii', 'kids', t, 'Family'),
                     ('kids_anim_' + t, 'Desene animate' if t == 'series' else 'Filme de animație', 'kids', t, 'Animation'),
                     ('kids_adv_' + t, ('Seriale' if t == 'series' else 'Filme') + ' de aventură', 'kids', t, 'Adventure'),
                     ('kids_com_' + t, ('Seriale' if t == 'series' else 'Filme') + ' de comedie', 'kids', t, 'Comedy')]
    if typ is None:
        rows = [rows[0], rows[4], rows[1], rows[5], rows[2], rows[6], rows[3], rows[7]]
    return rows


async def pool(typ, session=None):
    """The ~200 most popular titles of a type right now."""
    out = []
    for skip in (0, 50, 100, 150):
        for i in await catalog(typ, 'top', None, skip, session):
            if i not in out:
                out.append(i)
    return out


async def row_ids(kind, typ, genre=None, session=None):
    if kind == 'genre':
        return await catalog(typ, 'top', genre, 0, session)
    if kind == 'kids':  # several pages: the kids filter drops a lot
        out = []
        for skip in (0, 50, 100, 150):
            out += [i for i in await catalog(typ, 'top', genre, skip, session) if i not in out]
        return out
    if kind == 'nfx':
        return top_ids('nfx', typ)['ids']
    if kind == 'imdb10':
        return (await pool(typ, session))[:10]
    ids = await pool(typ, session)
    if kind == 'pop':
        return ids[:50]
    meta = {r['imdb']: r for r in db.q('SELECT imdb, year, imdb_rating FROM title WHERE imdb IN (%s)' % ','.join('?' * len(ids)), ids)} if ids else {}
    if kind == 'new':
        y = time.localtime().tm_year - 1
        return [i for i in ids if i in meta and (meta[i]['year'] or 0) >= y][:40]
    if kind == 'best':
        best = [i for i in ids if i in meta and (meta[i]['imdb_rating'] or 0) >= 7.8]
        return sorted(best, key=lambda i: -meta[i]['imdb_rating'])[:40]
    return []


async def warm():
    """Background job: refresh every home catalog so /api/home answers from cache."""
    async with _lock, aiohttp.ClientSession() as s:
        for k in list(_mem):
            _mem[k] = (0, _mem[k][1])
        seen = set()
        for typ in (None, 'series', 'movie'):
            for _, _, kind, t, g in home_rows(typ) + kids_rows(typ):
                key = (kind == 'kids', t, g) if kind in ('genre', 'kids') else (False, t, None)
                if key in seen:
                    continue
                seen.add(key)
                await row_ids(kind, t, g, s)
                await asyncio.sleep(0.3)


# ---------------- IMDb ratings (datasets.imdbws.com, personal non-commercial use)
DS = 'https://datasets.imdbws.com/'
_rebuild = {'pending': False, 'running': False}


def _dir():
    d = os.path.join(config.DATA_DIR, 'imdb')
    os.makedirs(d, exist_ok=True)
    return d


async def _download(name):
    fn = os.path.join(_dir(), name)
    if os.path.exists(fn) and time.time() - os.path.getmtime(fn) < 20 * 3600:
        return fn
    tmp = fn + '.part'
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=900)) as s:
        async with s.get(DS + name, headers=library.UA) as r:
            r.raise_for_status()
            with open(tmp, 'wb') as f:
                async for chunk in r.content.iter_chunked(1 << 16):
                    f.write(chunk)
    os.replace(tmp, fn)
    return fn


def _rows(fn):
    with gzip.open(fn, 'rt', encoding='utf-8', newline='') as f:
        rd = csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE)
        next(rd, None)
        for r in rd:
            yield r


def _build():
    """Episode + title ratings for every series/movie we know (title table). Runs in a thread."""
    d = _dir()
    epf, raf = os.path.join(d, 'title.episode.tsv.gz'), os.path.join(d, 'title.ratings.tsv.gz')
    if not (os.path.exists(epf) and os.path.exists(raf)):
        return
    known = {r['imdb'] for r in db.q("SELECT imdb FROM title WHERE imdb LIKE 'tt%'")}
    series = {r['imdb'] for r in db.q("SELECT imdb FROM title WHERE type='series' AND imdb LIKE 'tt%'")}
    eps = {}
    for r in _rows(epf):
        if len(r) >= 4 and r[1] in series and r[2].isdigit() and r[3].isdigit():
            eps[r[0]] = (r[1], int(r[2]), int(r[3]))
    tr, er = [], []
    for r in _rows(raf):
        if len(r) < 3:
            continue
        if r[0] in known:
            tr.append((r[0], float(r[1]), int(r[2])))
        e = eps.get(r[0])
        if e:
            er.append((e[0], e[1], e[2], float(r[1]), int(r[2])))
    with db._lock:
        c = db.conn()
        c.execute('BEGIN')
        try:
            c.execute('DELETE FROM ep_rating')
            c.executemany('INSERT OR REPLACE INTO ep_rating(parent, season, episode, rating, votes) VALUES(?,?,?,?,?)', er)
            c.executemany('INSERT OR REPLACE INTO imdb_rating(tconst, rating, votes) VALUES(?,?,?)', tr)
            c.executemany('UPDATE title SET imdb_rating=? WHERE imdb=?', [(x[1], x[0]) for x in tr])
            c.execute('COMMIT')
        except Exception:
            c.execute('ROLLBACK')
            raise
    db.set_setting('imdb_known', str(len(known)))
    log.info('imdb ratings: %d titles, %d episodes', len(tr), len(er))


async def rebuild():
    if _rebuild['running']:
        _rebuild['pending'] = True
        return
    _rebuild['running'] = True
    try:
        while True:
            _rebuild['pending'] = False
            await asyncio.get_running_loop().run_in_executor(None, _build)
            if not _rebuild['pending']:
                break
    finally:
        _rebuild['running'] = False


async def ratings_job():
    await _download('title.ratings.tsv.gz')
    await _download('title.episode.tsv.gz')
    await rebuild()


def want_series(imdb):
    """A series without episode ratings was opened: re-run the build from the cached files (debounced)."""
    if not imdb.startswith('tt') or db.q1('SELECT 1 FROM ep_rating WHERE parent=? LIMIT 1', (imdb,)):
        return
    key = 'imdbwant:' + imdb
    if db.get_setting(key):
        return
    db.set_setting(key, '1')

    async def later():
        await asyncio.sleep(20)
        await rebuild()
    asyncio.ensure_future(later())


def ep_ratings(imdb):
    return {(r['season'], r['episode']): (r['rating'], r['votes'])
            for r in db.q('SELECT season, episode, rating, votes FROM ep_rating WHERE parent=?', (imdb,))}


# ---------------- Top 10 (what people actually watch)
NFX = 'https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv'
MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec']


async def netflix_top():
    """Official Netflix weekly global Top 10 (views, English + non-English merged) -> IMDb ids. Refreshed daily (new week on Tuesdays)."""
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as s:
        async with s.get(NFX, headers=library.UA) as r:
            r.raise_for_status()
            text = await r.text()
        rows = list(csv.DictReader(text.splitlines(), delimiter='\t'))
        week = max(r_['week'] for r_ in rows)
        for typ, pre in (('series', 'TV'), ('movie', 'Films')):
            cur = [r_ for r_ in rows if r_['week'] == week and r_['category'].startswith(pre)]

            def views(r_):
                try:
                    return float(r_.get('weekly_views') or 0) or float(r_.get('weekly_hours_viewed') or 0) / 1000
                except ValueError:
                    return 0
            cur.sort(key=lambda r_: -views(r_))
            ids, names = [], set()
            for r_ in cur:
                name = r_['show_title'].strip()
                if name.lower() in names:
                    continue
                names.add(name.lower())
                imdb = await library.match(s, name, None, typ)
                if imdb and imdb.startswith('tt') and imdb not in ids:
                    await library.ensure_title(s, imdb, name, None, typ)
                    ids.append(imdb)
                if len(ids) >= 10:
                    break
            if ids:
                db.set_setting('top:nfx:' + typ, json.dumps({'week': week, 'ids': ids}))
                log.info('netflix top10 %s week %s: %d', typ, week, len(ids))


def top_ids(src, typ):
    v = db.get_setting('top:%s:%s' % (src, typ))
    return json.loads(v) if v else {'week': None, 'ids': []}


def week_label(week):
    """'2026-11-15' (Sunday the week ends) -> '9-15 nov'."""
    try:
        t = time.strptime(week, '%Y-%m-%d')
        end = time.mktime(t)
        st = time.localtime(end - 6 * 86400)
        return '%d %s - %d %s' % (st.tm_mday, MONTHS[st.tm_mon - 1], t.tm_mday, MONTHS[t.tm_mon - 1]) if st.tm_mon != t.tm_mon \
            else '%d-%d %s' % (st.tm_mday, t.tm_mday, MONTHS[t.tm_mon - 1])
    except Exception:
        return ''
