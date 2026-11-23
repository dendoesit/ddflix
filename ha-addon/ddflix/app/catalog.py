"""Cards, home, browse, title, search, My List, ratings, recent, images."""
import json
import random
import time

from aiohttp import web

from . import db, discover, filelist, library
from .util import body, jerr, jok

KIDS_GENRES = {'Animation', 'Family', 'Kids'}
RO = {'rum', 'ron', 'ro', 'romanian'}


_lib = {'key': None, 'agg': None}


def library_titles():
    """imdb -> aggregated info over the files present on disk (cached until a file is added / removed / re-probed)."""
    k = tuple(db.q1('SELECT COUNT(*) n, COALESCE(MAX(id), 0) m, COALESCE(SUM(missing), 0) x, COALESCE(MAX(mtime), 0) t FROM media_file'))
    if _lib['key'] == k and _lib['agg'] is not None:
        return _lib['agg']
    agg = _library_titles()
    _lib.update(key=k, agg=agg)
    return agg


def _library_titles():
    agg = {}
    for f in db.q('SELECT id, imdb, width, hdr, added_at, probe, ext_subs, season FROM media_file WHERE missing=0'):
        a = agg.setdefault(f['imdb'], {'w': 0, 'hdr': None, 'added': 0, 'first': 0, 'rosub': False, 'ro': False, 'n': 0, 'seasons': set(),
                                       'sfirst': {}})
        a['first'] = min(a['first'] or 1 << 62, f['added_at'] or 0)
        if f['season'] is not None:
            a['sfirst'][f['season']] = min(a['sfirst'].get(f['season'], 1 << 62), f['added_at'] or 0)
        a['w'] = max(a['w'], f['width'] or 0)
        a['hdr'] = a['hdr'] or f['hdr']
        a['added'] = max(a['added'], f['added_at'] or 0)
        a['n'] += 1
        if f['season']:
            a['seasons'].add(f['season'])
        if not a['rosub']:
            if any(('.ro.' in s.lower() or '.rum.' in s.lower() or '.ron.' in s.lower() or 'romanian' in s.lower()) for s in db.jl(f['ext_subs'], [])):
                a['rosub'] = True
            else:
                for s in (db.jl(f['probe'], {}) or {}).get('streams', []):
                    lang = ((s.get('tags') or {}).get('language') or '').lower()
                    if lang in RO:
                        if s.get('codec_type') == 'subtitle':
                            a['rosub'] = True
                        elif s.get('codec_type') == 'audio':
                            a['ro'] = True
    return agg


KIDS_BAD = {'Horror', 'Crime', 'Thriller', 'War', 'Mystery', 'Romance', 'Film-Noir', 'Adult', 'Reality-TV', 'Talk-Show', 'Game-Show', 'News'}


def allowed(profile, t):
    """Kids profiles: never anything tagged Horror / Crime / Thriller / War...; titles with a known age rating (Wikidata FSK/MPA
    for movies, TVmaze 'Children' for series) must be <= the profile's max age; unknown ratings fall back to the IMDb
    'Family' genre (and animation only for 7 and under)."""
    if not profile or profile['kind'] != 'kids':
        return True
    g = set(db.jl(t['genres'], []) or [])
    if g & KIDS_BAD:
        return False
    mx = profile['max_rating'] or 12
    age = t['cert_age'] if 'cert_age' in t.keys() else None
    if age is not None:
        return age <= mx
    if 'Family' not in g:
        return False
    return mx > 7 or 'Animation' in g


def card(t, a, prog=None):
    a = a or {}
    w, hdr = a.get('w', 0), a.get('hdr')
    labels = (['4K'] if w >= 3000 else []) + (['Dolby Vision'] if hdr == 'dovi' else ['HDR'] if hdr else [])
    real = t['imdb'].startswith('tt')
    out = {'imdb': t['imdb'], 'type': t['type'] or 'movie', 'name': t['name'], 'nameRo': None, 'year': t['year'],
            'rating': t['imdb_rating'], 'genres': db.jl(t['genres'], []), 'tmdb': None, 'rt': None, 'mc': None,
            'poster': real, 'backdrop': real, 'logo': real and bool(t['logo_url']), 'labels': labels, 'has4k': w >= 3000,
            'dv': hdr == 'dovi', 'hdr': bool(hdr), 'atmos': False, 'ro': a.get('ro', False), 'rosub': a.get('rosub', False), 'fl': False,
            'new': bool(a.get('added')) and time.time() - a['added'] < 72 * 3600, 'newVersion': False,
            'downloading': False, 'progress': prog, 'certAge': t['cert_age'] if 'cert_age' in t.keys() else None, 'trailer': None, 'inLibrary': bool(a.get('n'))}
    out['inPlex'] = out['inLibrary']  # TV: 'playable here'
    b = badge(t, a)
    if b:
        out['badge'] = b
    if t['trailer_yt']:
        out['trailer'] = t['trailer_yt']
    return out


