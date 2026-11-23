"""Remote access for the DDflix web app: Tailscale (userspace, no router changes) + Funnel -> public HTTPS to port 8091.
Writes /data/tailscale/status.json: state = starting | needs-login | needs-funnel | running | error, loginUrl, enableUrl, url,
backend. The DDflix server shows it in Settings; the public port (8091) only answers password logins / device tokens."""
import json
import os
import re
import subprocess
import threading
import time

D = '/data/tailscale'
SOCK = '/tmp/tailscaled.sock'
TS = ['tailscale', '--socket', SOCK]
os.makedirs(D, exist_ok=True)
STATUS = os.path.join(D, 'status.json')
URL_RE = re.compile(r'https://login\.tailscale\.com/\S+')
UP = {'proc': None, 'url': '', 'out': ''}
NET = {'at': 0, 'summary': {}}


def netcheck():
    """Every 10 min: what the network allows (UDP, IPv6, hard NAT) - decides direct connections vs the slow DERP relay."""
    if time.time() - NET['at'] < 600:
        return
    NET['at'] = time.time()
    rc, out = ts('netcheck', timeout=60)
    s = {}
    for line in out.splitlines():
        k, _, v = line.strip().lstrip('*').strip().partition(':')
        if k in ('UDP', 'IPv4', 'IPv6', 'MappingVariesByDestIP', 'PortMapping', 'Nearest DERP', 'CaptivePortal'):
            v = v.strip()
            if k in ('IPv4', 'IPv6') and v.startswith('yes'):
                v = 'yes'  # the address itself stays out of logs
            s[k] = v
    NET['summary'] = s
    log('netcheck ' + ', '.join('%s=%s' % kv for kv in s.items()))


def log(msg):
    print('[remote] ' + re.sub(r'(login\.tailscale\.com/a/)\S+', r'\1***', msg), flush=True)


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


def start_up():
    """One interactive login at a time; it keeps running until the login is done (never restarted while alive)."""
    if UP['proc'] is not None and UP['proc'].poll() is None:
        return
    log('tailscale up (waiting for login)')
    p = subprocess.Popen(TS + ['up', '--hostname=ddflix', '--accept-dns=false', '--qr=false'],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    UP['proc'] = p

    def reader():
        for line in p.stdout:
            UP['out'] = (UP['out'] + line)[-2000:]
            m = URL_RE.search(line)
            if m:
                UP['url'] = m.group(0)
                log('login link ready')
        log('tailscale up exited rc=%s' % p.wait())
    threading.Thread(target=reader, daemon=True).start()


def main():
    save(state='starting')
    daemon = None
    last = None
    while True:
        if daemon is None or daemon.poll() is not None:
            log('starting tailscaled')
            daemon = subprocess.Popen(['tailscaled', '--tun=userspace-networking', '--port=41641', '--statedir=' + D, '--socket=' + SOCK],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(4)
        st = status()
        backend = st.get('BackendState', '')
        if backend != last:
            log('backend ' + (backend or '?'))
            last = backend
        if backend == 'Running':
            UP['url'] = ''
            dns = ((st.get('Self') or {}).get('DNSName') or '').rstrip('.')
            url = 'https://' + dns if dns else ''
            rc, out = ts('funnel', 'status', timeout=10)
            if '8091' not in out:
                rc, out = ts('funnel', '--bg', '8091', timeout=25)
                log('funnel --bg 8091 rc=%s %s' % (rc, out.strip()[-200:]))
                if rc != 0:  # Funnel / HTTPS not enabled on the tailnet yet: the output has the link that enables it
                    m = URL_RE.search(out)
                    save(state='needs-funnel', enableUrl=m.group(0) if m else 'https://login.tailscale.com/admin/dns', url=url,
                         backend=backend, detail=out[-300:])
                    time.sleep(15)
                    continue
            netcheck()
            save(state='running', url=url, backend=backend, net=NET['summary'])
            time.sleep(30)
            continue
        if backend == 'NeedsMachineAuth':
            save(state='needs-login', loginUrl='https://login.tailscale.com/admin/machines', backend=backend)
        elif backend in ('NeedsLogin', 'NoState', 'Stopped', ''):
            start_up()
            save(state='needs-login', loginUrl=UP['url'] or st.get('AuthURL') or '', backend=backend)
        else:  # Starting
            save(state='starting', backend=backend)
        time.sleep(4)


if __name__ == '__main__':
    while True:
        try:
            main()
        except Exception as e:  # never die: the add-on keeps serving the LAN
            log('error ' + str(e)[:200])
            save(state='error', detail=str(e)[:300])
            time.sleep(30)
