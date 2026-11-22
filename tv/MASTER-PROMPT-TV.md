# Master prompt: build my own BubuFlix app for my Samsung TVs

> Paste everything below into Claude Code, opened in the unzipped `bubuflix-tizen/` folder.
> A separate **server master prompt** sets up the media server this app talks to. Do that one first or in parallel; the TV app needs it to show movies.

---

You are helping me install and customise **BubuFlix**: a personal Netflix-style app for Samsung Tizen TVs, plus a home dashboard. This folder holds the finished, working app code. It came from a friend and was cleaned of all their personal data. Your job is to make it mine, build it and install it on my TVs. Work step by step and ask me whenever a step needs me: my Samsung account, the TV remote, passwords. Never type passwords or certificate passwords yourself.

## What the app is
- A plain ES2018 web app with no build step and no framework. The code is in `js/`, `css/` and `index.html`. Read `README.md` first.
- Screens:
  - Pair the TV with a code or QR.
  - Who's watching, with profiles and optional PINs.
  - Home with rows, title page, search and player.
  - A **dashboard** home screen: clock, weather, air quality, traffic, news slider, markets, BNR exchange rate, fuel prices, sport, live camera, and seasonal decorations such as Christmas lights and snow.
- The player is Samsung AVPlay: direct MKV/MP4, HLS, subtitles, audio and quality menus, resume.
- When the TV is switched on after more than 5 minutes off, the app opens on the dashboard. The movie profiles open from there.
- Everything personal is in **one file: `js/config.js`**:
  - server addresses;
  - my name;
  - home location (latitude and longitude);
  - three traffic routes.

## Do this, in order
1. **Check my tools.** I need:
   - Tizen Studio with CLI, plus the *Samsung Certificate Extension* and *TV Extensions* packages;
   - `sdb` and `tizen` on PATH;
   - Node.js 18 or newer (for tests and tools).

   Help me install whatever is missing on my OS.
2. **TV developer mode**, which I do on each TV: Apps → type `12345` on the remote → Developer mode ON → Host PC IP = my computer's LAN IP → restart the TV. Then `sdb connect <TV-IP>:26101` and `sdb devices`. If you get "serial number wrong", run the connect again.
3. **Certificate.** Walk me through Tizen Certificate Manager:
   - a Samsung author certificate;
   - a distributor certificate listing **every TV's DUID** (from `sdb capability` or Device Manager → Properties).

   Name the profile e.g. `MyFlix`. Remind me to back up `~/SamsungCertificate/`: without it I can't update the app later.
4. **Make it mine:**
   - `config.xml`: change the application id `BbFlx00001.BUBUFLIX` and package `BbFlx00001` to my own 10-character id, e.g. `MyFlx00001`. Also change the widget id URL. Update `tools/cdp.js` (APP) to match. Optionally rename the app.
   - `js/config.js`: fill in my server LAN URL and port, the optional remote URL and my server's web host. These come from the server setup. Also my name, home city with coordinates, and three traffic routes. The route `match` regexes must match the route names my server returns.
   - Optional: replace `icons/icon.png` and the splash (`media/splash.mp4`, `media/splash-end.jpg`) with my own branding.
5. **Build and install:**
   - `./build.sh MyFlix`. It runs `tools/check-compat.js` and the tests first, and both must pass.
   - `tizen install -n .buildResult/BUBUFLIX.wgt -s <TV-IP>:26101`.
   - For a debug launch with an inspector: `TV=<TV-IP>:26101 node tools/cdp.js launch`, then `node tools/cdp.js eval "<js>"`.
6. **Pair:** open the app on the TV, then enter the 6-letter code (or scan the QR) in my server's web app → Settings → Profiles & devices.
7. **Verify on every TV:**
   - movies play, including 4K on LAN;
   - subtitles work;
   - the dashboard cards fill with live data;
   - the camera card shows live video if I have a camera.

   Fix whatever doesn't work.

## Rules and hard-won lessons (follow them)
- **Compatibility:** keep the code ES2018, with no optional chaining and no `??`. Older TVs run Chromium 76. Always run `node tools/check-compat.js`.
- **Animations:** use only CSS `transform`/`opacity` animations. Canvas or JS-driven animation runs at about 2 fps on TVs. That is why the snow is DOM sprites.
- **AVPlay:**
  - Have exactly **one** `<object type="application/avplayer">` in the page (`#av` in `index.html`). Never add a second one.
  - The video plane is drawn **under** the web page. Wherever video must show, every layer above it must be transparent. The dashboard camera does this by cutting a hole in the background (`body.cam-on`, `.dsh.cam-live`, clip-path on `.bgw`).
  - Show and size the object *before* `avplay.open()`, then `setDisplayRect`.
- **Live camera:**
  - It comes from the server as HLS: `/api/dashboard/cam/...`, field `hls1080`.
  - Per-TV choice in localStorage: `bf_cam`. Set it to `hd` to use the 1080p stream; `snap` uses snapshots and is only a temporary fallback.
  - The first frame can take 10–20 s if the server has stopped the stream. The server prompt covers keeping it warm.
- **Data:**
  - Dashboard data comes from `GET /api/dashboard` on my server: weather, news, traffic, markets, camera and sport.
  - Some cards fetch public sources directly from the TV: BNR rates, and fuel prices from monitorulpreturilor.info, which uses my home coordinates.
  - A small "DEMO" tag means that card is showing placeholder data.
- **Season:**
  - `js/season.js` picks a theme by date: Christmas from 22 Nov to 6 Jan, NYE, 1 Dec, Halloween.
  - The Easter theme needs `BFX.easter(year)`, which is not implemented yet. Add it if you like (Orthodox Easter date).
  - Override with `localStorage.bf_season`.
- **Security:**
  - No secrets in git.
  - The device token lives only in the TV's localStorage after pairing.
  - Camera passwords and API keys stay on the server.
- Back up a file before big edits. Commit often.

Start with step 1 and tell me what you need from me.