WEEK = 7 * 86400


def badge(t, a):
    """'New season' / 'New episodes' / 'Recently added' for titles with files added in the last 7 days."""
    if not a or not a.get('n'):
        return None
    now = time.time()
    if now - (a.get('added') or 0) > WEEK:
        return None
    if now - (a.get('first') or 0) <= WEEK:
        return 'Recently added'
    if t['type'] == 'series':
        sf = a.get('sfirst') or {}
        if sf and any(now - v <= WEEK for s, v in sf.items() if s != min(sf)):
            return 'New season'
        return 'New episodes'
    return 'Recently added'


def hero(t, a):
    c = card(t, a)
    c.setdefault('trailer', None)
    c.update({'description': t['description'] or '', 'runtime': t['runtime_min'], 'plexLink': None,
              'seasons': len(a.get('seasons', ())) if t['type'] == 'series' else None})
    return c


def cards_for(profile, imdbs, agg=None):
    agg = agg if agg is not None else library_titles()
    if not imdbs:
        return []
    rows = {r['imdb']: r for r in db.q('SELECT * FROM title WHERE imdb IN (%s)' % ','.join('?' * len(imdbs)), list(imdbs))}
    return [card(rows[i], agg.get(i)) for i in imdbs if i in rows and allowed(profile, rows[i])]


def progress_cols():
    return {r[1] for r in db.q('PRAGMA table_info(progress)')}


def lib_rows(profile, typ=None):
    agg = library_titles()
    if not agg:
        return [], agg
    ts = db.q('SELECT * FROM title WHERE imdb IN (%s)' % ','.join('?' * len(agg)), list(agg))
    ts = [t for t in ts if allowed(profile, t) and (not typ or t['type'] == typ)]
    return ts, agg


_home_cache = {}


async def home(request):
    """Cached 2 min per profile + type (35 rows are slow to build on a small ARM box); rebuilt in the background."""
    p = request['profile']
    key = (p['id'] if p else None, request.query.get('type') or None, library_titles_key())
    hit = _home_cache.get(key)
    if hit and time.time() - hit[0] < 120:
        return jok(hit[1])
    out = await build_home(request)
    _home_cache.clear() if len(_home_cache) > 50 else None
    _home_cache[key] = (time.time(), out)
    return jok(out)


def library_titles_key():
    library_titles()
    return _lib['key']


