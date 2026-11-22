#!/bin/zsh
source ~/.zshrc >/dev/null 2>&1
cd ~/bubuflix-tizen && ./build.sh BubuFlix >/tmp/build.log 2>&1 || { tail -20 /tmp/build.log; exit 1; }
tizen install -n .buildResult/BUBUFLIX.wgt -t "${TV_NAME:?set TV_NAME to your TV name from sdb devices}" 2>&1 | grep -E "success|fail|error" ; node tools/cdp.js launch
