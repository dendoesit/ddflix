"""Device pairing, device tokens, guard middleware, profiles + PIN tickets."""
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import time

from aiohttp import web

from . import config, db
from .util import jerr, jok

ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
_rate = {}  # (bucket, key) -> [timestamps]


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def limited(bucket, key, n, window):
    t = time.time()
    k = (bucket, key)
    l = [x for x in _rate.get(k, []) if t - x < window]
    if len(l) >= n:
        _rate[k] = l
        return True
    l.append(t)
    _rate[k] = l
    return False


def is_public(request):
    try:
        return request.transport.get_extra_info('sockname')[1] == config.PUBLIC_PORT
    except Exception:
        return True


def peer_ip(request):
    if is_public(request):  # behind Tailscale Funnel: the proxy APPENDS the real client to X-Forwarded-For (earlier values are client-supplied)
        xf = request.headers.get('X-Forwarded-For', '').split(',')[-1].strip()
        if xf:
            return xf
    return request.remote or ''


def trusted(request):
    if is_public(request):
        return False
    try:
        ip = ipaddress.ip_address(peer_ip(request))
    except ValueError:
        return False
    return any(ip in n for n in config.TRUSTED)


def ticket(device_id, profile_id):
    return hmac.new(config.HMAC_SECRET.encode(), ('%s:%s' % (device_id, profile_id)).encode(), hashlib.sha256).hexdigest()[:24]


def device_from_token(tok, ip):
    if not tok or len(tok) < 20:
        return None
    d = db.q1('SELECT * FROM device WHERE token_hash=? AND revoked=0', (sha(tok),))
    if d and (db.now() - (d['last_seen'] or 0) > 60):
        db.x('UPDATE device SET last_seen=?, last_ip=? WHERE id=?', (db.now(), ip, d['id']))
    return d


def profile_row(pid):
    return db.q1('SELECT * FROM profile WHERE id=?', (pid,))


def default_profile(dev):
    if dev and dev['profile_id']:
        p = profile_row(dev['profile_id'])
        if p and not p['pin_hash']:
            return p
    return db.q1("SELECT * FROM profile WHERE pin_hash IS NULL OR pin_hash='' ORDER BY kind='kids' DESC, id LIMIT 1")


PUBLIC = ('/api/device/pair/start', '/api/device/pair/poll', '/api/device/ping', '/api/health', '/api/where', '/api/web/login')


@web.middleware
async def guard(request, handler):
    """CORS headers on EVERY response, errors included: a 401 without them reaches the web app as a bare 'NetworkError'."""
    try:
        resp = await _guard(request, handler)
    except web.HTTPException as e:
        for k, v in cors_headers().items():
            e.headers.setdefault(k, v)
        raise
    if not getattr(resp, 'prepared', False):
        for k, v in cors_headers().items():
            resp.headers.setdefault(k, v)
    return resp


