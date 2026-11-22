/* ===== YOUR SETTINGS: the only file you need to edit =====
   Everything personal lives here: your server addresses, your name, your home location and traffic routes. */
var BF_CONFIG = {
  // Your server (see the server master prompt). LAN = direct inside your home; REMOTE = from outside (optional).
  lanApi: 'http://NAS_IP:8090',     // build-tv.ps1 -NasIp 192.168.1.X o completează
  remoteApi: '',                    // din afara casei: mai târziu (VPN / Tailscale)
  // Your server's web app (phone pairing page, profiles, PINs).
  webHost: 'NAS_IP:8090',
  // Dashboard
  ownerName: 'Dan',                  // shown in "Bună ziua, <name>"
  home: { name: 'București', region: 'București, România', lat: 44.4268, lon: 26.1025 },
  // Traffic card: three routes from home. "match" is tested against the route names your server returns (traffic.routes[].to).
  routes: [
    { match: 'univers', icon: '🏛️', label: 'Universitate', demoMin: 38 },
    { match: 'otopeni|aeroport', icon: '✈️', label: 'Otopeni', demoMin: 22 },
    { match: 'bra[sș]ov', icon: '🛣️', label: 'Brașov', demoMin: 150 }
  ]
};
