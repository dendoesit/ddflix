#!/bin/sh
# Copy the shared code into the places Docker builds from: server/app/webapp (site served at /web/) and the HA add-on.
set -e
cd "$(dirname "$0")"
rm -rf server/app/webapp && mkdir -p server/app/webapp
cp web/index.html web/app.js web/app.css web/icon.png web/manifest.webmanifest server/app/webapp/
printf "window.DDFLIX_API = '';\n" > server/app/webapp/config.js
rm -rf ha-addon/ddflix/app && cp -r server/app ha-addon/ddflix/app
find ha-addon/ddflix/app server/app -name __pycache__ -type d -prune -exec rm -rf {} +
echo synced
