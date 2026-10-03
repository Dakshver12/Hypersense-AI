from contextlib import contextmanager
from unittest import TestCase
from unittest.mock import patch, MagicMock
from starlette.requests import Request
from fastapi import HTTPException
from backend.accounts.security import current_user, require_user


def request(account='u'):
    return Request({'type':'http','headers':[(b'cookie',b'hypersense_session=test'),(b'x-hypersense-account',account.encode())]})


class AuthLookupTests(TestCase):
    def setUp(self):
        self.db=MagicMock()
        self.db.execute.return_value.fetchone.return_value={'id':'u','name':'User','email':'u@example.com'}
        @contextmanager
        def database():yield self.db
        self.patch=patch('backend.accounts.security.database',database);self.patch.start();self.addCleanup(self.patch.stop)

    def test_lookup_shared_only_within_request(self):
        req=request()
        first=current_user(req);first['id']='mutated'
        self.assertEqual(require_user(req)['id'],'u')
        self.assertEqual(self.db.execute.call_count,1)
        self.db.execute.return_value.fetchone.return_value=None
        self.assertIsNone(current_user(request()))
        self.assertEqual(self.db.execute.call_count,2)

    def test_account_mismatch_still_rejected(self):
        req=request('different')
        current_user(req)
        with self.assertRaises(HTTPException) as caught:require_user(req)
        self.assertEqual(caught.exception.status_code,409)

    def test_anonymous_result_is_request_scoped(self):
        self.db.execute.return_value.fetchone.return_value=None
        req=request();self.assertIsNone(current_user(req));self.assertIsNone(current_user(req))
        self.assertEqual(self.db.execute.call_count,1)
        current_user(request());self.assertEqual(self.db.execute.call_count,2)