async def build_home(request):
    """Netflix-style home: your NAS library + Continue-able rows first, then what everyone is watching (Cinemeta / IMDb popularity)."""
    import asyncio
    p = request['profile']
    typ = request.query.get('type') or None
    ts, agg = lib_rows(p, typ)
    by_added = sorted(ts, key=lambda t: -agg[t['imdb']]['added'])
    rows = []

    def row(key, title, items, link=''):
        cs = [card(t, agg.get(t['imdb'])) for t in items][:40]
        if cs:
            rows.append({'key': key, 'title': title, 'items': cs, 'link': link})

    # the NAS library row is "Adăugate recent în bibliotecă" from /api/library/recent on the TV and the web (same place, same name)
    pats = [r['pattern'] for r in db.q('SELECT pattern FROM follow')] if not (p and p['kind'] == 'kids') else []
    if pats:
        fl = db.q('SELECT * FROM title WHERE name IN (%s) AND (type=? OR ? IS NULL)' % ','.join('?' * len(pats)), pats + [typ, typ])
        row('follow', 'Seriale urmărite', [t for t in fl if allowed(p, t)])
    kids = bool(p and p['kind'] == 'kids')
    specs = discover.kids_rows(typ) if kids else discover.home_rows(typ)
    results = await asyncio.gather(*[discover.row_ids(kind, t, g) for _, _, kind, t, g in specs])
    hero_ids = []
    for (key, title_, kind, t, g), ids in zip(specs, results):
        cs = cards_for(p, ids, agg)
        if kind == 'kidstop':
            cs = cs[:10]
        if kind in ('nfx', 'imdb10', 'kidstop'):
            for i, c in enumerate(cs):
                c['rank'] = i + 1
            if kind == 'nfx':
                wk = discover.week_label(discover.top_ids('nfx', t)['week'])
                title_ = title_ + (' · ' + wk if wk else '')
        if len(cs) >= 4:
            link = '' if kind in ('nfx', 'imdb10', 'kidstop') else '#/browse?type=%s' % t + ('&genre=' + g if g else '&sort=' + ('score' if kind == 'best' else 'newest' if kind == 'new' else 'popular'))
            rows.append({'key': key, 'title': title_, 'items': cs[:40], 'link': link})
        if kind == 'pop':
            hero_ids += ids[:8]
    if p and not kids:
        recent = db.q('SELECT DISTINCT m.imdb FROM progress pr JOIN media_file m ON m.id=pr.media_id WHERE pr.profile_id=? '
                      'ORDER BY pr.updated_at DESC LIMIT 6', (p['id'],)) if 'updated_at' in progress_cols() else []
        done = 0
        for r in recent:
            src = db.q1('SELECT * FROM title WHERE imdb=?', (r['imdb'],))
            if not src or (typ and src['type'] != typ) or done >= 2:
                continue
            gs = [x for x in (db.jl(src['genres'], []) or []) if x in discover.GENRES.get(src['type'], [])]
            if not gs:
                continue
            cand = []
            for g in gs[:2]:
                cand += await discover.catalog(src['type'], 'top', g, 0)
            want = set(gs)
            rows_ = {x['imdb']: x for x in db.q('SELECT * FROM title WHERE imdb IN (%s)' % ','.join('?' * len(cand)), cand)} if cand else {}
            pick = [i for i in dict.fromkeys(cand) if i != src['imdb'] and i in rows_ and len(want & set(db.jl(rows_[i]['genres'], []) or [])) >= min(2, len(want))]
            cs = cards_for(p, pick, agg)
            if len(cs) >= 4:
                rows.insert(min(len(rows), 6 + done), {'key': 'because:' + src['imdb'], 'title': 'Pentru că te-ai uitat la ' + src['name'], 'items': cs[:30], 'link': ''})
                done += 1
    hero_t = [t for t in by_added if t['imdb'].startswith('tt') and t['background_url']][:2]
    if hero_ids:
        hr = {r['imdb']: r for r in db.q('SELECT * FROM title WHERE imdb IN (%s)' % ','.join('?' * len(hero_ids)), hero_ids)}
        hero_t += [hr[i] for i in hero_ids if i in hr and hr[i]['background_url'] and allowed(p, hr[i])][:6 - len(hero_t)]
    return {'hero': [hero(t, agg.get(t['imdb'], {})) for t in hero_t], 'rows': rows}


async def browse(request):
    p, qy = request['profile'], request.query
    if not (qy.get('sort') == 'added' or qy.get('library') == '1' or qy.get('res') or qy.get('hdr') or qy.get('rosub')):
        return await browse_all(request)
    ts, agg = lib_rows(p, qy.get('type') or None)
    g = qy.get('genre')
    if g:
        ts = [t for t in ts if g in (db.jl(t['genres'], []) or [])]
    if qy.get('res') == '2160p':
        ts = [t for t in ts if agg[t['imdb']]['w'] >= 3000]
    if qy.get('hdr'):
        ts = [t for t in ts if agg[t['imdb']]['hdr']]
    if qy.get('rosub') == '1':
        ts = [t for t in ts if agg[t['imdb']]['rosub']]
    if qy.get('min_rating'):
        ts = [t for t in ts if (t['imdb_rating'] or 0) >= float(qy['min_rating'])]
    sort = qy.get('sort') or 'added'
    if sort in ('score',):
        ts.sort(key=lambda t: -(t['imdb_rating'] or 0))
    elif sort in ('year', 'newest'):
        ts.sort(key=lambda t: -(t['year'] or 0))
    else:
        ts.sort(key=lambda t: -agg[t['imdb']]['added'])
    page = max(1, int(qy.get('page') or 1))
    genres = sorted({g for t in ts for g in (db.jl(t['genres'], []) or [])})
    sl = ts[(page - 1) * 48: page * 48]
    return jok({'items': [card(t, agg[t['imdb']]) for t in sl], 'more': len(ts) > page * 48, 'genres': genres})


