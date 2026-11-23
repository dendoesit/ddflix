"""Remote access for the DDflix web app: Tailscale (userspace, no router changes) + Funnel -> public HTTPS to port 8091.
Writes /data/tailscale/status.json: state = starting | needs-login | needs-funnel | running | error, loginUrl, enableUrl, url.
The DDflix server shows it in Settings; the public port (8091) only answers password logins / device tokens."""
import json
import os
import re
import subprocess
import time

D = '/data/tailscale'
SOCK = '/tmp/tailscaled.sock'
TS = ['tailscale', '--socket', SOCK]
os.makedirs(D, exist_ok=True)
STATUS = os.path.join(D, 'status.json')
URL_RE = re.compile(r'https://login\.tailscale\.com/\S+')


def save(**kw):
    kw['at'] = int(time.time())
    tmp = STATUS + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(kw, f)
    os.replace(tmp, STATUS)


def ts(*args, timeout=20):
    try:
        p = subprocess.run(TS + list(args), capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except subprocess.TimeoutExpired as e:
        out = e.stdout or ''
        return -1, out.decode() if isinstance(out, bytes) else out


def status():
    rc, out = ts('status', '--json', timeout=10)
    try:
        return json.loads(out)
    except ValueError:
        return {}


def main():
    save(state='starting')
    daemon = None
    up = None
    login_url = ''
    while True:
        if daemon is None or daemon.poll() is not None:
            daemon = subprocess.Popen(['tailscaled', '--tun=userspace-networking', '--statedir=' + D, '--socket=' + SOCK],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(4)
        st = status()
        backend = st.get('BackendState', '')
        if backend in ('NeedsLogin', 'NoState', 'Stopped', ''):
            if up is None or up.poll() is not None:
                up = subprocess.Popen(TS + ['up', '--hostname=ddflix', '--accept-dns=false', '--qr=false'],
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                os.set_blocking(up.stdout.fileno(), False)
            try:
                chunk = up.stdout.read() or ''
            except (TypeError, OSError):
                chunk = ''
            m = URL_RE.search(chunk) or (URL_RE.search(st.get('AuthURL') or '') if st.get('AuthURL') else None)
            if m:
                login_url = m.group(0)
            save(state='needs-login', loginUrl=login_url or st.get('AuthURL') or '')
        elif backend == 'NeedsMachineAuth':
            save(state='needs-login', loginUrl='https://login.tailscale.com/admin/machines')
        elif backend == 'Running':
            dns = ((st.get('Self') or {}).get('DNSName') or '').rstrip('.')
            url = 'https://' + dns if dns else ''
            rc, out = ts('funnel', 'status', timeout=10)
            if '8091' not in out or 'Funnel on' not in out:
                rc, out = ts('funnel', '--bg', '8091', timeout=25)
                if rc != 0:  # Funnel / HTTPS not enabled on the tailnet yet: the output has the link that enables it
                    m = URL_RE.search(out)
                    save(state='needs-funnel', enableUrl=m.group(0) if m else 'https://login.tailscale.com/admin/acls', url=url,
                         detail=out[-300:])
                    time.sleep(15)
                    continue
            save(state='running', url=url)
            time.sleep(60)
            continue
        time.sleep(5)


if __name__ == '__main__':
    while True:
        try:
            main()
        except Exception as e:  # never die: the add-on keeps serving the LAN
            save(state='error', detail=str(e)[:300])
            time.sleep(30)