async def _guard(request, handler):
    path = request.path
    if request.method == 'OPTIONS':
        return web.Response(status=204, headers=cors_headers())
    tok = ''
    ah = request.headers.get('Authorization', '')
    if ah.startswith('Bearer '):
        tok = ah[7:].strip()
    tok = tok or request.cookies.get('bf_device', '') or request.query.get('t', '')
    dev = device_from_token(tok, peer_ip(request))
    request['device'] = dev
    request['web'] = False
    request['profile'] = None
    if is_public(request) and path.startswith('/api/device/pair/'):
        return jerr(404, 'not found')  # TVs pair only at home
    if dev and dev['kind'] == 'web':
        request['web'] = True  # web app login (password) = admin
    if dev:
        if not request['web'] and (path.startswith('/api/admin') or (request.method != 'GET' and (
                path.startswith('/api/settings') or path.startswith('/api/downloads')))):
            return jerr(403, 'not allowed from a device')
        raw = request.headers.get('X-Profile') or request.query.get('p') or ''
        request['profile_explicit'] = bool(raw)
        if raw:
            pid, _, tk = raw.partition('.')
            try:
                p = profile_row(int(pid))
            except ValueError:
                p = None
            if not p or (p['pin_hash'] and not hmac.compare_digest(tk, ticket(dev['id'], p['id']))):
                return jerr(403, 'profile locked: enter the PIN again')
            request['profile'] = p
        else:
            request['profile'] = default_profile(dev)
        kp = request['profile']
        if kp and kp['kind'] == 'kids' and (path.startswith('/api/admin') or path.startswith('/api/settings') or path.startswith('/api/downloads')
                                            or path.startswith('/api/devices') or path == '/api/device/pair/approve'):
            return jerr(403, 'not available on a kids profile')
    elif path in PUBLIC or path.startswith('/s/') or path.startswith('/w/') or path == '/web' or path.startswith('/web/'):
        pass
    elif trusted(request):
        request['web'] = True
        pid = request.headers.get('X-Profile') or request.cookies.get('bf_profile') or ''
        p = None
        if pid.split('.')[0].isdigit():
            p = profile_row(int(pid.split('.')[0]))
        request['profile'] = p or db.q1('SELECT * FROM profile ORDER BY admin DESC, id LIMIT 1')
    else:
        if path.startswith('/api/'):
            return jerr(401, 'unauthorized')
        return web.Response(status=403, text='forbidden')
    try:
        resp = await handler(request)
    except web.HTTPException as e:
        if path.startswith('/api/') and e.status >= 400:
            return jerr(e.status, e.reason or 'error')
        raise
    except Exception as e:  # noqa
        import logging
        logging.exception('unhandled')
        return jerr(500, config.mask(e)[:200])
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    if path.startswith('/api/') and (resp.content_type or '').startswith('application/json'):
        resp.headers['Cache-Control'] = 'no-store'
    for k, v in cors_headers().items():
        resp.headers.setdefault(k, v)
    return resp


def cors_headers():
    # the Tizen widget runs from file:// (Origin null); nothing here is cookie-authenticated cross-site
    return {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, X-Profile, Content-Type, Range',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Retry-After, X-Subs-Pending'}


# ---------------- web login (password from .env -> long-lived web token)
_FAILS = []


def _fails_public():
    t = time.time()
    _FAILS[:] = [x for x in _FAILS if t - x < 3600]
    return len(_FAILS)


async def web_login(request):
    ip = peer_ip(request)
    if limited('login', ip, 8, 900):
        return jerr(429, 'Prea multe încercări, așteaptă 15 minute')
    b = {}
    try:
        b = await request.json()
    except Exception:
        pass
    if is_public(request) and _fails_public() >= 20:  # whole internet: 20 wrong passwords / hour -> remote login closed for 1 h
        return jerr(429, 'Prea multe încercări greșite. Încearcă din nou peste o oră (din casă merge).')
    if not config.WEB_PASSWORD or not hmac.compare_digest(str(b.get('password') or '').encode(), config.WEB_PASSWORD.encode()):
        if is_public(request):
            _FAILS.append(time.time())
        return jerr(401, 'Parolă greșită')
    tok = secrets.token_urlsafe(32)
    did = db.x('INSERT INTO device(name, kind, token_hash, created_at, last_seen, last_ip, revoked) VALUES(?,?,?,?,?,?,0)',
               (str(b.get('name') or 'Web')[:40], 'web', sha(tok), db.now(), db.now(), ip))
    return jok({'token': tok, 'deviceId': did})


