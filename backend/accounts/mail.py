"""Verification/reset email; development writes private .eml files, never sends silently."""
import os
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from .database import data_dir


def send_link(email, purpose, url):
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
    with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=15) as server:
        server.ehlo()
        server.starttls(context=ssl.create_default_context())
        server.ehlo()
        if os.getenv('SMTP_USER'):
            server.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
        server.send_message(message)
    return None
