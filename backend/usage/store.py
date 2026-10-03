"""Bounded hourly counters on the existing persistent data volume."""
from contextlib import contextmanager
from contextvars import ContextVar
import logging
import sqlite3
import time
from backend.accounts.database import data_dir, postgres_enabled

operation = ContextVar('usage_operation', default='other')
logger = logging.getLogger(__name__)
RETENTION_DAYS = 30


@contextmanager
def connection():
    if postgres_enabled():
        from backend.accounts.postgres import connection as pg_connection
        with pg_connection() as db:
            yield db
        return
    db = sqlite3.connect(data_dir() / 'usage.sqlite3', timeout=1)
    db.row_factory = sqlite3.Row
    try:
        db.execute('''CREATE TABLE IF NOT EXISTS counters (
          hour INTEGER NOT NULL, kind TEXT NOT NULL, operation TEXT NOT NULL,
          provider TEXT NOT NULL, outcome TEXT NOT NULL, fallback INTEGER NOT NULL,
          count INTEGER NOT NULL, total_ms REAL NOT NULL,
          PRIMARY KEY(hour,kind,operation,provider,outcome,fallback))''')
        yield db
        db.commit()
    finally:
        db.close()


def record(kind, provider, outcome, milliseconds=0, fallback=False):
    # Callers supply only fixed labels. Never accept prompts, keys or exception text.
    if kind not in ('request', 'attempt', 'cooldown') or provider not in ('Gemini', 'Groq', 'app'):
        return
    if outcome not in ('success', 'rate_limited', 'error'):
        return
    label = operation.get()
    if label not in ('question', 'session_questions', 'evaluation'):
        label = 'other'
    now = int(time.time())
    try:
        with connection() as db:
            db.execute('DELETE FROM counters WHERE hour < ?', (now - RETENTION_DAYS*86400,))
            db.execute('''INSERT INTO counters VALUES (?,?,?,?,?,?,1,?)
              ON CONFLICT(hour,kind,operation,provider,outcome,fallback)
              DO UPDATE SET count=counters.count+1,total_ms=counters.total_ms+excluded.total_ms''',
              (now//3600*3600, kind, label, provider, outcome, int(fallback), max(0, milliseconds)))
    except (sqlite3.Error, OSError):
        # Telemetry must not turn a successful interview request into a failure.
        logger.warning('API usage counters could not be saved.')


@contextmanager
def measure(kind, provider, fallback=False):
    started = time.monotonic()
    outcome = 'success'
    try:
        yield
    except Exception as exc:
        code = getattr(exc, 'status_code', None) or getattr(exc, 'code', None)
        outcome = 'rate_limited' if code == 429 else 'error'
        raise
    finally:
        record(kind, provider, outcome, (time.monotonic()-started)*1000, fallback)


@contextmanager
def request_usage(label):
    token = operation.set(label)
    try:
        with measure('request', 'app'):
            yield
    finally:
        operation.reset(token)


def snapshot(days):
    now = int(time.time())
    # Calendar-day windows in UTC make daily counts reproducible.
    since = now//86400*86400 - (days-1)*86400
    with connection() as db:
        db.execute('DELETE FROM counters WHERE hour < ?', (now - RETENTION_DAYS*86400,))
        rows = [dict(r) for r in db.execute('''SELECT kind,operation,provider,outcome,fallback,
          SUM(count) AS count, SUM(total_ms) AS total_ms FROM counters WHERE hour>=?
          GROUP BY kind,operation,provider,outcome,fallback''', (since,))]
        daily = [dict(r) for r in db.execute('''SELECT (hour/86400)*86400 AS day,
          SUM(CASE WHEN kind='request' THEN count ELSE 0 END) AS requests,
          SUM(CASE WHEN kind='attempt' THEN count ELSE 0 END) AS attempts,
          SUM(CASE WHEN kind='attempt' AND outcome='rate_limited' THEN count ELSE 0 END) AS rate_limits
          FROM counters WHERE hour>=? GROUP BY day ORDER BY day''', (since,))]
    return {'since': since, 'until': now, 'days': days, 'retention_days': RETENTION_DAYS,
            'rows': rows, 'daily': daily}
