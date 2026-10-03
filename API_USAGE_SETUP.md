# HyperSense AI: admin API usage dashboard

## Apply the update
Extract this update into the project root, keeping the backend, static, templates and tests folders in place. Replace matching files. This update builds on the batch-generation/cooldown update; it is not a standalone project. Keep a Git checkpoint of any newer local edits before replacing files.

Add this to your existing .env, replacing the example with the email you use to sign in:

```dotenv
HYPERSENSE_ADMIN_EMAILS=your-email@example.com
```

Use comma-separated emails to grant multiple admins access. No one has access when this setting is empty. The account must already be verified and signed in. Do not share or commit .env. Your existing Docker Compose file loads .env; no Compose change is needed.

Rebuild:

```bash
docker compose up -d --build
```

Refresh with Ctrl+Shift+R. In the account menu, open **API usage**, or visit:

http://127.0.0.1:8000/admin/usage

Use the same hostname as your configured APP_ORIGIN when signing in. For a non-Docker local server, restart that server after updating the environment.

## What it measures
- App requests: single-question generation, batch session generation and answer scoring that reach the service handler. Batch generation is one request, not one per question.
- Provider attempts: Gemini/Groq SDK calls, including failed attempts. Internal SDK retries are not counted separately, so these are not exact billable network-request totals.
- Provider rate limits: attempted SDK calls ending in HTTP 429. Cooldown skips are counted separately.
- Fallback attempts: Groq attempts when a Gemini key is configured and Gemini failed or is cooling down. Groq-only configuration is not fallback. Percentage uses total provider attempts as denominator.
- Average response time: elapsed time for completed attempts, including errors; request timing includes provider fallback and service processing.
- Daily activity: UTC calendar days, selectable for today, seven days or thirty days. Missing days display zero.

The dashboard does not display remaining quota or cost, and a 429 alone cannot distinguish a per-minute limit from a daily quota. Provider consoles remain authoritative. Authentication/validation rejections before the handler, audio transcription and face detection are outside this first version. Activity before installation cannot be recovered.

## Persistence and privacy
Counters are stored in usage.sqlite3 under HYPERSENSE_DATA_DIR (the existing Docker data volume). They survive container rebuilds when that volume is preserved. Up to 30 days of hourly aggregates are retained; expired buckets are removed on the next read/write. No prompts, questions, transcripts, recordings, email addresses, user IDs, API keys or raw error messages are stored. Totals cover this application's provider wrapper, not other projects using the same keys.

The page and JSON API both enforce the admin allowlist server-side. The API also checks the existing account-ID header against the active verified session. Responses are no-store. Removing an email from the server environment and restarting revokes admin access. The page refreshes when returning to the tab and has a manual refresh button; it does not continually poll.

Metrics writes fail open: if SQLite is unavailable, interview calls proceed and a generic server warning is logged. Counts can therefore have gaps during storage failures. Dashboard reads show an error rather than reporting misleading zero usage. This uses the project's single-instance SQLite deployment design, not a distributed analytics service.

## Verification
51 backend tests and the UI suite pass with simulated providers. Coverage includes unauthorized/unverified accounts, admin removal, stale/expired sessions, fallback and cooldown accounting, concurrent updates, retention, private-data exclusion, operation labels, nonfatal metrics writes and UI error/empty states. Provider SDKs and media hardware were not exercised live. No graphical browser executable was available here, so the page has DOM-level checks but no screenshot validation.

Windows Git Bash:

```bash
./.venv/Scripts/python.exe check_hypersense.py
npm test
```

Tests keep simulated usage data in temporary directories.

## Commit

```bash
git add backend/usage backend/application.py backend/api.py backend/accounts/routes.py backend/services/providers.py static/js/account.js static/admin/usage.js static/css/admin-usage.css templates/admin-usage.html tests/test_api_usage.py tests/usage_ui.cjs tests/ui.cjs tests/test_question_batch.py API_USAGE_SETUP.md
git diff --cached --stat
git commit -m "Add admin API usage dashboard and aggregate provider metrics"
git push origin main
```
