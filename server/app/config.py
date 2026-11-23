"""All settings come from the environment (.env via docker compose). Nothing secret lives in code."""
import ipaddress
import os
import secrets


def env(k, d=''):
    return (os.environ.get(k) or d).strip()


def env_int(k, d):
    try:
        return int(env(k, str(d)))
    except ValueError:
        return d


PORT = env_int('PORT', 8090)
DATA_DIR = env('DATA_DIR', '/data')
MEDIA_DIR = env('MEDIA_DIR', '/media')
TMP_DIR = env('TMP_DIR', '/tmp')
TZ = env('TZ', 'Europe/Bucharest')

# Address the phone uses to open the admin/pairing page (shown as QR on the TV), e.g. http://192.168.1.50:8090
WEB_URL = env('WEB_URL', 'http://localhost:8090').rstrip('/')

# Who may open the admin web page without a device token: loopback + your home LAN.
LAN_CIDR = env('LAN_CIDR', '192.168.1.0/24')
TRUSTED = []
for c in ['127.0.0.0/8', '::1/128'] + [x for x in LAN_CIDR.replace(';', ',').split(',') if x.strip()]:
    try:
        TRUSTED.append(ipaddress.ip_network(c.strip(), strict=False))
    except ValueError:
        pass

# FileList RSS (contains the passkey: only in .env, never logged)
RSS_URL = env('FILELIST_RSS_URL')
RSS_INTERVAL_MIN = max(5, env_int('RSS_INTERVAL_MIN', 15))
RSS_MODE = env('RSS_MODE', 'follow').lower()          # follow = only followed shows; all = everything in the feed
RSS_INCLUDE = env('RSS_INCLUDE')                       # optional regex, e.g. 1080p
RSS_EXCLUDE = env('RSS_EXCLUDE', r'\b(CAM|TS|HDCAM|TELESYNC)\b')
RSS_MAX_GB = float(env('RSS_MAX_GB', '0') or 0)        # 0 = no limit
RSS_BACKFILL = env('RSS_BACKFILL', '0') == '1'         # 1 = on the very first run also download what is already in the feed

# qBittorrent (in the same compose)
QBT_URL = env('QBT_URL', 'http://qbittorrent:8080').rstrip('/')
QBT_USER = env('QBT_USER')
QBT_PASS = env('QBT_PASS')
QBT_CATEGORY = env('QBT_CATEGORY', 'bubuflix')
QBT_SAVE_PATH = env('QBT_SAVE_PATH', '/media/downloads').rstrip('/')

# FileList API (search + download any title). Passkey falls back to the one in the RSS URL.
FL_USER = env('FILELIST_USER')
FL_PASSKEY = env('FILELIST_PASSKEY')
if not FL_PASSKEY and 'passkey=' in RSS_URL:
    import re as _re
    _m = _re.search(r'passkey=([A-Za-z0-9]+)', RSS_URL)
    FL_PASSKEY = _m.group(1) if _m else ''

# Public listener (reached through the Tailscale Funnel): no IP trust at all, token or password login only.
PUBLIC_PORT = env_int('PUBLIC_PORT', 8091)
# Direct public listener (router port forward -> HTTPS with the Home Assistant certificate): same rules as the Funnel port.
DIRECT_PORT = env_int('DIRECT_PORT', 8443)
SSL_CERT = env('SSL_CERT', '/ssl/fullchain.pem')
SSL_KEY = env('SSL_KEY', '/ssl/privkey.pem')
# tell browsers to use the direct port only when it is reachable from the internet (not behind the ISP's CGNAT)
DIRECT_ADVERTISE = env('DIRECT_ADVERTISE') == '1'
WEB_PASSWORD = env('WEB_PASSWORD')
WEB_ORIGINS = [o.strip().rstrip('/') for o in env('WEB_ORIGINS', '').split(',') if o.strip()]

SCAN_INTERVAL_MIN = max(2, env_int('SCAN_INTERVAL_MIN', 10))
MAX_TRANSCODES = max(1, env_int('MAX_TRANSCODES', 2))
DISABLE_JOBS = env('DISABLE_JOBS') == '1'


def _hmac_secret():
    v = env('APP_HMAC_SECRET')
    if v:
        return v
    p = os.path.join(DATA_DIR, 'hmac_secret')
    try:
        with open(p) as f:
            v = f.read().strip()
    except OSError:
        v = ''
    if not v:
        v = secrets.token_hex(32)
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(p, 'w') as f:
            f.write(v)
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
    return v


HMAC_SECRET = _hmac_secret()

SECRETS = [s for s in (RSS_URL, QBT_PASS, HMAC_SECRET, FL_PASSKEY, WEB_PASSWORD) if s and len(s) > 4]


def mask(s):
    s = str(s)
    for x in SECRETS:
        s = s.replace(x, '***')
    import re
    return re.sub(r'(passkey=)[A-Za-z0-9]+', r'\1***', s)
