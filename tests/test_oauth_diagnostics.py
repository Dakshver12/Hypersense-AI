"""OAuth error categories must be useful without leaking credentials or PII."""
import unittest
from unittest.mock import patch
import httpx
from backend.accounts import oauth

class OAuthDiagnosticsTests(unittest.TestCase):
    def test_provider_error_codes_are_classified_even_when_status_is_200(self):
        cases=[(200,'incorrect_client_credentials','oauth-credentials'),(401,'invalid_client','oauth-credentials'),
               (400,'redirect_uri_mismatch','oauth-callback'),(400,'invalid_grant','oauth-code'),
               (200,'bad_verification_code','oauth-code'),(403,'access_denied','oauth-permissions')]
        for status,reason,expected in cases:
            with self.subTest(reason=reason),self.assertLogs(oauth.logger,level='WARNING') as logs:
                with self.assertRaisesRegex(oauth.OAuthFailure,expected):
                    oauth._provider_json('github','token',lambda:httpx.Response(status,json={'error':reason,'error_description':'SECRET_EMAIL_TOKEN'}))
            self.assertIn('stage=token',' '.join(logs.output))
            self.assertNotIn('SECRET_EMAIL_TOKEN',' '.join(logs.output))

    def test_network_and_unknown_response_logs_never_include_request_or_body(self):
        def failed():raise httpx.ConnectError('private-client-secret',request=httpx.Request('GET','https://example.test?code=private-code'))
        with self.assertLogs(oauth.logger,level='WARNING') as logs:
            with self.assertRaisesRegex(oauth.OAuthFailure,'oauth-network'):oauth._provider_json('google','profile',failed)
        self.assertNotIn('private-',str(logs.output))
        with self.assertLogs(oauth.logger,level='WARNING') as logs:
            with self.assertRaises(oauth.OAuthFailure):
                oauth._provider_json('google','token',lambda:httpx.Response(500,json={'error':'private-client-secret'}))
        self.assertNotIn('private-client-secret',str(logs.output));self.assertIn('reason=unspecified',str(logs.output))

    def test_success_is_returned_without_logging_provider_body(self):
        with patch.object(oauth.logger,'warning') as log:
            result=oauth._provider_json('google','token',lambda:httpx.Response(200,json={'access_token':'not-for-logs'}))
            self.assertEqual(result['access_token'],'not-for-logs');log.assert_not_called()

if __name__=='__main__':unittest.main()
