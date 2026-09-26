"""Single-instance SQLite persistence; keep HYPERSENSE_DATA_DIR on a private persistent disk."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from backend.config import PROJECT_ROOT


def data_dir():
    root = Path(os.getenv('HYPERSENSE_DATA_DIR', str(PROJECT_ROOT / 'data')))
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


@contextmanager
def database():
    db = sqlite3.connect(data_dir() / 'hypersense.sqlite3', timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS logins (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS links (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      bucket TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_lookup ON attempts(bucket, at);
    CREATE TABLE IF NOT EXISTS interviews (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL,
      PRIMARY KEY(user_id, id));
    ''')
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
