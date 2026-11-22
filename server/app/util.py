import json

from aiohttp import web


def _dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def jok(o, status=200):
    return web.json_response(o, status=status, dumps=_dumps)


def jerr(status, msg, **extra):
    o = {'error': msg}
    o.update(extra)
    return web.json_response(o, status=status, dumps=_dumps)


async def body(request):
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}