# ---------------- pairing
async def pair_start(request):
    if limited('pair', peer_ip(request), 10, 600):
        return jerr(429, 'too many attempts, wait 10 minutes')
    try:
        b = await request.json()
    except Exception:
        b = {}
    code = ''.join(secrets.choice(ALPHA) for _ in range(6))
    dc = secrets.token_urlsafe(32)
    t = db.now()
    db.x('DELETE FROM pair WHERE expires_at<?', (t,))
    db.x('INSERT INTO pair(user_code, device_hash, name, kind, created_at, expires_at) VALUES(?,?,?,?,?,?)',
         (code, sha(dc), str(b.get('name') or 'Samsung TV')[:40], str(b.get('kind') or 'tv')[:12], t, t + 600))
    return jok({'userCode': code, 'deviceCode': dc, 'expiresIn': 600, 'interval': 3,
                'verifyUrl': config.WEB_URL + '/web/#/pair', 'verifyUrlComplete': config.WEB_URL + '/web/#/settings?code=' + code})


async def pair_poll(request):
    try:
        b = await request.json()
    except Exception:
        b = {}
    r = db.q1('SELECT * FROM pair WHERE device_hash=?', (sha(str(b.get('deviceCode') or '')),))
    if not r or (r['expires_at'] < db.now() and not r['token']):
        return jerr(410, 'expired')
    if not r['token']:
        return jok({'pending': True})
    db.x('DELETE FROM pair WHERE user_code=?', (r['user_code'],))
    return jok({'token': r['token'], 'deviceId': r['device_id']})


async def pair_approve(request):
    if not request['web']:
        return jerr(403, 'approve from the web app')
    b = await request.json()
    code = str(b.get('code') or '').upper().replace('-', '').replace(' ', '')
    r = db.q1('SELECT * FROM pair WHERE user_code=? AND expires_at>=? AND token IS NULL', (code, db.now()))
    if not r:
        return jerr(404, 'unknown or expired code')
    tok = secrets.token_urlsafe(32)
    pid = b.get('profileId')
    did = db.x('INSERT INTO device(name, kind, token_hash, profile_id, created_at, last_seen, revoked) VALUES(?,?,?,?,?,?,0)',
               (str(b.get('name') or r['name'])[:40], r['kind'], sha(tok), int(pid) if pid else None, db.now(), db.now()))
    db.x('UPDATE pair SET token=?, device_id=? WHERE user_code=?', (tok, did, code))
    return jok({'ok': True, 'deviceId': did})


async def ping(request):
    d = request['device']
    if not d:
        return jerr(401, 'not paired', ok=False)
    return jok({'ok': True, 'device': d['name'], 'time': db.now()})


async def devices(request):
    if not request['web']:
        return jerr(403, 'web only')
    rows = db.q('SELECT * FROM device WHERE revoked=0 ORDER BY id')
    return jok({'items': [{'id': r['id'], 'name': r['name'], 'kind': r['kind'], 'created': r['created_at'],
                           'lastSeen': r['last_seen'], 'lastIp': r['last_ip'], 'current': False} for r in rows]})


async def device_delete(request):
    if not request['web']:
        return jerr(403, 'web only')
    db.x('UPDATE device SET revoked=1 WHERE id=?', (int(request.match_info['id']),))
    return jok({'ok': True})


# ---------------- profiles
COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'teal']
HEX = {'red': '#e50914', 'blue': '#2a7fff', 'green': '#2ecc71', 'yellow': '#f5c518', 'purple': '#9b59b6', 'orange': '#ff8a00',
       'pink': '#ff4fa3', 'teal': '#17c3b2'}


def color_of(p):
    return p['avatar'] if p['avatar'] in HEX else COLORS[p['id'] % len(COLORS)]


def free_color():
    used = {color_of(p) for p in db.q('SELECT id, avatar FROM profile')}
    free = [c for c in COLORS if c not in used] or COLORS
    return secrets.choice(free)


