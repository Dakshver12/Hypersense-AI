"""Read-only production readiness checks. Never sends email or calls AI providers."""
import argparse
import ast
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


def configuration(env):
    rows = []
    def check(name, ok, fix):
        rows.append(('PASSED' if ok else 'NOT CONFIGURED', name, '' if ok else fix))
    check('Production mode', env.get('APP_ENV') == 'production', 'Set APP_ENV=production in the deployment environment.')
    try:
        url = urlsplit(env.get('APP_ORIGIN', ''))
        valid = (url.scheme == 'https' and bool(url.hostname) and
                 url.hostname not in ('localhost', '127.0.0.1', '::1') and
                 not url.username and not url.password and url.path in ('', '/') and
                 not url.query and not url.fragment)
    except ValueError:
        valid = False
    check('Public HTTPS origin', valid, 'Set APP_ORIGIN to the public HTTPS origin; certificate reachability needs a live check.')
    check('AI credentials present', any(env.get(k, '').strip() for k in ('GEMINI_API_KEY', 'GROQ_API_KEY')), 'Set at least one supported provider key. This does not verify key validity or quota.')
    try:
        port_ok = 1 <= int(env.get('SMTP_PORT', '587')) <= 65535
    except ValueError:
        port_ok = False
    mail_ok = (env.get('MAIL_MODE') == 'smtp' and env.get('SMTP_HOST') and
               env.get('SMTP_FROM') and port_ok and
               env.get('SMTP_SECURITY', 'starttls') in ('ssl', 'starttls') and
               bool(env.get('SMTP_USER')) == bool(env.get('SMTP_PASSWORD')))
    check('SMTP configuration', bool(mail_ok), 'Configure SMTP host, sender, TLS mode, port and matching credentials. Inbox delivery requires a separate test.')
    storage = env.get('HYPERSENSE_DATA_DIR', '')
    check('Explicit data directory', bool(storage) and Path(storage).is_absolute(), 'Set HYPERSENSE_DATA_DIR to an absolute private path on the host.')
    rows.append(('NOT CONFIGURED', 'Persistent disk verification', 'Confirm the configured directory is on a persistent host volume. A local script cannot prove persistence across redeploys.'))
    return rows


def git_checks(root):
    try:
        result = subprocess.run(['git','ls-files','-z'], cwd=root, capture_output=True, timeout=15)
        if result.returncode:
            return [('NOT CONFIGURED','Git privacy check','Run from a Git checkout.')]
        paths = result.stdout.decode('utf-8', errors='replace').split('\0')
        def private(name):
            p = Path(name)
            return (p.name == '.env' or (p.name.startswith('.env.') and not p.name.endswith(('.example','.sample'))) or
                    'data' in p.parts or p.suffix.lower() in ('.webm','.wav','.mp3','.m4a','.ogg','.flac','.eml','.sqlite3') or '.sqlite3-' in p.name)
        count = sum(private(p) for p in paths if p)
        tracked = ('FAILED' if count else 'PASSED', 'Tracked private files', f'{count} private-data paths tracked. Remove them from the index; rotate any exposed credentials.' if count else '')
        ignored = subprocess.run(['git','check-ignore','--no-index','--','.env','data/probe.sqlite3','answer.webm'], cwd=root, text=True, capture_output=True, timeout=15)
        ok = set(ignored.stdout.splitlines()) == {'.env','data/probe.sqlite3','answer.webm'}
        return [tracked, ('PASSED' if ok else 'FAILED','Ignore rules','' if ok else 'Ignore .env, data/ and recordings before committing.')]
    except (OSError, subprocess.TimeoutExpired):
        return [('NOT CONFIGURED','Git privacy check','Install Git and run inside the project checkout.')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-only', action='store_true', help='Skip the existing backend/UI test runner.')
    args = parser.parse_args()
    rows = []
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT/'.env', override=False)
    except ImportError:
        rows.append(('NOT CONFIGURED','Environment loader','Install project dependencies to read .env; process environment is still checked.'))
    rows += configuration(os.environ)
    try:
        tree = ast.parse((ROOT/'backend/accounts/mail.py').read_text(encoding='utf-8'))
        ok = any(isinstance(node, ast.FunctionDef) and node.name == 'validate_mail_config' for node in tree.body)
        rows.append(('PASSED' if ok else 'FAILED','Mail module compatibility','' if ok else 'Restore the account-readiness mail.py containing validate_mail_config.'))
    except (OSError, SyntaxError):
        rows.append(('FAILED','Mail module compatibility','Restore a valid backend/accounts/mail.py.'))
    rows += git_checks(ROOT)
    if args.config_only:
        rows.append(('NOT CONFIGURED','Automated tests','Rerun without --config-only to execute check_all.py.'))
    else:
        print('Running backend and UI checks (up to 10 minutes)…', flush=True)
        try:
            env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
            result = subprocess.run([sys.executable,str(ROOT/'check_all.py')], cwd=ROOT, env=env, capture_output=True, timeout=600)
            rows.append(('PASSED' if result.returncode == 0 else 'FAILED','Backend and UI tests','' if result.returncode == 0 else 'Run python check_all.py for detailed diagnostics. Output is suppressed here to avoid exposing configuration.'))
        except (OSError, subprocess.TimeoutExpired):
            rows.append(('FAILED','Backend and UI tests','Runner failed or timed out. Run python check_all.py directly.'))
    for status, name, detail in rows:
        print(f'[{status}] {name}'+(f': {detail}' if detail else ''))
    print('\nConfiguration presence is not proof of live email, API access, TLS or durable hosting. No remote services were contacted.')
    return 1 if any(status != 'PASSED' for status, _, _ in rows) else 0


if __name__ == '__main__':
    sys.exit(main())
