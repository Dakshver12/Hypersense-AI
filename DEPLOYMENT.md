# HyperSense deployment preparation

This patch adds a Docker image, local Compose setup, and public GET /healthz.
It does not publish the app or configure a hosting account.

## Apply

Extract this patch into the project root, merging folders. Keep your existing
main.py, requirements.txt, face_landmarker.task, templates and static assets.
The patch replaces backend/application.py to register the health router.

## Local Docker check (Windows Docker Desktop, Linux containers)

Keep your existing private .env and API keys. For local testing set:

```
APP_ENV=development
APP_ORIGIN=http://127.0.0.1:8000
MAIL_MODE=file
```

Run each command from the project root:

```bash
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:8000/healthz
docker compose logs --tail=80 app
```

Open http://127.0.0.1:8000/login. Health returns {"status":"ok"}.
The existing local Uvicorn server must be stopped first if it uses port 8000.
Docker must be installed and running. The first build downloads Python packages;
local Whisper may also download a model on first use. The image includes the
existing face_landmarker.task file and requires it in the project root.

This is a NEW database in a Docker volume. Existing Windows data is not imported
automatically. Create a test account; development verification links remain local.
Compose overrides any Windows HYPERSENSE_DATA_DIR with the container path.

## Persistence check

1. Create a test account and save an interview in the containerized app.
2. Run `docker compose down` (without `-v`).
3. Run `docker compose up -d`.
4. Sign in again and confirm that the interview and recording are still present.

The named volume survives container replacement. `docker compose down -v` deletes
that volume. A volume is not a backup. Before real use, schedule SQLite-consistent
backups and test restoring them on the chosen host. Do not copy a live SQLite file
as a backup; use SQLite's backup API or stop the app before copying it.

## Host configuration

Use a host that can run this Linux image with a private persistent disk. Keep one
replica and one worker for this SQLite deployment. Mount the disk at
/var/lib/hypersense and make it writable by UID/GID 10001. A host bind mount may
need explicit ownership setup; the local named volume gets image directory ownership.

Configure HTTPS at the host/reverse proxy. Route traffic to container port 8000.
Use /healthz as the health-check path. The bundled Compose file only binds to
127.0.0.1, for local use or a same-host reverse proxy; it does not provide TLS.

Copy the variable names from deploy.env.example into the host's secret/settings
panel. Replace the example origin with the exact HTTPS origin, without a path.
Set APP_ENV=production and MAIL_MODE=smtp. Fill SMTP host, sender, login/password,
port and security using your provider's actual settings. Supply a GROQ_API_KEY
when TRANSCRIPTION_PROVIDER=groq. Supply the keys used for question generation
and scoring as well. Optional model overrides should use IDs available to your
provider account. Never commit filled credentials or bake them into the image.

Run a real verification/reset email test after deployment. SMTP configuration
validation only checks configuration; it does not prove delivery.

/healthz is liveness only. It does not verify SMTP, AI quotas, face detection or
disk persistence. App startup still validates mail/origin and initializes SQLite.
Test camera/microphone in the HTTPS browser, record/transcribe/score an answer,
and repeat the persistence check across a real host redeploy before launch.

The image installs the existing requirements.txt (currently not fully pinned).
A successful container build and dependency lock are still needed before treating
this as a reproducible release. No Docker engine was available in the patch's
validation environment; the container has not been built there.

## Automated checks

```bash
./.venv/Scripts/python.exe check_all.py
```

The added health test uses a temporary database and development mail configuration.
The deployment checker may still report production/persistent disk items as
NOT CONFIGURED locally. It cannot prove storage survives a host redeploy.

## Commit this patch

```bash
git add Dockerfile .dockerignore compose.yaml deploy.env.example DEPLOYMENT.md backend/health.py backend/application.py tests/test_health.py
git diff --cached --stat
git commit -m "Prepare Docker deployment and add health endpoint"
git push
```

References: https://docs.docker.com/reference/dockerfile/
and https://docs.docker.com/engine/storage/volumes/
