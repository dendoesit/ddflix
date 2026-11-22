# BUBUFLIX Samsung TV app: owner steps (certificate + install)

Everything except signing and installing is ready in this folder. These steps need your Samsung account, so they are yours.

1. Install **Tizen Studio** (with the CLI) on your Mac. In the Package Manager add **Samsung Certificate Extension** and **TV Extensions**.
2. On each TV: Apps → type `12345` on the remote → **Developer mode ON**, Host PC IP = your Mac's LAN IP → restart the TV.
3. Find each TV's DUID: Tizen Studio → Device Manager → connect to the TV IP (port 26101) → right-click → *Properties*.
4. Certificate Manager → **+** → *Samsung* → TV → create the author certificate (keep the password) and a distributor certificate with **both DUIDs**. Name the profile `bubuflix`.
   Back up `~/SamsungCertificate/` (author key) — without it you cannot update the app later. Note the expiry dates in NOTES.md.
5. Copy this `tizen/` folder to the Mac and run `./build.sh bubuflix` → `.buildResult/BUBUFLIX.wgt`.
6. `sdb connect <TV-IP>` then `tizen install -n .buildResult/BUBUFLIX.wgt -t <device>` (device name from `sdb devices`).
7. Open BUBUFLIX on the TV: it shows a 6-letter code. On your phone: tv.example.com → Settings → **Profiles & devices** → enter the code.

Debug: `tizen run -p BbFlx00001.BUBUFLIX -t <device>`; logs with `sdb dlog | grep -i console`; Web Inspector via `sdb forward tcp:9222 ...` (Tizen Studio "Debug" run).
