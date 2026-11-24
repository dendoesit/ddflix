"""HA add-on entry: options.json -> env, start qbittorrent-nox (supervised) + DDflix server."""
import json
import os
import subprocess
import sys

opts = {}
try:
    with open('/data/options.json') as f:
        opts = json.load(f)
except OSError:
    pass

lan = opts.get('lan_cidr') or '192.168.1.0/24'
env = dict(os.environ)
env.update({
    'MEDIA_DIR': opts.get('media_dir') or '/media/nas',
    'QBT_SAVE_PATH': opts.get('download_dir') or opts.get('media_dir') or '/media/nas',
    'QBT_URL': 'http://127.0.0.1:8080',
    'QBT_CATEGORY': 'ddflix',
    'FILELIST_USER': opts.get('filelist_user') or '',
    'FILELIST_RSS_URL': opts.get('filelist_rss_url') or '',
    'RSS_MODE': opts.get('rss_mode') or 'follow',
    'WEB_PASSWORD': opts.get('web_password') or '',
    'TMDB_API_KEY': opts.get('tmdb_key') or '',
    'WEB_URL': opts.get('web_url') or 'http://192.168.1.156:8090',
    'LAN_CIDR': lan + ',172.30.32.0/23',
    'MAX_TRANSCODES': os.environ.get('MAX_TRANSCODES', '1'),  # HA Green: 4 small ARM cores
})

# qBittorrent: profile in /data/qbt, no password for localhost/LAN, legal notice accepted, saves to the NAS
BS = chr(92)  # backslash, as qBittorrent.conf keys use it
conf_dir = '/data/qbt/qBittorrent/config'
conf = os.path.join(conf_dir, 'qBittorrent.conf')
os.makedirs(conf_dir, exist_ok=True)
if not os.path.exists(conf):
    save = env['QBT_SAVE_PATH']
    lines = [
        '[LegalNotice]', 'Accepted=true', '',
        '[BitTorrent]', 'Session' + BS + 'DefaultSavePath=' + save, 'Session' + BS + 'Port=6881',
        'Session' + BS + 'TempPathEnabled=false', '',
        '[Preferences]', 'Downloads' + BS + 'SavePath=' + save + '/', 'WebUI' + BS + 'Port=8080',
        'WebUI' + BS + 'LocalHostAuth=false', 'WebUI' + BS + 'AuthSubnetWhitelistEnabled=true',
        'WebUI' + BS + 'AuthSubnetWhitelist=127.0.0.0/8, 172.30.32.0/23, ' + lan,
        'WebUI' + BS + 'HostHeaderValidation=false', 'WebUI' + BS + 'CSRFProtection=false', '',
    ]
    with open(conf, 'w') as f:
        f.write(chr(10).join(lines))

# The launcher stays PID 1 and shuts everything down cleanly: qBittorrent must get SIGTERM and time to write its resume
# data, otherwise after every add-on restart it believes the running downloads are back at their last save (hours of
# progress lost and downloaded again; a title being watched while downloading suddenly has nothing on disk).
import signal
import time

STOP = {'now': False}
# qBittorrent restarted if it ever exits (own process group so it can be stopped as a whole)
qbt = subprocess.Popen(['sh', '-c', 'trap "kill -TERM $child; wait $child; exit 0" TERM; while true; do '
                        'qbittorrent-nox --profile=/data/qbt --webui-port=8080 & child=$!; wait $child; sleep 5; done'],
                       env=env, stdin=subprocess.DEVNULL, start_new_session=True)
procs = [qbt]
# remote access (Tailscale Funnel) for the web app outside home; a separate supervised process
if opts.get('remote_access', True):
    procs.append(subprocess.Popen(['python', '/remote.py'], env=env, stdin=subprocess.DEVNULL, start_new_session=True))
app = subprocess.Popen(['python', '-m', 'app.main'], env=env, cwd='/app')


def stop(*_):
    if STOP['now']:
        return
    STOP['now'] = True
    print('[launcher] stopping: qBittorrent saves its downloads first', flush=True)
    for p in [app] + procs[1:]:
        try:
            p.terminate()
        except Exception:
            pass
    try:
        os.killpg(qbt.pid, signal.SIGTERM)
    except Exception:
        pass
    end = time.time() + 25
    while time.time() < end and qbt.poll() is None:
        time.sleep(0.5)
    print('[launcher] qBittorrent %s' % ('stopped cleanly' if qbt.poll() is not None else 'did not stop in 25 s'), flush=True)
    sys.exit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
while not STOP['now']:
    if app.poll() is not None:  # the server died: let the supervisor restart the whole add-on (clean stop first)
        stop()
    time.sleep(1)
