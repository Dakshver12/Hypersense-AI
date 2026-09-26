# HyperSense account update

This update adds real signup, email verification, login, logout, password reset, and private server-saved interview reports and recordings to the FastAPI application you uploaded. It has not been deployed to a public host.

## Install without losing your current work

1. Back up your working project. In the current browser, export Dashboard → Backup & restore before switching versions.
2. Copy the files from this archive into the matching project folders. Keep your existing `.env`, `.venv`, model file and recordings. None is included in this archive.
3. Append the development settings from `.env.accounts.example` to your existing `.env`. Do not replace provider credentials. No extra Python packages are required beyond the project's existing FastAPI stack.
4. Restart the server from the project directory. For the existing Windows environment:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn main:app --reload
   ```

5. Open **http://127.0.0.1:8000** in Chrome or Edge. Use that exact origin; `localhost` is a different origin and has different browser storage. If you prefer localhost, set APP_ORIGIN accordingly and use it consistently.
6. Choose Create account, use a password of at least 12 characters, and submit. In development, **no real email is sent**. Open the newest `.eml` file in `data/outbox` in your editor and copy the verification link into the browser. The link can wrap across lines in an email file; use an email viewer if needed. Click Verify email, then sign in.
7. For password-reset testing, choose Forgot password and open the new local email in the same way. Verification/reset links expire after 30 minutes and work once.

The outbox location follows HYPERSENSE_DATA_DIR if configured. These emails contain account-action tokens: keep the data directory private and out of Git.

## Existing interviews

On the signed-in workspace, choose **Import previous browser sessions**. This requires confirmation, imports completed interviews and their recordings into the current account, skips existing IDs, and keeps the original browser data. Use only on a browser containing your own interviews. It only sees data saved under the exact same origin and browser profile. Browser backups can also be restored from Dashboard → Backup & restore.

An interrupted import reports how many sessions succeeded. Retry safely: existing IDs are not overwritten. Backups imported into an account are processed one session at a time, rather than as one all-or-nothing transaction.

## What follows the account

- Completed interviews, transcripts, feedback, notes and answer recordings are stored on the server and available after signing in on another device.
- Saving is complete only after the saved confirmation. On network or quota failure, the report stays in memory with Retry saving. Download recordings/report before leaving; failed saves do not silently claim success.
- Camera/audio access and consent remain per browser. No camera video is uploaded to account storage; existing face-analysis requests still use the backend.
- Unfinished checkpoints, bookmarks, saved setups, delivery history and recent-question history remain browser-local, **namespaced by account**. They do not automatically sync across devices. Bookmarks/setups remain exportable in backups. The currently recorded answer is not checkpointed.
- Resume text is excluded from finished account records. Other session content, including job-description context if present, should be treated as personal data.
- Sign out is blocked during an active interview, recording, pending save, or operation. Finish/export first. Password reset revokes all server sessions.
- Sessions can be deleted from the dashboard. Old independent backups and original pre-account browser copies are not deleted by deleting a server session.

## Storage and usage limits

The initial deployment uses **SQLite on one persistent server instance**. Audio is base64 inside private interview documents. This keeps backup/restore and access checks straightforward for a small deployment; it is not object storage and adds base64 overhead.

- Each recording: up to 10 MiB.
- Each stored session document: up to 24 MiB, including encoded audio.
- Account: up to 100 sessions and 100 MiB of serialized session documents.
- AI endpoints: 20 requests/minute and AI_DAILY_LIMIT (default 100) per rolling 24 hours per account, shared by generation, transcription and scoring. Failed calls count too. This does not guarantee provider quota availability.
- Face detection: 600 requests/minute/account, independent of the AI quota.
- Authentication, login attempts and email requests have persistent rate limits. During local repeated testing, wait for the reported retry window rather than clearing your real database.

For a larger release, migrate SQLite to a managed database and recordings to private object storage before scaling to multiple replicas. This version's session list loads complete documents, including audio; the account cap limits the size, but pagination and lazy audio downloads are still future work.

## Deployment

1. Use a single long-running Python service with a persistent private disk. Serverless/ephemeral filesystems lose SQLite data and are unsuitable for this configuration.
2. Set APP_ENV=production and APP_ORIGIN to the exact public HTTPS origin. Configure MAIL_MODE=smtp plus SMTP_HOST, SMTP_FROM, SMTP_PORT (STARTTLS, normally 587), SMTP_USER and SMTP_PASSWORD where required.
3. Set HYPERSENSE_DATA_DIR to the persistent disk path. Do not serve it as static content. Restrict filesystem permissions to the service user. Back up the database and protect backups; recordings are private by access control, not separately encrypted by this application. Enable volume encryption where available.
4. Keep provider and SMTP secrets in the hosting platform's environment configuration. Do not commit `.env` or `data/`.
5. Put Uvicorn behind the platform's HTTPS proxy, with its trusted proxy configuration scoped to that platform. Example service command:

   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
   ```

6. Route the frontend and API through the same origin. Secure cookies are enabled for HTTPS, HttpOnly is always enabled, and unsafe requests require the configured Origin. Account IDs are checked server-side on every private storage/AI request. Cookies contain opaque random identifiers; the database stores their hashes. Sessions expire after seven days.
7. Configure authenticated SMTP and test actual verification/reset delivery. Local file-mail mode is refused in production. Verify your sender/domain through your mail provider.
8. Install the existing model/audio dependencies and provision the face-landmarker file used by your existing configuration. Local transcription and face inference require sufficient memory/CPU. This update does not bundle models, credentials, or media.
9. Before inviting users, verify camera permissions on HTTPS, a complete recorded interview, cross-device replay, logout, password reset, and backup recovery on the deployed service. Live SMTP, real model/provider calls, hosting and hardware were not exercised in the automated tests.

Email delivery is synchronous with a 15-second SMTP timeout. For higher traffic, use an email queue and improve operational monitoring. Self-service account deletion is not included yet; individual interview deletion is available.

## Automated checks

```powershell
.\.venv\Scripts\python.exe check_all.py
```

If Node test dependencies are absent, run `npm ci --include=dev` once. Added backend tests cover account isolation, verified login, password reset/revocation, expiry, rate limits, cross-origin rejection, upload bounds and production configuration. Added JSDOM checks cover auth forms, password visibility, link-token cleanup, account headers, audio serialization and migration conflicts. Existing interview UI regression tests also pass. JSDOM does not verify browser visual layout or real camera/microphone operation.

## Files and architecture

- `main.py` remains the small entry point; application composition lives in `backend/application.py`.
- `backend/accounts/` contains persistence, security, mail, auth routes, private session APIs and request-size middleware.
- `templates/auth.html`, `static/auth/form.js`, `static/css/auth.css` implement the responsive account pages.
- `static/js/account*.js` integrate identity, storage, import and logout with the existing app.
- Existing API routes are protected; signed-out calls do not reach model providers.
- Static files revalidate on reload. Pages and private API responses use no-store.

Reference APIs used: https://starlette.dev/responses/ and https://docs.python.org/3/library/hashlib.html . Password hashing uses PBKDF2-HMAC-SHA256 with a random salt and 600,000 iterations. Do not reduce the work factor for production.
