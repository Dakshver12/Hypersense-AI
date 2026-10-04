# Private recording storage update

This update connects the existing FastAPI and JavaScript app to the private Supabase bucket. It does not change your Tokyo DATABASE_URL, email settings, UI theme, transcription provider or deployment configuration.

## Apply

1. Keep a copy of your current project files. Extract this ZIP into the HyperSense AI project root, merging its `backend`, `static` and `tests` directories and replacing only matching files. This package contains complete versions of the listed files, based on the project copy used for our recent PostgreSQL updates; compare them first if you have made newer local edits.
2. Keep your existing `.env`. It is deliberately not included. These three settings must already contain your real values:

   ```dotenv
   SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   SUPABASE_SECRET_KEY="YOUR_SERVER_SECRET_KEY"
   SUPABASE_STORAGE_BUCKET="interview-recordings"
   ```

3. In Supabase, the bucket must be **private** with a file-size limit of **10 MB** (10,485,760 bytes) or less. Allow `audio/*`, `video/webm` and `application/octet-stream`. Do not add public read or write policies. Keep the server secret out of browser code and Git.
4. Run these commands separately in your project terminal:

   ```bash
   docker compose up -d --build app
   docker compose exec app python -m backend.maintenance.recording_storage check
   ```

   Expected: `Private recording bucket and server credentials are ready.` This is a read-only configuration/bucket check; it does not prove a browser upload yet.

5. Reload the app with Ctrl+Shift+R. Complete a short one-question interview while signed in. Wait for the saved confirmation, sign out and back in, reopen its report, and play the recording. Check that the file appears in the private bucket. Export a backup and a session ZIP, then delete this test session and confirm it disappears from the app and bucket. If an operation fails, keep the original recording page open and use Retry save or download its recording.

The new `hypersense.recording_objects` table is created on app startup. Do **not** rerun the SQLite-to-PostgreSQL migration and do not empty your database. The existing `httpx` dependency is used; no Supabase SDK is required. Retain your installed PostgreSQL driver and pool dependencies.

## Behavior

- The app authenticates the user before issuing a single-object signed upload link. The browser uploads directly to Supabase; the server key never leaves the backend.
- New account sessions store recording references rather than audio base64. The backend verifies ownership, session identity, remote byte size and media type before saving a reference. This is metadata validation, not a malware scan or audio-content analysis.
- Cloud history loads recording metadata. Opening a report downloads its recordings; the existing audio players, recording downloads and ZIP export continue to use Blobs.
- Backups download cloud audio explicitly and embed it, so exported backups remain portable.
- Existing base64 recordings remain readable. They are not bulk-migrated. Saving an old session through the updated frontend uploads its audio when cloud storage is enabled. Guest/browser-only sessions keep their existing IndexedDB behavior.
- A successful upload is reused when retrying a failed session save. Failed uploads do not publish a broken session. Keep the tab open until saving succeeds.
- Limits remain 100 sessions / 100 MB per account, with 10 MB per recording. Pending uploads reserve 10 MB each, verified immutable recordings count their real size, and deleted uploads reserve capacity until their upload tokens expire. Rapid failed/deleted uploads can temporarily prevent another upload. Upload link issuance is limited to 30 per user per hour.
- New cloud session text is limited to 1 MB. Reports and legacy base64 documents still retain older response behavior, which needs further work before Vercel deployment.

## Deletion and maintenance

Session/account deletion immediately prevents the app from authorizing new access and attempts object removal in the background. A durable receipt remains if Supabase is unavailable. Upload links last two hours; deletion receipts are retained through expiry plus five minutes and checked again to remove possible late uploads. Playback links last five minutes and act as temporary bearer links: do not share them. Signing out does not revoke an already issued link or erase a downloaded file.

Run this maintenance command regularly (hourly in a deployed environment):

```bash
docker compose exec app python -m backend.maintenance.recording_storage cleanup
```

It retries deletions and collects unreferenced uploads older than 24 hours, processing at most 100 objects per run. `deferred` means objects were removed but their token-expiry receipt is retained; rerun after expiry. `failed` means removal must be retried. No recurring scheduler is installed by this ZIP. Regular cleanup scheduling is required before deployment, including when no users are active.

The receipt table deliberately survives account deletion so cleanup remains possible. It stores object identifiers and filenames until cleanup succeeds. Do not manually remove receipts or switch the storage project/bucket without an object migration. Cleanup refuses to use a different project/bucket from the one recorded at upload time.

Database-only backups do not include cloud object bytes. Keep database backups and recording exports/object backups together. The in-app user backup does include its recording bytes.

## Automated checks

From Git Bash on Windows:

```bash
./.venv/Scripts/python.exe -X utf8 check_hypersense.py
npm test
```

If your local Python environment does not have the test dependencies, install the existing project test requirements first. Run `npm ci --include=dev` if Node test dependencies have not been installed. Docker's runtime image does not copy the test directory, so run these checks from the project checkout.

Tests cover private ownership, pending and wrong-session references, size/type mismatch, upload reservations, deletion retry, abandoned objects, account deletion, legacy recording compatibility, frontend upload retries, metadata-only cloud history, playback and portable audio backups. Supabase responses are mocked in automated tests; real credentials, browser CORS and the live PostgreSQL connection still require the local checks above.

This is the recording-storage stage, not a completed Vercel deployment. Live transcription still posts audio to FastAPI, and native model dependencies, legacy/large responses, hosted cleanup scheduling and production email transport remain deployment work.

## Files in this update

- backend/accounts/object_storage.py (new)
- backend/accounts/recordings.py (new)
- backend/accounts/schema.py
- backend/accounts/postgres.py
- backend/accounts/interviews.py
- backend/accounts/settings.py
- backend/application.py
- backend/maintenance/recording_storage.py (new)
- static/js/account-store.js
- static/js/storage.js
- static/js/backup.js
- tests/test_recording_storage.py (new)
- tests/recording_storage_ui.cjs (new)
- tests/account_ui.cjs
- tests/account_settings_ui.cjs
- tests/ui.cjs
- RECORDING_STORAGE_SETUP.md

## Reference

The REST integration follows Supabase's Storage client implementation and server-only key guidance:

- https://github.com/supabase/storage-js/blob/main/src/packages/StorageFileApi.ts
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/storage/buckets/creating-buckets
