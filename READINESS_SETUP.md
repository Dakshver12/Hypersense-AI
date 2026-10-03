# Offline production readiness checks

Extract into your project root. Apply after the verified-backups update.
This update adds a command and tests; it does not modify the running app settings.

## Docker
```bash
docker compose up -d --build
docker compose exec app python -m backend.maintenance.readiness
```
The default profile is production. If the project still has development settings,
failures for APP_ENV or a non-HTTPS APP_ORIGIN are expected. Do not switch to an
invented HTTPS address just to pass: use the real deployment origin when ready.

For your current local installation:
```bash
docker compose exec app python -m backend.maintenance.readiness --profile development
```

Machine-readable report:
```bash
docker compose exec -T app python -m backend.maintenance.readiness --json
```

Without Docker, run in the existing project environment:
```bash
./.venv/Scripts/python.exe -m backend.maintenance.readiness --profile development
```

## What it checks
- APP_ENV matches the selected profile.
- APP_ORIGIN syntax, HTTPS for production, and the resulting Secure cookie setting.
- MAIL_MODE and SMTP fields, security mode, port and paired credentials.
- At least one question/evaluation provider key, blank model overrides, fallback
  availability and a positive AI_DAILY_LIMIT.
- Whether HYPERSENSE_ADMIN_EMAILS is configured.
- Database and backup storage: a temporary SQLite write/read probe, removed afterward.
  Missing configured directories may be created. No live database rows are changed.
- An existing account database using read-only SQLite quick_check.
- face_landmarker.task as a readable model archive, including archive CRC checks.
- TRANSCRIPTION_PROVIDER and the local Whisper model sizes accepted by this app.
- The named Whisper model cache under HF_HUB_CACHE, HUGGINGFACE_HUB_CACHE,
  HF_HOME or the standard user cache. Config, model, tokenizer and vocabulary
  files must be present at the main revision. This is a file-presence check,
  not a model initialization or content-validity test.
- Runtime imports including FastAPI, provider SDKs, PyAV, OpenCV, MediaPipe and
  faster-whisper in a separate process with a 45-second timeout. Import stdout
  and stderr are captured; raw exceptions and environment values are not printed.

## Reading the report
PASS means that specific local check passed. WARN means review is still needed.
FAIL identifies a blocking local check with a corrective action. The command
returns exit code 1 when any check fails, otherwise 0. Warnings remain in the
report and must still be reviewed before deployment.

Some warnings are deliberate: a local command cannot prove durable Docker
mounts or off-device backups. SMTP fields do not prove delivery, and a configured
API key does not prove authentication, quota or access to the configured model.
No email is sent, no provider request is made, no model is downloaded and no
camera/microphone is opened. DNS, public TLS routing, email delivery and actual
model inference need separate live smoke tests.

A missing local Whisper cache is FAIL when local transcription is required and
WARN when it is only the fallback behind configured Groq transcription. If you
choose to preload weights, run this explicitly in the SAME runtime/cache volume
as the app (this separate command WILL download a missing model):
```bash
docker compose exec app python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.getenv('WHISPER_MODEL', 'small').strip() or 'small', device='cpu', compute_type='int8')"
```
Use only tiny/base/small/medium as accepted by the current application. Allow
time and storage for the download, then rerun the readiness check.

## Tests and Git
71 backend tests passed, including seven readiness tests covering invalid
settings, secret-free reports, storage probe cleanup/failure, missing model
assets, cloud versus local fallback requirements, dependency failures and exit codes.
No production environment has been certified by those fixture-based tests.

```bash
git add backend/maintenance/readiness.py tests/test_readiness.py READINESS_SETUP.md
git commit -m "Add offline production readiness checks"
git push
```
