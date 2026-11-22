"""SQLite helpers (WAL). Small synchronous calls; fine for a home server."""
import json
import os
import sqlite3
import threading
import time

from . import config

_lock = threading.RLock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS setting(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS profile(id INTEGER PRIMARY KEY, name TEXT, kind TEXT DEFAULT 'adult', max_rating INTEGER,
  avatar TEXT, pin_hash TEXT, admin INTEGER DEFAULT 0, prefs TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS device(id INTEGER PRIMARY KEY, name TEXT, kind TEXT, token_hash TEXT UNIQUE, profile_id INTEGER,
  created_at INTEGER, last_seen INTEGER, last_ip TEXT, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS pair(user_code TEXT PRIMARY KEY, device_hash TEXT, name TEXT, kind TEXT, created_at INTEGER,
  expires_at INTEGER, token TEXT, device_id INTEGER);
CREATE TABLE IF NOT EXISTS title(imdb TEXT PRIMARY KEY, type TEXT, name TEXT, year INTEGER, year_end INTEGER, description TEXT,
  genres TEXT DEFAULT '[]', cast_ TEXT DEFAULT '[]', director TEXT DEFAULT '[]', imdb_rating REAL, runtime_min INTEGER,
  released TEXT, poster_url TEXT, background_url TEXT, logo_url TEXT, videos TEXT DEFAULT '[]', first_seen INTEGER, meta_at INTEGER);
CREATE TABLE IF NOT EXISTS media_file(id INTEGER PRIMARY KEY, path TEXT UNIQUE, imdb TEXT, season INTEGER, episode INTEGER,
  duration REAL, width INTEGER, height INTEGER, hdr TEXT, vcodec TEXT, size INTEGER, mtime REAL, added_at INTEGER,
  missing INTEGER DEFAULT 0, probe TEXT, ext_subs TEXT DEFAULT '[]', kf TEXT, pname TEXT, pyear INTEGER, ptype TEXT);
CREATE INDEX IF NOT EXISTS media_imdb ON media_file(imdb);
CREATE TABLE IF NOT EXISTS progress(profile_id INTEGER, media_id INTEGER, position REAL, duration REAL, watched INTEGER DEFAULT 0,
  audio_n INTEGER, sub_key TEXT, updated_at INTEGER, PRIMARY KEY(profile_id, media_id));
CREATE TABLE IF NOT EXISTS mylist(profile_id INTEGER, imdb TEXT, added_at INTEGER, PRIMARY KEY(profile_id, imdb));
CREATE TABLE IF NOT EXISTS rating(profile_id INTEGER, imdb TEXT, value INTEGER, PRIMARY KEY(profile_id, imdb));
CREATE TABLE IF NOT EXISTS follow(id INTEGER PRIMARY KEY, pattern TEXT UNIQUE, created_at INTEGER);
CREATE TABLE IF NOT EXISTS rss_item(guid TEXT PRIMARY KEY, title TEXT, size INTEGER, status TEXT, reason TEXT, ep_key TEXT,
  seen_at INTEGER);
CREATE TABLE IF NOT EXISTS release(id INTEGER PRIMARY KEY, imdb TEXT, name TEXT, size INTEGER, seeders INTEGER, leechers INTEGER,
  category TEXT, freeleech INTEGER, season INTEGER, episode INTEGER, pack INTEGER, res TEXT, hdr TEXT, codec TEXT, audio TEXT, source TEXT,
  uploaded TEXT, fetched_at INTEGER);
CREATE INDEX IF NOT EXISTS release_imdb ON release(imdb);
CREATE TABLE IF NOT EXISTS download(hash TEXT PRIMARY KEY, release_id INTEGER, imdb TEXT, season INTEGER, episode INTEGER, name TEXT,
  device_id INTEGER, added_at INTEGER);
CREATE TABLE IF NOT EXISTS play_event(id INTEGER PRIMARY KEY, at INTEGER, media_id INTEGER, kind TEXT, mode TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS imdb_rating(tconst TEXT PRIMARY KEY, rating REAL, votes INTEGER);
CREATE TABLE IF NOT EXISTS ep_rating(parent TEXT, season INTEGER, episode INTEGER, rating REAL, votes INTEGER, PRIMARY KEY(parent, season, episode));
"""


def conn():
    global _conn
    if _conn is None:
        os.makedirs(config.DATA_DIR, exist_ok=True)
        _conn = sqlite3.connect(os.path.join(config.DATA_DIR, 'catalog.db'), check_same_thread=False, isolation_level=None)
        _conn.row_factory = sqlite3.Row
        _conn.execute('PRAGMA journal_mode=WAL')
        _conn.execute('PRAGMA busy_timeout=5000')
        _conn.executescript(SCHEMA)
        if not _conn.execute('SELECT 1 FROM profile LIMIT 1').fetchone():
            _conn.execute("INSERT INTO profile(name, kind, avatar, admin, prefs) VALUES('Dan','adult','fox',1,?)",
                          (json.dumps({'audio': ['rum', 'eng'], 'subs': ['rum', 'eng']}),))
    return _conn


def q(sql, args=()):
    with _lock:
        return conn().execute(sql, args).fetchall()


def q1(sql, args=()):
    with _lock:
        return conn().execute(sql, args).fetchone()


def x(sql, args=()):
    with _lock:
        c = conn().execute(sql, args)
        return c.lastrowid if c.lastrowid else c.rowcount


def now():
    return int(time.time())


def jl(s, d=None):
    if s is None or s == '':
        return d
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return d


def get_setting(k, d=None):
    r = q1('SELECT v FROM setting WHERE k=?', (k,))
    return r['v'] if r else d


def set_setting(k, v):
    x('INSERT INTO setting(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', (k, v))
