"""Opt-in destructive tests. ONLY use a disposable database named hypersense_test."""
import argparse
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.accounts.postgres import TABLES, raw_connect, initialize, connection
from backend.accounts.schema import SQLITE_SCHEMA
from backend.maintenance.migrate_postgres import migrate


class MigrationTests(unittest.TestCase):
    def fixture(self,path):
        with sqlite3.connect(path) as db:
            db.executescript(SQLITE_SCHEMA)
            db.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',('u','test@example.com','Å Test','password-hash',1,1))
            db.execute("INSERT INTO logins VALUES ('token','u',9999999999)")
            db.execute("INSERT INTO links VALUES ('link','u','verify',9999999999)")
            db.execute("INSERT INTO attempts VALUES ('bucket',1)")
            db.execute("INSERT INTO account_suspensions VALUES ('u',1)")
            db.execute("INSERT INTO admin_audit VALUES (7,1,'u','u','suspend','test')")
            db.execute("INSERT INTO support_reports VALUES ('r','u','bug','title','description','open','reply',1,2,2)")
            # Snapshot upgrade must backfill legacy replies and unread state.
            db.execute("INSERT INTO support_admin_reads VALUES ('r','u',1)")
            db.execute('INSERT INTO interviews VALUES (?,?,?,?)',('u','session','{"audio":"data:audio/webm;base64,AQID"}',39))

    def test_verified_import_and_repeat_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'hypersense.sqlite3';self.fixture(path)
            before=path.read_bytes()
            usage=Path(tmp)/'usage.sqlite3'
            with sqlite3.connect(usage) as db:
                db.execute('CREATE TABLE counters(hour INTEGER,kind TEXT,operation TEXT,provider TEXT,outcome TEXT,fallback INTEGER,count INTEGER,total_ms REAL)')
                db.execute("INSERT INTO counters VALUES (1,'request','question','app','success',0,2,12.5)")
            result=migrate(path,usage,True)
            self.assertTrue(result['applied']);self.assertEqual(before,path.read_bytes())
            with connection() as db:
                self.assertEqual(db.execute('SELECT password FROM users').fetchone()[0],'password-hash')
                self.assertIn('AQID',db.execute('SELECT payload FROM interviews').fetchone()[0])
                self.assertEqual(db.execute('SELECT body FROM support_messages').fetchone()[0],'reply')
                self.assertEqual(db.execute('SELECT total_ms FROM counters').fetchone()[0],12.5)
                db.execute("INSERT INTO admin_audit(at,actor_id,target_id,action,reason) VALUES (1,'u','u','test','test')")
                self.assertEqual(db.execute('SELECT MAX(id) FROM admin_audit').fetchone()[0],8)
            with self.assertRaises(sqlite3.OperationalError):migrate(path,usage,True)
            with connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],1)

    def test_failed_verification_rolls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'hypersense.sqlite3';self.fixture(path)
            with patch('backend.maintenance.migrate_postgres.fingerprint',side_effect=[(1,'a'),(1,'b')]):
                with self.assertRaises(sqlite3.OperationalError):migrate(path,apply=True)
            with connection() as db:
                for table in TABLES:self.assertEqual(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)


class ResetResult(unittest.TextTestResult):
    def startTest(self,test):
        with raw_connect() as db:
            db.execute('TRUNCATE '+','.join('hypersense.'+name for name in TABLES)+' RESTART IDENTITY CASCADE')
        super().startTest(test)


def flatten(suite):
    for item in suite:
        if isinstance(item,unittest.TestSuite):yield from flatten(item)
        else:yield item


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset-test-database',action='store_true')
    args=parser.parse_args()
    url=os.getenv('HYPERSENSE_TEST_DATABASE_URL','')
    if not args.reset_test_database or urlsplit(url).path!='/hypersense_test':
        parser.error('Set HYPERSENSE_TEST_DATABASE_URL for a disposable hypersense_test database and pass --reset-test-database. Never use the application database.')
    os.environ['DATABASE_URL']=url
    with raw_connect() as db:initialize(db,url)
    suite=unittest.TestSuite()
    for name in ('test_accounts','test_account_settings','test_account_delivery','test_support','test_admin_workspace','test_api_usage'):
        tests=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern=name+'.py')
        for test in flatten(tests):
            if 'legacy_reply_migration' not in test.id():suite.addTest(test)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(MigrationTests))
    result=unittest.TextTestRunner(verbosity=2,resultclass=ResetResult).run(suite)
    return not result.wasSuccessful()


if __name__=='__main__':sys.exit(main())
