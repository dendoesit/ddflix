#!/bin/sh
# Package BUBUFLIX.wgt.  ./build.sh [cert-profile]   (default BubuFlix)
# Debug log sink: BF_DEBUG_URL=http://<mac-ip>:8787 ./build.sh BubuFlix   (then: node tools/logserver.js 8787)
set -e
cd "$(dirname "$0")"
node tools/check-compat.js
node test/run.js
VER=$(grep '<widget' config.xml | sed 's/.* version="\([0-9.]*\)".*/\1/')
printf 'var BF_BUILD = {version: "%s", time: "%s", debugUrl: "%s"};\n' "$VER" "$(date '+%Y-%m-%d %H:%M')" "${BF_DEBUG_URL:-}" > js/buildinfo.js
rm -rf .buildResult/media .buildResult/*.wgt .buildResult/js .buildResult/css .buildResult/icons .buildResult/fonts .buildResult/index.html .buildResult/config.xml
mkdir -p .buildResult
cp -r config.xml index.html js css icons .buildResult/
mkdir -p .buildResult/media && cp media/splash.mp4 media/splash-end.jpg .buildResult/media/
# dev/ (desktop shim) is never packaged
tizen package -t wgt -s "${1:-BubuFlix}" -- .buildResult
ls -l .buildResult/*.wgt
