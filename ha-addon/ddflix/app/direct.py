"""Direct remote access: HTTPS on DIRECT_PORT with the Home Assistant certificate (/ssl, e.g. DuckDNS + Let's Encrypt).
The router forwards this port to the server, so video flows at the home upload speed (Tailscale Funnel is far too slow
for video). The listener starts as soon as the certificate exists and picks up renewals by itself; like the Funnel port
it trusts no IP: password login or device token only."""
import logging
import os
import ssl

from aiohttp import web

from . import config

log = logging.getLogger('direct')
S = {'site': None, 'mtime': 0, 'ctx': None, 'host': ''}


def host_of(cert):
    try:
        d = ssl._ssl._test_decode_cert(cert)
        names = [v for k, v in d.get('subjectAltName', ()) if k == 'DNS' and '*' not in v]
        return names[0] if names else ''
    except Exception:
        return ''


def url():
    """Public address of the direct listener, '' while it is not running."""
    return 'https://%s:%d' % (S['host'], config.DIRECT_PORT) if S['site'] and S['host'] else ''


async def check(runner):
    c, k = config.SSL_CERT, config.SSL_KEY
    if not (os.path.exists(c) and os.path.exists(k)):
        return
    mt = os.path.getmtime(c)
    if mt == S['mtime']:
        return
    try:
        if S['ctx'] is None:
            S['ctx'] = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        S['ctx'].load_cert_chain(c, k)  # a renewal is loaded into the same context: new connections get the new one
    except Exception as e:
        log.warning('certificate: %s', str(e)[:200])
        S['mtime'] = mt
        return
    S['mtime'], S['host'] = mt, host_of(c)
    if not S['site']:
        S['site'] = web.TCPSite(runner, None, config.DIRECT_PORT, ssl_context=S['ctx'])  # None = IPv4 + IPv6 (host network)
        await S['site'].start()
        log.info('direct HTTPS on :%d for %s', config.DIRECT_PORT, S['host'] or '?')
    else:
        log.info('certificate reloaded for %s', S['host'] or '?')
