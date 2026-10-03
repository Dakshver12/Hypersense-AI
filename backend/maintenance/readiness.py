"""Offline deployment checks. Never send email, call AI providers or download models."""
import argparse
from email.utils import parseaddr
import ipaddress
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[2]
MODULES = ('fastapi', 'uvicorn', 'dotenv', 'multipart', 'pydantic', 'google.genai',
           'groq', 'faster_whisper', 'av', 'cv2', 'mediapipe', 'numpy', 'httpx')


def dependencies():
    # Native import failures (e.g. missing shared libraries) stay inside this child.
    code = """import importlib,json
failed=[]
for name in %r:
    try: importlib.import_module(name)
    except Exception: failed.append(name)
print(json.dumps(failed))
""" % (MODULES,)
    try:
        result = subprocess.run([sys.executable, '-c', code], capture_output=True,
                                text=True, timeout=45, encoding='utf-8', errors='replace')
        if result.returncode: return None
        failed = json.loads(result.stdout.strip().splitlines()[-1])
        if not isinstance(failed, list) or any(n not in MODULES for n in failed): return None
        return failed
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired): return None


def writable(path):
    try:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.TemporaryDirectory(prefix='readiness-', dir=path) as tmp:
            db = sqlite3.connect(Path(tmp) / 'probe.sqlite3')
            try:
                db.execute('CREATE TABLE probe (value INTEGER)')
                db.execute('INSERT INTO probe VALUES (1)'); db.commit()
                return db.execute('SELECT value FROM probe').fetchone() == (1,)
            finally: db.close()
    except (OSError, sqlite3.Error): return False


def private_path(path, root):
    resolved=path.resolve()
    return not any(resolved == public.resolve() or public.resolve() in resolved.parents
                   for public in (root/'static', root/'templates'))


def cached_whisper(env, name):
    # faster-whisper's supported named models use the Systran Hugging Face repos.
    home = Path(env.get('HF_HOME') or str(Path(env.get('XDG_CACHE_HOME') or str(Path.home()/'.cache'))/'huggingface'))
    cache = Path(env.get('HF_HUB_CACHE') or env.get('HUGGINGFACE_HUB_CACHE') or str(home/'hub'))
    repo = cache / ('models--Systran--faster-whisper-' + name)
    try:
        revision = (repo/'refs'/'main').read_text(encoding='utf-8').strip()
        if not revision or any(c not in '0123456789abcdef' for c in revision): return False
        snapshot = repo/'snapshots'/revision
        return all((snapshot/file).is_file() and (snapshot/file).stat().st_size>0
                   for file in ('model.bin','config.json','tokenizer.json')) and any((snapshot/file).is_file() and (snapshot/file).stat().st_size>0 for file in ('vocabulary.json','vocabulary.txt'))
    except (OSError, ValueError): return False


