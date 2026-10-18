"""Mail transport checks use mocks; these tests never send real email."""
import os
import unittest
from unittest.mock import patch
from backend.accounts.mail import send_link, validate_mail_config


class MailTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'APP_ENV': 'production', 'MAIL_MODE': 'smtp',
            'SMTP_HOST': 'mail.example.test', 'SMTP_FROM': 'noreply@example.test',
            'SMTP_PORT': '587', 'SMTP_SECURITY': 'starttls',
            'SMTP_USER': 'test-user', 'SMTP_PASSWORD': 'test-password',
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_starttls_and_ssl_delivery(self):
        for security, port in [('starttls', '587'), ('ssl', '465')]:
            with self.subTest(security=security), patch.dict(os.environ, {'SMTP_SECURITY': security, 'SMTP_PORT': port}), patch('backend.accounts.mail.smtplib.SMTP') as plain, patch('backend.accounts.mail.smtplib.SMTP_SSL') as tls:
                result = send_link('person@example.test', 'verify', 'https://example.test/verify-email#token=example')
                transport = tls if security == 'ssl' else plain
                other = plain if security == 'ssl' else tls
                other.assert_not_called()
                self.assertEqual(transport.call_args.args, ('mail.example.test', int(port)))
                server = transport.return_value.__enter__.return_value
                self.assertEqual(server.starttls.call_count, int(security == 'starttls'))
                server.login.assert_called_once_with('test-user', 'test-password')
                message = server.send_message.call_args.args[0]
                self.assertEqual(message['To'], 'person@example.test')
                self.assertIn('#token=example', message.get_body(preferencelist=('plain',)).get_content())
                self.assertIsNone(result)

    def test_invalid_config(self):
        for changes in [{'MAIL_MODE': 'file'}, {'SMTP_SECURITY': 'none'}, {'SMTP_PORT': 'bad'}, {'SMTP_PORT': '0'}, {'SMTP_PASSWORD': ''}]:
            with self.subTest(changes=changes), patch.dict(os.environ, changes):
                with self.assertRaises(RuntimeError):
                    validate_mail_config()

    def test_brevo_api_delivery_uses_https_and_both_email_formats(self):
        import httpx
        from unittest.mock import Mock
        with patch.dict(os.environ, {'MAIL_MODE':'brevo','BREVO_API_KEY':'fake-api-key'}), patch('backend.accounts.mail.httpx.Client') as factory, patch('backend.accounts.mail.smtplib.SMTP') as smtp:
            response=Mock();factory.return_value.__enter__.return_value.post.return_value=response
            self.assertIsNone(send_link('person@example.test','verify','https://example.test/verify-email#token=example'))
            call=factory.return_value.__enter__.return_value.post.call_args
            self.assertEqual(call.args[0],'https://api.brevo.com/v3/smtp/email')
            self.assertEqual(call.kwargs['headers']['api-key'],'fake-api-key')
            self.assertIn('#token=example',call.kwargs['json']['htmlContent'])
            self.assertIn('#token=example',call.kwargs['json']['textContent'])
            response.raise_for_status.assert_called_once();smtp.assert_not_called()
            response.raise_for_status.side_effect=httpx.HTTPStatusError('Rejected',request=httpx.Request('POST',call.args[0]),response=httpx.Response(401))
            with self.assertRaises(httpx.HTTPStatusError):send_link('person@example.test','verify','https://example.test/verify-email#token=example')

    def test_brevo_requires_key_and_sender(self):
        for fields in ({'BREVO_API_KEY':''},{'BREVO_API_KEY':'key','SMTP_FROM':''}):
            with patch.dict(os.environ,{'MAIL_MODE':'brevo',**fields}):
                with self.assertRaises(RuntimeError):validate_mail_config()
