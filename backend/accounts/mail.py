"""Verification/reset email; development writes private .eml files, never sends silently."""
import os
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from .database import data_dir


def validate_mail_config():
    mode = os.getenv('MAIL_MODE', 'file')
    if mode == 'file' and os.getenv('APP_ENV', 'development') != 'production':
        return
    if mode != 'smtp' or not os.getenv('SMTP_HOST') or not os.getenv('SMTP_FROM'):
        raise RuntimeError('Configure MAIL_MODE=smtp, SMTP_HOST and SMTP_FROM for email delivery.')
    if os.getenv('SMTP_SECURITY', 'starttls') not in ('starttls', 'ssl'):
        raise RuntimeError('SMTP_SECURITY must be starttls or ssl.')
    try:
        port = int(os.getenv('SMTP_PORT', '587'))
    except ValueError:
        raise RuntimeError('SMTP_PORT must be a number between 1 and 65535.') from None
    if not 1 <= port <= 65535:
        raise RuntimeError('SMTP_PORT must be a number between 1 and 65535.')
    if bool(os.getenv('SMTP_USER')) != bool(os.getenv('SMTP_PASSWORD')):
        raise RuntimeError('Set both SMTP_USER and SMTP_PASSWORD, or neither for an authenticated relay.')


def send_link(email, purpose, url):
    validate_mail_config()
    message = EmailMessage()
    message['From'] = os.getenv('SMTP_FROM', 'HyperSense <noreply@localhost>')
    message['To'] = email
    message['Subject'] = 'Verify your HyperSense account' if purpose == 'verify' else 'Reset your HyperSense password'
    message.set_content(f"Open this link to {'verify your email' if purpose == 'verify' else 'reset your password'}:\n\n{url}\n\nThis link expires in 30 minutes and works once. If you did not request it, ignore this email.")
    mode = os.getenv('MAIL_MODE', 'file')
    if mode == 'file' and os.getenv('APP_ENV', 'development') != 'production':
        folder = data_dir() / 'outbox'
        folder.mkdir(mode=0o700, exist_ok=True)
        path = folder / (uuid.uuid4().hex + '.eml')
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(message.as_string())
        return url
    if mode != 'smtp' or not os.getenv('SMTP_HOST'):
        raise RuntimeError('Configure SMTP before enabling email delivery.')
    use_ssl = os.getenv('SMTP_SECURITY', 'starttls') == 'ssl'
    transport = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    options = {'timeout': 15}
    if use_ssl:
        options['context'] = ssl.create_default_context()
    with transport(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), **options) as server:
        server.ehlo()
        if not use_ssl:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if os.getenv('SMTP_USER'):
            server.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
        server.send_message(message)
    return None