def checks(env=None, root=ROOT, profile='production', probe=dependencies):
    env=dict(os.environ if env is None else env);root=Path(root);rows=[]
    def add(name,state,message): rows.append({'check':name,'status':state,'message':message})
    production=profile=='production'
    actual=env.get('APP_ENV','development')
    add('Environment','PASS' if actual==profile else 'FAIL',
        'APP_ENV matches the selected profile.' if actual==profile else 'Set APP_ENV to the selected profile, then restart. Use --profile development for local checks.')
    try:
        raw=env.get('APP_ORIGIN','http://127.0.0.1:8000').rstrip('/')
        url=urlsplit(raw);port=url.port
        valid=(url.scheme in ('http','https') and bool(url.hostname) and not url.username and not url.password
               and not url.path and not url.query and not url.fragment and not any(c.isspace() for c in raw)
               and (port is None or 1<=port<=65535))
        if not valid or (production and url.scheme!='https'): raise ValueError()
        host=url.hostname.lower();local=host=='localhost' or host.endswith(('.localhost','.local'))
        try: local=local or not ipaddress.ip_address(host).is_global
        except ValueError: pass
        add('Application URL','WARN' if production and local else 'PASS',
            'Production origin points to a local/private host. Confirm the intended public HTTPS domain.' if production and local else 'APP_ORIGIN has the expected URL format. DNS and TLS reachability are not tested.')
        add('Session cookie','PASS' if url.scheme=='https' else 'WARN',
            'HTTPS enables the application Secure cookie flag; HttpOnly and SameSite=Lax are set in account routes.' if url.scheme=='https' else 'Local HTTP uses a non-Secure session cookie. Use HTTPS before deployment.')
    except (ValueError, AttributeError):
        add('Application URL','FAIL','Set APP_ORIGIN to a scheme and host only; production requires HTTPS. Remove credentials, paths, query strings and invalid ports.')
        add('Session cookie','FAIL','Correct APP_ORIGIN so the application can determine the Secure cookie setting.')
    mode=env.get('MAIL_MODE','file')
    if mode=='file' and not production:
        add('Email configuration','WARN','Development file mode does not deliver email. Switch to SMTP before deployment.')
    elif mode!='smtp': add('Email configuration','FAIL','Set MAIL_MODE=smtp for production verification and password-reset email.')
    else:
        host=env.get('SMTP_HOST','');sender=env.get('SMTP_FROM','');security=env.get('SMTP_SECURITY','starttls')
        try: port=int(env.get('SMTP_PORT','587'))
        except ValueError: port=0
        address=parseaddr(sender)[1]
        valid=bool(host.strip() and '@' in address and address.rsplit('@',1)[-1] and security in ('ssl','starttls') and 1<=port<=65535
                   and bool(env.get('SMTP_USER'))==bool(env.get('SMTP_PASSWORD'))
                   and '\n' not in host+sender and '\r' not in host+sender)
        add('Email configuration','PASS' if valid else 'FAIL',
            'SMTP fields are configured. Credentials, sender verification and delivery have not been tested.' if valid else 'Set SMTP_HOST, a valid SMTP_FROM, SMTP_SECURITY=starttls or ssl, SMTP_PORT=1..65535, and both SMTP_USER/SMTP_PASSWORD when using authentication.')
        if valid and not env.get('SMTP_USER'): add('Email authentication','WARN','No SMTP login is configured. Confirm that your relay explicitly permits this server.')
        if valid and ((security=='ssl' and port==587) or (security=='starttls' and port==465)):
            add('Email transport','WARN','The port and security mode are an unusual pairing. Match your SMTP service settings.')
    keys=[bool(env.get(n,'').strip()) for n in ('GEMINI_API_KEY','GROQ_API_KEY')]
    add('AI provider configuration','PASS' if any(keys) else 'FAIL',
        'At least one AI provider key is present. Key validity, model access and quota are not tested.' if any(keys) else 'Set GEMINI_API_KEY or GROQ_API_KEY for question generation and evaluation.')
    if sum(keys)==1:add('AI fallback','WARN','Only one AI provider is configured; generation/evaluation has no second provider available.')
    for key in ('GEMINI_MODEL','GROQ_MODEL'):
        if key in env and not env[key].strip():add(key,'FAIL','Remove the empty model override or set a model supported by your account.')
    try: valid=int(env.get('AI_DAILY_LIMIT','100'))>0
    except ValueError: valid=False
    add('Daily request limit','PASS' if valid else 'FAIL','AI_DAILY_LIMIT is a positive integer.' if valid else 'Set AI_DAILY_LIMIT to a positive integer.')
    admin=env.get('HYPERSENSE_ADMIN_EMAILS','')
    add('Administrator access','PASS' if admin.strip() and all('@' in x.strip() for x in admin.split(',')) else 'WARN',
        'An administrator email allowlist is configured; account verification is not checked here.' if admin.strip() and all('@' in x.strip() for x in admin.split(',')) else 'Set HYPERSENSE_ADMIN_EMAILS to the verified administrator email addresses.')
    data=Path(env.get('HYPERSENSE_DATA_DIR') or str(root/'data'))
    backup=Path(env.get('HYPERSENSE_BACKUP_DIR') or str(data/'backups'))
    for title,path in [('Database storage',data),('Backup storage',backup)]:
        if not private_path(path,root):add(title,'FAIL','Move this storage outside static/ and templates/; those directories must not contain private databases.')
        else:
            ready=writable(path)
            add(title,'PASS' if ready else 'FAIL','Temporary SQLite write/read probe succeeded; test files were removed.' if ready else 'Ensure the configured directory can be created and written by the application user.')
    if env.get('DATABASE_URL','').strip():
        try:
            url=urlsplit(env['DATABASE_URL'])
            valid=url.scheme in ('postgresql','postgres') and bool(url.hostname and url.path.strip('/'))
        except ValueError:valid=False
        add('PostgreSQL configuration','PASS' if valid else 'FAIL',
            'Connection URL is configured. This offline check does not verify connectivity; run postgres_check.' if valid else 'Set a valid PostgreSQL DATABASE_URL.')
        add('PostgreSQL backups','WARN','Use private PostgreSQL dumps and restore tests. Local SQLite snapshots do not back up PostgreSQL.')
    else:
        live=data/'hypersense.sqlite3'
        if live.is_file():
            try:
                db=sqlite3.connect(live.resolve().as_uri()+'?mode=ro',uri=True,timeout=5)
                try: healthy=db.execute('PRAGMA quick_check').fetchall()==[('ok',)]
                finally:db.close()
                add('Existing database','PASS' if healthy else 'FAIL','Read-only SQLite quick check passed.' if healthy else 'Database quick check failed. Investigate and verify a backup before deployment.')
            except (OSError,sqlite3.Error):add('Existing database','FAIL','Existing database could not be checked. Verify file permissions and database health.')
        else:add('Existing database','WARN','No account database exists yet. Application startup creates it; create a verified backup after initialization.')
        add('Durable storage','WARN','Confirm persistent volume mounts and a private off-device backup. A local write probe cannot prove either.')
    asset=root/'face_landmarker.task'
    try:
        with zipfile.ZipFile(asset) as archive:
            valid=len([n for n in archive.namelist() if n.endswith('.tflite')])>=2 and archive.testzip() is None
        add('Face model asset','PASS' if valid else 'FAIL','Face model archive is readable. Model initialization and camera detection are not tested.' if valid else 'Replace face_landmarker.task with the valid MediaPipe Face Landmarker model bundle.')
    except (OSError,zipfile.BadZipFile,RuntimeError):add('Face model asset','FAIL','Place a valid face_landmarker.task beside main.py, then rebuild the container.')
    provider=env.get('TRANSCRIPTION_PROVIDER','groq').strip().lower()
    model=env.get('WHISPER_MODEL','small').strip() or 'small'
    add('Transcription provider','PASS' if provider in ('groq','local') else 'FAIL','Transcription provider setting is supported.' if provider in ('groq','local') else 'Set TRANSCRIPTION_PROVIDER=groq or local.')
    if provider=='groq' and not keys[1]:add('Groq transcription','WARN','GROQ_API_KEY is missing; the application will use local Whisper.')
    if model not in ('tiny','base','small','medium'):add('Local Whisper model','FAIL','Set WHISPER_MODEL to tiny, base, small or medium; these are the models accepted by this application.')
    else:
        cached=cached_whisper(env,model)
        needed=provider=='local' or (provider=='groq' and not keys[1])
        add('Local Whisper cache','PASS' if cached else 'FAIL' if needed else 'WARN',
            'Named-model cache files are present. Their loadability and inference have not been tested.' if cached else 'Pre-download the configured Whisper model in the runtime model cache. This check never downloads files; missing fallback weights can delay the first transcription.')
    failed=probe()
    add('Runtime dependencies','FAIL' if failed is None or failed else 'PASS',
        'Dependency import probe timed out or failed. Check the environment and native runtime libraries.' if failed is None else 'Cannot import: '+', '.join(failed)+'. Install project requirements and required native libraries in this runtime.' if failed else 'Application and media dependencies imported successfully; model inference was not run.')
    return rows


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',choices=('production','development'),default='production')
    parser.add_argument('--json',action='store_true',help='Print a machine-readable report without secrets.')
    args=parser.parse_args(argv)
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT/'.env')
    except ImportError: pass  # the dependency check reports this failure
    try: rows=checks(profile=args.profile)
    except Exception:
        rows=[{'check':'Readiness runner','status':'FAIL','message':'A check could not complete. Inspect configuration and filesystem permissions; no exception values were printed.'}]
    counts={s:sum(r['status']==s for r in rows) for s in ('PASS','WARN','FAIL')}
    if args.json:print(json.dumps({'profile':args.profile,'checks':rows,'summary':counts},indent=2))
    else:
        print('HyperSense readiness ('+args.profile+') — offline checks')
        for row in rows:print('['+row['status']+'] '+row['check']+': '+row['message'])
        print('\n{PASS} passed, {WARN} warnings, {FAIL} failures.'.format(**counts))
        print('This does not certify live provider access, SMTP delivery, HTTPS routing or model inference.')
    return int(bool(counts['FAIL']))


if __name__=='__main__':sys.exit(main())
