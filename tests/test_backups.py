import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
from backend.accounts.database import database
from backend.maintenance.backup import create, verify, restore_test, status


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,{'HYPERSENSE_DATA_DIR':str(self.root/'live'),'HYPERSENSE_BACKUP_DIR':str(self.root/'backups')})
        self.env.start()
        with database() as db:
            db.execute("INSERT INTO users VALUES ('u','test@example.com','Test','hash',1,1)")
            db.execute("INSERT INTO interviews VALUES ('u','s',?,?)",('{"recording":"base64-audio","transcript":"answer"}',49))
            db.execute("INSERT INTO support_reports VALUES ('r','u','bug','Issue','Description','open','',1,1,1)")
        with database(): pass
        with closing(sqlite3.connect(self.root/'live'/'usage.sqlite3')) as db:
            with db:
                db.execute('CREATE TABLE counters (count INTEGER)');db.execute('INSERT INTO counters VALUES (4)')

    def tearDown(self):
        self.env.stop();self.temp.cleanup()

    def test_roundtrip_includes_wal_and_preserves_live_data(self):
        live=self.root/'live'/'hypersense.sqlite3'
        writer=sqlite3.connect(live)
        try:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute("INSERT INTO support_messages VALUES ('m','r','u','user','Follow up',2,2)");writer.commit()
            folder=create();manifest=verify(folder)
            self.assertEqual(manifest['files']['hypersense.sqlite3']['rows']['support_messages'],1)
            self.assertIn('usage.sqlite3',manifest['files'])
            self.assertTrue(status()['available']);self.assertTrue(status()['last_attempt_ok'])
            output=restore_test(folder,self.root/'restored')
            with closing(sqlite3.connect(output/'hypersense.sqlite3')) as db:
                with db:
                    self.assertIn('base64-audio',db.execute('SELECT payload FROM interviews').fetchone()[0])
                    self.assertEqual(db.execute('SELECT body FROM support_messages').fetchone()[0],'Follow up')
            self.assertEqual(writer.execute('SELECT COUNT(*) FROM users').fetchone()[0],1)
            with self.assertRaises(FileExistsError):restore_test(folder,output)
            with self.assertRaises(ValueError):restore_test(folder,self.root/'live')
            with self.assertRaises(ValueError):restore_test(folder,self.root/'live'/'new')
        finally:writer.close()

    def test_corruption_rejected_and_old_success_retained(self):
        folder=create();before=status()['last_success_at']
        with (folder/'hypersense.sqlite3').open('ab') as f:f.write(b'corruption')
        with self.assertRaises(ValueError):verify(folder)
        with self.assertRaises(ValueError):restore_test(folder,self.root/'bad-restore')
        self.assertFalse((self.root/'bad-restore').exists())
        with patch('backend.maintenance.backup.inspect',side_effect=ValueError('test failure')):
            with self.assertRaises(ValueError):create()
        self.assertEqual(status()['last_success_at'],before);self.assertFalse(status()['last_attempt_ok'])
        self.assertFalse(list((self.root/'backups').glob('partial-*')))

    def test_no_database_is_not_success_and_manifest_paths_are_rejected(self):
        with patch.dict(os.environ,{'HYPERSENSE_DATA_DIR':str(self.root/'missing')}):
            with self.assertRaises(ValueError):create()
            self.assertIsNone(status()['last_success_at'])
        folder=create();manifest=json.loads((folder/'manifest.json').read_text())
        manifest['files']['../private']=manifest['files']['hypersense.sqlite3']
        (folder/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):verify(folder)
