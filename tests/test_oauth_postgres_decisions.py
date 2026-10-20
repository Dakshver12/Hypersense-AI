"""Exercise account decisions through the real adapter using fake SQL results."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock,patch
from backend.accounts import oauth,postgres

class RawCursor:
    def __init__(self,name,row):self.description=[SimpleNamespace(name=name)];self.row=row
    def fetchone(self):return self.row

class OAuthPostgresDecisionsTests(unittest.TestCase):
    def raw(self,identity=None,existing=False,suspended=False):
        raw=MagicMock()
        def execute(query,params=None):
            if 'FROM oauth_identities' in query:return RawCursor('user_id',(identity,) if identity else None)
            if 'FROM users WHERE email' in query:return RawCursor('exists',(1,) if existing else None)
            if 'SELECT verified FROM users' in query:return RawCursor('verified',(1,))
            if 'FROM account_suspensions' in query:return RawCursor('exists',(1,) if suspended else None)
            return RawCursor('unused',None)
        raw.execute.side_effect=execute
        pool=MagicMock();pool.connection.return_value.__enter__.return_value=raw
        return pool,raw

    def decision(self,expected,**state):
        pool,raw=self.raw(**state)
        with patch.object(postgres,'get_pool',return_value=pool),patch.object(postgres,'initialize'),patch.object(oauth,'database',postgres.connection):
            with self.assertRaisesRegex(oauth.OAuthAccountError,expected):
                oauth.resolve_account('github','subject','existing@example.test','Daksh',link_user='other-user' if expected=='conflict' else None)
        exit_call=raw.transaction.return_value.__exit__.call_args
        self.assertIs(exit_call.args[0],oauth.OAuthAccountError)

    def test_existing_email_is_not_misreported_as_database_failure(self):self.decision('existing-account',existing=True)
    def test_suspension_is_not_misreported_as_database_failure(self):self.decision('suspended',identity='user-one',suspended=True)
    def test_link_conflict_is_not_misreported_as_database_failure(self):self.decision('conflict',identity='user-one')
    def test_existing_provider_identity_keeps_original_account(self):
        pool,raw=self.raw(identity='user-one')
        with patch.object(postgres,'get_pool',return_value=pool),patch.object(postgres,'initialize'),patch.object(oauth,'database',postgres.connection):
            self.assertEqual(oauth.resolve_account('github','subject','changed@example.test','Daksh'),'user-one')
        self.assertIsNone(raw.transaction.return_value.__exit__.call_args.args[0])

if __name__=='__main__':unittest.main()