async def avatar_svg(request):
    m = re.match(r'^(\d+)', request.match_info['name'])
    p = profile_row(int(m.group(1))) if m else None
    if not p:
        return jerr(404, 'no avatar')
    ch = (p['name'] or '?').strip()[:1].upper() or '?'
    ch = ch.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="212" height="212" viewBox="0 0 212 212">'
           '<rect width="212" height="212" rx="20" fill="%s"/>'
           '<text x="106" y="142" font-family="Arial,Helvetica,sans-serif" font-size="110" font-weight="700" fill="#fff" '
           'text-anchor="middle">%s</text>%s</svg>') % (HEX[color_of(p)], ch,
           '<rect x="56" y="176" width="100" height="26" rx="6" fill="#fff"/><text x="106" y="196" font-family="Arial" font-size="18" '
           'font-weight="700" text-anchor="middle" fill="#000">COPII</text>' if p['kind'] == 'kids' else '')
    return web.Response(text=svg, content_type='image/svg+xml', headers={'Cache-Control': 'private, max-age=300'})


def prof_out(p):
    prefs = db.jl(p['prefs'], {}) or {}
    prefs.setdefault('audio', ['rum', 'eng'])
    prefs.setdefault('subs', ['rum', 'eng'])
    prefs.setdefault('subStyle', {'size': 'm', 'color': 'white', 'bg': 'shadow'})
    return {'id': p['id'], 'name': p['name'], 'kind': p['kind'] or 'adult', 'maxRating': p['max_rating'],
            'avatar': color_of(p), 'avatarUrl': '/api/avatars/%d-%s-%s.svg' % (p['id'], color_of(p), p['kind'] or 'adult'), 'hasPin': bool(p['pin_hash']), 'admin': bool(p['admin']), 'prefs': prefs}


async def profiles(request):
    cur = request['profile']
    return jok({'items': [prof_out(p) for p in db.q('SELECT * FROM profile ORDER BY id')], 'current': cur['id'] if cur else None})


def pin_hash(pin):
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return 'scrypt$%s$%s' % (salt.hex(), h.hex())


def pin_ok(stored, pin):
    try:
        _, s, h = stored.split('$')
        return hmac.compare_digest(hashlib.scrypt(str(pin).encode(), salt=bytes.fromhex(s), n=2 ** 14, r=8, p=1).hex(), h)
    except Exception:
        return False


async def profile_select(request):
    p = profile_row(int(request.match_info['id']))
    if not p:
        return jerr(404, 'profile not found')
    try:
        b = await request.json()
    except Exception:
        b = {}
    if p['pin_hash']:
        if limited('pin', p['id'], 5, 60) or not pin_ok(p['pin_hash'], b.get('pin') or ''):
            return jerr(403, 'wrong PIN', needPin=True)
    cur = request['profile'] if request.get('profile_explicit') else None  # only when the client really is on the Kids profile
    if cur and cur['kind'] == 'kids' and p['kind'] != 'kids' and not p['pin_hash']:
        # leaving Kids for an adult profile without a PIN
        if not request['web']:
            return jerr(403, 'Pune un PIN pe acest profil din site (Setări → Profiluri).', needPinSetup=True)
        if not b.get('confirm'):
            return jerr(409, 'Confirm to leave the Kids profile', needConfirm=True)
    out = {'ok': True, 'profile': prof_out(p)}
    if request['device']:
        out['ticket'] = ticket(request['device']['id'], p['id'])
    resp = jok(out)
    resp.set_cookie('bf_profile', str(p['id']), max_age=31536000, httponly=True, samesite='Lax')
    return resp


async def profile_prefs(request):
    pid = int(request.match_info['id'])
    cur = request['profile']
    if not cur or (cur['id'] != pid and not cur['admin']):
        return jerr(403, 'not your profile')
    p = profile_row(pid)
    if not p:
        return jerr(404, 'profile not found')
    b = await request.json()
    prefs = db.jl(p['prefs'], {}) or {}
    for k in ('audio', 'subs'):
        if isinstance(b.get(k), list):
            prefs[k] = [str(x)[:4] for x in b[k]][:5]
    if isinstance(b.get('subStyle'), dict):
        prefs['subStyle'] = {k: str(v)[:10] for k, v in b['subStyle'].items() if k in ('size', 'color', 'bg')}
    db.x('UPDATE profile SET prefs=? WHERE id=?', (json.dumps(prefs), pid))
    return jok({'ok': True, 'prefs': prefs})


