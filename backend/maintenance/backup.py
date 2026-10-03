"""Verified SQLite snapshots and isolated restore checks using only the standard library."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
from uuid import uuid4
from backend.accounts.database import data_dir, postgres_enabled

NAMES = ('hypersense.sqlite3', 'usage.sqlite3')
CORE = {'users', 'logins', 'links', 'interviews', 'support_reports'}


def backup_root():
    return Path(os.getenv('HYPERSENSE_BACKUP_DIR', str(data_dir() / 'backups'))).resolve()


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def connect_readonly(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=30)


def inspect(path):
    db = connect_readonly(path)
    try:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Database integrity check failed.')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Database relationship check failed.')
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        counts = {}
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            counts[table] = db.execute('SELECT COUNT(*) FROM ' + quoted).fetchone()[0]
        if path.name == 'hypersense.sqlite3' and not CORE.issubset(counts):
            raise ValueError('This is not a complete HyperSense account database.')
        return counts
    finally:
        db.close()


def write_json(path, value):
    fd, name = tempfile.mkstemp(prefix='backup-meta-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def read_manifest(folder):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    if not isinstance(manifest, dict) or manifest.get('format') != 1 or not isinstance(manifest.get('files'), dict):
        raise ValueError('Unsupported backup manifest.')
    names = set(manifest['files'])
    if 'hypersense.sqlite3' not in names or not names.issubset(NAMES):
        raise ValueError('Invalid backup file list.')
    for entry in manifest['files'].values():
        if not isinstance(entry, dict) or not isinstance(entry.get('sha256'), str) or not isinstance(entry.get('rows'), dict):
            raise ValueError('Invalid backup metadata.')
    return manifest


def verify(folder):
    folder = Path(folder).resolve()
    manifest = read_manifest(folder)
    for name, entry in manifest['files'].items():
        path = folder / name
        if path.is_symlink() or not path.is_file() or digest(path) != entry['sha256']:
            raise ValueError('Backup file is missing or its checksum does not match.')
        if inspect(path) != entry['rows']:
            raise ValueError('Backup table counts do not match.')
    return manifest


def restore_test(folder, output):
    """Restore only into a new, separate directory. Never overwrite live data."""
    folder, output = Path(folder).resolve(), Path(output).resolve()
    live = data_dir().resolve()
    if output == live or live in output.parents or output == folder or folder in output.parents:
        raise ValueError('Choose a test directory outside the live data and backup directories.')
    from backend.config import PROJECT_ROOT
    for public in (PROJECT_ROOT / 'static', PROJECT_ROOT / 'templates'):
        if output == public.resolve() or public.resolve() in output.parents:
            raise ValueError('Restore tests must not be stored in public web directories.')
    manifest = verify(folder)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        for name, entry in manifest['files'].items():
            target = output / name
            shutil.copyfile(folder / name, target)
            target.chmod(0o600)
            if digest(target) != entry['sha256'] or inspect(target) != entry['rows']:
                raise ValueError('Restored database verification failed.')
        write_json(output / 'restore-check.json', {'verified_at': int(time.time()), 'backup_id': manifest['id']})
    except BaseException:
        shutil.rmtree(output)
        raise
    return output


def status():
    """Return operational metadata only; no private paths or database contents."""
    if postgres_enabled():
        return {'backend': 'postgresql', 'available': False, 'last_success_at': None,
                'last_attempt_ok': None, 'last_attempt_at': None}
    try:
        saved = json.loads((data_dir() / 'backup-status.json').read_text(encoding='utf-8'))
        if not isinstance(saved, dict): raise ValueError('Invalid backup status.')
        last = saved.get('last_success')
        available = False
        if isinstance(last, dict):
            ident = last.get('id', '')
            if isinstance(ident, str) and ident and Path(ident).name == ident and ident not in ('.', '..'):
                folder = backup_root() / ident
                available = (folder / 'manifest.json').is_file() and (folder / 'hypersense.sqlite3').is_file()
        return {'last_success_at': last.get('at') if isinstance(last, dict) else None,
                'available': available, 'last_attempt_ok': saved.get('last_attempt_ok'),
                'last_attempt_at': saved.get('last_attempt_at')}
    except (OSError, ValueError, TypeError):
        return {'last_success_at': None, 'available': False, 'last_attempt_ok': None, 'last_attempt_at': None}


def save_status(success=None):
    path = data_dir() / 'backup-status.json'
    try: old = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError): old = {}
    if not isinstance(old, dict): old = {}
    old.update(last_attempt_ok=success is not None, last_attempt_at=int(time.time()))
    if success is not None: old['last_success'] = success
    write_json(path, old)


def create():
    if postgres_enabled():
        raise ValueError('SQLite backup is disabled in PostgreSQL mode. Use a private PostgreSQL dump and verify its restoration.')
    root = backup_root()
    # Reject web-served locations: snapshots contain private account/session data.
    from backend.config import PROJECT_ROOT
    for public in (PROJECT_ROOT / 'static', PROJECT_ROOT / 'templates'):
        public = public.resolve()
        if root == public or public in root.parents:
            raise ValueError('Backup storage must not be inside static or templates.')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    ident = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid4().hex[:12]
    stage = Path(tempfile.mkdtemp(prefix='partial-', dir=root))
    try:
        source = data_dir()
        if not (source / NAMES[0]).is_file(): raise ValueError('No account database exists yet.')
        manifest = {'format': 1, 'id': ident, 'created_at': int(time.time()), 'files': {}}
        for name in NAMES:
            path = source / name
            if not path.is_file(): continue
            target = stage / name
            src, dest = connect_readonly(path), sqlite3.connect(target)
            deadline = time.monotonic() + 120
            def progress(*_):
                if time.monotonic() > deadline: raise TimeoutError('Backup took too long; retry during a quieter period.')
            try: src.backup(dest, pages=256, progress=progress, sleep=.05)
            finally: src.close(); dest.close()
            target.chmod(0o600)
            manifest['files'][name] = {'sha256': digest(target), 'rows': inspect(target), 'bytes': target.stat().st_size}
        write_json(stage / 'manifest.json', manifest)
        # Round-trip a separate copy; the live database is never a restore target.
        with tempfile.TemporaryDirectory(prefix='hypersense-restore-') as temporary:
            restore_test(stage, Path(temporary) / 'check')
        final = root / ident
        stage.rename(final)
        save_status({'id': ident, 'at': int(time.time())})
        return final
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        save_status()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('create')
    v = commands.add_parser('verify'); v.add_argument('backup')
    t = commands.add_parser('restore-test'); t.add_argument('backup'); t.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'create': print('Verified backup created:', create())
        elif args.command == 'verify': verify(args.backup); print('Backup verification passed.')
        else: print('Restore check passed:', restore_test(args.backup, args.output))
    except (OSError, ValueError, sqlite3.Error, TimeoutError) as error:
        parser.exit(1, 'Backup operation failed: ' + str(error) + '\n')


if __name__ == '__main__': main()