async def browse_all(request):
    """Everything (not only the NAS): popular titles of a type, optionally one genre, sorted popular / score / newest."""
    import asyncio
    p, qy = request['profile'], request.query
    types = [qy['type']] if qy.get('type') in ('series', 'movie') else ['series', 'movie']
    g = qy.get('genre') or None
    sort = qy.get('sort') or 'popular'
    page = max(1, int(qy.get('page') or 1))
    skip = (page - 1) * 50
    lists = await asyncio.gather(*[discover.catalog(t, 'top', g, skip) for t in types])
    ids = []
    for grp in zip(*lists) if len(lists) > 1 else [(i,) for i in lists[0]]:
        ids += [i for i in grp if i not in ids]
    if len(lists) > 1:
        for l_ in lists:
            ids += [i for i in l_ if i not in ids]
    agg = library_titles()
    cs = cards_for(p, ids, agg)
    if sort == 'score':
        cs.sort(key=lambda c: -(c['rating'] or 0))
    elif sort in ('newest', 'year'):
        cs.sort(key=lambda c: -(c['year'] or 0))
    if qy.get('min_rating'):
        cs = [c for c in cs if (c['rating'] or 0) >= float(qy['min_rating'])]
    gl = sorted({x for t in types for x in discover.GENRES[t]})
    return jok({'items': cs, 'more': any(len(l_) >= 40 for l_ in lists), 'genres': gl,
                'genreNames': {x: discover.GENRE_RO.get(x, x) for x in gl}})


def seasons_for(t):
    files = db.q('SELECT season, episode FROM media_file WHERE imdb=? AND missing=0 AND season IS NOT NULL', (t['imdb'],))
    have = {(f['season'], f['episode']) for f in files}
    eps = {}
    for v in db.jl(t['videos'], []) or []:
        eps.setdefault(v['s'], {})[v['e']] = {'episode': v['e'], 'name': v['name'] or 'Episodul %d' % v['e'], 'overview': v['overview'],
                                              'released': v['released'], 'thumb': bool(v['thumb'])}
    for s, e in have:
        eps.setdefault(s, {}).setdefault(e, {'episode': e, 'name': 'Episodul %d' % e, 'overview': '', 'released': '', 'thumb': False})
    er = discover.ep_ratings(t['imdb'])
    out = []
    for s in sorted(eps):
        if s == 0 and not any(x[0] == 0 for x in have):
            continue
        el = []
        for e in sorted(eps[s]):
            x = dict(eps[s][e])
            r = er.get((s, e))
            x.update({'versions': [], 'inPlex': False, 'plexLink': None, 'download': None, 'rating': r[0] if r else None,
                      'votes': r[1] if r else None})
            el.append(x)
        today = time.strftime('%Y-%m-%d')
        aired = len([1 for x in el if x.get('released') and x['released'][:10] <= today] or [1 for x in have if x[0] == s])
        out.append({'season': s, 'inPlex': 0, 'available': len([1 for x in have if x[0] == s]), 'aired': max(aired, len([1 for x in have if x[0] == s])),
                    'packs': [], 'episodes': el})
    return out


