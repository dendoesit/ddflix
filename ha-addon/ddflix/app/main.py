"""DDflix server: python -m app.main"""
import asyncio
import logging
import os
import time

from aiohttp import web

from . import admin, auth, diag, catalog, config, db, discover, extra, filelist, library, markers, play, live, rss, subs

log = logging.getLogger('main')
STATIC = os.path.join(os.path.dirname(__file__), 'static')
WEBAPP = os.path.join(os.path.dirname(__file__), 'webapp')  # copy of /web (same site as Vercel), served at /web/


async def index(request):
    return web.FileResponse(os.path.join(STATIC, 'index.html'), headers={
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"})


async def every(name, fn, interval_s, first_s):
    await asyncio.sleep(first_s)
    while True:
        t0 = time.time()
        try:
            await fn()
            diag.job_done(name, t0)
        except Exception as e:  # one failing job never kills the loop
            log.warning('job %s: %s', name, config.mask(e))
            diag.job_done(name, t0, e)
        await asyncio.sleep(interval_s)


async def start_jobs(app):
    import shutil
    shutil.rmtree(os.path.join(config.DATA_DIR, 'stream'), ignore_errors=True)
    if config.DISABLE_JOBS:
        return
    app['jobs'] = [asyncio.ensure_future(j) for j in (
        every('scan', library.scan, config.SCAN_INTERVAL_MIN * 60, 5),
        every('rss', rss.run_once, config.RSS_INTERVAL_MIN * 60, 30),
        every('keyframes', library.kf_job, 120, 90),
        every('sessions', play.gc_job, 60, 60),
        every('discover', discover.warm, 6 * 3600, 10),
        every('imdb', discover.ratings_job, 24 * 3600, 120),
        every('top10', discover.netflix_top, 12 * 3600, 20),
        every('trailers', extra.trailer_warm, 3 * 3600, 300),
        every('markers', markers.job, 120, 180),
        every('watch', filelist.watch_job, 2 * 3600, 600),
        every('subs', subs.job, 600, 240),
        every('live', live.job, 10, 15),
    )]


async def stop_jobs(app):
    for j in app.get('jobs', []):
        j.cancel()


def make_app():
    db.conn()
    from . import cert
    cert.schema()
    subs.schema()
    live.schema()
    app = web.Application(middlewares=[auth.guard], client_max_size=2 * 1024 * 1024)
    auth.routes(app)
    catalog.routes(app)
    extra.routes(app)
    markers.routes(app)
    play.routes(app)
    filelist.routes(app)
    admin.routes(app)
    app.router.add_get('/', index)
    if os.path.isdir(WEBAPP):
        async def web_index(request):
            return web.FileResponse(os.path.join(WEBAPP, 'index.html'), headers={'Cache-Control': 'no-cache'})

        async def web_redirect(request):
            raise web.HTTPFound('/web/')
        app.router.add_get('/web', web_redirect)
        app.router.add_get('/web/', web_index)
        app.router.add_static('/web/', WEBAPP)
    app.router.add_static('/static/', STATIC)
    app.on_startup.append(start_jobs)
    app.on_cleanup.append(stop_jobs)
    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')
    logging.getLogger('aiohttp.access').setLevel(logging.WARNING)
    diag.install()
    async def serve():
        runner = web.AppRunner(make_app(), access_log=None)
        await runner.setup()
        await web.TCPSite(runner, '0.0.0.0', config.PORT).start()          # LAN: TVs + admin page
        await web.TCPSite(runner, '0.0.0.0', config.PUBLIC_PORT).start()   # public (Funnel): token/password only
        log.info('DDflix on :%d (LAN) and :%d (public)', config.PORT, config.PUBLIC_PORT)
        from . import direct
        while True:  # direct HTTPS port: starts once the certificate exists, reloads it when renewed
            try:
                await direct.check(runner)
            except Exception as e:
                log.warning('direct: %s', e)
            await asyncio.sleep(60)
    asyncio.run(serve())
