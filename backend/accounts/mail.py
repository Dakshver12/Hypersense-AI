"""Verification/reset email; development writes private .eml files, never sends silently."""
import os
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from html import escape
from email.utils import parseaddr
import httpx
from .database import data_dir


def validate_mail_config():
    mode = os.getenv('MAIL_MODE', 'file')
    if mode == 'file' and os.getenv('APP_ENV', 'development') != 'production':
        return
    if mode == 'brevo':
        sender = parseaddr(os.getenv('SMTP_FROM', ''))[1]
        if not os.getenv('BREVO_API_KEY', '').strip() or '@' not in sender or '\n' in sender or '\r' in sender:
            raise RuntimeError('Configure BREVO_API_KEY and a verified SMTP_FROM sender for MAIL_MODE=brevo.')
        return
    if mode != 'smtp' or not os.getenv('SMTP_HOST') or not os.getenv('SMTP_FROM'):
        raise RuntimeError('Configure MAIL_MODE=smtp with SMTP fields, or MAIL_MODE=brevo with BREVO_API_KEY and SMTP_FROM.')
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
    action = 'Verify email' if purpose == 'verify' else 'Reset password'
    safe_url = escape(url, quote=True)
    message.add_alternative('<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;padding:24px">'
        '<h2>'+action+'</h2><p>Continue to HyperSense AI using the button below.</p>'
        '<p><a href="'+safe_url+'" style="display:inline-block;padding:14px 22px;background:#a6d1c0;color:#152b23;border-radius:8px;text-decoration:none">'+action+'</a></p>'
        '<p>This link expires in 30 minutes and works once. If the button does not open on your phone, copy and paste the full link:</p>'
        '<p style="overflow-wrap:anywhere">'+safe_url+'</p><p>If you did not request this, ignore this email.</p></body></html>', subtype='html')
    mode = os.getenv('MAIL_MODE', 'file')
    if mode == 'file' and os.getenv('APP_ENV', 'development') != 'production':
        folder = data_dir() / 'outbox'
        folder.mkdir(mode=0o700, exist_ok=True)
        path = folder / (uuid.uuid4().hex + '.eml')
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(message.as_string())
        return url
    if mode == 'brevo':
        name, sender = parseaddr(os.environ['SMTP_FROM'])
        with httpx.Client(timeout=15, follow_redirects=False) as client:
            response = client.post('https://api.brevo.com/v3/smtp/email',
                headers={'api-key': os.environ['BREVO_API_KEY'], 'Accept': 'application/json'},
                json={'sender': {'email': sender, 'name': name or 'HyperSense AI'},
                      'to': [{'email': email}], 'subject': str(message['Subject']),
                      'textContent': message.get_body(preferencelist=('plain',)).get_content(),
                      'htmlContent': message.get_body(preferencelist=('html',)).get_content()})
            response.raise_for_status()
        return None
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