async def title(request):
    imdb = request.match_info['imdb']
    p = request['profile']
    t = db.q1('SELECT * FROM title WHERE imdb=?', (imdb,))
    if (not t or not t['meta_at']) and imdb.startswith('tt'):
        import aiohttp
        async with aiohttp.ClientSession() as s_:
            await library.ensure_title(s_, imdb, t['name'] if t else '', t['year'] if t else None, t['type'] if t else 'series')
        db.x('UPDATE title SET imdb_rating=(SELECT rating FROM imdb_rating WHERE tconst=?) WHERE imdb=? AND '
             'EXISTS(SELECT 1 FROM imdb_rating WHERE tconst=?)', (imdb, imdb, imdb))
        t = db.q1('SELECT * FROM title WHERE imdb=?', (imdb,))
    if not t or not allowed(p, t):
        return jerr(404, 'title not found')
    if request.query.get('norefresh') != '1' or not db.q1('SELECT 1 FROM release WHERE imdb=? LIMIT 1', (imdb,)):
        await filelist.refresh(imdb)
    dls = await filelist.downloads_for(imdb)
    dl_by_rel = {d['releaseId']: d for d in dls}
    from . import extra  # opening a title kicks a trailer prefetch
    extra.want(imdb, front=True)
    trailer_state = extra.state(imdb)
    agg = library_titles()
    c = card(t, agg.get(imdb))
    following = bool(db.q1('SELECT 1 FROM follow WHERE pattern=?', (t['name'],)) or db.q1('SELECT 1 FROM watch WHERE imdb=?', (imdb,)))
    genres = db.jl(t['genres'], []) or []
    sim = []
    if genres:
        ts, _ = lib_rows(p)
        sim = [x for x in ts if x['imdb'] != imdb and set(genres) & set(db.jl(x['genres'], []) or [])]
        random.Random(imdb).shuffle(sim)
    c.update({'description': t['description'] or '', 'descriptionEn': t['description'] or '', 'descriptionRo': None, 'yearEnd': t['year_end'],
              'runtime': t['runtime_min'], 'status': None, 'cast': db.jl(t['cast_'], []), 'director': db.jl(t['director'], []), 'writer': [],
              'genresAll': genres, 'released': t['released'],
              'versions': [filelist.release_out(r, dl_by_rel.get(r['id'])) for r in filelist.releases(imdb)][:60],
              'recommended': (filelist.pick(imdb) or {'id': None})['id'] if t['type'] == 'movie' else None, 'versionsStale': False,
              'following': following, 'plex': None, 'downloads': dls, 'inLibrary': imdb in agg,
              'imdbUrl': 'https://www.imdb.com/title/%s/' % imdb if imdb.startswith('tt') else None,
              'trailerReady': trailer_state == 'ready', 'trailerState': trailer_state, 'similar': [card(x, agg.get(x['imdb'])) for x in sim[:18]]})
    if t['type'] == 'series':
        discover.want_series(imdb)
        c['seasons'] = seasons_for(t)
        rels = filelist.releases(imdb)
        for se in c['seasons']:
            se['packs'] = [r['id'] for r in rels if r['season'] == se['season'] and r['pack']]
            for ep in se['episodes']:
                ep['versions'] = [r['id'] for r in rels if r['season'] == se['season'] and r['episode'] == ep['episode']]
                ep['download'] = next((d for d in dls if d['season'] == se['season'] and d['episode'] == ep['episode']), None)
    c['downloading'] = any(d['state'] in ('downloading', 'queued') for d in dls)
    return jok(c)


async def search(request):
    qs = library.norm(request.query.get('q') or '')
    p = request['profile']
    ts, agg = lib_rows(p)
    hits = []
    if qs:
        for t in ts:
            n = library.norm(t['name'])
            if qs in n or all(w in n for w in qs.split()):
                hits.append((0 if n.startswith(qs) else 1, t))
            elif qs in library.norm(' '.join(db.jl(t['cast_'], []) or [])):
                hits.append((2, t))
    hits.sort(key=lambda x: (x[0], -(x[1]['imdb_rating'] or 0)))
    people = []
    if qs:
        for t in ts:
            for c in db.jl(t['cast_'], []) or []:
                if qs in library.norm(c) and {'name': c} not in people:
                    people.append({'name': c})
    out = {'titles': [card(t, agg[t['imdb']]) for _, t in hits[:60]], 'people': people[:10], 'filters': {}}
    if request.path.endswith('/live') and qs and not (p and p['kind'] == 'kids'):
        import aiohttp
        async with aiohttp.ClientSession() as s_:
            ids = await filelist.live_titles(s_, request.query.get('q') or '')
        have = {c['imdb'] for c in out['titles']}
        new = [i for i in ids if i not in have]
        out['titles'] += cards_for(p, new, agg)
        out['live'] = {'found': len(new), 'new': new}
    return jok(out)


async def mylist(request):
    p = request['profile']
    if not p:
        return jok({'items': [], 'imdbs': []})
    ids = [r['imdb'] for r in db.q('SELECT imdb FROM mylist WHERE profile_id=? ORDER BY added_at DESC', (p['id'],))]
    return jok({'items': cards_for(p, ids), 'imdbs': ids})


async def mylist_add(request):
    db.x('INSERT OR IGNORE INTO mylist(profile_id, imdb, added_at) VALUES(?,?,?)', (request['profile']['id'], request.match_info['imdb'], db.now()))
    return jok({'ok': True, 'inList': True})


