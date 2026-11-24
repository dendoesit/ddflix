# DDflix tests

Run these after every change, before saying it works.

| What | Command | Needs |
|---|---|---|
| Server end-to-end, real server (home, titles, pictures, search, playback direct/HLS/web, subtitles, seek thumbnails, kids rules, TV device path, web deploy drift, public route) | `python tests/live_check.py` (`--quick` skips playback and the public-route speed) | PC on the home network |
| TV app unit tests (layout, state machine, i18n, ...) | `node tv/test/run.js` | Node |
| TV app on a real TV: search a series, open it, play, seek +30 / -60 / hold forward / hold back, close (restores the watch position) | `node tv/tools/cdp.js launch` then `node tv/tools/flowtest.js dexter` with `TV=<ip>:26101` | the TV on, DDflix not in use |
| TV search typing (simulated remote) | `node tv/tools/searchtest.js frozen peanuts` | as above |
| TV home scroll smoothness | `node tv/tools/scrollperf.js`, `node tv/tools/focusperf.js` | as above |

`live_check.py` pairs a temporary device for the TV checks and deletes it at the end; downloads are only dry runs.
Before restarting the add-on or reinstalling the TV app, make sure nobody is watching (`/api/admin/diag` → `playback.active`).
