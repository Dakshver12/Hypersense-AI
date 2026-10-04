# HyperSense AI: Vercel preview

This update preserves the Docker/Render path and adds private-storage transcription.
Audio is uploaded from the browser to Supabase, then the browser sends a small
JSON request containing the language to an owned recording's transcription route.
The server downloads only the object key stored for that account. It does not
accept arbitrary URLs. Ready state, account ownership, origin, rate limits,
file type, exact byte count, maximum size and two-minute duration remain checked.
No Supabase secret is sent to the browser. Uploaded objects use the existing
abandoned-upload cleanup mechanism.

## Apply and test

1. Work on `feature/vercel-direct-audio`, not `main`.
2. Extract this update ZIP into the project root, replacing matching files.
   It contains changed files only. Keep your existing project files and .env.
3. Run in Git Bash:

```bash
uv sync --no-install-project
uv run python -m unittest tests.test_recording_storage -v
npm ci --include=dev
npm test
```

Run the full backend checks before merging:

```bash
uv run python check_all.py
```

Then stage only the update:

```bash
git add backend/accounts/object_storage.py backend/accounts/recordings.py backend/application.py backend/services/transcription.py backend/usage/store.py backend/services/face.py backend/native.py scripts/build_vercel.py .gitignore static/js/account-store.js static/js/recording.js tests/test_recording_storage.py tests/recording_storage_ui.cjs tests/test_cloud_transcription.py pyproject.toml requirements.txt uv.lock vercel.json .vercelignore VERCEL_SETUP.md
git commit -m "Support private recording transcription and Vercel previews"
git push -u origin feature/vercel-direct-audio
```

## Create the Vercel project

Import the existing GitHub repository. Choose the FastAPI framework preset,
project root at the repository root, and Python 3.12. Keep the output directory at the framework default. The included build command
`python scripts/build_vercel.py` downloads and verifies the small Debian GL
dispatch libraries required by MediaPipe. It needs outbound HTTPS to
https://deb.debian.org and targets Linux x86_64. Keep this build command enabled. This is a Python deployment, not a Docker
image deployment. The entrypoint is `main:app`.

Use the branch above for the initial deployment (or a separate Vercel project
whose production branch is this branch). Keep Render pointed at `main`.
Enable Fluid compute and set `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` if the bundled
runtime exceeds the standard Python limit. The update sets a 300-second maximum
function duration. These settings do not guarantee successful native-library
initialization or acceptable response times; test the preview.

## Environment variables

Copy the working server configuration privately to Vercel. Never commit .env.

| Variable | Value |
| --- | --- |
| APP_ENV | production |
| APP_ORIGIN | Exact HTTPS origin of the Vercel deployment you will open |
| VERCEL_SUPPORT_LARGE_FUNCTIONS | 1 |
| DATABASE_URL | Existing working Supabase PostgreSQL URL |
| SUPABASE_URL | Existing Supabase project HTTPS URL |
| SUPABASE_SECRET_KEY | Existing server secret |
| SUPABASE_STORAGE_BUCKET | interview-recordings |
| TRANSCRIPTION_PROVIDER | groq |
| GROQ_API_KEY | Existing working key |
| HYPERSENSE_DATA_DIR | /tmp/hypersense |
| MAIL_MODE | smtp |
| SMTP_HOST / SMTP_PORT / SMTP_SECURITY | Existing working mail settings |
| SMTP_FROM / SMTP_USER / SMTP_PASSWORD | Existing working mail settings |

Also copy the existing question/evaluation keys, administrator allowlist and
AI_DAILY_LIMIT. Use the exact existing variable names for those settings.
Vercel supplies VERCEL=1 automatically; do not set it in your local .env.

APP_ORIGIN must be a plain URL, without quotes, brackets, paths or trailing
slash. After Vercel assigns the hostname, set that origin and redeploy. Open
that exact hostname: authentication intentionally rejects other origins.
For a preview with a changing hostname, update the preview-scoped APP_ORIGIN,
or use the stable branch hostname. Do not allow arbitrary preview origins.

PostgreSQL is durable; /tmp is only scratch space. Local backup snapshots are
not durable on Vercel. Continue external PostgreSQL backups and existing
recording cleanup from a persistent runner. This update does not schedule them.

## Live acceptance test

- Open /healthz, log in and verify existing session history.
- Test email verification and password reset from the Vercel hostname.
- Calibrate the camera and verify face detection in the actual Vercel runtime.
- Record/transcribe an answer; review and submit it, then reopen its report.
- Upload a valid audio file larger than 4.5 MB but at most 10 MB and at most
  two minutes. In Network, audio PUT goes to Supabase; transcription uses JSON
  at /api/account/recordings/<id>/transcribe, not multipart /transcribe.
- Retry transcription and saving, confirm existing playback and account isolation.
- Test failure recovery. On Vercel, Groq outages return a retryable error instead
  of loading local Whisper. Keep the recording for retry or download.

Large session imports containing legacy base64 audio can still exceed Vercel's
payload limit. Re-export/import sessions through the existing cloud conversion
flow and test representative backups before relying on large imports. ZIP
exports occur in the browser. Changing audio upload does not remove function
CPU, memory, duration or usage limits.

## Validation performed on this update

Storage backend tests cover owned-ready transcription, invalid origins and
languages, cross-account rejection, deleted objects, bounded downloads and
existing storage lifecycle behavior. UI checks cover direct uploads, retry reuse,
small transcription JSON, session saves and existing application flows.
Actual Vercel deployment, SMTP delivery, live Groq calls and camera inference
must be verified on the preview; no credentials were used during these checks.

Local results: all 93 existing/updated backend tests passed; the two additional
cloud transcription tests passed, and the full UI suite passed. Cloud-provider
responses are simulated in tests. Audio decoding uses a real WAV fixture.

The native build bundles libGLdispatch, libEGL and libGLESv2 with their license
notices. The loader preloads them only on Vercel. Docker keeps its system libraries.

Native probe: with VERCEL=1 and the bundled dispatch libraries, MediaPipe
initialized and processed a blank JPEG (zero faces, as expected). This verifies
local Linux native loading, not real-camera accuracy or the Vercel host itself.
