"""Run only with a disposable hypersense_test database."""
import os
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.accounts import postgres as pg
from postgres_integration import ResetResult
from urllib.parse import urlsplit


class PoolTests(unittest.TestCase):
    def setUp(self):pg.close_pool()
    def tearDown(self):pg.close_pool()

    def test_sequential_operations_reuse_connection(self):
        for _ in range(5):
            with pg.connection() as db:self.assertEqual(db.execute('SELECT 1').fetchone()[0],1)
        self.assertEqual(pg.get_pool(os.environ['DATABASE_URL']).get_stats()['connections_num'],1)

    def test_rollback_before_reuse_and_local_settings_reset(self):
        with self.assertRaises(RuntimeError):
            with pg.connection() as db:
                db.execute("INSERT INTO users VALUES ('pool-test','pool@example.com','Pool','hash',1,1)")
                raise RuntimeError('rollback')
        with pg.connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],0)
        with pg.get_pool(os.environ['DATABASE_URL']).connection() as raw:
            self.assertEqual(raw.execute('SHOW statement_timeout').fetchone()[0],'0')
            self.assertNotIn('hypersense',raw.execute('SHOW search_path').fetchone()[0])

    def test_broken_connection_is_replaced(self):
        with pg.connection() as db:db.execute('SELECT 1')
        pool=pg.get_pool(os.environ['DATABASE_URL'])
        with pool.connection() as raw:raw.close()
        with pg.connection() as db:self.assertEqual(db.execute('SELECT 1').fetchone()[0],1)


if __name__=='__main__':
    url=os.getenv('HYPERSENSE_TEST_DATABASE_URL','')
    if '--reset-test-database' not in sys.argv or urlsplit(url).path!='/hypersense_test':
        sys.exit('Requires disposable HYPERSENSE_TEST_DATABASE_URL named hypersense_test and --reset-test-database.')
    os.environ['DATABASE_URL']=url
    with pg.raw_connect() as raw:pg.initialize(raw,url)
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(PoolTests)
    result=unittest.TextTestRunner(verbosity=2,resultclass=ResetResult).run(suite)
    sys.exit(not result.wasSuccessful())
