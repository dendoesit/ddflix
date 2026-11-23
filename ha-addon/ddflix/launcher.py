"""HA add-on entry: options.json -> env, start qbittorrent-nox (supervised) + DDflix server."""
import json
import os
import subprocess

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

# separate supervisor process (survives the exec below; a thread would not)
subprocess.Popen(['sh', '-c', 'while true; do qbittorrent-nox --profile=/data/qbt --webui-port=8080; sleep 5; done'],
                 env=env, stdin=subprocess.DEVNULL)
os.chdir('/app')
os.execvpe('python', ['python', '-m', 'app.main'], env)