# web-only profile admin
WEAK = {'1234', '4321', '0123', '9876'}


async def profile_create(request):
    if request['profile'] and request['profile']['kind'] == 'kids':
        return jerr(403, 'not available on a kids profile')
    if not request['web']:
        return jerr(403, 'web only')
    b = await request.json()
    pid = db.x('INSERT INTO profile(name, kind, max_rating, avatar, admin, prefs) VALUES(?,?,?,?,0,?)',
               (str(b.get('name') or 'Profil')[:30], 'kids' if b.get('kind') == 'kids' else 'adult', b.get('maxRating') or None,
                free_color(), json.dumps({'audio': ['rum', 'eng'], 'subs': ['rum', 'eng']})))
    return jok({'ok': True, 'profile': prof_out(profile_row(pid))})


async def profile_patch(request):
    if request['profile'] and request['profile']['kind'] == 'kids':
        return jerr(403, 'not available on a kids profile')
    if not request['web']:
        return jerr(403, 'web only')
    pid = int(request.match_info['id'])
    b = await request.json()
    if 'name' in b:
        db.x('UPDATE profile SET name=? WHERE id=?', (str(b['name'])[:30], pid))
    if 'kind' in b:
        db.x('UPDATE profile SET kind=? WHERE id=?', ('kids' if b['kind'] == 'kids' else 'adult', pid))
    if 'maxRating' in b:
        db.x('UPDATE profile SET max_rating=? WHERE id=?', (b['maxRating'] or None, pid))
    if 'avatar' in b:
        db.x('UPDATE profile SET avatar=? WHERE id=?', (str(b['avatar'])[:12], pid))
    p = profile_row(pid)
    return jok({'ok': True, 'profile': prof_out(p)}) if p else jerr(404, 'profile not found')


async def profile_delete(request):
    if request['profile'] and request['profile']['kind'] == 'kids':
        return jerr(403, 'not available on a kids profile')
    if not request['web']:
        return jerr(403, 'web only')
    pid = int(request.match_info['id'])
    if db.q1('SELECT COUNT(*) n FROM profile')['n'] <= 1:
        return jerr(400, 'cannot delete the last profile')
    db.x('DELETE FROM profile WHERE id=?', (pid,))
    return jok({'ok': True})


async def profile_pin(request):
    if request['profile'] and request['profile']['kind'] == 'kids':
        return jerr(403, 'not available on a kids profile')
    if not request['web']:
        return jerr(403, 'edit PINs on the web')
    pid = int(request.match_info['id'])
    pin = str((await request.json()).get('pin') or '')
    if pin and (len(pin) != 4 or not pin.isdigit() or len(set(pin)) == 1 or pin in WEAK):
        return jerr(400, 'PIN slab: 4 cifre, nu 1234 / 0000')
    db.x('UPDATE profile SET pin_hash=? WHERE id=?', (pin_hash(pin) if pin else None, pid))
    return jok({'ok': True})


def routes(app):
    r = app.router
    r.add_post('/api/web/login', web_login)
    r.add_post('/api/device/pair/start', pair_start)
    r.add_post('/api/device/pair/poll', pair_poll)
    r.add_post('/api/device/pair/approve', pair_approve)
    r.add_get('/api/device/ping', ping)
    r.add_get('/api/devices', devices)
    r.add_delete('/api/devices/{id:\\d+}', device_delete)
    r.add_get('/api/profiles', profiles)
    r.add_get('/api/avatars/{name}.svg', avatar_svg)
    r.add_post('/api/profiles', profile_create)
    r.add_post('/api/profiles/{id:\\d+}/select', profile_select)
    r.add_put('/api/profiles/{id:\\d+}/prefs', profile_prefs)
    r.add_patch('/api/profiles/{id:\\d+}', profile_patch)
    r.add_delete('/api/profiles/{id:\\d+}', profile_delete)
    r.add_post('/api/profiles/{id:\\d+}/pin', profile_pin)
