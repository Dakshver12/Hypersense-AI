"""Copy a consistent SQLite snapshot into an EMPTY private PostgreSQL schema."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from backend.accounts.database import data_dir
from backend.accounts.schema import SQLITE_SCHEMA
from backend.accounts.postgres import connection, TABLES


def quoted(name): return '"'+name.replace('"','""')+'"'


def fingerprint(rows):
    # Compare row multisets independently of SQLite/PostgreSQL text collation.
    hashes=[]
    for row in rows:
        encoded=json.dumps(list(row),ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
        hashes.append(hashlib.sha256(encoded).digest())
    digest=hashlib.sha256()
    for item in sorted(hashes):digest.update(item)
    return len(hashes),digest.hexdigest()



def snapshot(source,target):
    if not source.is_file(): raise ValueError('Source SQLite database was not found.')
    src=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)
    dest=sqlite3.connect(target)
    try:src.backup(dest)
    finally:src.close();dest.close()


def migrate(source,usage_source=None,apply=False):
    source=Path(source)
    with tempfile.TemporaryDirectory(prefix='hypersense-migration-') as tmp:
        copy=Path(tmp)/'hypersense.sqlite3';snapshot(source,copy)
        db=sqlite3.connect(copy)
        usage=None
        try:
            if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('Source integrity check failed.')
            # Upgrade only the private scratch copy, never the original database.
            db.executescript(SQLITE_SCHEMA)
            if db.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('Source contains broken relationships.')
            if usage_source:
                usage_copy=Path(tmp)/'usage.sqlite3';snapshot(Path(usage_source),usage_copy)
                usage=sqlite3.connect(usage_copy)
                if usage.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('Usage integrity check failed.')
            sources={name:db for name in TABLES if name!='counters'}
            if usage:sources['counters']=usage
            columns={name:[row[1] for row in conn.execute('PRAGMA table_info('+quoted(name)+')')] for name,conn in sources.items()}
            if any(not cols for cols in columns.values()):raise ValueError('Source schema is incomplete.')
            counts={name:conn.execute('SELECT COUNT(*) FROM '+quoted(name)).fetchone()[0] for name,conn in sources.items()}
            if not apply:return {'applied':False,'counts':counts}
            if not os.getenv('DATABASE_URL','').strip():raise ValueError('Set DATABASE_URL before applying a migration.')
            with connection() as target:
                # A failed/repeated import cannot overwrite an active installation.
                if any(target.execute('SELECT COUNT(*) FROM '+quoted(name)).fetchone()[0] for name in TABLES):
                    raise ValueError('Destination is not empty. Migration refused; no existing data was overwritten.')
                for name,conn in sources.items():
                    cols=columns[name];fields=','.join(map(quoted,cols))
                    sql='SELECT '+fields+' FROM '+quoted(name)
                    insert='INSERT INTO '+quoted(name)+' ('+fields+') VALUES ('+','.join('?' for _ in cols)+')'
                    for row in conn.execute(sql):target.execute(insert,row)
                    if fingerprint(conn.execute(sql))!=fingerprint(target.execute(sql)):
                        raise ValueError('Migration verification failed; the destination transaction was rolled back.')
                target.execute("SELECT setval(pg_get_serial_sequence('hypersense.admin_audit','id'),COALESCE((SELECT MAX(id) FROM admin_audit),1),(SELECT COUNT(*)>0 FROM admin_audit))")
            return {'applied':True,'counts':counts}
        finally:
            db.close()
            if usage:usage.close()


def main():
    from dotenv import load_dotenv
    load_dotenv()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=data_dir()/'hypersense.sqlite3')
    parser.add_argument('--usage-source',type=Path)
    parser.add_argument('--apply',action='store_true',help='Import and verify into an empty PostgreSQL destination. Default: local preview only.')
    args=parser.parse_args()
    try:
        usage=args.usage_source
        if usage is None and (args.source.parent/'usage.sqlite3').is_file():usage=args.source.parent/'usage.sqlite3'
        result=migrate(args.source,usage,args.apply)
        print('Migration committed and verified.' if result['applied'] else 'Preview only. Source is unchanged; use --apply to import into an empty destination.')
        for table,count in result['counts'].items():print(table+': '+str(count)+' rows')
    except Exception:
        parser.exit(1,'Migration failed or destination is not empty. No source data was modified. Check source integrity, target credentials, permissions and connectivity; credentials and row contents are not printed.\n')


if __name__=='__main__':main()
