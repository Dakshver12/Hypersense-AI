import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
from backend.accounts.postgres import Row, bind_sql
from backend.accounts.schema import SQLITE_SCHEMA
from backend.maintenance.migrate_postgres import migrate, fingerprint
from backend.maintenance import backup


class PostgresAdapterTests(unittest.TestCase):
    def test_parameters_do_not_rewrite_literals(self):
        self.assertEqual(bind_sql("SELECT '?' AS literal, ? AS value, '20%' AS percent"),
                         "SELECT '?' AS literal, %s AS value, '20%%' AS percent")
        row=Row(['id','name'],('123','test'))
        self.assertEqual(dict(row),{'id':'123','name':'test'})
        self.assertEqual(tuple(row),('123','test'))
        self.assertEqual(row[0],row['id'])

    def test_preview_preserves_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'account.sqlite3'
            with closing(sqlite3.connect(source)) as db:
                with db:
                    db.executescript(SQLITE_SCHEMA)
                    db.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',('id','test@example.com','Test','hash',1,1))
            before=hashlib.sha256(source.read_bytes()).digest()
            result=migrate(source)
            self.assertEqual(result['counts']['users'],1)
            self.assertFalse(result['applied'])
            self.assertEqual(before,hashlib.sha256(source.read_bytes()).digest())

    def test_postgres_never_claims_sqlite_backup(self):
        with patch.dict(os.environ,{'DATABASE_URL':'postgresql://invalid/example'}):
            self.assertEqual(backup.status()['backend'],'postgresql')
            with self.assertRaises(ValueError):backup.create()
