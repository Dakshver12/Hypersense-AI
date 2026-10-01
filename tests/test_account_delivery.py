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
                self.assertIn('#token=example', message.get_content())
                self.assertIsNone(result)

    def test_invalid_config(self):
        for changes in [{'MAIL_MODE': 'file'}, {'SMTP_SECURITY': 'none'}, {'SMTP_PORT': 'bad'}, {'SMTP_PORT': '0'}, {'SMTP_PASSWORD': ''}]:
            with self.subTest(changes=changes), patch.dict(os.environ, changes):
                with self.assertRaises(RuntimeError):
                    validate_mail_config()
