"""SQLite by default; DATABASE_URL explicitly selects private PostgreSQL storage."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from backend.config import PROJECT_ROOT


def data_dir():
    root = Path(os.getenv('HYPERSENSE_DATA_DIR', str(PROJECT_ROOT / 'data')))
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def postgres_enabled():
    return bool(os.getenv('DATABASE_URL', '').strip())


@contextmanager
def database(readonly=False):
    if postgres_enabled():
        from backend.accounts.postgres import connection
        with connection(readonly=readonly) as db:
            yield db
        return
    db = sqlite3.connect(data_dir() / 'hypersense.sqlite3', timeout=30)
    db.row_factory = sqlite3.Row
    db.create_function('strpos',2,lambda value,term: value.find(term)+1)
    db.create_function('greatest',2,max)
    db.create_function('least',2,min)
    db.execute('PRAGMA foreign_keys=ON')
    from backend.accounts.schema import SQLITE_SCHEMA
    db.executescript(SQLITE_SCHEMA)
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
