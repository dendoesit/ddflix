#!/bin/sh
# Local Mac preview: serves the app on http://localhost:8765 and opens it in Chrome at 1920x1080 (separate profile).
#   ./preview.sh          (Ctrl-C to stop)
# Uses the same API as the TV (LAN 192.168.1.10:8090); pair the browser once with the on-screen code/QR.
cd "$(dirname "$0")"
PORT=${PORT:-8765}
[ -f js/buildinfo.js ] || printf 'var BF_BUILD = {version: "dev", time: "", debugUrl: ""};\n' > js/buildinfo.js
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM
sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$HOME/.bubuflix-preview-chrome" \
  --window-size=1920,1080 --app="http://localhost:$PORT/index.html" >/dev/null 2>&1 &
echo "BUBUFLIX preview on http://localhost:$PORT  (arrows, Enter, Backspace=Back, r/g/y/b colour keys)"
wait $SRV
