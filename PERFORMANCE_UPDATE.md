# Vercel loading and session-save update

Apply these files on feature/vercel-direct-audio after the headless OpenCV fix.

## What changed

- The Vercel build copies static assets to public/static. Vercel serves the same /static URLs from its CDN, independently of Python startup. Browser revalidation remains enabled, while the CDN can cache the deployment's public assets.
- vercel.json selects Tokyo (hnd1), alongside the project's Tokyo Supabase database. This changes the function region, not the database or storage credentials.
- Cloud transcription decodes audio with PyAV without importing the local Whisper engine. Local Whisper remains available when selected outside Vercel. The evaluator and transcription model are unchanged.
- Recording configuration is reused for 30 seconds. Successfully uploaded audio references carry into answer snapshots and final saving, avoiding repeated uploads after checkpoints or save retries.
- Completed sessions first enter an account-scoped IndexedDB outbox. Once the local transaction commits, navigation and sign-out are permitted. Account synchronization proceeds while the site is open and retries on startup, reconnect, or returning to a visible tab.
- The queue retains completed upload references across reloads, serializes writes, and preserves newer edits. Supported browsers coordinate multiple tabs through Web Locks. Private resume text is excluded through the existing storedSession sanitizer.
- Upload and transcription status messages are separate, and the displayed elapsed time covers the complete browser operation.

## Apply and check

Extract the files into the project root, replacing matching files. Keep the generated public/static directory out of Git; the Vercel build recreates it.

Run in Git Bash:

```bash
./.venv/Scripts/python.exe check_hypersense.py
npm test
```

Push the change and deploy the new commit. Verify that the deployment's function region is hnd1.

## Live verification

1. Open the canonical production site in a new private window. Its first load should include styling without a refresh. In the Network panel, check that CSS and JavaScript return successful responses.
2. Complete a short interview. Check the upload and transcription messages, and note the total elapsed time.
3. After results say "Saved on this device", leave the results page. If account sync was unfinished, reopen the site while signed in to the same account and confirm the session appears in the dashboard.
4. Repeat on mobile.

The queue does not run after the browser is closed. It preserves unfinished saves on that device and resumes when the signed-in site is opened again. "Saved on this device" and "saved to your account" are intentionally different states. If browser storage is unavailable, the app retains its leave-page warning rather than claiming persistence.

## Validation completed

- All 98 backend tests passed.
- Full UI suite passed, including durable queue recovery, account isolation, startup synchronization, resume exclusion, upload reuse, newer-edit preservation, multi-tab serialization, and storage-failure exit protection.
- Decoder output matched the previous implementation for WAV sample rates/channels and generated WebM, MP3, M4A, OGG and FLAC recordings.
- Confirmed that importing the cloud transcription module does not import faster_whisper or ctranslate2.
- Verified current assets are copied without altering source files and stale generated assets are removed.

Actual deployed latency must be measured after redeployment; no live speedup figure is claimed.
