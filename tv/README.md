# BUBUFLIX for Samsung TV (Tizen web app)

Plain ES2018 (the 2021 TV runs Chromium 76), no build step. Owner steps (certificate, install): `SETUP.md`.

- `js/api.js`: server base (`https://tv.example.com`; LAN direct once the owner opens port 8090), device token (pairing), `X-Profile` (+ ticket for PIN profiles), retries.
- `js/nav.js`: D-pad focus (pure `nextFocus`, tested by `node test/nav.test.js`); rows remember their last card.
- `js/main.js`: Pair → Who's watching (+ PIN with number keys) → Home (hero, genre chips under it, ≤ 8 rows, fixed-left focus, expand-on-focus cards) → Title (tabs Details / Audio & subs / Similar, Play/Resume/Start over, episodes) → Search (A-Z keyboard with ă â î ș ț) → Help (server check, reload, sign out; RED key).
- `js/player.js`: AVPlay (direct MKV/MP4 incl. 4K HDR10/DoVi P8; HLS sessions), `<video>` fallback, own subtitle overlay with the profile style, ▲ Audio & subs, ▼ Quality (Auto/Original/1080p/720p), ◀▶ 10 s, FF/RW 30 s, next-episode countdown, progress every 10 s, fallback ladder direct → HLS → 1080p.
- PIN / maturity / profiles are edited on the web only (U10).
- Remote limits: through Cloudflare the server caps at 1080p ~8 Mb/s (owner default Q2), so 4K needs the LAN path.