async def mylist_del(request):
    db.x('DELETE FROM mylist WHERE profile_id=? AND imdb=?', (request['profile']['id'], request.match_info['imdb']))
    return jok({'ok': True, 'inList': False})


async def rate(request):
    b = await body(request)
    v = b.get('value')
    if v not in (-1, 0, 1, 2):
        return jerr(400, 'bad value')
    db.x('INSERT INTO rating(profile_id, imdb, value) VALUES(?,?,?) ON CONFLICT(profile_id, imdb) DO UPDATE SET value=excluded.value',
         (request['profile']['id'], request.match_info['imdb'], v))
    return jok({'ok': True, 'value': v})


async def recent(request):
    agg = library_titles()
    ids = [i for i, _ in sorted(agg.items(), key=lambda x: -x[1]['added'])][:30]
    return jok({'items': cards_for(request['profile'], ids, agg)})


_show_cache = {}


async def showcase(request):
    """Profile-picker slideshow: kids -> allowed titles; adult -> no Animation/Family/Kids, never Horror/Thriller; backdrop
    required; daily shuffle per profile; library first, then what is popular now; cached 30 min."""
    pid = int(request.match_info['id'])
    hit = _show_cache.get(pid)
    if hit and time.time() - hit[0] < 1800:
        return jok({'items': hit[1]})
    p = db.q1('SELECT * FROM profile WHERE id=?', (pid,))
    if not p:
        return jerr(404, 'profile not found')
    ts, agg = lib_rows(p)
    pool = await discover.row_ids('pop', 'series') + await discover.row_ids('pop', 'movie')
    extra = db.q('SELECT * FROM title WHERE imdb IN (%s)' % ','.join('?' * len(pool)), pool) if pool else []
    seen = {t['imdb'] for t in ts}
    ts = list(ts) + [t for t in extra if t['imdb'] not in seen and allowed(p, t)]
    def ok(t):
        if not (t['imdb'].startswith('tt') and t['background_url']):
            return False
        g = set(db.jl(t['genres'], []) or [])
        if p['kind'] == 'kids':
            return allowed(p, t)
        return not (g & {'Animation', 'Family', 'Kids', 'Horror', 'Thriller'})
    lib = [t for t in ts if ok(t) and t['imdb'] in agg]
    rest = [t for t in ts if ok(t) and t['imdb'] not in agg]
    rnd = random.Random('%s:%s' % (pid, time.strftime('%Y-%m-%d')))
    rnd.shuffle(lib)
    rnd.shuffle(rest)
    ts = lib[:4] + rest
    out = []
    for t in ts[:8]:
        c = card(t, agg.get(t['imdb']))
        out.append({k: c[k] for k in ('imdb', 'type', 'name', 'nameRo', 'year', 'genres', 'logo', 'backdrop', 'new', 'certAge')})
    _show_cache[pid] = (time.time(), out)
    return jok({'items': out})


async def img(request):
    mi = request.match_info
    kind = mi['kind']
    if kind not in ('poster', 'backdrop', 'logo', 'episode'):
        return jerr(404, 'no image')
    s = int(mi['s']) if mi.get('s') else None
    e = int(mi['e']) if mi.get('e') else None
    fn = await library.image_path(kind, mi['imdb'], s, e)
    if not fn:
        return jerr(404, 'no image')
    with open(fn, 'rb') as f:
        head = f.read(8)
    ct = 'image/png' if head.startswith(b'\x89PNG') else 'image/webp' if head[:4] == b'RIFF' else 'image/jpeg'
    return web.FileResponse(fn, headers={'Content-Type': ct, 'Cache-Control': 'private, max-age=604800'})


def routes(app):
    r = app.router
    r.add_get('/api/home', home)
    r.add_get('/api/browse', browse)
    r.add_get('/api/title/{imdb}', title)
    r.add_get('/api/search', search)
    r.add_get('/api/search/live', search)
    r.add_get('/api/mylist', mylist)
    r.add_post('/api/mylist/{imdb}', mylist_add)
    r.add_delete('/api/mylist/{imdb}', mylist_del)
    r.add_post('/api/rating/{imdb}', rate)
    r.add_get('/api/library/recent', recent)
    r.add_get('/api/profiles/{id:\\d+}/showcase', showcase)
    r.add_get('/img/{kind}/{imdb}', img)
    r.add_get('/img/{kind}/{imdb}/{s:\\d+}/{e:\\d+}', img)
